/* ============================================================
   LMFC Performance — lmfc_v63.sql : formulaires plus fiables et plus libres
   À exécuter après lmfc_v62.sql. Rejouable et transactionnelle.

   1. Réponses : custom_form_submit() reconnaît un nombre envoyé en texte (« 8 » devient 8
      pour une question Nombre ou Échelle ; « Non » reste refusé) et « true » / « false »
      pour Oui / non ; une liste laissée vide compte comme sans réponse. Avant, une échelle
      choisie dans une liste arrivait en texte et la réponse était refusée (« Réponse
      numérique attendue »).
   2. Échelles personnalisées : une question Échelle peut porter « niveaux », une liste de
      2 à 11 niveaux { valeur (entier de 0 à 10), libelle, couleur (#rrggbb ou rien) }.
      La réponse doit être l'une de ces valeurs : la valeur reste un nombre pour les calculs.
      La question d'origine (RPE) peut changer ses niveaux, pas ses bornes.
   3. Mes formulaires : custom_forms_my_pending() rend le jour de la séance, du match ou des
      courbatures (« jour ») et trie du plus récent au plus ancien.
   4. Supprimer un formulaire : custom_form_delete(). Sans réponse, il est effacé ; avec des
      réponses, ou s'il s'agit d'un formulaire d'origine du club, il est archivé (archive_le),
      retiré des équipes et désactivé : aucune réponse n'est jamais effacée.
   5. Le texte destiné au staff (« choisissez les équipes puis activez-le ») des quatre
      questionnaires de lmfc_v62.sql n'est plus montré aux joueurs.
   Retour arrière : lmfc_v63_retour.sql.
   ============================================================ */
begin;

alter table public.custom_forms add column if not exists archive_le timestamptz;

-- Un formulaire archivé ne se réactive pas.
create or replace function public.custom_form_archive_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.archive_le is not null and new.actif then
    raise exception 'Ce formulaire a été supprimé : il ne se réactive pas.' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists custom_form_archive_guard on public.custom_forms;
create trigger custom_form_archive_guard before update on public.custom_forms
  for each row execute function public.custom_form_archive_guard();

-- Les niveaux d'une échelle : de 2 à 11, valeurs entières distinctes dans les bornes de la question.
create or replace function public.custom_form_version_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare q jsonb; n jsonb; v_count integer; v_distinct integer;
begin
  for q in select value from jsonb_array_elements(new.questions) loop
    continue when not (q ? 'niveaux');
    if q->>'type' is distinct from 'scale' or jsonb_typeof(q->'niveaux') is distinct from 'array'
       or jsonb_array_length(q->'niveaux') not between 2 and 11 then
      raise exception 'Les niveaux de « % » sont invalides : une échelle a de 2 à 11 niveaux.', q->>'label' using errcode = '22023';
    end if;
    for n in select value from jsonb_array_elements(q->'niveaux') loop
      if jsonb_typeof(n) is distinct from 'object' or jsonb_typeof(n->'valeur') is distinct from 'number'
         or (n->>'valeur')::numeric <> trunc((n->>'valeur')::numeric)
         or (n->>'valeur')::numeric < coalesce((q->>'min')::numeric, 1)
         or (n->>'valeur')::numeric > coalesce((q->>'max')::numeric, 10)
         or jsonb_typeof(n->'libelle') is distinct from 'string' or char_length(n->>'libelle') > 60
         or (coalesce(n->'couleur', 'null'::jsonb) <> 'null'::jsonb and coalesce(n->>'couleur', '') !~ '^#[0-9a-fA-F]{6}$') then
        raise exception 'Un niveau de « % » est invalide (valeur entière dans les bornes, libellé de 60 caractères au plus, couleur #rrggbb).', q->>'label' using errcode = '22023';
      end if;
    end loop;
    select count(*)::integer, count(distinct (value->>'valeur')::numeric)::integer into v_count, v_distinct
      from jsonb_array_elements(q->'niveaux');
    if v_count <> v_distinct then
      raise exception 'Deux niveaux de « % » ont la même valeur.', q->>'label' using errcode = '22023';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists custom_form_version_check on public.custom_form_versions;
create trigger custom_form_version_check before insert on public.custom_form_versions
  for each row execute function public.custom_form_version_check();

