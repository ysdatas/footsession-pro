/* LMFC Performance — voir-video-page.js
   Voir une vidéo (voir-video), espace joueur.
   Script sorti de la page pour la politique de contenu (CSP : aucun script en ligne). */
/* Une vidéo source et ses séquences : le poste de travail affiche
   l'une ou l'autre (?seq=…), le retour du téléphone passe de l'une
   à l'autre. */
(async () => {
  const box = document.getElementById('vvContent');
  try {
    const player = await requirePlayer();
    if (!player) return;
    const params = new URLSearchParams(location.search);
    const { data: video, error } = await sb.from('player_videos').select('*')
      .eq('id', Number(params.get('id'))).eq('player_id', player.id).maybeSingle();
    if (error || !video) { box.innerHTML = '<div class="empty">Vidéo introuvable.</div>'; return; }
    const src = await videoUrl(video.storage_path);
    if (!src) throw new Error('Vidéo indisponible');
    document.title = `${video.titre} — LMFC Performance`;
    const { data: { session } } = await sb.auth.getSession();
    /* Précédent / Suivant : la liste de « Mes vidéos », dans son ordre, sous l'image avec
       Lecture/Pause et Stop (video-workspace.js). Chaque séquence est relue avec SES droits
       (ses vidéos seulement) et signée par le Worker : une autre ne s'ouvre jamais, même avec son adresse. */
    let list = [];
    try { list = JSON.parse(sessionStorage.getItem('lmfc-vv-list') || '[]'); } catch { list = []; }
    let idx = list.findIndex(x => x.id === video.id && x.seq === Number(params.get('seq')));
    let busy = false, ws = null;
    const mount = (v, url, seq) => mountVideoWorkspace(document.getElementById('vvContent'), {
      video: v, src: url, player, mode: 'player', userId: session.user.id,
      focusSeq: seq, backHref: 'mes-videos', history: true,
      nav: idx >= 0 && list.length > 1 ? { index: idx, total: list.length, label: list[idx].label, onStep: step } : null,
    });
    async function step(d) {
      const it = list[idx + d];
      if (!it || busy || (await ws?.canLeave()) === false) return;
      busy = true;
      try {
        const { data: v } = await sb.from('player_videos').select('*').eq('id', it.id).eq('player_id', player.id).maybeSingle();
        const url = v && await videoUrl(v.storage_path);
        if (!url) return toast('Séquence indisponible.', 'error');
        document.getElementById('playerVideo')?.pause();
        idx += d;
        ws = await mount(v, url, it.seq);
        initVideoTracking({ videoId: v.id, videoElId: 'playerVideo', seqId: it.seq || null });
        document.title = `${v.titre} — LMFC Performance`;
      } catch (err) {
        console.error('Séquence suivante illisible', err);
        toast('Séquence indisponible.', 'error');
      } finally { busy = false; }
    }
    ws = await mount(video, src, Number(params.get('seq')) || null);
    initVideoTracking({ videoId: video.id, videoElId: 'playerVideo', seqId: Number(params.get('seq')) || null });
  } catch (e) {
    console.error('voir-video', e);
    box.innerHTML = `<p class="text-danger">Impossible de charger la vidéo (${escapeHtml(e.message || 'erreur inconnue')}).</p>`;
  }
})();
