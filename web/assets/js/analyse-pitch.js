/* ============================================================
   LMFC Performance — analyse-pitch.js
   Terrains de l'onglet Analyse. Horizontal, on attaque vers la GAUCHE
   (comme le schéma des zones du club : Arrière à droite, profondeurs à
   gauche). Coordonnées des clips : x et y de 0 à 100, dessinées en 105 × 68.
     anPitchHtml(list, { layer, shot, idp, label }) :
       - layer : le calque posé sous les actions, cliquable (il filtre) :
           anZonesLayer  les 8 zones fonctionnelles, teintées selon le % de
                         réussite (passes) ; sans chiffres (fenêtre de
                         codage) : simple repère, non cliquable ;
           anRectsLayer  les trois tiers d'un terrain classique, ou les
                         zones de tir (hors surface, surface, 5,50 m) ;
       - shot : seul le tiers offensif, tourné but en haut ;
       - actions : flèche départ → arrivée, ou point (losange : duel aérien) ;
         couleur du résultat ; un clip sans point n'est pas dessiné.
   ============================================================ */

const AN_PITCH_LINES = `<g class="an-lines" fill="none" stroke="currentColor" stroke-width=".3">
  <rect x=".5" y=".5" width="104" height="67"/><path d="M52.5 .5v67"/><circle cx="52.5" cy="34" r="9.15"/>
  <rect x=".5" y="13.85" width="16.5" height="40.3"/><rect x=".5" y="24.85" width="5.5" height="18.3"/>
  <rect x="88" y="13.85" width="16.5" height="40.3"/><rect x="99" y="24.85" width="5.5" height="18.3"/></g>`;

/* Contours relevés sur le schéma du club (en % de la longueur et de la largeur). */
const AN_ZONE_SHAPES = {
  initiation: [[71.4, 36.7], [81.4, 0], [100, 0], [100, 100], [82.6, 100], [71.4, 60.5]],
  base: [[55, 21.4], [71.4, 36.7], [71.4, 60.5], [55, 78.3], [53, 60.5], [53, 36.7]],
  carre: [[30.9, 21.4], [55, 21.4], [53, 36.7], [53, 60.5], [55, 78.3], [30.9, 78.3], [28.9, 60.5], [28.9, 36.7]],
  couloir_droit: [[28.7, 0], [81.4, 0], [71.4, 36.7], [55, 21.4], [30.9, 21.4]],
  couloir_gauche: [[27.9, 100], [30.9, 78.3], [55, 78.3], [71.4, 60.5], [82.6, 100]],
  profondeur_droite: [[0, 0], [28.7, 0], [30.9, 21.4], [29.9, 28.8], [0, 19.2]],
  axe: [[0, 19.2], [29.9, 28.8], [28.9, 36.7], [28.9, 60.5], [29.9, 69.2], [0, 80.5]],
  profondeur_gauche: [[0, 80.5], [29.9, 69.2], [30.9, 78.3], [27.9, 100], [0, 100]],
};
const AN_ZONE_LABEL_AT = {
  initiation: [87, 44], base: [62.5, 44], carre: [40.5, 44], couloir_droit: [58, 8],
  couloir_gauche: [58, 88], profondeur_droite: [14, 6], axe: [14, 44], profondeur_gauche: [14, 87],
};
/* Rectangles cliquables, en mètres [x, y, largeur, hauteur], par champ filtré.
   Tiers : le 1er à droite (notre but). Tirs : le plus petit dessiné en dernier, il prend le clic. */
const AN_RECTS = {
  tiers_depart: { 1: [70, 0, 35, 68], 2: [35, 0, 35, 68], 3: [0, 0, 35, 68] },
  categorie: { hors_surface: [0, 0, 35, 68], surface: [0, 13.85, 16.5, 40.3], six_metres: [0, 24.85, 5.5, 18.3] },
};

const anPx = (x) => (x * 1.05).toFixed(2);
const anPy = (y) => (y * 0.68).toFixed(2);

/* Une forme cliquable : ajoute ou retire value du filtre (level, key). */
function anHit(inner, h) {
  return `<g class="an-z is-click${h.on ? ' is-on' : ''}" role="button" tabindex="0" data-an="toggle" data-level="${h.level}" data-key="${h.key}"
    data-value="${h.value}" aria-pressed="${h.on}" aria-label="${esc(h.label)}. Filtrer"><title>${esc(h.label)}</title>${inner}</g>`;
}

