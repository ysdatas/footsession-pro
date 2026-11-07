/* ============================================================
   LMFC Performance — lmfc_v47.sql : les questionnaires existants dans Formulaires
   À exécuter après lmfc_v45.sql. Rejouable et transactionnelle.

   Le RPE de séance, le RPE de match, les courbatures et l'avis de match
   deviennent des formulaires du club (custom_forms.source), créés pour chaque
   club et attribués à toutes ses équipes, avec leurs textes actuels : rien ne
   change pour les joueurs tant que personne ne les modifie.

   Leurs réponses restent où elles sont (session_rpe, match_rpe, player_soreness,
   match_feedback) : ni déplacées, ni recopiées, ni modifiées. Suivi RPE, charges,
   PDF et alertes les lisent comme avant.

   Ce qui se règle désormais dans Suivi RPE > Formulaires :
   - le nom et l'intitulé des questions, que le joueur voit à la saisie ;
   - les équipes : c'est l'équipe de la séance ou du match qui décide, une équipe
     décochée ne reçoit plus le formulaire (les réponses déjà données restent).
     Une équipe a au plus un formulaire de chaque sorte : l'attribuer à un autre
     l'y déplace (custom_form_team_single) ;
   - les questions ajoutées : posées dans « Mes formulaires » une fois la réponse
     d'origine donnée, une fois par séance, match ou jour (occurrence) ;
   - la copie (custom_form_duplicate), pour adapter un formulaire à une catégorie.

   Le type d'une question d'origine ne change pas, et celles dont dépendent le
   Suivi RPE et les alertes ne se retirent pas : la base le refuse
   (custom_form_version_guard). Une nouvelle équipe reçoit les formulaires
   d'origine, un nouveau club aussi : personne ne perd le RPE par oubli.

   La saisie (rpe_set, match_rpe_set, soreness_set, match_feedback_set) n'est pas
   touchée : ces fonctions continuent de décider du droit et du délai. Un
   formulaire retiré à une équipe n'est plus proposé, ce n'est pas un droit d'accès.

   Retour arrière : lmfc_v47_retour.sql. Il refuse de supprimer des réponses aux
   questions ajoutées ; les réglages (noms, équipes, copies) sont perdus.
   ============================================================ */
begin;

alter table public.custom_forms add column if not exists source text;
alter table public.custom_forms drop constraint if exists custom_forms_source_check;
alter table public.custom_forms add constraint custom_forms_source_check
  check (source in ('rpe_seance', 'rpe_match', 'courbatures', 'avis_match'));
create index if not exists custom_forms_source_idx on public.custom_forms (club_id, source) where source is not null;

-- Questions ajoutées : une réponse par séance (s12), match (m12) ou jour (j2026-11-06).
-- Vide pour les autres formulaires, qui gardent une réponse par version.
alter table public.custom_form_responses add column if not exists occurrence text not null default '';
alter table public.custom_form_responses drop constraint if exists custom_form_responses_form_version_id_player_id_key;
alter table public.custom_form_responses drop constraint if exists custom_form_responses_occurrence_key;
alter table public.custom_form_responses add constraint custom_form_responses_occurrence_key
  unique (form_version_id, player_id, occurrence);

-- Les textes actuels des quatre questionnaires. fixe : question d'origine, seul son
-- intitulé change ; retirable : l'avis de match peut n'en garder qu'une.
create or replace function public.custom_form_defaults(p_source text)
returns jsonb language sql immutable set search_path = public as $$
  select case p_source
    when 'rpe_seance' then $j${"titre": "Ton effort", "questions": [
      {"id": "rpe", "label": "Comment as-tu ressenti l’effort de toute la séance ?", "type": "scale", "min": 1, "max": 10, "required": true, "fixe": true}]}$j$::jsonb
    when 'rpe_match' then $j${"titre": "Ton effort", "questions": [
      {"id": "rpe", "label": "Comment as-tu ressenti l’effort de tout le match ?", "type": "scale", "min": 1, "max": 10, "required": true, "fixe": true}]}$j$::jsonb
    when 'courbatures' then $j${"titre": "Courbatures au réveil", "questions": [
      {"id": "niveau", "label": "Ton niveau de courbature au réveil (0 = aucune, 10 = très fortes) :", "type": "scale", "min": 0, "max": 10, "required": true, "fixe": true},
      {"id": "muscles", "label": "Quels muscles sont courbaturés ?", "type": "choice", "required": false, "fixe": true,
       "options": ["Ischio-jambiers", "Quadriceps", "Adducteurs", "Abducteurs", "Mollets", "Pectoraux", "Dorsaux", "Abdominaux", "Biceps", "Triceps"]}]}$j$::jsonb
    when 'avis_match' then $j${"titre": "Ton avis sur le match", "questions": [
      {"id": "individuel", "label": "Que penses-tu de ta performance individuelle lors de ce match ?", "type": "textarea", "required": false, "fixe": true, "retirable": true,
       "hint": "Ce que tu as bien fait, ce que tu aurais pu améliorer, ton ressenti."},
      {"id": "collectif", "label": "Que penses-tu de la performance collective de l’équipe lors de ce match ?", "type": "textarea", "required": false, "fixe": true, "retirable": true,
       "hint": "Le fonctionnement de l’équipe, le jeu collectif, les points positifs, ce qui est à améliorer."}]}$j$::jsonb
  end;
