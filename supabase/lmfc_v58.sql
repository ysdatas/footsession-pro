/* ============================================================
   LMFC Performance — lmfc_v58.sql (n° 76) : suivi des vidéos regardées
   À exécuter après lmfc_v57.sql. Rejouable et transactionnelle.
   Retour arrière : lmfc_v58_retour.sql (la séquence de chaque lecture est oubliée).

   Le suivi existe depuis fix_audit_2026_09.sql (video_views, track_video_view) :
   chaque lecture cumule le temps réellement lu (un saut en avant ne compte que
   30 s au plus) et la position la plus loin atteinte. Cette migration ajoute :
     - video_views.sequence_id : la séquence que le joueur regardait (ouverte
       depuis « Mes vidéos »), pour compter les séquences distinctes regardées ;
     - track_video_view(…, p_sequence_id) : la note à l'ouverture, seulement
       si elle appartient à la vidéo et n'est pas réservée au staff ;
     - une règle unique, video_watch_status : une vidéo (ou une séquence) est
         « vue »      quand le temps lu atteint 80 % de sa durée (durée
                      inconnue : quand la fin a été atteinte) ;
         « ouverte »  quand elle a été lancée sans atteindre ce seuil ;
         « a_voir »   quand elle n'a jamais été lancée ;
     - video_watch_summary() : par joueur, vidéos envoyées, vues, ouvertes, à
       voir, dernière lecture (liste des joueurs) ;
     - video_watch_detail(joueur) : par vidéo, lectures, dernière lecture,
       temps lu, progression, statut, séquences regardées (fiche du joueur).
   Mêmes droits que la lecture de video_views : admin, coach, analyste,
   lecteur, sur les joueurs qu'ils voient (my_visible_players).
   ============================================================ */
begin;

alter table public.video_views add column if not exists sequence_id bigint references public.video_sequences on delete set null;
create index if not exists video_views_video_idx on public.video_views (video_id);

create or replace function public.video_watch_status(p_watched numeric, p_duration numeric, p_completed boolean, p_views integer)
returns text language sql immutable set search_path = public as $$
  select case
    when coalesce(p_views, 0) = 0 then 'a_voir'
    when coalesce(p_duration, 0) > 0 and coalesce(p_watched, 0) >= 0.8 * p_duration then 'vue'
    when coalesce(p_duration, 0) = 0 and coalesce(p_completed, false) then 'vue'
    else 'ouverte'
  end;
$$;

-- Nouvelle signature (p_sequence_id) : l'ancienne est retirée, sinon l'appel serait ambigu.
drop function if exists public.track_video_view(bigint, bigint, int, int, boolean, int);
create or replace function public.track_video_view(
  p_video_id bigint,
  p_view_id  bigint default null,
  p_position int default 0,
  p_delta    int default 0,
  p_completed boolean default false,
  p_duration int default null,
  p_sequence_id bigint default null
)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_player_id bigint;
  v_view_id bigint;
  v_seq bigint;
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

  -- Nouvelle session de lecture ; la séquence regardée, si elle est de cette vidéo et visible du joueur.
  if p_view_id is null then
    select s.id into v_seq from public.video_sequences s
     where s.id = p_sequence_id and s.video_id = p_video_id and not s.staff_only;
    insert into public.video_views (video_id, player_id, started_at, last_heartbeat_at, sequence_id)
    values (p_video_id, v_player_id, now(), now(), v_seq)
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
revoke all on function public.track_video_view(bigint, bigint, int, int, boolean, int, bigint) from public, anon;
grant execute on function public.track_video_view(bigint, bigint, int, int, boolean, int, bigint) to authenticated;

-- Par vidéo d'un joueur : lectures, temps lu, statut ; séquences envoyées (créées par le staff, visibles du joueur) et regardées.
create or replace function public.video_watch_detail(p_player bigint)
returns table (video_id bigint, titre text, created_at timestamptz, duree_sec integer, lectures integer, derniere timestamptz,
               regarde_sec integer, progression integer, statut text, sequences integer, sequences_vues integer)
language sql stable security definer set search_path = public as $$
  with droit as (
    select public.is_video_stats_staff() and p_player in (select public.my_visible_players()) ok,
           (select pl.auth_user_id from public.players pl where pl.id = p_player) compte),
  vids as (
    select v.id, v.titre, v.created_at, v.duree_sec,
           count(w.id)::int lectures, max(coalesce(w.last_heartbeat_at, w.started_at)) derniere,
           coalesce(sum(w.watched_seconds), 0)::int regarde, bool_or(w.completed) fini
      from public.player_videos v left join public.video_views w on w.video_id = v.id and w.player_id = v.player_id, droit
     where droit.ok and v.player_id = p_player
     group by v.id),
  seqs as (
    select s.video_id, count(*)::int n,
           count(*) filter (where public.video_watch_status(x.regarde, s.end_sec - s.start_sec, x.fini, x.lectures) = 'vue')::int vues
      from public.video_sequences s cross join droit
      left join lateral (select count(*)::int lectures, coalesce(sum(w.watched_seconds), 0) regarde, bool_or(w.completed) fini
                           from public.video_views w where w.sequence_id = s.id) x on true
     where droit.ok and s.player_id = p_player and not s.staff_only and s.created_by is distinct from droit.compte
     group by s.video_id)
  select v.id, v.titre, v.created_at, v.duree_sec, v.lectures, v.derniere, v.regarde,
         case when coalesce(v.duree_sec, 0) > 0 then least(100, round(100.0 * v.regarde / v.duree_sec))::int end,
         public.video_watch_status(v.regarde, v.duree_sec, v.fini, v.lectures),
         coalesce(s.n, 0), coalesce(s.vues, 0)
    from vids v left join seqs s on s.video_id = v.id
   order by v.created_at desc;
$$;
revoke all on function public.video_watch_detail(bigint) from public, anon;
grant execute on function public.video_watch_detail(bigint) to authenticated;

-- Par joueur visible : le résumé des vidéos qui lui ont été envoyées (liste des joueurs).
create or replace function public.video_watch_summary()
returns table (player_id bigint, videos integer, vues integer, ouvertes integer, a_voir integer, derniere timestamptz)
language sql stable security definer set search_path = public as $$
  with v as (
    select v.player_id, public.video_watch_status(coalesce(sum(w.watched_seconds), 0), v.duree_sec, bool_or(w.completed), count(w.id)::int) statut,
           max(coalesce(w.last_heartbeat_at, w.started_at)) derniere
      from public.player_videos v left join public.video_views w on w.video_id = v.id and w.player_id = v.player_id
     where public.is_video_stats_staff() and v.club_id = public.my_club_id()
       and v.player_id in (select public.my_visible_players())
     group by v.id)
  select player_id, count(*)::int, count(*) filter (where statut = 'vue')::int, count(*) filter (where statut = 'ouverte')::int,
         count(*) filter (where statut = 'a_voir')::int, max(derniere)
    from v group by player_id;
$$;
revoke all on function public.video_watch_summary() from public, anon;
grant execute on function public.video_watch_summary() to authenticated;

commit;