/* Une zone : contour, teinte (% de réussite), nom du schéma, ancien nom, chiffres. */
function anZoneSvg(z, s, hit) {
  const [name, old] = AN_ZONE_NAMES[z], [lx, ly] = AN_ZONE_LABEL_AT[z];
  const pts = AN_ZONE_SHAPES[z].map(([x, y]) => `${anPx(x)},${anPy(y)}`).join(' ');
  const a = s?.pct != null ? (0.08 + (0.5 * s.pct) / 100).toFixed(2) : 0;
  const line = (dy, cls, text) => `<text x="${anPx(lx)}" y="${(Number(anPy(ly)) + dy).toFixed(2)}" class="${cls}">${esc(text)}</text>`;
  const texts = line(0, 'an-z-name', name) + (old ? line(2.6, 'an-z-old', old) : '')
    + (s ? line(old ? 5.6 : 3, 'an-z-n', s.pct == null ? String(s.total) : `${s.total} · ${anPct(s.pct)}`) : '');
  if (!s) return `<g class="an-z" aria-hidden="true"><polygon points="${pts}"/>${texts}</g>`;
  return anHit(`<polygon points="${pts}" style="--a:${a}"/>${texts}`, { ...hit, value: z, on: s.on,
    label: `${s.label} : ${s.total} action${s.total > 1 ? 's' : ''}, ${s.ok} réussie(s), ${anPct(s.pct)}` });
}
function anZonesLayer(stats = null, hit = null) { return Object.keys(AN_ZONE_SHAPES).map(z => anZoneSvg(z, stats?.[z], hit)).join(''); }

function anRectsLayer(stats, hit) {
  return Object.entries(AN_RECTS[hit.key]).map(([v, [x, y, w, h]]) => anHit(`<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`,
    { ...hit, value: v, on: stats[v].on, label: `${stats[v].label} : ${stats[v].total} action${stats[v].total > 1 ? 's' : ''}` })).join('');
}

function anMarker(idp, res) {
  return `<marker id="${idp}-${res}" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
    <path d="M0 0 6 3 0 6z" class="an-fill-${res}"/></marker>`;
}

function anMark(c, idp) {
  const res = c.resultat || 'na', x1 = anPx(c.x1), y1 = anPy(c.y1);
  const title = `<title>${esc(anClipName(c))}</title>`;
  if (c.x2 != null) {
    return `<g class="an-mk an-mk-${res}">${title}<line x1="${x1}" y1="${y1}" x2="${anPx(c.x2)}" y2="${anPy(c.y2)}" marker-end="url(#${idp}-${res})"/>
      <circle cx="${x1}" cy="${y1}" r=".9"/></g>`;
  }
  if (c.action === 'duel_air') return `<g class="an-mk an-mk-${res}">${title}<rect x="${(x1 - 1.1).toFixed(2)}" y="${(y1 - 1.1).toFixed(2)}" width="2.2" height="2.2" transform="rotate(45 ${x1} ${y1})"/></g>`;
  return `<g class="an-mk an-mk-${res}">${title}<circle cx="${x1}" cy="${y1}" r="1.3"/></g>`;
}

function anPitchHtml(list, { layer = '', shot = false, idp = 'an', label = 'Terrain' } = {}) {
  const marks = list.filter(c => c.x1 != null && c.y1 != null).map(c => anMark(c, idp)).join('');
  const inner = `${AN_PITCH_LINES}${layer}<g class="an-marks">${marks}</g>`;
  return `<div class="an-pitch${shot ? ' is-shot' : ''}">
    <svg class="an-pitch-svg" viewBox="${shot ? '0 0 68 35' : '0 0 105 68'}" role="group" aria-label="${esc(label)}">
      <defs>${['ok', 'ko', 'na'].map(r => anMarker(idp, r)).join('')}</defs>${shot ? `<g transform="translate(68 0) rotate(90)">${inner}</g>` : inner}</svg></div>`;
}

/* Clic sur un terrain entier → coordonnées 0 à 100 (une décimale). */
function anPitchPoint(svg, e) {
  const r = svg.getBoundingClientRect();
  const clamp = (v) => Math.min(100, Math.max(0, Math.round(v * 10) / 10));
  return { x: clamp(((e.clientX - r.left) / r.width) * 100), y: clamp(((e.clientY - r.top) / r.height) * 100) };
}
