-- FootSession Pro — Suivi performance joueur + import préparateur physique
-- À exécuter une seule fois dans Supabase SQL Editor.
-- Les tables de ce fichier sont compatibles avec les fiches joueurs existantes.

alter table public.players
  add column if not exists photo_path text;

create table if not exists public.player_physical_measurements (
  id bigint generated always as identity primary key,
  club_id bigint not null references public.clubs(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  measured_at date,
  month_label text not null,
  season_key text,
  age_at_measurement numeric,
  height_cm numeric,
  weight_kg numeric,
  body_fat_pct numeric,
  biceps_mm numeric,
  triceps_mm numeric,
  subscapular_mm numeric,
  suprailiac_mm numeric,
  skinfold_sum_4_mm numeric,
  source text not null default 'manual',
  source_file_name text,
  source_sheet text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.player_physical_tests (
  id bigint generated always as identity primary key,
  club_id bigint not null references public.clubs(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  stage text not null check (stage in ('pre','mid','end')),
  tested_at date,
  sprint10_sec numeric,
  five05_left_sec numeric,
  five05_right_sec numeric,
  five05_avg_sec numeric,
  five05_asymmetry_pct numeric,
  sprint40_sec numeric,
  vift_kmh numeric,
  shirado_sec numeric,
  sorensen_sec numeric,
  core_ratio numeric,
  profile_start numeric,
  profile_agility numeric,
  profile_speed numeric,
  profile_endurance numeric,
  profile_core numeric,
  source text not null default 'manual',
  source_file_name text,
  source_sheet text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.player_performance_notes (
  id bigint generated always as identity primary key,
  club_id bigint not null references public.clubs(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  kind text not null check (kind in ('strength','improvement','objective')),
  title text not null,
  body text,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.player_performance_notes
  drop constraint if exists player_performance_notes_kind_check;

alter table public.player_performance_notes
  add constraint player_performance_notes_kind_check
  check (kind in ('strength','improvement','objective'));

create table if not exists public.player_performance_media (
  id bigint generated always as identity primary key,
  club_id bigint not null references public.clubs(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  note_id bigint references public.player_performance_notes(id) on delete cascade,
  storage_path text not null,
  caption text,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists player_physical_measurements_import_uq
  on public.player_physical_measurements(club_id, player_id, month_label, source_file_name);

create unique index if not exists player_physical_tests_import_uq
  on public.player_physical_tests(club_id, player_id, stage, source_file_name);

create index if not exists player_physical_measurements_player_idx
  on public.player_physical_measurements(player_id, measured_at desc nulls last, id desc);

create index if not exists player_physical_tests_player_idx
  on public.player_physical_tests(player_id, stage, tested_at desc nulls last, id desc);

create index if not exists player_performance_notes_player_idx
  on public.player_performance_notes(player_id, sort_order, id);

create index if not exists player_performance_media_player_idx
  on public.player_performance_media(player_id, note_id, sort_order, id);

-- Rôle d'édition performance : admin + prépa physique.
create or replace function public.is_performance_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'prepa')
  );
$$;

-- Lecture performance : joueur concerné + staff du club.
create or replace function public.can_view_performance()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'coach', 'prepa', 'analyste')
  );
$$;

-- Les statistiques de visionnage sont réservées aux entraîneurs et admins.
create or replace function public.is_video_stats_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'coach')
  );
$$;

revoke all on function public.is_performance_editor() from public, anon, authenticated;
revoke all on function public.can_view_performance() from public, anon, authenticated;
revoke all on function public.is_video_stats_staff() from public, anon, authenticated;
grant execute on function public.is_performance_editor() to authenticated;
grant execute on function public.can_view_performance() to authenticated;
grant execute on function public.is_video_stats_staff() to authenticated;

-- ------------------------------------------------------------
-- Calcul radar /10
-- 5 = moyenne du groupe, 7 = +1 écart-type, 3 = -1 écart-type.
-- Sprint / 505 : plus bas = meilleur.
-- VIFT : plus haut = meilleur.
-- Core = moyenne des scores Shirado + Sorensen disponibles.
-- ------------------------------------------------------------

create or replace function public.recompute_player_profile_scores(
  p_club_id bigint,
  p_stage text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s10_avg numeric; s10_sd numeric; s10_n integer;
  a505_avg numeric; a505_sd numeric; a505_n integer;
  s40_avg numeric; s40_sd numeric; s40_n integer;
  vift_avg numeric; vift_sd numeric; vift_n integer;
  shi_avg numeric; shi_sd numeric; shi_n integer;
  sor_avg numeric; sor_sd numeric; sor_n integer;
begin
  select
    avg(sprint10_sec), stddev_samp(sprint10_sec), count(sprint10_sec),
    avg(five05_avg_sec), stddev_samp(five05_avg_sec), count(five05_avg_sec),
    avg(sprint40_sec), stddev_samp(sprint40_sec), count(sprint40_sec),
    avg(vift_kmh), stddev_samp(vift_kmh), count(vift_kmh),
    avg(shirado_sec), stddev_samp(shirado_sec), count(shirado_sec),
    avg(sorensen_sec), stddev_samp(sorensen_sec), count(sorensen_sec)
  into
    s10_avg, s10_sd, s10_n,
    a505_avg, a505_sd, a505_n,
    s40_avg, s40_sd, s40_n,
    vift_avg, vift_sd, vift_n,
    shi_avg, shi_sd, shi_n,
    sor_avg, sor_sd, sor_n
  from public.player_physical_tests
  where club_id = p_club_id
    and stage = p_stage;

  update public.player_physical_tests t
  set
    profile_start =
      case
        when t.sprint10_sec is null or s10_n < 3 then null
        when coalesce(s10_sd, 0) = 0 then 5
        else greatest(0, least(10, 5 + 2 * ((s10_avg - t.sprint10_sec) / s10_sd)))
      end,
    profile_agility =
      case
        when t.five05_avg_sec is null or a505_n < 3 then null
        when coalesce(a505_sd, 0) = 0 then 5
        else greatest(0, least(10, 5 + 2 * ((a505_avg - t.five05_avg_sec) / a505_sd)))
      end,
    profile_speed =
      case
        when t.sprint40_sec is null or s40_n < 3 then null
        when coalesce(s40_sd, 0) = 0 then 5
        else greatest(0, least(10, 5 + 2 * ((s40_avg - t.sprint40_sec) / s40_sd)))
      end,
    profile_endurance =
      case
        when t.vift_kmh is null or vift_n < 3 then null
        when coalesce(vift_sd, 0) = 0 then 5
        else greatest(0, least(10, 5 + 2 * ((t.vift_kmh - vift_avg) / vift_sd)))
      end,
    profile_core =
      case
        when t.shirado_sec is null and t.sorensen_sec is null then null
        else greatest(
          0,
          least(
            10,
            5 + 2 * (
              (
                case when t.shirado_sec is not null and shi_n >= 3 and coalesce(shi_sd, 0) <> 0
                     then ((t.shirado_sec - shi_avg) / shi_sd) end
                +
                case when t.sorensen_sec is not null and sor_n >= 3 and coalesce(sor_sd, 0) <> 0
                     then ((t.sorensen_sec - sor_avg) / sor_sd) end
              )
              /
              nullif(
                (case when t.shirado_sec is not null and shi_n >= 3 and coalesce(shi_sd, 0) <> 0 then 1 else 0 end)
                +
                (case when t.sorensen_sec is not null and sor_n >= 3 and coalesce(sor_sd, 0) <> 0 then 1 else 0 end),
                0
              )
            )
          )
        )
      end,
    updated_at = now()
  where club_id = p_club_id
    and stage = p_stage;
end;
$$;

revoke all on function public.recompute_player_profile_scores(bigint, text) from public, anon, authenticated;
grant execute on function public.recompute_player_profile_scores(bigint, text) to authenticated;

create or replace function public.prepare_player_test_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.five05_left_sec is not null and new.five05_right_sec is not null then
    new.five05_avg_sec := (new.five05_left_sec + new.five05_right_sec) / 2.0;
    if greatest(new.five05_left_sec, new.five05_right_sec) > 0 then
      new.five05_asymmetry_pct :=
        abs(new.five05_left_sec - new.five05_right_sec)
        / greatest(new.five05_left_sec, new.five05_right_sec) * 100.0;
    else
      new.five05_asymmetry_pct := null;
    end if;
  elsif new.five05_avg_sec is null then
    new.five05_asymmetry_pct := null;
  end if;

  if new.shirado_sec is not null and new.sorensen_sec is not null and new.sorensen_sec > 0 then
    new.core_ratio := new.shirado_sec / new.sorensen_sec;
  else
    new.core_ratio := null;
  end if;

  if new.source = 'import_excel' and new.created_by is null then
    new.created_by := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prepare_player_test_row on public.player_physical_tests;
create trigger trg_prepare_player_test_row
before insert or update on public.player_physical_tests
for each row execute function public.prepare_player_test_row();

create or replace function public.recompute_player_profile_scores_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Le recalcul met à jour les lignes de la même table : on évite la récursion du trigger.
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.recompute_player_profile_scores(old.club_id, old.stage);
    return old;
  end if;

  perform public.recompute_player_profile_scores(new.club_id, new.stage);

  if tg_op = 'UPDATE'
     and (old.club_id is distinct from new.club_id or old.stage is distinct from new.stage) then
    perform public.recompute_player_profile_scores(old.club_id, old.stage);
  end if;

  return new;
end;
$$;

revoke all on function public.recompute_player_profile_scores_trigger() from public, anon, authenticated;

drop trigger if exists trg_recompute_player_profile_scores on public.player_physical_tests;
create trigger trg_recompute_player_profile_scores
after insert or update or delete on public.player_physical_tests
for each row execute function public.recompute_player_profile_scores_trigger();

create or replace function public.touch_player_performance_row()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_physical_measurements on public.player_physical_measurements;
create trigger trg_touch_physical_measurements
before update on public.player_physical_measurements
for each row execute function public.touch_player_performance_row();

drop trigger if exists trg_touch_physical_tests on public.player_physical_tests;
create trigger trg_touch_physical_tests
before update on public.player_physical_tests
for each row execute function public.touch_player_performance_row();

drop trigger if exists trg_touch_performance_notes on public.player_performance_notes;
create trigger trg_touch_performance_notes
before update on public.player_performance_notes
for each row execute function public.touch_player_performance_row();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

alter table public.player_physical_measurements enable row level security;
alter table public.player_physical_tests enable row level security;
alter table public.player_performance_notes enable row level security;
alter table public.player_performance_media enable row level security;

drop policy if exists performance_measurements_read on public.player_physical_measurements;
create policy performance_measurements_read
on public.player_physical_measurements for select
using (
  exists (
    select 1 from public.players p
    where p.id = player_id and p.auth_user_id = auth.uid()
  )
  or (public.can_view_performance() and club_id = public.my_club_id())
);

drop policy if exists performance_measurements_write on public.player_physical_measurements;
create policy performance_measurements_write
on public.player_physical_measurements for insert
with check (
  public.is_performance_editor()
  and club_id = public.my_club_id()
  and exists (
    select 1 from public.players p
    where p.id = player_id and p.club_id = public.my_club_id()
  )
);

drop policy if exists performance_measurements_update on public.player_physical_measurements;
create policy performance_measurements_update
on public.player_physical_measurements for update
using (public.is_performance_editor() and club_id = public.my_club_id())
with check (public.is_performance_editor() and club_id = public.my_club_id());

drop policy if exists performance_measurements_delete on public.player_physical_measurements;
create policy performance_measurements_delete
on public.player_physical_measurements for delete
using (public.is_performance_editor() and club_id = public.my_club_id());

drop policy if exists performance_tests_read on public.player_physical_tests;
create policy performance_tests_read
on public.player_physical_tests for select
using (
  exists (
    select 1 from public.players p
    where p.id = player_id and p.auth_user_id = auth.uid()
  )
  or (public.can_view_performance() and club_id = public.my_club_id())
);

drop policy if exists performance_tests_write on public.player_physical_tests;
create policy performance_tests_write
on public.player_physical_tests for insert
with check (
  public.is_performance_editor()
  and club_id = public.my_club_id()
  and exists (
    select 1 from public.players p
    where p.id = player_id and p.club_id = public.my_club_id()
  )
);

drop policy if exists performance_tests_update on public.player_physical_tests;
create policy performance_tests_update
on public.player_physical_tests for update
using (public.is_performance_editor() and club_id = public.my_club_id())
with check (public.is_performance_editor() and club_id = public.my_club_id());

drop policy if exists performance_tests_delete on public.player_physical_tests;
create policy performance_tests_delete
on public.player_physical_tests for delete
using (public.is_performance_editor() and club_id = public.my_club_id());

drop policy if exists performance_notes_read on public.player_performance_notes;
create policy performance_notes_read
on public.player_performance_notes for select
using (
  exists (
    select 1 from public.players p
    where p.id = player_id and p.auth_user_id = auth.uid()
  )
  or (public.can_view_performance() and club_id = public.my_club_id())
);

drop policy if exists performance_notes_write on public.player_performance_notes;
create policy performance_notes_write
on public.player_performance_notes for insert
with check (
  public.is_performance_editor()
  and club_id = public.my_club_id()
  and exists (
    select 1 from public.players p
    where p.id = player_id and p.club_id = public.my_club_id()
  )
);

drop policy if exists performance_notes_update on public.player_performance_notes;
create policy performance_notes_update
on public.player_performance_notes for update
using (public.is_performance_editor() and club_id = public.my_club_id())
with check (public.is_performance_editor() and club_id = public.my_club_id());

drop policy if exists performance_notes_delete on public.player_performance_notes;
create policy performance_notes_delete
on public.player_performance_notes for delete
using (public.is_performance_editor() and club_id = public.my_club_id());

drop policy if exists performance_media_read on public.player_performance_media;
create policy performance_media_read
on public.player_performance_media for select
using (
  exists (
    select 1 from public.players p
    where p.id = player_id and p.auth_user_id = auth.uid()
  )
  or (public.can_view_performance() and club_id = public.my_club_id())
);

drop policy if exists performance_media_write on public.player_performance_media;
create policy performance_media_write
on public.player_performance_media for insert
with check (
  public.is_performance_editor()
  and club_id = public.my_club_id()
  and exists (
    select 1 from public.players p
    where p.id = player_id and p.club_id = public.my_club_id()
  )
);

drop policy if exists performance_media_update on public.player_performance_media;
create policy performance_media_update
on public.player_performance_media for update
using (public.is_performance_editor() and club_id = public.my_club_id())
with check (public.is_performance_editor() and club_id = public.my_club_id());

drop policy if exists performance_media_delete on public.player_performance_media;
create policy performance_media_delete
on public.player_performance_media for delete
using (public.is_performance_editor() and club_id = public.my_club_id());

-- Stats vidéo : aucune policy de lecture pour les joueurs.
drop policy if exists views_read_player on public.video_views;
drop policy if exists views_read_staff on public.video_views;
drop policy if exists views_read_staff_only on public.video_views;
create policy views_read_staff_only
on public.video_views for select
using (
  public.is_video_stats_staff()
  and exists (
    select 1
    from public.player_videos v
    where v.id = video_id
      and v.club_id = public.my_club_id()
  )
);

-- ------------------------------------------------------------
-- Storage performance
-- Convention :
--   player-photos/{club_id}/{player_id}/{timestamp}.jpg
--   player-performance-media/{club_id}/{player_id}/{note_id}/{timestamp}.jpg
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('player-photos', 'player-photos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('player-performance-media', 'player-performance-media', false)
on conflict (id) do nothing;

drop policy if exists player_photos_read on storage.objects;
create policy player_photos_read on storage.objects for select
using (
  bucket_id = 'player-photos'
  and (
    exists (
      select 1 from public.players p
      where p.id::text = (storage.foldername(name))[2]
        and p.auth_user_id = auth.uid()
    )
    or (
      public.can_view_performance()
      and (storage.foldername(name))[1] = public.my_club_id()::text
    )
  )
);

drop policy if exists player_photos_write on storage.objects;
create policy player_photos_write on storage.objects for insert
with check (
  bucket_id = 'player-photos'
  and public.is_performance_editor()
  and (storage.foldername(name))[1] = public.my_club_id()::text
);

drop policy if exists player_photos_update on storage.objects;
create policy player_photos_update on storage.objects for update
using (
  bucket_id = 'player-photos'
  and public.is_performance_editor()
  and (storage.foldername(name))[1] = public.my_club_id()::text
)
with check (
  bucket_id = 'player-photos'
  and public.is_performance_editor()
  and (storage.foldername(name))[1] = public.my_club_id()::text
);

drop policy if exists player_photos_delete on storage.objects;
create policy player_photos_delete on storage.objects for delete
using (
  bucket_id = 'player-photos'
  and public.is_performance_editor()
  and (storage.foldername(name))[1] = public.my_club_id()::text
);

drop policy if exists player_perf_media_read on storage.objects;
create policy player_perf_media_read on storage.objects for select
using (
  bucket_id = 'player-performance-media'
  and (
    exists (
      select 1 from public.players p
      where p.id::text = (storage.foldername(name))[2]
        and p.auth_user_id = auth.uid()
    )
    or (
      public.can_view_performance()
      and (storage.foldername(name))[1] = public.my_club_id()::text
    )
  )
);

drop policy if exists player_perf_media_write on storage.objects;
create policy player_perf_media_write on storage.objects for insert
with check (
  bucket_id = 'player-performance-media'
  and public.is_performance_editor()
  and (storage.foldername(name))[1] = public.my_club_id()::text
);

drop policy if exists player_perf_media_update on storage.objects;
create policy player_perf_media_update on storage.objects for update
using (
  bucket_id = 'player-performance-media'
  and public.is_performance_editor()
  and (storage.foldername(name))[1] = public.my_club_id()::text
)
with check (
  bucket_id = 'player-performance-media'
  and public.is_performance_editor()
  and (storage.foldername(name))[1] = public.my_club_id()::text
);

drop policy if exists player_perf_media_delete on storage.objects;
create policy player_perf_media_delete on storage.objects for delete
using (
  bucket_id = 'player-performance-media'
  and public.is_performance_editor()
  and (storage.foldername(name))[1] = public.my_club_id()::text
);

-- Optional backfill/recalculation for existing imported tests after re-running the migration.
-- The front-end import also triggers these calculations automatically.
