/* ============================================================
   LMFC Performance — videos-page.js (staff)
   Organisation progressive, pensée pour le téléphone :
     1. Vue d'ensemble : « À voir » (séquences envoyées par les joueurs,
        pas encore commentées) puis la liste des joueurs, chacun résumé
        en une ligne (« 2 vidéos · 3 séquences » + « 1 à voir »).
     2. Un joueur : trois rubriques — À voir, Séquences, Vidéos.
     3. Un contenu s'ouvre dans le poste de travail (video-workspace.js) :
        vidéo source ou séquence, habillage du joueur, retour du staff.
   Le retour du téléphone remonte d'un niveau (?player=…&tab=…).
   Sécurité : RLS (player_videos, video_sequences, video_views).
   ============================================================ */

let myProfile = null;
let playersCache = [];
let videosCache = [];
let seqsCache = [];
let urlCache = new Map();   // id vidéo → URL signée (miniatures, lecture)
let vpQuery = pageState().vpQuery || '';
const view = { player: null, tab: null };
/* Compilation : choix des séquences d'un joueur (dans l'ordre des touches). */
/* Mode sélection : séquences (compiler, supprimer) ou vidéos (supprimer,
   télécharger les originaux). pool : éléments de l'onglet affiché, dans
   l'ordre ; ids : la sélection, dans l'ordre des clics (ordre de compilation). */
const pick = { on: false, kind: 'seqs', ids: [], pool: [] };
let navDepth = 0;           // niveaux ouverts dans cette page (pour le bouton retour)

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  myProfile = ctx.profile;
  const qs = new URLSearchParams(location.search);
  view.player = Number(qs.get('player') || 0) || null;
  view.tab = qs.get('tab');

  document.getElementById('uName').textContent = myProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[myProfile.role] || myProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (myProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  if (canManageVideos(myProfile.role)) {
    document.getElementById('btnNewVideo').classList.remove('hidden');
    document.getElementById('btnNewVideo').addEventListener('click', openVideoModal);
    document.getElementById('v-submit').addEventListener('click', uploadVideo);
  }

  const { data: players, error: playersError } = await byTeam(sb.from('players').select('id, nom, prenom, club_id').order('nom'));
  if (playersError) console.error('Joueurs illisibles', playersError);
  playersCache = players || [];

  // Arrivée depuis une fiche joueur : un lien pour y revenir.
  if (view.player) {
    const back = document.getElementById('videoBackLink');
    back.href = `player.html?id=${view.player}`;
    back.classList.remove('hidden');
  }
  history.replaceState({ vp: 1, ...view }, '', location.href);
  await loadVideos();
})();

/* Limite d'un envoi : celle du Worker vidéo (VIDEO_MAX_BYTES, supabase-client.js). */
const MAX_VIDEO_BYTES = VIDEO_MAX_BYTES;
const fmtMo = (bytes) => `${Math.round(bytes / (1024 * 1024))} Mo`;
const fullName = (p) => `${p?.prenom || ''} ${p?.nom || ''}`.trim() || 'Joueur';
const initials = (p) => `${(p?.prenom || '')[0] || ''}${(p?.nom || '')[0] || ''}`.toUpperCase() || '?';
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const shortDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

