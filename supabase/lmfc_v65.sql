/* ============================================================
   LMFC Performance — lmfc_v65.sql : quand poser un formulaire
   À exécuter après lmfc_v64.sql. Rejouable et transactionnelle.

   custom_forms.planning (null : comme avant, une fois) :
     { "mode": "une_fois" | "jour" | "semaine" | "avant_match",
       "jours": [1..7] (semaine : lundi = 1 … dimanche = 7),
       "quand": "veille" | "jour" (avant_match : la veille ou le jour du match),
       "du": "AAAA-MM-JJ", "au": "AAAA-MM-JJ" (période, facultative ; du = au : une seule date) }
   - une_fois : proposé une fois, pendant la période s'il y en a une ;
   - jour, semaine : un questionnaire par jour choisi (occurrence « j » + date) ;
   - avant_match : un par match de l'équipe (occurrence « m » + match, visible dans Suivi RPE) ;
   - les formulaires après séance ou match (source) prennent seulement une période.
   Comme les autres, un questionnaire se remplit le jour même ou jusqu'à deux jours après,
   jamais pour un jour d'avant sa création. custom_form_plan() enregistre le réglage (mêmes
   droits que custom_form_save) ; custom_form_submit() suit la liste du joueur.
   Retour arrière : lmfc_v65_retour.sql (les réglages sont perdus : ces formulaires
   redeviennent « une fois »).
   ============================================================ */
begin;

-- Réglage valide : ce que custom_form_plan() enregistre, et rien d'autre.
create or replace function public.custom_form_planning_ok(p jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare k text;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) <> 'object' then return false; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('mode', 'jours', 'quand', 'du', 'au') then return false; end if;
  end loop;
  if coalesce(p->>'mode', 'une_fois') not in ('une_fois', 'jour', 'semaine', 'avant_match') then return false; end if;
  if p->>'mode' = 'semaine' and (jsonb_typeof(p->'jours') is distinct from 'array' or jsonb_array_length(p->'jours') not between 1 and 7
     or exists (select 1 from jsonb_array_elements(p->'jours') j where jsonb_typeof(j) <> 'number' or j::text not in ('1','2','3','4','5','6','7'))
     or (select count(distinct j::text) from jsonb_array_elements(p->'jours') j) <> jsonb_array_length(p->'jours')) then return false; end if;
  if p->>'mode' is distinct from 'semaine' and p ? 'jours' then return false; end if;
  if (p->>'mode' = 'avant_match') <> coalesce(p->>'quand' in ('veille', 'jour'), false) then return false; end if;
  if p->>'mode' is distinct from 'avant_match' and p ? 'quand' then return false; end if;
  if coalesce(p->>'du', '2000-01-01') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p->>'au', '2000-01-01') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  if (p->>'du')::date > (p->>'au')::date then return false; end if;
  return true;
exception when others then return false;   -- date impossible (31/02…)
end $$;

alter table public.custom_forms add column if not exists planning jsonb;
alter table public.custom_forms drop constraint if exists custom_forms_planning_ok;
alter table public.custom_forms add constraint custom_forms_planning_ok check (public.custom_form_planning_ok(planning));

-- Le jour est-il dans la période du réglage ? Sans période : toujours.
create or replace function public.custom_form_in_period(p jsonb, p_day date)
returns boolean language sql immutable set search_path = public as $$
  select p_day >= coalesce((p->>'du')::date, '-infinity'::date) and p_day <= coalesce((p->>'au')::date, 'infinity'::date);
$$;

