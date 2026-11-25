/* À remplir du joueur (web/assets/js/player-todo.js, ptBuild) : un questionnaire par
   séance ou match et par moment, toujours sous le même nom, jamais celui d'une équipe :
     - effort à noter et ses questions ajoutées : « Questionnaire après séance », ensemble ;
     - courbatures et questionnaire du jour (avec la séance du jour) : « pré-séance » ;
     - questions ajoutées restées seules (RPE déjà noté) : toujours « après séance » ;
     - avant le match / après le match ; jour sans séance : « Questionnaire du jour » ;
     - avis de match : deux jours au plus, pas s'il est donné ;
     - séance dont la demi-journée est déjà notée ailleurs (lmfc_v71.sql) : rien ;
     - formulaire « une fois » : son nom, sans « — équipes » ; rangés : aujourd'hui d'abord.
   Lancement : node tests/player-todo.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ String, Number, Math, Set, Map, Date, Intl, JSON, Object, Array, RegExp, window: {} });
for (const f of ['rpe.js', 'match-feedback.js', 'player-todo.js']) vm.runInContext(readFileSync(`web/assets/js/${f}`, 'utf8'), ctx);
const day = (n) => vm.runInContext(`ptDay(${n})`, ctx);
const build = (data) => JSON.parse(vm.runInContext(`JSON.stringify(ptBuild(${JSON.stringify({ rpe: [], sore: null, avis: [], feedback: [], forms: [], ...data })}))`, ctx));

const rpeQs = [{ id: 'rpe', label: 'Effort ?', type: 'scale', min: 1, max: 10, fixe: true }, { id: 'plaisir', label: 'Plaisir ?', type: 'scale', min: 0, max: 10 }];
const rows = [
  { id: 1, match: false, titre: 'Séance Espoirs', date: day(1), date_seance: day(1), heure: '16:30:00', rpe: null, form_questions: rpeQs },
  { id: 2, match: false, titre: 'Séance N2', date: day(0), date_seance: day(0), heure: '00:00:00', rpe: 5, form_questions: rpeQs },
  { id: 3, match: false, titre: 'Séance J3', date: day(3), date_seance: day(3), heure: '10:00:00', rpe: null, form_questions: rpeQs },
  { id: 9, match: true, titre: 'Match contre Hope', date: day(1), date_seance: day(1), heure: '15:00:00', rpe: null, form_questions: [] },
  { id: 5, match: false, titre: 'Séance Pro', date: day(1), date_seance: day(1), heure: '16:00:00', rpe: null, form_questions: rpeQs, ailleurs: 'Séance N2 – N2 à 16:30' },
];
const items = build({
  rpe: rows,
  sore: { session_id: 2, titre: 'Séance N2', heure: '00:00:00', niveau: null, form_questions: [] },
  avis: [{ match_id: 9, date_match: day(1), titre: 'Hope', form_questions: [] }, { match_id: 8, date_match: day(5), titre: 'Vieux', form_questions: [] },
    { match_id: 7, date_match: day(0), titre: 'Déjà', form_questions: [] }],
  feedback: [{ match_id: 7, individuel: 'Bien', collectif: null }],
  forms: [
    { version_id: 50, titre: 'Après séance — N2 et Espoirs · Séance N2 · 23/11/2026', occurrence: 's2', jour: day(0), questions: [rpeQs[1]] },
    { version_id: 51, titre: 'Forme du jour · 23/11/2026', occurrence: `j${day(0)}`, jour: day(0), questions: [{ id: 'f', label: 'Forme ?', type: 'boolean' }] },
    { version_id: 52, titre: 'Forme du jour · avant-hier', occurrence: `j${day(2)}`, jour: day(2), questions: [{ id: 'f', label: 'Forme ?', type: 'boolean' }] },
    { version_id: 53, titre: 'Avant le match · Match contre Lens · 24/11/2026', occurrence: 'm12', jour: day(0), questions: [{ id: 'a', label: 'Prêt ?', type: 'boolean' }] },
    { version_id: 54, titre: 'Bilan de la semaine — Espoirs', occurrence: '', jour: null, questions: [{ id: 'b', label: 'Bilan ?', type: 'text' }] },
    { version_id: 55, titre: 'Forme · Avant le match contre Rennes · 24/11/2026', occurrence: 'm13', jour: day(0), questions: [{ id: 'r', label: 'Prêt ?', type: 'boolean' }] },
    { version_id: 56, titre: 'Bilan perso · Match contre Hope · 24/11/2026', occurrence: 'm9', jour: day(1), questions: [{ id: 'h', label: 'Bilan ?', type: 'text' }] },
  ],
});
const byKey = Object.fromEntries(items.map(x => [x.key, x]));

// Effort et questions ajoutées : un seul questionnaire après séance.
assert.equal(byKey['s1:post'].label, 'Questionnaire après séance');
assert.deepEqual(byKey['s1:post'].parts.map(p => p.type), ['rpe']);
assert.deepEqual(byKey['s1:post'].parts[0].extras.map(q => q.id), ['plaisir'], 'les questions ajoutées viennent avec l’effort');
assert.equal(byKey['s1:post'].titre, 'Séance Espoirs');
assert.ok(!byKey['s3:post'], 'J-3 : plus proposé');
assert.ok(!byKey['s5:post'], 'effort de la demi-journée déjà noté à une autre séance (lmfc_v71.sql) : rien à remplir');
// Courbatures et questionnaire du jour : pré-séance de la séance du jour.
assert.equal(byKey['s2:pre'].label, 'Questionnaire pré-séance');
assert.deepEqual(byKey['s2:pre'].parts.map(p => p.type), ['sore', 'form']);
// RPE déjà noté : ses questions ajoutées restent « après séance », sans le nom réglé par le staff.
assert.equal(byKey['s2:post'].label, 'Questionnaire après séance');
assert.ok(!JSON.stringify(items.map(x => [x.label, x.titre])).includes('N2 et Espoirs'), 'jamais le nom des équipes');
// Jour sans séance, avant et après match.
assert.equal(byKey[`j${day(2)}:pre`].label, 'Questionnaire du jour', 'jour sans séance');
assert.equal(byKey['m12:pre'].label, 'Questionnaire avant match');
assert.equal(byKey['m12:pre'].titre, 'Lens');
assert.equal(byKey['m13:pre'].titre, 'Rennes', 'avant match planifié (lmfc_v65.sql) : nom du formulaire d’abord, puis « Avant le match contre »');
assert.deepEqual(byKey['m9:post'].parts.map(p => p.type), ['rpe', 'avis', 'form'], 'après match (lmfc_v72.sql) : avec l’effort et l’avis');
assert.equal(byKey['m9:post'].titre, 'Hope');
assert.ok(!byKey['m8:post'] && !byKey['m7:post'], 'avis : deux jours au plus, et pas s’il est donné');
// Une fois : son nom, sans les équipes ; à la fin.
assert.equal(byKey.f54.label, 'Bilan de la semaine');
assert.equal(items.at(-1).key, 'f54');
// Aujourd'hui d'abord ; avant puis après.
assert.deepEqual(items.slice(0, 3).map(x => x.key), ['s2:pre', 's2:post', 'm12:pre'], 'aujourd’hui d’abord, par heure (sans heure : à la fin du jour)');
assert.equal(vm.runInContext(`ptSub(${JSON.stringify(byKey['m9:post'])})`, ctx), 'Match contre Hope | hier à 15:00');
assert.equal(vm.runInContext(`ptTitle('Après séance — N2 et Espoirs · Séance · 21/11/2026')`, ctx), 'Après séance');

console.log('player-todo : OK (regroupement, noms, deux jours, ordre)');
