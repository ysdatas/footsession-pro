/* ============================================================
   FootSession Pro — tactical-board.js
   Tableau tactique : Canvas HTML5 natif, drag & drop, formes
   redimensionnables, flèches, texte, formations, étapes animées,
   sauvegarde BDD + autosave LocalStorage.
   ============================================================ */

const LW = 1040, LH = 680;           // dimensions logiques du terrain
const HANDLE = 9;                    // rayon de prise (poignées)
const canvas = document.getElementById('pitch');
const ctx = canvas.getContext('2d');

let idSeq = 1;
const nid = () => idSeq++;

const state = {
  view: 'complet', tool: 'select',
  items: [], selIds: [],
  drawColor: '#C9A84C', jersey: '#E03131', opp: '#1f6feb',
  showNumbers: true, nextNum: 1, nextOpp: 1, tokenR: 18, equipR: 16, textFont: 'Inter, sans-serif',
  steps: [], history: [],
  // Cadrage d'export (mode « Screen ») : {x, y, w, h} en coordonnées paysage, ou null = plein terrain.
  screen: null,
};

const PROC = new URLSearchParams(location.search).get('procedure_id') ? Number(new URLSearchParams(location.search).get('procedure_id')) : null;
let CAN_EDIT = false;   // déterminé après authentification (boot()), avant tout rendu
let CLUB_ID = null;
const LS_KEY = 'tb_' + (PROC || 'scratch');

/* ---------- Couleurs ---------- */
/* Normalise une couleur en #rrggbb (valeur attendue par <input type="color">). */
function toHex(color) {
  if (typeof color !== 'string' || !color) return '#C9A84C';
  if (color[0] === '#') {
    return color.length === 4 ? '#' + [1, 2, 3].map(i => color[i] + color[i]).join('') : color.slice(0, 7);
  }
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (m) return '#' + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, '0')).join('');
  return '#C9A84C';
}
/* Couleur hex → rgba(...) avec transparence (remplissage des zones). */
function hexA(color, alpha) {
  const n = parseInt(toHex(color).slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/* ---------- Orientation ----------
   Les éléments sont TOUJOURS stockés en coordonnées « paysage » (LW×LH).
   La vue « Horizontal » ne fait que pivoter l'affichage et la saisie de 90°
   → un pion placé au point de penalty reste au point de penalty dans toutes les vues. */
const isPortrait = () => state.view === 'horizontal';
const curW = () => isPortrait() ? LH : LW;   // largeur logique du canvas selon l'orientation
const curH = () => isPortrait() ? LW : LH;   // hauteur logique du canvas selon l'orientation

/* Applique la transformation de base (DPR + rotation portrait éventuelle). */
function applyBaseTransform() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (isPortrait()) { ctx.translate(0, LW); ctx.rotate(-Math.PI / 2); } // (x,y) paysage → (y, LW−x) portrait
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = curW() * dpr;
  canvas.height = curH() * dpr;
  canvas.style.aspectRatio = curW() + ' / ' + curH();
  render();
}
window.addEventListener('resize', () => { render(); });

function getPos(e) {
  const r = canvas.getBoundingClientRect();
  const px = (e.clientX - r.left) * (curW() / r.width);
  const py = (e.clientY - r.top) * (curH() / r.height);
  // Inverse de la rotation portrait pour retrouver les coordonnées paysage.
  return isPortrait() ? { x: LW - py, y: px } : { x: px, y: py };
}

/* ============================================================
   DESSIN DU TERRAIN
   ============================================================ */
const PITCH_MARGIN = 30;
function drawPitch() {
  // Pelouse (vert proche du pitch.svg de référence)
  ctx.fillStyle = '#0b8f34';
  ctx.fillRect(0, 0, LW, LH);
  // Tontes très légères
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  const bands = 12;
  for (let i = 0; i < bands; i++) if (i % 2) ctx.fillRect(i * LW / bands, 0, LW / bands, LH);

  if (state.view === 'vierge') return;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.72)';   // lignes blanches semi-transparentes (comme le SVG)
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  const m = PITCH_MARGIN;

  if (state.view === 'futsal') { drawFutsal(m); ctx.restore(); return; }

  const L = LW - 2 * m, H = LH - 2 * m;
  ctx.strokeRect(m, m, L, H);

  if (state.view === 'demi') {
    // Demi-terrain : ligne médiane sur le bord droit + demi rond central
    ctx.beginPath(); ctx.arc(LW - m, LH / 2, H * 0.135, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
    dot(LW - m, LH / 2, 3.2);
    penaltyArea(m, LH / 2, L, H, 1);
    cornerArc(m, m, 0); cornerArc(m, LH - m, 3);
    ctx.restore(); return;
  }

  // Terrain complet
  ctx.beginPath(); ctx.moveTo(LW / 2, m); ctx.lineTo(LW / 2, LH - m); ctx.stroke();
  circle(LW / 2, LH / 2, H * 0.135); dot(LW / 2, LH / 2, 3.2);
  penaltyArea(m, LH / 2, L, H, 1);
  penaltyArea(LW - m, LH / 2, L, H, -1);
  cornerArc(m, m, 0); cornerArc(LW - m, m, 1); cornerArc(LW - m, LH - m, 2); cornerArc(m, LH - m, 3);
  ctx.restore();
}

/* Surface de réparation + surface de but + point de penalty + arc (D) + but */
function penaltyArea(edgeX, cy, L, H, dir) {
  const pbD = L * 0.155, pbH = H * 0.60;   // surface de réparation
  const gbD = L * 0.055, gbH = H * 0.30;   // surface de but
  const spot = L * 0.105;                  // point de penalty
  ctx.strokeRect(dir > 0 ? edgeX : edgeX - pbD, cy - pbH / 2, pbD, pbH);
  ctx.strokeRect(dir > 0 ? edgeX : edgeX - gbD, cy - gbH / 2, gbD, gbH);
  const px = dir > 0 ? edgeX + spot : edgeX - spot;
  dot(px, cy, 3);
  // Arc de cercle, seulement la portion hors de la surface
  const arcR = H * 0.135;
  const pbEdge = dir > 0 ? edgeX + pbD : edgeX - pbD;
  const cosA = ((pbEdge - px) * dir) / arcR;
  if (cosA > -1 && cosA < 1) {
    const a = Math.acos(cosA);
    ctx.beginPath();
    if (dir > 0) ctx.arc(px, cy, arcR, -a, a);
    else ctx.arc(px, cy, arcR, Math.PI - a, Math.PI + a);
    ctx.stroke();
  }
  // Cage
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 3;
  const gH = H * 0.11;
  ctx.strokeRect(dir > 0 ? edgeX - 6 : edgeX, cy - gH / 2, 6, gH);
  ctx.restore();
}

/* Arc de corner. corner : 0=haut-gauche 1=haut-droit 2=bas-droit 3=bas-gauche */
function cornerArc(x, y, corner) {
  const start = [0, Math.PI / 2, Math.PI, Math.PI * 1.5][corner];
  ctx.beginPath(); ctx.arc(x, y, 15, start, start + Math.PI / 2); ctx.stroke();
}

function drawFutsal(m) {
  const L = LW - 2 * m, H = LH - 2 * m;
  ctx.strokeRect(m, m, L, H);
  ctx.beginPath(); ctx.moveTo(LW / 2, m); ctx.lineTo(LW / 2, LH - m); ctx.stroke();
  circle(LW / 2, LH / 2, H * 0.13); dot(LW / 2, LH / 2, 3.2);
  ctx.beginPath(); ctx.arc(m, LH / 2, H * 0.30, -Math.PI / 2, Math.PI / 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(LW - m, LH / 2, H * 0.30, Math.PI / 2, -Math.PI / 2); ctx.stroke();
  dot(m + L * 0.10, LH / 2, 3); dot(LW - m - L * 0.10, LH / 2, 3);
}
function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); }
function dot(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fill(); }

/* ============================================================
   DESSIN DES ÉLÉMENTS
   ============================================================ */
