/* Le schéma SQL ne doit référencer la nouvelle image qu'après son upload,
   et l'ancienne ne part qu'après confirmation de l'écriture. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const window = {};
vm.runInNewContext(readFileSync(new URL('../web/assets/js/tactical-save-core.js', import.meta.url), 'utf8'), {
  window, Date, Math, console,
});
const { versionedPath, publish } = window.TacticalSaveCore;
const path1 = versionedPath('1/procedure-12');
const path2 = versionedPath('1/procedure-12');
assert.match(path1, /^1\/procedure-12-[a-z0-9]+-[a-z0-9]+\.jpg$/);
assert.notEqual(path1, '1/procedure-12.jpg', 'une sauvegarde ne réécrit pas la clé canonique');
assert.notEqual(path1, path2, 'deux sauvegardes reçoivent des clés distinctes');

const order = [];
await publish({
  path: path1, oldPath: '1/procedure-12.jpg',
  upload: async (path) => { order.push(`upload:${path}`); return { error: null }; },
  write: async (path) => { order.push(`write:${path}`); return { data: { id: 12 }, error: null }; },
  removeOld: async (path) => { order.push(`remove:${path}`); return { error: null }; },
});
assert.deepEqual(order, [`upload:${path1}`, `write:${path1}`, 'remove:1/procedure-12.jpg']);

const failedOrder = [];
await assert.rejects(publish({
  path: path2, oldPath: '1/procedure-12.jpg',
  upload: async (path) => { failedOrder.push(`upload:${path}`); return { error: null }; },
  write: async (path) => { failedOrder.push(`write:${path}`); return { data: null, error: new Error('RLS') }; },
  removeOld: async (path) => { failedOrder.push(`remove:${path}`); return { error: null }; },
}), /RLS/);
assert.deepEqual(failedOrder, [`upload:${path2}`, `write:${path2}`], 'échec SQL : l’ancienne image n’est pas supprimée');

const refusedOrder = [];
await assert.rejects(publish({
  path: path2,
  upload: async () => ({ error: null }),
  write: async () => ({ data: [], error: null }),
  removeOld: async (path) => { refusedOrder.push(path); return { error: null }; },
}), /aucune ligne confirmée/);
assert.deepEqual(refusedOrder, [], 'réponse RLS vide : aucune suppression de l’ancienne image');

console.log('tactical-save : OK (clés immuables, ordre upload/base/suppression, échec sans perte d’image)');
