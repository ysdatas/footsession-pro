-- ============================================================
--  FootSession Pro — Droits par rôle, équipes, préventions
--
--  À exécuter après performance_one_row_per_period.sql. Idempotent,
--  et transactionnel : en cas d'erreur, rien n'est appliqué.
--
--  1) Droits par rôle
--       admin   : tout.
--       coach   : séances, joueurs, vidéos, objectifs/préventions.
--                 Ne modifie PAS les données physiques ni les tests.
--       prepa   : données physiques, tests, import Excel,
--                 objectifs/préventions. Ne gère PAS les vidéos.
--       analyste: vidéos (inchangé).
--       joueur  : lecture seule de SES données, sans l'asymétrie,
--                 les plis cutanés ni le ratio Shirado/Sorensen.
--  2) Équipes : club → équipe → joueurs / séances.
--  3) Profil /10 : groupe de référence = même saison ET même équipe,
--     et Core = moyenne des notes Shirado/Sorensen disponibles.
--  4) Préventions / développement (salle de musculation).
-- ============================================================
begin;

-- ------------------------------------------------------------
-- 1) Helpers de rôle
-- ------------------------------------------------------------
create or replace function public.has_role(variadic p_roles text[])
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = any(p_roles));
$$;

create or replace function public.is_performance_editor()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'prepa');
$$;

create or replace function public.can_manage_videos()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach', 'analyste');
$$;

-- Objectifs, points forts / d'amélioration, préventions.
create or replace function public.can_manage_plans()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach', 'prepa');
$$;

create or replace function public.is_video_stats_staff()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach', 'analyste');
$$;

revoke all on function public.has_role(text[])          from public, anon;
revoke all on function public.can_manage_videos()       from public, anon;
revoke all on function public.can_manage_plans()        from public, anon;
grant execute on function public.has_role(text[])       to authenticated;
grant execute on function public.can_manage_videos()    to authenticated;
grant execute on function public.can_manage_plans()     to authenticated;

-- ------------------------------------------------------------
-- 2) Vidéos : le préparateur physique ne les gère plus.
-- ------------------------------------------------------------
drop policy if exists videos_write_staff  on public.player_videos;
drop policy if exists videos_update_staff on public.player_videos;
drop policy if exists videos_delete_staff on public.player_videos;
create policy videos_write_staff on public.player_videos for insert
  with check (public.can_manage_videos() and club_id = public.my_club_id()
    and exists (select 1 from public.players p where p.id = player_id and p.club_id = public.my_club_id()));
create policy videos_update_staff on public.player_videos for update
  using (public.can_manage_videos() and club_id = public.my_club_id())
  with check (public.can_manage_videos() and club_id = public.my_club_id());
create policy videos_delete_staff on public.player_videos for delete
  using (public.can_manage_videos() and club_id = public.my_club_id());

drop policy if exists player_videos_write  on storage.objects;
drop policy if exists player_videos_delete on storage.objects;
create policy player_videos_write on storage.objects for insert with check (
  bucket_id = 'player-videos' and public.can_manage_videos()
  and (storage.foldername(name))[1] = public.my_club_id()::text
);
create policy player_videos_delete on storage.objects for delete using (
  bucket_id = 'player-videos' and public.can_manage_videos()
  and (storage.foldername(name))[1] = public.my_club_id()::text
);

-- ------------------------------------------------------------
-- 3) Objectifs et points (notes) : admin, coach, prépa.
-- ------------------------------------------------------------
drop policy if exists performance_notes_write  on public.player_performance_notes;
drop policy if exists performance_notes_update on public.player_performance_notes;
drop policy if exists performance_notes_delete on public.player_performance_notes;
create policy performance_notes_write on public.player_performance_notes for insert
  with check (public.can_manage_plans() and club_id = public.my_club_id()
    and exists (select 1 from public.players p where p.id = player_id and p.club_id = public.my_club_id()));
create policy performance_notes_update on public.player_performance_notes for update
  using (public.can_manage_plans() and club_id = public.my_club_id())
  with check (public.can_manage_plans() and club_id = public.my_club_id());
create policy performance_notes_delete on public.player_performance_notes for delete
  using (public.can_manage_plans() and club_id = public.my_club_id());

drop policy if exists performance_media_write  on public.player_performance_media;
drop policy if exists performance_media_update on public.player_performance_media;
drop policy if exists performance_media_delete on public.player_performance_media;
create policy performance_media_write on public.player_performance_media for insert
  with check (public.can_manage_plans() and club_id = public.my_club_id()
    and exists (select 1 from public.players p where p.id = player_id and p.club_id = public.my_club_id()));
