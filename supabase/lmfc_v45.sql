/* ============================================================
   LMFC Performance — lmfc_v45.sql : réponses aux formulaires personnalisés
   À exécuter après lmfc_v44.sql. Rejouable et transactionnelle.

   Les joueurs voient uniquement les formulaires actifs affectés à une de
   leurs équipes. Une réponse est définitive ; si les questions changent, le
   formulaire est proposé de nouveau et l'ancienne réponse reste intacte.
   Renommer un formulaire ne redemande rien aux joueurs.
   Le titre, les questions et les réponses sont copiés dans chaque réponse.

   Les définitions et équipes sont celles de lmfc_v44.sql. Les formulaires
   désactivés ne sont plus proposés, mais les réponses restent lisibles par le
   joueur et par le staff autorisé de l'équipe, qui doit aussi suivre le joueur.
   Elles sont des données du joueur : supprimé, il les emmène à la corbeille, et
   les retrouve s'il est restauré.

   Retour arrière : lmfc_v45_retour.sql. Il refuse de supprimer des réponses.
   ============================================================ */
begin;

create table if not exists public.custom_form_responses (
  id                    bigint generated always as identity primary key,
  club_id               bigint not null references public.clubs on delete restrict,
  form_id               bigint not null references public.custom_forms on delete restrict,
  form_version_id       bigint not null references public.custom_form_versions on delete restrict,
  version_no            integer not null check (version_no > 0),
  player_id             bigint not null references public.players on delete cascade,
  player_name_snapshot  text not null,
  team_id               bigint references public.teams on delete set null,
  team_name_snapshot    text not null,
  form_title_snapshot   text not null,
  questions_snapshot    jsonb not null check (jsonb_typeof(questions_snapshot) = 'array'),
  answers               jsonb not null check (jsonb_typeof(answers) = 'object'),
  submitted_at          timestamptz not null default now(),
  unique (form_version_id, player_id)
);
create index if not exists custom_form_responses_player_idx
  on public.custom_form_responses (player_id, submitted_at desc);
create index if not exists custom_form_responses_team_idx
  on public.custom_form_responses (team_id, submitted_at desc);
create index if not exists custom_form_responses_club_idx
  on public.custom_form_responses (club_id, submitted_at desc);

alter table public.custom_form_responses enable row level security;

-- Corbeille : avec le joueur, comme ses RPE et ses avis de match.
do $$
begin
  if to_regprocedure('public.trash_capture()') is not null then
    drop trigger if exists trash_capture on public.custom_form_responses;
    create trigger trash_capture before delete on public.custom_form_responses
      for each row execute function public.trash_capture('child', 'players:player_id');
  end if;
end $$;

-- Un compte ne voit que sa réponse ; le staff voit celles d'une équipe qu'il suit
-- (l'équipe d'affectation de la réponse, pas seulement les équipes actuelles du
-- joueur), à condition de suivre aussi le joueur : une exception « Aucun » vaut ici.
create or replace function public.custom_form_response_can_read(
  p_club bigint, p_team bigint, p_player bigint
)
returns boolean language sql stable security definer set search_path = public as $$
  select p_club = public.my_club_id() and (
    exists (select 1 from public.players p
            where p.id = p_player and p.auth_user_id = auth.uid() and public.has_role('joueur'))
    or public.has_role('admin')
    or (public.has_role('coach', 'prepa', 'analyste') and public.team_level(p_team) <> 'aucun'
        and public.player_level(p_player) <> 'aucun')
  );
$$;
revoke all on function public.custom_form_response_can_read(bigint, bigint, bigint) from public, anon;
grant execute on function public.custom_form_response_can_read(bigint, bigint, bigint) to authenticated;

drop policy if exists custom_form_responses_read on public.custom_form_responses;
create policy custom_form_responses_read on public.custom_form_responses for select to authenticated
  using (public.custom_form_response_can_read(club_id, team_id, player_id));

drop policy if exists lecteur_no_insert on public.custom_form_responses;
drop policy if exists lecteur_no_update on public.custom_form_responses;
drop policy if exists lecteur_no_delete on public.custom_form_responses;
create policy lecteur_no_insert on public.custom_form_responses as restrictive for insert to authenticated
  with check (not (select public.is_lecteur()));
create policy lecteur_no_update on public.custom_form_responses as restrictive for update to authenticated
  using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()));
create policy lecteur_no_delete on public.custom_form_responses as restrictive for delete to authenticated
  using (not (select public.is_lecteur()));

revoke all on public.custom_form_responses from anon, authenticated;
grant select on public.custom_form_responses to authenticated;

-- Liste à remplir par le joueur : une seule entrée par formulaire même s'il
-- appartient à plusieurs équipes qui le reçoivent.
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

-- L'historique s'appuie sur les copies stockées dans chaque réponse : une
-- modification ou désactivation du formulaire ne change donc pas cet affichage.
create or replace function public.custom_forms_my_history(p_limit integer default 50, p_offset integer default 0)
returns table (
  response_id bigint, titre text, version_no integer, questions jsonb,
  answers jsonb, team_nom text, submitted_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select r.id, r.form_title_snapshot, r.version_no, r.questions_snapshot,
         r.answers, r.team_name_snapshot, r.submitted_at
    from public.custom_form_responses r
    join public.players p on p.id = r.player_id and p.auth_user_id = auth.uid()
   where r.club_id = public.my_club_id() and public.has_role('joueur')
   order by r.submitted_at desc, r.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
   offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;

-- Enregistre une réponse définitive pour la version courante du formulaire.
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
  foreach f in array array[
    'custom_form_response_can_read(bigint, bigint, bigint)',
    'custom_forms_my_pending()', 'custom_forms_my_history(integer, integer)', 'custom_form_submit(bigint, jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
