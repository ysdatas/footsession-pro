/* ============================================================
   LMFC Performance — lmfc_v62.sql : questionnaires après séance et après match, avec alertes
   À exécuter après lmfc_v61.sql. Rejouable et transactionnelle.

   Quatre formulaires de plus pour chaque club, copies de RPE de séance et de RPE de match
   (même mécanisme que « Copier pour une équipe », lmfc_v47.sql) :
   - Après séance — N2 et Espoirs : RPE, temps de musculation avant, dépense musculaire et
     cardio-respiratoire, maîtrise technique et tactique, émotions, plaisir, vie personnelle,
     douleurs (et zone), temps de musculation après ;
   - Après séance — Section : RPE, plaisir, vie personnelle, douleurs (et zone) ;
   - Après match — Espoirs et réserve : RPE, fatigue, jambes, technique, tactique, compréhension
     des partenaires et du staff, émotions, plaisir, vie personnelle, douleurs (et zone) ;
   - Après match — Section : RPE, technique, tactique, émotions, plaisir, vie personnelle,
     douleurs (et zone), temps de musculation après.
   Ils sont créés DÉSACTIVÉS et sans équipe : le club choisit les équipes dans Suivi RPE >
   Formulaires (l'attribuer à une équipe la retire du formulaire d'origine). Les réponses
   d'origine (RPE) restent dans session_rpe et match_rpe ; les autres questions sont posées
   dans « Mes formulaires » après le RPE, comme toute question ajoutée (lmfc_v47.sql).

   Alertes : une question porte une règle « alerte » dans sa définition :
   - {"mode": "serie", "sous": 5, "fois": 3} : les 3 derniers jours répondus sont tous
     strictement sous 5 (plaisir, vie personnelle) ;
   - {"mode": "seuil", "max": 3} : réponse inférieure ou égale à 3 (jambes, vie personnelle
     en match) ;
   - {"mode": "douleur", "zone": "douleur_zone"} : douleur supérieure à 0 (zone indiquée).
   form_alerts_open() les calcule sur les 14 derniers jours à partir des réponses que le
   compte peut lire (la RLS des réponses décide : staff qui suit l'équipe et le joueur) ;
   form_alert_seen() la marque « Vu ». La règle est lue dans la copie de la question
   enregistrée avec la réponse : modifier le formulaire ne change pas les alertes passées.

   Retour arrière : lmfc_v62_retour.sql (refusé si des joueurs ont répondu à ces formulaires).
   ============================================================ */
begin;

-- Alertes marquées « Vu » : une par joueur, formulaire, question et jour de réponse.
create table if not exists public.form_alert_seen (
  club_id     bigint not null references public.clubs on delete cascade,
  player_id   bigint not null references public.players on delete cascade,
  form_id     bigint not null references public.custom_forms on delete cascade,
  question_id text not null,
  jour        date not null,
  vu_par      uuid references auth.users on delete set null,
  vu_at       timestamptz not null default now(),
  primary key (player_id, form_id, question_id, jour)
);
alter table public.form_alert_seen enable row level security;
drop policy if exists form_alert_seen_read on public.form_alert_seen;
create policy form_alert_seen_read on public.form_alert_seen for select to authenticated
  using (club_id = public.my_club_id() and public.has_role('admin', 'coach', 'prepa', 'analyste'));
revoke all on public.form_alert_seen from anon, authenticated;
grant select on public.form_alert_seen to authenticated;

-- Le jour d'une réponse : celui de la séance (s12), du match (m12) ou du jour (j2026-11-06) ;
-- à défaut, le jour d'envoi.
create or replace function public.form_alert_jour(p_occ text, p_at timestamptz)
returns date language sql stable set search_path = public as $$
  select coalesce(
    case when p_occ ~ '^s[0-9]{1,18}$' then (select s.date_seance from public.sessions s where s.id = substr(p_occ, 2)::bigint)
         when p_occ ~ '^m[0-9]{1,18}$' then (select m.date_match from public.matches m where m.id = substr(p_occ, 2)::bigint)
         when p_occ ~ '^j[0-9]{4}-[0-9]{2}-[0-9]{2}$' then substr(p_occ, 2)::date
    end,
    (p_at at time zone 'Europe/Paris')::date);
$$;

-- Un nombre d'une règle d'alerte, ou la valeur par défaut si la règle est mal écrite.
create or replace function public.form_alert_num(p_rule jsonb, p_key text, p_default numeric)
returns numeric language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p_rule -> p_key) = 'number' then (p_rule ->> p_key)::numeric else p_default end;
$$;

