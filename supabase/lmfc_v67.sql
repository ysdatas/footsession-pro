/* ============================================================
   LMFC Performance — lmfc_v67.sql : questions à choix multiple dans les formulaires
   À exécuter après lmfc_v66.sql. Rejouable et transactionnelle.

   Nouveau type de question « multi » : mêmes choix proposés qu'une question « choice »
   (libellés distincts), mais le joueur en coche autant qu'il veut ; jusqu'à 24 choix (12 pour
   « choice »), pour une silhouette du corps (« corps »: true, zones dessinées par form-body.js).
   La réponse est enregistrée en liste (["Quadriceps", "Mollets"]), dans l'ordre des choix,
   sans doublon ; aucune case cochée = sans réponse (refusée si la question est obligatoire).
   - custom_form_save() (lmfc_v44.sql) accepte le type « multi » ;
   - custom_form_submit() (lmfc_v65.sql) contrôle et range la liste.
   Les autres types et les réponses déjà enregistrées ne changent pas.
   custom_form_question_types() : les types acceptés ; sert aussi de témoin (l'API publique
   répond 42501 si la migration est passée, PGRST202 sinon).
   Retour arrière : lmfc_v67_retour.sql.
   ============================================================ */
begin;

create or replace function public.custom_form_save(
  p_form_id bigint,
  p_title text,
  p_description text,
  p_questions jsonb,
  p_team_ids bigint[],
  p_active boolean,
  p_expected_version integer default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_club bigint := public.my_club_id();
  v_uid uuid := auth.uid();
  v_role text;
  v_team_ids bigint[] := coalesce(p_team_ids, '{}');
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_questions jsonb := p_questions;
  v_form bigint := p_form_id;
  v_latest integer := 0;
  v_version integer := 0;
  v_count integer;
  v_distinct integer;
  v_question jsonb;
  v_question_id text;
  v_question_type text;
  v_old public.custom_form_versions%rowtype;
begin
  select role into v_role from public.profiles where id = v_uid and club_id = v_club;
  if v_uid is null or v_club is null or coalesce(v_role, '') not in ('admin', 'prepa') then
    raise exception 'La gestion des formulaires est réservée aux administrateurs et préparateurs physiques.' using errcode = '42501';
  end if;
  if length(v_title) not between 1 and 100 then
    raise exception 'Le titre doit comporter entre 1 et 100 caractères.' using errcode = '22023';
  end if;
  if v_description is not null and length(v_description) > 1000 then
    raise exception 'La description est limitée à 1 000 caractères.' using errcode = '22023';
  end if;
  if v_questions is null or jsonb_typeof(v_questions) <> 'array'
     or jsonb_array_length(v_questions) not between 1 and 30 then
    raise exception 'Un formulaire doit comporter de 1 à 30 questions.' using errcode = '22023';
  end if;

  select count(*)::integer, count(distinct value->>'id')::integer
    into v_count, v_distinct from jsonb_array_elements(v_questions) as q(value);
  if v_count <> v_distinct then
    raise exception 'Chaque question doit avoir un identifiant unique.' using errcode = '22023';
  end if;
  for v_question in select value from jsonb_array_elements(v_questions) as q(value) loop
    v_question_id := v_question->>'id';
    v_question_type := v_question->>'type';
    if jsonb_typeof(v_question) is distinct from 'object'
       or v_question_id is null or v_question_id !~ '^[a-z0-9_-]{1,40}$'
       or length(btrim(coalesce(v_question->>'label', ''))) not between 1 and 180
       or v_question_type is null or v_question_type not in ('text', 'textarea', 'number', 'scale', 'choice', 'multi', 'boolean')
       or jsonb_typeof(v_question->'required') is distinct from 'boolean' then
      raise exception 'Une question est invalide (identifiant, libellé, type ou caractère obligatoire).' using errcode = '22023';
    end if;
    if v_question_type = 'scale' then
      if coalesce((v_question->>'min')::integer, 0) not between 0 and 10
         or coalesce((v_question->>'max')::integer, 0) not between 1 and 10
         or coalesce((v_question->>'min')::integer, 0) >= coalesce((v_question->>'max')::integer, 0) then
        raise exception 'Les bornes d’une échelle doivent être comprises entre 0 et 10.' using errcode = '22023';
      end if;
    elsif v_question_type in ('choice', 'multi') then   -- multi : choix multiple (lmfc_v67.sql)
      if jsonb_typeof(v_question->'options') is distinct from 'array' then
        raise exception 'Une question à choix doit proposer de 2 à 12 réponses.' using errcode = '22023';
      end if;
      if jsonb_array_length(v_question->'options') not between 2 and 12 and v_question_type = 'choice' then
        raise exception 'Une question à choix doit proposer de 2 à 12 réponses.' using errcode = '22023';
      end if;
      if jsonb_array_length(v_question->'options') not between 2 and 24 and v_question_type = 'multi' then
        raise exception 'Une question à choix multiple doit proposer de 2 à 24 réponses.' using errcode = '22023';
      end if;
      select count(*)::integer, count(distinct btrim(value #>> '{}'))::integer
        into v_count, v_distinct from jsonb_array_elements(v_question->'options');
      if v_count <> v_distinct or exists (
        select 1 from jsonb_array_elements(v_question->'options') o(value)
        where jsonb_typeof(value) <> 'string' or length(btrim(value #>> '{}')) not between 1 and 80
      ) then
        raise exception 'Les choix doivent être des libellés distincts de 1 à 80 caractères.' using errcode = '22023';
      end if;
    end if;
  end loop;

  if cardinality(v_team_ids) <> (select count(distinct selected.team_id)::integer
                                  from unnest(v_team_ids) as selected(team_id)) then
    raise exception 'Une équipe ne peut être sélectionnée qu’une seule fois.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_team_ids) as selected(team_id)
    where selected.team_id is null
       or not exists (select 1 from public.teams t where t.id = selected.team_id and t.club_id = v_club)
       or not public.custom_form_can_manage_team(selected.team_id)
  ) then
    raise exception 'Une équipe sélectionnée est hors de votre périmètre.' using errcode = '42501';
  end if;
  if coalesce(p_active, true) and cardinality(v_team_ids) = 0 then
    raise exception 'Affectez un formulaire actif à au moins une équipe.' using errcode = '22023';
  end if;

  if v_form is null then
    insert into public.custom_forms (club_id, titre, description, actif, created_by)
    values (v_club, v_title, v_description, coalesce(p_active, true), v_uid)
    returning id into v_form;
  else
    perform 1 from public.custom_forms f where f.id = v_form and f.club_id = v_club for update;
    if not found or not public.custom_form_can_read(v_form) then
      raise exception 'Formulaire introuvable ou hors de votre périmètre.' using errcode = '42501';
    end if;
    if exists (select 1 from public.custom_form_teams ft
               where ft.form_id = v_form and not public.custom_form_can_manage_team(ft.team_id)) then
      raise exception 'Seul un administrateur peut modifier un formulaire partagé avec une équipe hors de votre périmètre.' using errcode = '42501';
    end if;
    update public.custom_forms set titre = v_title, description = v_description,
      actif = coalesce(p_active, true), updated_at = now()
      where id = v_form;
  end if;

  select coalesce(max(version_no), 0) into v_latest from public.custom_form_versions where form_id = v_form;
  if p_expected_version is not null and p_expected_version <> v_latest then
    raise exception 'Ce formulaire a changé depuis son ouverture. Rechargez-le avant de réessayer.' using errcode = '40001';
  end if;
  if v_latest = 0 then
    v_version := 1;
  else
    select * into v_old from public.custom_form_versions where form_id = v_form and version_no = v_latest;
    if v_old.titre is distinct from v_title or v_old.description is distinct from v_description
       or v_old.questions is distinct from v_questions then
      v_version := v_latest + 1;
    else
      v_version := v_latest;
    end if;
  end if;
  if v_version > v_latest then
    insert into public.custom_form_versions (form_id, version_no, titre, description, questions, created_by)
    values (v_form, v_version, v_title, v_description, v_questions, v_uid);
  end if;

  delete from public.custom_form_teams where form_id = v_form;
  insert into public.custom_form_teams (form_id, team_id, club_id)
    select v_form, selected.team_id, v_club from unnest(v_team_ids) as selected(team_id)
    on conflict (form_id, team_id) do nothing;

  return jsonb_build_object('id', v_form, 'version_no', v_version, 'active', coalesce(p_active, true));
end;
$$;

revoke all on function public.custom_form_save(bigint, text, text, jsonb, bigint[], boolean, integer) from public, anon;
grant execute on function public.custom_form_save(bigint, text, text, jsonb, bigint[], boolean, integer) to authenticated;

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
  v_planning jsonb;
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

  select f.id, f.club_id, f.actif, f.source, f.planning, v.titre, v.version_no, v.questions
    into v_form_id, v_club, v_form_active, v_source, v_planning, v_form_title, v_version, v_questions
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

  -- Formulaire planifié (lmfc_v65.sql) : comme ceux d'origine, la liste du joueur décide du jour ou du match.
  if v_source is not null or coalesce(v_planning->>'mode', 'une_fois') <> 'une_fois' then
    -- Questions ajoutées à un formulaire d'origine : la liste du joueur décide de
    -- la séance, du match ou du jour, de l'équipe et de ce qu'il reste à poser.
    select x.titre, x.questions, x.team_id, x.team_nom
      into v_form_title, v_questions, v_team, v_team_name
      from public.custom_forms_my_pending() x
     where x.version_id = p_version_id and x.occurrence = coalesce(p_occurrence, '');
    if not found then raise exception 'Ce questionnaire n’est plus à remplir.' using errcode = '42501'; end if;
  else
    if coalesce(p_occurrence, '') <> '' then raise exception 'Réponses invalides.' using errcode = '22023'; end if;
    if not public.custom_form_in_period(v_planning, current_date) then
      raise exception 'Ce questionnaire n’est plus à remplir.' using errcode = '42501';
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
    -- Choix multiple sans case cochée : sans réponse (lmfc_v67.sql).
    if v_type = 'multi' and v_answer = '[]'::jsonb then v_answer := null; end if;
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
    elsif v_type = 'multi' then
      -- Choix multiple (lmfc_v67.sql) : une liste de choix proposés, rangée dans l'ordre des
      -- choix et sans doublon.
      if jsonb_typeof(v_answer) is distinct from 'array'
         or exists (select 1 from jsonb_array_elements(v_answer) as picked(value)
                    where jsonb_typeof(picked.value) is distinct from 'string'
                       or not exists (select 1 from jsonb_array_elements_text(v_question->'options') as option(value)
                                      where option.value = picked.value #>> '{}')) then
        raise exception 'Choix invalide pour « % ».', (v_question->>'label') using errcode = '22023';
      end if;
      select jsonb_agg(option.value order by option.ord) into v_answer
        from jsonb_array_elements_text(v_question->'options') with ordinality as option(value, ord)
       where v_answer ? option.value;
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

revoke all on function public.custom_form_submit(bigint, jsonb, text) from public, anon;
grant execute on function public.custom_form_submit(bigint, jsonb, text) to authenticated;

create or replace function public.custom_form_question_types()
returns text[] language sql immutable set search_path = public as $$
  select array['text', 'textarea', 'number', 'scale', 'choice', 'multi', 'boolean']
$$;
revoke all on function public.custom_form_question_types() from public, anon;
grant execute on function public.custom_form_question_types() to authenticated;

commit;
