/* ============================================================
   LMFC Performance — lmfc_v32.sql : données GPS (Catapult d'abord)
   À exécuter APRÈS lmfc_v31.sql (indépendante : peut passer seule après
   lmfc_v29.sql). Rejouable, transactionnelle.

   Le fichier est lu dans le navigateur (gps-import.js) ; la base garde :
   - gps_imports : un import = un fichier (nom, empreinte SHA-256 unique
     par club tant qu'il n'est pas annulé : le même fichier ne s'importe
     pas deux fois), date, équipe, séance, libellé, fournisseur, et
     l'interprétation de chaque colonne (colonnes : en-tête, indicateur,
     unité, conversion) ; importé par / le ; annulé par / le ;
   - gps_rows : un joueur par import ; nom lu dans le fichier, cellules
     d'origine (raw) et valeurs normalisées (metrics). Jamais modifiées :
     on annule l'import et on réimporte ;
   - gps_player_aliases : « CALODAT » → la fiche validée par le staff ;
   - gps_settings.player_metrics : indicateurs visibles par les joueurs
     (aucun par défaut).
   Droits : lecture staff (le joueur doit lui être visible) ; import,
   annulation, correspondances, visibilité : admin et préparateur (le
   préparateur sur les joueurs qu'il modifie) ; coach : lecture ;
   lecteur : rien ; joueur : aucune lecture directe, my_gps() seulement,
   limité aux indicateurs ouverts.
   Et : ce que le staff masque au joueur (players.hidden_sections, lmfc_v7
   et v8) est désormais retiré par la base dans my_physical_tests() et
   my_physical_measurements(), plus seulement à l'affichage.

   Retour arrière (à la main) :
     drop function if exists public.my_gps(), public.gps_import_save(jsonb, jsonb, jsonb), public.gps_import_cancel(bigint);
     drop table if exists public.gps_rows, public.gps_player_aliases, public.gps_settings, public.gps_imports;
     repasser roles_teams_preventions.sql (my_physical_tests, my_physical_measurements).
   ============================================================ */
begin;

create table if not exists public.gps_imports (
  id          bigint generated always as identity primary key,
  club_id     bigint not null references public.clubs on delete cascade,
  team_id     bigint references public.teams on delete set null,
  session_id  bigint references public.sessions on delete set null,
  date_seance date not null,
  libelle     text check (char_length(libelle) <= 200),
  fichier     text not null check (char_length(fichier) between 1 and 255),
  file_hash   text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  fournisseur text not null default 'catapult' check (char_length(fournisseur) <= 40),
  colonnes    jsonb not null default '[]' check (jsonb_typeof(colonnes) = 'array'),
  nb_joueurs  integer not null default 0,
  importe_par uuid default auth.uid() references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  annule_par  uuid references auth.users on delete set null,
  annule_at   timestamptz
);
create unique index if not exists gps_imports_hash_uq on public.gps_imports (club_id, file_hash) where annule_at is null;
create index if not exists gps_imports_club_date_idx on public.gps_imports (club_id, date_seance desc);

create table if not exists public.gps_rows (
  id         bigint generated always as identity primary key,
  club_id    bigint not null references public.clubs on delete cascade,
  import_id  bigint not null references public.gps_imports on delete cascade,
  player_id  bigint not null references public.players on delete cascade,
  nom_lu     text not null check (char_length(nom_lu) between 1 and 120),
  raw        jsonb not null check (jsonb_typeof(raw) = 'object'),
  metrics    jsonb not null check (jsonb_typeof(metrics) = 'object'),
  unique (import_id, player_id)
);
create index if not exists gps_rows_player_idx on public.gps_rows (player_id);

create table if not exists public.gps_player_aliases (
  club_id    bigint not null references public.clubs on delete cascade,
  nom_lu     text not null check (char_length(nom_lu) between 1 and 120),
  player_id  bigint not null references public.players on delete cascade,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  primary key (club_id, nom_lu)
);

