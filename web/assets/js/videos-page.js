/* ============================================================
   LMFC Performance — videos-page.js (staff)
   Organisation progressive, pensée pour le téléphone :
     1. Vue d'ensemble : « À traiter » (séquences envoyées par les
        joueurs, pas encore commentées) puis la liste des joueurs,
        chacun résumé en une ligne (« 2 vidéos · 3 séquences » + « 1 à
        traiter »).
     2. Un joueur : ses vidéos rangées par vidéo, avec leurs séquences
        (player-videos.js, le même affichage que l'onglet Vidéos de la
        fiche joueur).
     3. Un contenu s'ouvre dans le poste de travail (video-workspace.js).
   Le retour du téléphone remonte d'un niveau (?player=…).
   Sécurité : RLS (player_videos, video_sequences, video_views).
   ============================================================ */

let myProfile = null;
let playersCache = [];
let videosCache = [];
let seqsCache = [];
let urlCache = new Map();   // id vidéo → URL signée (miniatures, lecture)
let vpQuery = pageState().vpQuery || '';
const view = { player: null };
let navDepth = 0;           // niveaux ouverts dans cette page (pour le bouton retour)

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  myProfile = ctx.profile;
  view.player = Number(new URLSearchParams(location.search).get('player') || 0) || null;

  document.getElementById('uName').textContent = myProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[myProfile.role] || myProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (myProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  if (canManageVideos(myProfile.role)) {
    const btn = document.getElementById('btnNewVideo');
    btn.classList.remove('hidden');
    btn.addEventListener('click', () => openVideoUpload({
      players: playersCache, playerId: view.player, profile: myProfile, onDone: loadVideos,
    }));
  }

  const { data: players, error: playersError } = await byPlayerTeam(sb.from('players').select('id, nom, prenom, club_id, auth_user_id').order('nom'));
  if (playersError) console.error('Joueurs illisibles', playersError);
  playersCache = players || [];

  history.replaceState({ vp: 1, ...view }, '', location.href);
  await loadVideos();
})();

const fullName = playerFullName;   // app.js
const initials = (p) => `${(p?.prenom || '')[0] || ''}${(p?.nom || '')[0] || ''}`.toUpperCase() || '?';
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const shortDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

/* ---------- Chargement (vue d'ensemble) ---------- */
async function loadVideos() {
  const box = document.getElementById('vpView');
  try {
    const ids = playersCache.map(p => p.id);
    const [vRes, sRes] = await Promise.all([
      sb.from('player_videos').select('id, player_id, titre, storage_path, created_at').in('player_id', ids).order('created_at', { ascending: false }),
      sb.from('video_sequences').select('*').in('player_id', ids).order('start_sec'),
    ]);
    if (vRes.error) throw vRes.error;
    if (sRes.error) console.warn('Séquences indisponibles (platform_v2.sql non passée ?) :', sRes.error.message);
    videosCache = vRes.data || [];
    seqsCache = sRes.data || [];
    await signUrls(videosCache.filter(v => toSeeOf(seqsCache).some(s => s.video_id === v.id)));
    render();
  } catch (e) {
    console.error('Vidéos illisibles', e);
    box.innerHTML = `<p class="text-danger">${escapeHtml(e.message)}</p>`;
  }
}
/* URL signées en une seule requête (miniatures de « À traiter »). */
async function signUrls(videos) {
  const missing = videos.filter(v => !urlCache.has(v.id));
  if (!missing.length) return;
  try {
    const urls = await videoUrls(missing.map(v => v.storage_path));
    missing.forEach(v => urls.has(v.storage_path) && urlCache.set(v.id, urls.get(v.storage_path)));
  } catch (e) { console.warn('Liens de lecture indisponibles', e); }
}

