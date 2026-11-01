/* Tableau de bord Suivi RPE (web/assets/js/rpe-stats.js, rpeSummary) :
   moyennes par séance, par joueur et sur la période, réponses manquantes,
   charge ressentie (RPE × durée de la séance) et sa variation.
   Lancement : node tests/rpe-stats.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ Number, Math, Array, Object });
vm.runInContext(readFileSync('web/assets/js/rpe-stats.js', 'utf8'), ctx);
const run = (sessions, cells) => JSON.parse(JSON.stringify(vm.runInContext(`rpeSummary(${JSON.stringify(sessions)}, ${JSON.stringify(cells)})`, ctx)));
const v = (x) => ({ v: x, staff: false });

// 3 joueurs × 3 séances (la plus ancienne d'abord).
const sessions = [{ duree_min: 90, travail: 60 }, { duree_min: 60 }, { duree_min: null }];
const cells = [
  [v(6), v(8), 'miss'],
  [v(4), 'abs', v(5)],
  ['miss', null, v(7)],
];
const r = run(sessions, cells);

assert.deepEqual(r.perSession.map(s => [s.avg, s.n, s.missing, s.due]), [[5, 2, 1, 3], [8, 1, 0, 1], [6, 2, 1, 3]],
  'par séance : moyenne des réponses, absent et non concerné hors du compte');
assert.equal(r.perSession[0].load, 450, 'charge ressentie = RPE moyen × durée (5 × 90)');
assert.equal(r.perSession[1].load, 480);
assert.equal(r.perSession[2].load, null, 'séance sans durée : pas de charge inventée');
assert.equal(r.perSession[0].travail, 60, 'temps de travail prévu gardé à part');
assert.equal(r.perSession[0].delta, null, 'première séance : pas de variation');
assert.equal(Math.round(r.perSession[1].delta * 1000), 67, '+6,7 % d’une séance à l’autre');
assert.equal(r.perSession[2].delta, null);

assert.deepEqual(r.perPlayer.map(p => [p.avg, p.n, p.missing]), [[7, 2, 1], [4.5, 2, 0], [7, 1, 1]], 'par joueur');
assert.equal(r.perPlayer[0].load, (6 * 90 + 8 * 60) / 2, 'charge du joueur : sa réponse × durée de la séance');
assert.equal(r.perPlayer[2].load, null, 'seule réponse sur une séance sans durée : pas de charge');

assert.deepEqual([r.total.avg, r.total.n, r.total.missing, r.total.due], [6, 5, 2, 7], 'période : 5 réponses, 2 manquantes');
assert.equal(Math.round(r.total.rate * 100), 71);
assert.equal(r.total.load, 465, 'charge moyenne des séances notées');

const empty = run([{ duree_min: 90 }], [['miss'], [null]]);
assert.deepEqual([empty.total.avg, empty.total.n, empty.total.missing, empty.total.load], [null, 0, 1, null], 'aucune réponse : rien d’inventé');
assert.deepEqual(run([], []).total, { avg: null, n: 0, missing: 0, due: 0, rate: null, load: null }, 'aucune séance');

console.log('rpe-stats : OK (moyennes, manquantes, charge ressentie)');
