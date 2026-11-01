/* ============================================================
   LMFC Performance — analytics-charts.js (Bilan & Analytics)
   Graphiques Chart.js : couleurs, chiffres sur les barres, et les
   trois formes utilisées — classement horizontal, colonnes par mois,
   barre découpée (types de procédés). Chargé avant analytics-page.js.
   ============================================================ */

// Couleur du club (theme.js) : les graphiques suivent l'interface.
const CSS_VARS = getComputedStyle(document.documentElement);
const GOLD = CSS_VARS.getPropertyValue('--gold').trim() || '#E8B20E';
const GOLD_L = CSS_VARS.getPropertyValue('--gold-light').trim() || '#F6D35B';
// Classements : la valeur en tête en or, les autres en gris (contraste ≥ 3:1 sur la carte),
// chaque barre porte son chiffre. Types de procédés : trois couleurs distinctes, vérifiées
// pour les daltonismes (validateur dataviz, fond #1C1C1C). Grille discrète.
const GRID = 'rgba(255,255,255,.07)', TXT = '#959595', SURFACE = '#1C1C1C', MUTED = '#707070';
const TYPE_COLORS = { Jeu: '#C98500', Exercice: '#E05A6B', Situation: '#3987E5' };
const TYPE_OTHER = '#8A8A8A';
let charts = {};

/* ---------- Constructeurs de graphiques ---------- */
const labelsOf = rows => rows.map(r => r.label);
const valuesOf = rows => rows.map(r => Number(r.c));

function make(id, config) {
  charts[id]?.destroy();
  const el = document.getElementById(id);
  if (el) charts[id] = new Chart(el, config);
}
const noLegend = { plugins: { legend: { display: false } }, maintainAspectRatio: false };
const fr = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

/* Chiffre au bout de chaque barre (ou au centre d'un segment) : on lit la valeur sans l'axe. */
const valueLabels = {
  id: 'valueLabels',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts?.display) return;
    const { ctx } = chart, horiz = chart.options.indexAxis === 'y';
    ctx.save();
    ctx.font = `500 ${opts.size || 12}px 'IBM Plex Mono', ui-monospace, monospace`;
    chart.data.datasets.forEach((ds, di) => {
      if (ds.noValueLabel) return;   // repère (ex. RPE attendue) : pas d'étiquette
      chart.getDatasetMeta(di).data.forEach((el, i) => {
        const v = Number(ds.data[i]);
        if (!v) return;
        const txt = opts.format ? opts.format(v, ds, i) : fr(v) + (opts.suffix || '');
        if (opts.inside) {   // segment d'une barre empilée : texte centré s'il tient
          const w = Math.abs(el.x - el.base);
          if (ctx.measureText(txt).width + 12 > w) return;
          ctx.fillStyle = opts.insideColor || '#0A0A0A'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(txt, (el.x + el.base) / 2, el.y);
          return;
        }
        ctx.fillStyle = opts.color || TXT;
        if (horiz) { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, el.x + 6, el.y); }
        else { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(txt, el.x, el.y - 4); }
      });
    });
    ctx.restore();
  },
};

/* Apparence commune : police de l'interface, info-bulle sombre, chiffres en Plex Mono. */
function setChartDefaults() {
  Chart.register(valueLabels);
  Chart.defaults.color = TXT;
  Chart.defaults.font.family = "'IBM Plex Sans', -apple-system, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.borderColor = GRID;
  Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor: '#242424', borderColor: '#3a3a3a', borderWidth: 1, cornerRadius: 6, padding: 10,
    titleColor: '#F5F5F5', bodyColor: '#F5F5F5', displayColors: false,
    titleFont: { weight: '600' }, bodyFont: { family: "'IBM Plex Mono', ui-monospace, monospace" },
  });
}
// Axe des catégories : sans grille ; axe des valeurs : discret, depuis zéro (les chiffres sont sur les barres).
const catAxis = { grid: { display: false }, border: { color: '#2A2A2A' }, ticks: { color: TXT } };
const valAxis = { beginAtZero: true, grid: { color: GRID }, border: { display: false }, ticks: { display: false }, grace: '12%' };
// La plus grande valeur en or, les autres en gris.
const highlight = (rows) => { const max = Math.max(...rows.map(r => Number(r.c))); return rows.map(r => (Number(r.c) === max ? GOLD : MUTED)); };
const barSet = (rows, thick) => ({
  data: valuesOf(rows), backgroundColor: highlight(rows), hoverBackgroundColor: GOLD_L,
  borderRadius: 4, borderSkipped: 'start', maxBarThickness: thick, categoryPercentage: .72,
});

// Nom long raccourci sur l'axe (l'info-bulle garde le nom entier).
function shortLabel(value) {
  const l = String(this.getLabelForValue(value) ?? '');
  return l.length > 20 ? `${l.slice(0, 19).trimEnd()}…` : l;
}
/* Classement horizontal (principes, formats, terrains, temps par séance). */
function hbar(id, rows, suffix = '') {
  make(id, {
    type: 'bar',
    data: { labels: labelsOf(rows), datasets: [barSet(rows, 18)] },
    options: { ...noLegend, indexAxis: 'y', layout: { padding: { right: 36 } },
      plugins: { ...noLegend.plugins, valueLabels: { display: true, suffix } },
      scales: { y: { ...catAxis, ticks: { ...catAxis.ticks, autoSkip: false, callback: shortLabel } }, x: valAxis } },
  });
}
/* Séances par mois : colonnes, le mois en cours en or. */
function columns(id, rows) {
  make(id, {
    type: 'bar',
    data: { labels: labelsOf(rows), datasets: [{ ...barSet(rows, 36),
      backgroundColor: rows.map((_, i) => (i === rows.length - 1 ? GOLD : MUTED)) }] },
    options: { ...noLegend, layout: { padding: { top: 18 } },
      plugins: { ...noLegend.plugins, valueLabels: { display: true } },
      scales: { x: catAxis, y: valAxis } },
  });
}
/* Types de procédés : une barre découpée en parts, légende avec chiffres et pourcentages. */
function split(id, rows) {
  const total = rows.reduce((n, r) => n + Number(r.c), 0) || 1;
  const pct = (v) => `${Math.round(v / total * 100)} %`;
  make(id, {
    type: 'bar',
    data: { labels: [''], datasets: rows.map(r => ({
      label: `${r.label} · ${r.c} (${pct(r.c)})`, data: [Number(r.c)],
      backgroundColor: TYPE_COLORS[r.label] || TYPE_OTHER, borderColor: SURFACE, borderWidth: { right: 2 },
      borderSkipped: false, maxBarThickness: 36 })) },
    options: { maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { position: 'bottom', align: 'start', labels: { boxWidth: 12, boxHeight: 12, color: '#D0D0D0', padding: 14 } },
        tooltip: { callbacks: { label: (c) => c.dataset.label } },
        valueLabels: { display: true, inside: true, format: (v) => pct(v) } },
      scales: { x: { stacked: true, display: false, max: total }, y: { stacked: true, display: false } } },
  });
}

