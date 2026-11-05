/* Recherche des schémas enregistrés (web/assets/js/session-templates.js) :
   nom sans casse ni accents, type, tags « tous » ou « au moins un »,
   critères combinés ; « Mes schémas » / « Club » (lmfc_v37.sql).
   Lancement : node tests/templates-logic.test.mjs */
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
// Mes schémas / Club : les siens d'un côté, ceux des autres et les anciens sans créateur de l'autre.
rows[0].created_by = 'moi'; rows[1].created_by = 'autre'; rows[2].created_by = null; rows[3].created_by = 'moi';
assert.deepEqual(ids({ scope: 'mine', me: 'moi' }), [1, 4], 'mes schémas');
assert.deepEqual(ids({ scope: 'club', me: 'moi' }), [2, 3], 'club : les autres, créateur inconnu compris');
assert.deepEqual(ids({ scope: 'club', me: 'moi', cat: 'Jeu' }), [2], 'combiné aux autres critères');
assert.deepEqual(ids({ me: 'moi' }), [1, 2, 3, 4], 'sans lmfc_v37.sql (pas de scope) : tout, comme avant');
for (const k of ['insertTemplate', 'chooseTemplateForProcedure', 'applyTemplateDrawing', 'applyTemplateAll', 'deleteTemplate', 'saveAsTemplate'])
  assert.equal(typeof ctx.EDIT_DO[k], 'function', `action ${k}`);
const overwritten = vm.runInContext(`templateOverwrittenFields(
  { nom: 'Rondo', objectif: '', effectif: '8 joueurs' },
  { nom: 'Mon exercice', objectif: 'Travail des appuis', effectif: '8 joueurs' }
)`, ctx);
assert.deepEqual(Array.from(overwritten), ['Nom du procédé', 'Objectif'], 'avertit des valeurs renseignées remplacées, y compris vidées');
assert.deepEqual(Array.from(vm.runInContext(`templateOverwrittenFields({ nom: 'Mon exercice' }, { nom: 'Mon exercice' })`, ctx)), [], 'aucune alerte si les valeurs restent identiques');
console.log('templates-logic : OK (recherche, actions et détection des champs écrasés)');