$$;

-- Toute version d'un formulaire d'origine, quel que soit le chemin d'écriture.
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
    elsif (v_new - 'label') is distinct from (v_old - 'label') then
      raise exception 'Seul l’intitulé de la question d’origine « % » peut changer.', v_old->>'label' using errcode = '22023';
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
drop trigger if exists custom_form_version_guard on public.custom_form_versions;
create trigger custom_form_version_guard before insert on public.custom_form_versions
  for each row execute function public.custom_form_version_guard();

-- Une équipe a au plus un formulaire de chaque sorte : l'attribuer l'y déplace.
create or replace function public.custom_form_team_single()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.custom_form_teams ft
   using public.custom_forms me, public.custom_forms autre
   where me.id = new.form_id and me.source is not null
     and autre.club_id = me.club_id and autre.source = me.source and autre.id <> me.id
     and ft.form_id = autre.id and ft.team_id = new.team_id;
  return new;
end $$;
drop trigger if exists custom_form_team_single on public.custom_form_teams;
create trigger custom_form_team_single before insert on public.custom_form_teams
  for each row execute function public.custom_form_team_single();

-- Les quatre formulaires d'un club, attribués à toutes ses équipes ; rien s'ils existent.
create or replace function public.custom_forms_seed(p_club bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_source text; v_base jsonb; v_form bigint;
begin
  foreach v_source in array array['rpe_seance', 'rpe_match', 'courbatures', 'avis_match'] loop
    continue when exists (select 1 from public.custom_forms f where f.club_id = p_club and f.source = v_source);
    v_base := public.custom_form_defaults(v_source);
    insert into public.custom_forms (club_id, titre, source) values (p_club, v_base->>'titre', v_source)
    returning id into v_form;
    insert into public.custom_form_versions (form_id, version_no, titre, questions)
    values (v_form, 1, v_base->>'titre', v_base->'questions');
    insert into public.custom_form_teams (form_id, team_id, club_id)
    select v_form, t.id, p_club from public.teams t where t.club_id = p_club;
  end loop;
end $$;

create or replace function public.custom_forms_new_club()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.custom_forms_seed(new.id);
  return new;
end $$;
drop trigger if exists custom_forms_new_club on public.clubs;
create trigger custom_forms_new_club after insert on public.clubs
  for each row execute function public.custom_forms_new_club();

-- Une nouvelle équipe, ou une équipe restaurée, reçoit le formulaire le plus ancien de chaque sorte.
create or replace function public.custom_forms_new_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.custom_form_teams (form_id, team_id, club_id)
  select distinct on (f.source) f.id, new.id, new.club_id
    from public.custom_forms f
   where f.club_id = new.club_id and f.source is not null
   order by f.source, f.actif desc, f.id;
  return new;
end $$;
drop trigger if exists custom_forms_new_team on public.teams;
create trigger custom_forms_new_team after insert on public.teams
  for each row execute function public.custom_forms_new_team();

do $$
declare v_club bigint;
begin
  for v_club in select id from public.clubs loop perform public.custom_forms_seed(v_club); end loop;
end $$;

-- Le formulaire d'une sorte pour une équipe, dans sa dernière version. Sans équipe
-- (séance du club) : le plus ancien formulaire actif de cette sorte.
create or replace function public.custom_form_for(p_source text, p_club bigint, p_team bigint)
returns table (form_id bigint, version_id bigint, version_no integer, titre text, description text, questions jsonb)
language sql stable security definer set search_path = public as $$
  select f.id, v.id, v.version_no, v.titre, v.description, v.questions
    from public.custom_forms f
    join lateral (select x.id, x.version_no, x.titre, x.description, x.questions
                    from public.custom_form_versions x where x.form_id = f.id
                   order by x.version_no desc limit 1) v on true
   where f.club_id = p_club and f.source = p_source and f.actif
     and (p_team is null or exists (select 1 from public.custom_form_teams ft where ft.form_id = f.id and ft.team_id = p_team))
   order by f.id limit 1;
$$;

-- Séances et matchs à noter, comme avant, si leur équipe reçoit le formulaire, avec ses textes.
drop function if exists public.my_rpe_sessions();
create function public.my_rpe_sessions()
returns table (session_id bigint, date_seance date, heure time, titre text, rpe smallint, corrige boolean, form_titre text, form_questions jsonb)
language sql stable security definer set search_path = public as $$
  select s.id, s.date_seance, s.heure, s.titre, r.rpe, r.corrige_par is not null, c.titre, c.questions
    from public.players p
    join public.sessions s on s.club_id = p.club_id and public.rpe_open(s.date_seance)
    cross join lateral public.custom_form_for('rpe_seance', s.club_id, s.team_id) c
    left join public.session_rpe r on r.session_id = s.id and r.player_id = p.id
   where p.auth_user_id = auth.uid() and public.has_role('joueur') and public.player_session_ok(p.id, s.id)
   order by s.date_seance desc, s.heure desc nulls last;
$$;

drop function if exists public.my_rpe_matches();
create function public.my_rpe_matches()
returns table (match_id bigint, date_seance date, heure time, titre text, rpe smallint, corrige boolean, form_titre text, form_questions jsonb)
language sql stable security definer set search_path = public as $$
  select m.id, m.date_match, m.heure, 'Match contre ' || m.adversaire, r.rpe, r.corrige_par is not null, c.titre, c.questions
    from public.players p
    join public.matches m on m.club_id = p.club_id and public.rpe_open(m.date_match)
    cross join lateral public.custom_form_for('rpe_match', m.club_id, m.team_id) c
    left join public.match_rpe r on r.match_id = m.id and r.player_id = p.id
   where p.auth_user_id = auth.uid() and public.has_role('joueur') and public.player_match_rpe_ok(p.id, m.id)
   order by m.date_match desc, m.heure desc nulls last;
$$;

drop function if exists public.my_soreness_today();
create function public.my_soreness_today()
returns table (session_id bigint, titre text, heure time, niveau smallint, muscles text[], form_titre text, form_questions jsonb)
language sql stable security definer set search_path = public as $$
  select s.id, s.titre, s.heure, ps.niveau, ps.muscles, s.form_titre, s.form_questions
    from public.players p
    join lateral (select x.id, x.titre, x.heure, c.titre form_titre, c.questions form_questions
                    from public.sessions x
                    cross join lateral public.custom_form_for('courbatures', x.club_id, x.team_id) c
                   where x.club_id = p.club_id and x.date_seance = current_date and public.player_session_ok(p.id, x.id)
                   order by x.heure nulls last limit 1) s on true
    left join public.player_soreness ps on ps.player_id = p.id and ps.jour = current_date
   where p.auth_user_id = auth.uid() and public.has_role('joueur')
   limit 1;
$$;

-- Matchs de l'accueil : ceux joués ces 30 jours dont l'équipe reçoit l'avis.
create or replace function public.my_avis_matches()
returns table (match_id bigint, date_match date, titre text, form_titre text, form_questions jsonb)
language sql stable security definer set search_path = public as $$
  select m.id, m.date_match, m.adversaire, c.titre, c.questions
    from public.players p
    join public.matches m on m.club_id = p.club_id and m.date_match between current_date - 30 and current_date
    cross join lateral public.custom_form_for('avis_match', m.club_id, m.team_id) c
   where p.auth_user_id = auth.uid() and public.has_role('joueur') and public.player_match_ok(p.id, m.id)
   order by m.date_match desc, m.heure desc nulls last;
$$;

-- Fiche du calendrier : les formulaires proposés au joueur pour cette séance ou ce match.
create or replace function public.my_event_forms(p_kind text, p_id bigint)
returns table (source text, titre text, questions jsonb)
language sql stable security definer set search_path = public as $$
  select e.source, c.titre, c.questions
    from public.players p
    join lateral (
      select 'rpe_seance'::text source, s.club_id, s.team_id from public.sessions s
       where p_kind = 'seance' and s.id = p_id and public.player_session_ok(p.id, s.id)
      union all
      select sorte, m.club_id, m.team_id from public.matches m, unnest(array['rpe_match', 'avis_match']) sorte
       where p_kind = 'match' and m.id = p_id and public.player_match_ok(p.id, m.id)
    ) e on e.club_id = p.club_id
    cross join lateral public.custom_form_for(e.source, e.club_id, e.team_id) c
   where p.auth_user_id = auth.uid() and public.has_role('joueur');
$$;

-- Accueil : les sortes de formulaires que reçoivent les équipes du joueur.
create or replace function public.my_form_sources()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct f.source), '{}')
    from public.players p
    join public.custom_form_teams ft on ft.club_id = p.club_id
     and (ft.team_id = p.team_id or ft.team_id = any(coalesce(p.other_team_ids, '{}')))
    join public.custom_forms f on f.id = ft.form_id and f.actif and f.source is not null
   where p.auth_user_id = auth.uid() and public.has_role('joueur');
