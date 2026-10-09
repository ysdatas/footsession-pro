/* ============================================================
   LMFC Performance — session-roster.js (page séance)
   Les joueurs dans la séance (lmfc_v9.sql, lmfc_v12.sql) :
     - statut de chacun (attendance.statut) : présent, reprise, absent,
       blessé, sélection, groupe pro, ou « Autre » avec un motif libre
       (statut_libre) et une case « participe » (present) ;
     - invités : n'importe quel joueur du club, ajouté pour cette
       séance seulement (attendance.invite), son équipe ne change pas ;
     - bilan individuel + / = / − et commentaire court
       (session_bilans), lisible d'un coup d'œil.
   L'état vit dans session-edit-page.js (attendance, bilans) ; ce
   fichier l'affiche et le modifie.
   ============================================================ */

// STATUTS, STATUT_LABEL, participe, statutLabel, statutOf, BILAN_NOTES : procedure-time.js.
const rosterName = (a) => `${a.prenom || ''} ${a.nom || ''}`.trim();

let clubPlayers = [];          // tout l'effectif du club (recherche d'invités)
const removedGuests = new Set(); // invités retirés : leur présence est supprimée à l'enregistrement
let bilanFilter = 'all';

/* ---------- Présences & statuts ---------- */
function renderAttendance() {
  const list = document.getElementById('attendanceList');
  const dis = CAN_WRITE ? '' : 'disabled';
  if (!attendance.length) {
    list.innerHTML = `<p class="text-muted">Aucun joueur. <a class="text-gold" href="players.html">Ajouter des joueurs</a></p>`;
  } else {
    list.innerHTML = attendance.map((a, i) => {
      const meta = [a.numero != null ? '#' + a.numero : '', a.poste || ''].filter(Boolean).join(' · ');
      const guest = a.invite ? `<span class="guest-badge" title="Présence exceptionnelle : son équipe ne change pas">Invité${teamName(a.team_id) ? ` · ${escapeHtml(teamName(a.team_id))}` : ''}</span>` : '';
      return `<div class="att-item st-${a.statut}${a.invite ? ' is-guest' : ''}">
        <div class="att-main">
          <div class="att-name">${escapeHtml(rosterName(a))}</div>
          <div class="att-meta">${escapeHtml(meta)}${guest}</div>
        </div>
        <select class="st-select st-${a.statut}" data-att="${i}" aria-label="Statut de ${escapeHtml(rosterName(a))}" ${dis}>
          ${statutOptions(a.statut)}
        </select>
        ${a.invite && CAN_WRITE ? `<button class="att-remove" type="button" data-remove-guest="${i}" aria-label="Retirer ${escapeHtml(rosterName(a))} de la séance" title="Retirer de la séance">✕</button>` : ''}
        ${a.statut === 'autre' ? `<div class="st-other">
          <input class="st-libre" data-libre="${i}" maxlength="40" value="${escapeHtml(a.statut_libre || '')}" placeholder="Motif (ex. Soins)" aria-label="Motif pour ${escapeHtml(rosterName(a))}" ${dis}>
          <label class="st-part"><input type="checkbox" data-part="${i}"${a.present ? ' checked' : ''} ${dis}> Participe</label>
        </div>` : ''}
      </div>`;
    }).join('');
  }
  updatePresentCount();
}

/* Statuts proposés ; un ancien statut (Retard, Excusé, Malade) reste affiché tel quel. */
function statutOptions(current) {
  const list = STATUTS_ANCIENS.some(s => s.key === current) ? [...STATUTS, STATUTS_ANCIENS.find(s => s.key === current)] : STATUTS;
  return list.map(s => `<option value="${s.key}"${s.key === current ? ' selected' : ''}>${s.label}</option>`).join('');
}

function updatePresentCount() {
  const p = attendance.filter(participe).length, guests = attendance.filter(a => a.invite).length;
  // Les autres statuts, regroupés par libellé (motif libre compris) ; « 2 blessés », « 1 groupe pro », « 1 soins ».
  const other = new Map();
  attendance.filter(a => !['present', 'absent'].includes(a.statut))
    .forEach(a => { const l = statutLabel(a).toLowerCase(); other.set(l, { n: (other.get(l)?.n || 0) + 1, plural: a.statut !== 'autre' && a.statut !== 'groupe_pro' }); });
  const parts = [`${p} présent${p > 1 ? 's' : ''}`,
    ...[...other].map(([l, o]) => `${o.n} ${l}${o.n > 1 && o.plural ? 's' : ''}`),
    guests ? `${guests} invité${guests > 1 ? 's' : ''}` : ''].filter(Boolean);
  document.getElementById('presentCount').textContent = parts.join(' · ');
}

