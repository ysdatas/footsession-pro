/* Clés des tags et de la recherche de la bibliothèque vidéo
   (web/assets/js/library.js) : deux écritures d'un même tag donnent la
   même clé. Les mêmes cas passent côté base dans library-sql.test.mjs
   (library_tag_key, lmfc_v24.sql) : la page et la base s'accordent.
   Lancement : node tests/library-logic.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const TAG_CASES = [
  ['#Rondo', 'rondo'], ['  # rondo ', 'rondo'], ['RONDO', 'rondo'],
  ['Réversibilité', 'reversibilite'], ['#reversibilite', 'reversibilite'], ['Ré-versi bilité', 'reversibilite'],
  ['7c7', '7c7'], ['7 C 7', '7c7'], ['7 vs 7', '7vs7'], ['Œuvre collective', 'oeuvrecollective'],
  ['Conservation_à 4', 'conservationa4'], ['Pressing / contre-pressing', 'pressingcontrepressing'],
  ['Jeu à 1 touche !', 'jeua1touche'], ['Straße', 'strasse'], ['Ñandú', 'nandu'], ['###', ''],
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const ctx = vm.createContext({ String });
  vm.runInContext(readFileSync('web/assets/js/library.js', 'utf8'), ctx);
  const run = (code) => vm.runInContext(code, ctx);
  for (const [raw, key] of TAG_CASES) assert.equal(run(`libTagKey(${JSON.stringify(raw)})`), key, raw);
  assert.equal(run(`libTextKey('Échauffement : rondo 4c2')`), 'echauffement rondo 4c2', 'texte : mots gardés');
  assert.equal(run(`libTagClean('  ##  Rondo   orienté ')`), 'Rondo orienté', 'libellé affiché : sans #, espaces réduits');
  console.log(`library-logic : OK (${TAG_CASES.length} écritures de tags)`);
}
