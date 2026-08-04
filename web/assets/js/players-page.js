/* ============================================================
   FootSession Pro — players-page.js (Chemin B / Supabase)
   Grille joueurs, matrice de présence, ajout/édition, détail.
   Les données sont scopées au club via RLS (aucun filtre manuel
   nécessaire : Postgres ne renvoie que ce que la politique autorise).
   ============================================================ */

let playersCache = [];
let myProfile = null;
let CAN_EDIT_PLAYERS = false;

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  myProfile = ctx.profile;

  document.getElementById('uName').textContent = myProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[myProfile.role] || myProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (myProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  CAN_EDIT_PLAYERS = canEdit(myProfile.role);
  if (CAN_EDIT_PLAYERS) {
    document.getElementById('btnAddPlayer').classList.remove('hidden');
    document.getElementById('btnAddPlayer').addEventListener('click', () => openPlayerModal());
    document.getElementById('m-save').addEventListener('click', savePlayer);
  }

  document.querySelectorAll('#viewSwitch button').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
  document.getElementById('searchPlayer').addEventListener('input', applySearch);

  await loadGrid();
})();

function avatarClass(i) { return 'av' + (i % 6); }

/* ---------- Grille ---------- */
async function loadGrid() {
  try {
    const { data: players, error } = await sb.from('players').select('id, nom, prenom, numero, poste').order('nom');
    if (error) throw error;
    const { data: att } = await sb.from('attendance').select('player_id, present');

    playersCache = players.map(p => {
      const rows = (att || []).filter(a => a.player_id === p.id);
      const total = rows.length, present = rows.filter(a => a.present).length;
      return { ...p, nb_total: total, nb_present: present, presence_pct: total ? Math.round(present / total * 100) : 0 };
    });
    renderGrid();
    const avg = playersCache.length ? Math.round(playersCache.reduce((s, p) => s + p.presence_pct, 0) / playersCache.length) : 0;
    document.getElementById('playersSub').textContent = `${playersCache.length} joueur${playersCache.length > 1 ? 's' : ''} · Présence moyenne ${avg}%`;
  } catch (e) { toast(e.message, 'error'); }
}

