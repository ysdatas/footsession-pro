/* ============================================================
   LMFC Performance — session-pitch.js (page séance)
   Terrain d'effectif (lmfc_v15.sql) : à côté des présences, un petit
   terrain où l'on pose les joueurs pour voir l'effectif d'un coup
   d'œil. Les noms restent dans la liste ; la poignée ⠿ d'un joueur
   se glisse sur le terrain (un clic le pose sur la ligne du bas),
   un pion se déplace, et sort du terrain pour être retiré (ou Suppr).
   Souris et doigt (pointer events). Placement : sessions.terrain,
   { "id du joueur": [x %, y %] }, enregistré automatiquement.
   ============================================================ */

let terrain = {};   // player_id (texte) → [x %, y %]
let pitchDrag = null;

const PITCH_LINES = `<svg class="pitch-lines" viewBox="0 0 68 105" preserveAspectRatio="none" aria-hidden="true">
  <rect x="1" y="1" width="66" height="103"/><line x1="1" y1="52.5" x2="67" y2="52.5"/><circle cx="34" cy="52.5" r="9.15"/>
  <rect x="13.85" y="1" width="40.3" height="16.5"/><rect x="24.85" y="1" width="18.3" height="5.5"/>
  <rect x="13.85" y="87.5" width="40.3" height="16.5"/><rect x="24.85" y="98.5" width="18.3" height="5.5"/></svg>`;
const pitchPlayer = (id) => attendance.find(a => String(a.player_id) === String(id));
const tokenLabel = (a) => (a.numero != null ? String(a.numero) : `${(a.prenom || '')[0] || ''}${(a.nom || '')[0] || ''}`.toUpperCase());
const tokenName = (a) => a.prenom || a.nom || '';

function renderPitch() {
  const box = document.getElementById('miniPitch');
  if (!box) return;
  // Un joueur qui n'est plus dans la séance (invité retiré) quitte le terrain.
  Object.keys(terrain).forEach(id => { if (!pitchPlayer(id)) delete terrain[id]; });
  box.innerHTML = PITCH_LINES + Object.entries(terrain).map(([id, [x, y]]) => {
    const a = pitchPlayer(id);
    return `<button type="button" class="pitch-token" data-token="${id}" style="left:${x}%;top:${y}%"
      aria-label="${escapeHtml(rosterName(a))}${CAN_WRITE ? ' (Suppr pour retirer)' : ''}" ${CAN_WRITE ? '' : 'tabindex="-1"'}>
      <span class="pt-dot">${escapeHtml(tokenLabel(a))}</span><span class="pt-name">${escapeHtml(tokenName(a))}</span></button>`;
  }).join('');
  document.querySelectorAll('[data-grip]').forEach(g => g.classList.toggle('is-placed', g.dataset.grip in terrain));
  const n = Object.keys(terrain).length;
  document.getElementById('pitchCount').textContent = n ? `${n} joueur${n > 1 ? 's' : ''}` : '';
  document.getElementById('pitchClear')?.classList.toggle('hidden', !CAN_WRITE || !n);
}

/* Pose sans glisser (clic, clavier) : la première place libre, en lignes de cinq depuis le bas. */
function placeDefault(id) {
  const n = Object.keys(terrain).length;
  terrain[id] = [12 + (n % 5) * 19, Math.max(8, 90 - Math.floor(n / 5) * 12)];
}

function startPitchDrag(e, id, fromPitch) {
  if (!CAN_WRITE || e.button > 0) return;
  e.preventDefault();
  const a = pitchPlayer(id);
  const ghost = document.createElement('div');
  ghost.className = 'pitch-token is-ghost';
  ghost.innerHTML = `<span class="pt-dot">${escapeHtml(tokenLabel(a))}</span><span class="pt-name">${escapeHtml(tokenName(a))}</span>`;
  document.body.appendChild(ghost);
  pitchDrag = { id, fromPitch, ghost, x0: e.clientX, y0: e.clientY, moved: false };
  document.querySelector(`[data-token="${id}"]`)?.classList.add('is-dragging');
  movePitchGhost(e);
  window.addEventListener('pointermove', movePitchGhost);
  window.addEventListener('pointerup', endPitchDrag, { once: true });
  window.addEventListener('pointercancel', endPitchDrag, { once: true });
}
function movePitchGhost(e) {
  if (!pitchDrag) return;
  if (Math.hypot(e.clientX - pitchDrag.x0, e.clientY - pitchDrag.y0) > 4) pitchDrag.moved = true;
  pitchDrag.ghost.style.left = `${e.clientX}px`;
  pitchDrag.ghost.style.top = `${e.clientY}px`;
}
function endPitchDrag(e) {
  const d = pitchDrag;
  if (!d) return;
  pitchDrag = null;
  window.removeEventListener('pointermove', movePitchGhost);
  d.ghost.remove();
  const r = document.getElementById('miniPitch').getBoundingClientRect();
  const inside = e.type === 'pointerup' && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  const pct = (v, lo, size) => Math.round(Math.min(96, Math.max(4, (v - lo) / size * 100)) * 10) / 10;
  if (!d.moved) {   // simple clic : la poignée pose le joueur (s'il n'y est pas) ; un pion ne bouge pas
    if (d.fromPitch || d.id in terrain) return renderPitch();
    placeDefault(d.id);
  }
  else if (inside) terrain[d.id] = [pct(e.clientX, r.left, r.width), pct(e.clientY, r.top, r.height)];
  else if (d.fromPitch) delete terrain[d.id];   // sorti du terrain : retiré
  else return renderPitch();
  markDirty();
  renderPitch();
}

function initPitch() {
  const list = document.getElementById('attendanceList'), box = document.getElementById('miniPitch');
  if (!box) return;
  list.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('[data-grip]');
    if (g) startPitchDrag(e, g.dataset.grip, false);
  });
  // Clavier (Entrée, Espace sur la poignée) : posé sans glisser.
  list.addEventListener('click', (e) => {
    const g = e.target.closest('[data-grip]');
    if (!g || e.detail || !CAN_WRITE) return;
    if (!(g.dataset.grip in terrain)) { placeDefault(g.dataset.grip); markDirty(); renderPitch(); }
  });
  box.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('[data-token]');
    if (t) startPitchDrag(e, t.dataset.token, true);
  });
  box.addEventListener('keydown', (e) => {
    const t = e.target.closest('[data-token]');
    if (!t || !CAN_WRITE || !['Delete', 'Backspace'].includes(e.key)) return;
    delete terrain[t.dataset.token];
    markDirty();
    renderPitch();
  });
  document.getElementById('pitchClear')?.addEventListener('click', () => {
    if (!confirm('Retirer tous les joueurs du terrain ?')) return;
    terrain = {};
    markDirty();
    renderPitch();
  });
}