/* ---------- Chargement ---------- */
async function loadVideos() {
  const box = document.getElementById('vpView');
  try {
    const ids = playersCache.map(p => p.id);
    const [vRes, sRes] = await Promise.all([
      sb.from('player_videos')
        .select('*, video_views(watched_seconds, max_position_seconds, last_heartbeat_at)')
        .in('player_id', ids).order('created_at', { ascending: false }),
      sb.from('video_sequences').select('*').in('player_id', ids).order('start_sec'),
    ]);
    if (vRes.error) throw vRes.error;
    if (sRes.error) console.warn('Séquences indisponibles (platform_v2.sql non passée ?) :', sRes.error.message);
    videosCache = vRes.data || [];
    seqsCache = sRes.data || [];
    await signUrls(videosCache);
    render();
  } catch (e) {
    console.error('Vidéos illisibles', e);
    box.innerHTML = `<p class="text-danger">${escapeHtml(e.message)}</p>`;
  }
}
/* URL signées en une seule requête (miniatures et lecture). */
let signError = null;   // dernière panne du serveur vidéo : affichée au lieu de « introuvable »
async function signUrls(videos) {
  const missing = videos.filter(v => !urlCache.has(v.id));
  if (!missing.length) return;
  try {
    const urls = await videoUrls(missing.map(v => v.storage_path));
    missing.forEach(v => urls.has(v.storage_path) && urlCache.set(v.id, urls.get(v.storage_path)));
    signError = null;
  } catch (e) { signError = e; console.warn('Liens de lecture indisponibles', e); }
}

/* ---------- Navigation : ensemble → joueur → rubrique ---------- */
function goTo(player, tab = null, push = true) {
  view.player = player; view.tab = tab;
  const u = new URL(location.href);
  if (player) u.searchParams.set('player', player); else u.searchParams.delete('player');
  if (tab) u.searchParams.set('tab', tab); else u.searchParams.delete('tab');
  if (push) { navDepth++; history.pushState({ vp: 1, ...view }, '', u); } else history.replaceState({ vp: 1, ...view }, '', u);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.addEventListener('popstate', (e) => {
  if (!e.state?.vp) return;
  navDepth = Math.max(0, navDepth - 1);
  if (document.getElementById('wsModal').classList.contains('open')) closeModal('wsModal');
  view.player = e.state.player || null; view.tab = e.state.tab || null;
  render();
});

/* ---------- Rendu ---------- */
const seqVideo = (s) => videosCache.find(v => v.id === s.video_id);
const annCount = (s) => { const n = (s.drawings || []).length; return n ? plural(n, 'annotation', 'annotations') : 'sans habillage'; };
function videoStats(v) {
  const views = v.video_views || [];
  if (!views.length) return '<span class="vp-stat">Pas encore vue</span>';
  const posMax = views.reduce((m, x) => Math.max(m, x.max_position_seconds || 0), 0);
  const pct = v.duree_sec ? Math.min(100, Math.round(posMax / v.duree_sec * 100)) : null;
  return `<span class="vp-stat">Vue ${views.length}×${pct !== null ? ` · ${pct} %` : ''}</span>`;
}
/* Carte d'une séquence : miniature, titre, joueur ou vidéo, durée, statut. */
function seqCard(s, withPlayer) {
  const v = seqVideo(s), len = s.end_sec - s.start_sec, note = (s.player_note || '').trim();
  const who = withPlayer ? fullName(playersCache.find(p => p.id === s.player_id)) : (v?.titre || 'Vidéo');
  const rank = pick.on ? pick.ids.indexOf(s.id) + 1 : 0;
  if (pick.on) return `<button type="button" class="vp-card is-pickable${rank ? ' is-picked' : ''}" data-pick="${s.id}" aria-pressed="${!!rank}">
    <span class="vp-pick" aria-hidden="true">${rank || ''}</span>
    ${thumbHtml(urlCache.get(s.video_id), s.start_sec, fmtDur(len))}
    <span class="vp-card-body">
      <span class="vp-card-top"><strong>${escapeHtml(s.label || 'Séquence')}</strong>${statusPill(s, 'staff')}</span>
      <span class="vp-card-meta">${escapeHtml(who)} · ${annCount(s)}</span>
    </span>
  </button>`;
  return `<button type="button" class="vp-card" data-open-video="${s.video_id}" data-seq="${s.id}">
    ${thumbHtml(urlCache.get(s.video_id), s.start_sec, fmtDur(len))}
    <span class="vp-card-body">
      <span class="vp-card-top"><strong>${escapeHtml(s.label || 'Séquence')}</strong>${statusPill(s, 'staff')}</span>
      <span class="vp-card-meta">${escapeHtml(who)} · ${annCount(s)}${s.submitted_at ? ` · envoyée le ${escapeHtml(shortDate(s.submitted_at))}` : ''}</span>
      ${note ? `<em>« ${escapeHtml(note.length > 90 ? `${note.slice(0, 87)}…` : note)} »</em>` : ''}
    </span>
  </button>`;
}
function videoCard(v) {
  const n = seqsCache.filter(s => s.video_id === v.id).length;
  if (pick.on && pick.kind === 'videos') {
    const on = pick.ids.includes(v.id);
    return `<button type="button" class="vp-card is-video is-pickable${on ? ' is-picked' : ''}" data-pick="${v.id}" aria-pressed="${on}">
      <span class="vp-pick" aria-hidden="true">${on ? '✓' : ''}</span>
      ${thumbHtml(urlCache.get(v.id), 1, 'Source')}
      <span class="vp-card-body">
        <span class="vp-card-top"><strong>${escapeHtml(v.titre)}</strong></span>
        <span class="vp-card-meta">${escapeHtml(new Date(v.created_at).toLocaleDateString('fr-FR'))} · ${n ? plural(n, 'séquence', 'séquences') : 'pas de séquence'}</span>
      </span>
    </button>`;
  }
  return `<div class="vp-card is-video">
    <button type="button" class="vp-card-open" data-open-video="${v.id}">
      ${thumbHtml(urlCache.get(v.id), 1, 'Source')}
      <span class="vp-card-body">
        <span class="vp-card-top"><strong>${escapeHtml(v.titre)}</strong></span>
        <span class="vp-card-meta">${escapeHtml(new Date(v.created_at).toLocaleDateString('fr-FR'))} · ${n ? plural(n, 'séquence', 'séquences') : 'pas de séquence'}</span>
        ${videoStats(v)}
      </span>
    </button>
    ${canManageVideos(myProfile.role) ? `<button class="vp-card-del" type="button" data-del-video="${v.id}" aria-label="Supprimer la vidéo « ${escapeHtml(v.titre)} »" title="Supprimer la vidéo">✕</button>` : ''}
  </div>`;
}
const toSeeOf = (list) => list.filter(seqToSee).sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));