function render() {
  applyBaseTransform();
  ctx.clearRect(-5, -5, LW + 10, LH + 10);
  drawPitch();
  for (const it of state.items) withRotation(it, () => drawItem(it));
  if (CAN_EDIT && state.tool === 'select') drawSelection();
  if (state.tool !== 'view') drawScreenFrame();   // masqué pendant l'export
}

/* Cadre d'export « Screen » : celui en cours de tracé, ou celui déjà défini. */
function drawScreenFrame() {
  const live = drag && drag.mode === 'screen'
    ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) }
    : null;
  const f = live || state.screen;
  if (!f) return;
  ctx.save();
  // Assombrit l'extérieur du cadre pour visualiser ce qui sera exporté.
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(0, 0, LW, f.y);
  ctx.fillRect(0, f.y + f.h, LW, LH - (f.y + f.h));
  ctx.fillRect(0, f.y, f.x, f.h);
  ctx.fillRect(f.x + f.w, f.y, LW - (f.x + f.w), f.h);
  ctx.strokeStyle = '#C9A84C'; ctx.lineWidth = 2; ctx.setLineDash([8, 5]);
  ctx.strokeRect(f.x, f.y, f.w, f.h);
  ctx.setLineDash([]);
  ctx.restore();
}

function drawItem(it) {
  switch (it.type) {
    case 'player': case 'opponent': return drawToken(it);
    case 'shape': return drawShape(it);
    case 'arrow': return drawArrow(it);
    case 'line':  return drawLine(it);
    case 'text':  return drawText(it);
    case 'logo':  return drawLogo(it);
    case 'equip': return drawEquip(it);
  }
}

/* Texte lisible : légère ombre portée pour le contraste, et en mode Horizontal
   (portrait) on contre-tourne le texte de +90° pour qu'il reste droit à l'écran. */
function txt(text, x, y) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 4; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 1;
  if (isPortrait()) { ctx.translate(x, y); ctx.rotate(Math.PI / 2); ctx.fillText(text, 0, 0); }
  else ctx.fillText(text, x, y);
  ctx.restore();
}

function drawToken(it) {
  // Ombre douce sous le pion pour le détacher du terrain.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
  ctx.beginPath(); ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2);
  ctx.fillStyle = it.color; ctx.fill();
  ctx.restore();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2); ctx.stroke();
  if (state.showNumbers && it.number != null) {
    ctx.fillStyle = '#fff'; ctx.font = `700 ${it.r}px Inter, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    txt(String(it.number), it.x, it.y + 1);
  }
  if (it.label) {
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = '600 13px Inter';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    txt(it.label, it.x, it.y + it.r + 13);
  }
}

function drawShape(it) {
  ctx.strokeStyle = it.color; ctx.lineWidth = 2.5;
  ctx.fillStyle = hexA(it.color, 0.12);
  ctx.setLineDash(it.dash ? [11, 7] : []);      // contour plein ou pointillé
  if (it.shape === 'circle') {
    ctx.beginPath(); ctx.ellipse(it.x + it.w / 2, it.y + it.h / 2, Math.abs(it.w / 2), Math.abs(it.h / 2), 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  } else if (it.shape === 'triangle') {
    ctx.beginPath();
    ctx.moveTo(it.x + it.w / 2, it.y);
    ctx.lineTo(it.x + it.w, it.y + it.h);
    ctx.lineTo(it.x, it.y + it.h);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.rect(it.x, it.y, it.w, it.h); ctx.fill(); ctx.stroke();
  }
  ctx.setLineDash([]);
  if (it.label) {
    const b = bounds(it);
    let ly = b.y + b.h / 2;                       // position de l'étiquette : centre / dessus / dessous
    if (it.labelPos === 'top') ly = b.y - 12;
    else if (it.labelPos === 'bottom') ly = b.y + b.h + 14;
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    ctx.font = '600 15px Inter, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    txt(it.label, b.x + b.w / 2, ly);
  }
}

/* Point d'angle d'un segment : renvoie le sommet saisi par l'utilisateur,
   ou null si la flèche est droite. Sert à accentuer un angle en 2D
   (course qui casse, passe qui contourne un adversaire). */
function bendOf(it) {
  return (typeof it.mx === 'number' && typeof it.my === 'number') ? { x: it.mx, y: it.my } : null;
}
/* Milieu géométrique : position par défaut de la poignée d'angle. */
function midOf(it) {
  return bendOf(it) || { x: (it.x1 + it.x2) / 2, y: (it.y1 + it.y2) / 2 };
}

function drawArrow(it) {
  const bend = bendOf(it);
  ctx.strokeStyle = it.color; ctx.lineWidth = 3;
  ctx.setLineDash(it.style === 'dashed' ? [10, 8] : []);
  ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(it.x1, it.y1);
  if (bend) {
    ctx.lineTo(bend.x, bend.y); ctx.lineTo(it.x2, it.y2);
  } else if (it.style === 'curved') {
    // Ancien style conservé pour que les schémas déjà enregistrés
    // continuent de s'afficher, même si l'outil n'est plus proposé.
    const cx = (it.x1 + it.x2) / 2, cy = Math.min(it.y1, it.y2) - 70;
    ctx.quadraticCurveTo(cx, cy, it.x2, it.y2);
  } else {
    ctx.lineTo(it.x2, it.y2);
  }
  ctx.stroke(); ctx.setLineDash([]);
  // Pointe : orientée par le dernier segment parcouru.
  const from = bend || { x: it.x1, y: it.y1 };
  const ang = Math.atan2(it.y2 - from.y, it.x2 - from.x);
  ctx.beginPath();
  ctx.moveTo(it.x2, it.y2);
  ctx.lineTo(it.x2 - 16 * Math.cos(ang - 0.4), it.y2 - 16 * Math.sin(ang - 0.4));
  ctx.lineTo(it.x2 - 16 * Math.cos(ang + 0.4), it.y2 - 16 * Math.sin(ang + 0.4));
  ctx.closePath(); ctx.fillStyle = it.color; ctx.fill();
}
function drawLine(it) {
  const bend = bendOf(it);
  ctx.strokeStyle = it.color; ctx.lineWidth = 3; ctx.setLineDash([]);
  ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(it.x1, it.y1);
  if (bend) ctx.lineTo(bend.x, bend.y);
  ctx.lineTo(it.x2, it.y2); ctx.stroke();
}
function drawText(it) {
  ctx.fillStyle = it.color; ctx.font = `600 ${it.size}px ${it.font || 'Inter, sans-serif'}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  txt(it.text || '…', it.x, it.y);
}
function drawLogo(it) {
  if (it._img && it._img.complete) ctx.drawImage(it._img, it.x, it.y, it.w, it.h);
  else { ctx.strokeStyle = '#fff'; ctx.strokeRect(it.x, it.y, it.w, it.h); }
}

/* ============================================================
   MATÉRIEL D'ENTRAÎNEMENT (cône, coupelle, échelle, piquet, haie, ballon)
   Dessinés en vecteur, style plat cohérent, taille pilotée par it.r.
   ============================================================ */
