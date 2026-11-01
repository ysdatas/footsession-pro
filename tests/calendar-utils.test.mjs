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

/* ---------- calRepeat : dates d'une série ---------- */
const rep = (o) => JSON.parse(JSON.stringify(run(`calRepeat(${JSON.stringify(o)})`)));
const mardiJeudi = rep({ start: '2026-11-03', days: [1, 3], until: '2026-11-19' });
assert.deepEqual(mardiJeudi.dates, ['2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12', '2026-11-17', '2026-11-19'], 'mardi et jeudi, jusqu’à la date incluse');
assert.deepEqual(rep({ start: '2026-11-04', days: [1, 3], count: 3 }).dates, ['2026-11-05', '2026-11-10', '2026-11-12'], 'départ un mercredi : pas de mardi passé ; 3 fois');
assert.deepEqual(rep({ start: '2026-11-02', every: 2, days: [0], count: 3 }).dates, ['2026-11-02', '2026-11-16', '2026-11-30'], 'toutes les 2 semaines');
assert.deepEqual(rep({ start: '2026-10-22', days: [3], until: '2026-11-05' }).dates, ['2026-10-22', '2026-10-29', '2026-11-05'], 'passage à l’heure d’hiver (25/10/2026) sans décalage');
assert.deepEqual(rep({ start: '2027-03-25', days: [3], count: 2 }).dates, ['2027-03-25', '2027-04-01'], 'passage à l’heure d’été (28/03/2027)');
assert.deepEqual(rep({ start: '2028-02-28', days: [0, 1, 2], count: 3 }).dates, ['2028-02-28', '2028-02-29', '2028-03-01'], 'année bissextile : lundi 28, mardi 29 février, mercredi 1er mars');
const n2 = rep({ start: '2027-01-01', days: [3, 4], until: '2027-07-06' });
assert.deepEqual([n2.dates[0], n2.dates.at(-1), n2.dates.length, n2.capped], ['2027-01-01', '2027-07-02', 53, false], 'N2 : jeudis et vendredis du 1er janvier au 6 juillet');
const long = rep({ start: '2026-11-02', days: [0, 1, 2, 3, 4, 5, 6], until: '2027-12-31' });
assert.deepEqual([long.dates.length, long.capped], [120, true], '120 dates au plus, signalé');
assert.deepEqual(rep({ start: '2026-11-02', days: [0], count: 200 }).dates.length, 120);
assert.deepEqual(rep({ start: '2026-11-02', days: [], count: 5 }).dates, ['2026-11-02'], 'aucun jour coché : la date seule');

console.log('calendar-utils : OK');
