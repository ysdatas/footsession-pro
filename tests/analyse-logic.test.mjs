/* Onglet Analyse (web/assets/js/analyse-model.js) : la logique des filtres.
   Filtres généraux sur les deux espaces, filtres d'une action sur elle seule
   (un filtre de passes ne change ni les tirs, ni les centres, ni les duels),
   OU dans un critère, ET entre critères, inconnu jamais deviné, lignes cassées.
   Lancement : node tests/analyse-logic.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
vm.runInContext(readFileSync('web/assets/js/analyse-model.js', 'utf8'), ctx);
// Copie JSON : les tableaux du contexte vm n'ont pas le même prototype (deepStrictEqual).
const run = (code) => JSON.parse(JSON.stringify(vm.runInContext(code, ctx)) ?? 'null');
const ids = (list) => list.map(c => c.id);

/* Vidéos, séquences et codages tels que lus en base. */
const videos = [{ id: 1, titre: 'Match A', poste: 'MC', lieu: 'domicile' }, { id: 2, titre: 'Match B', poste: 'DC', lieu: 'exterieur' }];
const seq = (id, video_id) => ({ id, video_id, club_id: 1, label: `S${id}`, start_sec: id, end_sec: id + 5 });
const seqs = [1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 1].map((v, i) => seq(10 + i, v));
const ctxA = { periode: 1, ligne: 2, pression: true };   // contexte du test 1
const codes = [
  { sequence_id: 10, action: 'passe', resultat: 'ok', ...ctxA, direction: 'horizontale', touches: 1, distance: 'longue', zone_depart: 'base', zone_arrivee: 'couloir_droit', x1: 20, y1: 40, x2: 70, y2: 90, tags: ['Prise d\'information'] },
  { sequence_id: 11, action: 'passe', resultat: 'ko', ...ctxA, direction: 'verticale', touches: 2, distance: 'courte', zone_depart: 'carre', tiers_depart: 2, tags: [] },
  { sequence_id: 12, action: 'passe', resultat: 'ok', periode: 2, direction: 'horizontale', touches: 1, distance: 'longue', zone_depart: 'base', zone_arrivee: 'couloir_droit', tags: [] },
  { sequence_id: 13, action: 'duel_sol', resultat: 'ok', ...ctxA, categorie: 'interception', x1: 30, y1: 50, tags: ['Anticipation'] },
  { sequence_id: 14, action: 'duel_sol', resultat: 'ko', ...ctxA, categorie: 'retour_defensif', tags: ['Anticipation'] },
  { sequence_id: 15, action: 'duel_air', resultat: 'ok', ...ctxA, categorie: 'gestion_profondeur', x1: 80, y1: 20, tags: [] },
  { sequence_id: 16, action: 'duel_sol', resultat: 'ok', ...ctxA, categorie: 'marquage', tags: [] },   // vidéo 2 : DC, extérieur
  { sequence_id: 17, action: 'duel_air', resultat: 'ko', ...ctxA, categorie: 'gestion_profondeur', tags: [] },
  // séquence 18 : pas codée
  { sequence_id: 19, action: 'tir', resultat: 'but', ...ctxA, pied: 'droit', touches: 1, x1: 4, y1: 50, tags: [] },             // point dans les 5,50 m
  { sequence_id: 20, action: 'tir', resultat: 'non_cadre', ...ctxA, categorie: 'hors_surface', pied: 'gauche', tags: [] },
  { sequence_id: 21, action: 'centre', resultat: 'ok', ...ctxA, couloir: 'droit', categorie: 'tendu', x1: 10, y1: 5, x2: 8, y2: 50, tags: [] },
  { sequence_id: 22, action: 'recuperation', ...ctxA, tiers_depart: 2, tags: [] },
  { sequence_id: 23, action: 'recuperation', ...ctxA, tags: [] },                                                           // hauteur inconnue
];
ctx.CLIPS = run(`anMerge(${JSON.stringify(videos)}, ${JSON.stringify(seqs)}, ${JSON.stringify(codes)})`);
ctx.F = run('anEmptyFilters()');
const act = (a) => ids(run(`anActionClips(CLIPS, F, '${a}')`));
const space = (s) => (s === 'ballon' ? act('passe') : [...act('duel_sol'), ...act('duel_air')].sort((a, b) => a - b));
const others = () => ['tir', 'centre', 'recuperation'].map(act);
const set = (level, key, vals) => { if (vals) ctx.F[level][key] = vals; else delete ctx.F[level][key]; };

