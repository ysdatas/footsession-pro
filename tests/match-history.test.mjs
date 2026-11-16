/* Effectif des retours de match (web/assets/js/match-history.js, matchSquad) :
   matchs joués, titularisations, minutes, buts, passes, cartons, notes ;
   une valeur jamais saisie reste null (« — »), jamais 0 ; compétitions
   regroupées (mhCompetitions), matchs saisis deux fois (mhDuplicates) et leur
   réunion (matchMergePlan, match-merge.js).
   Lancement : node tests/match-history.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ Number, Math, Map, Set, Object, String });
for (const f of ['match-history.js', 'match-merge.js']) vm.runInContext(readFileSync(`web/assets/js/${f}`, 'utf8'), ctx);
const run = (code) => JSON.parse(JSON.stringify(vm.runInContext(code, ctx)));
const squad = (rows) => JSON.parse(JSON.stringify(vm.runInContext(`matchSquad(${JSON.stringify(rows)})`, ctx)));

const rows = [
  { player_id: 1, statut: 'titulaire', minutes: 90, buts: 1, passes: 0, note: 'plus', cartons_jaunes: 1, carton_rouge: false },
  { player_id: 1, statut: 'titulaire', minutes: 62, buts: 0, passes: 2, note: 'egal', cartons_jaunes: 0, carton_rouge: false },
  { player_id: 1, statut: 'remplacant', minutes: null, buts: null, passes: null, note: null },
  { player_id: 1, statut: 'non_entre', minutes: null, buts: null, passes: null, note: null },
  { player_id: 2, statut: 'remplacant', minutes: 20, buts: 2, passes: null, note: 'moins', cartons_jaunes: null, carton_rouge: true },
  { player_id: 3, statut: null, minutes: 30, buts: null, passes: null, note: null },
  { player_id: 4, statut: 'non_entre', minutes: null, buts: null, passes: null, note: null },
];
const [p1, p2, p3, p4] = squad(rows);

assert.deepEqual([p1.conv, p1.played, p1.tit], [4, 3, 2], 'feuilles, matchs joués (titulaire ou entré), titularisations');
assert.deepEqual([p1.min, p1.perMatch], [152, 76], 'minutes connues seulement : 152 sur 2 matchs chronométrés');
assert.deepEqual([p1.buts, p1.passes, p1.jaunes, p1.rouges], [1, 2, 1, 0]);
assert.deepEqual(p1.notes, [1, 1, 0], '+ / = / −');
assert.deepEqual([p2.played, p2.buts, p2.passes, p2.jaunes, p2.rouges], [1, 2, null, 0, 1], 'passes jamais saisies : null ; rouge sans jaune saisi');
assert.deepEqual([p3.played, p3.tit, p3.min], [1, 0, 30], 'minutes sans statut : a joué');
assert.deepEqual([p4.conv, p4.played, p4.min, p4.perMatch, p4.buts, p4.jaunes, p4.rouges], [1, 0, null, null, null, null, null], 'non entré : rien d’inventé');
assert.deepEqual(squad([]), [], 'aucun match');


// Compétitions : même clé malgré le sponsor, la casse ou le tour ; nom d'équipe lu par erreur → non renseignée.
const comps = run(`mhCompetitions(${JSON.stringify([
  { competition: 'COUPE GAMBARDELLA CRÉDIT AGRICOLE - U19 - U18' }, { competition: 'COUPE GAMBARDELLA CRÉDIT AGRICOLE - U19 - U18 4ème tour éliminatoire' },
  { competition: 'coupe gambardella' }, { competition: 'Régional 1 U18 - U19 - U18' }, { competition: 'Régional 1 U18 - U19 - U18' },
  { competition: 'LE MANS FC' }, { competition: null }, { competition: 'Coupe de France' }, { competition: 'Régional 1 U15 - U15 - U14' }])})`);
assert.deepEqual(comps.map(c => [c.key, c.label, c.n]), [['coupe gambardella', 'Coupe Gambardella Crédit Agricole', 3], ['regional 1 u18', 'Régional 1 U18', 2],
  ['coupe france', 'Coupe de France', 1], ['regional 1 u15', 'Régional 1 U15', 1], ['', 'Compétition non renseignée', 2]],
  'regroupement des compétitions ; U18 Régional 1 et U15 Régional 1 restent distinctes');
assert.deepEqual(run(`['Régional 1 U15 - U15 - U14', 'U 17 National', 'N2', 'National 2 - Poule B', 'Régional 1', 'Espoirs', 'Coupe de France'].map(mhCatOf)`),
  ['u15', 'u17', 'n2', 'n2', 'r1', '', ''], 'catégorie : l’âge d’abord, sinon le niveau');

// Doublons : même date, même adversaire écrit autrement, équipes différentes ; pas deux matchs à des dates différentes.
const dup = run(`[...mhDuplicates(${JSON.stringify([
  { id: 1, date_match: '2026-10-24', adversaire: 'BOUCHEMAINE ES', team_id: 5 }, { id: 2, date_match: '2026-10-24', adversaire: 'bouchemaine', team_id: 7 },
  { id: 3, date_match: '2026-11-07', adversaire: 'ST NAZAIRE AF' }, { id: 4, date_match: '2026-10-10', adversaire: 'ST NAZAIRE AF' },
  { id: 5, date_match: '2026-10-17', adversaire: 'COULAINES JS' }, { id: 6, date_match: '2026-10-17', adversaire: 'CARQUEFOU USJA' }])})].map(([id, o]) => [id, o.map(x => x.id)])`);
assert.deepEqual(dup, [[1, [2]], [2, [1]]], 'seul le match saisi deux fois est signalé');
// Catégories différentes (U15 / N2, comme sur la capture du 15/11) : deux matchs du club, pas un doublon ;
// catégorie inconnue d'un côté : signalé ; paire déclarée distincte (lmfc_v53.sql) : plus signalée.
const teams = { 5: 'U15', 2: 'N2', 9: 'Pro' };
const sables = [{ id: 7, date_match: '2026-10-17', adversaire: 'LES SABLES VF', team_id: 5, competition: 'Régional 1 U15 - U15 - U14' },
  { id: 8, date_match: '2026-10-17', adversaire: 'Les Sables', team_id: 2 }, { id: 9, date_match: '2026-10-17', adversaire: 'LES SABLES VF', team_id: 9 }];
const dups = (opts) => run(`[...mhDuplicates(${JSON.stringify(sables)}, { teamNameOf: (id) => (${JSON.stringify(teams)})[id] || '', distinct: new Set(${JSON.stringify(opts)}) })]
  .map(([id, o]) => [id, o.map(x => x.id)])`);
assert.deepEqual(dups([]), [[7, [9]], [8, [9]], [9, [7, 8]]], 'U15 et N2 distincts ; « Pro » (catégorie inconnue) reste à vérifier');
assert.deepEqual(dups(['7-9', '8-9']), [], 'décisions « pas un doublon » respectées');
assert.deepEqual(run(`mhTwins({ date_match: '2026-10-17', adversaire: 'SABLES (LES)', team_id: 2 }, ${JSON.stringify(sables)}, { teamNameOf: (id) => (${JSON.stringify(teams)})[id] || '' }).map(x => x.id)`),
  [8, 9], 'nouveau match N2 : comparé avant enregistrement');
// Réunion : le match gardé garde ses valeurs, complète ses cases vides ; les joueurs absents passent ; ni équipe ni import FFF copiés.
const keep = { id: 10, team_id: 1, competition: null, score_pour: 4, score_contre: 2, heure: null, stade: null, lieu: 'exterieur', infos: null, commentaire: null, a_retenir: null, ext_source: null };
const drop = { id: 11, team_id: 2, competition: 'Coupe Gambardella', score_pour: 3, score_contre: 2, heure: '15:00:00', stade: '', lieu: 'domicile', infos: null, commentaire: 'Bon match', a_retenir: null, ext_source: 'fff', ext_id: 'x' };
const plan = run(`matchMergePlan(${JSON.stringify(keep)}, ${JSON.stringify([
  { id: 100, match_id: 10, player_id: 1, statut: 'titulaire', minutes: null, buts: 1, passes: null, note: null, cartons_jaunes: null, carton_rouge: null },
  { id: 101, match_id: 10, player_id: 2, statut: 'remplacant', minutes: 20, buts: 0, passes: 0, note: 'egal', cartons_jaunes: 0, carton_rouge: false }])},
  ${JSON.stringify(drop)}, ${JSON.stringify([
  { id: 200, match_id: 11, player_id: 1, statut: 'remplacant', minutes: 90, buts: 2, passes: 1, note: 'plus', cartons_jaunes: 1, carton_rouge: false },
  { id: 201, match_id: 11, player_id: 2, statut: null, minutes: null, buts: null, passes: null, note: null, cartons_jaunes: null, carton_rouge: null },
  { id: 202, match_id: 11, player_id: 3, statut: 'titulaire', minutes: 90, buts: 0, passes: 0, note: null, cartons_jaunes: null, carton_rouge: null }])})`);
assert.deepEqual(plan.match, { competition: 'Coupe Gambardella', heure: '15:00:00', commentaire: 'Bon match' }, 'cases vides complétées ; score, lieu, équipe, import gardés');
assert.deepEqual(plan.fills, [{ id: 100, patch: { minutes: 90, passes: 1, note: 'plus', cartons_jaunes: 1, carton_rouge: false } }], 'joueur dans les deux : sa ligne d’ici, complétée (statut et buts gardés)');
assert.deepEqual(plan.moves, [202], 'joueur absent d’ici : sa ligne passe ; ligne vide de l’autre : rien à faire');
// Joueurs hors plateforme (lmfc_v37.sql) : ceux de l'autre s'ajoutent, une fois par nom.
const hp = run(`matchMergePlan(${JSON.stringify({ ...keep, hors_plateforme: [{ nom: 'AUGUSTIN DELBECQUE', statut: 'titulaire' }] })}, [],
  ${JSON.stringify({ ...drop, hors_plateforme: [{ nom: 'Augustin Delbecque', statut: 'titulaire' }, { nom: 'RAUL TORRENTE', statut: 'titulaire' }] })}, [])`);
assert.deepEqual(hp.match.hors_plateforme.map(x => x.nom), ['AUGUSTIN DELBECQUE', 'RAUL TORRENTE'], 'hors plateforme réunis sans doublon');
assert.equal('hors_plateforme' in plan.match, false, 'sans hors plateforme : rien à écrire');
console.log('match-history : OK (joués, titularisations, minutes, buts, passes, cartons, notes, valeurs absentes, compétitions, doublons, réunion)');