function drawEquip(it) {
  const s = it.r;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 2;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const x = it.x, y = it.y;
  if (it.kind === 'cone') {
    ctx.fillStyle = '#eb7a2e';
    ctx.beginPath(); ctx.moveTo(x - s * 0.75, y + s * 0.75); ctx.lineTo(x + s * 0.75, y + s * 0.75); ctx.lineTo(x, y - s); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.moveTo(x - s * 0.5, y + s * 0.1); ctx.lineTo(x + s * 0.5, y + s * 0.1); ctx.lineTo(x + s * 0.4, y - s * 0.15); ctx.lineTo(x - s * 0.4, y - s * 0.15); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c85f1c'; ctx.beginPath(); ctx.ellipse(x, y + s * 0.78, s, s * 0.28, 0, 0, Math.PI * 2); ctx.fill();
  } else if (it.kind === 'disc') {          // coupelle plate
    ctx.fillStyle = it.color && it.color !== '#C9A84C' ? it.color : '#f2b21e';
    ctx.beginPath(); ctx.ellipse(x, y + s * 0.35, s, s * 0.32, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y + s * 0.35, s * 0.62, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.4; ctx.stroke();
  } else if (it.kind === 'ladder') {        // échelle de coordination
    const w = s * 1.3, h = s * 3.4, rungs = 6;
    ctx.strokeStyle = '#f2c21e'; ctx.lineWidth = 2.4;
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    for (let i = 1; i < rungs; i++) { const ry = y - h / 2 + (h / rungs) * i; ctx.beginPath(); ctx.moveTo(x - w / 2, ry); ctx.lineTo(x + w / 2, ry); ctx.stroke(); }
  } else if (it.kind === 'pole') {          // piquet / slalom
    ctx.strokeStyle = '#e03131'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(x, y - s * 1.5); ctx.lineTo(x, y + s * 0.85); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3.4; ctx.setLineDash([s * 0.5, s * 0.5]);
    ctx.beginPath(); ctx.moveTo(x, y - s * 1.5); ctx.lineTo(x, y + s * 0.5); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#2b2b2b'; ctx.beginPath(); ctx.ellipse(x, y + s * 0.9, s * 0.75, s * 0.26, 0, 0, Math.PI * 2); ctx.fill();
  } else if (it.kind === 'hurdle') {        // haie
    ctx.strokeStyle = '#e8792b'; ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.moveTo(x - s, y - s * 0.55); ctx.lineTo(x + s, y - s * 0.55); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - s, y - s * 0.55); ctx.lineTo(x - s * 0.55, y + s * 0.8);
    ctx.moveTo(x + s, y - s * 0.55); ctx.lineTo(x + s * 0.55, y + s * 0.8);
    ctx.moveTo(x - s * 0.55, y - s * 0.05); ctx.lineTo(x + s * 0.55, y - s * 0.05);
    ctx.stroke();
  } else if (it.kind === 'goal') {          // cage / but (vue de dessus, avec filet)
    const gw = s * 2.6, gh = s * 1.2;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x - gw / 2, y - gh / 2, gw, gh);
    ctx.strokeStyle = '#f4f6f8'; ctx.lineWidth = Math.max(1.6, s * 0.14);
    ctx.strokeRect(x - gw / 2, y - gh / 2, gw, gh);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.8;
    const step = s * 0.32;
    for (let gx = x - gw / 2 + step; gx < x + gw / 2 - 1; gx += step) { ctx.beginPath(); ctx.moveTo(gx, y - gh / 2); ctx.lineTo(gx, y + gh / 2); ctx.stroke(); }
    for (let gy = y - gh / 2 + step; gy < y + gh / 2 - 1; gy += step) { ctx.beginPath(); ctx.moveTo(x - gw / 2, gy); ctx.lineTo(x + gw / 2, gy); ctx.stroke(); }
  } else if (it.kind === 'ball') {          // ballon (motif classique pentagone/hexagone)
    // Sphère avec léger dégradé pour le volume.
    const g = ctx.createRadialGradient(x - s * 0.35, y - s * 0.4, s * 0.15, x, y, s * 1.05);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.75, '#eef1f4'); g.addColorStop(1, '#cfd6de');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1f2937'; ctx.lineWidth = Math.max(1, s * 0.09); ctx.stroke();
    // Pentagone central noir.
    const pent = [];
    for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 2 * Math.PI / 5; pent.push([x + Math.cos(a) * s * 0.4, y + Math.sin(a) * s * 0.4]); }
    ctx.fillStyle = '#111827';
    ctx.beginPath(); pent.forEach((pt, i) => i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1])); ctx.closePath(); ctx.fill();
    // Coutures + petits pentagones noirs au bord.
    ctx.strokeStyle = '#1f2937'; ctx.lineWidth = Math.max(0.8, s * 0.06);
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + k * 2 * Math.PI / 5;
      ctx.beginPath(); ctx.moveTo(pent[k][0], pent[k][1]); ctx.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s); ctx.stroke();
      const ea = a + Math.PI / 5, ex = x + Math.cos(ea) * s * 0.88, ey = y + Math.sin(ea) * s * 0.88;
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      for (let j = 0; j < 5; j++) { const pa = ea + Math.PI + j * 2 * Math.PI / 5; const px = ex + Math.cos(pa) * s * 0.2, py = ey + Math.sin(pa) * s * 0.2; j ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
  if (it.label) { ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = '600 12px Inter'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; txt(it.label, x, y + s * 2); }
}

/* Poignées + cadres de sélection (multi) + rectangle marquee en cours */
function drawSelection() {
  // Rectangle de sélection multiple pendant le glisser
  if (drag && drag.mode === 'marquee') {
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
    ctx.setLineDash([6, 4]); ctx.strokeStyle = '#C9A84C'; ctx.lineWidth = 1.2;
    ctx.fillStyle = 'rgba(201,168,76,0.10)';
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
  }
  const sels = selectedItems(); if (!sels.length) return;
  ctx.strokeStyle = '#C9A84C'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
  for (const it of sels) {
    if (it.type === 'arrow' || it.type === 'line') {
      const bend = bendOf(it);
      ctx.beginPath(); ctx.moveTo(it.x1, it.y1);
      if (bend) ctx.lineTo(bend.x, bend.y);
      ctx.lineTo(it.x2, it.y2); ctx.stroke();
    }
    else { const b = bounds(it); withRotation(it, () => ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4)); }
  }
  ctx.setLineDash([]);
  // Poignées de redimensionnement uniquement en sélection unique
  const one = selected();
  if (one) {
    if (one.type === 'arrow' || one.type === 'line') {
      handle(one.x1, one.y1); handle(one.x2, one.y2);
      // Poignée d'angle : pleine si l'angle est posé, creuse sinon (invitation à la saisir).
      const m = midOf(one); handle(m.x, m.y, !bendOf(one));
    }
    else { const b = bounds(one); withRotation(one, () => [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].forEach(c => handle(c[0], c[1]))); }
  }
}
function handle(x, y, hollow) {
  ctx.beginPath(); ctx.arc(x, y, HANDLE - 2, 0, Math.PI * 2);
  ctx.fillStyle = hollow ? 'rgba(201,168,76,.25)' : '#C9A84C'; ctx.fill();
  ctx.strokeStyle = hollow ? '#C9A84C' : '#000'; ctx.lineWidth = hollow ? 1.6 : 1; ctx.stroke();
}

/* ============================================================
   GÉOMÉTRIE / HIT-TEST
   ============================================================ */
function bounds(it) {
  if (it.type === 'player' || it.type === 'opponent') return { x: it.x - it.r, y: it.y - it.r, w: it.r * 2, h: it.r * 2 };
  if (it.type === 'equip') return { x: it.x - it.r * 1.15, y: it.y - it.r * 1.7, w: it.r * 2.3, h: it.r * 3.4 };
  if (it.type === 'text') { const w = (it.text || '…').length * it.size * 0.6, h = it.size; return { x: it.x - w / 2, y: it.y - h / 2, w, h }; }
  // shape / logo : normaliser largeur/hauteur négatives
  const x = Math.min(it.x, it.x + it.w), y = Math.min(it.y, it.y + it.h);
  return { x, y, w: Math.abs(it.w), h: Math.abs(it.h) };
}
function hitItem(p) {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const it = state.items[i];
    if (it.type === 'arrow' || it.type === 'line') { if (distSeg(p, it) < 9) return it; continue; }
    const lp = localPoint(p, it);      // repère non-tourné
    if (it.type === 'player' || it.type === 'opponent') { if (Math.hypot(lp.x - it.x, lp.y - it.y) <= it.r + 2) return it; continue; }
    const b = bounds(it);
    if (lp.x >= b.x && lp.x <= b.x + b.w && lp.y >= b.y && lp.y <= b.y + b.h) return it;
  }
  return null;
}
function distToSegment(p, A, B) {
  const dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy || 1;
  let t = ((p.x - A.x) * dx + (p.y - A.y) * dy) / l2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (A.x + t * dx), p.y - (A.y + t * dy));
}
/* Distance au tracé : une flèche coudée compte ses deux segments, sinon
   un clic sur la seconde branche ne sélectionnerait rien. */
