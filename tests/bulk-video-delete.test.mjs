/* Suppression groupée des séquences : RLS peut renvoyer un sous-ensemble sans erreur.
   L'extrait de page s'exécute avec Supabase et le DOM simulés ; aucune base n'est contactée.
   Lancement : node tests/bulk-video-delete.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('web/assets/js/player-videos.js', 'utf8');
const start = source.indexOf('async function pvDeleteSeqs() {');
const end = source.indexOf("\n/* Fichiers d'origine", start);
assert.ok(start >= 0 && end > start, 'fonction de suppression trouvée');
const fnSource = `${source.slice(start, end)}\npvDeleteSeqs;`;

function fixture({ deletedIds = [], error = null, confirmed = true } = {}) {
  const events = [];
  const PV = { seqs: [{ id: 10, label: 'Séquence A' }, { id: 20, label: 'Séquence B' }, { id: 30, label: 'Séquence C' }], pick: { ids: [10, 20, 30] } };
  const sb = { from(table) {
    assert.equal(table, 'video_sequences');
    const query = {
      delete() { return this; },
      in(column, ids) { assert.equal(column, 'id'); events.push(['requested', [...ids]]); return this; },
      async select(column) { assert.equal(column, 'id'); return { data: deletedIds.map(id => ({ id })), error }; },
    };
    return query;
  } };
  const context = vm.createContext({ PV, sb, console: { error() {} },
    confirmDialog: async () => confirmed, namesList: (names) => names.join(', '), trashNote: async () => '',
    bulkReport: (...args) => events.push(['report', ...args]), pvLoad: async () => events.push(['reload']),
    toast: (message, kind) => events.push(['toast', message, kind]), Error, Set });
  return { run: vm.runInContext(fnSource, context), PV, events };
}

const partial = fixture({ deletedIds: [10] });
await partial.run();
assert.deepEqual([...partial.PV.pick.ids], [20, 30], 'les lignes refusées par RLS restent sélectionnées');
assert.deepEqual(JSON.parse(JSON.stringify(partial.events.find(e => e[0] === 'report'))), ['report', 1, 3, ['séquence', 'séquences', true], 'supprimé'],
  'le bilan compte les seules lignes supprimées');

const all = fixture({ deletedIds: [10, 20, 30] });
await all.run();
assert.deepEqual([...all.PV.pick.ids], [], 'sélection vide quand tout a été supprimé');

const failed = fixture({ deletedIds: [], error: new Error('RLS error') });
await failed.run();
assert.deepEqual([...failed.PV.pick.ids], [10, 20, 30], 'une erreur conserve la sélection entière');
assert.ok(failed.events.some(e => e[0] === 'toast' && e[2] === 'error'), 'une erreur est affichée');

const cancelled = fixture({ confirmed: false });
await cancelled.run();
assert.deepEqual([...cancelled.PV.pick.ids], [10, 20, 30], 'annuler conserve la sélection');
assert.equal(cancelled.events.length, 0, 'annuler ne lance pas de requête Supabase');

console.log('bulk-video-delete : OK');
