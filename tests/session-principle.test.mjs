/* Principe de jeu : saisi une fois par séance (web/assets/js/procedure-time.js).
   Une ancienne séance le retrouve dans ses procédés ; un ancien procédé
   qui avait le sien le garde, les autres héritent de la séance.
   Lancement : node tests/session-principle.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ window: {}, Number, String, Math, Date, Set });
vm.runInContext(readFileSync('web/assets/js/procedure-time.js', 'utf8'), ctx);
const { sessionPrinciple, procPrinciple } = ctx.window;

assert.equal(sessionPrinciple({ principes_jeu: '  Conservation ' }, [{ principes_jeu: 'Autre' }]), 'Conservation', 'la séance fait foi');
assert.equal(sessionPrinciple({ principes_jeu: null }, [{ principes_jeu: 'Transitions' }, { principes_jeu: ' Transitions' }, { principes_jeu: 'Pressing' }, {}]),
  'Transitions · Pressing', 'ancienne séance : principes de ses procédés, sans doublon, dans l’ordre');
assert.equal(sessionPrinciple({}, []), '', 'rien : vide (affiché « — »)');
assert.equal(procPrinciple({ principes_jeu: '' }, { principes_jeu: 'Jeu de position' }), 'Jeu de position', 'un procédé hérite de la séance');
assert.equal(procPrinciple({ principes_jeu: 'Pressing' }, { principes_jeu: 'Jeu de position' }), 'Pressing', 'un ancien procédé garde le sien');

// Statuts, équipes par procédé, vidéo (lmfc_v9.sql).
const run = (expr) => JSON.parse(JSON.stringify(vm.runInContext(expr, ctx) ?? null));   // valeurs du contexte VM → valeurs d'ici
assert.equal(run(`statutOf({ present: true })`), 'present', 'ancienne présence : présent');
assert.equal(run(`statutOf(null)`), 'absent', 'sans ligne : absent');
assert.equal(run(`statutOf({ statut: 'blesse', present: true })`), 'blesse', 'le statut fait foi');
assert.deepEqual(run(`['present','reprise','retard','absent','blesse'].map(statut => participe({ statut }))`), [true, true, true, false, false]);
const legacy = { equipes: [{ nom: 'Bleus', player_ids: [1] }] };
assert.equal(run(`procTeamsOf({}, ${JSON.stringify(legacy)}, [{}, {}])`)[0].nom, 'Bleus', 'ancienne séance : chasubles de la séance');
assert.deepEqual(run(`procTeamsOf({ equipes: [] }, ${JSON.stringify(legacy)}, [{ equipes: [{ nom: 'Rouges' }] }, { equipes: [] }])`), [],
  'dès qu’un procédé a ses équipes, chacun garde les siennes');
assert.deepEqual(run(`[procIsFilmed({}, { filmee: true }), procIsFilmed({ filme: false }, { filmee: true }), procIsFilmed({}, { filmee: false })]`), [true, false, false]);
assert.equal(run(`isVideoRole('Gestion vidéo') && isVideoRole('VIDEO') && !isVideoRole('Animation')`), true);
console.log('session-principle : OK');
