/* Regroupement des saisies équivalentes dans le bilan (web/assets/js/label-norm.js).
   Lancement : node tests/label-norm.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ String, Map });
vm.runInContext(readFileSync('web/assets/js/label-norm.js', 'utf8'), ctx);
const run = (code) => vm.runInContext(code, ctx);
const eff = (s) => run(`normEffectif(${JSON.stringify(s)})`);
const ter = (s) => run(`normTerrain(${JSON.stringify(s)})`);

// Effectifs : « c », « vs », espaces → une seule écriture.
for (const s of ['7v7', '7c7', '7 c 7', '7 vs 7', '7VS7']) assert.equal(eff(s), '7v7', s);
assert.equal(eff('10 c 10'), '10v10');
assert.equal(eff('7v7 +1'), '7v7 + 1');
assert.equal(eff('4 c 4 + 4 appuis OFF'), '4v4 + 4 appuis OFF');
assert.equal(eff('2vs2,3vs3,4vs4,'), '2v2, 3v3, 4v4');
// Un nombre seul = nombre de joueurs.
for (const s of ['17', '17 ', '17 joueurs', '17 J']) assert.equal(eff(s), '17 joueurs', s);
assert.equal(eff('20 J +3GB'), '20 joueurs + 3 GB');
assert.equal(eff('24 + 2 GB'), '24 joueurs + 2 GB');
// « 3 x 7 » (trois groupes de sept) n'est pas un « 3 contre 7 ».
assert.equal(eff('3 x 7'), '3 x 7');
assert.equal(eff('4+4+1v4'), '4 + 4 + 1v4');
assert.equal(eff(''), '');

// Terrains : dimensions écrites de plusieurs façons.
for (const s of ['40 x 35', '40x35', '40 m / 35 m', '40X35m']) assert.equal(ter(s), '40×35 m', s);
assert.equal(ter('20 m / 20m (8 m / 8 m)'), '20×20 m (8 m / 8 m)');
assert.equal(ter('Demi terrain'), 'Demi terrain');
assert.equal(ter('4 couloirs de 6 m par 10 m'), '4 couloirs de 6 m par 10 m');

// Comptage : casse, accents et tirets ne séparent plus deux valeurs.
const top = run(`countNormalized(['7v7','7c7','7 vs 7','16','16 joueurs','5v5'], normEffectif)`);
assert.deepEqual(JSON.parse(JSON.stringify(top)), [{ label: '7v7', c: 3 }, { label: '16 joueurs', c: 2 }, { label: '5v5', c: 1 }]);
const terr = run(`countNormalized(['Demi terrain','Demi-terrain','demi terrain','Cage'], normTerrain)`);
assert.equal(terr[0].label, 'Demi terrain');
assert.equal(terr[0].c, 3);
const princ = run(`countNormalized(['transition','Transition','Régénération','regeneration'])`);
assert.deepEqual(JSON.parse(JSON.stringify(princ)).map(x => x.c), [2, 2]);
assert.equal(princ[0].label, 'Transition');

console.log('label-norm.test.mjs : OK');
