/* ============================================================
   LMFC Performance — tactical-board.js
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
  clips: [{ name: 'Clip 1', steps: [] }], clip: 0,   // plusieurs animations sur le même terrain
  history: [], future: [],                          // annuler / rétablir
  speed: 1,                                         // vitesse de lecture
  railTeam: 'player', fixedNum: null,               // barre des numéros 1 à 11
  curStep: null,     // index de l'étape affichée et modifiée (null = pas d'étapes)
  playing: false,    // animation ou enregistrement en cours : terrain non modifiable
  // Cadrage d'export (mode « Screen ») : {x, y, w, h} en coordonnées paysage, ou null = plein terrain.
  screen: null,
};

/* Les étapes affichées sont celles du clip actif : tout le code existant
   continue d'utiliser state.steps. */
Object.defineProperty(state, 'steps', {
  get() { return state.clips[state.clip].steps; },
  set(v) { state.clips[state.clip].steps = v; },
});

const PROC = new URLSearchParams(location.search).get('procedure_id') ? Number(new URLSearchParams(location.search).get('procedure_id')) : null;
let CAN_EDIT = false;   // déterminé après authentification (boot()), avant tout rendu
let CLUB_ID = null;
/* Schéma d'un exercice du programme d'un joueur (fiche joueur → Programme). */
const EXO = Number(new URLSearchParams(location.search).get('exercise')) || null;
let EXO_ROW = null;   // { id, title, club_id, player_id, schema_path } une fois chargé
let PROC_ROW = null;     // procédé de séance (nom, objectif, consignes…) pour la fiche
let PROC_SCHEMA = null;  // ligne tactical_schemas existante (vidéo liée)
const LS_KEY = 'tb_' + (PROC || (EXO ? 'exo_' + EXO : 'scratch'));

/* ---------- Tailles ----------
   Réglées au curseur, ici comme dans Paramètres, entre ces bornes. */
const SIZE_DEFAULT = { token: 18, equip: 16, text: 22 };
const SIZE_LIMITS = { token: [10, 36], equip: [8, 34], text: [12, 56] };
function sizeKind(it) {
  if (it.type === 'player' || it.type === 'opponent') return 'token';
  if (it.type === 'equip') return 'equip';
  if (it.type === 'text') return 'text';
  return null;
}
function getSize(it) { return sizeKind(it) === 'text' ? it.size : it.r; }
function setSize(it, v) {
  const k = sizeKind(it); if (!k) return;
  const [lo, hi] = SIZE_LIMITS[k];
  v = Math.max(lo, Math.min(hi, Math.round(v)));
  if (k === 'text') it.size = v; else it.r = v;
}
const clampSize = (kind, v) => Math.max(SIZE_LIMITS[kind][0], Math.min(SIZE_LIMITS[kind][1], Number(v) || SIZE_DEFAULT[kind]));

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
  fitCanvas();
  render();
}
/* Le terrain occupe toute la place disponible, sans défilement : on
   le cale sur la largeur OU la hauteur de la zone, selon ce qui limite. */
function fitCanvas() {
  const stage = canvas.parentElement;
  const presenting = stage.classList.contains('presenting');
  // Les outils flottent au-dessus : seule la barre de présentation prend de la place.
  const bar = presenting ? (document.getElementById('presentBar')?.offsetHeight || 0) + 14 : 0;
  // Marge de sécurité (padding CSS de .tb-stage) : les barres flottantes
  // se posent sur l'herbe, pas sur les lignes du terrain.
  const cs = getComputedStyle(stage);
  const W = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const H = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - bar;
  if (W <= 0 || H <= 0) return;
  const k = Math.min(W / curW(), H / curH());
  const w = Math.floor(curW() * k), h = Math.floor(curH() * k);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  // Fond de la scène : même herbe, même échelle, calée sur le canvas.
  const left = canvas.offsetLeft, top = canvas.offsetTop, tile = GRASS_TILE * k;
  stage.style.backgroundImage = `linear-gradient(${GRASS_SHADE}, ${GRASS_SHADE}), url(${grassUrl()})`;
  stage.style.backgroundSize = `auto, ${tile}px ${tile}px`;
  stage.style.backgroundPosition = `0 0, ${left}px ${top}px`;
  if (state.selIds?.length) positionSelBar();
}
new ResizeObserver(fitCanvas).observe(canvas.parentElement);

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
/* Texture d'herbe générée une fois (aléatoire à graine fixe : le même
   rendu à chaque export). Elle sert au terrain ET au fond de la scène,
   pour que la pelouse continue jusqu'aux bords de l'écran. */
const GRASS_TILE = 192;
const grassTile = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = GRASS_TILE;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#3d7a2c'; g.fillRect(0, 0, GRASS_TILE, GRASS_TILE);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * GRASS_TILE, y = rnd() * GRASS_TILE, l = 1.5 + rnd() * 3.5, a = -Math.PI / 2 + (rnd() - .5) * .9;
    const tone = rnd();
    g.strokeStyle = tone < .45 ? `rgba(24,64,20,${.35 + rnd() * .4})` : tone < .85 ? `rgba(92,150,62,${.25 + rnd() * .35})` : `rgba(150,196,110,${.2 + rnd() * .25})`;
    g.lineWidth = .6 + rnd() * .8;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  return c;
})();
const grassPattern = ctx.createPattern(grassTile, 'repeat');
let grassDataUrl = null;
function grassUrl() { return grassDataUrl || (grassDataUrl = grassTile.toDataURL()); }
const GRASS_SHADE = 'rgba(0,0,0,0.16)';   // hors des lignes : herbe un peu plus sombre

function drawPitch() {
  // Pelouse texturée partout, plus sombre hors du terrain.
  ctx.fillStyle = grassPattern;
  ctx.fillRect(0, 0, LW, LH);
  ctx.fillStyle = GRASS_SHADE;
  ctx.fillRect(0, 0, LW, LH);
  const m0 = state.view === 'vierge' ? 0 : PITCH_MARGIN;
  ctx.clearRect(m0, m0, LW - 2 * m0, LH - 2 * m0);
  ctx.fillStyle = grassPattern;
  ctx.fillRect(m0, m0, LW - 2 * m0, LH - 2 * m0);
  // Bandes de tonte, dans les lignes seulement
  const bands = 14, bw = (LW - 2 * m0) / bands;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(m0 + i * bw, m0, bw, LH - 2 * m0);
  }

  if (state.view === 'vierge') return;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';   // lignes tracées à la craie
  ctx.lineWidth = 3;
  ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 2;
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
  if (CAN_EDIT && state.tool === 'select' && !state.playing) drawSelection();
  if (state.selIds.length) positionSelBar();
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
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
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
    case 'path':  return drawPath(it);
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
/* Dessin libre : points relatifs à (x, y), pour qu'il se déplace et
   s'anime comme les autres éléments. Courbe lissée par des quadratiques. */