create table if not exists public.gps_settings (
  club_id        bigint primary key references public.clubs on delete cascade,
  player_metrics text[] not null default '{}' check (cardinality(player_metrics) <= 60),
  updated_by     uuid default auth.uid() references auth.users on delete set null,
  updated_at     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Droits
-- ------------------------------------------------------------
alter table public.gps_imports enable row level security;
alter table public.gps_rows enable row level security;
alter table public.gps_player_aliases enable row level security;
alter table public.gps_settings enable row level security;

drop policy if exists gps_imports_read on public.gps_imports;
drop policy if exists gps_imports_insert on public.gps_imports;
drop policy if exists gps_imports_cancel on public.gps_imports;
create policy gps_imports_read on public.gps_imports for select using (
  club_id = (select public.my_club_id()) and (select public.has_role('admin', 'coach', 'prepa'))
  and (team_id is null or public.team_level(team_id) <> 'aucun'));
create policy gps_imports_insert on public.gps_imports for insert with check (
  club_id = (select public.my_club_id()) and (select public.has_role('admin', 'prepa')) and importe_par = auth.uid()
  and (team_id is null or exists (select 1 from public.teams t where t.id = gps_imports.team_id and t.club_id = gps_imports.club_id)));
create policy gps_imports_cancel on public.gps_imports for update
  using (club_id = (select public.my_club_id()) and (select public.has_role('admin', 'prepa')))
  with check (club_id = (select public.my_club_id()) and (select public.has_role('admin', 'prepa')));

drop policy if exists gps_rows_read on public.gps_rows;
drop policy if exists gps_rows_insert on public.gps_rows;
create policy gps_rows_read on public.gps_rows for select using (
  club_id = (select public.my_club_id()) and (select public.has_role('admin', 'coach', 'prepa')) and public.player_level(player_id) <> 'aucun');
create policy gps_rows_insert on public.gps_rows for insert with check (
  club_id = (select public.my_club_id()) and (select public.has_role('admin', 'prepa')) and public.player_level(player_id) = 'modification'
  and exists (select 1 from public.gps_imports i where i.id = gps_rows.import_id and i.club_id = gps_rows.club_id and i.annule_at is null));

drop policy if exists gps_aliases_read on public.gps_player_aliases;
drop policy if exists gps_aliases_write on public.gps_player_aliases;
create policy gps_aliases_read on public.gps_player_aliases for select using (
  club_id = (select public.my_club_id()) and (select public.has_role('admin', 'coach', 'prepa')));
create policy gps_aliases_write on public.gps_player_aliases for all
  using (club_id = (select public.my_club_id()) and (select public.has_role('admin', 'prepa')))
  with check (club_id = (select public.my_club_id()) and (select public.has_role('admin', 'prepa'))
    and exists (select 1 from public.players p where p.id = gps_player_aliases.player_id and p.club_id = gps_player_aliases.club_id));

drop policy if exists gps_settings_read on public.gps_settings;
drop policy if exists gps_settings_write on public.gps_settings;
create policy gps_settings_read on public.gps_settings for select using (
  club_id = (select public.my_club_id()) and (select public.has_role('admin', 'coach', 'prepa')));
create policy gps_settings_write on public.gps_settings for all
  using (club_id = (select public.my_club_id()) and (select public.has_role('admin', 'prepa')))
  with check (club_id = (select public.my_club_id()) and (select public.has_role('admin', 'prepa')));

do $$
declare t text;
begin
  foreach t in array array['gps_imports', 'gps_rows', 'gps_player_aliases', 'gps_settings'] loop
    execute format('drop policy if exists lecteur_no_insert on public.%I', t);
    execute format('drop policy if exists lecteur_no_update on public.%I', t);
    execute format('drop policy if exists lecteur_no_delete on public.%I', t);
    execute format('create policy lecteur_no_insert on public.%I as restrictive for insert to authenticated with check (not (select public.is_lecteur()))', t);
    execute format('create policy lecteur_no_update on public.%I as restrictive for update to authenticated using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()))', t);
    execute format('create policy lecteur_no_delete on public.%I as restrictive for delete to authenticated using (not (select public.is_lecteur()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
grant insert on public.gps_imports, public.gps_rows to authenticated;
grant update (annule_at, annule_par) on public.gps_imports to authenticated;
grant insert, update, delete on public.gps_player_aliases, public.gps_settings to authenticated;

-- ------------------------------------------------------------
-- Enregistrer un import en une transaction (droits de l'appelant) ; l'annuler
-- ------------------------------------------------------------
-- p_import : { team_id, session_id, date_seance, libelle, fichier, file_hash, fournisseur, colonnes }
-- p_rows : [{ player_id, nom_lu, raw, metrics }] ; p_aliases : [{ nom_lu, player_id }] (correspondances validées)
create or replace function public.gps_import_save(p_import jsonb, p_rows jsonb, p_aliases jsonb default '[]')
returns bigint language plpgsql security invoker set search_path = public as $$
declare
  v_club bigint := public.my_club_id();
  v_id   bigint;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Aucun joueur à importer.' using errcode = '22023';
  end if;
  insert into public.gps_imports (club_id, team_id, session_id, date_seance, libelle, fichier, file_hash, fournisseur, colonnes, nb_joueurs)
  values (v_club, nullif(p_import->>'team_id', '')::bigint, nullif(p_import->>'session_id', '')::bigint, (p_import->>'date_seance')::date,
          nullif(p_import->>'libelle', ''), p_import->>'fichier', p_import->>'file_hash', coalesce(nullif(p_import->>'fournisseur', ''), 'catapult'),
          coalesce(p_import->'colonnes', '[]'), jsonb_array_length(p_rows))
  returning id into v_id;
  insert into public.gps_rows (club_id, import_id, player_id, nom_lu, raw, metrics)
  select v_club, v_id, (r->>'player_id')::bigint, r->>'nom_lu', r->'raw', r->'metrics' from jsonb_array_elements(p_rows) r;
  insert into public.gps_player_aliases (club_id, nom_lu, player_id)
  select v_club, a->>'nom_lu', (a->>'player_id')::bigint from jsonb_array_elements(coalesce(p_aliases, '[]')) a
  on conflict (club_id, nom_lu) do update set player_id = excluded.player_id, created_by = auth.uid(), created_at = now();
  return v_id;
end; $$;
revoke all on function public.gps_import_save(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.gps_import_save(jsonb, jsonb, jsonb) to authenticated;

-- Annuler : l'import reste dans l'historique, ses valeurs sortent des fiches ; le même fichier peut être réimporté.
create or replace function public.gps_import_cancel(p_import bigint)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  update public.gps_imports set annule_at = now(), annule_par = auth.uid() where id = p_import and annule_at is null;
  return found;
end; $$;
revoke all on function public.gps_import_cancel(bigint) from public, anon;
grant execute on function public.gps_import_cancel(bigint) to authenticated;

-- ------------------------------------------------------------
-- Joueur : ses données GPS, limitées aux indicateurs ouverts par le staff
-- ------------------------------------------------------------
create or replace function public.my_gps()
returns table (import_id bigint, date_seance date, libelle text, metrics jsonb)
language sql stable security definer set search_path = public as $$
  select i.id, i.date_seance, i.libelle,
         (select jsonb_object_agg(e.key, e.value) from jsonb_each(r.metrics) e where e.key = any(s.player_metrics))
    from public.gps_rows r
    join public.gps_imports i on i.id = r.import_id and i.annule_at is null
    join public.players p on p.id = r.player_id and p.auth_user_id = auth.uid()
    join public.gps_settings s on s.club_id = i.club_id and cardinality(s.player_metrics) > 0
   where auth.uid() is not null and public.has_role('joueur')
   order by i.date_seance desc, i.id desc
   limit 200;
$$;
revoke all on function public.my_gps() from public, anon;
grant execute on function public.my_gps() to authenticated;

-- ------------------------------------------------------------
-- Ce que le staff masque au joueur, retiré par la base (plus seulement à l'affichage)
-- ------------------------------------------------------------
create or replace function public.my_physical_measurements()
returns table (
  id bigint, player_id bigint, season_key text, month_label text, measured_at date,
  height_cm numeric, weight_kg numeric, body_fat_pct numeric
)
language sql security definer stable set search_path = public as $$
  select m.id, m.player_id, m.season_key, m.month_label, m.measured_at,
         case when 'mesure:height_cm' = any(h.s) then null else m.height_cm end,
         case when 'mesure:weight_kg' = any(h.s) then null else m.weight_kg end,
         case when 'mesure:body_fat_pct' = any(h.s) then null else m.body_fat_pct end
  from public.player_physical_measurements m
  join public.players p on p.id = m.player_id
  cross join lateral (select coalesce(p.hidden_sections, '{}') as s) h
  where p.auth_user_id = auth.uid() and auth.uid() is not null and not ('suivi' = any(h.s))
  order by m.measured_at nulls last, m.id;
$$;

create or replace function public.my_physical_tests()
returns table (
  id bigint, player_id bigint, season_key text, stage text, tested_at date,
  sprint10_sec numeric, five05_left_sec numeric, five05_right_sec numeric,
  five05_avg_sec numeric, sprint40_sec numeric, vift_kmh numeric,
  shirado_sec numeric, sorensen_sec numeric,
  profile_start numeric, profile_agility numeric, profile_speed numeric,
  profile_endurance numeric, profile_core numeric,
  source text, updated_at timestamptz
)
language sql security definer stable set search_path = public as $$
  select t.id, t.player_id, t.season_key, t.stage, t.tested_at,
         case when h.tests or 'test:sprint10_sec' = any(h.s) then null else t.sprint10_sec end,
         case when h.tests or 'test:five05_avg_sec' = any(h.s) or 'test:five05_left_sec' = any(h.s) then null else t.five05_left_sec end,
         case when h.tests or 'test:five05_avg_sec' = any(h.s) or 'test:five05_right_sec' = any(h.s) then null else t.five05_right_sec end,
         case when h.tests or 'test:five05_avg_sec' = any(h.s) then null else t.five05_avg_sec end,
         case when h.tests or 'test:sprint40_sec' = any(h.s) then null else t.sprint40_sec end,
         case when h.tests or 'test:vift_kmh' = any(h.s) then null else t.vift_kmh end,
         case when h.tests or 'test:shirado_sec' = any(h.s) then null else t.shirado_sec end,
         case when h.tests or 'test:sorensen_sec' = any(h.s) then null else t.sorensen_sec end,
         case when h.radar then null else t.profile_start end, case when h.radar then null else t.profile_agility end,
         case when h.radar then null else t.profile_speed end, case when h.radar then null else t.profile_endurance end,
         case when h.radar then null else t.profile_core end,
         t.source, t.updated_at
  from public.player_physical_tests t
  join public.players p on p.id = t.player_id
  cross join lateral (select coalesce(p.hidden_sections, '{}') as s, 'tests' = any(coalesce(p.hidden_sections, '{}')) as tests,
                             'radar' = any(coalesce(p.hidden_sections, '{}')) as radar) h
  where p.auth_user_id = auth.uid() and auth.uid() is not null
  order by t.season_key, t.stage, t.id;
$$;
revoke all on function public.my_physical_measurements() from public, anon;
revoke all on function public.my_physical_tests() from public, anon;
grant execute on function public.my_physical_measurements() to authenticated;
grant execute on function public.my_physical_tests() to authenticated;

commit;
