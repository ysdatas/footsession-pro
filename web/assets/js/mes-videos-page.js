/* LMFC Performance — mes-videos-page.js
   Mes vidéos (mes-videos.html), espace joueur.
   Script sorti de la page pour la politique de contenu (CSP : aucun script en ligne). */
/* Les vidéos envoyées par le staff (sources) et les séquences créées
   par le joueur : deux rubriques, une carte par contenu, jamais de
   doublon. Une séquence s'ouvre directement (voir-video.html?seq=…). */
const pv = { videos: [], seqs: [], urls: new Map(), tab: new URLSearchParams(location.search).get('tab') === 'seqs' ? 'seqs' : 'videos', filter: 'all' };
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/* Séquence ouverte : la liste affichée, dans son ordre, passe au lecteur
   (voir-video.html) pour Précédent / Suivant. */
document.getElementById('pvContent').addEventListener('click', (e) => {
  if (!e.target.closest('a.vp-card[href*="&seq="]')) return;
  const list = [...document.querySelectorAll('#pvContent a.vp-card[href*="&seq="]')].map(a => {
    const q = new URL(a.href).searchParams;
    return { id: Number(q.get('id')), seq: Number(q.get('seq')), label: a.querySelector('strong')?.textContent || '' };
  });
  try { sessionStorage.setItem('lmfc-vv-list', JSON.stringify(list)); } catch { /* stockage bloqué : pas de Précédent / Suivant */ }
});

(async () => {
  const box = document.getElementById('pvContent');
  try {
    const player = await requirePlayer();
    if (!player) return;
    const [{ data: videos, error }, { data: seqs }] = await Promise.all([
      sb.from('player_videos').select('id, titre, description, created_at, storage_path, thumb')
        .eq('player_id', player.id).order('created_at', { ascending: false }),
      sb.from('video_sequences').select('*').eq('player_id', player.id),
    ]);
    if (error) throw error;
    pv.videos = videos || [];
    pv.seqs = (seqs || []).sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
    if (pv.videos.length) {
      try {
        const urls = await videoUrls(pv.videos.map(v => v.storage_path));
        pv.videos.forEach(v => urls.has(v.storage_path) && pv.urls.set(v.id, urls.get(v.storage_path)));
      } catch (e) { console.warn('Miniatures indisponibles', e); }   // la liste reste utilisable
    }
    const answered = pv.seqs.filter(s => seqStatus(s) === 'answered').length;
    document.getElementById('pvSub').textContent = `Bonjour ${player.prenom || player.nom}`
      + (answered ? ` — ${plural(answered, 'retour', 'retours')} de ton staff t’attend${answered > 1 ? 'ent' : ''}.` : ' — ouvre une vidéo, sélectionne une portion : elle devient ta séquence.');
    render();
  } catch (e) {
    console.error('mes-videos', e);
    box.innerHTML = `<p class="text-danger">${escapeHtml(e.message)}</p>`;
  }
})();

function render() {
  document.querySelector('[data-count="videos"]').textContent = pv.videos.length || '';
  document.querySelector('[data-count="seqs"]').textContent = pv.seqs.length || '';
  document.querySelectorAll('#pvTabs [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === pv.tab)));
  document.getElementById('pvChips').classList.toggle('hidden', pv.tab !== 'seqs' || !pv.seqs.length);
  document.querySelectorAll('#pvChips [data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === pv.filter)));
  const box = document.getElementById('pvContent');
  if (pv.tab === 'videos') {
    box.innerHTML = pv.videos.length ? `<div class="vp-cards">${pv.videos.map(v => {
      const list = pv.seqs.filter(s => s.video_id === v.id);
      const back = list.filter(s => seqStatus(s) === 'answered').length;
      return `<a class="vp-card" href="voir-video.html?id=${v.id}">
        ${thumbHtml(pv.urls.get(v.id), 1, 'Source', v.thumb)}
        <span class="vp-card-body">
          <span class="vp-card-top"><strong>${escapeHtml(v.titre)}</strong>${back ? `<span class="vw-status is-answered">${plural(back, 'retour', 'retours')}</span>` : ''}</span>
          <span class="vp-card-meta">${escapeHtml(new Date(v.created_at).toLocaleDateString('fr-FR'))} · ${list.length ? plural(list.length, 'séquence', 'séquences') : 'pas encore de séquence'}</span>
          ${v.description ? `<em>${escapeHtml(v.description).replace(/\n/g, '<br>')}</em>` : ''}
        </span>
      </a>`;
    }).join('')}</div>` : '<div class="empty">Aucune vidéo pour le moment. Ton staff ne t’a encore rien envoyé.</div>';
  } else {
    const list = pv.seqs.filter(s => pv.filter === 'all' || (pv.filter === 'draft' ? !s.submitted_at : !!s.submitted_at));
    box.innerHTML = list.length ? `<div class="vp-cards">${list.map(s => {
      const v = pv.videos.find(x => x.id === s.video_id), len = s.end_sec - s.start_sec, n = (s.drawings || []).length;
      return `<a class="vp-card" href="voir-video.html?id=${s.video_id}&seq=${s.id}">
        ${thumbHtml(pv.urls.get(s.video_id), s.start_sec, fmtDur(len), s.thumb)}
        <span class="vp-card-body">
          <span class="vp-card-top"><strong>${escapeHtml(s.label || 'Séquence')}</strong>${statusPill(s)}</span>
          <span class="vp-card-meta">${escapeHtml(v?.titre || 'Vidéo')} · ${n ? plural(n, 'annotation', 'annotations') : 'sans habillage'}</span>
        </span>
      </a>`;
    }).join('')}</div>` : `<div class="empty">${pv.seqs.length ? 'Aucune séquence dans ce filtre.' : 'Pas encore de séquence. Ouvre une vidéo, puis « Sélectionner une portion ».'}</div>`;
  }
  loadThumbs(box);
}

document.getElementById('pvTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  pv.tab = b.dataset.tab;
  const u = new URL(location.href);
  if (pv.tab === 'seqs') u.searchParams.set('tab', 'seqs'); else u.searchParams.delete('tab');
  history.replaceState(null, '', u);
  render();
});
document.getElementById('pvChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]'); if (!b) return;
  pv.filter = b.dataset.filter; render();
});