function distSeg(p, it) {
  const A = { x: it.x1, y: it.y1 }, B = { x: it.x2, y: it.y2 }, bend = bendOf(it);
  if (!bend) return distToSegment(p, A, B);
  return Math.min(distToSegment(p, A, bend), distToSegment(p, bend, B));
}
function hitHandle(p, it) {
  if (it.type === 'arrow' || it.type === 'line') {
    if (Math.hypot(p.x - it.x1, p.y - it.y1) <= HANDLE + 2) return 'p1';
    if (Math.hypot(p.x - it.x2, p.y - it.y2) <= HANDLE + 2) return 'p2';
    const m = midOf(it);
    if (Math.hypot(p.x - m.x, p.y - m.y) <= HANDLE + 2) return 'pm';
    return null;
  }
  const lp = localPoint(p, it);
  const b = bounds(it);
  const corners = { nw: [b.x, b.y], ne: [b.x + b.w, b.y], sw: [b.x, b.y + b.h], se: [b.x + b.w, b.y + b.h] };
  for (const [k, c] of Object.entries(corners)) if (Math.hypot(lp.x - c[0], lp.y - c[1]) <= HANDLE + 2) return k;
  return null;
}
const selectedItems = () => state.items.filter(i => state.selIds.includes(i.id));
const selected = () => state.selIds.length === 1 ? (state.items.find(i => i.id === state.selIds[0]) || null) : null;
const isSel = (id) => state.selIds.includes(id);
/* Boîte englobante tous types (pour la sélection marquee). */
function itemBounds(it) {
  if (it.type === 'arrow' || it.type === 'line') {
    const bend = bendOf(it);
    const xs = [it.x1, it.x2], ys = [it.y1, it.y2];
    if (bend) { xs.push(bend.x); ys.push(bend.y); }   // l'angle fait partie de l'encombrement
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return bounds(it);
}

/* ---------- Rotation des éléments ---------- */
function itemCenter(it) {
  if (it.type === 'shape' || it.type === 'logo') { const b = bounds(it); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
  return { x: it.x, y: it.y };
}
/* Ramène un point dans le repère non-tourné de l'élément (pour le hit-test). */
function localPoint(p, it) {
  if (!it.rot) return p;
  const c = itemCenter(it), rad = -it.rot * Math.PI / 180;
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(rad) - dy * Math.sin(rad), y: c.y + dx * Math.sin(rad) + dy * Math.cos(rad) };
}
/* Fait pivoter un élément de `deg` degrés (autour de son centre). */
function rotateItem(it, deg) {
  if (it.type === 'arrow' || it.type === 'line') {
    const cx = (it.x1 + it.x2) / 2, cy = (it.y1 + it.y2) / 2, rad = deg * Math.PI / 180;
    const keys = [['x1', 'y1'], ['x2', 'y2']];
    if (bendOf(it)) keys.push(['mx', 'my']);   // l'angle suit la rotation
    for (const [xk, yk] of keys) {
      const dx = it[xk] - cx, dy = it[yk] - cy;
      it[xk] = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
      it[yk] = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
    }
  } else {
    it.rot = ((((it.rot || 0) + deg) % 360) + 360) % 360;
  }
}
/* Applique la rotation d'un élément au contexte, dessine, puis restaure. */
function withRotation(it, drawFn) {
  if (it.rot && it.type !== 'arrow' && it.type !== 'line') {
    const c = itemCenter(it);
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(it.rot * Math.PI / 180); ctx.translate(-c.x, -c.y);
    drawFn(); ctx.restore();
  } else drawFn();
}

/* ============================================================
   INTERACTIONS POINTEUR
   ============================================================ */
let drag = null;

/* Étiquette flottante « largeur × hauteur en mètres » pendant le tracé d'une zone. */
let sizeTag = null;
function showSizeTag(e, it) {
  if (!sizeTag) { sizeTag = document.createElement('div'); sizeTag.className = 'tb-sizetag'; document.body.appendChild(sizeTag); }
  const mpp = 105 / (LW - 2 * PITCH_MARGIN);        // ~ mètres par pixel logique (terrain 105 m)
  sizeTag.textContent = `${(Math.abs(it.w) * mpp).toFixed(0)} × ${(Math.abs(it.h) * mpp).toFixed(0)} m`;
  sizeTag.style.left = (e.clientX + 14) + 'px';
  sizeTag.style.top = (e.clientY + 16) + 'px';
  sizeTag.style.display = 'block';
}
function hideSizeTag() { if (sizeTag) sizeTag.style.display = 'none'; }

canvas.addEventListener('pointerdown', (e) => {
  if (!CAN_EDIT) return;
  if (e.button === 2) return;          // clic droit géré par le menu contextuel
  hideMenu();
  canvas.setPointerCapture(e.pointerId);
  const p = getPos(e);

  // Mode « Screen » : on trace le cadre d'export (aucun élément n'est créé).
  if (state.tool === 'screen') {
    drag = { mode: 'screen', x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    render(); return;
  }

  if (state.tool === 'select') {
    // 1) poignée de redimensionnement (sélection unique)
    const one = selected();
    if (one) { const h = hitHandle(p, one); if (h) { pushHistory(); drag = { mode: 'handle', h, it: one }; return; } }
    const it = hitItem(p);
    // 2) Cmd/Ctrl + clic : (dé)sélection isolée d'un élément dans le groupe
    if (it && (e.metaKey || e.ctrlKey)) {
      state.selIds = isSel(it.id) ? state.selIds.filter(x => x !== it.id) : [...state.selIds, it.id];
      syncSelBar(); render(); return;
    }
    if (it) {
      if (!isSel(it.id)) state.selIds = [it.id];   // clic simple sur un élément hors sélection → lui seul
      pushHistory();
      drag = { mode: 'move-group', ox: p.x, oy: p.y,
               orig: selectedItems().map(o => ({ it: o, x: o.x, y: o.y, x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, mx: o.mx, my: o.my })) };
      syncSelBar(); render(); return;
    }
    // 3) espace vide → rectangle de sélection multiple
    state.selIds = [];
    drag = { mode: 'marquee', x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    syncSelBar(); render(); return;
  }

  // Outils de création
  pushHistory();
  const c = state.drawColor;
  if (state.tool === 'player') { addToken('player', p, state.jersey); commit(); }
  else if (state.tool === 'opponent') { addToken('opponent', p, state.opp); commit(); }
  else if (state.tool.startsWith('equip-')) {
    const it = { id: nid(), type: 'equip', kind: state.tool.slice(6), x: p.x, y: p.y, r: state.equipR };
    state.items.push(it); state.selIds = [it.id]; commit();
  }
  else if (state.tool === 'text') {
    const t = prompt('Texte :', ''); if (t) { state.items.push({ id: nid(), type: 'text', x: p.x, y: p.y, text: t, color: c, size: 22, font: state.textFont }); commit(); }
  }
  else if (state.tool.startsWith('arrow') || state.tool === 'line') {
    const style = state.tool === 'arrow-curved' ? 'curved' : state.tool === 'arrow-dashed' ? 'dashed' : 'solid';
    const it = { id: nid(), type: state.tool === 'line' ? 'line' : 'arrow', style, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: c };
    state.items.push(it); state.selIds = [it.id]; drag = { mode: 'create-seg', it };
  }
  else { // formes
    const it = { id: nid(), type: 'shape', shape: state.tool, x: p.x, y: p.y, w: 1, h: 1, color: c };
    state.items.push(it); state.selIds = [it.id]; drag = { mode: 'create-box', it, ox: p.x, oy: p.y };
  }
  render();
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = getPos(e);
  if (drag.mode === 'move-group') {
    const dx = p.x - drag.ox, dy = p.y - drag.oy;
    for (const o of drag.orig) {
      const it = o.it;
      if (it.type === 'arrow' || it.type === 'line') {
        it.x1 = o.x1 + dx; it.y1 = o.y1 + dy; it.x2 = o.x2 + dx; it.y2 = o.y2 + dy;
        if (typeof o.mx === 'number') { it.mx = o.mx + dx; it.my = o.my + dy; }
      }
      else { it.x = o.x + dx; it.y = o.y + dy; }
    }
  } else if (drag.mode === 'marquee' || drag.mode === 'screen') {
    drag.x1 = p.x; drag.y1 = p.y;
  } else if (drag.mode === 'create-seg' || drag.mode === 'handle' && (drag.it.type === 'arrow' || drag.it.type === 'line')) {
    if (drag.mode === 'create-seg') { drag.it.x2 = p.x; drag.it.y2 = p.y; }
    else if (drag.h === 'p1') { drag.it.x1 = p.x; drag.it.y1 = p.y; }
    else if (drag.h === 'pm') { drag.it.mx = p.x; drag.it.my = p.y; }   // pose ou déplace l'angle
    else { drag.it.x2 = p.x; drag.it.y2 = p.y; }
  } else if (drag.mode === 'create-box') {
    drag.it.w = p.x - drag.ox; drag.it.h = p.y - drag.oy;
    showSizeTag(e, drag.it);
  } else if (drag.mode === 'handle') {
    resizeBox(drag.it, drag.h, localPoint(p, drag.it));   // redimensionne dans le repère non-tourné
    if (drag.it.type === 'shape') showSizeTag(e, drag.it);
  }
  render();
});

canvas.addEventListener('pointerup', () => {
  hideSizeTag();
  if (!drag) return;
  if (drag.mode === 'create-box') {
    const it = drag.it;
    // On ne crée la zone QUE si l'utilisateur a réellement étiré (pas un simple clic).
    if (Math.abs(it.w) < 12 || Math.abs(it.h) < 12) {
      state.items = state.items.filter(x => x.id !== it.id);
      state.selIds = [];
    } else normalizeBox(it);
  }
  if (drag.mode === 'create-seg') {
    const it = drag.it;
    if (Math.hypot(it.x2 - it.x1, it.y2 - it.y1) < 12) {   // flèche/trait : idem, un simple clic n'ajoute rien
      state.items = state.items.filter(x => x.id !== it.id);
      state.selIds = [];
    }
  }
  if (drag.mode === 'marquee') {
    const rx = Math.min(drag.x0, drag.x1), ry = Math.min(drag.y0, drag.y1);
    const rw = Math.abs(drag.x1 - drag.x0), rh = Math.abs(drag.y1 - drag.y0);
    if (rw > 4 || rh > 4) {                    // sélectionne tout élément qui intersecte le rectangle
      state.selIds = state.items.filter(it => {
        const b = itemBounds(it);
        return b.x < rx + rw && b.x + b.w > rx && b.y < ry + rh && b.y + b.h > ry;
      }).map(it => it.id);
    }
  }
  if (drag.mode === 'screen') {
    const rx = Math.min(drag.x0, drag.x1), ry = Math.min(drag.y0, drag.y1);
    const rw = Math.abs(drag.x1 - drag.x0), rh = Math.abs(drag.y1 - drag.y0);
    if (rw > 20 && rh > 20) {
      state.screen = { x: rx, y: ry, w: rw, h: rh };
      toast('Cadrage défini — l\'export utilisera cette zone', 'success');
    } else {
      toast('Cadre trop petit — tracez une zone plus large.', 'error');
    }
    drag = null;
    document.getElementById('screenHint')?.classList.add('hidden');
    setTool('select');
    commit();
    return;
  }
  if (drag.mode === 'handle') normalizeBox(drag.it);
  drag = null;
  syncSelBar(); commit();
});

/* ---------- Menu contextuel (clic droit) : Renommer / Couleur / Supprimer ---------- */
const menu = (() => {
  const m = document.createElement('div');
  m.className = 'tb-menu hidden'; m.id = 'tbMenu';
  m.innerHTML =
    '<div class="tbm-title" id="tbmTitle">Élément</div>' +
    '<div class="tbm-row" id="tbmRenameRow"><span>Renommer</span><input id="tbmRename"></div>' +
    '<div class="tbm-row"><span>Couleur</span><input type="color" id="tbmColor"></div>' +
    '<div class="tbm-row hidden" id="tbmDashRow"><span>Contour</span><button class="tbm-btn" id="tbmDash" type="button">Pointillé</button></div>' +
    '<div class="tbm-row hidden" id="tbmLabelRow"><span>Étiquette</span><span class="tbm-seg" id="tbmLabelSeg">' +
      '<button data-lp="top" type="button" title="Au-dessus">↑</button>' +
      '<button data-lp="center" type="button" title="Au centre">•</button>' +
      '<button data-lp="bottom" type="button" title="En-dessous">↓</button></span></div>' +
    '<div class="tbm-row"><span>Rotation</span><button class="tbm-btn" id="tbmRotate" type="button">Pivoter 90°</button></div>' +
    '<div class="tbm-row"><span>Ordre</span><span class="tbm-seg">' +
      '<button id="tbmFront" type="button" title="Amener devant">Devant</button>' +
      '<button id="tbmBack" type="button" title="Envoyer derrière">Derrière</button></span></div>' +
    '<button class="tbm-del" id="tbmDelete" type="button">Supprimer</button>';
  document.body.appendChild(m);
  m.addEventListener('pointerdown', ev => ev.stopPropagation());   // ne pas fermer en cliquant dedans
  return m;
})();
let menuTarget = null;
const TYPE_LABEL = { player: 'Joueur', opponent: 'Adversaire', shape: 'Zone', arrow: 'Flèche', line: 'Trait', text: 'Texte', logo: 'Logo', equip: 'Matériel' };

function openMenu(e, it) {
  menuTarget = it;
  const isToken = it.type === 'player' || it.type === 'opponent';
  const canRename = isToken || it.type === 'text' || it.type === 'shape';
  $('#tbmTitle').textContent = TYPE_LABEL[it.type] || 'Élément';
  $('#tbmRenameRow').classList.toggle('hidden', !canRename);
  const rn = $('#tbmRename');
  if (isToken) { rn.type = 'number'; rn.value = it.number ?? ''; rn.placeholder = 'N°'; }
  else if (it.type === 'text') { rn.type = 'text'; rn.value = it.text || ''; rn.placeholder = 'Texte'; }
  else if (it.type === 'shape') { rn.type = 'text'; rn.value = it.label || ''; rn.placeholder = 'Nom de la zone'; }
  $('#tbmColor').value = toHex(it.color || '#C9A84C');
  // Options spécifiques aux zones : contour pointillé + position de l'étiquette.
  const isShape = it.type === 'shape';
  $('#tbmDashRow').classList.toggle('hidden', !isShape);
  $('#tbmLabelRow').classList.toggle('hidden', !(isShape && it.label));
  if (isShape) {
    $('#tbmDash').textContent = it.dash ? 'Plein' : 'Pointillé';
    $$('#tbmLabelSeg button').forEach(b => b.classList.toggle('on', (it.labelPos || 'center') === b.dataset.lp));
  }
  menu.classList.remove('hidden');
  const mw = 214, mh = menu.offsetHeight || 220;
  let x = Math.min(e.clientX, window.innerWidth - mw - 8);
  let y = Math.min(e.clientY, window.innerHeight - mh - 8);
  menu.style.left = Math.max(8, x) + 'px'; menu.style.top = Math.max(8, y) + 'px';
  if (canRename) setTimeout(() => $('#tbmRename').focus(), 0);
}
function hideMenu() { menu.classList.add('hidden'); menuTarget = null; }

$('#tbmRename').addEventListener('input', e => {
  const it = menuTarget; if (!it) return;
  if (it.type === 'player' || it.type === 'opponent') it.number = e.target.value === '' ? null : Number(e.target.value);
  else if (it.type === 'text') it.text = e.target.value;
  else if (it.type === 'shape') it.label = e.target.value;
  render(); scheduleSave(); syncSelBar();
});
$('#tbmColor').addEventListener('input', e => {
  const it = menuTarget; if (!it) return;
  it.color = e.target.value; render(); scheduleSave(); syncSelBar();
});
$('#tbmDash').addEventListener('click', () => {
  const it = menuTarget; if (!it || it.type !== 'shape') return;
  it.dash = !it.dash; $('#tbmDash').textContent = it.dash ? 'Plein' : 'Pointillé';
  render(); scheduleSave();
});
$('#tbmLabelSeg').addEventListener('click', e => {
  const btn = e.target.closest('button'); const it = menuTarget;
  if (!btn || !it) return;
  it.labelPos = btn.dataset.lp;
  $$('#tbmLabelSeg button').forEach(b => b.classList.toggle('on', b === btn));
  render(); scheduleSave();
});
$('#tbmRotate').addEventListener('click', () => {
  const it = menuTarget; if (!it) return;
  pushHistory(); rotateItem(it, 90); render(); scheduleSave();
});
$('#tbmFront').addEventListener('click', () => {
  const it = menuTarget; if (!it) return;
  pushHistory(); state.items = state.items.filter(x => x !== it); state.items.push(it);
  render(); scheduleSave();
});
$('#tbmBack').addEventListener('click', () => {
  const it = menuTarget; if (!it) return;
  pushHistory(); state.items = state.items.filter(x => x !== it); state.items.unshift(it);
  render(); scheduleSave();
});
$('#tbmDelete').addEventListener('click', () => {
  const it = menuTarget; if (!it) return;
  pushHistory();
  state.items = state.items.filter(x => x.id !== it.id);
  state.selIds = state.selIds.filter(id => id !== it.id);
  hideMenu(); syncSelBar(); commit();
});
document.addEventListener('pointerdown', () => hideMenu());
window.addEventListener('scroll', hideMenu, true);

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!CAN_EDIT) return;
  hideMenu();
  const it = hitItem(getPos(e));
  if (!it) return;
  if (!isSel(it.id)) { state.selIds = [it.id]; syncSelBar(); render(); }
  openMenu(e, it);
});