function drawPath(it) {
  const pts = it.pts || [];
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = it.color; ctx.lineWidth = it.width || 3.5;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 3;
  ctx.beginPath();
  ctx.moveTo(it.x + pts[0][0], it.y + pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(it.x + pts[i][0], it.y + pts[i][1], it.x + mx, it.y + my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(it.x + last[0], it.y + last[1]);
  ctx.stroke();
  ctx.restore();
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
    const base = it.color && it.color !== '#C9A84C' ? it.color : '#eb7a2e';
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.moveTo(x - s * 0.75, y + s * 0.75); ctx.lineTo(x + s * 0.75, y + s * 0.75); ctx.lineTo(x, y - s); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.moveTo(x - s * 0.5, y + s * 0.1); ctx.lineTo(x + s * 0.5, y + s * 0.1); ctx.lineTo(x + s * 0.4, y - s * 0.15); ctx.lineTo(x - s * 0.4, y - s * 0.15); ctx.closePath(); ctx.fill();
    ctx.fillStyle = base; ctx.beginPath(); ctx.ellipse(x, y + s * 0.78, s, s * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fill();
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
  } else if (it.kind === 'flag') {          // drapeau / piquet à fanion
    ctx.strokeStyle = '#e9ecef'; ctx.lineWidth = Math.max(2, s * .14);
    ctx.beginPath(); ctx.moveTo(x, y + s * .9); ctx.lineTo(x, y - s * 1.4); ctx.stroke();
    ctx.fillStyle = it.color && it.color !== '#C9A84C' ? it.color : '#E03131';
    ctx.beginPath(); ctx.moveTo(x, y - s * 1.4); ctx.lineTo(x + s * 1.1, y - s * .95); ctx.lineTo(x, y - s * .5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(x, y + s * .92, s * .45, s * .16, 0, 0, Math.PI * 2); ctx.fill();
  } else if (it.kind === 'hoop') {          // cerceau
    ctx.strokeStyle = it.color && it.color !== '#C9A84C' ? it.color : '#FAB005'; ctx.lineWidth = Math.max(2.5, s * .2);
    ctx.beginPath(); ctx.ellipse(x, y, s * 1.3, s * .75, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (it.kind === 'mannequin') {     // mannequin (vue de dessus stylisée)
    ctx.fillStyle = it.color && it.color !== '#C9A84C' ? it.color : '#FAB005';
    ctx.beginPath(); ctx.roundRect(x - s * .55, y - s * .35, s * 1.1, s * 1.5, s * .4); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y - s * .75, s * .42, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1.2; ctx.stroke();
  } else if (it.kind === 'minigoal') {      // mini-but
    const gw = s * 1.8, gh = s * .9;
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x - gw / 2, y - gh / 2, gw, gh);
    ctx.strokeStyle = '#f4f6f8'; ctx.lineWidth = Math.max(1.5, s * .12); ctx.strokeRect(x - gw / 2, y - gh / 2, gw, gh);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = .8;
    for (let gx = x - gw / 2 + s * .3; gx < x + gw / 2 - 1; gx += s * .3) { ctx.beginPath(); ctx.moveTo(gx, y - gh / 2); ctx.lineTo(gx, y + gh / 2); ctx.stroke(); }
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
    else { const b = handleBounds(one); withRotation(one, () => [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].forEach(c => handle(c[0], c[1]))); }
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
  if (it.type === 'path') {
    const xs = (it.pts || [[0, 0]]).map(p => p[0]), ys = (it.pts || [[0, 0]]).map(p => p[1]);
    const x = it.x + Math.min(...xs), y = it.y + Math.min(...ys);
    return { x, y, w: Math.max(4, Math.max(...xs) - Math.min(...xs)), h: Math.max(4, Math.max(...ys) - Math.min(...ys)) };
  }
  if (it.type === 'player' || it.type === 'opponent') return { x: it.x - it.r, y: it.y - it.r, w: it.r * 2, h: it.r * 2 };
  if (it.type === 'equip') return { x: it.x - it.r * 1.15, y: it.y - it.r * 1.7, w: it.r * 2.3, h: it.r * 3.4 };
  if (it.type === 'text') { const w = (it.text || '…').length * it.size * 0.6, h = it.size; return { x: it.x - w / 2, y: it.y - h / 2, w, h }; }
  // shape / logo : normaliser largeur/hauteur négatives
  const x = Math.min(it.x, it.x + it.w), y = Math.min(it.y, it.y + it.h);
  return { x, y, w: Math.abs(it.w), h: Math.abs(it.h) };
}
/* Cadre des poignées : écarté du pion ou du matériel, pour ne pas le
   masquer et pouvoir le saisir sans attraper une poignée. */
function handleBounds(it) {
  const b = bounds(it);
  if (it.type !== 'player' && it.type !== 'opponent' && it.type !== 'equip') return b;
  const pad = 6;
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}
/* `pad` élargit la prise (unités du terrain) : au doigt, un pion de
   quelques pixels à l'écran doit rester facile à attraper. */
function hitItem(p, pad = 0) {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const it = state.items[i];
    if (it.type === 'arrow' || it.type === 'line') { if (distSeg(p, it) < 9 + pad) return it; continue; }
    if (it.type === 'path') {
      const lp0 = localPoint(p, it), q = (i) => ({ x: it.x + it.pts[i][0], y: it.y + it.pts[i][1] });
      if (it.pts.some((_, i) => i && distToSegment(lp0, q(i - 1), q(i)) < 9 + pad)) return it;
      continue;
    }
    const lp = localPoint(p, it);      // repère non-tourné
    if (it.type === 'player' || it.type === 'opponent') { if (Math.hypot(lp.x - it.x, lp.y - it.y) <= it.r + 2 + pad) return it; continue; }
    const b = bounds(it);
    if (lp.x >= b.x - pad && lp.x <= b.x + b.w + pad && lp.y >= b.y - pad && lp.y <= b.y + b.h + pad) return it;
  }
  return null;
}
/* Largeur de doigt (~14 px à l'écran) convertie en unités du terrain ; 0 à la souris. */
function touchPad(e) {
  if (e.pointerType === 'mouse') return 0;
  const w = canvas.getBoundingClientRect().width || 1;
  return 14 * curW() / w;
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
function hitHandle(p, it, pad = 0) {
  const R = HANDLE + 2 + pad;
  if (it.type === 'arrow' || it.type === 'line') {
    if (Math.hypot(p.x - it.x1, p.y - it.y1) <= R) return 'p1';
    if (Math.hypot(p.x - it.x2, p.y - it.y2) <= R) return 'p2';
    const m = midOf(it);
    if (Math.hypot(p.x - m.x, p.y - m.y) <= R) return 'pm';
    return null;
  }
  const lp = localPoint(p, it);
  const b = handleBounds(it);
  const corners = { nw: [b.x, b.y], ne: [b.x + b.w, b.y], sw: [b.x, b.y + b.h], se: [b.x + b.w, b.y + b.h] };
  for (const [k, c] of Object.entries(corners)) if (Math.hypot(lp.x - c[0], lp.y - c[1]) <= R) return k;
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
  if (it.type === 'shape' || it.type === 'logo' || it.type === 'path') { const b = bounds(it); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
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
  if (!CAN_EDIT || state.playing) return;
  if (e.button === 2) return;          // clic droit géré par le menu contextuel
  hideMenu();
  try { canvas.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
  const p = getPos(e);

  // Mode « Screen » : on trace le cadre d'export (aucun élément n'est créé).
  if (state.tool === 'screen') {
    drag = { mode: 'screen', x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    render(); return;
  }

  if (state.tool === 'select') {
    // 1) poignée de redimensionnement (sélection unique). Au doigt : saisir
    //    le corps de l'élément le déplace, et un pion, du matériel ou un
    //    texte se redimensionnent au curseur de la barre, pas aux coins.
    const pad = touchPad(e);
    const one = selected();
    if (one) {
      const onBody = pad && one.type !== 'arrow' && one.type !== 'line' && hitItem(p) === one;
      const h = !onBody && !(pad && sizeKind(one)) && hitHandle(p, one, pad * .6);
      if (h) {
        pushHistory();
        drag = { mode: 'handle', h, it: one };
        // Pion, matériel, texte : tirer un coin agrandit ou réduit l'élément,
        // proportionnellement à la distance au centre.
        if (sizeKind(one)) {
          const c = itemCenter(one);
          drag.scale = { c, d0: Math.max(4, Math.hypot(p.x - c.x, p.y - c.y)), s0: getSize(one) };
        }
        return;
      }
    }
    const it = hitItem(p, pad);
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
    if (state.equipColor) it.color = state.equipColor;
    state.items.push(it); state.selIds = [it.id]; commit();
  }
  else if (state.tool === 'pen') {
    const it = { id: nid(), type: 'path', x: p.x, y: p.y, pts: [[0, 0]], color: c, width: 3.5 };
    state.items.push(it); drag = { mode: 'create-path', it };
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
  if (!drag) { hoverCursor(e); return; }
  const p = getPos(e);
  // Dès que l'élément bouge vraiment, on libère la place autour de lui.
  const k = canvas.getBoundingClientRect().width / curW();   // px écran par unité du terrain
  if ((drag.mode === 'move-group' || drag.mode === 'handle') && !drag.moving
      && (drag.mode === 'handle' || Math.hypot(p.x - drag.ox, p.y - drag.oy) * k > 4)) {
    drag.moving = true;
    canvas.parentElement.classList.add('is-dragging');
  }
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
  } else if (drag.mode === 'create-path') {
    const it = drag.it, last = it.pts[it.pts.length - 1];
    const px = p.x - it.x, py = p.y - it.y;
    if (Math.hypot(px - last[0], py - last[1]) > 2.5) it.pts.push([Math.round(px * 10) / 10, Math.round(py * 10) / 10]);
  } else if (drag.mode === 'create-box') {
    drag.it.w = p.x - drag.ox; drag.it.h = p.y - drag.oy;
    showSizeTag(e, drag.it);
  } else if (drag.mode === 'handle' && drag.scale) {
    const { c, d0, s0 } = drag.scale;
    setSize(drag.it, s0 * Math.hypot(p.x - c.x, p.y - c.y) / d0);
    if (sizeKind(drag.it) === 'token') state.tokenR = drag.it.r;   // les prochains pions suivent
    if (sizeKind(drag.it) === 'equip') state.equipR = drag.it.r;
  } else if (drag.mode === 'handle') {
    resizeBox(drag.it, drag.h, localPoint(p, drag.it));   // redimensionne dans le repère non-tourné
    if (drag.it.type === 'shape') showSizeTag(e, drag.it);
  }
  render();
});

canvas.addEventListener('pointerup', () => {
  hideSizeTag();
  canvas.parentElement.classList.remove('is-dragging');
  if (!drag) return;
  if (drag.mode === 'create-box') {
    const it = drag.it;
    // On ne crée la zone QUE si l'utilisateur a réellement étiré (pas un simple clic).
    if (Math.abs(it.w) < 12 || Math.abs(it.h) < 12) {
      state.items = state.items.filter(x => x.id !== it.id);
      state.selIds = [];
    } else normalizeBox(it);
  }
  if (drag.mode === 'create-path' && drag.it.pts.length < 3) {   // un simple clic ne dessine rien
    state.items = state.items.filter(x => x.id !== drag.it.id);
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
    setTool('select');
    syncCrop();
    commit();
    return;
  }
  if (drag.mode === 'handle') normalizeBox(drag.it);
  drag = null;
  syncSelBar(); commit();
});

/* Curseur de redimensionnement au survol d'une poignée. */
function hoverCursor(e) {
  const one = CAN_EDIT && state.tool === 'select' ? selected() : null;
  const h = one && one.type !== 'arrow' && one.type !== 'line' ? hitHandle(getPos(e), one) : null;
  // En mode portrait, l'affichage est tourné de 90° : les diagonales s'inversent.
  const diag = (h === 'nw' || h === 'se') !== isPortrait() ? 'nwse-resize' : 'nesw-resize';
  canvas.style.cursor = h ? diag : '';
}

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
  enhanceColorInputs(m);
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
  if (['text', 'player', 'opponent', 'equip', 'path'].includes(it.type)) return;
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
  let number;
  if (state.fixedNum !== null) {
    // Numéro choisi dans la barre de gauche ; on passe au suivant pour
    // placer une équipe en onze clics.
    number = state.fixedNum;
    state.fixedNum = number < 11 ? number + 1 : null;
    syncToolButtons();
  } else number = state[numRef]++;
  state.items.push({ id: nid(), type, x: p.x, y: p.y, r: state.tokenR, number, color });
}

/* ============================================================
   BARRE D'OUTILS / UI
   ============================================================ */
function setTool(t, color = null, num = null) {
  state.tool = t;
  state.equipColor = t.startsWith('equip-') ? color : null;
  state.fixedNum = num;
  syncToolButtons();
  // Mode cadrage : le même bouton l'annule, Échap aussi.
  $('#screenHint')?.classList.toggle('hidden', t !== 'screen');
  const sb = $('#screenBtn');
  if (sb) { sb.classList.toggle('active', t === 'screen'); sb.textContent = t === 'screen' ? 'Annuler le cadrage' : 'Cadrer une zone'; }
  canvas.classList.toggle('tool-select', t === 'select');
  if (t !== 'select') { state.selIds = []; syncSelBar(); }
  render();
}
function syncToolButtons() {
  $$('.tb-tool[data-tool]').forEach(b => b.classList.toggle('active',
    b.dataset.tool === state.tool && (b.dataset.color || null) === state.equipColor
    && (b.dataset.num ? Number(b.dataset.num) : null) === state.fixedNum));
}
$$('.tb-tool[data-tool]').forEach(b => b.addEventListener('click', () =>
  setTool(b.dataset.tool, b.dataset.color || null, b.dataset.num ? Number(b.dataset.num) : null)));
/* Barre des numéros : mon équipe ou les adversaires. */
function setRailTeam(team) {
  state.railTeam = team;
  $$('[data-team]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.team === team)));
  $$('.tb-num').forEach(b => { b.dataset.tool = team; b.style.setProperty('--num-color', team === 'player' ? state.jersey : state.opp); });
  if (state.tool === 'player' || state.tool === 'opponent') setTool(team, null, state.fixedNum);
}
// Toucher l'autre équipe la choisit ; toucher l'équipe active ouvre sa couleur.
$$('[data-team]').forEach(b => b.addEventListener('click', () => {
  if (state.railTeam !== b.dataset.team) return setRailTeam(b.dataset.team);
  const mine = b.dataset.team === 'player';
  openPalette(b, 'team', mine ? state.jersey : state.opp, mine ? 'Couleur de mon équipe' : 'Couleur des adversaires');
}));
$('#logoBtn')?.addEventListener('click', () => $('#logoInput').click());
$$('#viewGroup .tb-tool').forEach(b => b.addEventListener('click', () => {
  state.view = b.dataset.view;
  $$('#viewGroup .tb-tool').forEach(x => x.classList.toggle('active', x === b));
  resizeCanvas(); scheduleSave();   // resize (orientation portrait/paysage) puis rendu
}));

$('#fontSelect').addEventListener('change', e => {
  state.textFont = e.target.value;                 // police par défaut pour les nouveaux textes
  const it = selected();
  if (it && it.type === 'text') { it.font = e.target.value; render(); scheduleSave(); }   // + applique au texte sélectionné
});
/* Reflète les couleurs de création sur les pastilles (équipes, tracés). */
function updatePionDots() {
  $('#pionDotRed').style.background = state.jersey;
  $('#pionDotBlue').style.background = state.opp;
  $('#drawDot').style.background = state.drawColor;
  $$('.tb-num').forEach(b => b.style.setProperty('--num-color', state.railTeam === 'player' ? state.jersey : state.opp));
}

/* ---------- Palette : une pastille, une palette qui s'ouvre à côté ----------
   Couleur de création (tracés, équipe active) : les éléments suivants la
   reprennent, et elle est mémorisée dans les préférences du compte.
   Couleur d'un élément sélectionné : ne change que lui. */
let paletteTarget = null;   // 'draw' | 'team' | 'selection'
let palettePushed = false;  // un seul « annuler » par choix de couleur
(() => {
  const grid = $('#tbPaletteGrid');
  COLOR_PALETTE.forEach((c, i) => grid.append(el('button', {
    type: 'button', class: 'sw', role: 'radio', title: COLOR_NAMES[i], 'aria-label': COLOR_NAMES[i],
    style: `background:${c}`, dataset: { c: c.toLowerCase() }, onclick: () => pickColor(c),
  })));
  const custom = el('input', { type: 'color', class: 'tb-palette-custom', 'aria-label': 'Autre couleur', title: 'Autre couleur' });
  custom.addEventListener('input', () => pickColor(custom.value, true));
  custom.addEventListener('change', () => closePalette());
  grid.append(custom);
})();
function openPalette(anchor, target, current, title) {
  const pal = $('#tbPalette');
  if (!pal.classList.contains('hidden') && paletteTarget === target) return closePalette();
  paletteTarget = target; palettePushed = false;
  $('#tbPaletteTitle').textContent = title;
  const cur = toHex(current).toLowerCase();
  $$('#tbPaletteGrid .sw').forEach(b => b.setAttribute('aria-checked', String(b.dataset.c === cur)));
  $('.tb-palette-custom').value = toHex(current);
  pal.classList.remove('hidden');
  // À droite d'une barre latérale, sinon sous la pastille ; toujours dans la scène.
  const st = canvas.parentElement.getBoundingClientRect(), a = anchor.getBoundingClientRect();
  const pw = pal.offsetWidth, ph = pal.offsetHeight, m = 8;
  const side = !!anchor.closest('.tb-players');
  let left = side ? a.right - st.left + m : a.left - st.left + a.width / 2 - pw / 2;
  let top = side ? a.top - st.top : a.bottom - st.top + m;
  if (!side && top + ph > st.height - m) top = a.top - st.top - ph - m;
  pal.style.left = `${Math.max(m, Math.min(st.width - pw - m, left))}px`;
  pal.style.top = `${Math.max(m, Math.min(st.height - ph - m, top))}px`;
}
function closePalette() { $('#tbPalette').classList.add('hidden'); paletteTarget = null; }
function pickColor(c, keepOpen = false) {
  if (paletteTarget === 'selection') {
    const sels = selectedItems(); if (!sels.length) return closePalette();
    if (!palettePushed) { pushHistory(); palettePushed = true; }
    sels.forEach(it => { it.color = c; });
    commit(); syncSelBar();
  } else {
    if (paletteTarget === 'draw') state.drawColor = c;
    else if (paletteTarget === 'team') state[state.railTeam === 'player' ? 'jersey' : 'opp'] = c;
    updatePionDots(); rememberPrefs();
  }
  if (!keepOpen) closePalette();
}
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#tbPalette, .tb-colorbtn, [data-team]')) closePalette();
});
$('#drawColorBtn').addEventListener('click', (e) =>
  openPalette(e.currentTarget, 'draw', state.drawColor, 'Couleur des flèches, zones et textes'));
$('#selColorBtn').addEventListener('click', (e) =>
  openPalette(e.currentTarget, 'selection', selectedItems()[0]?.color || state.drawColor, 'Couleur de l’élément'));

/* Couleurs et tailles de création mémorisées dans le compte (et donc
   aussi dans Paramètres) : un pion rouge reste rouge au prochain schéma. */
let prefsTimer = null;
function rememberPrefs() {
  if (!CAN_EDIT || !window.CURRENT_PROFILE) return;
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => savePrefsPatch({
    jersey: state.jersey, opp: state.opp, draw: state.drawColor, tokenR: state.tokenR, equipR: state.equipR,
  }).catch(e => console.warn('Préférences du tableau non enregistrées', e)), 800);
}
updatePionDots();
$('#toggleNumbers').addEventListener('click', () => { state.showNumbers = !state.showNumbers; render(); scheduleSave(); });
$('#formationSelect').addEventListener('change', e => { if (e.target.value) { applyFormation(e.target.value); e.target.value = ''; } });
document.getElementById('screenBtn')?.addEventListener('click', () => {
  if (state.tool === 'screen') { setTool('select'); return; }
  setTool('screen');
});
function clearCrop() {
  state.screen = null;
  syncCrop();
  toast('Cadrage retiré : export en plein terrain', 'success');
  commit();
}
/* Affiche l'état du cadrage (panneau Exporter + pastille sur le terrain). */
function syncCrop() {
  const on = !!state.screen;
  const status = $('#cropStatus');
  if (status) status.innerHTML = on
    ? 'Zone cadrée <button type="button" class="tb-linkbtn" id="cropClear">Retirer</button>'
    : 'Plein terrain';
  $('#cropClear')?.addEventListener('click', clearCrop);
  $('#cropChip')?.classList.toggle('hidden', !on);
}
document.getElementById('cropChip')?.addEventListener('click', clearCrop);
$('#undoBtn').addEventListener('click', undo);
$('#redoBtn')?.addEventListener('click', redo);
$('#clearBtn').addEventListener('click', () => { if (confirm('Tout effacer ?')) { pushHistory(); state.items = []; state.selIds = []; commit(); } });
$('#logoInput').addEventListener('change', importLogo);
$('#addStep').addEventListener('click', newStep);
$('#playSteps').addEventListener('click', () => playSteps());
$('#deleteStep').addEventListener('click', deleteStep);
$('#stepList').addEventListener('click', e => {
  const b = e.target.closest('[data-step]');
  if (b && !state.playing) goToStep(Number(b.dataset.step));
});
$('#exportPng').addEventListener('click', exportPNG);
$('#exportAllPng').addEventListener('click', exportAllSteps);
document.getElementById('presentBtn')?.addEventListener('click', togglePresent);
document.getElementById('exportVideo')?.addEventListener('click', exportVideo);
document.getElementById('saveBtn')?.addEventListener('click', () => saveToDB(false));
document.getElementById('tbValidate')?.addEventListener('click', () => saveToDB(true));

/* Coordonnées écran d'un point du terrain (orientation portrait comprise). */
function toScreen(x, y) {
  const r = canvas.getBoundingClientRect(), k = r.width / curW();
  return isPortrait() ? { x: r.left + y * k, y: r.top + (LW - x) * k } : { x: r.left + x * k, y: r.top + y * k };
}
/* La barre de réglages se pose juste au-dessus de la sélection (ou
   en dessous s'il n'y a pas la place) : on règle l'élément là où il est. */
let selBarFrozen = false;   // pendant le glissement du curseur de taille
function positionSelBar() {
  const bar = $('#selBar'), sels = selectedItems();
  if (!bar || bar.classList.contains('hidden') || !sels.length || selBarFrozen) return;
  const pts = sels.flatMap(it => { const b = itemBounds(it); return [toScreen(b.x, b.y), toScreen(b.x + b.w, b.y + b.h)]; });
  const stage = canvas.parentElement.getBoundingClientRect();
  const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
  const bw = bar.offsetWidth, bh = bar.offsetHeight, gap = 14;
  let left = (minX + maxX) / 2 - bw / 2 - stage.left;
  let top = minY - bh - gap - stage.top;
  // Jamais sous les barres fixes : on reste dans la zone du terrain.
  const cs = getComputedStyle(canvas.parentElement);
  const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight), padT = parseFloat(cs.paddingTop), padB = parseFloat(cs.paddingBottom);
  // Téléphone : barre posée en bas, au pouce, sans couvrir les barres latérales
  // ni l'élément (s'il est tout en bas, elle passe en haut).
  if (stage.width < 640) {
    const low = stage.height - padB - bh - 6;
    top = maxY - stage.top > low - 10 ? padT : low;
    bar.style.transform = `translate(${Math.round((stage.width - bw) / 2)}px, ${Math.round(top)}px)`;
    return;
  }
  if (top < padT) top = maxY + gap - stage.top;        // pas de place au-dessus : en dessous
  // Écran étroit : la barre peut déborder sur les marges, jamais hors de la scène.
  const [lo, hi] = bw > stage.width - padL - padR ? [8, stage.width - 8 - bw] : [padL, stage.width - padR - bw];
  left = Math.max(lo, Math.min(hi, left));
  top = Math.max(padT, Math.min(stage.height - padB - bh, top));
  bar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

/* Réglages de l'élément, au-dessus de lui : couleur (pastille), taille
   (curseur), n° ou texte, police, angle, rotation, duplication. */
function syncSelBar() {
  const sels = selectedItems();
  const bar = $('#selBar');
  const wasHidden = bar.classList.contains('hidden');
  bar.classList.toggle('hidden', !sels.length || state.playing);
  if (!sels.length) { closePalette(); return; }
  if (wasHidden) { bar.classList.remove('is-in'); void bar.offsetWidth; bar.classList.add('is-in'); }
  requestAnimationFrame(positionSelBar);

  const it = sels[0];
  $('#selLabel').textContent = `${sels.length} éléments`;
  $('#selLabel').classList.toggle('hidden', sels.length < 2);
  const colored = sels.some(x => x.type !== 'logo');
  $('#selColorBtn').classList.toggle('hidden', !colored);
  $('#selDot').style.background = it.color || (it.type === 'equip' ? '#F76707' : state.drawColor);

  // Taille : seulement pour pions, matériel et textes, au curseur.
  const sized = sels.filter(x => sizeKind(x));
  $('#propSize').classList.toggle('hidden', !sized.length);
  if (sized.length) $('#selSize').value = String(Math.round(sizeToSlider(sized[0])));

  // Texte / numéro / nom de zone : sélection unique.
  const one = sels.length === 1 ? it : null;
  const isToken = one && (one.type === 'player' || one.type === 'opponent');
  const hasText = one && (isToken || one.type === 'text' || one.type === 'shape');
  $('#propText').classList.toggle('hidden', !hasText);
  if (hasText) {
    const input = $('#selText');
    if (one.type === 'text') { $('#selTextLabel').textContent = 'Texte'; input.value = one.text || ''; input.placeholder = 'Texte'; }
    else if (isToken) { $('#selTextLabel').textContent = 'N°'; input.value = one.number ?? ''; input.placeholder = '—'; }
    else { $('#selTextLabel').textContent = 'Nom'; input.value = one.label || ''; input.placeholder = 'Nom de la zone'; }
  }

  $('#fontSelect').classList.toggle('hidden', !(one && one.type === 'text'));
  if (one && one.type === 'text') $('#fontSelect').value = one.font || state.textFont;
  // Pivoter n'a de sens que pour ce qui a une orientation (pas un pion rond).
  $('#selRotate').classList.toggle('hidden', !sels.some(x => ['shape', 'equip', 'text', 'logo', 'path'].includes(x.type)));

  // Bouton d'angle : réservé aux tracés, il pose ou retire le coude.
  const bendBtn = $('#selBend');
  const isSeg = one && (one.type === 'arrow' || one.type === 'line');
  bendBtn.classList.toggle('hidden', !isSeg);
  if (isSeg) {
    const has = !!bendOf(one);
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
/* Taille au curseur : glisser → voir → relâcher. Un seul « annuler » par
   geste, et la barre ne bouge pas sous le doigt pendant le glissement. */
const sizeToSlider = (it) => { const [lo, hi] = SIZE_LIMITS[sizeKind(it)]; return (getSize(it) - lo) / (hi - lo) * 100; };
let sizing = false;
$('#selSize').addEventListener('input', e => {
  const sels = selectedItems().filter(x => sizeKind(x)); if (!sels.length) return;
  if (!sizing) { pushHistory(); sizing = true; selBarFrozen = true; }
  const v = Number(e.target.value) / 100;
  sels.forEach(it => {
    const [lo, hi] = SIZE_LIMITS[sizeKind(it)];
    setSize(it, lo + v * (hi - lo));
    if (sizeKind(it) === 'token') state.tokenR = it.r;   // les prochains pions prennent cette taille
    if (sizeKind(it) === 'equip') state.equipR = it.r;
  });
  render();
});
$('#selSize').addEventListener('change', () => {
  sizing = false; selBarFrozen = false;
  commit(); positionSelBar(); rememberPrefs();
});
$('#selDup').addEventListener('click', () => {
  const keep = clipboard;
  copySelection(true); pasteClipboard(true);
  clipboard = keep;
});
$('#selRotate').addEventListener('click', () => {
  const sels = selectedItems(); if (!sels.length) return;
  pushHistory(); sels.forEach(it => rotateItem(it, 90)); commit();
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
function copySelection(quiet = false) {
  const sels = selectedItems(); if (!sels.length) return;
  clipboard = sels.map(it => { const c = { ...it }; delete c._img; delete c.id; return c; });
  if (!quiet) toast(sels.length + ' élément' + (sels.length > 1 ? 's' : '') + ' copié' + (sels.length > 1 ? 's' : ''), 'success');
}
function pasteClipboard(quiet = false) {
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
  if (!quiet) toast(added.length + ' collé' + (added.length > 1 ? 's' : ''), 'success');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideMenu(); if (state.tool === 'screen') { drag = null; setTool('select'); } }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (state.playing) return;
  if (!CAN_EDIT) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); }
  else if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteClipboard(); }
  else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); $('#selDup').click(); } // duplication rapide
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
    state.items.push({ id: nid(), type: 'player', x: px / 100 * LW, y: py / 100 * LH, r: state.tokenR, number: state.nextNum++, color: state.jersey });
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
   Chaque étape mémorise la position de tous les éléments. L'étape
   affichée (pastille active) est celle que l'on modifie : chaque
   déplacement y est enregistré automatiquement. « Lire » part de
   l'étape 1 et enchaîne jusqu'à la dernière.
   ============================================================ */
const POS_KEYS = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'mx', 'my'];
function snapshot() {
  const s = {};
  for (const it of state.items) {
    const o = {};
    for (const k of POS_KEYS) if (typeof it[k] === 'number') o[k] = it[k];
    s[it.id] = o;
  }
  return s;
}
/* Place les éléments comme dans une étape. Un élément ajouté après
   coup (absent de l'étape) garde sa position ; un coude absent de
   l'étape est retiré. */
function applySnapshot(snap) {
  for (const it of state.items) {
    const o = snap?.[it.id]; if (!o) continue;
    for (const k of POS_KEYS) {
      if (typeof o[k] === 'number') it[k] = o[k];
      else if ((k === 'mx' || k === 'my') && k in it) delete it[k];
    }
  }
}
function recordStep() {
  if (state.curStep !== null && state.steps[state.curStep]) state.steps[state.curStep] = snapshot();
}
function newStep() {
  if (state.playing) return;
  pushHistory();
  if (!state.steps.length) { state.steps = [snapshot()]; state.curStep = 0; }
  else recordStep();
  const at = (state.curStep ?? state.steps.length - 1) + 1;
  state.steps.splice(at, 0, snapshot());
  state.curStep = at;
  renderSteps(); scheduleSave();
  // Explication une seule fois ; ensuite la pastille qui s'allume suffit.
  if (at === 1) toast('Étape 1 = position de départ. Déplacez les éléments pour l’étape 2.', 'success');
  const pill = document.querySelector(`.tb-step[data-step="${at}"]`);
  pill?.classList.add('is-new');
}
function goToStep(i) {
  if (i === state.curStep || !state.steps[i]) return;
  recordStep();
  const from = snapshot();
  state.curStep = i;
  state.selIds = []; syncSelBar();
  renderSteps();
  tween(from, state.steps[i], 380, () => { applySnapshot(state.steps[i]); render(); scheduleSave(); });
}
function deleteStep() {
  if (state.curStep === null || state.playing) return;
  if (!confirm(`Supprimer l’étape ${state.curStep + 1} ?`)) return;
  pushHistory();
  state.steps.splice(state.curStep, 1);
  if (state.steps.length < 2) {
    // Une étape seule n'anime rien : on revient à un schéma statique.
    state.steps = []; state.curStep = null;
  } else {
    state.curStep = Math.min(state.curStep, state.steps.length - 1);
    applySnapshot(state.steps[state.curStep]);
  }
  renderSteps(); commit();
}
function renderSteps() {
  const n = state.steps.length, cur = state.curStep;
  $('#stepList').innerHTML = state.steps.map((_, i) =>
    `<button type="button" class="tb-step${i === cur ? ' active' : ''}" data-step="${i}" title="Afficher l’étape ${i + 1}">${i + 1}</button>`).join('');
  $('#stepInfo').textContent = !n ? '' : (cur === null ? `${n} étapes` : `${cur + 1} / ${n}`);
  $('#stepHint').textContent = !n ? 'Placez vos éléments, puis « + Étape ».' : '';
  $('#playSteps').disabled = n < 2;
  $('#deleteStep').disabled = cur === null;
  $('#exportAllPng').disabled = n < 2;
  $('#exportVideo').disabled = n < 2;
  const ps = $('#presStep'); if (ps) ps.textContent = n && cur !== null ? `Étape ${cur + 1} / ${n}` : '';
  const prev = $('#stepPrev'), next = $('#stepNext');
  if (prev) prev.disabled = !n || !cur;
  if (next) next.disabled = !n || cur === n - 1;
  renderClips();
}

function playSteps(done) {
  const finish = () => { if (typeof done === 'function') done(); };
  if (state.playing) return;
  if (state.steps.length < 2) { toast('Créez au moins 2 étapes pour lancer l’animation.', 'error'); return finish(); }
  recordStep();
  state.playing = true; state.selIds = []; syncSelBar();
  applySnapshot(state.steps[0]); state.curStep = 0; renderSteps(); render();
  let i = 0;
  const next = () => {
    if (i >= state.steps.length - 1) {
      state.playing = false; render(); renderSteps(); return finish();
    }
    // Courte pause sur chaque étape, puis transition fluide vers la suivante.
    setTimeout(() => tween(state.steps[i], state.steps[i + 1], 1100 / state.speed, () => {
      i++; state.curStep = i; renderSteps(); next();
    }), (i === 0 ? 350 : 250) / state.speed);
  };
  next();
}

/* ---------- Clips : plusieurs animations sur le même terrain ----------
   Découper : les étapes jusqu'à l'étape affichée restent dans le clip,
   la suite (à partir de l'étape affichée, pour garder la continuité)
   devient un nouveau clip placé juste après. Tout est annulable. */
function renderClips() {
  const label = $('#clipLabel'); if (!label) return;
  label.textContent = state.clips[state.clip].name;
  const list = $('#clipList');
  if (list) list.innerHTML = state.clips.map((c, i) => `
    <button type="button" class="tb-clip${i === state.clip ? ' active' : ''}" data-clip="${i}">
      <strong>${escapeHtml(c.name)}</strong><span>${c.steps.length} étape${c.steps.length > 1 ? 's' : ''}</span>
    </button>`).join('');
  const name = $('#clipName'); if (name && document.activeElement !== name) name.value = state.clips[state.clip].name;
  const n = state.steps.length, cur = state.curStep;
  const set = (id, off) => { const b = $(id); if (b) b.disabled = off; };
  set('#clipSplit', !(n >= 3 && cur > 0 && cur < n - 1));
  set('#clipTrimBefore', !(n && cur > 0));
  set('#clipTrimAfter', !(n && cur !== null && cur < n - 1));
  set('#clipDelete', state.clips.length < 2);
}
function selectClip(i) {
  if (state.playing || !state.clips[i] || i === state.clip) return;
  recordStep();
  state.clip = i;
  state.curStep = state.steps.length ? 0 : null;
  if (state.steps.length) applySnapshot(state.steps[0]);
  state.selIds = []; syncSelBar(); renderSteps(); render(); scheduleSave();
}
const nextClipName = () => `Clip ${state.clips.length + 1}`;
function clipAction(kind) {
  if (state.playing) return;
  recordStep();
  pushHistory();
  const c = state.clips[state.clip], cur = state.curStep;
  const copy = (steps) => JSON.parse(JSON.stringify(steps));
  if (kind === 'new') {
    state.clips.splice(state.clip + 1, 0, { name: nextClipName(), steps: [] });
    state.clip++; state.curStep = null;
    toast('Nouveau clip : placez les éléments puis « + Étape ».', 'success');
  } else if (kind === 'dup') {
    state.clips.splice(state.clip + 1, 0, { name: `${c.name} (copie)`, steps: copy(c.steps) });
    state.clip++;
    toast('Clip dupliqué : modifiez la copie, l’original reste intact.', 'success');
  } else if (kind === 'split') {
    const tail = copy(c.steps.slice(cur));
    c.steps = c.steps.slice(0, cur + 1);
    state.clips.splice(state.clip + 1, 0, { name: nextClipName(), steps: tail });
    state.clip++; state.curStep = 0;
    toast(`Découpé : « ${c.name} » garde les étapes 1 à ${cur + 1}, la suite forme « ${state.clips[state.clip].name} ».`, 'success');
  } else if (kind === 'trimBefore') {
    c.steps = c.steps.slice(cur); state.curStep = 0;
  } else if (kind === 'trimAfter') {
    c.steps = c.steps.slice(0, cur + 1);
  } else if (kind === 'delete') {
    state.clips.splice(state.clip, 1);
    state.clip = Math.max(0, state.clip - 1);
    state.curStep = state.steps.length ? 0 : null;
  }
  if (state.curStep !== null && state.steps[state.curStep]) applySnapshot(state.steps[state.curStep]);
  state.selIds = []; syncSelBar(); renderSteps(); render(); scheduleSave();
}
$('#clipList')?.addEventListener('click', e => { const b = e.target.closest('[data-clip]'); if (b) selectClip(Number(b.dataset.clip)); });
$('#clipName')?.addEventListener('change', e => {
  const v = e.target.value.trim(); if (!v) return;
  pushHistory(); state.clips[state.clip].name = v.slice(0, 40); renderClips(); scheduleSave();
});
[['#clipNew', 'new'], ['#clipDup', 'dup'], ['#clipSplit', 'split'], ['#clipTrimBefore', 'trimBefore'],
 ['#clipTrimAfter', 'trimAfter'], ['#clipDelete', 'delete']].forEach(([id, kind]) => $(id)?.addEventListener('click', () => clipAction(kind)));

function setSpeed(v) {
  state.speed = Math.max(0.5, Math.min(2, Math.round(v * 4) / 4));
  const el = $('#speedVal'); if (el) el.textContent = `${String(state.speed).replace('.', ',')}×`;
}
$('#speedDown')?.addEventListener('click', () => setSpeed(state.speed - 0.25));
$('#speedUp')?.addEventListener('click', () => setSpeed(state.speed + 0.25));
$('#stepPrev')?.addEventListener('click', () => { if (state.curStep > 0) goToStep(state.curStep - 1); });
$('#stepNext')?.addEventListener('click', () => {
  const n = state.steps.length; if (!n) return;
  goToStep(state.curStep === null ? 0 : Math.min(n - 1, state.curStep + 1));
});

/* ---------- Mode présentation (plein écran) ----------
   Barre de commande intégrée (étapes, lecture, quitter) : on n'est
   jamais bloqué en plein écran. Si le navigateur refuse le plein écran
   (iPhone…), la présentation occupe la fenêtre. */
function togglePresent() {
  const stage = document.querySelector('.tb-stage');
  if (stage.classList.contains('presenting')) return exitPresent();
  stage.classList.add('presenting');
  state.selIds = []; syncSelBar(); fitCanvas(); render();
  if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
}
function exitPresent() {
  document.querySelector('.tb-stage')?.classList.remove('presenting');
  fitCanvas();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  render();
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) document.querySelector('.tb-stage')?.classList.remove('presenting');
  render();
});
$('#presExit').addEventListener('click', exitPresent);
$('#presPlay').addEventListener('click', () => playSteps());
$('#presPrev').addEventListener('click', () => { if (state.curStep > 0) goToStep(state.curStep - 1); });
$('#presNext').addEventListener('click', () => {
  const n = state.steps.length; if (!n) return;
  goToStep(state.curStep === null ? 0 : Math.min(n - 1, state.curStep + 1));
});

