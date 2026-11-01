/* Moteur d'import GPS (web/assets/js/gps-import.js) :
   - le vrai export Catapult du club (Téléchargements, jamais copié dans le
     dépôt ; test sauté s'il est absent) et sa copie anonymisée
     (tests/fixtures-gps-catapult.csv) : 14 colonnes reconnues, 8 joueurs,
     « Team Average » exclue, 01:04:19 → 64,32 min, 25,5 km/h, contrôles ;
   - colonnes réordonnées, intitulés anglais, unités (km, m/s, s), cellules
     vides, colonne inconnue signalée, séparateur virgule et guillemets,
     cellules d'un Excel ;
   - rapprochement des noms (nom seul, homonymes, correspondance validée).
   Lancement : node tests/gps-import.test.mjs */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ String, Number, Math, Map, Set, Object, Array, JSON });
for (const f of ['perf-metrics.js', 'gps-import.js']) vm.runInContext(readFileSync(`web/assets/js/${f}`, 'utf8'), ctx);
const run = (code) => JSON.parse(JSON.stringify(vm.runInContext(code, ctx)));
const analyse = (text) => { ctx.T = text; return run('gpsAnalyse(gpsCsvRows(T))'); };
const KEYS = ['duree', 'distance', 'rythme', 'dist_15_20', 'dist_20_25', 'dist_gt25', 'acc_gt3', 'dec_gt3', 'vmax', 'imbalance', 'rate_15_20', 'rate_gt20', 'sprints'];

function catapult(a, names, label) {
  const known = a.columns.filter(c => c.status === 'known');
  assert.equal(a.columns.filter(c => c.status === 'player').length, 1, `${label} : colonne Player`);
  assert.deepEqual(known.map(c => c.key), KEYS, `${label} : 13 indicateurs + Player = 14 colonnes reconnues`);
  assert.deepEqual(a.columns.filter(c => c.status === 'unknown' || c.status === 'text'), [], `${label} : aucune colonne inconnue`);
  assert.deepEqual(a.players.map(p => p.name), names, `${label} : les 8 joueurs`);
  assert.deepEqual(a.excluded, [{ name: 'Team Average', reason: 'ligne collective' }], `${label} : ligne collective exclue`);
  const p = a.players[0].values;
  assert.deepEqual([p.duree, p.distance, p.rythme, p.dist_15_20, p.dist_gt25, p.acc_gt3, p.dec_gt3, p.vmax, p.imbalance, p.rate_15_20, p.rate_gt20, p.sprints],
    [64.32, 4473, 70, 509, 1, 8, 16, 25.5, 4.13, 7.91, 3.1, 0], `${label} : valeurs et unités du premier joueur`);
  assert.equal(a.players[4].values.imbalance, -1.89, 'valeur négative à virgule');
  assert.deepEqual(known.find(c => c.key === 'dist_15_20'), { index: 4, header: 'Dist 15-20km.h', status: 'known', key: 'dist_15_20',
    label: 'Distance 15–20 km/h', unit: 'm', kind: 'distance', band: [15, 20], factor: 1 }, 'interprétation gardée avec l’en-tête');
  assert.equal(known.find(c => c.key === 'imbalance').unit, '', 'Imbalance : aucune unité inventée');
  assert.equal(a.players[0].raw['Temps'], '01:04:19', 'cellule d’origine conservée');
  assert.deepEqual(a.warnings, [], `${label} : aucune alerte`);
  assert.deepEqual(a.checks, ['Rythme = distance ÷ temps : vérifié.', 'Distance 15–20 km/h par minute = distance de la bande ÷ temps : vérifié.']);
}

const real = '/Users/ysdatabase/Downloads/S.L. TFC J-2_Full Training.csv';
if (existsSync(real)) catapult(analyse(readFileSync(real, 'utf8')), ['CALODAT', 'EYOUM', 'GUEYE', 'LAURAY', 'ROBIN', 'ROSSIGNOL', 'VOYER', 'YOHOU'], 'export réel');
else console.log('gps-import : export réel absent de Téléchargements, seule la copie anonymisée est testée');
catapult(analyse(readFileSync('tests/fixtures-gps-catapult.csv', 'utf8')), ['DUPONT', 'MARTIN', 'BERNARD', 'PETIT', 'DURAND', 'LEROY', 'MOREAU', 'SIMON'], 'copie anonymisée');

/* ---------- Autres exports : ordre, intitulés, unités, trous ---------- */
const en = analyse(['Session Notes,Max Velocity (m/s),Player Name,Total Distance (km),Duration (s),Velocity Band 4 Distance,"Accelerations > 2,5 m/s/s"',
  'bon,"7,08",Alex Dupont,"4,473",3859,120,4', ',6.5,Sam Martin,,3600,,', 'x,7,Team Total,8.9,7459,240,9'].join('\n'));