function resizeBox(it, h, p) {
  if (it.type === 'text' || it.type === 'player' || it.type === 'opponent' || it.type === 'equip') return;
  const b = bounds(it);
  let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
  if (h.includes('w')) x1 = p.x; if (h.includes('e')) x2 = p.x;
  if (h.includes('n')) y1 = p.y; if (h.includes('s')) y2 = p.y;
  it.x = x1; it.y = y1; it.w = x2 - x1; it.h = y2 - y1;
}
function normalizeBox(it) {
  if (it.w < 0) { it.x += it.w; it.w = -it.w; }
  if (it.h < 0) { it.y += it.h; it.h = -it.h; }
}

function addToken(type, p, color) {
  const numRef = type === 'player' ? 'nextNum' : 'nextOpp';
  state.items.push({ id: nid(), type, x: p.x, y: p.y, r: state.tokenR, number: state[numRef]++, color });
}

/* ============================================================
   BARRE D'OUTILS / UI
   ============================================================ */
function setTool(t) {
  state.tool = t;
  $$('.tb-tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  canvas.classList.toggle('tool-select', t === 'select');
  if (t !== 'select') { state.selIds = []; syncSelBar(); }
  render();
}
$$('.tb-tool[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$$('#viewGroup .tb-tool').forEach(b => b.addEventListener('click', () => {
  state.view = b.dataset.view;
  $$('#viewGroup .tb-tool').forEach(x => x.classList.toggle('active', x === b));
  resizeCanvas(); scheduleSave();   // resize (orientation portrait/paysage) puis rendu
}));

