/* Réponse RPE attendue (web/assets/js/rpe.js, rpeExpected) : le joueur
   participe, ou sa présence n'est pas encore renseignée ; seule une
   absence enregistrée l'exclut. Plus l'échelle et ses couleurs.
   Lancement : node tests/rpe-logic.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ String, Number, Math, Set, Map, Date, Intl, JSON, Object, Array, window: {} });
for (const f of ['procedure-time.js', 'rpe.js']) vm.runInContext(readFileSync(`web/assets/js/${f}`, 'utf8'), ctx);
const exp = (row) => vm.runInContext(`rpeExpected(${JSON.stringify(row)})`, ctx);

assert.equal(exp(null), true, 'présence pas renseignée : attendu');
assert.equal(exp({ statut: 'present' }), true);
assert.equal(exp({ statut: 'reprise' }), true);
for (const st of ['absent', 'blesse', 'selection', 'groupe_pro']) assert.equal(exp({ statut: st }), false, `${st} : pas attendu`);
assert.equal(exp({ statut: 'autre', present: true }), true, 'autre, participe : attendu');
assert.equal(exp({ statut: 'autre', present: false }), false);
assert.equal(exp({ statut: null, present: true }), true, 'ancienne présence cochée');
assert.equal(exp({ statut: null, present: false }), false, 'ancienne absence');
assert.equal(exp({ statut: 'present', invite: true }), true, 'invité présent');

assert.equal(vm.runInContext('rpeLabel(7)', ctx), 'Très dur');
assert.equal(vm.runInContext('rpeColor(1)', ctx), 'hsl(130 62% 46%)', 'vert pour 1');
assert.equal(vm.runInContext('rpeColor(10)', ctx), 'hsl(0 62% 46%)', 'rouge pour 10');
assert.equal(vm.runInContext('rpeFr(6.25)', ctx), '6,3');

console.log('rpe-logic : OK (réponse attendue, échelle)');
