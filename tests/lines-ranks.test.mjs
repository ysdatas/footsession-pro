/* Lignes de jeu (page Joueurs) et classement de chaque test (Performance).
   Lancement : node tests/lines-ranks.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ Number, String, Math, Object });
vm.runInContext(readFileSync('web/assets/js/perf-metrics.js', 'utf8'), ctx);
const run = (code) => vm.runInContext(code, ctx);
const line = (p) => run(`lineOf(${JSON.stringify(p)})`);

// Ligne déduite du poste, codes courts comme libellés longs.
for (const [poste, expected] of [['GB', 'gardien'], ['DC', 'defenseur'], ['DG', 'defenseur'], ['Latéral droit', 'defenseur'],
  ['MC', 'milieu'], ['MDF', 'milieu'], ['Milieu offensif', 'milieu'], ['BU', 'attaquant'], ['AG', 'attaquant'], ['Ailier gauche', 'attaquant']]) {
  assert.equal(line({ poste }), expected, poste);
}
assert.equal(line({ poste: '' }), null, 'sans poste : à classer');
assert.equal(line({ poste: '???' }), null, 'poste inconnu : à classer');
// Le choix fait en glissant la carte prime sur le poste.
assert.equal(line({ poste: 'BU', ligne: 'milieu' }), 'milieu');

// Classement : plus petit = meilleur, pour tous les tests.
const key = (k, v) => run(`perfRankKey(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
assert.ok(key('sprint10_sec', 1.7) < key('sprint10_sec', 1.9), 'sprint : plus rapide = mieux classé');
assert.ok(key('vift_kmh', 21) < key('vift_kmh', 19), 'VIFT : plus haut = mieux classé');
assert.ok(key('five05_asymmetry_pct', 2) < key('five05_asymmetry_pct', 12), 'asymétrie : plus faible = mieux classé');
assert.equal(key('core_ratio', 0.75), 0, 'ratio dans la zone idéale');
assert.ok(key('core_ratio', 0.68) < key('core_ratio', 1.1), 'ratio : plus proche de 0,7–0,8 = mieux classé');
assert.equal(key('vift_kmh', null), null, 'valeur absente : non classée');

console.log('lines-ranks.test.mjs : OK');