create policy performance_media_update on public.player_performance_media for update
  using (public.can_manage_plans() and club_id = public.my_club_id())
  with check (public.can_manage_plans() and club_id = public.my_club_id());
create policy performance_media_delete on public.player_performance_media for delete
  using (public.can_manage_plans() and club_id = public.my_club_id());

drop policy if exists player_perf_media_write  on storage.objects;
drop policy if exists player_perf_media_update on storage.objects;
drop policy if exists player_perf_media_delete on storage.objects;
create policy player_perf_media_write on storage.objects for insert with check (
  bucket_id = 'player-performance-media' and public.can_manage_plans()
  and (storage.foldername(name))[1] = public.my_club_id()::text
);
create policy player_perf_media_update on storage.objects for update
  using (bucket_id = 'player-performance-media' and public.can_manage_plans()
    and (storage.foldername(name))[1] = public.my_club_id()::text)
  with check (bucket_id = 'player-performance-media' and public.can_manage_plans()
    and (storage.foldername(name))[1] = public.my_club_id()::text);
create policy player_perf_media_delete on storage.objects for delete using (
  bucket_id = 'player-performance-media' and public.can_manage_plans()
  and (storage.foldername(name))[1] = public.my_club_id()::text
);

-- ------------------------------------------------------------
-- 4) Joueurs : la suppression d'une fiche (qui efface en cascade
--    présences, tests, vidéos…) est réservée à l'administrateur.
-- ------------------------------------------------------------
drop policy if exists "players_write"  on public.players;
drop policy if exists "players_insert" on public.players;
drop policy if exists "players_update" on public.players;
drop policy if exists "players_delete" on public.players;
create policy "players_insert" on public.players for insert
  with check (club_id = public.my_club_id() and public.can_edit());
create policy "players_update" on public.players for update
  using (club_id = public.my_club_id() and public.can_edit())
  with check (club_id = public.my_club_id() and public.can_edit());
create policy "players_delete" on public.players for delete
  using (club_id = public.my_club_id() and public.is_club_admin());

-- ------------------------------------------------------------
-- 5) Données physiques : le joueur ne lit plus les tables
--    directement (la RLS filtre des LIGNES, pas des colonnes).
--    Il passe par deux RPC qui ne renvoient que les colonnes
--    qui lui sont destinées.
-- ------------------------------------------------------------
drop policy if exists performance_measurements_read on public.player_physical_measurements;
create policy performance_measurements_read on public.player_physical_measurements for select
  using (public.can_view_performance() and club_id = public.my_club_id());

drop policy if exists performance_tests_read on public.player_physical_tests;
create policy performance_tests_read on public.player_physical_tests for select
  using (public.can_view_performance() and club_id = public.my_club_id());

-- Poids et masse grasse (la taille reste affichée dans l'en-tête).
-- Pas de plis cutanés.
drop function if exists public.my_physical_measurements();
create function public.my_physical_measurements()
returns table (
  id bigint, player_id bigint, season_key text, month_label text, measured_at date,
  height_cm numeric, weight_kg numeric, body_fat_pct numeric
)
language sql security definer stable set search_path = public as $$
  select m.id, m.player_id, m.season_key, m.month_label, m.measured_at,
         m.height_cm, m.weight_kg, m.body_fat_pct
  from public.player_physical_measurements m
  join public.players p on p.id = m.player_id
  where p.auth_user_id = auth.uid() and auth.uid() is not null
  order by m.measured_at nulls last, m.id;
$$;

-- Chronos bruts et profil /10. Pas d'asymétrie ni de ratio.
drop function if exists public.my_physical_tests();
create function public.my_physical_tests()
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
         t.sprint10_sec, t.five05_left_sec, t.five05_right_sec, t.five05_avg_sec,
         t.sprint40_sec, t.vift_kmh, t.shirado_sec, t.sorensen_sec,
         t.profile_start, t.profile_agility, t.profile_speed,
         t.profile_endurance, t.profile_core, t.source, t.updated_at
  from public.player_physical_tests t
  join public.players p on p.id = t.player_id
  where p.auth_user_id = auth.uid() and auth.uid() is not null
  order by t.season_key, t.stage, t.id;
$$;

revoke all on function public.my_physical_measurements() from public, anon;
revoke all on function public.my_physical_tests()        from public, anon;
grant execute on function public.my_physical_measurements() to authenticated;
grant execute on function public.my_physical_tests()        to authenticated;

-- ------------------------------------------------------------
-- 6) Équipes
-- ------------------------------------------------------------
create table if not exists public.teams (
  id         bigint generated always as identity primary key,
  club_id    bigint not null references public.clubs(id) on delete cascade,
  nom        text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (club_id, nom)
);