$$;

-- Copie pour adapter un formulaire à une catégorie : désactivée, sans équipe, de la
-- même sorte. Lui attribuer une équipe la retire de l'ancien formulaire.
create or replace function public.custom_form_duplicate(p_form bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_club bigint; v_source text; v_version public.custom_form_versions%rowtype; v_title text; v_new bigint;
begin
  if not public.has_role('admin', 'prepa') or not public.custom_form_can_read(p_form) then
    raise exception 'Formulaire introuvable ou hors de votre périmètre.' using errcode = '42501';
  end if;
  select f.club_id, f.source into v_club, v_source from public.custom_forms f where f.id = p_form;
  select * into v_version from public.custom_form_versions v where v.form_id = p_form order by v.version_no desc limit 1;
  v_title := left(v_version.titre, 92) || ' (copie)';
  insert into public.custom_forms (club_id, titre, description, actif, created_by, source)
  values (v_club, v_title, v_version.description, false, auth.uid(), v_source)
  returning id into v_new;
  insert into public.custom_form_versions (form_id, version_no, titre, description, questions, created_by)
  values (v_new, 1, v_title, v_version.description, v_version.questions, auth.uid());
  return jsonb_build_object('id', v_new);
end $$;

-- Liste à remplir : les formulaires libres comme avant, puis les questions ajoutées aux
-- formulaires d'origine, une fois la réponse d'origine donnée.
drop function if exists public.custom_form_submit(bigint, jsonb);
drop function if exists public.custom_forms_my_pending();
create function public.custom_forms_my_pending()
returns table (
  form_id bigint, version_id bigint, version_no integer, titre text,
  description text, questions jsonb, team_id bigint, team_nom text, occurrence text
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
           concat_ws(' · ', s.titre, to_char(s.date_seance, 'DD/MM/YYYY')) contexte
      from moi join public.session_rpe r on r.player_id = moi.id
      join public.sessions s on s.id = r.session_id and public.rpe_open(s.date_seance)
    union all
    select 'rpe_match', 'm' || m.id, m.team_id,
           concat_ws(' · ', 'Match contre ' || m.adversaire, to_char(m.date_match, 'DD/MM/YYYY'))
      from moi join public.match_rpe r on r.player_id = moi.id
      join public.matches m on m.id = r.match_id and public.rpe_open(m.date_match)
    union all
    select 'courbatures', 'j' || ps.jour, s.team_id, to_char(ps.jour, 'DD/MM/YYYY')
      from moi join public.player_soreness ps on ps.player_id = moi.id and ps.jour = current_date
      left join public.sessions s on s.id = ps.session_id
    union all
    select 'avis_match', 'm' || m.id, m.team_id,
           concat_ws(' · ', 'Match contre ' || m.adversaire, to_char(m.date_match, 'DD/MM/YYYY'))
      from moi join public.match_feedback fb on fb.player_id = moi.id
      join public.matches m on m.id = fb.match_id and public.rpe_open(m.date_match)
  )
  select x.form_id, x.version_id, x.version_no, x.titre, x.description, x.questions, x.team_id, x.team_nom, x.occurrence
    from (
      select f.id form_id, v.id version_id, v.version_no, v.titre, v.description, v.questions,
             affectation.team_id, t.nom team_nom, ''::text occurrence, f.updated_at tri
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
             coalesce(e.team_id, moi.team_id), coalesce(t.nom, 'Sans équipe'), e.occurrence, null
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
   order by x.tri desc nulls last, x.titre;
$$;

-- Comme lmfc_v45.sql ; p_occurrence désigne la séance, le match ou le jour des questions ajoutées.
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
      if jsonb_typeof(v_answer) is distinct from 'number' then
        raise exception 'Réponse numérique attendue pour « % ».', (v_question->>'label') using errcode = '22023';
      end if;
      v_numeric := (v_answer #>> '{}')::numeric;
      if v_type = 'scale' and (
        trunc(v_numeric) <> v_numeric
        or v_numeric < coalesce((v_question->>'min')::numeric, 1)
        or v_numeric > coalesce((v_question->>'max')::numeric, 10)
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

do $$
declare f text;
begin
  foreach f in array array[
    'my_rpe_sessions()', 'my_rpe_matches()', 'my_soreness_today()', 'my_avis_matches()', 'my_event_forms(text, bigint)', 'my_form_sources()',
    'custom_form_duplicate(bigint)', 'custom_forms_my_pending()', 'custom_form_submit(bigint, jsonb, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- Internes : les fonctions ci-dessus décident pour le compte connecté.
  foreach f in array array[
    'custom_form_for(text, bigint, bigint)', 'custom_form_defaults(text)', 'custom_forms_seed(bigint)',
    'custom_form_version_guard()', 'custom_form_team_single()', 'custom_forms_new_club()', 'custom_forms_new_team()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

commit;