/* ---------- Export vidéo de l'animation ----------
   MP4 quand le navigateur sait l'enregistrer (lisible partout, y compris
   QuickTime et WhatsApp), sinon WebM. Respecte la zone cadrée. */
async function exportVideo() {
  if (!window.MediaRecorder || !canvas.captureStream) return toast('Export vidéo non supporté par ce navigateur.', 'error');
  if (state.steps.length < 2) return toast('Créez au moins 2 étapes pour exporter une vidéo.', 'error');
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';

  // Source : le terrain entier, ou une copie recadrée image par image.
  const keepTool = state.tool; state.tool = 'view';
  let source = canvas, copyLoop = null;
  if (state.screen) {
    const dpr = window.devicePixelRatio || 1, s = state.screen;
    const r = isPortrait() ? { x: s.y, y: LW - (s.x + s.w), w: s.h, h: s.w } : { x: s.x, y: s.y, w: s.w, h: s.h };
    source = document.createElement('canvas');
    source.width = Math.round(r.w * dpr); source.height = Math.round(r.h * dpr);
    const g = source.getContext('2d');
    const copy = () => { g.drawImage(canvas, r.x * dpr, r.y * dpr, r.w * dpr, r.h * dpr, 0, 0, source.width, source.height); copyLoop = requestAnimationFrame(copy); };
    copy();
  }
  const rec = new MediaRecorder(source.captureStream(30), mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const btn = $('#exportVideo'); btn.disabled = true; btn.textContent = 'Enregistrement…';
  rec.onstop = () => {
    if (copyLoop) cancelAnimationFrame(copyLoop);
    state.tool = keepTool; render();
    btn.disabled = false; btn.textContent = 'Vidéo de l’animation';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type: mime.split(';')[0] || 'video/webm' }));
    a.download = `animation-tactique.${ext}`; a.click();
    toast('Vidéo exportée', 'success');
  };
  rec.start();
  playSteps(() => setTimeout(() => rec.stop(), 700));
}