alter table public.players  add column if not exists team_id bigint references public.teams(id) on delete set null;
alter table public.sessions add column if not exists team_id bigint references public.teams(id) on delete set null;
create index if not exists players_team_idx  on public.players(team_id);
create index if not exists sessions_team_idx on public.sessions(team_id);

alter table public.teams enable row level security;
drop policy if exists teams_read  on public.teams;
drop policy if exists teams_write on public.teams;
create policy teams_read on public.teams for select
  using (club_id = public.my_club_id());
create policy teams_write on public.teams for all
  using (club_id = public.my_club_id() and public.is_club_admin())
  with check (club_id = public.my_club_id() and public.is_club_admin());
grant select, insert, update, delete on public.teams to authenticated;

-- Une fiche ou une séance ne peut pointer que vers une équipe de SON club.
create or replace function public.check_team_club()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.team_id is not null and not exists (
    select 1 from public.teams t where t.id = new.team_id and t.club_id = new.club_id
  ) then
    raise exception 'Équipe % inconnue pour ce club', new.team_id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_players_team_club on public.players;
create trigger trg_players_team_club before insert or update of team_id, club_id on public.players
  for each row execute function public.check_team_club();
drop trigger if exists trg_sessions_team_club on public.sessions;
create trigger trg_sessions_team_club before insert or update of team_id, club_id on public.sessions
  for each row execute function public.check_team_club();

-- Reprise : le champ texte « équipe » des séances devient une vraie équipe.
insert into public.teams (club_id, nom)
select distinct club_id, btrim(equipe) from public.sessions
where coalesce(btrim(equipe), '') <> ''
on conflict (club_id, nom) do nothing;

update public.sessions s set team_id = t.id
from public.teams t
where s.team_id is null and t.club_id = s.club_id and t.nom = btrim(s.equipe);

-- ------------------------------------------------------------
-- 7) Profil /10 recalculé par saison ET par équipe.
--    Avant : toutes saisons confondues, et Core vide dès qu'un des
--    deux tests (Shirado ou Sorensen) manquait.
-- ------------------------------------------------------------
drop function if exists public.recompute_player_profile_scores(bigint, text);
create or replace function public.recompute_player_profile_scores(
  p_club_id bigint, p_stage text, p_season text, p_team bigint
)
returns void language plpgsql security definer set search_path = public as $$
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
    s10_avg, s10_sd, s10_n, a505_avg, a505_sd, a505_n, s40_avg, s40_sd, s40_n,
    vift_avg, vift_sd, vift_n, shi_avg, shi_sd, shi_n, sor_avg, sor_sd, sor_n
  from public.player_physical_tests t
  where t.club_id = p_club_id and t.stage = p_stage and t.season_key = p_season
    and exists (select 1 from public.players p
                where p.id = t.player_id and p.team_id is not distinct from p_team);

  update public.player_physical_tests t
  set
    profile_start = case
      when t.sprint10_sec is null or s10_n < 3 then null
      when coalesce(s10_sd, 0) = 0 then 5
      else greatest(0, least(10, 5 + 2 * ((s10_avg - t.sprint10_sec) / s10_sd))) end,
    profile_agility = case
      when t.five05_avg_sec is null or a505_n < 3 then null
      when coalesce(a505_sd, 0) = 0 then 5
      else greatest(0, least(10, 5 + 2 * ((a505_avg - t.five05_avg_sec) / a505_sd))) end,
    profile_speed = case
      when t.sprint40_sec is null or s40_n < 3 then null
      when coalesce(s40_sd, 0) = 0 then 5
      else greatest(0, least(10, 5 + 2 * ((s40_avg - t.sprint40_sec) / s40_sd))) end,
    profile_endurance = case
      when t.vift_kmh is null or vift_n < 3 then null
      when coalesce(vift_sd, 0) = 0 then 5
      else greatest(0, least(10, 5 + 2 * ((t.vift_kmh - vift_avg) / vift_sd))) end,
    -- Moyenne des notes Shirado et Sorensen disponibles (comme le classeur).
    profile_core = (
      select avg(v) from (values
        (case when t.shirado_sec is null or shi_n < 3 then null
              when coalesce(shi_sd, 0) = 0 then 5
              else greatest(0, least(10, 5 + 2 * ((t.shirado_sec - shi_avg) / shi_sd))) end),
        (case when t.sorensen_sec is null or sor_n < 3 then null
              when coalesce(sor_sd, 0) = 0 then 5
              else greatest(0, least(10, 5 + 2 * ((t.sorensen_sec - sor_avg) / sor_sd))) end)
      ) as x(v)
    ),
    updated_at = now()
  where t.club_id = p_club_id and t.stage = p_stage and t.season_key = p_season
    and exists (select 1 from public.players p
                where p.id = t.player_id and p.team_id is not distinct from p_team)
    -- Les scores fournis par le classeur restent la référence.
    and not (
      t.source = 'import_excel'
      and coalesce(t.profile_start, t.profile_agility, t.profile_speed,
                   t.profile_endurance, t.profile_core) is not null
    );