-- Enregistrer le réglage d'un formulaire. Mêmes droits que custom_form_save() (lmfc_v44.sql) ;
-- un formulaire après séance ou match ne prend qu'une période. null ou {} : une fois, sans période.
create or replace function public.custom_form_plan(p_form bigint, p_planning jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_club bigint := public.my_club_id();
  v_role text;
  v_form public.custom_forms%rowtype;
  v_p jsonb := nullif(nullif(p_planning, 'null'::jsonb), '{}'::jsonb);
begin
  select role into v_role from public.profiles where id = auth.uid() and club_id = v_club;
  if auth.uid() is null or v_club is null or coalesce(v_role, '') not in ('admin', 'prepa') then
    raise exception 'La gestion des formulaires est réservée aux administrateurs et préparateurs physiques.' using errcode = '42501';
  end if;
  select * into v_form from public.custom_forms f where f.id = p_form and f.club_id = v_club for update;
  if not found or not public.custom_form_can_read(p_form) or v_form.archive_le is not null then
    raise exception 'Formulaire introuvable ou hors de votre périmètre.' using errcode = '42501';
  end if;
  if exists (select 1 from public.custom_form_teams ft
              where ft.form_id = p_form and not public.custom_form_can_manage_team(ft.team_id))
     or (v_form.source is not null and v_form.created_by is null and v_role <> 'admin') then
    raise exception 'Seul un administrateur peut modifier ce formulaire.' using errcode = '42501';
  end if;
  if v_p is not null then
    v_p := jsonb_strip_nulls(v_p);
    if v_p->>'mode' = 'une_fois' then v_p := v_p - 'mode'; end if;
    if v_p = '{}'::jsonb then v_p := null; end if;
  end if;
  if not public.custom_form_planning_ok(v_p) then
    raise exception 'Réglage invalide : moment, jours de la semaine, veille ou jour du match, et période (du avant au).' using errcode = '22023';
  end if;
  if v_form.source is not null and v_p ? 'mode' then
    raise exception 'Un formulaire posé après la séance ou le match ne prend qu’une période.' using errcode = '22023';
  end if;
  update public.custom_forms set planning = v_p, updated_at = now() where id = p_form;
  return v_p;
end $$;

-- Mes formulaires : les formulaires planifiés en plus (lmfc_v64.sql pour le reste).
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
             and coalesce(f.planning->>'mode', 'une_fois') = 'une_fois' and public.custom_form_in_period(f.planning, current_date)
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
         and public.custom_form_in_period((select f2.planning from public.custom_forms f2 where f2.id = c.form_id), e.jour)
         and not exists (select 1 from public.custom_form_responses r
                         where r.form_id = c.form_id and r.player_id = moi.id and r.occurrence = e.occurrence)
      union all
      -- Formulaires planifiés (lmfc_v65.sql) : chaque jour, certains jours de la semaine, avant le match ;
      -- comme le reste, du jour même à deux jours après (lmfc_v64.sql), jamais avant leur création.
      select f.id, v.id, v.version_no, concat_ws(' · ', v.titre, d.contexte), v.description, v.questions,
             affectation.team_id, t.nom, d.occurrence, d.jour, null
        from moi
        join public.custom_forms f on f.club_id = moi.club_id and f.actif and f.source is null
             and f.planning->>'mode' in ('jour', 'semaine', 'avant_match')
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
        join lateral (
          select 'j' || g.d::date occurrence, g.d::date jour, to_char(g.d, 'DD/MM/YYYY') contexte
            from generate_series(greatest(current_date - 2, f.created_at::date), current_date::timestamp, interval '1 day') g(d)
           where f.planning->>'mode' = 'jour'
              or (f.planning->>'mode' = 'semaine' and extract(isodow from g.d)::int in
                    (select x::int from jsonb_array_elements_text(f.planning->'jours') x))
          union all
          select 'm' || m.id, m.date_match - case when f.planning->>'quand' = 'veille' then 1 else 0 end,
                 concat_ws(' · ', 'Avant le match contre ' || m.adversaire, to_char(m.date_match, 'DD/MM/YYYY'))
            from public.matches m
           where f.planning->>'mode' = 'avant_match' and m.club_id = moi.club_id and m.team_id = affectation.team_id
             and m.date_match - case when f.planning->>'quand' = 'veille' then 1 else 0 end
                 between greatest(current_date - 2, f.created_at::date) and current_date
        ) d on true
       where public.custom_form_in_period(f.planning, d.jour)
         and not exists (select 1 from public.custom_form_responses r
                         where r.form_id = f.id and r.player_id = moi.id and r.occurrence = d.occurrence)
    ) x
   order by x.jour desc nulls first, x.tri desc nulls last, x.titre;
$$;

-- Comme lmfc_v63.sql ; un formulaire planifié se répond par jour ou par match, un « une fois » dans sa période.
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

do $$
declare f text;
begin
  foreach f in array array['custom_forms_my_pending()', 'custom_form_submit(bigint, jsonb, text)', 'custom_form_plan(bigint, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- La contrainte de custom_forms appelle custom_form_planning_ok() avec les droits de qui écrit.
  revoke all on function public.custom_form_planning_ok(jsonb) from public, anon;
  grant execute on function public.custom_form_planning_ok(jsonb) to authenticated;
  -- Interne : appelée par les fonctions ci-dessus.
  foreach f in array array['custom_form_in_period(jsonb, date)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

commit;
