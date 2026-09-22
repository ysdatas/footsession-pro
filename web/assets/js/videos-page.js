/* ============================================================
   FootSession Pro — videos-page.js (Chemin B / Supabase)
   Envoi de vidéos à un joueur précis (upload Storage + insert
   player_videos), codes joueurs, et stats de visionnage agrégées
   depuis video_views. Sécurité : RLS (voir add_player_videos.sql).
   ============================================================ */

let myProfile = null;
let playersCache = [];
let recipientsCache = [];
let CAN_EDIT_VIDEOS = false;
let CAN_VIEW_VIDEO_STATS = false;
let requestedPlayerId = null;

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  myProfile = ctx.profile;
  CAN_VIEW_VIDEO_STATS = ['admin', 'coach'].includes(myProfile.role);
  requestedPlayerId = Number(new URLSearchParams(location.search).get('player') || 0) || null;

  document.getElementById('uName').textContent = myProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[myProfile.role] || myProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (myProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  CAN_EDIT_VIDEOS = canEdit(myProfile.role);
  if (CAN_EDIT_VIDEOS) {
    document.getElementById('btnNewVideo').classList.remove('hidden');
    document.getElementById('btnNewVideo').addEventListener('click', openVideoModal);
    document.getElementById('v-submit').addEventListener('click', uploadVideo);
  }
  document.getElementById('btnCodes').addEventListener('click', openCodesModal);

  const { data: players, error: playersError } = await sb
    .from('players')
    .select('id, nom, prenom, numero, player_code, auth_user_id')
    .order('nom');
  if (!playersError) playersCache = players || [];

  if (myProfile.club_id) {
    const { data: profiles, error: profilesError } = await sb
      .from('profiles')
      .select('id, nom, role')
      .eq('club_id', myProfile.club_id)
      .eq('role', 'joueur');

    if (!profilesError && profiles?.length) {
      const profileMap = new Map(profiles.map(profile => [String(profile.id), profile]));
      recipientsCache = playersCache
        .filter(player => player.auth_user_id && profileMap.has(String(player.auth_user_id)))
        .map(player => ({
          ...player,
          accountName: profileMap.get(String(player.auth_user_id))?.nom || ''
        }));
    }
  }

  if (requestedPlayerId) {
    const target = playersCache.find(p => String(p.id) === String(requestedPlayerId));
    const targetName = target ? `${target.prenom || ''} ${target.nom || ''}`.trim() : 'Joueur';
    document.getElementById('videosTitle').textContent = `Vidéos — ${targetName}`;
    document.getElementById('videoBackLink').href = `player-performance.html?id=${requestedPlayerId}`;
    if (CAN_VIEW_VIDEO_STATS || CAN_EDIT_VIDEOS) {
      document.getElementById('videoBackLink').classList.remove('hidden');
    }
    document.getElementById('btnNewVideo').dataset.playerLocked = 'true';
  }

  await loadVideos();
})();