end;
$$;
revoke all on function public.recompute_player_profile_scores(bigint, text, text, bigint) from public, anon;
grant execute on function public.recompute_player_profile_scores(bigint, text, text, bigint) to authenticated;

create or replace function public.recompute_player_profile_scores_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  for r in
    select distinct x.club_id, x.stage, x.season_key, p.team_id
    from (select old.club_id, old.stage, old.season_key, old.player_id where tg_op <> 'INSERT'
          union all
          select new.club_id, new.stage, new.season_key, new.player_id where tg_op <> 'DELETE') x
    left join public.players p on p.id = x.player_id
  loop
    perform public.recompute_player_profile_scores(r.club_id, r.stage, r.season_key, r.team_id);
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.recompute_player_profile_scores_trigger() from public, anon, authenticated;

-- Un joueur qui change d'équipe change de groupe de référence :
-- on recalcule l'ancien et le nouveau groupe.
create or replace function public.recompute_on_team_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct stage, season_key from public.player_physical_tests where player_id = new.id loop
    perform public.recompute_player_profile_scores(new.club_id, r.stage, r.season_key, old.team_id);
    perform public.recompute_player_profile_scores(new.club_id, r.stage, r.season_key, new.team_id);
  end loop;
  return new;
end; $$;
revoke all on function public.recompute_on_team_change() from public, anon, authenticated;

drop trigger if exists trg_players_team_recompute on public.players;
create trigger trg_players_team_recompute after update of team_id on public.players
  for each row when (old.team_id is distinct from new.team_id)
  execute function public.recompute_on_team_change();