assert.equal(ctx.CLIPS.length, 14);
assert.deepEqual(ctx.CLIPS.filter(c => !c.coded).map(c => c.id), [18], 'la séquence non codée reste à coder');
assert.deepEqual(space('ballon'), [10, 11, 12]);
assert.deepEqual(space('sans'), [13, 14, 15, 16, 17]);
assert.deepEqual(others(), [[19, 20], [21], [22, 23]]);

// Test 1 : 1re mi-temps, MC, ligne 2, sous pression, domicile : les deux espaces suivent.
for (const [k, v] of [['periode', '1'], ['poste', 'MC'], ['ligne', '2'], ['pression', 'true'], ['lieu', 'domicile']]) set('general', k, [v]);
assert.deepEqual(space('ballon'), [10, 11], 'test 1 : passes');
assert.deepEqual(space('sans'), [13, 14, 15], 'test 1 : duels (le DC à l\'extérieur et le duel sans contexte sortent)');
assert.deepEqual(run("anCount([...anActionClips(CLIPS, F, 'duel_sol'), ...anActionClips(CLIPS, F, 'duel_air')])"), { ok: 2, ko: 1, total: 3, pct: 66.7 }, 'statistiques = même liste');

// Test 2 : passe horizontale, 1 touche, longue, départ base, arrivée couloir droit.
for (const [k, v] of [['direction', 'horizontale'], ['touches', '1'], ['distance', 'longue'], ['zone_depart', 'base'], ['zone_arrivee', 'couloir_droit']]) set('passe', k, [v]);
assert.deepEqual(space('ballon'), [10], 'test 2');

// Test 7 : les filtres de passe ne touchent ni SANS BALLON, ni les tirs, ni les centres.
assert.deepEqual(space('sans'), [13, 14, 15], 'test 7');
assert.deepEqual(others(), [[19, 20], [21], [22, 23]], 'test 7 : tirs, centres, récupérations');

// Test 3 : terrain, Base puis Carré (OU) au départ.
ctx.F.passe = {};
run("anToggle(F, 'passe', 'zone_depart', 'base'); anToggle(F, 'passe', 'zone_depart', 'carre')");
assert.deepEqual([...ctx.F.passe.zone_depart], ['base', 'carre']);
assert.deepEqual(space('ballon'), [10, 11], 'test 3');
run("anToggle(F, 'passe', 'zone_depart', 'carre')");
assert.deepEqual(space('ballon'), [10], 'recliquer une zone la retire');
run("anToggle(F, 'passe', 'zone_depart', 'base')");
assert.equal(ctx.F.passe.zone_depart, undefined, 'plus de zone : plus de filtre');

// Test 4 : Interception et Retour défensif.
set('duel_sol', 'categorie', ['interception', 'retour_defensif']);
assert.deepEqual(act('duel_sol'), [13, 14], 'test 4');
assert.deepEqual(act('duel_air'), [15], 'test 4 : le type de duel terrestre ne filtre pas les aériens');

// Test 5 : Gestion de la profondeur + Gagné (le résultat est propre à chaque action).
set('duel_air', 'categorie', ['gestion_profondeur']);
set('duel_air', 'resultat', ['ok']);
assert.deepEqual(act('duel_air'), [15], 'test 5');
assert.deepEqual(run("anCount(anActionClips(CLIPS, F, 'duel_air'))"), { ok: 1, ko: 0, total: 1, pct: 100 });
assert.deepEqual(space('ballon'), [10, 11], 'test 5 : « Gagné » sur les duels aériens ne retire aucune passe');

