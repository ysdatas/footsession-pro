-- ============================================================
--  FootSession Pro — Schéma Postgres pour Supabase (Chemin B)
--  MODÈLE MULTI-CLUB : les données appartiennent au CLUB,
--  tous les membres du staff les partagent, sécurisé par RLS.
--  À coller dans Supabase → SQL Editor → Run.
-- ============================================================

-- ------------------------------------------------------------
-- 1) CLUBS
-- ------------------------------------------------------------
create table if not exists public.clubs (
  id         bigint generated always as identity primary key,
  nom        text not null,
  color      text,
  logo_path  text,                         -- fichier dans le Storage (pas de base64)
  join_code  text unique not null,         -- code pour rejoindre le club
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 2) PROFILS (liés aux comptes Supabase Auth)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  nom        text,
  club_id    bigint references public.clubs on delete set null,
  role       text not null default 'viewer'
             check (role in ('admin','coach','analyste','prepa','viewer')),
  created_at timestamptz default now()
);

-- Crée automatiquement un profil (sans club) à l'inscription.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nom)
  values (new.id, coalesce(new.raw_user_meta_data->>'nom', new.email));
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Helpers (security definer = contournent la RLS, donc pas de récursion).
create or replace function public.my_club_id()
returns bigint language sql security definer stable set search_path = public as $$
  select club_id from public.profiles where id = auth.uid();
$$;

create or replace function public.can_edit()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role in ('admin','coach','analyste','prepa'));
$$;

create or replace function public.is_club_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ------------------------------------------------------------
-- 3) TABLES MÉTIER (rattachées au club)
-- ------------------------------------------------------------
create table if not exists public.sessions (
  id          bigint generated always as identity primary key,
  club_id     bigint not null references public.clubs on delete cascade,
  created_by  uuid references auth.users on delete set null,
  titre       text not null,
  date_seance date not null,
  categorie   text, equipe text, duree_min int default 90, notes text,
  share_token text unique,
  created_at  timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.procedures (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.sessions on delete cascade,
  ordre int default 1, nom text not null default 'Procédé', duree_min int default 20,
  objectif text, effectif text, postes_cibles text, zones_jeu text, taille_terrain text,
  consignes text, principes_jeu text, comportements_individuels text,
  intensite int, temps_recup_min int, created_at timestamptz default now()
);

create table if not exists public.tactical_schemas (
  id bigint generated always as identity primary key,
  procedure_id bigint not null unique references public.procedures on delete cascade,
  canvas_json jsonb,                        -- le schéma en données légères (quelques Ko)
  image_path text,                          -- miniature/export optionnel (bucket "schemas")
  vue_terrain text default 'complet', updated_at timestamptz default now()
);

create table if not exists public.players (
  id bigint generated always as identity primary key,
  club_id bigint not null references public.clubs on delete cascade,
  nom text not null, prenom text, numero int, poste text,
  created_at timestamptz default now()
);

create table if not exists public.attendance (
  id bigint generated always as identity primary key,
  player_id bigint not null references public.players on delete cascade,
  session_id bigint not null references public.sessions on delete cascade,
  present boolean default false, unique (player_id, session_id)
);

create table if not exists public.session_comments (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.sessions on delete cascade,
  user_id uuid references auth.users on delete set null,
  author text, body text not null, created_at timestamptz default now()
);

create table if not exists public.exercise_templates (
  id bigint generated always as identity primary key,
  club_id bigint not null references public.clubs on delete cascade,
  created_by uuid references auth.users on delete set null,
  nom text not null, categorie text, data jsonb, canvas_json jsonb, image_path text,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 4) ROW LEVEL SECURITY
-- ------------------------------------------------------------
alter table public.clubs enable row level security;
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.procedures enable row level security;
alter table public.tactical_schemas enable row level security;
alter table public.players enable row level security;
alter table public.attendance enable row level security;
alter table public.session_comments enable row level security;
alter table public.exercise_templates enable row level security;

-- Club : les membres voient leur club ; l'admin du club le modifie.
create policy "club_read"   on public.clubs for select using (id = public.my_club_id());
create policy "club_update" on public.clubs for update using (id = public.my_club_id() and public.is_club_admin());

-- Profils : on voit les membres de son club ; on modifie le sien ;
-- l'admin du club modifie les rôles de ses membres.
create policy "profiles_read"   on public.profiles for select using (club_id = public.my_club_id() or id = auth.uid());
create policy "profiles_self"   on public.profiles for update using (id = auth.uid());
create policy "profiles_admin"  on public.profiles for update using (club_id = public.my_club_id() and public.is_club_admin());

-- Données du club : lecture pour tous les membres, écriture pour les éditeurs.
create policy "sessions_read"  on public.sessions for select using (club_id = public.my_club_id());
create policy "sessions_write" on public.sessions for all
  using (club_id = public.my_club_id() and public.can_edit())
  with check (club_id = public.my_club_id() and public.can_edit());

create policy "players_read"  on public.players for select using (club_id = public.my_club_id());
create policy "players_write" on public.players for all
  using (club_id = public.my_club_id() and public.can_edit())
  with check (club_id = public.my_club_id() and public.can_edit());

create policy "templates_read"  on public.exercise_templates for select using (club_id = public.my_club_id());
create policy "templates_write" on public.exercise_templates for all
  using (club_id = public.my_club_id() and public.can_edit())
  with check (club_id = public.my_club_id() and public.can_edit());

-- Tables enfant : lecture pour tous les membres du club, écriture pour les éditeurs.
-- (les politiques permissives se cumulent en OR : le _read autorise le SELECT,
--  le _write autorise insert/update/delete uniquement aux éditeurs.)
create policy "procedures_read"  on public.procedures for select
  using (exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id()));
