/* ============================================================
   LMFC Performance — procedure-time.js
   Source unique de vérité pour les temps d'un procédé, et formats
   d'affichage communs (durées, dates au format français).
   Utilisé par l'éditeur de séance, les deux exports PDF, la page de
   partage et Analytics, afin qu'un même procédé n'affiche jamais
   deux durées différentes selon l'écran.
   Contient aussi la lecture et l'écriture d'une ligne de procédé
   (procFromRow / procRow) : relire puis réenregistrer redonne la même
   ligne (tests/procedure-rows.test.mjs).
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

/* Durée lisible, au centième près, sans zéro superflu : 4 → «4», 4.5 → «4,5», 1.25 → «1,25». */
function fmtMin(v) {
  const n = Math.round(numOr0(v) * 100) / 100;
  return String(n).replace('.', ',');
}

/* Saisie d'une durée : « 1,5 » comme « 1.5 » → 1.5 ; vide ou illisible → ''. */
function parseDecimal(v) {
  const t = String(v ?? '').trim().replace(',', '.');
  if (!t) return '';
  const n = Number(t);
  return Number.isFinite(n) ? n : '';
}
/* Valeur d'un champ de durée : virgule française ; vide reste vide. */
const decStr = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? '' : fmtMin(v));

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

/* Date ISO (2026-08-03) → format français (03/08/2026).
   On découpe la chaîne au lieu de passer par Date() : construire une date
   depuis un ISO nu la place en UTC et peut décaler d'un jour selon le
   fuseau, ce qui afficherait la veille de la séance. */
function fmtDateFr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '—');
}

/* Version longue : « lundi 3 août 2026 ». */
function fmtDateFrLong(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return iso || '—';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/* ---------- Semaines (dossiers de la liste des séances) ---------- */

/* Lundi de la semaine contenant `iso`, au format ISO.
   On travaille en date locale pure pour éviter tout décalage de fuseau. */
function mondayOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dow = (d.getDay() + 6) % 7;          // lundi = 0, dimanche = 6
  d.setDate(d.getDate() - dow);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* Numéro de semaine relatif au début de saison : la semaine de
   `saisonStart` est la Semaine 1. Les semaines antérieures reçoivent un
   numéro négatif ou nul, on les affiche alors sans numéro. */
function weekNumber(iso, saisonStart) {
  const a = mondayOf(saisonStart), b = mondayOf(iso);
  if (!a || !b) return null;
  const diff = (new Date(b) - new Date(a)) / 86400000;
  return Math.floor(diff / 7) + 1;
}

/* « lun. 3 → dim. 9 août 2026 » */
function weekRangeLabel(mondayIso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(mondayIso || ''));
  if (!m) return '—';
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const jour = (d) => d.getDate();
  const mois = (d) => d.toLocaleDateString('fr-FR', { month: 'long' });
  return sameMonth
    ? `${jour(start)} → ${jour(end)} ${mois(end)} ${end.getFullYear()}`
    : `${jour(start)} ${mois(start)} → ${jour(end)} ${mois(end)} ${end.getFullYear()}`;
}

/* Totaux d'une séance. */
function sessionWorkMin(procs) { return (procs || []).reduce((sum, p) => sum + workMin(p), 0); }
function sessionTotalMin(procs) { return (procs || []).reduce((sum, p) => sum + totalMin(p), 0); }

/* Principe de jeu : saisi une fois, au niveau de la séance
   (sessions.principes_jeu, lmfc_v3.sql). Une ancienne séance qui ne
   l'a pas encore le retrouve dans ses procédés ; un ancien procédé qui
   avait le sien le garde, les autres héritent de la séance. */
const cleanText = (t) => String(t ?? '').trim();
function sessionPrinciple(s, procs = []) {
  return cleanText(s?.principes_jeu)
    || [...new Set((procs || []).map(p => cleanText(p.principes_jeu)).filter(Boolean))].join(' · ');
}
function procPrinciple(p, s, procs = []) {
  return cleanText(p?.principes_jeu) || sessionPrinciple(s, procs);
}

/* Exposé sur window : les pages chargent ce fichier en <script> classique,
   sans module, comme le reste de l'application. */
Object.assign(window, {
  PROC_TYPES, workMin, recupMin, totalMin, hasSequences,
  fmtMin, parseDecimal, decStr, sequenceLabel, sessionWorkMin, sessionTotalMin,
  fmtDateFr, fmtDateFrLong,
  mondayOf, weekNumber, weekRangeLabel,
  sessionPrinciple, procPrinciple,
});

/* ============================================================
   Séance (lmfc_v9.sql) : statut de chaque joueur, équipes et staff
   de chaque procédé, bilan individuel. Partagé par l'éditeur, les
   deux PDF et la page de partage.
   ============================================================ */
const STATUTS = [
  { key: 'present',    label: 'Présent' },
  { key: 'reprise',    label: 'Reprise' },
  { key: 'absent',     label: 'Absent' },
  { key: 'blesse',     label: 'Blessé' },
  { key: 'selection',  label: 'Sélection' },
  { key: 'groupe_pro', label: 'Groupe pro' },
  { key: 'non_concerne', label: 'Non concerné' },   // retiré de cette séance (lmfc_v30.sql) : ne la voit plus, pas de RPE
  { key: 'autre',      label: 'Autre…' },
];
/* Plus proposés (lmfc_v12.sql) : une ancienne séance les garde et les affiche. */
const STATUTS_ANCIENS = [{ key: 'retard', label: 'Retard' }, { key: 'excuse', label: 'Excusé' }, { key: 'malade', label: 'Malade' }];
const STATUT_LABEL = Object.fromEntries([...STATUTS, ...STATUTS_ANCIENS].map(s => [s.key, s.label]));
/* Ceux qui participent : ils vont dans les équipes et le bilan.
   « Autre » (motif libre) : selon sa case « participe » (present). */