function render() {
  const p = view.player && playersCache.find(x => x.id === view.player);
  document.getElementById('vpBack').classList.toggle('hidden', !p);
  if (p) return renderPlayer(p);
  view.player = null;
  document.getElementById('videosTitle').textContent = 'Vidéos joueurs';
  const todo = toSeeOf(seqsCache);
  document.getElementById('videosSub').textContent = todo.length
    ? `${plural(todo.length, 'séquence envoyée', 'séquences envoyées')} par vos joueurs à regarder.`
    : 'Rien à voir pour l’instant : les séquences envoyées par vos joueurs apparaîtront ici.';

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
      <h2 id="vpTodoTitle">À voir <span class="vw-status is-sent">${todo.length}</span></h2>
      <div class="vp-cards">${todo.map(s => seqCard(s, true)).join('')}</div>
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
          ${x.todo ? `<span class="vw-status is-sent">${x.todo} à voir</span>` : x.last ? `<span class="vp-last">${escapeHtml(shortDate(x.last))}</span>` : ''}
          <span class="vp-chevron" aria-hidden="true">›</span>
        </button>`).join('') : '<p class="vp-empty">Aucun joueur ne correspond.</p>'}</div>
    </section>`;
  loadThumbs(box);
}

function renderPlayer(p) {
  const vids = videosCache.filter(v => v.player_id === p.id);
  const seqs = seqsCache.filter(s => s.player_id === p.id);
  const todo = toSeeOf(seqs);
  const tab = view.tab || (todo.length ? 'todo' : seqs.length ? 'seqs' : 'videos');
  document.getElementById('videosTitle').textContent = fullName(p);
  document.getElementById('videosSub').textContent =
    `${plural(vids.length, 'vidéo', 'vidéos')} · ${plural(seqs.length, 'séquence', 'séquences')}${todo.length ? ` · ${todo.length} à voir` : ''}`;
  const tabs = [['todo', 'À voir', todo.length], ['seqs', 'Séquences', seqs.length], ['videos', 'Vidéos', vids.length]];
  // Séquences : à voir d'abord, puis les plus récentes.
  const ordered = [...seqs].sort((a, b) => (seqToSee(b) - seqToSee(a)) || String(b.submitted_at || b.created_at || '').localeCompare(String(a.submitted_at || a.created_at || '')));
  const body = tab === 'todo'
    ? (todo.length ? `<div class="vp-cards">${todo.map(s => seqCard(s, false)).join('')}</div>` : '<p class="vp-empty">Rien à voir : aucune séquence envoyée en attente de votre retour.</p>')
    : tab === 'seqs'
      ? (seqs.length ? `<div class="vp-cards">${ordered.map(s => seqCard(s, false)).join('')}</div>` : '<p class="vp-empty">Aucune séquence. Ouvrez une vidéo, puis « Sélectionner une portion ».</p>')
      : (vids.length ? `<div class="vp-cards">${vids.map(videoCard).join('')}</div>` : '<p class="vp-empty">Aucune vidéo envoyée à ce joueur.</p>');
  const box = document.getElementById('vpView');
  const kind = tab === 'videos' ? 'videos' : 'seqs';
  const manage = canManageVideos(myProfile.role);
  const canPick = kind === 'seqs' ? seqs.length > 0 : manage && vids.length > 0;
  if (!canPick || pick.kind !== kind) { pick.on = false; pick.ids = []; }
  pick.kind = kind;
  pick.pool = kind === 'videos' ? vids : tab === 'todo' ? todo : ordered;
  const chosenByPlayer = kind === 'seqs' ? pick.pool.filter(s => s.selected).length : 0;
  const bar = !canPick ? '' : pick.on
    ? bulkBarHtml({
      n: pick.ids.length, total: pick.pool.length,
      noun: kind === 'videos' ? ['vidéo', 'vidéos', true] : ['séquence', 'séquences', true],
      extra: chosenByPlayer ? `<button class="btn btn-sm" type="button" data-bulk="player" title="Les séquences que le joueur a sélectionnées">Sélection du joueur (${chosenByPlayer})</button>` : '',
      actions: kind === 'videos'
        ? [{ key: 'dl', label: 'Télécharger les originaux' }, { key: 'del-videos', label: 'Supprimer', danger: true }]
        : [{ key: 'compile', label: 'Compiler', primary: true }, ...(manage ? [{ key: 'del-seqs', label: 'Supprimer', danger: true }] : [])],
    })
    : `<div class="vp-compile-bar">
        <span class="text-muted">${kind === 'videos'
          ? 'Plusieurs vidéos à supprimer ou à télécharger ? Sélectionnez-les d’un coup.'
          : 'Réunir des séquences en une seule vidéo (touchez-les dans l’ordre voulu), ou en supprimer plusieurs.'}</span>
        <button class="btn btn-sm" type="button" data-pick-start>Sélectionner</button>
      </div>`;
  box.innerHTML = `
    <div class="vp-tabs" role="tablist" aria-label="Rubriques">${tabs.map(([k, label, n]) => `
      <button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}">${label}${n ? ` <span>${n}</span>` : ''}</button>`).join('')}
    </div>
    ${bar}
    <div class="vp-tabpanel" role="tabpanel">${body}</div>`;
  loadThumbs(box);
}

function openCompile() {
  const p = playersCache.find(x => x.id === view.player);
  const seqs = pick.ids.map(id => seqsCache.find(s => s.id === id)).filter(Boolean);
  if (!p || !seqs.length) return;
  openCompileSheet({
    player: p, seqs,
    videoOf: seqVideo,
    urlOf: (s) => urlCache.get(s.video_id),
    onSaved: () => loadVideos(),
  });
}

document.getElementById('vpView').addEventListener('click', (e) => {
  const picked = e.target.closest('[data-pick]');
  if (picked) {
    const id = Number(picked.dataset.pick);
    pick.ids = pick.ids.includes(id) ? pick.ids.filter(x => x !== id) : [...pick.ids, id];
    return render();
  }
  if (e.target.closest('[data-pick-start]')) { pick.on = true; pick.ids = []; return render(); }
  const bulk = e.target.closest('[data-bulk]')?.dataset.bulk;
  if (bulk === 'all') { pick.ids = [...pick.ids, ...pick.pool.map(x => x.id).filter(id => !pick.ids.includes(id))]; return render(); }
  if (bulk === 'player') { pick.ids = pick.pool.filter(s => s.selected).map(s => s.id); return render(); }
  if (bulk === 'none') { pick.ids = []; return render(); }
  if (bulk === 'done') { pick.on = false; pick.ids = []; return render(); }
  if (bulk === 'compile') return openCompile();
  if (bulk === 'del-seqs') return deletePickedSeqs();
  if (bulk === 'del-videos') return deletePickedVideos();
  if (bulk === 'dl') return downloadOriginals();
  const open = e.target.closest('[data-open-video]');
  if (open) return openWorkspace(Number(open.dataset.openVideo), Number(open.dataset.seq) || null);
  const del = e.target.closest('[data-del-video]');
  if (del) return deleteVideo(Number(del.dataset.delVideo));
  const pl = e.target.closest('[data-player]');
  if (pl) { pick.on = false; pick.ids = []; return goTo(Number(pl.dataset.player)); }
  const tab = e.target.closest('[data-tab]');
  if (tab) return goTo(view.player, tab.dataset.tab, false);
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
  else goTo(null, null, false);
});

/* ---------- Poste de travail (modale plein écran sur téléphone) ---------- */
async function openWorkspace(videoId, seqId) {
  const v = videosCache.find(x => x.id === videoId);
  if (!v) return;
  if (!urlCache.has(v.id)) await signUrls([v]);
  const url = urlCache.get(v.id);
  if (!url) return toast(signError ? `Lecture impossible : ${signError.message}` : 'Vidéo introuvable dans le stockage.', 'error');
  const player = playersCache.find(p => p.id === v.player_id);
  document.getElementById('wsTitle').textContent = fullName(player);
  openModal('wsModal');
  await mountVideoWorkspace(document.getElementById('wsRoot'), {
    video: v, src: url, player, mode: 'staff', userId: myProfile.id, focusSeq: seqId,
    onChange: () => { wsDirty = true; },
  });
}
/* Fermeture (bouton, Échap, clic à côté) : on coupe la vidéo et on
   rafraîchit la liste si quelque chose a changé. */
let wsDirty = false;
new MutationObserver(() => {
  if (document.getElementById('wsModal').classList.contains('open')) return;
  document.getElementById('wsRoot').innerHTML = '';
  if (wsDirty) { wsDirty = false; loadVideos(); }
}).observe(document.getElementById('wsModal'), { attributes: true, attributeFilter: ['class'] });

/* ---------- Envoi de vidéos ----------
   Plusieurs fichiers d'un coup, envoyés l'un après l'autre (la connexion
   est le goulot : en parallèle, chacun irait moins vite). Chaque ligne
   montre son pourcentage, la ligne du bas l'avancement global. Un échec
   n'arrête pas les suivants ; « Réessayer » ne renvoie que les échecs. */
const upl = { items: [], ctrl: null, stamp: 0 };   // item : { file, title, state, pct, err }
const $up = (id) => document.getElementById(id);
/* « match_vs_laval.mp4 » → « Match vs laval » */
const titleFromFile = (name) => {
  const t = name.replace(/\.[^.]+$/, '').replace(/[_\s]+/g, ' ').trim() || 'Vidéo';
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const fileExt = (name) => (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] || 'mp4').toLowerCase();
const pctText = (p) => `${Math.floor(p * 100)} %`;
const fmtSize = (b) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} Ko`
  : `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace('.', ',')} Mo`);

