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
let vpQuery = '';
const view = { player: null, tab: null };
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
async function signUrls(videos) {
  const missing = videos.filter(v => !urlCache.has(v.id));
  if (!missing.length) return;
  try {
    const urls = await videoUrls(missing.map(v => v.storage_path));
    missing.forEach(v => urls.has(v.storage_path) && urlCache.set(v.id, urls.get(v.storage_path)));
  } catch (e) { console.warn('Miniatures indisponibles', e); }
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
  box.innerHTML = `
    <div class="vp-tabs" role="tablist" aria-label="Rubriques">${tabs.map(([k, label, n]) => `
      <button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}">${label}${n ? ` <span>${n}</span>` : ''}</button>`).join('')}
    </div>
    <div class="vp-tabpanel" role="tabpanel">${body}</div>`;
  loadThumbs(box);
}

document.getElementById('vpView').addEventListener('click', (e) => {
  const open = e.target.closest('[data-open-video]');
  if (open) return openWorkspace(Number(open.dataset.openVideo), Number(open.dataset.seq) || null);
  const del = e.target.closest('[data-del-video]');
  if (del) return deleteVideo(Number(del.dataset.delVideo));
  const pl = e.target.closest('[data-player]');
  if (pl) return goTo(Number(pl.dataset.player));
  const tab = e.target.closest('[data-tab]');
  if (tab) return goTo(view.player, tab.dataset.tab, false);
});
document.getElementById('vpView').addEventListener('input', (e) => {
  if (!e.target.matches('#vpSearch')) return;
  vpQuery = e.target.value.trim().toLowerCase();
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
  if (!url) return toast('Vidéo introuvable dans le stockage.', 'error');
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

/* ---------- Envoi vidéo ---------- */
function openVideoModal() {
  const sel = document.getElementById('v-player');
  sel.innerHTML = '<option value="">— Choisir un joueur —</option>'
    + playersCache.map(p => `<option value="${p.id}">${escapeHtml(fullName(p))}</option>`).join('');
  if (view.player) sel.value = String(view.player);
  document.getElementById('v-titre').value = '';
  document.getElementById('v-desc').value = '';
  document.getElementById('v-file').value = '';
  document.getElementById('v-progress').classList.add('hidden');
  openModal('videoModal');
}

async function uploadVideo() {
  const playerId = Number(document.getElementById('v-player').value);
  const titre = document.getElementById('v-titre').value.trim();
  const file = document.getElementById('v-file').files[0];
  if (!playersCache.some(p => p.id === playerId) || !titre || !file) {
    toast('Joueur, titre et fichier requis.', 'error');
    return;
  }
  if (file.size > MAX_VIDEO_BYTES) {
    toast(`Fichier trop volumineux : ${fmtMo(file.size)} pour un maximum de ${fmtMo(MAX_VIDEO_BYTES)}.`, 'error');
    return;
  }
  const btn = document.getElementById('v-submit');
  btn.disabled = true; btn.textContent = 'Envoi…';
  document.getElementById('v-progress').classList.remove('hidden');
  try {
    const ext = (file.name.split('.').pop() || 'mp4').replace(/[^a-zA-Z0-9]/g, '');
    const path = `r2/${myProfile.club_id}/${playerId}/${Date.now()}.${ext}`;
    await uploadVideoFile(path, file);
    const { error: insErr } = await sb.from('player_videos').insert({
      club_id: myProfile.club_id, player_id: playerId, titre,
      description: document.getElementById('v-desc').value.trim() || null,
      storage_path: path,
    });
    if (insErr) {
      await removeVideoFile(path).catch(e => console.warn('Fichier orphelin', path, e));
      throw insErr;
    }
    closeModal('videoModal');
    toast('Vidéo envoyée. Elle apparaît dans l’espace du joueur.', 'success');
    await loadVideos();
  } catch (e) {
    console.error('Envoi vidéo', e);
    toast(e.message || 'Échec de l’envoi.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Envoyer';
  }
}

async function deleteVideo(id) {
  const v = videosCache.find(x => x.id === id);
  if (!v || !confirm(`Supprimer « ${v.titre} » ? Le joueur n’y aura plus accès, ses séquences seront supprimées.`)) return;
  try {
    const { error } = await sb.from('player_videos').delete().eq('id', id);
    if (error) throw error;
    await removeVideoFile(v.storage_path).catch(e => console.warn('Suppression du fichier vidéo :', v.storage_path, e));
    toast('Vidéo supprimée.', 'success');
    await loadVideos();
  } catch (e) { toast(e.message, 'error'); }
}
