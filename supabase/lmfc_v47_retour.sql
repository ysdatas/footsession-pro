/* Retour arrière de lmfc_v47.sql. Rejouable.
   Refusé si un joueur a répondu à une question ajoutée à un formulaire d'origine :
   ses réponses seraient perdues. Les réglages faits dans Formulaires (noms, équipes,
   copies des formulaires d'origine) disparaissent : les quatre questionnaires
   redeviennent identiques pour tout le club. Leurs réponses (session_rpe, match_rpe,
   player_soreness, match_feedback) n'ont jamais bougé. */
begin;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'custom_forms' and column_name = 'source') then
    if exists (select 1 from public.custom_form_responses where occurrence <> '')
       or exists (select 1 from public.trash where tbl = 'custom_form_responses' and coalesce(data->>'occurrence', '') <> '') then
      raise exception 'Retour arrière refusé : des joueurs ont répondu à des questions ajoutées aux formulaires d’origine.';
    end if;
    delete from public.custom_form_teams ft using public.custom_forms f where f.id = ft.form_id and f.source is not null;
    delete from public.custom_form_versions v using public.custom_forms f where f.id = v.form_id and f.source is not null;
    delete from public.custom_forms where source is not null;
  end if;
end $$;

drop trigger if exists custom_form_version_guard on public.custom_form_versions;
drop trigger if exists custom_form_team_single on public.custom_form_teams;
drop trigger if exists custom_forms_new_club on public.clubs;
drop trigger if exists custom_forms_new_team on public.teams;

drop function if exists public.custom_form_submit(bigint, jsonb, text);
drop function if exists public.custom_forms_my_pending();
drop function if exists public.custom_form_duplicate(bigint);
drop function if exists public.my_form_sources();
drop function if exists public.my_event_forms(text, bigint);
drop function if exists public.my_avis_matches();
drop function if exists public.my_soreness_today();
drop function if exists public.my_rpe_matches();
drop function if exists public.my_rpe_sessions();
drop function if exists public.custom_form_for(text, bigint, bigint);
drop function if exists public.custom_forms_new_team();
drop function if exists public.custom_forms_new_club();
drop function if exists public.custom_forms_seed(bigint);
drop function if exists public.custom_form_team_single();
drop function if exists public.custom_form_version_guard();
drop function if exists public.custom_form_defaults(text);

alter table public.custom_form_responses drop constraint if exists custom_form_responses_occurrence_key;
alter table public.custom_form_responses drop constraint if exists custom_form_responses_form_version_id_player_id_key;
alter table public.custom_form_responses add constraint custom_form_responses_form_version_id_player_id_key
  unique (form_version_id, player_id);
alter table public.custom_form_responses drop column if exists occurrence;

drop index if exists public.custom_forms_source_idx;
alter table public.custom_forms drop constraint if exists custom_forms_source_check;
alter table public.custom_forms drop column if exists source;

-- lmfc_v29.sql
create or replace function public.my_rpe_sessions()
returns table (session_id bigint, date_seance date, heure time, titre text, rpe smallint, corrige boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.date_seance, s.heure, s.titre, r.rpe, r.corrige_par is not null
    from public.players p
    join public.sessions s on s.club_id = p.club_id and public.rpe_open(s.date_seance)
    left join public.session_rpe r on r.session_id = s.id and r.player_id = p.id
   where p.auth_user_id = auth.uid() and public.has_role('joueur') and public.player_session_ok(p.id, s.id)
   order by s.date_seance desc, s.heure desc nulls last;
$$;

-- lmfc_v38.sql
create or replace function public.my_rpe_matches()
returns table (match_id bigint, date_seance date, heure time, titre text, rpe smallint, corrige boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.date_match, m.heure, 'Match contre ' || m.adversaire, r.rpe, r.corrige_par is not null
    from public.players p
    join public.matches m on m.club_id = p.club_id and public.rpe_open(m.date_match)
    left join public.match_rpe r on r.match_id = m.id and r.player_id = p.id
   where p.auth_user_id = auth.uid() and public.has_role('joueur') and public.player_match_rpe_ok(p.id, m.id)
   order by m.date_match desc, m.heure desc nulls last;
$$;

-- lmfc_v35.sql
create or replace function public.my_soreness_today()
returns table (session_id bigint, titre text, heure time, niveau smallint, muscles text[])
language sql stable security definer set search_path = public as $$
  select s.id, s.titre, s.heure, ps.niveau, ps.muscles
    from public.players p
    join lateral (select x.id, x.titre, x.heure from public.sessions x
                   where x.club_id = p.club_id and x.date_seance = current_date and public.player_session_ok(p.id, x.id)
                   order by x.heure nulls last limit 1) s on true
    left join public.player_soreness ps on ps.player_id = p.id and ps.jour = current_date
   where p.auth_user_id = auth.uid() and public.has_role('joueur')
   limit 1;
$$;

-- lmfc_v45.sql
create or replace function public.custom_forms_my_pending()
returns table (
  form_id bigint, version_id bigint, version_no integer, titre text,
  description text, questions jsonb, team_id bigint, team_nom text
)
language sql stable security definer set search_path = public as $$
  with moi as (
    select p.id, p.club_id, p.team_id, coalesce(p.other_team_ids, '{}') other_team_ids
      from public.players p
     where p.auth_user_id = auth.uid() and p.club_id = public.my_club_id()
       and public.has_role('joueur')
     order by p.id limit 1
  )
  select f.id, v.id, v.version_no, v.titre, v.description, v.questions,
         affectation.team_id, t.nom
    from moi
    join public.custom_forms f on f.club_id = moi.club_id and f.actif
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
   order by f.updated_at desc, f.titre;
$$;

create or replace function public.custom_form_submit(p_version_id bigint, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_player public.players%rowtype;
  v_form_id bigint;
  v_club bigint;
  v_team bigint;
  v_team_name text;
  v_form_active boolean;
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

  select f.id, f.club_id, f.actif, v.titre, v.version_no, v.questions
    into v_form_id, v_club, v_form_active, v_form_title, v_version, v_questions
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
    team_id, team_name_snapshot, form_title_snapshot, questions_snapshot, answers
  ) values (
    v_club, v_form_id, p_version_id, v_version, v_player.id, v_player_name,
    v_team, v_team_name, v_form_title, v_questions, v_clean_answers
  ) on conflict (form_version_id, player_id) do nothing
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
  foreach f in array array['my_rpe_sessions()', 'my_rpe_matches()', 'my_soreness_today()', 'custom_forms_my_pending()', 'custom_form_submit(bigint, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