function openVideoModal() {
  if (upl.ctrl) return openModal('videoModal');   // envoi en cours : on le retrouve tel quel
  const sel = $up('v-player');
  sel.innerHTML = '<option value="">— Choisir un joueur —</option>'
    + playersCache.map(p => `<option value="${p.id}">${escapeHtml(fullName(p))}</option>`).join('');
  if (view.player) sel.value = String(view.player);
  $up('v-desc').value = '';
  $up('v-file').value = '';
  upl.items = [];
  renderUploads();
  openModal('videoModal');
}

function renderUploads() {
  const busy = !!upl.ctrl;
  const box = $up('v-files');
  box.innerHTML = upl.items.map((it, i) => {
    const status = {
      big: `<span class="upl-err">Trop volumineuse : ${fmtMo(it.file.size)}, ${fmtMo(MAX_VIDEO_BYTES)} au maximum</span>`,
      sending: `<span class="upl-pct" data-pct>${it.pct >= 1 ? 'Finalisation…' : pctText(it.pct)}</span>`,
      done: '<span class="upl-ok">Envoyée ✓</span>',
      error: `<span class="upl-err">${escapeHtml(it.err)}</span>`,
    }[it.state] || `<span class="upl-size">${fmtSize(it.file.size)}</span>`;
    const locked = busy || it.state === 'done';
    return `
      <div class="upl-row is-${it.state}" data-i="${i}">
        <input class="upl-title" value="${escapeHtml(it.title)}" maxlength="140" aria-label="Titre de la vidéo ${i + 1}" ${locked ? 'disabled' : ''}>
        ${status}
        <button type="button" class="upl-x" data-upl-remove="${i}" aria-label="Retirer ${escapeHtml(it.title)}" ${locked ? 'disabled' : ''}>×</button>
        <div class="upl-bar"><span style="width:${it.state === 'done' ? 100 : Math.round(it.pct * 100)}%"></span></div>
      </div>`;
  }).join('');
  box.classList.toggle('hidden', !upl.items.length);
  const todo = upl.items.filter(it => it.state === 'ready' || it.state === 'error');
  const btn = $up('v-submit');
  if (!busy) {
    btn.disabled = !todo.length;
    btn.textContent = upl.items.some(it => it.state === 'error') ? 'Réessayer'
      : todo.length > 1 ? `Envoyer les ${todo.length} vidéos` : 'Envoyer';
  }
  $up('v-cancel').textContent = busy ? 'Arrêter l’envoi' : upl.items.some(it => it.state === 'done') ? 'Fermer' : 'Annuler';
  $up('v-player').disabled = busy;
  $up('v-file').disabled = busy;
  $up('v-file').nextElementSibling.textContent = upl.items.length ? '+ Ajouter d’autres vidéos' : '+ Choisir des vidéos';
  $up('v-desc').disabled = busy;
  $up('videoModal').toggleAttribute('data-busy', busy);   // ni Échap ni clic à côté ne ferment
}