/* Transition entre deux étapes : easeInOutCubic, coudes compris. */
function tween(from, to, dur, done) {
  const t0 = performance.now();
  const frame = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    for (const it of state.items) {
      const a = from[it.id], b = to[it.id]; if (!a || !b) continue;
      for (const key of POS_KEYS) {
        if (typeof a[key] === 'number' && typeof b[key] === 'number') it[key] = a[key] + (b[key] - a[key]) * e;
        else if (typeof b[key] === 'number' && k >= 1) it[key] = b[key];
      }
    }
    render();
    if (k < 1) requestAnimationFrame(frame); else if (done) done();
  };
  requestAnimationFrame(frame);
}

/* ============================================================
   HISTORIQUE / PERSISTANCE
   ============================================================ */
function serialize() {
  return {
    view: state.view, showNumbers: state.showNumbers, steps: state.steps, curStep: state.curStep,
    clips: state.clips, clip: state.clip,
    nextNum: state.nextNum, nextOpp: state.nextOpp, screen: state.screen,
    items: state.items.map(it => { const c = { ...it }; delete c._img; return c; }),
  };
}
function deserialize(data) {
  state.view = data.view || 'complet';
  state.screen = data.screen || null;
  state.showNumbers = data.showNumbers !== false;
  // Anciens schémas : une seule liste d'étapes = un seul clip.
  state.clips = Array.isArray(data.clips) && data.clips.length
    ? data.clips.map((c, i) => ({ name: c.name || `Clip ${i + 1}`, steps: Array.isArray(c.steps) ? c.steps : [] }))
    : [{ name: 'Clip 1', steps: Array.isArray(data.steps) ? data.steps : [] }];
  state.clip = Number.isInteger(data.clip) && state.clips[data.clip] ? data.clip : 0;
  state.curStep = Number.isInteger(data.curStep) && state.steps[data.curStep] ? data.curStep : null;
  state.nextNum = data.nextNum || (data.items?.filter(i => i.type === 'player').length + 1) || 1;
  state.nextOpp = data.nextOpp || 1;
  state.items = (data.items || []).map(it => {
    if (it.type === 'logo' && it.src) { const img = new Image(); img.src = it.src; it._img = img; }
    return it;
  });
  idSeq = Math.max(0, ...state.items.map(i => i.id)) + 1;
  $$('#viewGroup .tb-tool').forEach(x => x.classList.toggle('active', x.dataset.view === state.view));
  renderSteps(); syncCrop();
}

