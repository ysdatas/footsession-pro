/* ============================================================
   FootSession Pro — video-tracking.js
   Enregistre les sessions de visionnage (vue, temps regardé,
   progression max) directement dans Supabase, protégé par RLS :
   un joueur ne peut écrire que sur SES propres lignes video_views
   (policy "views_insert_player" / "views_update_player").
   ============================================================ */

function initVideoTracking({ videoId, playerId, videoElId }) {
  const video = document.getElementById(videoElId);
  if (!video) return;

  let viewId = null;
  let lastReported = 0;
  let heartbeatTimer = null;

  async function startView() {
    try {
      const { data, error } = await sb.from('video_views')
        .insert({ video_id: videoId, player_id: playerId })
        .select('id').single();
      if (error) throw error;
      viewId = data.id;
      lastReported = video.currentTime;
    } catch (e) {
      // Silencieux : le visionnage doit rester fluide même si le suivi échoue.
      console.warn('video-tracking: startView failed', e);
    }
  }

  async function sendHeartbeat() {
    if (!viewId) return;
    const position = Math.floor(video.currentTime);
    const delta = Math.max(0, Math.min(30, Math.round(position - lastReported)));
    lastReported = position;
    const completed = !!(video.duration && position >= video.duration * 0.9);

    try {
      const { data: current } = await sb.from('video_views')
        .select('watched_seconds, max_position_seconds').eq('id', viewId).single();
      await sb.from('video_views').update({
        watched_seconds: (current?.watched_seconds || 0) + delta,
        max_position_seconds: Math.max(current?.max_position_seconds || 0, position),
        last_heartbeat_at: new Date().toISOString(),
        completed,
      }).eq('id', viewId);
    } catch (e) {
      console.warn('video-tracking: heartbeat failed', e);
    }
  }

  video.addEventListener('loadedmetadata', async () => {
    if (video.duration && isFinite(video.duration)) {
      try {
        await sb.from('player_videos').update({ duree_sec: Math.round(video.duration) })
          .eq('id', videoId).is('duree_sec', null);
      } catch (e) { /* pas grave si ça échoue */ }
    }
  });

  video.addEventListener('play', () => {
    if (!viewId) startView();
    if (!heartbeatTimer) heartbeatTimer = setInterval(sendHeartbeat, 5000);
  });

  video.addEventListener('pause', () => {
    sendHeartbeat();
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  });

  video.addEventListener('ended', sendHeartbeat);

  window.addEventListener('beforeunload', () => { sendHeartbeat(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendHeartbeat();
  });
}