// Test 8 : réinitialisation.
ctx.F = run('anEmptyFilters()');
assert.deepEqual(space('ballon'), [10, 11, 12], 'test 8 : passes');
assert.deepEqual(space('sans'), [13, 14, 15, 16, 17], 'test 8 : duels');

// Test 6 : un tag porté par plusieurs clips ; plusieurs tags = OU.
set('general', 'tags', ['Anticipation']);
assert.deepEqual([...space('ballon'), ...space('sans')], [13, 14], 'test 6');
set('general', 'tags', ['Anticipation', 'Prise d\'information']);
assert.deepEqual([...space('ballon'), ...space('sans')], [10, 13, 14]);
assert.deepEqual(others(), [[], [], []], 'les tags du bandeau filtrent aussi tirs, centres, récupérations');
set('general', 'tags', null);

/* Tiers : codé, sinon lu sur x ; sinon inconnu (jamais inventé). */
set('passe', 'tiers_depart', ['3']);
assert.deepEqual(space('ballon'), [10], 'x = 20, on attaque vers la gauche : 3e tiers');
set('passe', 'tiers_depart', ['2']);
assert.deepEqual(space('ballon'), [11], 'tiers codé');
set('passe', 'tiers_depart', null);
assert.deepEqual(['anTier(null)', 'anTier(0)', 'anTier(33.3)', 'anTier(33.4)', 'anTier(66.6)', 'anTier(66.7)', 'anTier(100)'].map(run),
  [null, 3, 3, 2, 2, 1, 1], 'notre but à x = 100 : 1er tiers à droite');

/* Inconnu ≠ n'importe quelle valeur. */
set('general', 'ligne', ['2']);
assert.ok(!space('ballon').includes(12), 'ligne non codée : exclue dès qu\'on filtre la ligne');

/* Répartition et libellés. */
ctx.F = run('anEmptyFilters()');
const rows = run(`anBreakdown(anActionClips(CLIPS, F, 'passe'), 'direction', AN_ACTIONS.passe.filters[1].values)`);
assert.deepEqual(rows.map(r => [r.value, r.total, r.ok]), [['verticale', 1, 0], ['horizontale', 2, 2], ['retrait', 0, 0]]);
/* Zones : nom du schéma du club, puis l'ancien nom ; mêmes clés en base. */
assert.deepEqual(run('AN_ZONES.map(z => z[1])'), ['Arrière (Initiation)', 'Zone 1 (Base)', 'Zone 2 (Carré)', 'Large droite (Couloir droit)',
  'Large gauche (Couloir gauche)', 'Profondeur droite', 'Profondeur axiale (Axe)', 'Profondeur gauche']);
assert.equal(run("anLabel(AN_ZONES, 'carre')"), 'Zone 2 (Carré)');

/* SANS BALLON : le lieu (zone cliquée sur son terrain) ne touche pas AVEC BALLON. */
ctx.F = run('anEmptyFilters()');
codes.find(c => c.sequence_id === 13).zone_depart = 'base';
ctx.CLIPS = run(`anMerge(${JSON.stringify(videos)}, ${JSON.stringify(seqs)}, ${JSON.stringify(codes)})`);
set('duel_sol', 'zone_depart', ['base']);
assert.deepEqual(act('duel_sol'), [13], 'duels en Zone 1 (Base)');
assert.deepEqual(space('ballon'), [10, 11, 12], 'les passes ne bougent pas');
assert.deepEqual(['anTone(null)', 'anTone(75)', 'anTone(66.7)', 'anTone(37)'].map(run), ['na', 'good', 'mid', 'bad']);


/* Tirs : 4 résultats, zone de tir codée sinon lue sur le point. */
ctx.F = run('anEmptyFilters()');
assert.deepEqual(run("anCount(anActionClips(CLIPS, F, 'tir'))"), { but: 1, non_cadre: 1, ok: 0, ko: 0, total: 2, pct: null }, 'un tir n\'a pas de % de réussite');
set('tir', 'categorie', ['six_metres']);
assert.deepEqual(act('tir'), [19], 'x = 4, y = 50 : dans les 5,50 m');
assert.deepEqual(['anShotZone(null, 5)', 'anShotZone(4, 50)', 'anShotZone(10, 50)', 'anShotZone(10, 5)', 'anShotZone(40, 50)'].map(run),
  [null, 'six_metres', 'surface', 'hors_surface', 'hors_surface']);