$('#drawColor').addEventListener('input', e => { state.drawColor = e.target.value; });
$('#fontSelect').addEventListener('change', e => {
  state.textFont = e.target.value;                 // police par défaut pour les nouveaux textes
  const it = selected();
  if (it && it.type === 'text') { it.font = e.target.value; render(); scheduleSave(); }   // + applique au texte sélectionné
});
$('#jerseyColor').addEventListener('input', e => { state.jersey = e.target.value; updatePionDots(); });
$('#oppColor').addEventListener('input', e => { state.opp = e.target.value; updatePionDots(); });

/* Reflète les couleurs choisies sur les pastilles des boutons Joueur/Adversaire. */
function updatePionDots() {
  $$('#pionDotRed, #pionDotRed2').forEach(d => d.style.background = state.jersey);
  $$('#pionDotBlue, #pionDotBlue2').forEach(d => d.style.background = state.opp);
}
updatePionDots();
$('#toggleNumbers').addEventListener('click', () => { state.showNumbers = !state.showNumbers; render(); scheduleSave(); });
$('#formationSelect').addEventListener('change', e => { if (e.target.value) { applyFormation(e.target.value); e.target.value = ''; } });
document.getElementById('screenBtn')?.addEventListener('click', () => {
  setTool('screen');
  document.getElementById('screenHint')?.classList.remove('hidden');
  toast('Tracez la zone du terrain à exporter');
});
document.getElementById('screenReset')?.addEventListener('click', () => {
  state.screen = null;
  document.getElementById('screenHint')?.classList.add('hidden');
  toast('Cadrage réinitialisé — export en plein terrain', 'success');
  commit();
});
$('#undoBtn').addEventListener('click', undo);
$('#clearBtn').addEventListener('click', () => { if (confirm('Tout effacer ?')) { pushHistory(); state.items = []; state.selIds = []; commit(); } });
$('#logoInput').addEventListener('change', importLogo);
$('#addStep').addEventListener('click', addStep);
$('#playSteps').addEventListener('click', () => playSteps());
$('#exportPng').addEventListener('click', exportPNG);
document.getElementById('presentBtn')?.addEventListener('click', togglePresent);
document.getElementById('exportVideo')?.addEventListener('click', exportVideo);
document.getElementById('saveBtn')?.addEventListener('click', () => saveToDB(false));
document.getElementById('tbValidate')?.addEventListener('click', () => saveToDB(true));

/* Barre de l'élément sélectionné */
/* La barre reste TOUJOURS présente (classe .empty quand rien n'est sélectionné)
   → aucune apparition/disparition, donc aucun saut/scroll de la page. */