/* Avancement : mis à jour sur place, sans redessiner les champs. */
function showUploadProgress(it, done, total) {
  const row = $up('v-files').querySelector(`[data-i="${upl.items.indexOf(it)}"]`);
  if (row) {
    row.querySelector('.upl-bar > span').style.width = `${Math.round(it.pct * 100)}%`;
    const pct = row.querySelector('[data-pct]');
    if (pct) pct.textContent = it.pct >= 1 ? 'Finalisation…' : pctText(it.pct);
  }
  const all = (done + it.pct * it.file.size) / total.bytes;
  const n = total.list.indexOf(it) + 1;
  $up('v-total').textContent = total.list.length > 1
    ? `Vidéo ${n} sur ${total.list.length} — ${pctText(all)} au total` : `Envoi : ${pctText(all)}`;
  $up('v-submit').textContent = `Envoi… ${pctText(all)}`;
}

document.addEventListener('change', (e) => {
  if (e.target.id !== 'v-file') return;
  const known = new Set(upl.items.map(it => `${it.file.name}|${it.file.size}|${it.file.lastModified}`));
  [...e.target.files].forEach(file => {
    if (known.has(`${file.name}|${file.size}|${file.lastModified}`)) return;
    upl.items.push({ file, title: titleFromFile(file.name), state: file.size > MAX_VIDEO_BYTES ? 'big' : 'ready', pct: 0 });
  });
  e.target.value = '';   // un second choix s'ajoute au premier
  renderUploads();
});
document.addEventListener('input', (e) => {
  const row = e.target.classList.contains('upl-title') && e.target.closest('.upl-row');
  if (row) upl.items[Number(row.dataset.i)].title = e.target.value;
});
document.addEventListener('click', (e) => {
  const rm = e.target.closest('[data-upl-remove]');
  if (rm && !upl.ctrl) { upl.items.splice(Number(rm.dataset.uplRemove), 1); renderUploads(); return; }
  if (e.target.id !== 'v-cancel') return;
  if (!upl.ctrl) return closeModal('videoModal');
  if (confirm('Arrêter l’envoi ?\n\nLes vidéos déjà envoyées sont gardées.')) upl.ctrl.abort();
});
window.addEventListener('beforeunload', (e) => { if (upl.ctrl) e.preventDefault(); });