-- Alertes ouvertes (14 derniers jours, pas encore vues) dans le périmètre du compte.
create or replace function public.form_alerts_open()
returns table (
  player_id bigint, player_nom text, team_id bigint, team_nom text, form_id bigint, form_titre text,
  question_id text, question_label text, mode text, jour date, valeur numeric, detail text, regle jsonb
)
language sql stable security invoker set search_path = public as $$
  with reps as (
    select r.player_id, r.player_name_snapshot nom, r.team_id, r.team_name_snapshot team_nom, r.form_id,
           r.form_title_snapshot titre, q.value q, q.value ->> 'id' qid, q.value -> 'alerte' regle,
           public.form_alert_jour(r.occurrence, r.submitted_at) jour,
           case when jsonb_typeof(r.answers -> (q.value ->> 'id')) = 'number' then (r.answers ->> (q.value ->> 'id'))::numeric end val,
           r.answers
      from public.custom_form_responses r
      cross join lateral jsonb_array_elements(r.questions_snapshot) q
     where r.submitted_at > now() - interval '60 days'
       and jsonb_typeof(q.value -> 'alerte') = 'object'
  ),
  jours as (   -- un seul chiffre par jour et par question : le plus bas
    select player_id, form_id, qid, jour, min(val) val,
           (array_agg(nom))[1] nom, (array_agg(team_id))[1] team_id, (array_agg(team_nom))[1] team_nom,
           (array_agg(titre))[1] titre, (array_agg(q))[1] q, (array_agg(regle))[1] regle
      from reps where val is not null group by player_id, form_id, qid, jour
  ),
  rang as (
    select j.*, row_number() over (partition by player_id, form_id, qid order by jour desc) rn from jours j
  ),
  serie as (
    select player_id, form_id, qid, max(jour) jour, min(val) val,
           (array_agg(nom))[1] nom, (array_agg(team_id))[1] team_id, (array_agg(team_nom))[1] team_nom,
           (array_agg(titre))[1] titre, (array_agg(q order by jour desc))[1] q, (array_agg(regle order by jour desc))[1] regle
      from rang
     where regle ->> 'mode' = 'serie' and rn <= public.form_alert_num(regle, 'fois', 3)
     group by player_id, form_id, qid
    having count(*) = public.form_alert_num((array_agg(regle order by jour desc))[1], 'fois', 3)
       and bool_and(val < public.form_alert_num(regle, 'sous', 5))
  ),
  tous as (
    select 'serie' mode, s.player_id, s.form_id, s.qid, s.jour, s.val, s.nom, s.team_id, s.team_nom, s.titre, s.q, s.regle,
           null::text detail
      from serie s
    union all
    select 'seuil', j.player_id, j.form_id, j.qid, j.jour, j.val, j.nom, j.team_id, j.team_nom, j.titre, j.q, j.regle, null
      from jours j
     where j.regle ->> 'mode' = 'seuil' and j.val <= public.form_alert_num(j.regle, 'max', 3)
    union all
    select 'douleur', j.player_id, j.form_id, j.qid, j.jour, j.val, j.nom, j.team_id, j.team_nom, j.titre, j.q, j.regle,
           (select nullif(btrim(r.answers ->> (j.regle ->> 'zone')), '') from public.custom_form_responses r
             where r.player_id = j.player_id and r.form_id = j.form_id
               and public.form_alert_jour(r.occurrence, r.submitted_at) = j.jour
               and nullif(btrim(r.answers ->> (j.regle ->> 'zone')), '') is not null
             order by r.submitted_at desc limit 1)
      from jours j
     where j.regle ->> 'mode' = 'douleur' and j.val > 0
  )
  select t.player_id, t.nom, t.team_id, t.team_nom, t.form_id, t.titre, t.qid, t.q ->> 'label', t.mode, t.jour, t.val, t.detail, t.regle
    from tous t
   where public.has_role('admin', 'coach', 'prepa', 'analyste')   -- le staff, pas le joueur ni le lecteur
     and t.jour >= current_date - 14
     and not exists (select 1 from public.form_alert_seen s
                      where s.player_id = t.player_id and s.form_id = t.form_id and s.question_id = t.qid and s.jour = t.jour)
   order by t.jour desc, t.nom, t.qid;
$$;

