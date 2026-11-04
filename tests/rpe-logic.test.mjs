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
// Délai du joueur : du jour de la séance, à partir de son heure, jusqu'à J+14.
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const open = (n, h) => vm.runInContext(`rpeOpen(${JSON.stringify(day(n))}, ${JSON.stringify(h ?? null)})`, ctx);
assert.equal(open(0), true, 'aujourd’hui, sans heure');
assert.equal(open(0, '00:00:00'), true, 'aujourd’hui, déjà commencée');
assert.equal(open(0, '23:59'), false, 'aujourd’hui, pas encore commencée');
assert.equal(open(-1, '23:59'), true, 'hier : l’heure ne compte plus');
assert.equal(open(-14), true, 'J+14 : ouvert');
assert.equal(open(-15), false, 'J+15 : fermé');
assert.equal(open(1), false, 'demain : pas encore');
assert.equal(vm.runInContext(`rpeWhen({ date: '2026-11-03', heure: '16:30:00' })`, ctx), '03/11/2026 à 16:30', 'date et heure');
assert.equal(exp({ statut: 'present', invite: true }), true, 'invité présent');

assert.equal(vm.runInContext('rpeLabel(7)', ctx), 'Très dur');
assert.equal(vm.runInContext('rpeColor(1)', ctx), 'hsl(130 62% 46%)', 'vert pour 1');
assert.equal(vm.runInContext('rpeColor(10)', ctx), 'hsl(0 62% 46%)', 'rouge pour 10');
assert.equal(vm.runInContext('rpeFr(6.25)', ctx), '6,3');

console.log('rpe-logic : OK (réponse attendue, échelle)');
