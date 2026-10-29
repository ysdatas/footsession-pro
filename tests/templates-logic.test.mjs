/* Recherche des schémas enregistrés (web/assets/js/session-templates.js) :
   nom sans casse ni accents, type, tags « tous » ou « au moins un »,
   critères combinés. Lancement : node tests/templates-logic.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ String, EDIT_DO: {}, window: {} });
vm.runInContext(readFileSync('web/assets/js/library.js', 'utf8'), ctx);
vm.runInContext(readFileSync('web/assets/js/session-templates.js', 'utf8'), ctx);
const rows = [
  { id: 1, nom: 'Rondo 4c2 orienté', categorie: 'Jeu', tag_ids: [10, 20] },
  { id: 2, nom: 'Conservation 7c7', categorie: 'Jeu', tag_ids: [20, 30] },
  { id: 3, nom: 'Finition réversibilité', categorie: 'Exercice', tag_ids: [40] },
  { id: 4, nom: 'Échauffement', categorie: null, tag_ids: [] },
];
ctx.rows = rows;
const ids = (opts) => vm.runInContext(`filterTemplates(rows, ${JSON.stringify(opts)})`, ctx).map(t => t.id);

assert.deepEqual(ids({}), [1, 2, 3, 4], 'sans critère : tout');
assert.deepEqual(ids({ q: 'RONDO' }), [1], 'nom : casse ignorée');
assert.deepEqual(ids({ q: 'reversibilite' }), [3], 'nom : accents ignorés');
assert.deepEqual(ids({ q: 'echauf' }), [4], 'nom : début de mot');
assert.deepEqual(ids({ cat: 'Jeu' }), [1, 2], 'type');
assert.deepEqual(ids({ tags: [20] }), [1, 2], 'un tag');
assert.deepEqual(ids({ tags: [10, 20] }), [1], 'tous les tags');
assert.deepEqual(ids({ tags: [10, 30], mode: 'any' }), [1, 2], 'au moins un');
assert.deepEqual(ids({ tags: [10, 30] }), [], 'tous : aucun ne les a les deux');
assert.deepEqual(ids({ q: 'conservation', cat: 'Jeu', tags: [20] }), [2], 'critères combinés');
assert.deepEqual(ids({ q: 'rondo', cat: 'Exercice' }), [], 'combinés : nom juste, type faux');
for (const k of ['insertTemplate', 'deleteTemplate', 'saveAsTemplate']) assert.equal(typeof ctx.EDIT_DO[k], 'function', `action ${k}`);
console.log('templates-logic : OK (11 recherches)');