async function uploadVideo() {
  const playerId = Number($up('v-player').value);
  if (!playersCache.some(p => p.id === playerId)) { toast('Choisissez le joueur destinataire.', 'error'); return; }
  const list = upl.items.filter(it => it.state === 'ready' || it.state === 'error');
  if (!list.length) { toast('Ajoutez au moins une vidéo.', 'error'); return; }
  const description = $up('v-desc').value.trim() || null;
  const total = { list, bytes: list.reduce((s, it) => s + it.file.size, 0) || 1 };
  let done = 0, sent = 0, failed = 0;
  upl.ctrl = new AbortController();
  list.forEach(it => { it.state = 'ready'; it.pct = 0; it.err = ''; });
  $up('v-submit').disabled = true;
  $up('v-total').classList.remove('hidden');
  renderUploads();
  for (const it of list) {
    if (upl.ctrl.signal.aborted) break;
    it.state = 'sending'; renderUploads(); showUploadProgress(it, done, total);
    upl.stamp = Math.max(Date.now(), upl.stamp + 1);   // chemins distincts, même envoyés dans la même milliseconde
    const path = `r2/${myProfile.club_id}/${playerId}/${upl.stamp}.${fileExt(it.file.name)}`;
    try {
      await uploadVideoFile(path, it.file, {
        signal: upl.ctrl.signal,
        onProgress: (p) => { it.pct = p; showUploadProgress(it, done, total); },
      });
      const { error } = await sb.from('player_videos').insert({
        club_id: myProfile.club_id, player_id: playerId, storage_path: path,
        titre: it.title.trim() || titleFromFile(it.file.name), description,
      });
      if (error) {
        await removeVideoFile(path).catch(err => console.warn('Fichier orphelin', path, err));
        throw error;
      }
      it.state = 'done'; sent++;
    } catch (err) {
      if (err.name === 'AbortError') { it.state = 'ready'; it.pct = 0; break; }
      console.error('Envoi vidéo', it.file.name, err);
      it.state = 'error'; it.err = err.message || 'Échec de l’envoi.'; failed++;
    }
    done += it.file.size;
  }
  const stopped = upl.ctrl.signal.aborted;
  upl.ctrl = null;
  $up('v-total').classList.add('hidden');
  renderUploads();
  if (sent) await loadVideos();
  const sentTxt = `${sent} vidéo${sent > 1 ? 's envoyées' : ' envoyée'}`;
  if (!failed && !stopped) {
    closeModal('videoModal');
    toast(`${sentTxt}. ${sent > 1 ? 'Elles apparaissent' : 'Elle apparaît'} dans l’espace du joueur.`, 'success');
  } else if (stopped) {
    toast(sent ? `Envoi arrêté : ${sentTxt}.` : 'Envoi arrêté.', 'info');
  } else {
    toast(`${sent ? `${sentTxt}, ` : ''}${failed} en échec : corrigez ou réessayez.`, 'error');
  }
}