function syncSelBar() {
  const bar = $('#selBar');
  const sels = selectedItems();
  const sizeInput = $('#selSize'), textInput = $('#selText');
  if (!sels.length) { bar.classList.add('empty'); $('#selLabel').textContent = 'Sélectionnez un élément'; return; }
  bar.classList.remove('empty');

  if (sels.length > 1) {
    $('#selLabel').textContent = sels.length + ' éléments';
    $('#selColor').value = toHex(sels[0].color || '#C9A84C');
    sizeInput.classList.remove('hidden'); sizeInput.value = sels.find(s => s.r)?.r || state.tokenR;
    textInput.classList.add('hidden');
    return;
  }
  const it = sels[0];
  $('#selLabel').textContent = TYPE_LABEL[it.type] || 'Élément';
  $('#selColor').value = toHex(it.color || '#C9A84C');
  const isToken = it.type === 'player' || it.type === 'opponent';
  const hasR = isToken || it.type === 'equip';
  if (hasR) sizeInput.value = it.r; else if (it.type === 'text') sizeInput.value = it.size;
  sizeInput.classList.toggle('hidden', !(hasR || it.type === 'text'));
  textInput.classList.toggle('hidden', !(isToken || it.type === 'text' || it.type === 'shape'));
  if (it.type === 'text') { textInput.value = it.text || ''; textInput.placeholder = 'Texte'; }
  else if (isToken) { textInput.value = it.number ?? ''; textInput.placeholder = 'n°'; }
  else if (it.type === 'shape') { textInput.value = it.label || ''; textInput.placeholder = 'Nom de la zone'; }

  // Bouton d'angle : réservé aux tracés, il pose ou retire le coude.
  const bendBtn = $('#selBend');
  const isSeg = it.type === 'arrow' || it.type === 'line';
  bendBtn.classList.toggle('hidden', !isSeg);
  if (isSeg) {
    const has = !!bendOf(it);
    bendBtn.textContent = has ? 'Redresser' : 'Angle';
    bendBtn.classList.toggle('active', has);
  }
}
$('#selBend').addEventListener('click', () => {
  const it = selected(); if (!it || (it.type !== 'arrow' && it.type !== 'line')) return;
  pushHistory();
  if (bendOf(it)) { delete it.mx; delete it.my; }
  else {
    // On décale légèrement le coude perpendiculairement au tracé, sinon il
    // resterait sur la droite et l'angle serait invisible.
    const dx = it.x2 - it.x1, dy = it.y2 - it.y1, len = Math.hypot(dx, dy) || 1;
    const off = Math.min(60, len * 0.28);
    it.mx = (it.x1 + it.x2) / 2 - (dy / len) * off;
    it.my = (it.y1 + it.y2) / 2 + (dx / len) * off;
  }
  syncSelBar(); render(); scheduleSave();
});
$('#selColor').addEventListener('input', e => {
  const sels = selectedItems(); if (!sels.length) return;
  sels.forEach(it => it.color = e.target.value); render(); scheduleSave();   // s'applique à toute la sélection
});
$('#selSize').addEventListener('input', e => {
  const v = Number(e.target.value); const sels = selectedItems(); if (!sels.length) return;
  sels.forEach(it => {
    if (it.type === 'player' || it.type === 'opponent') { it.r = v; state.tokenR = v; }
    else if (it.type === 'equip') it.r = v;
    else if (it.type === 'text') it.size = v;
  });
  render(); scheduleSave();
});
$('#selText').addEventListener('input', e => {
  const it = selected(); if (!it) return;
  if (it.type === 'text') it.text = e.target.value;
  else if (it.type === 'player' || it.type === 'opponent') it.number = e.target.value === '' ? null : Number(e.target.value);
  else if (it.type === 'shape') it.label = e.target.value;
  render(); scheduleSave();
});
$('#selDelete').addEventListener('click', () => {
  const sels = selectedItems(); if (!sels.length) return;
  pushHistory(); const ids = sels.map(s => s.id);
  state.items = state.items.filter(x => !ids.includes(x.id));
  state.selIds = []; syncSelBar(); commit();
});

/* Copier / coller la sélection (sans avoir à cliquer sur le terrain). */
let clipboard = [];
function copySelection() {
  const sels = selectedItems(); if (!sels.length) return;
  clipboard = sels.map(it => { const c = { ...it }; delete c._img; delete c.id; return c; });
  toast(sels.length + ' élément' + (sels.length > 1 ? 's' : '') + ' copié' + (sels.length > 1 ? 's' : ''), 'success');
}
function pasteClipboard() {
  if (!clipboard.length) return;
  pushHistory();
  const off = 34;
  const added = clipboard.map(c => {
    const it = { ...c, id: nid() };
    if (it.type === 'arrow' || it.type === 'line') {
      it.x1 += off; it.y1 += off; it.x2 += off; it.y2 += off;
      if (typeof it.mx === 'number') { it.mx += off; it.my += off; }
    }
    else { it.x = (it.x || 0) + off; it.y = (it.y || 0) + off; }
    if (it.type === 'logo' && it.src) { const img = new Image(); img.src = it.src; it._img = img; }
    return it;
  });
  state.items.push(...added);
  state.selIds = added.map(i => i.id);
  syncSelBar(); commit();
  toast(added.length + ' collé' + (added.length > 1 ? 's' : ''), 'success');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideMenu();
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (!CAN_EDIT) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); }
  else if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteClipboard(); }
  else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); copySelection(); pasteClipboard(); } // duplication rapide
  else if (!mod && e.key.toLowerCase() === 'r' && state.selIds.length) { e.preventDefault(); pushHistory(); selectedItems().forEach(it => rotateItem(it, 90)); commit(); } // pivoter 90°
  else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selIds.length) { e.preventDefault(); $('#selDelete').click(); }
});

/* ============================================================
   FORMATIONS
   ============================================================ */
const FORMATIONS = {
  '4-3-3':  [[8,50],[20,18],[20,40],[20,60],[20,82],[38,30],[38,50],[38,70],[46,20],[46,50],[46,80]],
  '4-4-2':  [[8,50],[20,18],[20,40],[20,60],[20,82],[38,18],[38,40],[38,60],[38,82],[47,40],[47,60]],
  '4-2-3-1':[[8,50],[20,18],[20,40],[20,60],[20,82],[33,38],[33,62],[44,22],[44,50],[44,78],[50,50]],
  '3-5-2':  [[8,50],[20,30],[20,50],[20,70],[36,14],[36,35],[36,50],[36,65],[36,86],[47,40],[47,60]],
  '3-4-3':  [[8,50],[20,30],[20,50],[20,70],[35,20],[35,42],[35,58],[35,80],[47,22],[47,50],[47,78]],
  '5-3-2':  [[8,50],[20,12],[20,32],[20,50],[20,68],[20,88],[36,32],[36,50],[36,68],[47,40],[47,60]],
};
function applyFormation(name) {
  pushHistory();
  state.items = state.items.filter(i => i.type !== 'player');
  state.nextNum = 1;
  FORMATIONS[name].forEach(([px, py]) => {
    state.items.push({ id: nid(), type: 'player', x: px / 100 * LW, y: py / 100 * LH, r: 18, number: state.nextNum++, color: state.jersey });
  });
  commit();
}

/* ============================================================
   LOGO
   ============================================================ */
function importLogo(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => { pushHistory(); const it = { id: nid(), type: 'logo', x: LW / 2 - 60, y: 40, w: 120, h: 120 * (img.height / img.width), src: ev.target.result, _img: img }; state.items.push(it); commit(); };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file); e.target.value = '';
}

/* ============================================================
   ÉTAPES ANIMÉES
   ============================================================ */
function snapshot() {
  const s = {};
  for (const it of state.items) s[it.id] = { x: it.x, y: it.y, x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2, mx: it.mx, my: it.my };
  return s;
}
function addStep() { state.steps.push(snapshot()); updateStepInfo(); scheduleSave(); toast('Étape ' + state.steps.length + ' enregistrée', 'success'); }
function updateStepInfo() { $('#stepInfo').textContent = state.steps.length + ' étape' + (state.steps.length > 1 ? 's' : ''); }

function playSteps(done) {
  if (state.steps.length < 1) { if (typeof done !== 'function') toast('Ajoutez au moins une étape (+ Étape).', 'error'); else done(); return; }
  const seq = [snapshot(), ...state.steps];
  let i = 0;
  const stepTo = () => {
    if (i >= seq.length - 1) { render(); if (typeof done === 'function') done(); return; }
    tween(seq[i], seq[i + 1], 800, () => { i++; stepTo(); });
  };
  stepTo();
}

/* ---------- Mode présentation (plein écran) ---------- */
function togglePresent() {
  const stage = document.querySelector('.tb-stage');
  if (!document.fullscreenElement) {
    stage.classList.add('presenting');
    (stage.requestFullscreen ? stage.requestFullscreen() : Promise.resolve()).catch(() => {});
  } else document.exitFullscreen();
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) document.querySelector('.tb-stage')?.classList.remove('presenting');
  render();
});

/* ---------- Export vidéo de l'animation (WebM) ---------- */
async function exportVideo() {
  if (!canvas.captureStream || !window.MediaRecorder) return toast('Export vidéo non supporté par ce navigateur.', 'error');
  if (state.steps.length < 1) return toast('Ajoutez des étapes (+ Étape) pour animer.', 'error');
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
    a.download = 'animation-tactique.webm'; a.click();
    toast('Vidéo exportée', 'success');
  };
  toast('Enregistrement de l\'animation…');
  rec.start();
  playSteps(() => setTimeout(() => rec.stop(), 500));
}
function tween(from, to, dur, done) {
  const t0 = performance.now();
  const frame = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOut
    for (const it of state.items) {
      const a = from[it.id], b = to[it.id]; if (!a || !b) continue;
      for (const key of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) {
        if (a[key] != null && b[key] != null) it[key] = a[key] + (b[key] - a[key]) * e;
      }
    }
    render();
    if (k < 1) requestAnimationFrame(frame); else done && done();
  };
  requestAnimationFrame(frame);
}