set('tir', 'categorie', null);
set('tir', 'pied', ['gauche']);
assert.deepEqual([act('tir'), space('ballon'), act('centre')], [[20], [10, 11, 12], [21]], 'le pied des tirs ne filtre que les tirs');

/* Récupérations : la hauteur inconnue reste « Non renseigné », jamais rangée dans un tiers. */
ctx.F = run('anEmptyFilters()');
assert.deepEqual(run("anBreakdown(anActionClips(CLIPS, F, 'recuperation'), 'tiers_depart', AN_TIERS)").map(r => [r.label, r.total]),
  [['1er tiers', 0], ['2e tiers', 1], ['3e tiers', 0], ['Non renseigné', 1]]);

/* Lignes cassées : codée, sinon une passe vers le Carré vise la médiane ; ratée = tentative (ko), pas un franchissement. */
codes.find(c => c.sequence_id === 10).zone_arrivee = 'carre';                       // réussie, vers le Carré
Object.assign(codes.find(c => c.sequence_id === 11), { zone_arrivee: 'carre' });    // ratée, vers le Carré
Object.assign(codes.find(c => c.sequence_id === 12), { zone_arrivee: 'carre', lignes: 'aucune' });   // le codage prime
ctx.CLIPS = run(`anMerge(${JSON.stringify(videos)}, ${JSON.stringify(seqs)}, ${JSON.stringify(codes)})`);
assert.deepEqual(run("anBreakdown(anActionClips(CLIPS, F, 'passe'), 'lignes', AN_LIGNES)").filter(r => r.total).map(r => [r.value, r.ok, r.ko]),
  [['aucune', 1, 0], ['mediane', 1, 1]]);
assert.equal(run("anValue({ action: 'duel_sol', zone_arrivee: 'carre' }, 'lignes')"), null, 'la convention ne vaut que pour une passe');

/* Champs portés par une action : le reste est vidé à l'enregistrement. */
const has = (a, k) => run(`anFields(${JSON.stringify(a)})`).includes(k);
assert.ok(has('passe', 'lignes') && has('passe', 'x2') && has('centre', 'x2') && has('tir', 'touches') && has('duel_air', 'intervention'));
assert.ok(!has('tir', 'x2') && !has('duel_sol', 'pied') && !has('recuperation', 'resultat') && !has('centre', 'direction') && !has(null, 'resultat'));


/* ---------- Timeline : lignes, rectangle de sélection, graduations, modification groupée ---------- */
assert.deepEqual(run('AN_LANES.map(l => l[0])'), ['passe', 'tir', 'centre', 'duel_sol', 'duel_air', 'recuperation', 'todo']);
assert.deepEqual(run("[anLane({ action: 'tir' }), anLane({ action: null })]"), ['tir', 'todo'], 'un clip pas encore codé a sa ligne');
ctx.TL = [{ id: 1, action: 'passe', start_sec: 10, end_sec: 14 }, { id: 2, action: 'passe', start_sec: 20, end_sec: 24 }, { id: 3, action: 'tir', start_sec: 12, end_sec: 13 },
  { id: 4, action: null, start_sec: 13, end_sec: 30 }];