/* ---------- Actions groupées ---------- */
async function deletePickedVideos() {
  const list = videosCache.filter(v => pick.ids.includes(v.id));
  if (!list.length) return;
  if (!confirm(`Supprimer ${list.length > 1 ? `ces ${list.length} vidéos` : 'cette vidéo'} ?\n\n${namesList(list.map(v => v.titre))}\n\nLe joueur n’y aura plus accès, leurs séquences partent avec elles.${await trashNote()}`)) return;
  try {
    const { error } = await sb.from('player_videos').delete().in('id', list.map(v => v.id));
    if (error) throw error;
    // Corbeille : les fichiers restent jusqu'à la suppression définitive.
    if (!(await trashReady())) {
      await Promise.all(list.map(v => removeVideoFile(v.storage_path).catch(e => console.warn('Suppression du fichier vidéo :', v.storage_path, e))));
    }
    toast(`${list.length} vidéo${list.length > 1 ? 's supprimées' : ' supprimée'}.`, 'success');
    pick.ids = [];
    await loadVideos();
  } catch (e) { console.error('Suppression des vidéos impossible', e); toast(e.message, 'error'); }
}
async function deletePickedSeqs() {
  const list = seqsCache.filter(s => pick.ids.includes(s.id));
  if (!list.length) return;
  if (!confirm(`Supprimer ${list.length > 1 ? `ces ${list.length} séquences` : 'cette séquence'} ?\n\n${namesList(list.map(s => s.label || 'Séquence'))}${await trashNote()}`)) return;
  try {
    const { error } = await sb.from('video_sequences').delete().in('id', list.map(s => s.id));
    if (error) throw error;
    toast(`${list.length} séquence${list.length > 1 ? 's supprimées' : ' supprimée'}.`, 'success');
    pick.ids = [];
    await loadVideos();
  } catch (e) { console.error('Suppression des séquences impossible', e); toast(e.message, 'error'); }
}
/* Fichiers d'origine, tels qu'envoyés : l'un après l'autre (le navigateur
   peut demander d'autoriser les téléchargements multiples). */