/* ============================================================
   HISTORIQUE / PERSISTANCE
   ============================================================ */
function serialize() {
  return {
    view: state.view, showNumbers: state.showNumbers, steps: state.steps,
    nextNum: state.nextNum, nextOpp: state.nextOpp, screen: state.screen,
    items: state.items.map(it => { const c = { ...it }; delete c._img; return c; }),
  };
}
function deserialize(data) {
  state.view = data.view || 'complet';
  state.screen = data.screen || null;
  state.showNumbers = data.showNumbers !== false;
  state.steps = data.steps || [];
  state.nextNum = data.nextNum || (data.items?.filter(i => i.type === 'player').length + 1) || 1;
  state.nextOpp = data.nextOpp || 1;
  state.items = (data.items || []).map(it => {
    if (it.type === 'logo' && it.src) { const img = new Image(); img.src = it.src; it._img = img; }
    return it;
  });
  idSeq = Math.max(0, ...state.items.map(i => i.id)) + 1;
  $$('#viewGroup .tb-tool').forEach(x => x.classList.toggle('active', x.dataset.view === state.view));
  updateStepInfo();
}

function pushHistory() { state.history.push(JSON.stringify(serialize().items)); if (state.history.length > 50) state.history.shift(); }
function undo() {
  if (!state.history.length) return;
  const items = JSON.parse(state.history.pop());
  state.items = items.map(it => { if (it.type === 'logo' && it.src) { const img = new Image(); img.src = it.src; it._img = img; } return it; });
  state.selIds = []; syncSelBar(); render(); scheduleSave();
}
function commit() { render(); scheduleSave(); }

/* Autosave LocalStorage (debounce + intervalle 30 s) */
let saveTimer = null;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(persistLocal, 1000); }
function persistLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(serialize())); } catch (e) {} }
setInterval(persistLocal, 30000);

/* ============================================================
   EXPORT / SAUVEGARDE BDD
   ============================================================ */
/* Rend le schéma sans sélection, puis recadre sur la zone « Screen » si définie.
   Le recadrage travaille sur les pixels réels du canvas (DPR pris en compte). */
function exportClean() {
  const keep = state.selIds, keepTool = state.tool;
  state.selIds = []; state.tool = 'view'; render();

  let url;
  if (state.screen) {
    const dpr = window.devicePixelRatio || 1;
    const s = state.screen;
    // Conversion coordonnées paysage → pixels canvas (gère l'orientation portrait).
    let cx, cy, cw, ch;
    if (isPortrait()) { cx = s.y; cy = LW - (s.x + s.w); cw = s.h; ch = s.w; }
    else { cx = s.x; cy = s.y; cw = s.w; ch = s.h; }
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(cw * dpr));
    out.height = Math.max(1, Math.round(ch * dpr));
    out.getContext('2d').drawImage(canvas,
      Math.round(cx * dpr), Math.round(cy * dpr), Math.round(cw * dpr), Math.round(ch * dpr),
      0, 0, out.width, out.height);
    url = out.toDataURL('image/png');
  } else {
    url = canvas.toDataURL('image/png');
  }

  state.selIds = keep; state.tool = keepTool; render();
  return url;
}
function exportPNG() {
  const a = document.createElement('a');
  a.href = exportClean(); a.download = 'schema-tactique.png'; a.click();
}

async function saveToDB(validate) {
  if (!PROC) return toast('Ce schéma n\'est lié à aucun procédé. Ouvrez-le depuis une séance.', 'error');
  const btn = validate ? document.getElementById('tbValidate') : document.getElementById('saveBtn');
  if (btn) btn.disabled = true;
  try {
    // Image PNG → Storage (bucket "schemas"), JSON du schéma → colonne jsonb.
    const dataUrl = exportClean();
    const blob = await (await fetch(dataUrl)).blob();
    const path = `${CLUB_ID}/procedure-${PROC}.png`;
    const { error: upErr } = await sb.storage.from('schemas').upload(path, blob, { upsert: true, contentType: 'image/png' });
    if (upErr) throw upErr;

    const { error } = await sb.from('tactical_schemas').upsert({
      procedure_id: PROC, canvas_json: serialize(), image_path: path, vue_terrain: state.view,
    }, { onConflict: 'procedure_id' });
    if (error) throw error;

    persistLocal();
    if (validate) {
      toast('Schéma validé — il apparaîtra dans le procédé.', 'success');
      if (window.opener && !window.opener.closed) { try { window.opener.location.reload(); } catch (e) {} }
      setTimeout(() => window.close(), 1100);
    } else {
      toast('Schéma enregistré en base', 'success');
    }
  } catch (e) { toast(e.message, 'error'); }
  finally { if (btn) btn.disabled = false; }
}

/* Applique les préférences utilisateur (page Paramètres) aux valeurs
   par défaut du tableau : couleurs, tailles, police, vue, numéros. */
function applyPrefs(prefs) {
  if (!prefs) return;
  if (prefs.jersey) { state.jersey = prefs.jersey; const el = $('#jerseyColor'); if (el) el.value = prefs.jersey; }
  if (prefs.opp)    { state.opp = prefs.opp;       const el = $('#oppColor');    if (el) el.value = prefs.opp; }
  if (prefs.draw)   { state.drawColor = prefs.draw; const el = $('#drawColor');  if (el) el.value = prefs.draw; }
  if (prefs.tokenR) state.tokenR = Number(prefs.tokenR);
  if (prefs.equipR) state.equipR = Number(prefs.equipR);
  if (prefs.font)   { state.textFont = prefs.font; const el = $('#fontSelect');  if (el) el.value = prefs.font; }
  if (typeof prefs.showNumbers === 'boolean') state.showNumbers = prefs.showNumbers;
  // La vue par défaut ne s'applique qu'à un nouveau schéma (sinon on écraserait
  // la vue enregistrée avec le schéma).
  if (prefs.view && !PROC) state.view = prefs.view;
  updatePionDots();
  $$('#viewGroup .tb-tool').forEach(x => x.classList.toggle('active', x.dataset.view === state.view));
}

/* ============================================================
   CHARGEMENT INITIAL
   ============================================================ */
async function boot() {
  const ctx = await requireAuth();
  if (!ctx) return;
  CAN_EDIT = canEdit(ctx.profile.role);
  CLUB_ID = ctx.profile.club_id;
  applyPrefs(ctx.profile.prefs);
  document.getElementById('uName') && (document.getElementById('uName').textContent = ctx.profile.nom || 'Utilisateur');
  document.getElementById('uRole') && (document.getElementById('uRole').textContent = (ROLE_LABELS[ctx.profile.role] || ctx.profile.role).toUpperCase());
  document.getElementById('logoutLink')?.addEventListener('click', (e) => { e.preventDefault(); logout(); });
  if (!CAN_EDIT) document.getElementById('tbReadonlyNote')?.classList.remove('hidden');
  if (PROC && CAN_EDIT) {
    document.getElementById('tbValidate')?.classList.remove('hidden');
    document.getElementById('saveBtn')?.classList.remove('hidden');
  }

  resizeCanvas();
  let loaded = false;
  if (PROC) {
    try {
      const { data: schema } = await sb.from('tactical_schemas').select('canvas_json, vue_terrain').eq('procedure_id', PROC).single();
      $('#tbContext').textContent = 'schéma lié au procédé #' + PROC;
      if (schema && schema.canvas_json) { deserialize(schema.canvas_json); loaded = true; }
    } catch (e) { /* ignore, on tentera le LocalStorage */ }
  }
  if (!loaded) {
    const ls = localStorage.getItem(LS_KEY);
    if (ls) { try { deserialize(JSON.parse(ls)); loaded = true; } catch (e) {} }
  }
  setTool('select');
  resizeCanvas();   // ajuste l'orientation si le schéma chargé était en mode Horizontal
}
boot();