-- « Vu » : le staff qui peut lire une réponse de ce joueur à ce formulaire.
create or replace function public.form_alert_seen(p_player bigint, p_form bigint, p_question text, p_jour date)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_club bigint;
begin
  if public.is_lecteur() or not public.has_role('admin', 'coach', 'prepa', 'analyste') then
    raise exception 'Alerte réservée au staff qui suit ce joueur.' using errcode = '42501';
  end if;
  select r.club_id into v_club
    from public.custom_form_responses r
   where r.player_id = p_player and r.form_id = p_form
     and public.custom_form_response_can_read(r.club_id, r.team_id, r.player_id)
   limit 1;
  if v_club is null or v_club <> public.my_club_id() then
    raise exception 'Alerte réservée au staff qui suit ce joueur.' using errcode = '42501';
  end if;
  insert into public.form_alert_seen (club_id, player_id, form_id, question_id, jour, vu_par)
  values (v_club, p_player, p_form, p_question, p_jour, auth.uid())
  on conflict do nothing;
  return true;
end $$;

-- Une question : intitulé, type, échelle de 0 à 10, réponse demandée ; extra la complète.
create or replace function public.custom_form_q(p_id text, p_label text, p_type text, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object('id', p_id, 'label', p_label, 'type', p_type, 'required', true)
         || case when p_type = 'scale' then jsonb_build_object('min', 0, 'max', 10) else '{}'::jsonb end
         || p_extra;
$$;

-- Les questions d'un des quatre questionnaires. La question d'origine (rpe) garde son type :
-- seul son intitulé change (custom_form_version_guard).
create or replace function public.custom_form_questionnaire(p_kind text)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_rpe jsonb;
  v_zone jsonb := jsonb_build_object('options', jsonb_build_array('Ischio-jambiers', 'Quadriceps', 'Adducteurs', 'Mollets',
    'Fessiers', 'Dos / lombaires', 'Hanche', 'Genou', 'Cheville', 'Pied', 'Épaule', 'Autre'), 'required', false);
  v_serie jsonb := jsonb_build_object('alerte', jsonb_build_object('mode', 'serie', 'sous', 5, 'fois', 3));
  v_seuil jsonb := jsonb_build_object('alerte', jsonb_build_object('mode', 'seuil', 'max', 3));
  v_douleur jsonb := jsonb_build_object('alerte', jsonb_build_object('mode', 'douleur', 'zone', 'douleur_zone'));
  v_minutes jsonb := jsonb_build_object('required', false);
begin
  if p_kind in ('seance_n2', 'seance_section') then
    v_rpe := (public.custom_form_defaults('rpe_seance') -> 'questions' -> 0) || jsonb_build_object('label', 'Comment évalues-tu l’intensité de la session ?');
  else
    v_rpe := (public.custom_form_defaults('rpe_match') -> 'questions' -> 0) || jsonb_build_object('label', 'Comment évalues-tu l’intensité de la session ?');
  end if;
  return case p_kind
    when 'seance_n2' then jsonb_build_array(v_rpe,
      public.custom_form_q('temps_pre', 'Temps passé en salle de musculation avant la séance (en minutes)', 'number', v_minutes),
      public.custom_form_q('depense_musculaire', 'Quel a été ton niveau de dépense d’énergie musculaire ?', 'scale'),
      public.custom_form_q('cardio', 'Quel a été ton niveau de dépense d’énergie cardio-respiratoire ?', 'scale'),
      public.custom_form_q('technique', 'Ma maîtrise technique', 'scale'),
      public.custom_form_q('tactique', 'Ma maîtrise tactique', 'scale'),
      public.custom_form_q('emotions', 'As-tu bien géré tes émotions ?', 'scale'),
      public.custom_form_q('plaisir', 'As-tu pris du plaisir ?', 'scale', v_serie),
      public.custom_form_q('vie_perso', 'Ta vie personnelle te permet-elle de bien t’entraîner ?', 'scale', v_serie),
      public.custom_form_q('douleur', 'As-tu des douleurs ou des gênes physiques particulières ? (0 = aucune)', 'scale', v_douleur),
      public.custom_form_q('douleur_zone', 'Si oui, quel muscle ou quelle articulation ?', 'choice', v_zone),
      public.custom_form_q('temps_post', 'Temps passé en salle de musculation après la séance (en minutes)', 'number', v_minutes))
    when 'seance_section' then jsonb_build_array(v_rpe,
      public.custom_form_q('plaisir', 'As-tu pris du plaisir ?', 'scale', v_serie),
      public.custom_form_q('vie_perso', 'Ta vie personnelle te permet-elle de bien t’entraîner ?', 'scale', v_serie),
      public.custom_form_q('douleur', 'As-tu des douleurs ou des gênes physiques particulières ? (0 = aucune)', 'scale', v_douleur),
      public.custom_form_q('douleur_zone', 'Si oui, quel muscle ou quelle articulation ?', 'choice', v_zone))
    when 'match_espoirs' then jsonb_build_array(v_rpe,
      public.custom_form_q('fatigue', 'Fatigue générale', 'scale'),
      public.custom_form_q('jambes', 'T’es-tu senti dynamique, explosif, en jambes ?', 'scale', v_seuil),
      public.custom_form_q('technique', 'Ma maîtrise technique', 'scale'),
      public.custom_form_q('tactique', 'Ma maîtrise tactique', 'scale'),
      public.custom_form_q('comprehension_partenaires', 'As-tu bien réussi à te faire comprendre et à comprendre tes partenaires ?', 'scale'),
      public.custom_form_q('comprehension_staff', 'As-tu bien réussi à te faire comprendre et à comprendre le staff ?', 'scale'),
      public.custom_form_q('emotions', 'As-tu bien géré tes émotions ?', 'scale'),
      public.custom_form_q('plaisir', 'As-tu pris du plaisir ?', 'scale'),
      public.custom_form_q('vie_perso', 'Ta vie personnelle te permet-elle de bien performer ?', 'scale', v_seuil),
      public.custom_form_q('douleur', 'As-tu des douleurs ou des gênes physiques particulières ? (0 = aucune)', 'scale', v_douleur),
      public.custom_form_q('douleur_zone', 'Si oui, quel muscle ou quelle articulation ?', 'choice', v_zone))
    when 'match_section' then jsonb_build_array(v_rpe,
      public.custom_form_q('technique', 'Ma maîtrise technique', 'scale'),
      public.custom_form_q('tactique', 'Ma maîtrise tactique', 'scale'),
      public.custom_form_q('emotions', 'As-tu bien géré tes émotions ?', 'scale'),
      public.custom_form_q('plaisir', 'As-tu pris du plaisir ?', 'scale'),
      public.custom_form_q('vie_perso', 'Ta vie personnelle te permet-elle de bien performer ?', 'scale'),
      public.custom_form_q('douleur', 'As-tu des douleurs ou des gênes physiques particulières ? (0 = aucune)', 'scale', v_douleur),
      public.custom_form_q('douleur_zone', 'Si oui, quel muscle ou quelle articulation ?', 'choice', v_zone),
      public.custom_form_q('temps_post', 'Temps passé en salle de musculation après la séance (en minutes)', 'number', v_minutes))
  end;
end $$;

-- Les quatre formulaires d'un club : désactivés, sans équipe ; rien s'ils existent déjà.
create or replace function public.custom_forms_seed_questionnaires(p_club bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_form bigint; v_desc constant text := 'Questionnaire du club : choisissez les équipes puis activez-le.';
begin
  for r in select * from (values
    ('seance_n2', 'rpe_seance', 'Après séance — N2 et Espoirs'),
    ('seance_section', 'rpe_seance', 'Après séance — Section'),
    ('match_espoirs', 'rpe_match', 'Après match — Espoirs et réserve'),
    ('match_section', 'rpe_match', 'Après match — Section')) as t(kind, source, titre)
  loop
    continue when exists (select 1 from public.custom_forms f where f.club_id = p_club and f.source = r.source and f.titre = r.titre);
    insert into public.custom_forms (club_id, titre, description, actif, source) values (p_club, r.titre, v_desc, false, r.source)
    returning id into v_form;
    insert into public.custom_form_versions (form_id, version_no, titre, description, questions)
    values (v_form, 1, r.titre, v_desc, public.custom_form_questionnaire(r.kind));
  end loop;
end $$;

do $$
declare v_club bigint;
begin
  for v_club in select id from public.clubs loop perform public.custom_forms_seed_questionnaires(v_club); end loop;
end $$;

do $$
declare f text;
begin
  -- form_alerts_open() s'exécute avec les droits du compte (RLS) : ses deux aides doivent lui être ouvertes.
  foreach f in array array['form_alerts_open()', 'form_alert_seen(bigint, bigint, text, date)',
                           'form_alert_jour(text, timestamptz)', 'form_alert_num(jsonb, text, numeric)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array[
    'custom_form_q(text, text, text, jsonb)', 'custom_form_questionnaire(text)', 'custom_forms_seed_questionnaires(bigint)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

commit;
