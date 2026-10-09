/* Temps d'un procédé avec des durées à virgule, statuts de présence
   (web/assets/js/procedure-time.js, lmfc_v12.sql).
   Lancement : node tests/procedure-time.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ window: {}, Number, String, Math, Date, Set, Object });
vm.runInContext(readFileSync('web/assets/js/procedure-time.js', 'utf8'), ctx);
const run = (expr) => JSON.parse(JSON.stringify(vm.runInContext(expr, ctx) ?? null));

// Durées entières : inchangé.
const p3x4 = { nb_sequences: 3, duree_sequence_min: 4, temps_recup_min: 1 };
assert.deepEqual(run(`[workMin(${JSON.stringify(p3x4)}), recupMin(${JSON.stringify(p3x4)}), totalMin(${JSON.stringify(p3x4)}), sequenceLabel(${JSON.stringify(p3x4)})]`),
  [12, 2, 14, "3 × 4' + 1' récup"]);
// 5 × 1,5' + 1' de récup : 7,5' de travail, 4' de récup, 11,5' au total.
const toro = { nb_sequences: 5, duree_sequence_min: 1.5, temps_recup_min: 1 };
assert.deepEqual(run(`[workMin(${JSON.stringify(toro)}), totalMin(${JSON.stringify(toro)}), sequenceLabel(${JSON.stringify(toro)}), fmtMin(totalMin(${JSON.stringify(toro)}))]`),
  [7.5, 11.5, "5 × 1,5' + 1' récup", '11,5']);
// Récup de 0,5' et séquence de 1,25' : jamais arrondies.
const rondo = { nb_sequences: 3, duree_sequence_min: 1.25, temps_recup_min: 0.5 };
assert.deepEqual(run(`[totalMin(${JSON.stringify(rondo)}), sequenceLabel(${JSON.stringify(rondo)})]`), [4.75, "3 × 1,25' + 0,5' récup"]);
assert.equal(run(`fmtMin(87.5)`), '87,5');
assert.equal(run(`fmtMin('20.00')`), '20', 'valeur numeric lue en base');
// Saisie : virgule ou point, vide ou illisible.
assert.deepEqual(run(`['1,5', '1.5', ' 11,5 ', '', 'abc', null].map(parseDecimal)`), [1.5, 1.5, 11.5, '', '', '']);
assert.deepEqual(run(`[decStr(1.5), decStr(''), decStr(null), decStr(20)]`), ['1,5', '', '', '20']);

// Statuts (lmfc_v12.sql) : groupe pro hors séance, « autre » selon sa case.
assert.deepEqual(run(`[{ statut: 'present' }, { statut: 'retard' }, { statut: 'groupe_pro', present: true }, { statut: 'autre', present: true }, { statut: 'autre', present: false }].map(participe)`),
  [true, true, false, true, false]);
assert.deepEqual(run(`[statutLabel({ statut: 'autre', statut_libre: ' Soins ' }), statutLabel({ statut: 'autre' }), statutLabel({ statut: 'malade' }), statutLabel({ statut: 'groupe_pro' })]`),
  ['Soins', 'Autre', 'Malade', 'Groupe pro']);
assert.ok(!run(`STATUTS.map(s => s.key)`).some(k => ['retard', 'excuse', 'malade'].includes(k)), 'plus proposés');

console.log('procedure-time : OK');
