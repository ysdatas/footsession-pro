/* ============================================================
   FootSession Pro — videos-page.js (staff)
   Vidéos organisées PAR JOUEUR :
     Joueur
       → Séquences sélectionnées (à travailler, pas encore annotées)
       → Séquences annotées (dessins / analyse, envoyées ou non)
       → Vidéos disponibles (statistiques de visionnage)
   Une vidéo ou une séquence s'ouvre dans le poste de travail
   (video-workspace.js) : découpage, annotations du joueur, retour.
   Sécurité : RLS (player_videos, video_sequences, video_views).
   ============================================================ */

let myProfile = null;
let playersCache = [];
let videosCache = [];
let seqsCache = [];
let requestedPlayerId = null;
let vpFilter = 'all';
let vpQuery = '';

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  myProfile = ctx.profile;
  requestedPlayerId = Number(new URLSearchParams(location.search).get('player') || 0) || null;

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

  if (requestedPlayerId) {
    const target = playersCache.find(p => p.id === requestedPlayerId);
    document.getElementById('videosTitle').textContent = `Vidéos — ${target ? fullName(target) : 'Joueur'}`;
    const back = document.getElementById('videoBackLink');
    back.href = `player.html?id=${requestedPlayerId}`;
    back.classList.remove('hidden');
  }
  await loadVideos();
})();

/* Limite réelle d'un upload : c'est le bucket Supabase qui tranche.
   Cette valeur DOIT correspondre au "File size limit" du bucket
   player-videos (Supabase > Storage > player-videos > Configuration). */
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const fmtMo = (bytes) => `${Math.round(bytes / (1024 * 1024))} Mo`;
const fullName = (p) => `${p?.prenom || ''} ${p?.nom || ''}`.trim() || 'Joueur';
const toSee = (s) => s.submitted_at && (!s.feedback_at || s.feedback_at < s.submitted_at);

/* ---------- Chargement ---------- */
async function loadVideos() {
  const list = document.getElementById('vpList');
  try {
    const ids = requestedPlayerId ? [requestedPlayerId] : playersCache.map(p => p.id);
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
    renderVideos();
  } catch (e) {
    console.error('Vidéos illisibles', e);
    list.innerHTML = `<p class="text-danger">${escapeHtml(e.message)}</p>`;
  }
}

/* ---------- Rendu par joueur ---------- */
function videoStats(v) {
  const views = v.video_views || [];
  if (!views.length) return '<span class="vw-flag">Non vue</span>';
  const total = views.reduce((s, x) => s + (x.watched_seconds || 0), 0);
  const posMax = views.reduce((m, x) => Math.max(m, x.max_position_seconds || 0), 0);
  const pct = v.duree_sec ? Math.min(100, Math.round(posMax / v.duree_sec * 100)) : null;
  return `<span class="vw-flag is-ok">Vue ${views.length}×</span> <span class="vp-stat">${Math.round(total / 60)} min${pct !== null ? ` · ${pct} %` : ''}</span>`;
}

function seqRow(s) {
  const v = videosCache.find(x => x.id === s.video_id);
  return `<button type="button" class="vp-row vp-seq" data-open-video="${s.video_id}" data-seq="${s.id}">
    <span class="vp-row-main"><strong>${escapeHtml(s.label || 'Séquence')}</strong>
      <span>${escapeHtml(v?.titre || 'Vidéo')} · ${fmtT(s.start_sec)} – ${fmtT(s.end_sec)}${(s.drawings || []).length ? ` · ${s.drawings.length} image${s.drawings.length > 1 ? 's' : ''}` : ''}</span></span>
    <span class="vw-flags">
      ${toSee(s) ? '<span class="vw-flag is-gold">À voir</span>' : ''}
      ${s.submitted_at && !toSee(s) ? '<span class="vw-flag is-ok">Retour envoyé</span>' : ''}
      ${hasWork(s) && !s.submitted_at ? '<span class="vw-flag">En cours</span>' : ''}
    </span>
  </button>`;
}

