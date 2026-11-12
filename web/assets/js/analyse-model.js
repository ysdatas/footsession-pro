/* ============================================================
   LMFC Performance — analyse-model.js
   Onglet Analyse de la fiche joueur : référentiel de codage et filtres,
   sans DOM ni base (testé : tests/analyse-logic.test.mjs).

   Un clip = une séquence (video_sequences) + son codage (sequence_codes,
   lmfc_v48.sql) + le poste et le lieu de sa vidéo (player_videos).
   Six actions, trois par espace (AN_ACTIONS). Filtres :
     { general: {clé: [valeurs]}, passe: {…}, tir: {…}, … }
     - general s'applique à tout ; ceux d'une action à elle seule ;
     - clés différentes : ET ; valeurs d'une même clé : OU ; liste vide : tout ;
     - une information inconnue (null) ne correspond à aucune valeur choisie.
   Les valeurs se comparent en texte (les <select> rendent du texte).
   ============================================================ */

/* Zones fonctionnelles : nom du schéma du club et, s'il diffère, ancien nom
   (même zone, même clé en base). Ordre : de notre but vers celui d'en face. */
const AN_ZONE_NAMES = {
  initiation: ['Arrière', 'Initiation'], base: ['Zone 1', 'Base'], carre: ['Zone 2', 'Carré'],
  couloir_droit: ['Large droite', 'Couloir droit'], couloir_gauche: ['Large gauche', 'Couloir gauche'],
  profondeur_droite: ['Profondeur droite', null], axe: ['Profondeur axiale', 'Axe'], profondeur_gauche: ['Profondeur gauche', null],
};
const AN_ZONES = Object.entries(AN_ZONE_NAMES).map(([k, [name, old]]) => [k, old ? `${name} (${old})` : name]);
const AN_TIERS = [['1', '1er tiers'], ['2', '2e tiers'], ['3', '3e tiers']];
const AN_COTE = [['droit', 'Droit'], ['gauche', 'Gauche']];
const AN_TOUCHES = [['1', '1 touche'], ['2', '2 touches'], ['3', '3 touches ou plus']];
/* Lignes ADVERSES cassées par une passe : rien à voir avec le filtre « Ligne » (1 à 4). */
const AN_LIGNES = [['aucune', 'Aucune ligne cassée'], ['premiere', 'Première ligne adverse'], ['mediane', 'Ligne médiane'],
  ['derniere', 'Dernière ligne'], ['plusieurs', 'Plusieurs lignes']];
const AN_PASSE_RES = [['ok', 'Réussie'], ['ko', 'Ratée']], AN_CENTRE_RES = [['ok', 'Réussi'], ['ko', 'Raté']], AN_DUEL_RES = [['ok', 'Gagné'], ['ko', 'Perdu']];
const AN_TIR_RES = [['but', 'But'], ['cadre', 'Cadré'], ['non_cadre', 'Non cadré'], ['contre', 'Contré']];
const anF = (key, label, values) => ({ key, label, values });
const AN_HAUTEUR = anF('tiers_depart', 'Hauteur du terrain', AN_TIERS);

/* Filtres du bandeau (menus déroulants), dans l'ordre d'affichage. Pas de résultat ici : chaque action a le sien. */
const AN_GENERAL = [
  anF('periode', 'Mi-temps', [['1', '1re mi-temps'], ['2', '2e mi-temps']]),
  anF('poste', 'Poste', ['DC', 'DD', 'DG', 'MC', 'MR', 'MOC', 'BU', 'AID', 'AIG', 'LG', 'LD'].map(p => [p, p])),
  anF('ligne', 'Ligne', [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]),
  anF('nb_attaquants', "Nbre d'attaquants", [['1', '1'], ['2', '2'], ['3', '3']]),
  anF('pression', 'Pressing', [['true', 'Sous pression'], ['false', 'Sans pression']]),
  anF('lieu', 'Lieu du match', [['domicile', 'Domicile'], ['exterieur', 'Extérieur']]),
];

/* Les six actions. res : résultats possibles (aucun pour une récupération) ;
   filters : ses menus déroulants ; more : champs codés et mis en tableau, sans menu ;
   xy2 : l'action a un point d'arrivée. */
