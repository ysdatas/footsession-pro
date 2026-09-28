/* ============================================================
   FootSession Pro — perf-metrics.js
   Définition unique des tests physiques : libellé, unité, précision,
   sens de progression et bornes de vraisemblance.
   Partagé par la fiche Performance et la page Comparaison pour que
   les deux ne puissent pas diverger.
   ============================================================ */

/* `better` : sens dans lequel l'écart est favorable ; null quand la
   métrique n'a pas de sens directionnel (ratio, asymétrie).
   `min`/`max` : bornes physiologiques attendues. Une valeur en dehors
   n'est PAS corrigée ni masquée — elle est signalée. Dans la pratique
   c'est une saisie dans la mauvaise colonne (un Shirado de 240 s
   atterrissant dans la colonne VIFT, par exemple).
   ponytail: bornes fixes ; passer à un écart médian absolu si les
   catégories d'âge rendent ces plages trop larges. */
const PERF_METRICS = [
  { key: 'sprint10_sec',         label: 'Sprint 10 m',  short: '10 m',   unit: 's',    digits: 2, better: 'lower',  min: 1.2,  max: 2.6 },
  { key: 'sprint40_sec',         label: 'Sprint 40 m',  short: '40 m',   unit: 's',    digits: 2, better: 'lower',  min: 4.0,  max: 8.0 },
  { key: 'five05_left_sec',      label: '505 gauche',   short: '505 G',  unit: 's',    digits: 2, better: 'lower',  min: 1.8,  max: 3.6 },
  { key: 'five05_right_sec',     label: '505 droit',    short: '505 D',  unit: 's',    digits: 2, better: 'lower',  min: 1.8,  max: 3.6 },
  { key: 'five05_avg_sec',       label: '505 moyenne',  short: '505 moy',unit: 's',    digits: 2, better: 'lower',  min: 1.8,  max: 3.6 },
  { key: 'five05_asymmetry_pct', label: 'Asymétrie 505',short: 'Asym.',  unit: '%',    digits: 1, better: null,     min: 0,    max: 40 },
  { key: 'vift_kmh',             label: '30-15 VIFT',   short: 'VIFT',   unit: 'km/h', digits: 1, better: 'higher', min: 12,   max: 25 },
  { key: 'shirado_sec',          label: 'Shirado',      short: 'Shirado',unit: 's',    digits: 0, better: 'higher', min: 5,    max: 600 },
  { key: 'sorensen_sec',         label: 'Sorensen',     short: 'Sorensen',unit: 's',   digits: 0, better: 'higher', min: 5,    max: 600 },
  { key: 'core_ratio',           label: 'Ratio Shirado / Sorensen', short: 'Ratio', unit: '', digits: 2, better: null, min: 0.1, max: 6 },
];

const MORPHO_METRICS = [
  { key: 'height_cm',    label: 'Taille',       unit: 'cm', digits: 0, better: null, min: 140, max: 215 },
  { key: 'weight_kg',    label: 'Poids',        unit: 'kg', digits: 1, better: null, min: 35,  max: 130 },
  { key: 'body_fat_pct', label: 'Masse grasse', unit: '%',  digits: 1, better: null, min: 2,   max: 40 },
];

const PERF_METRIC_BY_KEY = Object.fromEntries(
  [...PERF_METRICS, ...MORPHO_METRICS].map(m => [m.key, m])
);

/* Vrai si la valeur existe mais sort des bornes attendues. */
function isImplausible(key, value) {
  const m = PERF_METRIC_BY_KEY[key];
  if (!m || value === null || value === undefined || !Number.isFinite(Number(value))) return false;
  const v = Number(value);
  return v < m.min || v > m.max;
}

/* Écart signé d'une valeur à une référence, orienté « gain positif ».
   Renvoie null quand la comparaison n'a pas de sens. */
function perfDelta(key, value, reference) {
  const m = PERF_METRIC_BY_KEY[key];
  if (!m || !m.better) return null;
  if (value === null || reference === null) return null;
  if (!Number.isFinite(Number(value)) || !Number.isFinite(Number(reference))) return null;
  return m.better === 'lower' ? Number(reference) - Number(value) : Number(value) - Number(reference);
}

/* En dessous de ce nombre de joueurs, une moyenne n'est pas affichée :
   elle ne décrit pas un groupe et, pour un compte joueur, reviendrait à
   divulguer une valeur individuelle. Même seuil que club_test_averages(). */
const PERF_MIN_SAMPLE = 3;

/* Moyenne d'un tableau en ignorant les valeurs absentes ET celles hors
   bornes : une donnée manifestement fausse ne doit pas tirer la
   référence de tout le groupe. Renvoie aussi les compteurs, pour dire
   honnêtement sur combien de joueurs la moyenne porte.
   Attention : Number(null) vaut 0, donc on filtre les absents d'abord. */
function perfAverage(rows, key) {
  const all = rows
    .map(r => r?.[key])
    .filter(v => v !== null && v !== undefined && v !== '')
    .map(Number)
    .filter(v => Number.isFinite(v));
  const kept = all.filter(v => !isImplausible(key, v));
  const excluded = all.length - kept.length;
  if (kept.length < PERF_MIN_SAMPLE) return { value: null, n: kept.length, excluded };
  return { value: kept.reduce((s, v) => s + v, 0) / kept.length, n: kept.length, excluded };
}

/* ------------------------------------------------------------
   Constantes et utilitaires partagés par la fiche Performance,
   la page Joueurs (import Excel) et la page Comparaison.
   ------------------------------------------------------------ */
const MONTHS = ['Août','Septembre','Octobre','Novembre','Décembre','Janvier','Février','Mars','Avril','Mai','Juin'];
const STAGES = [
  { key: 'pre', label: 'Pré-saison' },
  { key: 'mid', label: 'Mi-saison' },
  { key: 'end', label: 'Fin de saison' },
];

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/* Mois de début de saison du club (août par défaut). */
function clubSeasonStartMonth(club) {
  const m = Number(String(club?.saison_start || '').slice(5, 7));
  return m >= 1 && m <= 12 ? m : 8;
}

/* Saison « 2026-2027 » d'une date. Même règle que season_key_for() en base. */
function seasonKeyFor(iso, startMonth = 8) {
  const d = iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`) : new Date();
  const y = d.getFullYear(), m = d.getMonth() + 1;
  return m >= startMonth ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/* Saison la plus récente présente dans des lignes, ou null si la colonne
   n'existe pas encore (migration non passée). */
function latestSeasonOf(rows) {
  return rows.map(r => r?.season_key).filter(s => /^\d{4}-\d{4}$/.test(s || '')).sort().at(-1) || null;
}