create policy "procedures_write" on public.procedures for all
  using (public.can_edit() and exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id()))
  with check (public.can_edit() and exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id()));

create policy "schemas_read"  on public.tactical_schemas for select
  using (exists (select 1 from public.procedures p join public.sessions s on s.id = p.session_id where p.id = procedure_id and s.club_id = public.my_club_id()));
create policy "schemas_write" on public.tactical_schemas for all
  using (public.can_edit() and exists (select 1 from public.procedures p join public.sessions s on s.id = p.session_id where p.id = procedure_id and s.club_id = public.my_club_id()))
  with check (public.can_edit() and exists (select 1 from public.procedures p join public.sessions s on s.id = p.session_id where p.id = procedure_id and s.club_id = public.my_club_id()));

create policy "attendance_read"  on public.attendance for select
  using (exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id()));
create policy "attendance_write" on public.attendance for all
  using (public.can_edit() and exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id()))
  with check (public.can_edit() and exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id()));

create policy "comments_read"  on public.session_comments for select
  using (exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id()));
create policy "comments_write" on public.session_comments for insert
  with check (public.can_edit() and exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id()));
create policy "comments_delete" on public.session_comments for delete
  using (user_id = auth.uid() or public.is_club_admin());

-- ------------------------------------------------------------
-- 5) ONBOARDING : créer / rejoindre un club
-- ------------------------------------------------------------
create or replace function public.create_club(p_nom text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_code text;
begin
  v_code := upper(substr(md5(random()::text), 1, 6));
  insert into public.clubs (nom, join_code, created_by) values (p_nom, v_code, auth.uid()) returning id into v_id;
  update public.profiles set club_id = v_id, role = 'admin' where id = auth.uid();
  return v_id;
end; $$;

create or replace function public.join_club(p_code text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  select id into v_id from public.clubs where join_code = upper(p_code);
  if v_id is null then raise exception 'Code de club invalide'; end if;
  update public.profiles set club_id = v_id, role = 'viewer' where id = auth.uid();
  return v_id;
end; $$;

grant execute on function public.create_club(text), public.join_club(text) to authenticated;

-- ------------------------------------------------------------
-- 6) PARTAGE PUBLIC (lecture seule, sans compte)
--    Le front public appelle : supabase.rpc('get_shared_session', { p_token })
-- ------------------------------------------------------------
create or replace function public.get_shared_session(p_token text)
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'session', to_jsonb(s) - 'share_token',
    'club', (select jsonb_build_object('nom', c.nom, 'logo_path', c.logo_path) from public.clubs c where c.id = s.club_id),
    'procedures', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object(
        'image_path', (select t.image_path from public.tactical_schemas t where t.procedure_id = p.id),
        'canvas_json', (select t.canvas_json from public.tactical_schemas t where t.procedure_id = p.id))
        order by p.ordre)
      from public.procedures p where p.session_id = s.id), '[]'::jsonb)
  )
  from public.sessions s where s.share_token = p_token limit 1;
$$;
grant execute on function public.get_shared_session(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 7) STORAGE (dans l'interface Supabase → Storage)
--    Créer 2 buckets : "schemas" et "logos".
--    Accès en écriture/lecture réservé aux utilisateurs connectés ;
--    les schémas partagés utiliseront des URLs signées.
-- ------------------------------------------------------------
