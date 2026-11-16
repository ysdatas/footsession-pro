/* Retour arrière de lmfc_v58.sql (suivi des vidéos regardées). Rejouable.
   Retire les résumés et la règle, et oublie la séquence de chaque lecture (les
   lectures restent, avec leur temps et leur position). track_video_view reprend
   sa définition de fix_audit_2026_09.sql, à l'identique. */
begin;
drop function if exists public.video_watch_summary();
drop function if exists public.video_watch_detail(bigint);
drop function if exists public.track_video_view(bigint, bigint, int, int, boolean, int, bigint);
CREATE OR REPLACE FUNCTION public.track_video_view(p_video_id bigint, p_view_id bigint DEFAULT NULL::bigint, p_position integer DEFAULT 0, p_delta integer DEFAULT 0, p_completed boolean DEFAULT false, p_duration integer DEFAULT NULL::integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
revoke all on function public.track_video_view(bigint, bigint, int, int, boolean, int) from public, anon;
grant execute on function public.track_video_view(bigint, bigint, int, int, boolean, int) to authenticated;
drop function if exists public.video_watch_status(numeric, numeric, boolean, integer);
drop index if exists public.video_views_video_idx;
alter table public.video_views drop column if exists sequence_id;
commit;
