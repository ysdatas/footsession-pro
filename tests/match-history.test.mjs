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
  { competition: 'LE MANS FC' }, { competition: null }, { competition: 'Coupe de France' }])})`);
assert.deepEqual(comps.map(c => [c.key, c.label, c.n]), [['coupe gambardella', 'Coupe Gambardella Crédit Agricole', 3], ['regional 1', 'Régional 1 U18', 2],
  ['coupe france', 'Coupe de France', 1], ['', 'Compétition non renseignée', 2]], 'regroupement des compétitions');

// Doublons : même date, même adversaire écrit autrement, équipes différentes ; pas deux matchs à des dates différentes.
const dup = run(`[...mhDuplicates(${JSON.stringify([
  { id: 1, date_match: '2026-10-24', adversaire: 'BOUCHEMAINE ES', team_id: 5 }, { id: 2, date_match: '2026-10-24', adversaire: 'bouchemaine', team_id: 7 },
  { id: 3, date_match: '2026-11-07', adversaire: 'ST NAZAIRE AF' }, { id: 4, date_match: '2026-10-10', adversaire: 'ST NAZAIRE AF' },
  { id: 5, date_match: '2026-10-17', adversaire: 'COULAINES JS' }, { id: 6, date_match: '2026-10-17', adversaire: 'CARQUEFOU USJA' }])})].map(([id, o]) => [id, o.map(x => x.id)])`);
assert.deepEqual(dup, [[1, [2]], [2, [1]]], 'seul le match saisi deux fois est signalé');
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
console.log('match-history : OK (joués, titularisations, minutes, buts, passes, cartons, notes, valeurs absentes, compétitions, doublons, réunion)');
