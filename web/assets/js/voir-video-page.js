/* LMFC Performance — voir-video-page.js
   Voir une vidéo (voir-video.html), espace joueur.
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
    const mount = (v, url, seq) => mountVideoWorkspace(document.getElementById('vvContent'), {
      video: v, src: url, player, mode: 'player', userId: session.user.id,
      focusSeq: seq, backHref: 'mes-videos.html', history: true,
    });
    let ws = await mount(video, src, Number(params.get('seq')) || null);
    initVideoTracking({ videoId: video.id, videoElId: 'playerVideo' });

    /* Précédent / Suivant : la liste de « Mes vidéos », dans son ordre. Chaque
       séquence est relue avec SES droits (ses vidéos seulement) et signée par
       le Worker : une autre ne s'ouvre jamais, même avec son adresse. */
    let list = [];
    try { list = JSON.parse(sessionStorage.getItem('lmfc-vv-list') || '[]'); } catch { list = []; }
    let idx = list.findIndex(x => x.id === video.id && x.seq === Number(params.get('seq')));
    const nav = document.getElementById('vvNav');
    let busy = false;
    const renderNav = () => {
      nav.hidden = idx < 0 || list.length < 2;
      if (nav.hidden) return;
      nav.innerHTML = `<button class="btn btn-sm" type="button" data-step="-1"${idx > 0 ? '' : ' disabled'} aria-label="Séquence précédente">‹ Précédent</button>
        <span class="ws-pos" aria-live="polite"><strong>${idx + 1} / ${list.length}</strong><span>${escapeHtml(list[idx].label || 'Séquence')}</span></span>
        <button class="btn btn-sm" type="button" data-step="1"${idx < list.length - 1 ? '' : ' disabled'} aria-label="Séquence suivante">Suivant ›</button>`;
    };
    nav.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-step]'), it = b && !b.disabled && list[idx + Number(b.dataset.step)];
      if (!it || busy || ws?.canLeave() === false) return;
      busy = true;
      try {
        const { data: v } = await sb.from('player_videos').select('*').eq('id', it.id).eq('player_id', player.id).maybeSingle();
        const url = v && await videoUrl(v.storage_path);
        if (!url) return toast('Séquence indisponible.', 'error');
        document.getElementById('playerVideo')?.pause();
        idx += Number(b.dataset.step);
        ws = await mount(v, url, it.seq);
        initVideoTracking({ videoId: v.id, videoElId: 'playerVideo' });
        document.title = `${v.titre} — LMFC Performance`;
        renderNav();
      } catch (err) {
        console.error('Séquence suivante illisible', err);
        toast('Séquence indisponible.', 'error');
      } finally { busy = false; }
    });
    renderNav();
  } catch (e) {
    console.error('voir-video', e);
    box.innerHTML = `<p class="text-danger">Impossible de charger la vidéo (${escapeHtml(e.message || 'erreur inconnue')}).</p>`;
  }
})();
