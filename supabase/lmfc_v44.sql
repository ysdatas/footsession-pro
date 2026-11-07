/* ============================================================
   LMFC Performance — lmfc_v44.sql : définitions de formulaires versionnées
   À exécuter après lmfc_v43.sql. Rejouable et transactionnelle.

   Cette première étape ajoute le stockage des formulaires et leur gestion
   par les administrateurs et préparateurs physiques. Chaque changement de
   titre, description ou questions crée une version conservée ; les formulaires
   sont désactivés, jamais supprimés. L'affectation reste limitée aux équipes
   du préparateur (profiles.team_ids) ; sans équipe, il n'en gère aucune.

   Les réponses RPE, avis de match et courbatures existantes ne sont ni déplacées
   ni modifiées par cette migration. La saisie des réponses personnalisées et
   leur affichage aux joueurs seront ajoutés dans le lot suivant.

   Retour arrière : lmfc_v44_retour.sql. Il refuse de supprimer des définitions
   déjà créées.
   ============================================================ */
begin;

create table if not exists public.custom_forms (
  id          bigint generated always as identity primary key,
  club_id     bigint not null references public.clubs on delete cascade,
  titre       text not null check (length(btrim(titre)) between 1 and 100),
  description text,
  actif       boolean not null default true,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists custom_forms_club_idx on public.custom_forms (club_id, actif, updated_at desc);

create table if not exists public.custom_form_versions (
  id          bigint generated always as identity primary key,
  form_id     bigint not null references public.custom_forms on delete restrict,
  version_no  integer not null check (version_no > 0),
  titre       text not null check (length(btrim(titre)) between 1 and 100),
  description text,
  questions   jsonb not null check (jsonb_typeof(questions) = 'array'),
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  unique (form_id, version_no)
);
create index if not exists custom_form_versions_latest_idx on public.custom_form_versions (form_id, version_no desc);

create table if not exists public.custom_form_teams (
  form_id  bigint not null references public.custom_forms on delete restrict,
  team_id  bigint not null references public.teams on delete cascade,
  club_id  bigint not null references public.clubs on delete cascade,
  added_at timestamptz not null default now(),
  primary key (form_id, team_id)
);
create index if not exists custom_form_teams_team_idx on public.custom_form_teams (team_id, form_id);

alter table public.custom_forms enable row level security;
alter table public.custom_form_versions enable row level security;
alter table public.custom_form_teams enable row level security;

-- Un préparateur gère uniquement ses équipes : sans équipe, aucune.
create or replace function public.custom_form_can_manage_team(p_team bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles me
    where me.id = auth.uid() and me.club_id = public.my_club_id()
      and (me.role = 'admin' or (me.role = 'prepa' and p_team = any(me.team_ids)))
  );
$$;

-- Les préparateurs voient leurs formulaires et ceux qui concernent leurs
-- équipes ; les autres rôles, dont l'analyste et le lecteur, restent exclus.
create or replace function public.custom_form_can_read(p_form bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.custom_forms f
      join public.profiles me on me.id = auth.uid() and me.club_id = f.club_id
     where f.id = p_form and f.club_id = public.my_club_id()
       and (me.role = 'admin'
         or (me.role = 'prepa' and (
           f.created_by = auth.uid()
           or exists (select 1 from public.custom_form_teams ft
                       where ft.form_id = f.id and public.custom_form_can_manage_team(ft.team_id))
         )))
  );
$$;

revoke all on function public.custom_form_can_manage_team(bigint) from public, anon;
revoke all on function public.custom_form_can_read(bigint) from public, anon;
grant execute on function public.custom_form_can_manage_team(bigint) to authenticated;
grant execute on function public.custom_form_can_read(bigint) to authenticated;

drop policy if exists custom_forms_read on public.custom_forms;
create policy custom_forms_read on public.custom_forms for select to authenticated
  using (club_id = (select public.my_club_id()) and public.custom_form_can_read(id));

drop policy if exists custom_form_versions_read on public.custom_form_versions;
create policy custom_form_versions_read on public.custom_form_versions for select to authenticated
  using (public.custom_form_can_read(form_id));

drop policy if exists custom_form_teams_read on public.custom_form_teams;
create policy custom_form_teams_read on public.custom_form_teams for select to authenticated
  using (club_id = (select public.my_club_id())
    and public.custom_form_can_read(form_id)
    and public.custom_form_can_manage_team(team_id));

-- Les écritures passent par custom_form_save(), qui valide toute la demande
-- avant de publier les changements dans une transaction.
revoke all on public.custom_forms, public.custom_form_versions, public.custom_form_teams from anon, authenticated;
grant select on public.custom_forms, public.custom_form_versions, public.custom_form_teams to authenticated;

do $$
declare tab text;
begin
  foreach tab in array array['custom_forms', 'custom_form_versions', 'custom_form_teams'] loop
    execute format('drop policy if exists lecteur_no_insert on public.%I', tab);
    execute format('drop policy if exists lecteur_no_update on public.%I', tab);
    execute format('drop policy if exists lecteur_no_delete on public.%I', tab);
    execute format('create policy lecteur_no_insert on public.%I as restrictive for insert to authenticated with check (not (select public.is_lecteur()))', tab);
    execute format('create policy lecteur_no_update on public.%I as restrictive for update to authenticated using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()))', tab);
    execute format('create policy lecteur_no_delete on public.%I as restrictive for delete to authenticated using (not (select public.is_lecteur()))', tab);
  end loop;
end $$;

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
       or v_question_type is null or v_question_type not in ('text', 'textarea', 'number', 'scale', 'choice', 'boolean')
       or jsonb_typeof(v_question->'required') is distinct from 'boolean' then
      raise exception 'Une question est invalide (identifiant, libellé, type ou caractère obligatoire).' using errcode = '22023';
    end if;
    if v_question_type = 'scale' then
      if coalesce((v_question->>'min')::integer, 0) not between 0 and 10
         or coalesce((v_question->>'max')::integer, 0) not between 1 and 10
         or coalesce((v_question->>'min')::integer, 0) >= coalesce((v_question->>'max')::integer, 0) then
        raise exception 'Les bornes d’une échelle doivent être comprises entre 0 et 10.' using errcode = '22023';
      end if;
    elsif v_question_type = 'choice' then
      if jsonb_typeof(v_question->'options') is distinct from 'array' then
        raise exception 'Une question à choix doit proposer de 2 à 12 réponses.' using errcode = '22023';
      end if;
      if jsonb_array_length(v_question->'options') not between 2 and 12 then
        raise exception 'Une question à choix doit proposer de 2 à 12 réponses.' using errcode = '22023';
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

commit;