const AN_ACTIONS = {
  passe: { space: 'ballon', label: 'Passes', one: 'Passe', res: AN_PASSE_RES, xy2: true, filters: [
    anF('resultat', 'Passe / Résultat', AN_PASSE_RES),
    anF('direction', 'Sens de passe', [['verticale', 'Verticale'], ['horizontale', 'Horizontale'], ['retrait', 'Retrait']]),
    anF('distance', 'Type de passe', [['courte', 'Courte'], ['longue', 'Longue'], ['profondeur', 'Profondeur']]),
    anF('touches', 'Touches', AN_TOUCHES), anF('pied', 'Pied', AN_COTE),
    anF('zone_depart', 'Zone départ', AN_ZONES), anF('zone_arrivee', 'Zone arrivée', AN_ZONES), AN_HAUTEUR],
    more: [anF('tiers_arrivee', "Hauteur à l'arrivée", AN_TIERS), anF('lignes', 'Lignes cassées', AN_LIGNES)] },
  tir: { space: 'ballon', label: 'Tirs', one: 'Tir', res: AN_TIR_RES, filters: [
    anF('resultat', 'Résultat', AN_TIR_RES),
    anF('categorie', 'Zone de tir', [['surface', 'Dans la surface'], ['hors_surface', 'Hors de la surface'], ['six_metres', 'Dans les 5,50 m']]),
    anF('pied', 'Pied', AN_COTE), anF('touches', 'Touches', AN_TOUCHES), AN_HAUTEUR] },
  centre: { space: 'ballon', label: 'Centres', one: 'Centre', res: AN_CENTRE_RES, xy2: true, filters: [
    anF('couloir', 'Couloir', AN_COTE), anF('pied', 'Pied', AN_COTE),
    anF('categorie', 'Type de centre', [['tendu', 'Centre tendu'], ['aerien', 'Centre aérien'], ['retrait', 'Centre en retrait']]),
    anF('resultat', 'Résultat', AN_CENTRE_RES), AN_HAUTEUR] },
  duel_sol: { space: 'sans', label: 'Duels terrestres', one: 'Duel terrestre', res: AN_DUEL_RES, filters: [
    anF('categorie', 'Type de duel', [['interception', 'Interception'], ['marquage', 'Marquage'], ['couverture', 'Couverture'],
      ['anticipation', 'Anticipation'], ['1c1', '1c1'], ['retour_defensif', 'Retour défensif']]),
    anF('resultat', 'Résultat', AN_DUEL_RES), anF('zone_depart', 'Lieu du duel', AN_ZONES), AN_HAUTEUR] },
  duel_air: { space: 'sans', label: 'Duels aériens', one: 'Duel aérien', res: AN_DUEL_RES, filters: [
    anF('categorie', 'Contexte', [['cpa', 'CPA'], ['relance_adverse', 'Relance adverse'], ['degagement', 'Dégagement'], ['gestion_profondeur', 'Gestion de la profondeur']]),
    anF('intervention', "Type d'intervention", [['marquage', 'Marquage'], ['couverture', 'Couverture'], ['anticipation', 'Anticipation'], ['interception', 'Interception']]),
    anF('resultat', 'Résultat', AN_DUEL_RES), AN_HAUTEUR],
    more: [anF('zone_depart', 'Lieu du duel', AN_ZONES)] },
  recuperation: { space: 'sans', label: 'Récupérations', one: 'Récupération', res: [], filters: [AN_HAUTEUR] },
};

/* Champs qu'une action peut porter : les autres sont vidés à l'enregistrement
   (la base refuserait le mélange). Sans action : le contexte seul. */
const AN_CODE_FIELDS = ['action', 'resultat', 'periode', 'ligne', 'nb_attaquants', 'pression', 'direction', 'touches', 'distance', 'pied', 'couloir',
  'intervention', 'lignes', 'zone_depart', 'zone_arrivee', 'tiers_depart', 'tiers_arrivee', 'x1', 'y1', 'x2', 'y2', 'categorie', 'minute_match', 'tags'];
const AN_COMMON_KEYS = ['action', 'periode', 'ligne', 'nb_attaquants', 'pression', 'minute_match', 'x1', 'y1', 'tags'];
function anFields(action) {
  const A = AN_ACTIONS[action];
  return A ? [...AN_COMMON_KEYS, ...[...A.filters, ...(A.more || [])].map(d => d.key), ...(A.xy2 ? ['x2', 'y2'] : [])] : AN_COMMON_KEYS;
}

function anLabel(list, value) { return list.find(([v]) => v === String(value))?.[1] ?? String(value ?? ''); }

/* Tiers : celui codé, sinon celui du point. x de 0 à 100 de gauche à droite,
   on attaque vers la GAUCHE (comme le schéma des zones) : notre but est à x = 100.
   Sans l'un ni l'autre : inconnu. */