const rect = (t0, t1, lanes) => run(`anInRect(TL, ${t0}, ${t1}, ${JSON.stringify(lanes)})`);
assert.deepEqual(rect(11, 21, ['passe']), [1, 2], 'un clip qui dépasse du rectangle est pris');
assert.deepEqual(rect(21, 11, ['passe']), [1, 2], 'rectangle tracé de droite à gauche');
assert.deepEqual(rect(14, 20, ['passe']), [], 'entre deux clips : rien (bornes exclues)');
assert.deepEqual(rect(0, 100, ['tir', 'todo']), [3, 4], 'seulement les lignes couvertes');
assert.deepEqual(rect(0, 100, ['passe', 'tir', 'centre', 'duel_sol', 'duel_air', 'recuperation', 'todo']), [1, 2, 3, 4], 'toutes les lignes : une plage de temps');
assert.deepEqual(run('anTicks(120, 1)'), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
assert.deepEqual([run('anTicks(5700, 1).length'), run('anTicks(5700, 1)[1]'), run('anTicks(5700, 8)[1]')], [10, 600, 60], 'un match : 10 min, puis 1 min une fois zoomé');
/* Modification groupée : l'action ne se propose que si aucun clip n'est codé ; les champs d'une action que si tous la partagent. */
const scope = (acts) => run(`anBulkScope(${JSON.stringify(acts.map(action => ({ action })))})`);
assert.deepEqual(scope([null, null]), { setAction: true, action: null }, 'aucun codé : on peut choisir l\'action');
assert.deepEqual(scope(['passe', 'passe']), { setAction: false, action: 'passe' }, 'même action : ses champs');
assert.deepEqual(scope(['passe', 'duel_sol']), { setAction: false, action: null }, 'actions différentes : champs communs seulement');
assert.deepEqual(scope(['passe', null]), { setAction: false, action: null }, 'codés et non codés mêlés : champs communs seulement');
assert.ok(run("anFields('recuperation')").includes('minute_match') && run('anFields(null)').includes('minute_match'), 'la minute du match vaut pour toute action');

/* ---------- Montage : tous les clips bout à bout ; rognage d'un bord ---------- */
ctx.VID = [{ id: 7, titre: '10 - Duel' }, { id: 8, titre: '02 - Playmaking' }, { id: 9, titre: '01 - Relance' }];
ctx.MC = [{ id: 1, video_id: 7, start_sec: 0, end_sec: 4 }, { id: 2, video_id: 8, start_sec: 3, end_sec: 11 }, { id: 3, video_id: 9, start_sec: 5, end_sec: 6.5 },
  { id: 4, video_id: 9, start_sec: 0, end_sec: 2 }, { id: 5, video_id: 99, start_sec: 0, end_sec: 9 }, { id: 6, video_id: 8, start_sec: 12, end_sec: 12 }];
const montage = () => run('anMontage(MC, VID)').map(m => [m.clip.id, m.at, m.dur]);
assert.deepEqual(montage(), [[4, 0, 2], [3, 2, 1.5], [2, 3.5, 8], [1, 11.5, 4]],
  'ordre des titres (01, 02, 10), puis du temps ; bout à bout sans trou ; vidéo inconnue et clip vide écartés');
ctx.MC[3].end_sec = 1;   // le premier clip du montage est raccourci d'une seconde
assert.deepEqual(montage().map(m => m[1]), [0, 1, 2.5, 10.5], 'raccourcir un clip avance tous les suivants');
const trim = (edge, t, max) => run(`anTrim({ start_sec: 3, end_sec: 11 }, '${edge}', ${t}${max == null ? '' : `, ${max}`})`);
assert.deepEqual(trim('end', 8.126), { start_sec: 3, end_sec: 8.13 }, 'fin tirée vers la gauche, au centième');
assert.deepEqual(trim('end', 1), { start_sec: 3, end_sec: 3.5 }, 'jamais moins d\'une demi-seconde');
assert.deepEqual(trim('end', 40, 12.4), { start_sec: 3, end_sec: 12.4 }, 'pas au-delà de la fin de la vidéo');
assert.deepEqual(trim('start', 5), { start_sec: 5, end_sec: 11 }, 'début tiré vers la droite, la fin ne bouge pas');
assert.deepEqual(trim('start', -4), { start_sec: 0, end_sec: 11 }, 'pas avant le début de la vidéo');
assert.deepEqual(trim('start', 30), { start_sec: 10.5, end_sec: 11 });

console.log('analyse-logic : OK (filtres généraux et par action, OU / ET, tiers, inconnus, tirs, lignes cassées, champs par action, timeline, montage, rognage)');
