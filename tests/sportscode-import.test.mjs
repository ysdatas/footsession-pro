/* Import XML Sportscode (web/assets/js/analyse-import.js), sans navigateur : scWho, scPlan, scTypes, scDraft, scDrafts.
     - une ligne par joueur : le code (« Tigane BRENNER », « 10 BRENNER ») ou un libellé le relie à sa fiche ;
       deux joueurs du même nom : nom complet exigé ; un code qui ne nomme personne : ligne à relier ;
     - l'action : le premier autre libellé quand le code est le joueur (« Capsule » sans libellé) ;
     - code deviné (passe, duel aérien avant duel…) ;
     - libellés : valeurs de l'action (« Réussie », « Pied droit », « 1re mi-temps ») ou tags ;
     - décalage, déjà sur la vidéo, après la fin de la vidéo, action décochée.
   Lancement : node tests/sportscode-import.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ String, Number, Math, Set, Map, Object, Array, JSON, RegExp, window: {} });
for (const f of ['analyse-model.js', 'analyse-coding.js', 'analyse-import.js']) vm.runInContext(readFileSync(`web/assets/js/${f}`, 'utf8'), ctx);
const run = (expr, vars = {}) => { Object.assign(ctx, vars); return JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, ctx)); };
const players = [{ id: 1, prenom: 'Tigane', nom: 'BRENNER' }, { id: 2, prenom: 'Noam', nom: 'KUZIORA' },
  { id: 3, prenom: 'Hénoc', nom: 'ALEXANDRE' }, { id: 4, prenom: 'Elohim', nom: 'ALEXANDRE' }];
const L = (...t) => t.map(text => ({ group: '', text }));

/* Qui est nommé. */
assert.deepEqual(['Tigane BRENNER', '10 BRENNER', 'T. Brenner', 'brenner tigane', 'Hénoc Alexandre', 'ALEXANDRE', 'PASSE', 'Kuziora']
  .map(t => run(`scWho(${JSON.stringify(t)}, players)?.id ?? null`, { players })), [1, 1, 1, 1, 3, null, null, 2], 'deux Alexandre : nom complet exigé');

/* Une ligne par joueur. */
const list = [
  { start: 10, end: 14, code: 'Tigane BRENNER', labels: L('Passe', 'Réussie', 'Pied droit', '1re mi-temps') },
  { start: 30, end: 33, code: 'Tigane BRENNER', labels: L('Passe', 'Ratée', 'Passe courte') },
  { start: 50, end: 55, code: '10 BRENNER', labels: L('Duel aérien', 'Gagné', 'CPA') },
  { start: 70, end: 74, code: 'Noam KUZIORA', labels: L('Passe', 'Réussie') },
  { start: 80, end: 84, code: 'Noam KUZIORA', labels: [] },
  { start: 90, end: 99, code: 'PRESSING', labels: L('Bloc équipe') },
];
const plan = run('scPlan(list, players)', { list, players });
assert.equal(plan.total, 6);
assert.deepEqual(plan.rows.map(r => [r.key, r.name, r.player_id, r.items.length]),
  [['p1', 'Tigane BRENNER', 1, 3], ['p2', 'Noam KUZIORA', 2, 2], ['c:PRESSING', 'PRESSING', null, 1]], '« 10 BRENNER » rejoint Tigane Brenner');
assert.deepEqual(plan.rows[0].items.map(i => i.type), ['Passe', 'Passe', 'Duel aérien']);
assert.equal(plan.rows[1].items[1].type, 'Capsule', 'sans libellé');
assert.deepEqual(run('scTypes(plan, { p1: 1, p2: 2 })', { plan }), [['Passe', 3], ['Duel aérien', 1], ['Capsule', 1]], 'lignes reliées seulement');

/* Code deviné. */
assert.deepEqual(['PASSE', 'Duel aérien', 'DUEL 1c1', 'Récupération', 'Centre', 'Tir cadré', 'Pressing haut'].map(c => run(`scGuess(${JSON.stringify(c)})`)),
  ['passe', 'duel_air', 'duel_sol', 'recuperation', 'centre', 'tir', '']);

/* Libellés : valeurs de l'action, sinon tags. */
const d1 = run('scDraft(plan.rows[0].items[0], "passe", 2)', { plan });
assert.deepEqual([d1.action, d1.resultat, d1.pied, d1.periode, d1.start_sec, d1.end_sec, d1.tags], ['passe', 'ok', 'droit', 1, 12, 16, []]);
const d2 = run('scDraft(plan.rows[0].items[1], "passe")', { plan });
assert.deepEqual([d2.resultat, d2.distance], ['ko', 'courte']);
const d3 = run('scDraft(plan.rows[0].items[2], "duel_air")', { plan });
assert.deepEqual([d3.resultat, d3.categorie, d3.tags], ['ok', 'cpa', []], 'Gagné, CPA');
const d4 = run('scDraft(plan.rows[2].items[0], "")', { plan });
assert.deepEqual([d4.action, d4.tags], [null, ['PRESSING', 'Bloc équipe']], 'à coder : l’action et les libellés en tags');

/* Ce qui sera créé pour un joueur. */
const picks = { Passe: { action: 'passe', on: true }, 'Duel aérien': { action: 'duel_air', on: true }, Capsule: { action: '', on: false } };
let r = run('scDrafts(plan.rows[0].items, picks, [{ start_sec: 10.2, end_sec: 13.9 }], { dur: 52 })', { plan, picks });
assert.deepEqual(r.out.map(x => [x.label, x.draft.start_sec, x.draft.end_sec]), [['Passe', 30, 33], ['Duel aérien', 50, 52]], 'fin rognée à la durée');
assert.deepEqual([r.skipped, r.beyond], [1, 0], 'la passe déjà sur la vidéo est laissée');
r = run('scDrafts(plan.rows[0].items, picks, [], { dur: 40 })', { plan, picks });
assert.deepEqual([r.out.length, r.beyond], [2, 1], 'le duel après la fin de la vidéo est laissé');
assert.equal(run('scDrafts(plan.rows[1].items, picks, []).out.length', { plan, picks }), 1, 'Capsule décochée');
assert.equal(run('scDrafts([plan.rows[0].items[0], plan.rows[0].items[0]], picks, []).out.length', { plan, picks }), 1, 'doublon dans le XML');

console.log('sportscode-import : OK');
