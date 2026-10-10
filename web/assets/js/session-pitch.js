/* ============================================================
   LMFC Performance — session-pitch.js (page séance)
   Terrain d'effectif (lmfc_v15.sql) : à côté des présences, un petit
   terrain où l'on pose les joueurs pour voir l'effectif d'un coup
   d'œil. Les noms restent dans la liste ; la poignée ⠿ d'un joueur
   se glisse sur le terrain (un clic le pose sur la ligne du bas),
   un pion se déplace, et sort du terrain pour être retiré (ou Suppr).
   Clic droit (ou appui long au doigt) sur un pion : couleur du maillot ;
   les pions posés ensuite prennent la dernière couleur choisie.
   Souris et doigt (pointer events). Placement : sessions.terrain,
   { "id du joueur": [x %, y %, couleur ?] }, enregistré automatiquement.
   ============================================================ */

let terrain = {};   // player_id (texte) → [x %, y %, couleur du maillot ?]
let pitchDrag = null;
let pitchColor = null;   // dernière couleur choisie : celle des pions posés ensuite

const PITCH_LINES = `<svg class="pitch-lines" viewBox="0 0 68 105" preserveAspectRatio="none" aria-hidden="true">
  <rect x="1" y="1" width="66" height="103"/><line x1="1" y1="52.5" x2="67" y2="52.5"/><circle cx="34" cy="52.5" r="9.15"/>
  <rect x="13.85" y="1" width="40.3" height="16.5"/><rect x="24.85" y="1" width="18.3" height="5.5"/>
  <rect x="13.85" y="87.5" width="40.3" height="16.5"/><rect x="24.85" y="98.5" width="18.3" height="5.5"/></svg>`;