async function downloadOriginals() {
  const list = videosCache.filter(v => pick.ids.includes(v.id));
  await signUrls(list);
  let missing = 0;
  for (const v of list) {
    const u = urlCache.get(v.id);
    if (!u) { missing++; continue; }
    const name = (v.titre || 'video').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '-').slice(0, 60);
    const a = el('a', { href: u.startsWith('/api/videos/') ? `${u}&dl=1&n=${encodeURIComponent(name)}` : u, download: '' });
    document.body.append(a); a.click(); a.remove();
    await new Promise(r => setTimeout(r, 700));
  }
  if (missing) toast(signError ? `Lecture impossible : ${signError.message}` : `${missing} vidéo${missing > 1 ? 's' : ''} introuvable${missing > 1 ? 's' : ''}.`, 'error');
}

async function deleteVideo(id) {
  const v = videosCache.find(x => x.id === id);
  if (!v || !confirm(`Supprimer « ${v.titre} » ? Le joueur n’y aura plus accès, ses séquences partent avec elle.${await trashNote()}`)) return;
  try {
    const { error } = await sb.from('player_videos').delete().eq('id', id);
    if (error) throw error;
    // Corbeille : le fichier reste jusqu'à la suppression définitive.
    if (!(await trashReady())) await removeVideoFile(v.storage_path).catch(e => console.warn('Suppression du fichier vidéo :', v.storage_path, e));
    toast('Vidéo supprimée.', 'success');
    await loadVideos();
  } catch (e) { toast(e.message, 'error'); }
}