function renderVideos() {
  const byPlayer = new Map();
  const bucket = (id) => byPlayer.get(id) || byPlayer.set(id, { videos: [], seqs: [] }).get(id);
  videosCache.forEach(v => bucket(v.player_id).videos.push(v));
  seqsCache.forEach(s => bucket(s.player_id).seqs.push(s));

  let groups = [...byPlayer.entries()].map(([id, g]) => ({
    player: playersCache.find(p => p.id === id) || { id, nom: 'Joueur' }, ...g,
    selected: g.seqs.filter(s => s.selected && !hasWork(s)),
    annotated: g.seqs.filter(hasWork),
    todo: g.seqs.filter(toSee).length,
  }));
  const totalTodo = groups.reduce((n, g) => n + g.todo, 0);
  document.getElementById('videosSub').textContent =
    `${videosCache.length} vidéo${videosCache.length > 1 ? 's' : ''} · ${seqsCache.length} séquence${seqsCache.length > 1 ? 's' : ''}`
    + (totalTodo ? ` · ${totalTodo} analyse${totalTodo > 1 ? 's' : ''} de joueurs à voir` : '');

  if (vpFilter === 'todo') groups = groups.filter(g => g.todo);
  if (vpQuery) groups = groups.filter(g => fullName(g.player).toLowerCase().includes(vpQuery));
  groups.sort((a, b) => (b.todo - a.todo) || fullName(a.player).localeCompare(fullName(b.player), 'fr'));

  const list = document.getElementById('vpList');
  if (!groups.length) {
    list.innerHTML = `<div class="empty">${vpFilter === 'todo' ? 'Aucune analyse de joueur en attente.'
      : videosCache.length ? 'Aucun joueur ne correspond.' : 'Aucune vidéo envoyée pour le moment.'}</div>`;
    return;
  }
  const openAll = groups.length === 1;
  list.innerHTML = groups.map(g => `
    <details class="vp card" ${openAll || g.todo ? 'open' : ''}>
      <summary>
        <span class="vp-name">${escapeHtml(fullName(g.player))}</span>
        <span class="vp-meta">${g.videos.length} vidéo${g.videos.length > 1 ? 's' : ''} · ${g.selected.length} sélectionnée${g.selected.length > 1 ? 's' : ''} · ${g.annotated.length} annotée${g.annotated.length > 1 ? 's' : ''}</span>
        ${g.todo ? `<span class="vw-flag is-gold">${g.todo} à voir</span>` : ''}
      </summary>
      <div class="vp-body">
        <section>
          <h4>Séquences sélectionnées</h4>
          ${g.selected.length ? g.selected.map(seqRow).join('') : '<p class="vp-empty">Aucune séquence choisie sans analyse.</p>'}
        </section>
        <section>
          <h4>Séquences annotées</h4>
          ${g.annotated.length ? g.annotated.map(seqRow).join('') : '<p class="vp-empty">Aucune séquence annotée.</p>'}
        </section>
        <section>
          <h4>Vidéos disponibles</h4>
          ${g.videos.length ? g.videos.map(v => `
            <div class="vp-row vp-video">
              <span class="vp-row-main"><strong>${escapeHtml(v.titre)}</strong>
                <span>${escapeHtml(new Date(v.created_at).toLocaleDateString('fr-FR'))} · ${seqsCache.filter(s => s.video_id === v.id).length} séquence(s)</span></span>
              <span class="vp-video-stats">${videoStats(v)}</span>
              <span class="vp-actions">
                <button class="btn btn-sm btn-primary" type="button" data-open-video="${v.id}">Ouvrir</button>
                ${canManageVideos(myProfile.role) ? `<button class="btn btn-sm btn-danger" type="button" data-del-video="${v.id}" aria-label="Supprimer la vidéo">✕</button>` : ''}
              </span>
            </div>`).join('') : '<p class="vp-empty">Aucune vidéo.</p>'}
        </section>
      </div>
    </details>`).join('');
}

document.getElementById('vpList').addEventListener('click', (e) => {
  const open = e.target.closest('[data-open-video]');
  if (open) return openWorkspace(Number(open.dataset.openVideo), Number(open.dataset.seq) || null);
  const del = e.target.closest('[data-del-video]');
  if (del) return deleteVideo(Number(del.dataset.delVideo));
});
document.getElementById('videoFilter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]'); if (!b) return;
  vpFilter = b.dataset.filter;
  document.querySelectorAll('#videoFilter button').forEach(x => x.classList.toggle('active', x === b));
  renderVideos();
});
document.getElementById('vpSearch').addEventListener('input', (e) => {
  vpQuery = e.target.value.trim().toLowerCase();
  renderVideos();
});

/* ---------- Poste de travail (modale) ---------- */
async function openWorkspace(videoId, seqId) {
  const v = videosCache.find(x => x.id === videoId);
  if (!v) return;
  const { data, error } = await sb.storage.from('player-videos').createSignedUrl(v.storage_path, 3600);
  if (error || !data?.signedUrl) return toast('Vidéo introuvable dans le stockage.', 'error');
  const player = playersCache.find(p => p.id === v.player_id);
  document.getElementById('wsTitle').textContent = `${v.titre} — ${fullName(player)}`;
  openModal('wsModal');
  await mountVideoWorkspace(document.getElementById('wsRoot'), {
    video: v, src: data.signedUrl, player, mode: 'staff', userId: myProfile.id, focusSeq: seqId,
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
  const recipients = requestedPlayerId ? playersCache.filter(p => p.id === requestedPlayerId) : playersCache;
  sel.innerHTML = '<option value="">— Choisir un joueur —</option>'
    + recipients.map(p => `<option value="${p.id}">${escapeHtml(fullName(p))}</option>`).join('');
  if (requestedPlayerId) sel.value = String(requestedPlayerId);
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
    const path = `${myProfile.club_id}/${playerId}/${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from('player-videos').upload(path, file);
    if (upErr) {
      throw new Error(/exceeded|too large|payload/i.test(upErr.message || '')
        ? `Supabase a refusé le fichier (${fmtMo(file.size)}) : la limite du bucket player-videos est plus basse que ${fmtMo(MAX_VIDEO_BYTES)}.`
        : upErr.message);
    }
    const { error: insErr } = await sb.from('player_videos').insert({
      club_id: myProfile.club_id, player_id: playerId, titre,
      description: document.getElementById('v-desc').value.trim() || null,
      storage_path: path,
    });
    if (insErr) throw insErr;
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
    const { error: sErr } = await sb.storage.from('player-videos').remove([v.storage_path]);
    if (sErr) console.warn('Suppression fichier storage :', sErr.message);
    toast('Vidéo supprimée.', 'success');
    await loadVideos();
  } catch (e) { toast(e.message, 'error'); }
}