const pitchPlayer = (id) => attendance.find(a => String(a.player_id) === String(id));
const tokenLabel = (a) => (a.numero != null ? String(a.numero) : `${(a.prenom || '')[0] || ''}${(a.nom || '')[0] || ''}`.toUpperCase());
const tokenName = (a) => a.prenom || a.nom || '';
/* Maillot clair : numéro foncé ; maillot sombre : numéro blanc. */
const isLightColor = (hex) => { const n = parseInt(String(hex).slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150; };
const tokenStyle = (c) => (c ? `--pt:${c};--pt-ink:${isLightColor(c) ? '#0A0A0A' : '#fff'};` : '');
/* Nouvelle position ; la couleur du pion (ou la dernière choisie) est gardée. */
function setPitchPos(id, x, y) {
  const c = terrain[id]?.[2] || pitchColor;
  terrain[id] = c ? [x, y, c] : [x, y];
}

function renderPitch() {
  const box = document.getElementById('miniPitch');
  if (!box) return;
  // Un joueur qui n'est plus dans la séance (invité retiré) quitte le terrain.
  Object.keys(terrain).forEach(id => { if (!pitchPlayer(id)) delete terrain[id]; });
  box.innerHTML = PITCH_LINES + Object.entries(terrain).map(([id, [x, y, c]]) => {
    const a = pitchPlayer(id);
    return `<button type="button" class="pitch-token" data-token="${id}" style="left:${x}%;top:${y}%;${tokenStyle(c)}"
      aria-label="${escapeHtml(rosterName(a))}${CAN_WRITE ? ' (Suppr pour retirer, clic droit pour la couleur)' : ''}" ${CAN_WRITE ? '' : 'tabindex="-1"'}>
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
  setPitchPos(id, 12 + (n % 5) * 19, Math.max(8, 90 - Math.floor(n / 5) * 12));
}

function startPitchDrag(e, id, fromPitch) {
  if (!CAN_WRITE || e.button > 0) return;
  e.preventDefault();
  const a = pitchPlayer(id);
  const ghost = document.createElement('div');
  ghost.className = 'pitch-token is-ghost';
  ghost.style.cssText = tokenStyle(terrain[id]?.[2] || pitchColor);
  ghost.innerHTML = `<span class="pt-dot">${escapeHtml(tokenLabel(a))}</span><span class="pt-name">${escapeHtml(tokenName(a))}</span>`;
  document.body.appendChild(ghost);
  pitchDrag = { id, fromPitch, ghost, x0: e.clientX, y0: e.clientY, moved: false };
  // Appui long sur un pion sans bouger (doigt) : la couleur du maillot, comme un clic droit.
  if (fromPitch) pitchDrag.press = setTimeout(() => {
    if (!pitchDrag || pitchDrag.moved) return;
    cancelPitchDrag();
    openPitchPalette(id, e.clientX, e.clientY);
  }, 550);
  document.querySelector(`[data-token="${id}"]`)?.classList.add('is-dragging');
  movePitchGhost(e);
  window.addEventListener('pointermove', movePitchGhost);
  window.addEventListener('pointerup', endPitchDrag, { once: true });
  window.addEventListener('pointercancel', endPitchDrag, { once: true });
}
function movePitchGhost(e) {
  if (!pitchDrag) return;
  if (Math.hypot(e.clientX - pitchDrag.x0, e.clientY - pitchDrag.y0) > 4) { pitchDrag.moved = true; clearTimeout(pitchDrag.press); }
  pitchDrag.ghost.style.left = `${e.clientX}px`;
  pitchDrag.ghost.style.top = `${e.clientY}px`;
}
function cancelPitchDrag() {
  const d = pitchDrag;
  if (!d) return null;
  pitchDrag = null;
  clearTimeout(d.press);
  window.removeEventListener('pointermove', movePitchGhost);
  d.ghost.remove();
  document.querySelector(`[data-token="${d.id}"]`)?.classList.remove('is-dragging');
  return d;
}
function endPitchDrag(e) {
  const d = cancelPitchDrag();
  if (!d) return;
  const r = document.getElementById('miniPitch').getBoundingClientRect();
  const inside = e.type === 'pointerup' && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  const pct = (v, lo, size) => Math.round(Math.min(96, Math.max(4, (v - lo) / size * 100)) * 10) / 10;
  if (!d.moved) {   // simple clic : la poignée pose le joueur (s'il n'y est pas) ; un pion ne bouge pas
    if (d.fromPitch || d.id in terrain) return renderPitch();
    placeDefault(d.id);
  }
  else if (inside) setPitchPos(d.id, pct(e.clientX, r.left, r.width), pct(e.clientY, r.top, r.height));
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
  // Clic droit (ou touche Menu) sur un pion : couleur du maillot.
  box.addEventListener('contextmenu', (e) => {
    const t = e.target.closest('[data-token]');
    if (!t || !CAN_WRITE) return;
    e.preventDefault();
    const r = t.getBoundingClientRect();
    openPitchPalette(t.dataset.token, e.clientX || r.right, e.clientY || r.bottom);
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

/* Couleurs de maillot (COLOR_PALETTE, app.js), près du pion. « Tous les pions »
   habille tout le terrain d'un coup. */
function openPitchPalette(id, x, y) {
  closePitchPalette();
  const pal = document.createElement('div');
  pal.className = 'pitch-palette';
  pal.id = 'pitchPalette';
  pal.setAttribute('role', 'dialog');
  pal.setAttribute('aria-label', 'Couleur du maillot');
  pal.innerHTML = `<span class="pp-title">Maillot · ${escapeHtml(tokenName(pitchPlayer(id)))}</span>
    <div class="pp-colors">${COLOR_PALETTE.map((c, i) => `<button type="button" data-color="${c}" style="background:${c}" title="${COLOR_NAMES[i]}" aria-label="${COLOR_NAMES[i]}"></button>`).join('')}</div>
    <label class="pp-all"><input type="checkbox" id="ppAll"> Tous les pions</label>`;
  document.body.appendChild(pal);
  const w = pal.offsetWidth, h = pal.offsetHeight;
  pal.style.left = `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`;
  pal.style.top = `${Math.max(8, Math.min(y, innerHeight - h - 8))}px`;
  pal.querySelector('[data-color]').focus();
  pal.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    pitchColor = b.dataset.color;
    const ids = document.getElementById('ppAll').checked ? Object.keys(terrain) : [id];
    ids.forEach(k => { if (terrain[k]) terrain[k] = [terrain[k][0], terrain[k][1], pitchColor]; });
    closePitchPalette();
    markDirty();
    renderPitch();
  });
  setTimeout(() => document.addEventListener('pointerdown', closePitchOutside), 0);
  document.addEventListener('keydown', closePitchOnEscape);
}
function closePitchPalette() {
  document.getElementById('pitchPalette')?.remove();
  document.removeEventListener('pointerdown', closePitchOutside);
  document.removeEventListener('keydown', closePitchOnEscape);
}
const closePitchOutside = (e) => { if (!e.target.closest('#pitchPalette')) closePitchPalette(); };
const closePitchOnEscape = (e) => { if (e.key === 'Escape') closePitchPalette(); };
