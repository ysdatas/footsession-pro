/* ============================================================
   FootSession Pro — procedure-time.js
   Source unique de vérité pour les temps d'un procédé.
   Utilisé par l'éditeur de séance, les deux exports PDF et
   Analytics, afin qu'un même procédé n'affiche jamais deux
   durées différentes selon l'écran.
   ============================================================ */

const PROC_TYPES = ['Jeu', 'Exercice', 'Situation'];

/* Nombre saisi et exploitable, sinon 0. Les champs du formulaire
   peuvent valoir '', null ou undefined selon le chemin de saisie. */
function numOr0(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* Temps ballon : la structure en séquences fait référence dès qu'elle
   est renseignée ; sinon on retombe sur la durée saisie à la main. */
function workMin(p) {
  const seq = numOr0(p?.nb_sequences), dur = numOr0(p?.duree_sequence_min);
  if (seq && dur) return seq * dur;
  return numOr0(p?.duree_min);
}

/* Récupérations : elles s'intercalent ENTRE les séquences, il y en a
   donc une de moins que de séquences (3 × 4' + 1' = 2 récups). */
function recupMin(p) {
  const seq = numOr0(p?.nb_sequences), rec = numOr0(p?.temps_recup_min);
  if (seq > 1 && rec) return (seq - 1) * rec;
  return 0;
}

function totalMin(p) { return workMin(p) + recupMin(p); }

/* Vrai seulement si la structure en séquences est complète : sert à
   savoir si la durée du procédé est calculée ou saisie librement. */
function hasSequences(p) {
  return numOr0(p?.nb_sequences) > 0 && numOr0(p?.duree_sequence_min) > 0;
}

/* Arrondit à 0,5 près et supprime le « .0 » superflu : 4 → «4», 4.5 → «4,5». */
function fmtMin(v) {
  const n = Math.round(numOr0(v) * 2) / 2;
  return String(n).replace('.', ',');
}

/* Étiquette lisible : « 3 × 4' + 1' récup », ou « 20' » à défaut. */
function sequenceLabel(p) {
  if (!hasSequences(p)) {
    const d = numOr0(p?.duree_min);
    return d ? fmtMin(d) + "'" : '—';
  }
  const seq = numOr0(p.nb_sequences);
  const base = `${seq} × ${fmtMin(p.duree_sequence_min)}'`;
  // La récup ne s'affiche que si elle s'applique réellement, c'est-à-dire
  // dès qu'il y a au moins deux séquences (cf. recupMin).
  const rec = seq > 1 ? numOr0(p.temps_recup_min) : 0;
  return rec ? `${base} + ${fmtMin(rec)}' récup` : base;
}

/* Totaux d'une séance. */
function sessionWorkMin(procs) { return (procs || []).reduce((sum, p) => sum + workMin(p), 0); }
function sessionTotalMin(procs) { return (procs || []).reduce((sum, p) => sum + totalMin(p), 0); }

/* Exposé sur window : les pages chargent ce fichier en <script> classique,
   sans module, comme le reste de l'application. */
Object.assign(window, {
  PROC_TYPES, workMin, recupMin, totalMin, hasSequences,
  fmtMin, sequenceLabel, sessionWorkMin, sessionTotalMin,
});
