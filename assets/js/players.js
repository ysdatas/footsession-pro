/* ============================================================
   FootSession Pro — players.js
   Grille joueurs, matrice de présence, ajout/édition, détail.
   ============================================================ */

const PAPI = 'php/api/players.php';
const CAN_EDIT = !!document.getElementById('btnAddPlayer');

let playersCache = [];
let currentView = 'grid';

document.addEventListener('DOMContentLoaded', () => {
  $$('#viewSwitch button').forEach(b =>
    b.addEventListener('click', () => switchView(b.dataset.view)));
  $('#searchPlayer').addEventListener('input', applySearch);
  if (CAN_EDIT) {
    $('#btnAddPlayer').addEventListener('click', () => openPlayerModal());
    $('#m-save').addEventListener('click', savePlayer);
  }
  loadGrid();
});

function avatarClass(i) { return 'av' + (i % 6); }

/* ---------- Grille ---------- */
async function loadGrid() {
  try {
    const data = await API(`${PAPI}?action=list`);
    playersCache = data.players || [];
    renderGrid();
    const avg = playersCache.length
      ? Math.round(playersCache.reduce((s, p) => s + p.presence_pct, 0) / playersCache.length) : 0;
    $('#playersSub').textContent = `${playersCache.length} joueur${playersCache.length > 1 ? 's' : ''} · Présence moyenne ${avg}%`;
  } catch (e) { toast(e.message, 'error'); }
}