/* Historique : éléments, clips et étape affichée. Toute action qui
   modifie le schéma (y compris découper ou supprimer un clip) se défait. */
const historyState = () => JSON.stringify({ items: serialize().items, clips: state.clips, clip: state.clip, curStep: state.curStep });
function restoreHistory(json) {
  const h = JSON.parse(json);
  state.items = h.items.map(it => { if (it.type === 'logo' && it.src) { const img = new Image(); img.src = it.src; it._img = img; } return it; });
  state.clips = h.clips; state.clip = h.clip; state.curStep = h.curStep;
  state.selIds = []; syncSelBar(); renderSteps(); render(); scheduleSave();
}
function pushHistory() {
  state.history.push(historyState()); state.future = [];
  if (state.history.length > 60) state.history.shift();
  syncHistoryButtons();
}
function undo() {
  if (!state.history.length || state.playing) return;
  state.future.push(historyState());
  restoreHistory(state.history.pop());
  syncHistoryButtons();
}
function redo() {
  if (!state.future.length || state.playing) return;
  state.history.push(historyState());
  restoreHistory(state.future.pop());
  syncHistoryButtons();
}
function syncHistoryButtons() {
  const u = document.getElementById('undoBtn'), r = document.getElementById('redoBtn');
  if (u) u.disabled = !state.history.length;
  if (r) r.disabled = !state.future.length;
}
/* Chaque modification est aussi enregistrée dans l'étape affichée. */
function commit() { render(); recordStep(); scheduleSave(); }

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
  const n = state.curStep !== null ? `-etape-${state.curStep + 1}` : '';
  a.href = exportClean(); a.download = `schema-tactique${n}.png`; a.click();
}
/* Une image par étape, dans l'ordre (le navigateur peut demander
   l'autorisation de télécharger plusieurs fichiers). */