/* ---------- Navigation : ensemble → joueur ---------- */
function goTo(player, push = true) {
  view.player = player;
  const u = new URL(location.href);
  if (player) u.searchParams.set('player', player); else u.searchParams.delete('player');
  u.searchParams.delete('tab');
  if (push) { navDepth++; history.pushState({ vp: 1, ...view }, '', u); } else history.replaceState({ vp: 1, ...view }, '', u);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.addEventListener('popstate', (e) => {
  if (!e.state?.vp) return;
  navDepth = Math.max(0, navDepth - 1);
  if (document.getElementById('wsModal')?.classList.contains('open')) closeModal('wsModal');
  view.player = e.state.player || null;
  render();
});

/* ---------- Rendu ---------- */
const toSeeOf = (list) => list.filter(seqToSee).sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
/* Séquence à traiter : miniature, titre, joueur, vidéo, statut, note du joueur. */
function seqCard(s) {
  const v = videosCache.find(x => x.id === s.video_id), len = s.end_sec - s.start_sec, note = (s.player_note || '').trim();
  const n = (s.drawings || []).length;
  return `<button type="button" class="vp-card" data-open-video="${s.video_id}" data-seq="${s.id}">
    ${thumbHtml(urlCache.get(s.video_id), s.start_sec, fmtDur(len))}
    <span class="vp-card-body">
      <span class="vp-card-top"><strong>${escapeHtml(s.label || 'Séquence')}</strong>${statusPill(s, 'staff')}</span>
      <span class="vp-card-meta">${escapeHtml(fullName(playersCache.find(p => p.id === s.player_id)))} · ${escapeHtml(v?.titre || 'Vidéo')} · ${n ? plural(n, 'annotation', 'annotations') : 'sans habillage'}${s.submitted_at ? ` · envoyée le ${escapeHtml(shortDate(s.submitted_at))}` : ''}</span>
      ${note ? `<em>« ${escapeHtml(note.length > 90 ? `${note.slice(0, 87)}…` : note)} »</em>` : ''}
    </span>
  </button>`;
}

function render() {
  const p = view.player && playersCache.find(x => x.id === view.player);
  document.getElementById('vpBack').classList.toggle('hidden', !p);
  const back = document.getElementById('videoBackLink');
  back.classList.toggle('hidden', !p);
  if (p) {
    back.href = `player-performance.html?id=${p.id}`;
    document.getElementById('videosTitle').textContent = fullName(p);
    document.getElementById('videosSub').textContent = 'Chargement…';
    return mountPlayerVideos(document.getElementById('vpView'), {
      player: p, profile: myProfile, upload: false,   // l'envoi est dans l'en-tête de la page
      onChange: ({ videos, seqs }) => {
        const todo = toSeeOf(seqs).length;
        document.getElementById('videosSub').textContent =
          `${plural(videos.length, 'vidéo', 'vidéos')} · ${plural(seqs.length, 'séquence', 'séquences')}${todo ? ` · ${todo} à traiter` : ''}`;
      },
    });
  }
  view.player = null;
  unmountPlayerVideos();
  document.getElementById('videosTitle').textContent = 'Vidéos joueurs';
  const todo = toSeeOf(seqsCache);
  document.getElementById('videosSub').textContent = todo.length
    ? `${plural(todo.length, 'séquence envoyée', 'séquences envoyées')} par vos joueurs à traiter.`
    : 'Rien à traiter pour l’instant : les séquences envoyées par vos joueurs apparaîtront ici.';

  const stats = playersCache.map(pl => {
    const vids = videosCache.filter(v => v.player_id === pl.id), seqs = seqsCache.filter(s => s.player_id === pl.id);
    const last = [...vids.map(v => v.created_at), ...seqs.map(s => s.submitted_at || s.created_at)].filter(Boolean).sort().pop();
    return { pl, vids: vids.length, seqs: seqs.length, todo: seqs.filter(seqToSee).length, last };
  });
  const shown = stats
    .filter(x => !vpQuery || fullName(x.pl).toLowerCase().includes(vpQuery))
    .sort((a, b) => (b.todo - a.todo) || String(b.last || '').localeCompare(String(a.last || '')) || fullName(a.pl).localeCompare(fullName(b.pl), 'fr'));
  const box = document.getElementById('vpView');
  box.innerHTML = `
    ${todo.length ? `<section class="vp-section" aria-labelledby="vpTodoTitle">
      <h2 id="vpTodoTitle">À traiter <span class="vw-status is-sent">${todo.length}</span></h2>
      <p class="pvx-lead">Séquences que vos joueurs vous ont envoyées, en attente de votre retour.</p>
      <div class="vp-cards">${todo.map(seqCard).join('')}</div>
    </section>` : ''}
    <section class="vp-section" aria-labelledby="vpPlayersTitle">
      <div class="vp-section-head">
        <h2 id="vpPlayersTitle">Joueurs</h2>
        <input type="search" id="vpSearch" value="${escapeHtml(vpQuery)}" placeholder="Rechercher un joueur" aria-label="Rechercher un joueur">
      </div>
      <div class="vp-players">${shown.length ? shown.map(x => `
        <button type="button" class="vp-player" data-player="${x.pl.id}">
          <span class="vp-avatar" aria-hidden="true">${escapeHtml(initials(x.pl))}</span>
          <span class="vp-player-main">
            <strong>${escapeHtml(fullName(x.pl))}</strong>
            <span>${x.vids || x.seqs ? `${plural(x.vids, 'vidéo', 'vidéos')} · ${plural(x.seqs, 'séquence', 'séquences')}` : 'Aucune vidéo'}</span>
          </span>
          ${x.todo ? `<span class="vw-status is-sent">${x.todo} à traiter</span>` : x.last ? `<span class="vp-last">${escapeHtml(shortDate(x.last))}</span>` : ''}
          <span class="vp-chevron" aria-hidden="true">›</span>
        </button>`).join('') : '<p class="vp-empty">Aucun joueur ne correspond.</p>'}</div>
    </section>`;
  loadThumbs(box);
}

document.getElementById('vpView').addEventListener('click', (e) => {
  if (view.player) return;   // vue d'un joueur : player-videos.js gère ses clics
  const open = e.target.closest('[data-open-video]');
  if (open) {
    const v = videosCache.find(x => x.id === Number(open.dataset.openVideo));
    if (!v) return;
    return openVideoWorkspace({ video: v, url: urlCache.get(v.id), player: playersCache.find(p => p.id === v.player_id),
      profile: myProfile, seqId: Number(open.dataset.seq) || null, onChange: loadVideos });
  }
  const pl = e.target.closest('[data-player]');
  if (pl) return goTo(Number(pl.dataset.player));
});
document.getElementById('vpView').addEventListener('input', (e) => {
  if (!e.target.matches('#vpSearch')) return;
  vpQuery = e.target.value.trim().toLowerCase();
  savePageState({ vpQuery });
  const pos = e.target.selectionStart;
  render();
  const input = document.getElementById('vpSearch');
  input.focus(); input.setSelectionRange(pos, pos);
});
document.getElementById('vpBack').addEventListener('click', () => {
  if (navDepth > 0) history.back();
  else goTo(null, false);
});
