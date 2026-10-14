/* Restitution d'un procédé (web/assets/js/procedure-time.js) : une ligne
   relue (procFromRow) puis réenregistrée (procRow) doit redonner la même
   ligne, champ par champ ; sameValue compare ce qu'on envoie à ce que la
   base renvoie (nombres numeric, jsonb dont l'ordre des clés change).
   Lancement : node tests/procedure-rows.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ window: {}, Number, String, Math, Date, Set, Object, Array, JSON });
vm.runInContext(readFileSync('web/assets/js/procedure-time.js', 'utf8'), ctx);
const fn = (name) => vm.runInContext(name, ctx);
const procFromRow = fn('procFromRow'), procRow = fn('procRow'), sameValue = fn('sameValue');
const plain = (x) => JSON.parse(JSON.stringify(x));

// Lignes telles que la base les renvoie (procedures + tactical_schemas embarqué).
const base = { session_id: 7, ordre: 1, nom: 'Rondo', duree_min: 15, objectif: null, effectif: null, taille_terrain: null,
  consignes: null, principes_jeu: null, comportements_individuels: null, temps_recup_min: null, type_procede: null,
  nb_sequences: null, duree_sequence_min: null, equipes: [], staff: [], filme: null };
const rows = [
  base,
  { ...base, ordre: 2, nom: 'Durée nulle', duree_min: 0 },
  { ...base, ordre: 3, nom: 'Toro', duree_min: 11.5, nb_sequences: 5, duree_sequence_min: 1.5, temps_recup_min: 0.5,
    type_procede: 'Jeu', objectif: 'Conserver', consignes: 'Ligne 1\nLigne 2\n\nLigne 4', effectif: '4c2', taille_terrain: '20×20' },
  { ...base, ordre: 4, nom: 'Jeu réduit', principes_jeu: 'Pressing', comportements_individuels: 'Orientation du corps',
    equipes: [{ nom: 'Rouges', couleur: '#e53935', player_ids: [3, 8] }, { nom: 'Bleus', couleur: '#1f6feb', player_ids: [] }],
    staff: [{ nom: 'Martin', role: 'Coach' }], filme: false },
];
for (const r of rows) {
  const tactical_schemas = { image_path: `1/procedure-${r.ordre}.png`, canvas_json: { v: 1 }, video_id: 4, updated_at: '2026-10-14T08:00:00Z' };
  const p = procFromRow({ id: 100 + r.ordre, ...r, tactical_schemas }, 'p1');
  assert.deepEqual(plain(procRow(p, r.session_id, r.ordre)), r, `« ${r.nom} » relu puis réenregistré à l'identique`);
  assert.equal(p.image_path, tactical_schemas.image_path);
  assert.equal(p.video_id, 4);
  assert.equal(p.has_canvas, true);
  assert.equal(p.image_v, Date.parse(tactical_schemas.updated_at), 'version de l’image (lmfc_v17.sql)');
}
// Avant : une durée de 0 revenait à 20 au chargement, puis était réenregistrée.
assert.equal(procFromRow({ id: 1, ...base, duree_min: 0 }, 'x').duree_min, 0);
assert.equal(procFromRow({ id: 1, ...base, duree_min: null }, 'x').duree_min, 20, 'sans durée : 20 par défaut');
// Image importée : pas de dessin.
assert.equal(procFromRow({ id: 1, ...base, tactical_schemas: { image_path: 'a.jpg', canvas_json: null } }, 'x').has_canvas, false);
assert.equal(procFromRow({ id: 1, ...base, tactical_schemas: null }, 'x').image_path, null);

// sameValue : ce que la base renvoie contre ce qu'on a envoyé.
assert.ok(sameValue(90, 90) && sameValue('90.00', 90) && sameValue(11.5, '11.50'));
assert.ok(sameValue(null, undefined) && !sameValue(null, 0) && !sameValue('', null));
assert.ok(sameValue({ 12: [10, 20], 7: [1, 2] }, { 7: [1, 2], 12: [10, 20] }), 'jsonb : ordre des clés indifférent');
assert.ok(!sameValue({ 7: [1, 2] }, { 7: [1, 3] }) && !sameValue([], {}) && !sameValue({ a: 1 }, { a: 1, b: 2 }));
assert.ok(sameValue('Ligne 1\nLigne 2', 'Ligne 1\nLigne 2') && !sameValue('a', 'b'));

console.log('procedure-rows : OK (restitution champ par champ, comparaison avec la base)');