async function exportAllSteps() {
  if (state.steps.length < 2) return toast('Créez au moins 2 étapes.', 'error');
  recordStep();
  const keep = state.curStep;
  for (let i = 0; i < state.steps.length; i++) {
    applySnapshot(state.steps[i]);
    const a = document.createElement('a');
    a.href = exportClean(); a.download = `schema-tactique-etape-${i + 1}.png`; a.click();
    await new Promise(r => setTimeout(r, 300));
  }
  if (keep !== null) applySnapshot(state.steps[keep]);
  render();
  toast(`${state.steps.length} images exportées`, 'success');
}

async function saveToDB(validate) {
  if (EXO) return saveExerciseSchema(validate);
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

/* Schéma d'exercice : image PNG dans le dossier du joueur, JSON sur l'exercice. */
async function saveExerciseSchema(validate) {
  if (!EXO_ROW) return toast('Exercice introuvable.', 'error');
  const btn = validate ? document.getElementById('tbValidate') : document.getElementById('saveBtn');
  if (btn) btn.disabled = true;
  try {
    const blob = await (await fetch(exportClean())).blob();
    const path = `${EXO_ROW.club_id}/${EXO_ROW.player_id}/program/schema-${EXO}.png`;
    const { error: upErr } = await sb.storage.from('player-performance-media')
      .upload(path, blob, { upsert: true, contentType: 'image/png' });
    if (upErr) throw upErr;
    const { error } = await sb.from('program_exercises')
      .update({ schema_json: serialize(), schema_path: path }).eq('id', EXO);
    if (error) throw error;
    persistLocal();
    if (validate) {
      toast('Schéma enregistré sur l’exercice.', 'success');
      if (window.opener && !window.opener.closed) { try { window.opener.location.reload(); } catch (e) {} }
      setTimeout(() => window.close(), 1100);
    } else toast('Schéma enregistré', 'success');
  } catch (e) { console.error('Schéma d’exercice non enregistré', e); toast(e.message, 'error'); }
  finally { if (btn) btn.disabled = false; }
}

/* Applique les préférences utilisateur (page Paramètres) aux valeurs
   par défaut du tableau : couleurs, tailles, police, vue, numéros. */
function applyPrefs(prefs) {
  if (!prefs) return;
  if (prefs.jersey) state.jersey = prefs.jersey;
  if (prefs.opp)    state.opp = prefs.opp;
  if (prefs.draw)   state.drawColor = prefs.draw;
  if (prefs.tokenR) state.tokenR = clampSize('token', prefs.tokenR);
  if (prefs.equipR) state.equipR = clampSize('equip', prefs.equipR);
  if (prefs.font)   { state.textFont = prefs.font; const el = $('#fontSelect');  if (el) el.value = prefs.font; }
  if (typeof prefs.showNumbers === 'boolean') state.showNumbers = prefs.showNumbers;
  // La vue par défaut ne s'applique qu'à un nouveau schéma (sinon on écraserait
  // la vue enregistrée avec le schéma).
  if (prefs.view && !PROC && !EXO) state.view = prefs.view;
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
  if ((PROC || EXO) && CAN_EDIT) {
    document.getElementById('tbValidate')?.classList.remove('hidden');
    document.getElementById('saveBtn')?.classList.remove('hidden');
  }

  resizeCanvas();
  let loaded = false;
  if (PROC) {
    try {
      const { data: schema } = await sb.from('tactical_schemas').select('*').eq('procedure_id', PROC).maybeSingle();
      PROC_SCHEMA = schema || null;
      const { data: proc } = await sb.from('procedures').select('*').eq('id', PROC).maybeSingle();
      PROC_ROW = proc || null;
      $('#tbContext').textContent = `procédé « ${proc?.nom || '#' + PROC} »`;
      if (schema && schema.canvas_json) { deserialize(schema.canvas_json); loaded = true; }
    } catch (e) { /* ignore, on tentera le LocalStorage */ }
  }
  if (EXO) {
    const { data: row, error } = await sb.from('program_exercises')
      .select('id, title, instructions, dosage, club_id, player_id, schema_json, video_id').eq('id', EXO).maybeSingle();
    if (error || !row) toast('Exercice introuvable : le schéma ne pourra pas être enregistré.', 'error');
    else {
      EXO_ROW = row;
      $('#tbContext').textContent = `schéma de l’exercice « ${row.title} »`;
      if (row.schema_json) { deserialize(row.schema_json); loaded = true; }
    }
  }
  if (!loaded) {
    const ls = localStorage.getItem(LS_KEY);
    if (ls) { try { deserialize(JSON.parse(ls)); loaded = true; } catch (e) {} }
  }
  if (!loaded && window.matchMedia('(max-width: 700px) and (orientation: portrait)').matches) {
    state.view = 'horizontal';
    $$('#viewGroup .tb-tool').forEach(x => x.classList.toggle('active', x.dataset.view === state.view));
  }
  setTool('select');
  setRailTeam(state.railTeam); setSpeed(state.speed); syncHistoryButtons();
  renderSteps(); syncCrop(); syncSelBar();
  resizeCanvas();   // ajuste l'orientation si le schéma chargé était en mode Horizontal
}
const BOOTED = boot();
