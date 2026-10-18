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
   Lecteur : consultation seule (ni envoi, ni retour, ni statut « Vu »).
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

  history.replaceState({ vp: 1, ...view }, '', location.href);
  // Joueurs, vidéos et séquences partent ensemble (avant : les joueurs d'abord).
  await loadVideos(byPlayerTeam(sb.from('players').select('id, nom, prenom, club_id, auth_user_id').order('nom')));
  // Retour arrière : la vue affichée est relue (app.js).
  onRestore(() => (view.player ? pvLoad() : loadVideos(byPlayerTeam(sb.from('players').select('id, nom, prenom, club_id, auth_user_id').order('nom')))));
})();

const fullName = playerFullName;   // app.js
const initials = (p) => `${(p?.prenom || '')[0] || ''}${(p?.nom || '')[0] || ''}`.toUpperCase() || '?';
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const shortDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

/* ---------- Chargement (vue d'ensemble) ----------
   Mesure (lot 2) : les miniatures de « À traiter » lisaient chacune la vidéo
   source (15 Mo pour 8 séquences). Les séquences arrivent sans miniature ni
   lien ; seules celles à traiter reçoivent ensuite leur image fixe (thumb),
   et un lien de lecture seulement s'il leur en manque une. */
async function loadVideos(playersQuery = null) {
  const box = document.getElementById('vpView');
  try {
    const [pRes, vRes, sRes] = await Promise.all([
      playersQuery || { data: playersCache },
      sb.from('player_videos').select('id, player_id, titre, storage_path, created_at, thumb').order('created_at', { ascending: false }),
      sb.from('video_sequences').select(SEQ_LIST_COLS).order('start_sec'),
    ]);
    if (pRes.error) console.error('Joueurs illisibles', pRes.error);
    if (vRes.error) throw vRes.error;
    if (sRes.error) console.warn('Séquences indisponibles (platform_v2.sql non passée ?) :', sRes.error.message);
    playersCache = pRes.data || [];
    const ids = new Set(playersCache.map(p => p.id));   // joueurs de l'équipe choisie
    videosCache = (vRes.data || []).filter(v => ids.has(v.player_id));
    seqsCache = (sRes.data || []).filter(s => ids.has(s.player_id));
    render();
    // Afficher d'abord : miniatures fixes, puis liens de lecture, arrivent en fond.
    // (Avant : la page attendait le Worker et restait sur « Chargement… » s'il ne répondait pas.)
    const todo = toSeeOf(seqsCache);
    const thumbs = await seqThumbs(todo);
    todo.forEach(s => { s.thumb = thumbs.get(s.id) || null; });
    patchThumbs(box);
    await signUrls(videosCache.filter(v => todo.some(s => s.video_id === v.id && !s.thumb)));
    patchThumbs(box);
    signUrls(videosCache.filter(v => todo.some(s => s.video_id === v.id)));   // prêts avant le clic
  } catch (e) {
    console.error('Vidéos illisibles', e);
    box.innerHTML = `<p class="text-danger">${escapeHtml(e.message)} <button class="btn btn-sm" type="button" data-retry>Réessayer</button></p>`;
    box.querySelector('[data-retry]').addEventListener('click', () => {
      box.innerHTML = '<div class="empty">Chargement…</div>';
      loadVideos(byPlayerTeam(sb.from('players').select('id, nom, prenom, club_id, auth_user_id').order('nom')));
    });
  }
}
/* Vignettes arrivées après l'affichage (vue d'ensemble) : seules elles changent,
   la recherche en cours et le défilement restent en place. */
function patchThumbs(box) {
  if (view.player) return;
  box.querySelectorAll('.vp-card[data-seq]').forEach(card => {
    const s = seqsCache.find(x => x.id === Number(card.dataset.seq));
    const old = card.querySelector('.vthumb');
    if (!s || !old) return;
    const tmp = document.createElement('span');
    tmp.innerHTML = thumbHtml(urlCache.get(s.video_id), s.start_sec, fmtDur(s.end_sec - s.start_sec), s.thumb);
    if (old.outerHTML !== tmp.firstElementChild.outerHTML) old.replaceWith(tmp.firstElementChild);
  });
  loadThumbs(box);
}
/* Miniatures fixes des séquences affichées (lmfc_v18.sql), en une requête. */
async function seqThumbs(list) {
  if (!list.length) return new Map();
  const { data, error } = await sb.from('video_sequences').select('id, thumb').in('id', list.map(s => s.id)).not('thumb', 'is', null);
  if (error) { console.warn('Miniatures indisponibles', error.message); return new Map(); }
  return new Map((data || []).map(r => [r.id, r.thumb]));
}
/* URL signées en une seule requête (miniatures sans image fixe ; la lecture signe à l'ouverture). */
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
    ${thumbHtml(urlCache.get(s.video_id), s.start_sec, fmtDur(len), s.thumb)}
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
  const todo = toSeeOf(seqsCache), reader = isReader(myProfile.role);
  document.getElementById('videosSub').textContent = reader
    ? (todo.length ? `${plural(todo.length, 'séquence envoyée', 'séquences envoyées')} par les joueurs, en attente d’un retour du staff.` : 'Consultation : vidéos et séquences des joueurs du club.')
    : todo.length
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
      <p class="pvx-lead">${reader ? 'Séquences envoyées par les joueurs, en attente d’un retour du staff.' : 'Séquences que vos joueurs vous ont envoyées, en attente de votre retour.'}</p>
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
      profile: myProfile, seqId: Number(open.dataset.seq) || null, onChange: loadVideos,
      // « À traiter », dans l'ordre affiché : Précédent / Suivant dans le lecteur.
      playlist: seqPlaylist([...document.querySelectorAll('#vpView [data-open-video][data-seq]')], (b) => {
        const s = seqsCache.find(x => x.id === Number(b.dataset.seq)), vid = s && videosCache.find(x => x.id === s.video_id);
        return vid && { seqId: s.id, video: vid, player: playersCache.find(p => p.id === vid.player_id), label: s.label, url: urlCache.get(vid.id) };
      }) });
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
