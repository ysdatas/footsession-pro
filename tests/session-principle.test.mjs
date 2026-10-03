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
console.log('session-principle : OK');