function anTier(x) { return x == null ? null : x > 200 / 3 ? 1 : x > 100 / 3 ? 2 : 3; }

/* Zone d'un tir d'après son point (but adverse à x = 0, terrain de 105 × 68 m). */
function anShotZone(x, y) {
  if (x == null || y == null) return null;
  const mx = x * 1.05, dy = Math.abs(y * 0.68 - 34);
  return mx <= 5.5 && dy <= 9.15 ? 'six_metres' : mx <= 16.5 && dy <= 20.15 ? 'surface' : 'hors_surface';
}

/* Valeur d'un champ : celle codée ; sinon, là où un point ou notre convention
   la donne, la valeur déduite ; sinon inconnue.
   Convention du club : une passe vers le Carré vise la ligne médiane adverse
   (franchie si la passe est réussie, simple tentative si elle est ratée). */
function anValue(clip, key) {
  if (key === 'tiers_depart') return clip.tiers_depart ?? anTier(clip.x1);
  if (key === 'tiers_arrivee') return clip.tiers_arrivee ?? anTier(clip.x2);
  if (key === 'lignes') return clip.lignes ?? (clip.action === 'passe' && clip.zone_arrivee === 'carre' ? 'mediane' : null);
  if (key === 'categorie' && clip.action === 'tir') return clip.categorie ?? anShotZone(clip.x1, clip.y1);
  return clip[key];
}

function anPass(clip, filters) {
  for (const [key, vals] of Object.entries(filters || {})) {
    if (!vals?.length) continue;
    if (key === 'tags') { if (!vals.some(t => clip.tags?.includes(t))) return false; continue; }
    const v = anValue(clip, key);
    if (v == null || !vals.includes(String(v))) return false;
  }
  return true;
}

/* Les clips d'une action : les filtres généraux, puis les siens. */
function anActionClips(clips, filters, action) {
  return clips.filter(c => c.action === action && anPass(c, filters.general) && anPass(c, filters[action]));
}

/* Décompte par résultat (ok, ko, but…), total et % de réussite (ok sur ok + ko). */
function anCount(list) {
  const by = {};
  for (const c of list) if (c.resultat) by[c.resultat] = (by[c.resultat] || 0) + 1;
  const ok = by.ok || 0, ko = by.ko || 0;
  return { ...by, ok, ko, total: list.length, pct: ok + ko ? Math.round((ok / (ok + ko)) * 1000) / 10 : null };
}

/* Répartition d'une liste selon un champ : une ligne par valeur du référentiel,
   puis « Non renseigné » s'il y en a (jamais rangé d'office dans une valeur). */
function anBreakdown(list, key, values) {
  const of = (v) => list.filter(c => String(anValue(c, key) ?? '') === v);
  const rows = values.map(([v, label]) => ({ value: v, label, ...anCount(of(v)) })), unknown = of('');
  return unknown.length ? [...rows, { value: '', label: 'Non renseigné', ...anCount(unknown) }] : rows;
}

function anEmptyFilters() { return { general: {}, ...Object.fromEntries(Object.keys(AN_ACTIONS).map(a => [a, {}])) }; }

/* Ajoute ou retire une valeur d'un filtre, sans toucher aux autres. */
function anToggle(filters, level, key, value) {
  const vals = new Set(filters[level][key] || []);
  if (vals.has(value)) vals.delete(value); else vals.add(value);
  if (vals.size) filters[level][key] = [...vals]; else delete filters[level][key];
}

/* Fusion des lignes lues en base : un clip par séquence. */
function anMerge(videos, seqs, codes) {
  const byVideo = new Map(videos.map(v => [v.id, v])), bySeq = new Map(codes.map(c => [c.sequence_id, c]));
  return seqs.filter(s => byVideo.has(s.video_id)).map(s => {
    const v = byVideo.get(s.video_id), c = bySeq.get(s.id) || {};
    const { id: _codeId, sequence_id: _s, player_id: _p, club_id: _c, ...code } = c;
    return { ...code, tags: c.tags || [], id: s.id, video_id: s.video_id, club_id: s.club_id, label: s.label,
      start_sec: Number(s.start_sec), end_sec: Number(s.end_sec), video_title: v.titre, poste: v.poste ?? null, lieu: v.lieu ?? null, coded: !!c.action };
  });
}

/* ---------- Timeline (analyse-timeline.js) ---------- */

