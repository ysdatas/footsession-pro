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

/* Moyenne d'un tableau en ignorant les valeurs absentes ET celles hors
   bornes : une donnée manifestement fausse ne doit pas tirer la
   référence de tout le groupe. Renvoie aussi les compteurs, pour dire
   honnêtement sur combien de joueurs la moyenne porte. */
function perfAverage(rows, key) {
  const all = rows.map(r => Number(r?.[key])).filter(v => Number.isFinite(v));
  const kept = all.filter(v => !isImplausible(key, v));
  if (!kept.length) return { value: null, n: 0, excluded: all.length };
  return {
    value: kept.reduce((s, v) => s + v, 0) / kept.length,
    n: kept.length,
    excluded: all.length - kept.length,
  };
}