function renderGrid() {
  const wrap = $('#gridView');
  if (!playersCache.length) {
    wrap.innerHTML = `<div class="empty">Aucun joueur.${CAN_EDIT ? '<br>Cliquez sur « Ajouter ».' : ''}</div>`;
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
  const wrap = $('#matrixView');
  wrap.innerHTML = `<div class="empty">Chargement…</div>`;
  try {
    const data = await API(`${PAPI}?action=matrix`);
    if (!data.players.length || !data.sessions.length) {
      wrap.innerHTML = `<div class="empty">Pas assez de données (joueurs et séances requis).</div>`;
      return;
    }
    const head = data.sessions.map(s =>
      `<th title="${escapeHtml(s.titre)}">${escapeHtml(s.date_seance.slice(5))}</th>`).join('');
    const rows = data.players.map(p => {
      const name = escapeHtml(`${p.prenom || ''} ${p.nom}`.trim());
      const cells = data.sessions.map(s => {
        const v = (data.present[p.id] || {})[s.id];
        const present = v === 1;
        const cls = present ? 'present' : (v === 0 ? 'absent' : '');
        const ro = CAN_EDIT ? '' : 'readonly';
        const onclick = CAN_EDIT ? `onclick="toggleCell(this,${p.id},${s.id})"` : '';
        return `<td><div class="matrix-cell ${cls} ${ro}" ${onclick}>${present ? '✓' : (v === 0 ? '✗' : '·')}</div></td>`;
      }).join('');
      return `<tr><td class="player-col">${name}${p.numero != null ? ` <span class="text-muted">#${p.numero}</span>` : ''}</td>${cells}</tr>`;
    }).join('');
    wrap.innerHTML = `<div class="matrix-wrap"><table class="matrix">
      <thead><tr><th class="player-col">Joueur</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  } catch (e) { toast(e.message, 'error'); }
}

window.toggleCell = async (cell, playerId, sessionId) => {
  const present = !cell.classList.contains('present');
  try {
    await API(`php/api/attendance.php?action=set`, { method: 'POST', body: { player_id: playerId, session_id: sessionId, present: present ? 1 : 0 } });
    cell.classList.toggle('present', present);
    cell.classList.toggle('absent', !present);
    cell.textContent = present ? '✓' : '✗';
  } catch (e) { toast(e.message, 'error'); }
};

/* ---------- Vues / recherche ---------- */
function switchView(view) {
  currentView = view;
  $$('#viewSwitch button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#gridView').classList.toggle('hidden', view !== 'grid');
  $('#matrixView').classList.toggle('hidden', view !== 'matrix');
  if (view === 'matrix') loadMatrix();
}
function applySearch(e) {
  const q = e.target.value.toLowerCase();
  $$('#gridView .player-card').forEach(c => c.style.display = c.dataset.name.includes(q) ? '' : 'none');
}

/* ---------- Modale ajout/édition ---------- */
function openPlayerModal(p = null) {
  $('#playerModalTitle').textContent = p ? 'Modifier le joueur' : 'Nouveau joueur';
  $('#m-id').value = p?.id || '';
  $('#m-prenom').value = p?.prenom || '';
  $('#m-nom').value = p?.nom || '';
  $('#m-numero').value = p?.numero ?? '';
  $('#m-poste').value = p?.poste || '';
  openModal('playerModal');
}
async function savePlayer() {
  const id = $('#m-id').value;
  const body = {
    nom: $('#m-nom').value.trim(), prenom: $('#m-prenom').value.trim(),
    numero: $('#m-numero').value, poste: $('#m-poste').value.trim(),
  };
  if (!body.nom) return toast('Le nom est obligatoire.', 'error');
  try {
    if (id) { body.id = Number(id); await API(`${PAPI}?action=update`, { method: 'POST', body }); }
    else { await API(`${PAPI}?action=create`, { method: 'POST', body }); }
    closeModal('playerModal');
    toast(id ? 'Joueur mis à jour' : 'Joueur ajouté', 'success');
    loadGrid();
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------- Détail ---------- */
window.showDetail = async (id) => {
  try {
    const d = await API(`${PAPI}?action=detail&id=${id}`);
    const p = d.player;
    const name = escapeHtml(`${p.prenom || ''} ${p.nom}`.trim());
    const ini = escapeHtml(((p.prenom || p.nom || '?')[0] + (p.nom || '')[0] || '?').toUpperCase());
    const present = d.history.filter(h => Number(h.present) === 1).length;
    const pct = d.history.length ? Math.round(present / d.history.length * 100) : 0;
    const postes = d.postes.length
      ? `<div class="tag-row">${d.postes.map(x => `<span class="badge badge-gold">${escapeHtml(x)}</span>`).join('')}</div>`
      : '<p class="text-muted">Aucun poste enregistré.</p>';
    const hist = d.history.length ? d.history.map(h =>
      `<div class="detail-row"><span>${escapeHtml(h.titre)} <span class="text-muted">${escapeHtml(h.date_seance)}</span></span>
       <span class="${Number(h.present) ? 'text-success' : 'text-danger'}">${Number(h.present) ? '✓ Présent' : '✗ Absent'}</span></div>`
    ).join('') : '<p class="text-muted">Aucune séance.</p>';

    $('#detailBody').innerHTML = `
      <div class="detail-head">
        <div class="pc-avatar av0" style="width:54px;height:54px;font-size:1.1rem;">${ini}</div>
        <div><h3 style="margin:0;">${name}</h3>
          <div class="text-muted">${escapeHtml(p.poste || '—')}${p.numero != null ? ' · #' + p.numero : ''}</div></div>
        <button class="btn btn-sm" style="margin-left:auto;" data-close="detailModal">Fermer</button>
      </div>
      <div class="card" style="margin-bottom:14px;">
        <div class="pc-stat"><span>Présence globale</span><strong style="color:var(--gold)">${pct}%</strong></div>
        <div class="pc-bar"><span style="width:${pct}%"></span></div>
        <div class="pc-foot">${present}/${d.history.length} séances</div>
      </div>
      <label>Postes travaillés</label>${postes}
      <label style="margin-top:14px;">Historique</label>
      <div class="detail-list">${hist}</div>
      ${CAN_EDIT ? `<div class="modal-actions">
        <button class="btn btn-danger" type="button" onclick="deletePlayer(${p.id})">Supprimer</button>
        <button class="btn btn-primary" type="button" onclick="editFromDetail(${p.id})">Modifier</button></div>` : ''}`;
    openModal('detailModal');
  } catch (e) { toast(e.message, 'error'); }
};
window.editFromDetail = (id) => {
  const p = playersCache.find(x => Number(x.id) === Number(id));
  closeModal('detailModal');
  if (p) openPlayerModal(p);
};
window.deletePlayer = async (id) => {
  if (!confirm('Supprimer ce joueur ?')) return;
  try {
    await API(`${PAPI}?action=delete`, { method: 'POST', body: { id } });
    closeModal('detailModal'); toast('Joueur supprimé.', 'success'); loadGrid();
  } catch (e) { toast(e.message, 'error'); }
};
