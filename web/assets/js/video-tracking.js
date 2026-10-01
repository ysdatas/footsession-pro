/* ============================================================
   LMFC Performance — video-tracking.js
   Enregistre les sessions de visionnage via la RPC
   public.track_video_view() : le compte joueur n'a AUCUN droit
   de lecture ni d'écriture direct sur video_views (les
   statistiques internes sont réservées au staff).
   Voir supabase/fix_audit_2026_09.sql.
   ============================================================ */

function initVideoTracking({ videoId, videoElId }) {
  const video = document.getElementById(videoElId);
  if (!video) return;

  let viewId = null;
  let lastReported = 0;
  let heartbeatTimer = null;
  let starting = null;

  async function track(payload) {
    const { data, error } = await sb.rpc('track_video_view', {
      p_video_id: videoId,
      p_view_id: viewId,
      p_position: Math.max(0, Math.floor(video.currentTime || 0)),
      p_delta: 0,
      p_completed: false,
      p_duration: null,
      ...payload,
    });
    if (error) throw error;
    return data;
  }

  async function startView() {
    if (viewId || starting) return starting;
    starting = (async () => {
      try {
        const duration = Number.isFinite(video.duration) ? Math.round(video.duration) : null;
        viewId = await track({ p_view_id: null, p_duration: duration });
        lastReported = Math.floor(video.currentTime || 0);
      } catch (e) {
        // Silencieux : le visionnage doit rester fluide même si le suivi échoue.
        console.warn('video-tracking: startView failed', e);
      } finally {
        starting = null;
      }
    })();
    return starting;
  }

  async function sendHeartbeat() {
    if (!viewId) return;
    const position = Math.floor(video.currentTime || 0);
    // Un saut en avant ne doit pas compter comme du temps regardé :
    // le delta est plafonné à 30 s (la période de heartbeat est de 5 s).
    const delta = Math.max(0, Math.min(30, position - lastReported));
    lastReported = position;
    const completed = !!(video.duration && position >= video.duration * 0.9);

    try {
      await track({ p_position: position, p_delta: delta, p_completed: completed });
    } catch (e) {
      console.warn('video-tracking: heartbeat failed', e);
    }
  }

  video.addEventListener('play', async () => {
    await startView();
    if (!heartbeatTimer) heartbeatTimer = setInterval(sendHeartbeat, 5000);
  });

  video.addEventListener('pause', () => {
    sendHeartbeat();
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  });

  video.addEventListener('ended', sendHeartbeat);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendHeartbeat();
  });
  window.addEventListener('pagehide', () => { sendHeartbeat(); });
}
