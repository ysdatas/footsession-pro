/* ============================================================
   LMFC Performance — lmfc_v65_retour.sql : retour arrière de lmfc_v65.sql
   Remet custom_forms_my_pending() de lmfc_v64.sql et custom_form_submit() de lmfc_v63.sql,
   retire custom_form_plan() et la colonne planning : les formulaires planifiés redeviennent
   « une fois ». Aucune réponse n'est touchée. Rejouable et transactionnel.
   ============================================================ */
begin;

create or replace function public.custom_forms_my_pending()
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
      join public.sessions s on s.id = r.session_id and public.rpe_open(s.date_seance) and s.date_seance >= current_date - 2
    union all
    select 'rpe_match', 'm' || m.id, m.team_id,
           concat_ws(' · ', 'Match contre ' || m.adversaire, to_char(m.date_match, 'DD/MM/YYYY')), m.date_match
      from moi join public.match_rpe r on r.player_id = moi.id
      join public.matches m on m.id = r.match_id and public.rpe_open(m.date_match) and m.date_match >= current_date - 2
    union all
    select 'courbatures', 'j' || ps.jour, s.team_id, to_char(ps.jour, 'DD/MM/YYYY'), ps.jour
      from moi join public.player_soreness ps on ps.player_id = moi.id and ps.jour = current_date
      left join public.sessions s on s.id = ps.session_id
    union all
    select 'avis_match', 'm' || m.id, m.team_id,
           concat_ws(' · ', 'Match contre ' || m.adversaire, to_char(m.date_match, 'DD/MM/YYYY')), m.date_match
      from moi join public.match_feedback fb on fb.player_id = moi.id
      join public.matches m on m.id = fb.match_id and public.rpe_open(m.date_match) and m.date_match >= current_date - 2
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

drop function if exists public.custom_form_plan(bigint, jsonb);
alter table public.custom_forms drop constraint if exists custom_forms_planning_ok;
alter table public.custom_forms drop column if exists planning;
drop function if exists public.custom_form_in_period(jsonb, date);
drop function if exists public.custom_form_planning_ok(jsonb);

commit;