-- Question d'origine : son intitulé et ses niveaux changent, rien d'autre (lmfc_v47.sql).
create or replace function public.custom_form_version_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_source text; v_base jsonb; v_old jsonb; v_new jsonb;
begin
  select f.source into v_source from public.custom_forms f where f.id = new.form_id;
  if v_source is null then return new; end if;
  v_base := public.custom_form_defaults(v_source)->'questions';
  for v_old in select value from jsonb_array_elements(v_base) loop
    v_new := null;
    select q.value into v_new from jsonb_array_elements(new.questions) q where q.value->>'id' = v_old->>'id';
    if v_new is null then
      if not coalesce((v_old->>'retirable')::boolean, false) then
        raise exception 'La question d’origine « % » ne se retire pas : le suivi en dépend. Désactivez plutôt le formulaire.', v_old->>'label' using errcode = '22023';
      end if;
    elsif (v_new - 'label' - 'niveaux') is distinct from (v_old - 'label') then
      raise exception 'Seuls l’intitulé et les niveaux de la question d’origine « % » peuvent changer.', v_old->>'label' using errcode = '22023';
    end if;
  end loop;
  if not exists (select 1 from jsonb_array_elements(new.questions) q, jsonb_array_elements(v_base) b where q.value->>'id' = b.value->>'id') then
    raise exception 'Gardez au moins une question d’origine.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(new.questions) q
              where q.value ? 'fixe' and not exists (select 1 from jsonb_array_elements(v_base) b where b.value->>'id' = q.value->>'id')) then
    raise exception 'Une question ajoutée ne peut pas être marquée comme question d’origine.' using errcode = '22023';
  end if;
  return new;
end $$;

-- Une nouvelle équipe ne reçoit pas un formulaire supprimé (lmfc_v47.sql).
create or replace function public.custom_forms_new_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.custom_form_teams (form_id, team_id, club_id)
  select distinct on (f.source) f.id, new.id, new.club_id
    from public.custom_forms f
   where f.club_id = new.club_id and f.source is not null and f.archive_le is null
   order by f.source, f.actif desc, f.id;
  return new;
end $$;

-- Mes formulaires : le jour de chaque questionnaire, du plus récent au plus ancien (lmfc_v47.sql).
drop function if exists public.custom_forms_my_pending();
create function public.custom_forms_my_pending()
returns table (
  form_id bigint, version_id bigint, version_no integer, titre text,
  description text, questions jsonb, team_id bigint, team_nom text, occurrence text, jour date
)
language sql stable security definer set search_path = public as $$
  with moi as (
    select p.id, p.club_id, p.team_id, coalesce(p.other_team_ids, '{}') other_team_ids
      from public.players p
     where p.auth_user_id = auth.uid() and p.club_id = public.my_club_id()
       and public.has_role('joueur')
     order by p.id limit 1
  ),
  reponses as (
    select 'rpe_seance' source, 's' || s.id occurrence, s.team_id,
           concat_ws(' · ', s.titre, to_char(s.date_seance, 'DD/MM/YYYY')) contexte, s.date_seance jour
      from moi join public.session_rpe r on r.player_id = moi.id
      join public.sessions s on s.id = r.session_id and public.rpe_open(s.date_seance)
    union all
    select 'rpe_match', 'm' || m.id, m.team_id,
           concat_ws(' · ', 'Match contre ' || m.adversaire, to_char(m.date_match, 'DD/MM/YYYY')), m.date_match
      from moi join public.match_rpe r on r.player_id = moi.id
      join public.matches m on m.id = r.match_id and public.rpe_open(m.date_match)
    union all
    select 'courbatures', 'j' || ps.jour, s.team_id, to_char(ps.jour, 'DD/MM/YYYY'), ps.jour
      from moi join public.player_soreness ps on ps.player_id = moi.id and ps.jour = current_date
      left join public.sessions s on s.id = ps.session_id
    union all
    select 'avis_match', 'm' || m.id, m.team_id,
           concat_ws(' · ', 'Match contre ' || m.adversaire, to_char(m.date_match, 'DD/MM/YYYY')), m.date_match
      from moi join public.match_feedback fb on fb.player_id = moi.id
      join public.matches m on m.id = fb.match_id and public.rpe_open(m.date_match)
  )
  select x.form_id, x.version_id, x.version_no, x.titre, x.description, x.questions, x.team_id, x.team_nom, x.occurrence, x.jour
    from (
      select f.id form_id, v.id version_id, v.version_no, v.titre, v.description, v.questions,
             affectation.team_id, t.nom team_nom, ''::text occurrence, null::date jour, f.updated_at tri
        from moi
        join public.custom_forms f on f.club_id = moi.club_id and f.actif and f.source is null
        join lateral (
          select ft.team_id from public.custom_form_teams ft
           where ft.form_id = f.id and ft.club_id = moi.club_id
             and (ft.team_id = moi.team_id or ft.team_id = any(moi.other_team_ids))
           order by case when ft.team_id = moi.team_id then 0 else 1 end, ft.team_id
           limit 1
        ) affectation on true
        join public.teams t on t.id = affectation.team_id
        join lateral (
          select fv.id, fv.version_no, fv.titre, fv.description, fv.questions
            from public.custom_form_versions fv where fv.form_id = f.id
           order by fv.version_no desc limit 1
        ) v on true
       where not exists (select 1 from public.custom_form_responses r
                         where r.form_id = f.id and r.player_id = moi.id and r.questions_snapshot = v.questions)
      union all
      select c.form_id, c.version_id, c.version_no, concat_ws(' · ', c.titre, e.contexte), c.description, ajout.questions,
             coalesce(e.team_id, moi.team_id), coalesce(t.nom, 'Sans équipe'), e.occurrence, e.jour, null
        from moi
        cross join reponses e
        cross join lateral public.custom_form_for(e.source, moi.club_id, e.team_id) c
        cross join lateral (select jsonb_agg(q.value order by q.ordinality) questions
                              from jsonb_array_elements(c.questions) with ordinality q
                             where not coalesce((q.value->>'fixe')::boolean, false)) ajout
        left join public.teams t on t.id = coalesce(e.team_id, moi.team_id)
       where ajout.questions is not null
         and not exists (select 1 from public.custom_form_responses r
                         where r.form_id = c.form_id and r.player_id = moi.id and r.occurrence = e.occurrence)
    ) x
   order by x.jour desc nulls first, x.tri desc nulls last, x.titre;