/* Une ligne par action, puis les clips pas encore codés. */
const AN_LANES = [...Object.entries(AN_ACTIONS).map(([a, A]) => [a, A.label]), ['todo', 'À coder']];
function anLane(clip) { return clip.action || 'todo'; }

/* Clips pris dans un rectangle : la plage de temps [t0, t1] (dans un sens ou l'autre) sur ces lignes. */
function anInRect(clips, t0, t1, lanes) {
  const a = Math.min(t0, t1), b = Math.max(t0, t1);
  return clips.filter(c => c.end_sec > a && c.start_sec < b && lanes.includes(anLane(c))).map(c => c.id);
}

/* Montage : tous les clips bout à bout, sans les trous, vidéo après vidéo (ordre des titres :
   « 02 » avant « 10 »), puis dans l'ordre du temps. Rend [{ clip, at, dur }] : at = position
   du clip dans le montage, en secondes. Raccourcir un clip avance donc tous les suivants. */
function anMontage(clips, videos) {
  const rank = new Map([...videos].sort((a, b) => String(a.titre).localeCompare(String(b.titre), 'fr', { numeric: true }) || a.id - b.id).map((v, i) => [v.id, i]));
  let at = 0;
  return clips.filter(c => c.end_sec > c.start_sec && rank.has(c.video_id))
    .sort((a, b) => rank.get(a.video_id) - rank.get(b.video_id) || a.start_sec - b.start_sec || a.id - b.id)
    .map(clip => { const item = { clip, at, dur: clip.end_sec - clip.start_sec }; at += item.dur; return item; });
}

/* Un bord de clip tiré à la souris jusqu'au temps t de sa vidéo : nouveau découpage, d'au moins
   min secondes, entre 0 et max (durée de la vidéo quand on la connaît). L'autre bord ne bouge pas. */
function anTrim(clip, edge, t, max = Infinity, min = 0.5) {
  const r = (x) => Math.round(x * 100) / 100;
  return edge === 'start' ? { start_sec: r(Math.min(Math.max(0, t), clip.end_sec - min)), end_sec: clip.end_sec }
    : { start_sec: clip.start_sec, end_sec: r(Math.max(Math.min(t, max), clip.start_sec + min)) };
}

/* Graduations : le plus petit pas « rond » qui en laisse une douzaine par écran. */
function anTicks(duration, zoom) {
  const step = [5, 10, 30, 60, 120, 300, 600, 900].find(s => duration / zoom / s <= 12) || 1800;
  return Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step);
}

/* Ce qu'une modification groupée peut proposer. Le contexte, toujours. Les champs d'une
   action seulement si tous les clips la partagent. L'action elle-même seulement si aucun
   n'est codé : celle d'un clip déjà codé ne se change jamais en groupe (la base le refuse aussi). */
function anBulkScope(clips) {
  const acts = [...new Set(clips.map(c => c.action || null))];
  return { setAction: acts.length === 1 && acts[0] === null, action: acts.length === 1 ? acts[0] : null };
}

function anPct(pct) { return pct == null ? '–' : `${String(pct).replace('.', ',')} %`; }
function anTone(pct) { return pct == null ? 'na' : pct >= 75 ? 'good' : pct >= 50 ? 'mid' : 'bad'; }

/* Clip posé sur la piste d'une autre action (null : « À coder »). Rien n'est converti : le résultat
   et la sous-famille changent de sens d'une action à l'autre (« Gagné » d'un duel n'est pas
   « Réussi » d'un centre), ils partent, comme les champs que la nouvelle action ne porte pas.
   Restent : vidéo et minutage (hors codage), contexte, point de départ, champs partagés, tags.
   Rend { code, lost } : le codage à écrire, et les clés retirées, à annoncer AVANT d'écrire. */
function anMoveCode(clip, to) {
  const keep = anFields(to), code = { action: to, tags: [...(clip.tags || [])] }, lost = [];
  for (const k of AN_CODE_FIELDS) {
    if (k === 'action' || k === 'tags') continue;
    const drop = !keep.includes(k) || k === 'resultat' || k === 'categorie';
    code[k] = drop ? null : clip[k] ?? null;
    if (drop && clip[k] != null) lost.push(k);
  }
  return { code, lost };
}
/* Le codage du clip est-il encore exactement celui-ci (tags à part) ? Défaire n'écrase rien de plus récent. */
function anSameCode(clip, code) { return AN_CODE_FIELDS.every(k => k === 'tags' || String(clip[k] ?? '') === String(code[k] ?? '')); }
