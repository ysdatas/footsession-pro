-- ============================================================
--  FootSession Pro — correctifs d'audit (septembre 2026)
--
--  À exécuter EN DERNIER dans Supabase SQL Editor, après
--  schema.sql, player_performance_migration.sql,
--  player_access_migration.sql et player_video_selections.sql.
--
--  Ce fichier est idempotent et tranche les contradictions
--  entre migrations :
--   1) les stats de visionnage deviennent réservées au staff ;
--   2) le tracking passe par une RPC (le joueur n'écrit ni ne
--      lit plus video_views directement) ;
--   3) un joueur ne lit plus le trombinoscope du club ;
--   4) les lignes "manuelles" de performance ont une vraie clé
--      d'unicité (source_file_name = '' au lieu de NULL).
-- ============================================================
begin;

-- ------------------------------------------------------------
-- 1) Helper : membre du staff = tout rôle sauf "joueur".
-- ------------------------------------------------------------
create or replace function public.is_staff()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role <> 'joueur'
  );
$$;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

-- Les statistiques de visionnage sont pour le staff qui travaille
-- la vidéo. On aligne sur can_edit() (admin/coach/analyste/prepa)
-- pour que la RLS et le front disent la même chose.
-- Resserre ici si tu veux les réserver à admin+coach.
create or replace function public.is_video_stats_staff()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin','coach','analyste','prepa')
  );
$$;

-- ------------------------------------------------------------
-- 2) Un joueur ne lit que SA fiche, pas tout l'effectif.
--    (players_read_self, créé par add_player_videos.sql, couvre
--     l'accès du joueur à sa propre ligne.)
-- ------------------------------------------------------------
drop policy if exists "players_read" on public.players;
create policy "players_read" on public.players for select
  using (public.is_staff() and club_id = public.my_club_id());

drop policy if exists "players_read_self" on public.players;
create policy "players_read_self" on public.players for select
  using (auth_user_id = auth.uid());

-- Idem pour les présences : un joueur n'a pas à lire celles des autres.
drop policy if exists "attendance_read" on public.attendance;
create policy "attendance_read" on public.attendance for select
  using (
    public.is_staff()
    and exists (
      select 1 from public.sessions s
      where s.id = session_id and s.club_id = public.my_club_id()
    )
  );

drop policy if exists "attendance_read_self" on public.attendance;
create policy "attendance_read_self" on public.attendance for select
  using (
    exists (
      select 1 from public.players p
      where p.id = player_id and p.auth_user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- 3) video_views : plus AUCUN accès direct pour le joueur.
--    Lecture staff uniquement, écriture uniquement via la RPC
--    track_video_view() ci-dessous (SECURITY DEFINER).
-- ------------------------------------------------------------
drop policy if exists views_read_player   on public.video_views;
drop policy if exists views_insert_player on public.video_views;
drop policy if exists views_update_player on public.video_views;
drop policy if exists views_read_staff    on public.video_views;
drop policy if exists views_read_staff_only on public.video_views;

create policy views_read_staff_only on public.video_views for select
using (
  public.is_video_stats_staff()
  and exists (
    select 1 from public.player_videos v
    where v.id = video_id and v.club_id = public.my_club_id()
  )
);

-- ------------------------------------------------------------
-- 4) RPC de tracking.
--    Le client appelle track_video_view() sans jamais lire
--    video_views. Renvoie l'id de la session de lecture, à
--    repasser aux heartbeats suivants.
--
--    p_view_id  : null au premier appel, puis l'id renvoyé.
--    p_position : position courante en secondes.
--    p_delta    : secondes réellement visionnées depuis le
--                 dernier appel (déjà plafonnées côté client).
--    p_duration : durée de la vidéo si connue (renseigne
--                 player_videos.duree_sec si encore vide).
-- ------------------------------------------------------------
create or replace function public.track_video_view(
  p_video_id bigint,
  p_view_id  bigint default null,
  p_position int default 0,
  p_delta    int default 0,
  p_completed boolean default false,
  p_duration int default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id bigint;
  v_view_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  -- La vidéo doit appartenir au joueur lié au compte appelant.
  select p.id into v_player_id
  from public.players p
  join public.player_videos v on v.player_id = p.id
  where p.auth_user_id = auth.uid()
    and v.id = p_video_id;

  if v_player_id is null then
    raise exception 'Vidéo introuvable pour ce compte.';
  end if;

  -- Durée réelle de la vidéo, renseignée une seule fois.
  if p_duration is not null and p_duration > 0 then
    update public.player_videos
      set duree_sec = p_duration
      where id = p_video_id and duree_sec is null;
  end if;

  -- Nouvelle session de lecture.
  if p_view_id is null then
    insert into public.video_views (video_id, player_id, started_at, last_heartbeat_at)
    values (p_video_id, v_player_id, now(), now())
    returning id into v_view_id;
    return v_view_id;
  end if;

  -- Heartbeat : on cumule, on garde la position max, et
  -- "completed" reste acquis une fois atteint.
  update public.video_views
  set watched_seconds      = watched_seconds + greatest(0, least(30, coalesce(p_delta, 0))),
      max_position_seconds = greatest(max_position_seconds, greatest(0, coalesce(p_position, 0))),
      last_heartbeat_at    = now(),
      completed            = completed or coalesce(p_completed, false)
  where id = p_view_id
    and player_id = v_player_id
    and video_id = p_video_id
  returning id into v_view_id;

  if v_view_id is null then
    raise exception 'Session de lecture introuvable.';
  end if;

  return v_view_id;
end;
$$;

revoke all on function public.track_video_view(bigint,bigint,int,int,boolean,int)
  from public, anon;
grant execute on function public.track_video_view(bigint,bigint,int,int,boolean,int)
  to authenticated;

-- ------------------------------------------------------------
-- 5) Unicité des lignes de performance saisies à la main.
--    Les index d'unicité portent sur source_file_name ; en SQL
--    NULL <> NULL, donc chaque enregistrement manuel créait une
--    ligne de plus. On utilise '' comme source manuelle.
-- ------------------------------------------------------------
update public.player_physical_measurements
  set source_file_name = '' where source_file_name is null;
update public.player_physical_tests
  set source_file_name = '' where source_file_name is null;

alter table public.player_physical_measurements
  alter column source_file_name set default '';
alter table public.player_physical_tests
  alter column source_file_name set default '';

-- ------------------------------------------------------------
-- 6) Profil /10 : ne pas écraser les scores importés.
--    Le trigger recalculait les 5 axes par rapport au groupe après
--    CHAQUE écriture, y compris sur les lignes fraîchement importées :
--    les valeurs du classeur (par ex. Endurance 4,7145 / Core 6,6525 sur
--    une fiche n'ayant que ces deux axes) étaient donc remplacées
--    silencieusement par un z-score recalculé sur le groupe.
--    Redéclaration à l'identique, avec une seule clause en plus.
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
    and stage = p_stage
    -- Une ligne importée depuis l'Excel du préparateur garde SES scores :
    -- le classeur est la source de vérité du Profil /10 quand il en fournit un.
    -- Les lignes saisies à la main restent calculées par rapport au groupe.
    and not (
      source = 'import_excel'
      and coalesce(profile_start, profile_agility, profile_speed,
                   profile_endurance, profile_core) is not null
    );
end;
$$;

revoke all on function public.recompute_player_profile_scores(bigint, text) from public, anon;
grant execute on function public.recompute_player_profile_scores(bigint, text) to authenticated;

commit;
