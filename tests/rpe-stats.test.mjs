/* Tableau de bord Suivi RPE (web/assets/js/rpe-stats.js, rpeSummary) :
   moyennes par séance, par joueur et sur la période, réponses manquantes,
   charge ressentie (RPE × durée de la séance, minutes jouées d'un match)
   et sa variation ; qui a joué d'après la feuille (rpeOnSheet).
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
assert.deepEqual(run([], []).total, { avg: null, n: 0, missing: 0, pending: 0, due: 0, rate: null, load: null, gap: null, gapN: 0 }, 'aucune séance');

// RPE attendue (lmfc_v34.sql) : écart = moyenne déclarée − attendue ; « en attente » (J à J+2) ni manquant ni dans le taux.
const att = run([{ duree_min: 90, rpe_attendue: 6 }, { duree_min: 60, rpe_attendue: 7 }, { duree_min: 60 }, { duree_min: 75, rpe_attendue: 5 }],
  [[v(8), v(6), v(5), 'wait'], [v(8), 'miss', v(7), v(6)], [v(8), v(8), null, 'wait']]);
assert.deepEqual(att.perSession.map(s => [s.expected, s.gap]), [[6, 2], [7, 0], [null, null], [5, 1]], 'exemple : attendue 6, moyenne 8 → +2');
assert.equal(att.perSession[0].load, 720, 'la charge ressentie ne dépend pas de la RPE attendue');
assert.deepEqual([att.total.gap, att.total.gapN], [1, 3], 'écart moyen des séances qui ont les deux');
assert.deepEqual([att.perSession[3].pending, att.perSession[3].missing, att.perSession[3].due], [2, 0, 3], 'séance du jour : 2 en attente, pas manquantes');
assert.deepEqual([att.total.missing, att.total.pending, att.total.n], [1, 2, 8]);
assert.equal(Math.round(att.total.rate * 1000), 889, 'taux de réponse hors « en attente » : 8 / 9');
assert.equal(run([{ duree_min: 90, rpe_attendue: 6 }], [['miss']]).perSession[0].gap, null, 'aucune réponse : pas d’écart');

// Match (lmfc_v38.sql) : la charge suit les minutes jouées de chacun ; sans minutes, la durée du match.
const min = (x, m) => ({ v: x, staff: false, min: m });
const mt = run([{ duree_min: 90 }, { duree_min: 60 }], [[min(8, 90), v(5)], [min(6, 20), v(7)], [min(7, null), 'miss'], [min(4, 0), null]]);
assert.equal(mt.perSession[0].load, (720 + 120 + 630 + 0) / 4, 'match : moyenne des RPE × minutes jouées, pas RPE moyen × 90');
assert.equal(mt.perSession[0].avg, 6.25, 'le RPE moyen ne dépend pas des minutes');
assert.equal(mt.perSession[1].load, 360, 'séance : inchangé, RPE moyen × durée');
assert.deepEqual(mt.perPlayer.map(p => p.load), [(720 + 300) / 2, (120 + 420) / 2, 630, 0], 'par joueur : ses minutes, la durée de la séance ailleurs');

const onSheet = (sheet, id) => vm.runInContext(`rpeOnSheet(${JSON.stringify(sheet)}, ${id})`, ctx);
const feuille = [{ player_id: 1, statut: 'titulaire', minutes: 90 }, { player_id: 2, statut: 'remplacant', minutes: 20 }, { player_id: 3, statut: 'non_entre', minutes: null },
  { player_id: 4, statut: 'remplacant', minutes: 0 }, { player_id: 5, statut: 'titulaire', minutes: null }, { player_id: 6, statut: null, minutes: null }, { player_id: 7, statut: 'non_entre', minutes: 5 }];
assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(id => onSheet(feuille, id)), [true, true, false, false, true, true, true, false],
  'minutes renseignées : plus de zéro ; sinon, tout sauf non entré ; hors de la feuille : non');

console.log('rpe-stats : OK (moyennes, manquantes, en attente, charge ressentie, minutes jouées d’un match, RPE attendue et écart)');