-- ------------------------------------------------------------
-- 8) Moyennes pour la vue joueur : même équipe que lui, et jamais
--    l'asymétrie ni le ratio (indicateurs internes au staff).
-- ------------------------------------------------------------
drop function if exists public.club_test_averages(text);
create function public.club_test_averages(p_stage text)
returns table (
  n_players integer,
  sprint10_sec numeric, five05_left_sec numeric, five05_right_sec numeric,
  five05_avg_sec numeric, five05_asymmetry_pct numeric, sprint40_sec numeric,
  vift_kmh numeric, shirado_sec numeric, sorensen_sec numeric, core_ratio numeric,
  profile_start numeric, profile_agility numeric, profile_speed numeric,
  profile_endurance numeric, profile_core numeric
)
language sql security definer stable set search_path = public as $$
  with me as (
    select pr.club_id, pl.team_id, (pr.role <> 'joueur') as staff
    from public.profiles pr
    left join public.players pl on pl.auth_user_id = pr.id
    where pr.id = auth.uid()
  ),
  pool as (
    select t.* from public.player_physical_tests t
    join public.players p on p.id = t.player_id, me
    where t.club_id = me.club_id and t.stage = p_stage
      and (me.staff or p.team_id is not distinct from me.team_id)
  ),
  season as (select max(season_key) as s from pool),
  scope as (
    select distinct on (pool.player_id) pool.*
    from pool, season where pool.season_key = season.s
    order by pool.player_id, pool.id desc
  ),
  bounded as (
    select
      case when sprint10_sec         between 1.2 and 2.6 then sprint10_sec         end as sprint10_sec,
      case when five05_left_sec      between 1.8 and 3.6 then five05_left_sec      end as five05_left_sec,
      case when five05_right_sec     between 1.8 and 3.6 then five05_right_sec     end as five05_right_sec,
      case when five05_avg_sec       between 1.8 and 3.6 then five05_avg_sec       end as five05_avg_sec,
      case when five05_asymmetry_pct between 0   and 40  then five05_asymmetry_pct end as five05_asymmetry_pct,
      case when sprint40_sec         between 4.0 and 8.0 then sprint40_sec         end as sprint40_sec,
      case when vift_kmh             between 12  and 25  then vift_kmh             end as vift_kmh,
      case when shirado_sec          between 5   and 600 then shirado_sec          end as shirado_sec,
      case when sorensen_sec         between 5   and 600 then sorensen_sec         end as sorensen_sec,
      case when core_ratio           between 0.1 and 6   then core_ratio           end as core_ratio,
      case when profile_start        between 0   and 10  then profile_start        end as profile_start,
      case when profile_agility      between 0   and 10  then profile_agility      end as profile_agility,
      case when profile_speed        between 0   and 10  then profile_speed        end as profile_speed,
      case when profile_endurance    between 0   and 10  then profile_endurance    end as profile_endurance,
      case when profile_core         between 0   and 10  then profile_core         end as profile_core
    from scope
  )
  select
    count(*)::integer,
    case when count(sprint10_sec)      >= 3 then avg(sprint10_sec)      end,
    case when count(five05_left_sec)   >= 3 then avg(five05_left_sec)   end,
    case when count(five05_right_sec)  >= 3 then avg(five05_right_sec)  end,
    case when count(five05_avg_sec)    >= 3 then avg(five05_avg_sec)    end,
    case when (select staff from me) and count(five05_asymmetry_pct) >= 3 then avg(five05_asymmetry_pct) end,
    case when count(sprint40_sec)      >= 3 then avg(sprint40_sec)      end,
    case when count(vift_kmh)          >= 3 then avg(vift_kmh)          end,
    case when count(shirado_sec)       >= 3 then avg(shirado_sec)       end,
    case when count(sorensen_sec)      >= 3 then avg(sorensen_sec)      end,
    case when (select staff from me) and count(core_ratio) >= 3 then avg(core_ratio) end,
    case when count(profile_start)     >= 3 then avg(profile_start)     end,
    case when count(profile_agility)   >= 3 then avg(profile_agility)   end,
    case when count(profile_speed)     >= 3 then avg(profile_speed)     end,
    case when count(profile_endurance) >= 3 then avg(profile_endurance) end,
    case when count(profile_core)      >= 3 then avg(profile_core)      end
  from bounded;
$$;
revoke all on function public.club_test_averages(text) from public, anon;
grant execute on function public.club_test_averages(text) to authenticated;

-- ------------------------------------------------------------
-- 9) Préventions / développement — salle de musculation
-- ------------------------------------------------------------
create table if not exists public.player_programs (
  id                bigint generated always as identity primary key,
  club_id           bigint not null references public.clubs(id) on delete cascade,
  player_id         bigint not null references public.players(id) on delete cascade,
  category          text not null default 'prevention'
                    check (category in ('prevention', 'individuel', 'developpement')),
  title             text not null,
  body              text,              -- consignes, exercices
  dosage            text,              -- ex. 3 × 12, 2 fois / semaine
  start_date        date,
  end_date          date,
  status            text not null default 'en_cours'
                    check (status in ('en_cours', 'en_pause', 'termine')),
  progress_note     text,              -- où en est le joueur
  visible_to_player boolean not null default true,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists player_programs_player_idx on public.player_programs(player_id, status);

drop trigger if exists trg_touch_player_programs on public.player_programs;
create trigger trg_touch_player_programs before update on public.player_programs
  for each row execute function public.touch_player_performance_row();

alter table public.player_programs enable row level security;
drop policy if exists player_programs_read  on public.player_programs;
drop policy if exists player_programs_write on public.player_programs;
create policy player_programs_read on public.player_programs for select using (
  (visible_to_player and exists (
     select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid()))
  or (public.is_staff() and club_id = public.my_club_id())
);
create policy player_programs_write on public.player_programs for all
  using (public.can_manage_plans() and club_id = public.my_club_id())
  with check (public.can_manage_plans() and club_id = public.my_club_id()
    and exists (select 1 from public.players p where p.id = player_id and p.club_id = public.my_club_id()));
grant select, insert, update, delete on public.player_programs to authenticated;

commit;