const PARTICIPE = new Set(['present', 'reprise', 'retard']);
const participe = (a) => (a.statut === 'autre' ? !!a.present : PARTICIPE.has(a.statut));
/* Libellé affiché : le motif libre pour « Autre ». */
const statutLabel = (a) => (a.statut === 'autre' ? (a.statut_libre || '').trim() || 'Autre' : STATUT_LABEL[a.statut] || a.statut || '');
/* Ancienne présence (sans statut) : présent ou absent. */
const statutOf = (row) => row?.statut || (row?.present ? 'present' : 'absent');

const BILAN_NOTES = [
  { key: 'plus',  sign: '+', label: 'Positif' },
  { key: 'egal',  sign: '=', label: 'Normal' },
  { key: 'moins', sign: '−', label: 'En difficulté' },
];

const isVideoRole = (role) => /vid[ée]o/i.test(role || '');
/* Équipes d'un procédé : les siennes. Ancienne séance (aucun procédé
   n'en a) : les chasubles déclarées pour toute la séance. */
function procTeamsOf(p, s, procedures) {
  const perProc = (procedures || []).some(x => Array.isArray(x.equipes) && x.equipes.length);
  return perProc ? (Array.isArray(p.equipes) ? p.equipes : []) : (Array.isArray(s?.equipes) ? s.equipes : []);
}
/* Procédé filmé : la séance l'est, et ce procédé n'en est pas exclu. */
const procIsFilmed = (p, s) => !!s?.filmee && p.filme !== false;

/* ---------- Lecture et écriture d'un procédé ---------- */
function cleanTeams(list) {
  return (Array.isArray(list) ? list : []).map(t => ({
    nom: t.nom || 'Équipe', couleur: t.couleur || '#1f6feb',
    player_ids: Array.isArray(t.player_ids) ? t.player_ids.map(Number) : [],
  }));
}
/* Procédé tel que lu en base (procedures + tactical_schemas). procRow fait
   l'inverse : relire puis renvoyer une ligne doit la redonner à l'identique. */
function procFromRow(p, uid) {
  const t = p.tactical_schemas || {};
  return {
    _uid: uid, id: p.id, nom: p.nom || '', duree_min: p.duree_min ?? 20,
    objectif: p.objectif || '', effectif: p.effectif || '',
    taille_terrain: p.taille_terrain || '', consignes: p.consignes || '',
    principes_jeu: p.principes_jeu || '', comportements_individuels: p.comportements_individuels || '',
    temps_recup_min: p.temps_recup_min ?? '',
    type_procede: p.type_procede || '', nb_sequences: p.nb_sequences ?? '',
    duree_sequence_min: p.duree_sequence_min ?? '',
    image_path: t.image_path || null, video_id: t.video_id || null, expanded: false,
    image_v: t.updated_at ? Date.parse(t.updated_at) : null,   // version de l'image (lmfc_v17.sql)
    has_canvas: !!t.canvas_json,   // faux : image importée (importSchemaImage)
    equipes: cleanTeams(p.equipes), staff: Array.isArray(p.staff) ? p.staff : [], filme: p.filme ?? null,
    // Vidéo de la bibliothèque (lmfc_v25.sql) : liée par session-library.js, jamais renvoyée par procRow.
    library_item_id: p.library_item_id ?? null, library_version_id: p.library_version_id ?? null, library_titre: p.library_titre || '',
  };
}
/* Ligne d'un procédé telle qu'envoyée à la base (et comparée à la dernière enregistrée). */
function procRow(p, sid, ordre) {
  return {
    session_id: sid, ordre, nom: (p.nom || '').trim() || 'Procédé', duree_min: p.duree_min || 0,
    objectif: p.objectif || null, effectif: p.effectif || null,
    taille_terrain: p.taille_terrain || null, consignes: p.consignes || null,
    principes_jeu: p.principes_jeu || null, comportements_individuels: p.comportements_individuels || null,
    temps_recup_min: p.temps_recup_min === '' ? null : p.temps_recup_min,
    type_procede: p.type_procede || null,
    nb_sequences: p.nb_sequences === '' ? null : p.nb_sequences,
    duree_sequence_min: p.duree_sequence_min === '' ? null : p.duree_sequence_min,
    equipes: (p.equipes || []).map(t => ({ nom: (t.nom || '').trim() || 'Équipe', couleur: t.couleur, player_ids: t.player_ids })),
    staff: (p.staff || []).map(m => ({ nom: (m.nom || '').trim(), role: (m.role || '').trim() })).filter(m => m.nom || m.role),
    filme: p.filme === false ? false : null,
  };
}

/* Égalité de valeurs telles que relues en base : nombres « 90 » / « 90.00 »,
   objets jsonb dont l'ordre des clés change. */
function sameValue(a, b) {
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  if (typeof a === 'object' || typeof b === 'object') {
    if (typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => sameValue(a[k], b[k]));
  }
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a) === String(b);
}
