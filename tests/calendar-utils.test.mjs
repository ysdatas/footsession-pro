/* Dates du calendrier (web/assets/js/calendar-utils.js) : semaine du lundi,
   mois sur 6 semaines, changements d'année, passage à l'heure d'hiver.
   Lancement : node tests/calendar-utils.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

process.env.TZ = 'Europe/Paris';
const ctx = vm.createContext({ String, Number, Date, Intl });
vm.runInContext(readFileSync('web/assets/js/calendar-utils.js', 'utf8'), ctx);
const run = (code) => vm.runInContext(code, ctx);

assert.equal(run(`calMonday('2026-11-01')`), '2026-10-26', 'dimanche : lundi précédent');
assert.equal(run(`calMonday('2026-11-02')`), '2026-11-02', 'lundi : lui-même');
assert.equal(run(`calAddDays('2026-10-24', 7)`), '2026-10-31', 'passage à l’heure d’hiver (25 octobre) : pas de décalage');
assert.equal(run(`calAddDays('2026-12-28', 7)`), '2027-01-04', 'changement d’année');
assert.deepEqual({ ...run(`calRange('month', '2026-11-17')`) }, { from: '2026-10-26', to: '2026-12-06' }, 'novembre : 42 jours dès le lundi');
assert.deepEqual({ ...run(`calRange('month', '2026-02-10')`) }, { from: '2026-01-26', to: '2026-03-08' }, 'février commençant un dimanche');
assert.deepEqual({ ...run(`calRange('week', '2026-11-05')`) }, { from: '2026-11-02', to: '2026-11-08' });
assert.deepEqual({ ...run(`calRange('list', '2026-10-29')`) }, { from: '2026-10-29', to: '2026-12-27' }, 'à venir : 60 jours');
assert.equal(run(`calMove('month', '2026-01-31', 1)`), '2026-02-01', '31 janvier + 1 mois : février, pas mars');
assert.equal(run(`calMove('month', '2026-01-15', -1)`), '2025-12-01');
assert.equal(run(`calMove('week', '2026-12-30', 1)`), '2027-01-06');
assert.equal(run(`calTitle('month', '2026-11-17')`), 'Novembre 2026');
assert.equal(run(`calTitle('week', '2026-11-05')`), 'Semaine du 2 au 8 nov. 2026');
assert.equal(run(`calTitle('week', '2026-10-29')`), 'Semaine du 26 oct. au 1 nov. 2026');
assert.equal(run(`calDayLabel('2026-11-03')`), 'mardi 3 novembre');
console.log('calendar-utils : OK');