function fmtDuree(sec) {
  sec = Math.round(sec || 0);
  if (sec <= 0) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m} min ${s}s` : `${s}s`;
}

/* ---------- Liste + stats ---------- */
async function loadVideos() {
  const tbody = document.getElementById('videosBody');
  try {
    let query = sb.from('player_videos')
      .select('*, players(nom, prenom)')
      .order('created_at', { ascending: false });

    if (requestedPlayerId) query = query.eq('player_id', requestedPlayerId);

    if (CAN_VIEW_VIDEO_STATS) {
      query = sb.from('player_videos')
        .select('*, players(nom, prenom), video_views(watched_seconds, max_position_seconds, last_heartbeat_at)')
        .order('created_at', { ascending: false });
      if (requestedPlayerId) query = query.eq('player_id', requestedPlayerId);
    }

    const { data: videos, error } = await query;
    if (error) throw error;

    const count = videos.length;
    document.getElementById('videosSub').textContent =
      `${count} vidéo${count > 1 ? 's' : ''} envoyée${count > 1 ? 's' : ''}`;

    document.querySelectorAll('.video-stats-only').forEach(el => {
      el.classList.toggle('hidden', !CAN_VIEW_VIDEO_STATS);
    });

    if (!videos.length) {
      tbody.innerHTML = `<tr><td colspan="${CAN_VIEW_VIDEO_STATS ? 8 : 4}" class="text-muted" style="text-align:center;padding:24px;">Aucune vidéo envoyée pour le moment.</td></tr>`;
      return;
    }

    tbody.innerHTML = videos.map(v => {
      const views = CAN_VIEW_VIDEO_STATS ? (v.video_views || []) : [];
      const vu = CAN_VIEW_VIDEO_STATS && views.length > 0;
      const tempsTotal = views.reduce((s, x) => s + (x.watched_seconds || 0), 0);
      const posMax = views.reduce((m, x) => Math.max(m, x.max_position_seconds || 0), 0);
      const pct = v.duree_sec ? Math.min(100, Math.round(posMax / v.duree_sec * 100)) : null;
      const derniere = views.reduce((d, x) =>
        x.last_heartbeat_at && (!d || x.last_heartbeat_at > d) ? x.last_heartbeat_at : d, null);
      const nom = escapeHtml(`${v.players?.prenom || ''} ${v.players?.nom || ''}`.trim());

      return `<tr data-id="${v.id}">
        <td><strong>${escapeHtml(v.titre)}</strong><br><span class="text-muted" style="font-size:.78rem;">${escapeHtml(new Date(v.created_at).toLocaleDateString('fr-FR'))}</span></td>
        <td>${nom}</td>
        ${CAN_VIEW_VIDEO_STATS ? `
        <td><span class="badge ${vu ? 'badge-success' : ''}">${vu ? 'Vue' : 'Non vue'}</span></td>
        <td>${views.length}</td>
        <td>${Math.round(tempsTotal / 60)} min</td>
        <td>${pct !== null ? pct + '%' : '—'}</td>
        <td class="text-muted">${derniere ? escapeHtml(new Date(derniere).toLocaleString('fr-FR')) : '—'}</td>
        ` : ''}
        <td style="text-align:right;">${CAN_EDIT_VIDEOS ? `<button class="btn btn-sm btn-danger" type="button" onclick="deleteVideo(${v.id}, '${escapeHtml(v.storage_path)}')">Suppr.</button>` : ''}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="${CAN_VIEW_VIDEO_STATS ? 8 : 4}" class="text-danger" style="text-align:center;padding:24px;">${escapeHtml(e.message)}</td></tr>`;
  }
}

/* ---------- Codes joueurs ---------- */
function openCodesModal() {
  const list = document.getElementById('codesList');
  if (!playersCache.length) {
    list.innerHTML = '<p class="text-muted">Aucun joueur enregistré. Ajoute d\'abord des joueurs depuis « Joueurs ».</p>';
  } else {
    list.innerHTML = playersCache.map(p => `
      <div class="detail-row">
        <span>${escapeHtml(`${p.prenom || ''} ${p.nom}`.trim())}${p.numero != null ? ' #' + p.numero : ''}</span>
        <span class="pill" style="font-family:monospace;cursor:pointer;" onclick="copyCode('${p.player_code}', this)" title="Cliquer pour copier">${p.player_code}</span>
      </div>`).join('');
  }
  openModal('codesModal');
}
window.copyCode = (code, el) => {
  navigator.clipboard?.writeText(code);
  const old = el.textContent;
  el.textContent = 'Copié !';
  setTimeout(() => { el.textContent = old; }, 1200);
};

/* ---------- Envoi vidéo ---------- */
function openVideoModal() {
  const sel = document.getElementById('v-player');
  let recipients = recipientsCache;
  if (requestedPlayerId) recipients = recipientsCache.filter(p => String(p.id) === String(requestedPlayerId));

  if (!recipients.length) {
    sel.innerHTML = '<option value="">Aucun compte joueur lié à une fiche</option>';
    toast('Aucun destinataire disponible : lie d’abord un compte membre à une fiche joueur depuis « Mon club ».', 'error');
  } else {
    sel.innerHTML = '<option value="">— Choisir un compte joueur —</option>' + recipients.map(p => {
      const ficheName = `${p.prenom || ''} ${p.nom || ''}`.trim();
      const label = `${p.accountName || ficheName || 'Joueur'}${p.numero != null ? ' #' + p.numero : ''}`;
      return `<option value="${p.id}">${escapeHtml(label)}</option>`;
    }).join('');
    if (requestedPlayerId) {
      sel.value = String(requestedPlayerId);
    }
  }
  document.getElementById('v-titre').value = '';
  document.getElementById('v-desc').value = '';
  document.getElementById('v-file').value = '';
  document.getElementById('v-progress').classList.add('hidden');
  openModal('videoModal');
}

async function uploadVideo() {
  const playerId = document.getElementById('v-player').value;
  const titre = document.getElementById('v-titre').value.trim();
  const file = document.getElementById('v-file').files[0];
  const recipient = recipientsCache.find(p => String(p.id) === String(playerId));
  if (!recipient || (requestedPlayerId && String(recipient.id) !== String(requestedPlayerId)) || !titre || !file) {
    toast('Compte joueur lié, titre et fichier requis.', 'error');
    return;
  }

  const maxBytes = 500 * 1024 * 1024; // 500 Mo — ajuste selon ton plan Supabase Storage
  if (file.size > maxBytes) { toast('Fichier trop volumineux (max 500 Mo).', 'error'); return; }

  const btn = document.getElementById('v-submit');
  btn.disabled = true; btn.textContent = 'Envoi…';
  document.getElementById('v-progress').classList.remove('hidden');

  try {
    const ext = (file.name.split('.').pop() || 'mp4').replace(/[^a-zA-Z0-9]/g, '');
    const path = `${myProfile.club_id}/${playerId}/${Date.now()}.${ext}`;

    const { error: upErr } = await sb.storage.from('player-videos').upload(path, file);
    if (upErr) throw upErr;

    const { error: insErr } = await sb.from('player_videos').insert({
      club_id: myProfile.club_id,
      player_id: Number(playerId),
      titre,
      description: document.getElementById('v-desc').value.trim() || null,
      storage_path: path,
    });
    if (insErr) throw insErr;

    closeModal('videoModal');
    toast('Vidéo envoyée.', 'success');
    await loadVideos();
  } catch (e) {
    toast(e.message || 'Échec de l\'envoi.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Envoyer';
  }
}

window.deleteVideo = async (id, storagePath) => {
  if (!confirm('Supprimer cette vidéo ? Le joueur n\'y aura plus accès.')) return;
  try {
    const { error: sErr } = await sb.storage.from('player-videos').remove([storagePath]);
    if (sErr) console.warn('Suppression fichier storage :', sErr.message);
    const { error } = await sb.from('player_videos').delete().eq('id', id);
    if (error) throw error;
    toast('Vidéo supprimée.', 'success');
    await loadVideos();
  } catch (e) { toast(e.message, 'error'); }
};