function renderGrid() {
  const wrap = document.getElementById('gridView');
  if (!playersCache.length) {
    wrap.innerHTML = `<div class="empty">Aucun joueur.${CAN_EDIT_PLAYERS ? '<br>Cliquez sur « Ajouter ».' : ''}</div>`;
    return;
  }
  wrap.innerHTML = `<div class="players-grid">` + playersCache.map((p, i) => {
    const name = escapeHtml(`${p.prenom || ''} ${p.nom}`.trim());
    const ini = escapeHtml(((p.prenom || p.nom || '?')[0] + (p.nom || '')[0] || '?').toUpperCase());
    return `<div class="player-card" data-name="${name.toLowerCase()}" onclick="showDetail(${p.id})">
      <div class="pc-top">
        <div class="pc-avatar ${avatarClass(i)}">${ini}</div>
        <div><div class="pc-name">${name}</div><div class="pc-poste">${escapeHtml(p.poste || '—')}</div></div>
        ${p.numero != null ? `<span class="pc-num">#${p.numero}</span>` : ''}
      </div>
      <div class="pc-stat"><span class="text-muted">Présence</span><strong style="color:var(--gold)">${p.presence_pct}%</strong></div>
      <div class="pc-bar"><span style="width:${p.presence_pct}%"></span></div>
      <div class="pc-foot">${p.nb_present}/${p.nb_total} séances</div>
    </div>`;
  }).join('') + `</div>`;
}

/* ---------- Matrice ---------- */
async function loadMatrix() {
  const wrap = document.getElementById('matrixView');
  wrap.innerHTML = `<div class="empty">Chargement…</div>`;
  try {
    const [{ data: sessions, error: e1 }, { data: players, error: e2 }, { data: att, error: e3 }] = await Promise.all([
      sb.from('sessions').select('id, titre, date_seance').order('date_seance'),
      sb.from('players').select('id, nom, prenom, numero').order('nom'),
      sb.from('attendance').select('player_id, session_id, present'),
    ]);
    if (e1 || e2 || e3) throw (e1 || e2 || e3);
    if (!players.length || !sessions.length) {
      wrap.innerHTML = `<div class="empty">Pas assez de données (joueurs et séances requis).</div>`;
      return;
    }
    const map = {};
    (att || []).forEach(a => { (map[a.player_id] ||= {})[a.session_id] = a.present ? 1 : 0; });

    const head = sessions.map(s => `<th title="${escapeHtml(s.titre)}">${escapeHtml(fmtDateFr(s.date_seance).slice(0, 5))}</th>`).join('');
    const rows = players.map(p => {
      const name = escapeHtml(`${p.prenom || ''} ${p.nom}`.trim());
      const cells = sessions.map(s => {
        const v = (map[p.id] || {})[s.id];
        const present = v === 1;
        const cls = present ? 'present' : (v === 0 ? 'absent' : '');
        const ro = CAN_EDIT_PLAYERS ? '' : 'readonly';
        const onclick = CAN_EDIT_PLAYERS ? `onclick="toggleCell(this,${p.id},${s.id})"` : '';
        return `<td><div class="matrix-cell ${cls} ${ro}" ${onclick}>${present ? '✓' : (v === 0 ? '✗' : '·')}</div></td>`;
      }).join('');
      return `<tr><td class="player-col">${name}${p.numero != null ? ` <span class="text-muted">#${p.numero}</span>` : ''}</td>${cells}</tr>`;
    }).join('');
    wrap.innerHTML = `<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="player-col">Joueur</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  } catch (e) { wrap.innerHTML = `<p class="text-danger">${escapeHtml(e.message)}</p>`; }
}

window.toggleCell = async (cell, playerId, sessionId) => {
  const present = !cell.classList.contains('present');
  try {
    const { error } = await sb.from('attendance').upsert({ player_id: playerId, session_id: sessionId, present }, { onConflict: 'player_id,session_id' });
    if (error) throw error;
    cell.classList.toggle('present', present);
    cell.classList.toggle('absent', !present);
    cell.textContent = present ? '✓' : '✗';
  } catch (e) { toast(e.message, 'error'); }
};

/* ---------- Vues / recherche ---------- */
function switchView(view) {
  document.querySelectorAll('#viewSwitch button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('gridView').classList.toggle('hidden', view !== 'grid');
  document.getElementById('matrixView').classList.toggle('hidden', view !== 'matrix');
  if (view === 'matrix') loadMatrix();
}
function applySearch(e) {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('#gridView .player-card').forEach(c => c.style.display = c.dataset.name.includes(q) ? '' : 'none');
}

/* ---------- Modale ajout/édition ---------- */
function openPlayerModal(p = null) {
  document.getElementById('playerModalTitle').textContent = p ? 'Modifier le joueur' : 'Nouveau joueur';
  document.getElementById('m-id').value = p?.id || '';
  document.getElementById('m-prenom').value = p?.prenom || '';
  document.getElementById('m-nom').value = p?.nom || '';
  document.getElementById('m-numero').value = p?.numero ?? '';
  document.getElementById('m-poste').value = p?.poste || '';
  openModal('playerModal');
}
async function savePlayer() {
  const id = document.getElementById('m-id').value;
  const nom = document.getElementById('m-nom').value.trim();
  const numeroRaw = document.getElementById('m-numero').value;
  const body = {
    nom, prenom: document.getElementById('m-prenom').value.trim() || null,
    numero: numeroRaw !== '' ? Number(numeroRaw) : null,
    poste: document.getElementById('m-poste').value.trim() || null,
  };
  if (!nom) return toast('Le nom est obligatoire.', 'error');
  try {
    if (id) {
      const { error } = await sb.from('players').update(body).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await sb.from('players').insert({ ...body, club_id: myProfile.club_id });
      if (error) throw error;
    }
    closeModal('playerModal');
    toast(id ? 'Joueur mis à jour' : 'Joueur ajouté', 'success');
    loadGrid();
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------- Détail ---------- */
window.showDetail = async (id) => {
  try {
    const p = playersCache.find(x => x.id === id);
    const { data: history, error } = await sb.from('attendance')
      .select('present, sessions(id, titre, date_seance, procedures(type_procede))')
      .eq('player_id', id).order('sessions(date_seance)', { ascending: false });
    if (error) throw error;

    // Types de procédés (jeu / exercice / situation) travaillés par le joueur.
    const themes = [...new Set((history || [])
      .filter(h => h.present)
      .flatMap(h => (h.sessions?.procedures || []).map(p => p.type_procede))
      .filter(Boolean))];

    const name = escapeHtml(`${p.prenom || ''} ${p.nom}`.trim());
    const ini = escapeHtml(((p.prenom || p.nom || '?')[0] + (p.nom || '')[0] || '?').toUpperCase());
    const presentCount = (history || []).filter(h => h.present).length;
    const pct = history?.length ? Math.round(presentCount / history.length * 100) : 0;

    const themesHtml = themes.length
      ? `<div class="tag-row">${themes.map(x => `<span class="badge badge-gold">${escapeHtml(x)}</span>`).join('')}</div>`
      : '<p class="text-muted">Aucun type de procédé renseigné.</p>';
    const histHtml = (history || []).length ? history.map(h => `
      <div class="detail-row"><span>${escapeHtml(h.sessions?.titre || '')} <span class="text-muted">${escapeHtml(fmtDateFr(h.sessions?.date_seance))}</span></span>
       <span class="${h.present ? 'text-success' : 'text-danger'}">${h.present ? '✓ Présent' : '✗ Absent'}</span></div>`
    ).join('') : '<p class="text-muted">Aucune séance.</p>';

    document.getElementById('detailBody').innerHTML = `
      <div class="detail-head">
        <div class="pc-avatar av0" style="width:54px;height:54px;font-size:1.1rem;">${ini}</div>
        <div><h3 style="margin:0;">${name}</h3>
          <div class="text-muted">${escapeHtml(p.poste || '—')}${p.numero != null ? ' · #' + p.numero : ''}</div></div>
        <button class="btn btn-sm" style="margin-left:auto;" data-close="detailModal">Fermer</button>
      </div>
      <div class="card" style="margin-bottom:14px;">
        <div class="pc-stat"><span>Présence globale</span><strong style="color:var(--gold)">${pct}%</strong></div>
        <div class="pc-bar"><span style="width:${pct}%"></span></div>
        <div class="pc-foot">${presentCount}/${history?.length || 0} séances</div>
      </div>
      <label>Types de procédés travaillés</label>${themesHtml}
      <label style="margin-top:14px;">Historique</label>
      <div class="detail-list">${histHtml}</div>
      ${CAN_EDIT_PLAYERS ? `<div class="modal-actions">
        <button class="btn btn-danger" type="button" onclick="deletePlayer(${p.id})">Supprimer</button>
        <button class="btn btn-primary" type="button" onclick='editFromDetail(${JSON.stringify(p)})'>Modifier</button></div>` : ''}`;
    openModal('detailModal');
  } catch (e) { toast(e.message, 'error'); }
};
window.editFromDetail = (p) => { closeModal('detailModal'); openPlayerModal(p); };
window.deletePlayer = async (id) => {
  if (!confirm('Supprimer ce joueur ?')) return;
  try {
    const { error } = await sb.from('players').delete().eq('id', id);
    if (error) throw error;
    closeModal('detailModal'); toast('Joueur supprimé.', 'success'); loadGrid();
  } catch (e) { toast(e.message, 'error'); }
};
