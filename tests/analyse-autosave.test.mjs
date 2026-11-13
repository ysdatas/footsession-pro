/* Onglet Analyse (web/assets/js/analyse-autosave.js) : sauvegarde automatique de la séquence ouverte.
   - une modification part après le délai, une seule écriture à la fois ;
   - ce qui change pendant un envoi repart juste après, rien ne se perd ;
   - un échec garde les modifications (flush rend faux : on ne change pas de séquence) ;
   - un brouillon impossible (fin avant le début) n'est pas envoyé ;
   - le clip affiché prend les valeurs enregistrées.
   Lancement : node tests/analyse-autosave.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const sent = [];
let fail = null, release = null;
const ctx = vm.createContext({
  window: { addEventListener() {} }, document: { getElementById: () => null }, setTimeout, clearTimeout, console,
  AN: { clips: [{ id: 1, start_sec: 0, end_sec: 5, tags: [] }], tl: { trim: false }, draftClip: null, draft: null },
  anRender() {},
});
for (const f of ['analyse-model.js', 'analyse-data.js', 'analyse-autosave.js']) vm.runInContext(readFileSync(`web/assets/js/${f}`, 'utf8'), ctx);
// Après analyse-data.js : la vraie écriture est remplacée par une fausse, qu'on libère à la main.
ctx.fakeSave = (clip, d) => new Promise((ok, ko) => { sent.push({ id: clip.id, ...d }); release = () => (fail ? ko(new Error(fail)) : ok(clip.id)); });
vm.runInContext('anSaveCode = fakeSave', ctx);
const run = (code) => vm.runInContext(code, ctx);
const tick = () => new Promise(r => setTimeout(r, 0));

run(`AN.draftClip = AN.clips[0]; AN.draft = { action: 'passe', resultat: null, tags: [], start_sec: 0, end_sec: 5 }`);
run(`AN.draft.resultat = 'ok'; anDraftDirty()`);
assert.equal(sent.length, 0, 'rien ne part avant le délai');
const p1 = run('anCodeFlush()');   // changer de séquence : on n'attend pas le délai
assert.equal(sent.length, 1);
run(`AN.draft.tags.push('Intensité'); anDraftDirty()`);
const p2 = run('anCodeFlush()');
assert.equal(sent.length, 1, 'une seule écriture à la fois');
release(); await tick(); await tick();
assert.equal(sent.length, 2, 'la modification faite pendant l’envoi repart juste après');
assert.deepEqual([...sent[1].tags], ['Intensité']);
release();
assert.equal(await p1, true); assert.equal(await p2, true);
assert.equal(run('AN.clips[0].resultat'), 'ok', 'le clip affiché suit ce qui est enregistré');
assert.deepEqual([...run('AN.clips[0].tags')], ['Intensité']);
assert.equal(run('anSave.dirty'), false);

// Échec : les modifications restent, la séquence ne se quitte pas.
fail = 'réseau coupé';
run(`AN.draft.resultat = 'ko'; anDraftDirty()`);
const p3 = run('anCodeFlush()'); release();
assert.equal(await p3, false, 'échec : on reste sur la séquence');
assert.equal(run('anSave.dirty && AN.draft.resultat'), 'ko', 'rien de perdu');
assert.equal(run('AN.clips[0].resultat'), 'ok', 'le clip affiché garde la dernière valeur enregistrée');
fail = null;
const p4 = run('anCodeFlush()'); release();
assert.equal(await p4, true, 'réessayer enregistre');
assert.equal(run('AN.clips[0].resultat'), 'ko');

// Brouillon impossible : pas d'envoi.
const n = sent.length;
run(`AN.draft.end_sec = 0.2; anDraftDirty()`);
assert.equal(await run('anCodeFlush()'), false);
assert.equal(sent.length, n, 'fin avant le début : rien n’est envoyé');

console.log('analyse-autosave : OK (délai, une écriture à la fois, rien de perdu pendant un envoi, échec gardé, brouillon impossible)');