$$;

-- Comme lmfc_v47.sql ; un nombre envoyé en texte est reconnu, les niveaux d'une échelle sont vérifiés.
create or replace function public.custom_form_submit(p_version_id bigint, p_answers jsonb, p_occurrence text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_player public.players%rowtype;
  v_form_id bigint;
  v_club bigint;
  v_team bigint;
  v_team_name text;
  v_form_active boolean;
  v_source text;
  v_form_title text;
  v_version integer;
  v_questions jsonb;
  v_current_version bigint;
  v_question jsonb;
  v_question_id text;
  v_type text;
  v_answer jsonb;
  v_numeric numeric;
  v_max_length integer;
  v_clean_answers jsonb := '{}'::jsonb;
  v_response bigint;
  v_submitted timestamptz;
  v_player_name text;
begin
  if v_uid is null or not public.has_role('joueur') then
    raise exception 'Réponse réservée aux joueurs.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Réponses invalides.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_answers)) > 30 then
    raise exception 'Réponses invalides.' using errcode = '22023';
  end if;

  select * into v_player from public.players p
   where p.auth_user_id = v_uid and p.club_id = public.my_club_id()
   order by p.id limit 1 for share;
  if v_player.id is null then raise exception 'Fiche joueur introuvable.' using errcode = '42501'; end if;

  select f.id, f.club_id, f.actif, f.source, v.titre, v.version_no, v.questions
    into v_form_id, v_club, v_form_active, v_source, v_form_title, v_version, v_questions
    from public.custom_form_versions v
    join public.custom_forms f on f.id = v.form_id
   where v.id = p_version_id and f.club_id = v_player.club_id
   for share of f;
  if not found or not v_form_active then
    raise exception 'Ce formulaire n’est plus disponible.' using errcode = '42501';
  end if;

  select v.id into v_current_version from public.custom_form_versions v
   where v.form_id = v_form_id order by v.version_no desc limit 1;
  if v_current_version is distinct from p_version_id then
    raise exception 'Le formulaire a changé. Recharge la page pour voir sa version actuelle.' using errcode = '40001';
  end if;

  if v_source is not null then
    -- Questions ajoutées à un formulaire d'origine : la liste du joueur décide de
    -- la séance, du match ou du jour, de l'équipe et de ce qu'il reste à poser.
    select x.titre, x.questions, x.team_id, x.team_nom
      into v_form_title, v_questions, v_team, v_team_name
      from public.custom_forms_my_pending() x
     where x.version_id = p_version_id and x.occurrence = coalesce(p_occurrence, '');
    if not found then raise exception 'Ce questionnaire n’est plus à remplir.' using errcode = '42501'; end if;
  else
    if coalesce(p_occurrence, '') <> '' then raise exception 'Réponses invalides.' using errcode = '22023'; end if;
    if exists (select 1 from public.custom_form_responses r
                where r.form_id = v_form_id and r.player_id = v_player.id and r.questions_snapshot = v_questions) then
      raise exception 'Tu as déjà répondu à cette version du formulaire.' using errcode = '23505';
    end if;

    select ft.team_id, t.nom into v_team, v_team_name
      from public.custom_form_teams ft
      join public.teams t on t.id = ft.team_id and t.club_id = v_player.club_id
     where ft.form_id = v_form_id and ft.club_id = v_player.club_id
       and (ft.team_id = v_player.team_id or ft.team_id = any(coalesce(v_player.other_team_ids, '{}')))
     order by case when ft.team_id = v_player.team_id then 0 else 1 end, ft.team_id
     limit 1;
    if v_team is null then raise exception 'Ce formulaire ne concerne pas tes équipes.' using errcode = '42501'; end if;
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_answers) as answer_key(key)
    where not exists (select 1 from jsonb_array_elements(v_questions) as question(value)
                      where question.value->>'id' = answer_key.key)
  ) then
    raise exception 'La réponse contient une question inconnue.' using errcode = '22023';
  end if;

  for v_question in select value from jsonb_array_elements(v_questions) as question(value) loop
    v_question_id := v_question->>'id';
    v_type := v_question->>'type';
    v_answer := p_answers->v_question_id;
    -- Une liste ou un champ laissé vide envoie « » : sans réponse, sauf pour un texte (traité plus bas).
    if v_type not in ('text', 'textarea') and v_answer = '""'::jsonb then v_answer := null; end if;
    if v_answer is null or v_answer = 'null'::jsonb then
      if coalesce((v_question->>'required')::boolean, false) then
        raise exception 'Réponds à « % ».', (v_question->>'label') using errcode = '22023';
      end if;
      continue;
    end if;

    if v_type in ('text', 'textarea') then
      if jsonb_typeof(v_answer) is distinct from 'string' then
        raise exception 'Réponse invalide pour « % ».', (v_question->>'label') using errcode = '22023';
      end if;
      v_answer := to_jsonb(btrim(v_answer #>> '{}'));
      if v_answer = '""'::jsonb then
        if coalesce((v_question->>'required')::boolean, false) then
          raise exception 'Réponds à « % ».', (v_question->>'label') using errcode = '22023';
        end if;
        continue;
      end if;
      v_max_length := case when v_type = 'textarea' then 2000 else 200 end;
      if char_length(v_answer #>> '{}') > v_max_length then
        raise exception 'Réponse trop longue pour « % ».', (v_question->>'label') using errcode = '22023';
      end if;
    elsif v_type in ('number', 'scale') then
      -- Un nombre écrit en texte (« 8 », « 7,5 ») est ce nombre ; un autre texte (« Non ») reste refusé.
      if jsonb_typeof(v_answer) = 'string' and btrim(v_answer #>> '{}') ~ '^-?[0-9]{1,6}([.,][0-9]{1,4})?$' then
        v_answer := to_jsonb(replace(btrim(v_answer #>> '{}'), ',', '.')::numeric);
      end if;
      if jsonb_typeof(v_answer) is distinct from 'number' then
        raise exception 'Réponse numérique attendue pour « % ».', (v_question->>'label') using errcode = '22023';
      end if;
      v_numeric := (v_answer #>> '{}')::numeric;
      -- Une échelle à niveaux n'accepte que leurs valeurs ; sinon un entier entre ses bornes.
      if v_type = 'scale' and (
        trunc(v_numeric) <> v_numeric
        or v_numeric < coalesce((v_question->>'min')::numeric, 1)
        or v_numeric > coalesce((v_question->>'max')::numeric, 10)
        or (jsonb_typeof(v_question->'niveaux') = 'array' and not exists (
              select 1 from jsonb_array_elements(v_question->'niveaux') n(value) where (n.value->>'valeur')::numeric = v_numeric))
      ) then
        raise exception 'Valeur hors échelle pour « % ».', (v_question->>'label') using errcode = '22023';
      end if;
    elsif v_type = 'choice' then
      if jsonb_typeof(v_answer) is distinct from 'string'
         or not exists (select 1 from jsonb_array_elements_text(v_question->'options') as option(value)
                        where option.value = v_answer #>> '{}') then
        raise exception 'Choix invalide pour « % ».', (v_question->>'label') using errcode = '22023';
      end if;
    elsif v_type = 'boolean' then
      if v_answer in ('"true"'::jsonb, '"false"'::jsonb) then v_answer := to_jsonb((v_answer #>> '{}')::boolean); end if;
      if jsonb_typeof(v_answer) is distinct from 'boolean' then
        raise exception 'Réponds par oui ou non à « % ».', (v_question->>'label') using errcode = '22023';
      end if;
    else
      raise exception 'Type de question non pris en charge.' using errcode = '22023';
    end if;
    v_clean_answers := v_clean_answers || jsonb_build_object(v_question_id, v_answer);
  end loop;

  v_player_name := coalesce(nullif(btrim(concat_ws(' ', v_player.prenom, v_player.nom)), ''), 'Joueur');
  insert into public.custom_form_responses (
    club_id, form_id, form_version_id, version_no, player_id, player_name_snapshot,
    team_id, team_name_snapshot, form_title_snapshot, questions_snapshot, answers, occurrence
  ) values (
    v_club, v_form_id, p_version_id, v_version, v_player.id, v_player_name,
    v_team, v_team_name, v_form_title, v_questions, v_clean_answers, coalesce(p_occurrence, '')
  ) on conflict (form_version_id, player_id, occurrence) do nothing
  returning id, submitted_at into v_response, v_submitted;
  if v_response is null then
    raise exception 'Tu as déjà répondu à cette version du formulaire.' using errcode = '23505';
  end if;
  return jsonb_build_object('response_id', v_response, 'submitted_at', v_submitted);
end;
$$;

-- Supprimer un formulaire : effacé s'il n'a aucune réponse, sinon archivé. Mêmes droits que
-- custom_form_save() ; un formulaire d'origine du club (sans auteur) : administrateur seulement,
-- et toujours archivé (lmfc_v47.sql le recréerait sinon à la prochaine équipe).
create or replace function public.custom_form_delete(p_form bigint)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_club bigint := public.my_club_id();
  v_role text;
  v_form public.custom_forms%rowtype;
begin
  select role into v_role from public.profiles where id = auth.uid() and club_id = v_club;
  if auth.uid() is null or v_club is null or coalesce(v_role, '') not in ('admin', 'prepa') then
    raise exception 'La gestion des formulaires est réservée aux administrateurs et préparateurs physiques.' using errcode = '42501';
  end if;
  select * into v_form from public.custom_forms f where f.id = p_form and f.club_id = v_club for update;
  if not found or not public.custom_form_can_read(p_form) then
    raise exception 'Formulaire introuvable ou hors de votre périmètre.' using errcode = '42501';
  end if;
  if exists (select 1 from public.custom_form_teams ft
              where ft.form_id = p_form and not public.custom_form_can_manage_team(ft.team_id))
     or (v_form.source is not null and v_form.created_by is null and v_role <> 'admin') then
    raise exception 'Seul un administrateur peut supprimer ce formulaire.' using errcode = '42501';
  end if;
  delete from public.custom_form_teams where form_id = p_form;
  if (v_form.source is not null and v_form.created_by is null)
     or exists (select 1 from public.custom_form_responses r where r.form_id = p_form) then
    update public.custom_forms set actif = false, archive_le = coalesce(archive_le, now()), updated_at = now()
     where id = p_form;
    return 'archive';
  end if;
  delete from public.custom_form_versions where form_id = p_form;
  delete from public.custom_forms where id = p_form;
  return 'supprime';
end $$;

-- Le texte de réglage de lmfc_v62.sql était destiné au staff, pas aux joueurs.
update public.custom_forms set description = null
 where description = 'Questionnaire du club : choisissez les équipes puis activez-le.';
update public.custom_form_versions set description = null
 where description = 'Questionnaire du club : choisissez les équipes puis activez-le.';

do $$
declare f text;
begin
  foreach f in array array['custom_forms_my_pending()', 'custom_form_submit(bigint, jsonb, text)', 'custom_form_delete(bigint)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['custom_form_archive_guard()', 'custom_form_version_check()', 'custom_form_version_guard()', 'custom_forms_new_team()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

commit;