/* Changement de statut : équipes, bilan et compteurs suivent. */
function setStatut(i, statut) {
  const a = attendance[i];
  a.statut = statut;
  if (statut === 'autre') a.present = false;   // à cocher si le joueur participe malgré tout
  markDirty();
  renderAttendance();
  renderRosterDependents();
  if (statut === 'autre') document.querySelector(`[data-libre="${i}"]`)?.focus();
}
function renderRosterDependents() {
  if (typeof renderProcBlocks === 'function') renderProcBlocks();
  renderBilans();
}

/* « Tous présents » : les absents passent présents ; blessés, malades,
   excusés et sélectionnés gardent leur statut. */
function allPresent() {
  attendance.forEach(a => { if (a.statut === 'absent') a.statut = 'present'; });
  markDirty();
  renderAttendance();
  renderRosterDependents();
}

/* ---------- Invités ---------- */
function guestCandidates(query) {
  const q = query.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (q.length < 2) return [];
  const inSession = new Set(attendance.map(a => a.player_id));
  return clubPlayers.filter(p => !inSession.has(p.id)
    && `${p.prenom || ''} ${p.nom || ''} ${p.prenom || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q))
    .slice(0, 8);
}
function renderGuestResults() {
  const input = document.getElementById('guestSearch'), box = document.getElementById('guestResults');
  const list = guestCandidates(input.value);
  box.innerHTML = list.map(p => `<button type="button" class="guest-hit" data-add-guest="${p.id}">
      <strong>${escapeHtml(rosterName(p))}</strong><span>${escapeHtml(teamName(p.team_id) || 'Sans équipe')}${p.numero != null ? ` · #${p.numero}` : ''}</span></button>`).join('')
    || (input.value.trim().length >= 2 ? '<p class="text-muted guest-none">Aucun joueur du club ne correspond.</p>' : '');
}
function addGuest(id) {
  const p = clubPlayers.find(x => x.id === id);
  if (!p || attendance.some(a => a.player_id === id)) return;
  removedGuests.delete(id);
  attendance.push({ player_id: p.id, nom: p.nom, prenom: p.prenom, numero: p.numero, poste: p.poste, team_id: p.team_id, statut: 'present', invite: true });
  document.getElementById('guestSearch').value = '';
  renderGuestResults();
  markDirty();
  renderAttendance();
  renderRosterDependents();
  toast(`${rosterName(p)} ajouté à cette séance seulement.`, 'success');
}
function removeGuest(i) {
  const a = attendance[i];
  if (!a?.invite) return;
  removedGuests.add(a.player_id);
  attendance.splice(i, 1);
  procedures.forEach(p => (p.equipes || []).forEach(t => { t.player_ids = t.player_ids.filter(id => id !== a.player_id); }));
  bilans.delete(a.player_id);
  markDirty();
  renderAttendance();
  renderRosterDependents();
}

/* ---------- Bilan individuel ---------- */
/* Joueurs du bilan : ceux qui participent, et ceux déjà notés. */
const bilanPlayers = () => attendance.filter(a => participe(a) || bilans.has(a.player_id));

function renderBilans() {
  const box = document.getElementById('bilanList');
  if (!box) return;
  const players = bilanPlayers();
  const noteOf = (a) => bilans.get(a.player_id)?.note || '';
  const count = (k) => players.filter(a => noteOf(a) === k).length;
  const none = players.filter(a => !noteOf(a)).length;
  const total = players.length || 1;
  document.getElementById('bilanCount').textContent = players.length
    ? `${count('plus')} + · ${count('egal')} = · ${count('moins')} −` : 'aucun participant';
  document.getElementById('bilanBar').innerHTML = players.length ? [['plus', count('plus')], ['egal', count('egal')], ['moins', count('moins')], ['none', none]]
    .filter(([, n]) => n).map(([k, n]) => `<span class="bb-${k}" style="flex:${n}" title="${n} ${k === 'none' ? 'non noté' : BILAN_NOTES.find(x => x.key === k).label.toLowerCase()}${n > 1 && k === 'none' ? 's' : ''}">${n}</span>`).join('') : '';
  document.querySelectorAll('[data-bilan-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.bilanFilter === bilanFilter)));

  const shown = players.filter(a => bilanFilter === 'all' || (bilanFilter === 'none' ? !noteOf(a) : noteOf(a) === bilanFilter));
  if (!players.length) { box.innerHTML = '<p class="text-muted">Marquez des joueurs présents pour faire le bilan.</p>'; return; }
  const dis = CAN_WRITE ? '' : 'disabled';
  box.innerHTML = shown.map(a => {
    const b = bilans.get(a.player_id) || {};
    return `<div class="bilan-row bl-${b.note || 'none'}" data-player="${a.player_id}">
      <span class="bilan-name">${escapeHtml(rosterName(a))}${a.invite ? ' <span class="guest-badge">Invité</span>' : ''}</span>
      <span class="bilan-notes" role="group" aria-label="Bilan de ${escapeHtml(rosterName(a))}">
        ${BILAN_NOTES.map(n => `<button type="button" class="bn bn-${n.key}" data-note="${n.key}" aria-pressed="${b.note === n.key}" title="${n.label}" ${dis}>${n.sign}</button>`).join('')}
      </span>
      <input class="bilan-comment" maxlength="140" value="${escapeHtml(b.commentaire || '')}" placeholder="Commentaire court (facultatif)" aria-label="Commentaire sur ${escapeHtml(rosterName(a))}" ${dis}>
    </div>`;
  }).join('') || '<p class="text-muted">Aucun joueur pour ce filtre.</p>';
}

function setBilan(playerId, patch) {
  const b = { ...(bilans.get(playerId) || {}), ...patch };
  bilans.set(playerId, b);
  markDirty();
}

/* ---------- Événements (une fois) ---------- */
function initRoster() {
  const list = document.getElementById('attendanceList');
  list.addEventListener('change', e => {
    if (!CAN_WRITE) return;
    const sel = e.target.closest('[data-att]');
    if (sel) return setStatut(Number(sel.dataset.att), sel.value);
    const part = e.target.closest('[data-part]');
    if (part) {
      attendance[Number(part.dataset.part)].present = part.checked;
      markDirty();
      updatePresentCount();
      renderRosterDependents();
    }
  });
  list.addEventListener('input', e => {
    const libre = e.target.closest('[data-libre]');
    if (!libre || !CAN_WRITE) return;
    attendance[Number(libre.dataset.libre)].statut_libre = libre.value;
    markDirty();
    updatePresentCount();
  });
  list.addEventListener('click', e => {
    const rm = e.target.closest('[data-remove-guest]');
    if (rm && CAN_WRITE) removeGuest(Number(rm.dataset.removeGuest));
  });
  document.getElementById('btnAllPresent')?.addEventListener('click', () => CAN_WRITE && allPresent());
  const search = document.getElementById('guestSearch');
  search?.addEventListener('input', renderGuestResults);
  document.getElementById('guestResults')?.addEventListener('click', e => {
    const b = e.target.closest('[data-add-guest]');
    if (b && CAN_WRITE) addGuest(Number(b.dataset.addGuest));
  });
  if (!CAN_WRITE) document.getElementById('rosterTools')?.classList.add('hidden');

  const bl = document.getElementById('bilanList');
  bl?.addEventListener('click', e => {
    const b = e.target.closest('[data-note]');
    if (!b || !CAN_WRITE) return;
    const id = Number(b.closest('[data-player]').dataset.player);
    const cur = bilans.get(id)?.note;
    setBilan(id, { note: cur === b.dataset.note ? null : b.dataset.note });   // second clic : retire la note
    renderBilans();
  });
  bl?.addEventListener('input', e => {
    if (!e.target.classList.contains('bilan-comment')) return;
    setBilan(Number(e.target.closest('[data-player]').dataset.player), { commentaire: e.target.value });
  });
  document.querySelectorAll('[data-bilan-filter]').forEach(b => b.addEventListener('click', () => { bilanFilter = b.dataset.bilanFilter; renderBilans(); }));
}

/* ---------- Enregistrement ---------- */
async function saveAttendance(sid) {
  if (removedGuests.size) {
    const { error } = await sb.from('attendance').delete().eq('session_id', sid).in('player_id', [...removedGuests]);
    if (error) throw error;
    removedGuests.clear();
  }
  if (!attendance.length) return;
  const rows = attendance.map(a => ({ player_id: a.player_id, session_id: sid, statut: a.statut, invite: !!a.invite, present: participe(a),
    statut_libre: a.statut === 'autre' ? (a.statut_libre || '').trim().slice(0, 40) || null : null }));
  const { error } = await sb.from('attendance').upsert(rows, { onConflict: 'player_id,session_id' });
  if (error) throw error;
}

/* Bilans : une ligne par joueur noté ou commenté ; une ligne vidée est supprimée. */
async function saveBilans(sid) {
  const keep = [], drop = [];
  bilans.forEach((b, player_id) => {
    const commentaire = (b.commentaire || '').trim();
    if (b.note || commentaire) keep.push({ session_id: sid, player_id, note: b.note || null, commentaire: commentaire || null });
    else drop.push(player_id);
  });
  if (keep.length) {
    const { error } = await sb.from('session_bilans').upsert(keep, { onConflict: 'session_id,player_id' });
    if (error) throw error;
  }
  if (drop.length) {
    const { error } = await sb.from('session_bilans').delete().eq('session_id', sid).in('player_id', drop);
    if (error) throw error;
  }
}