const col = (k) => en.columns.find(c => c.key === k);
assert.deepEqual(['vmax', 'distance', 'duree', 'acc_gt2.5'].map(k => col(k)?.status), ['known', 'known', 'known', 'known'], 'intitulés anglais, colonnes réordonnées, seuil décimal');
assert.deepEqual(en.players[0].values, { vmax: 25.488, distance: 4473, duree: 64.317, x_velocity_band_4_distance: 120, 'acc_gt2.5': 4 }, 'm/s → km/h, km → m, s → min');
assert.deepEqual(en.players[1].values, { vmax: 23.4, duree: 60 }, 'cellules vides : absentes, rien d’inventé');
assert.equal(en.columns.find(c => c.header === 'Velocity Band 4 Distance').status, 'unknown', 'bande sans seuils : signalée, pas interprétée');
assert.equal(en.columns.find(c => c.header === 'Session Notes').status, 'text');
assert.deepEqual(en.excluded.map(x => x.name), ['Team Total']);
assert.match(analyse('Player;Vitesse maximale\nA;7,1\nB;7,4\nC;6,9').warnings[0], /m\/s plutôt qu’en km\/h/, 'vitesse en m/s sans le dire : signalé');
assert.match(analyse('Player;Temps;Distance totale;Rythme\nA;60;6000;70').warnings[0], /incohérent pour A/, 'rythme incohérent : signalé');
assert.deepEqual(analyse('Player;Distance totale\nA;1\nA;2').excluded.map(x => x.reason), ['nom en double dans le fichier', 'nom en double dans le fichier'], 'deux lignes au même nom : aucune importée');
// Cellules d'un Excel (SheetJS) : nombres, durée en fraction de jour ou « h:mm:ss ».
ctx.XL = [['Player', 'Temps', 'Distance totale'], ['A', 0.0446644, 4473], ['B', '1:04:19', 4400]];
assert.deepEqual(run('gpsAnalyse(XL).players.map(p => p.values)'), [{ duree: 64.32, distance: 4473 }, { duree: 64.32, distance: 4400 }], 'Excel');

/* ---------- Rapprochement des noms ---------- */
ctx.ROSTER = [{ id: 1, nom: 'Calodat', prenom: 'Lucas', team_id: 1 }, { id: 2, nom: 'Gueye', prenom: 'Dame', team_id: 1 },
  { id: 3, nom: 'Gueye', prenom: 'Moussa', team_id: 2 }, { id: 4, nom: 'Robin', prenom: 'Léo', team_id: 1 }, { id: 5, nom: 'Robin', prenom: 'Théo', team_id: 1 }];
const m = (names, team, aliases = '[]') => run(`gpsMatch(${JSON.stringify(names)}, ROSTER, ${team}, new Map(${aliases}))`).map(r => `${r.name}:${r.status}:${r.player?.id ?? '-'}`);
assert.deepEqual(m(['CALODAT', 'GUEYE', 'ROBIN', 'INCONNU', 'Lucas CALODAT'], 1),
  ['CALODAT:choose:-', 'GUEYE:confirm:2', 'ROBIN:choose:-', 'INCONNU:none:-', 'Lucas CALODAT:choose:-'],
  'nom seul : à confirmer ; deux Robin : à choisir ; une fiche visée deux fois : à choisir');
assert.deepEqual(m(['CALODAT'], 1), ['CALODAT:confirm:1'], 'nom seul dans l’équipe : à confirmer, jamais reconnu d’office');
assert.deepEqual(m(['GUEYE'], null), ['GUEYE:choose:-'], 'sans équipe : deux Gueye au club');
assert.deepEqual(m(['ROBIN'], 1, "[['robin', 5]]"), ['ROBIN:alias:5'], 'correspondance déjà validée : reconnue');
assert.deepEqual(m(['Léo ROBIN'], 1), ['Léo ROBIN:ok:4'], 'prénom et nom : reconnu');
assert.equal(run(`gpsFileDate('S.L. TFC J-2_Full Training.csv')`), null, 'pas de date dans ce nom : à saisir');
assert.equal(run(`gpsFileDate('Seance 29-10-2026 Full.csv')`), '2026-10-29');
assert.equal(run(`gpsFileDate('2026_10_29_export.xlsx')`), '2026-10-29');

console.log('gps-import : OK (export Catapult, variantes, unités, contrôles, rapprochement)');
