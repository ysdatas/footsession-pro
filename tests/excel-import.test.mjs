/* Import Excel vérifié contre la structure RÉELLE du classeur du préparateur.
   La fixture est une extraction de Tests_Physiques_N2-5.xlsx : structure et
   valeurs d'origine conservées, noms de joueurs remplacés par des noms fictifs
   — le dépôt n'a pas à contenir les données corporelles de joueurs réels.
   On vérifie les trois exigences de l'audit :
     1. les valeurs réellement présentes sont importées à l'identique ;
     2. les cellules vides restent vides (aucune valeur inventée) ;
     3. deux joueurs ne partagent jamais leurs données.
   Lancement : node tests/excel-import.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SHEETS = JSON.parse(readFileSync(new URL('./fixtures-tests-physiques.json', import.meta.url)));

const stubEl = new Proxy({}, { get: (_, k) =>
  k === 'classList' ? stubEl : k === 'dataset' ? {} :
  ['value','textContent','innerHTML','href'].includes(k) ? '' :
  k === 'files' ? [] : k === 'getAttribute' ? (() => '') : () => stubEl });

const ctx = vm.createContext({
  document: { getElementById: () => stubEl, querySelector: () => null, querySelectorAll: () => [],
              createElement: () => stubEl, head: stubEl, body: stubEl, addEventListener() {} },
  window: { location: { search: '', href: '' }, addEventListener() {} },
  location: { search: '' }, URLSearchParams,
  sb: { auth: { getSession: async () => ({ data: { session: null } }) } },
  // Le parseur n'utilise de XLSX que sheet_to_json ; on lui sert le vrai
  // classeur déjà converti en tableaux, donc aucune dépendance npm.
  XLSX: { utils: { sheet_to_json: sheet => sheet } },
  requireAuth: async () => null,
  setTimeout, clearTimeout, console,
  Number, Math, String, Boolean, Set, Map, Promise, JSON, Object, Array, Date,
});
vm.runInContext(readFileSync('web/assets/js/perf-metrics.js', 'utf8'), ctx);
vm.runInContext(readFileSync('web/assets/js/player-performance-page.js', 'utf8'), ctx);
vm.runInContext(`importState.workbook = { Sheets: ${JSON.stringify(SHEETS)}, SheetNames: ${JSON.stringify(Object.keys(SHEETS))} };`, ctx);

const parseExcel = vm.runInContext('parseExcel', ctx);
const workbook = vm.runInContext('importState.workbook', ctx);
const file = { name: 'Tests_Physiques_N2-5.xlsx' };
const parse = (prenom, nom) => parseExcel(file, workbook, { id: 1, club_id: 1, prenom, nom });

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-4, `${a} ≈ ${b}`);

/* ---------- 1) Le cas « fiche presque vide » du dossier d'audit ----------
   Fiche quasi vide : seuls poids, VIFT, Shirado, Sorensen, Endurance et
   Core existent dans le classeur. Tout le reste doit rester absent. */
const sacha = parse('Simon', 'Bertin');
assert.equal(sacha.individualSheet, 'BERTIN', 'onglet individuel détecté');

const sept = sacha.measurements.find(m => m.month_label === 'Septembre');
assert.ok(sept, 'une mesure existe pour Septembre');
assert.equal(sept.weight_kg, 64.5, 'poids 64,5 kg');
assert.equal(sept.height_cm, null, 'taille absente du fichier => reste absente');
assert.equal(sept.body_fat_pct, null, 'masse grasse absente => reste absente');
assert.equal(sacha.measurements.length, 1, 'un seul mois renseigné, pas de mois fabriqué');

const pre = sacha.tests.find(t => t.stage === 'pre');
assert.equal(pre.vift_kmh, 20.5, 'VIFT 20,5 km/h');
assert.equal(pre.shirado_sec, 240, 'Shirado 240 s');
assert.equal(pre.sorensen_sec, 120, 'Sorensen 120 s');
assert.equal(pre.core_ratio, 2, 'ratio Shirado/Sorensen = 2 (onglet individuel)');
near(pre.profile_endurance, 4.7145);
near(pre.profile_core, 6.6525);
for (const k of ['sprint10_sec','five05_left_sec','five05_right_sec','sprint40_sec','profile_start','profile_agility','profile_speed'])
  assert.equal(pre[k], null, `${k} absent du fichier => reste null`);
assert.ok(!sacha.tests.some(t => t.stage !== 'pre'), 'aucune session mi/fin inventée');

/* ---------- 2) Nom reconnu quel que soit l'ordre prénom/nom ---------- */
for (const [p, n] of [['Nathan','Arnoux'], ['Arnoux','Nathan'], [null,'ARNOUX']]) {
  const a = parse(p, n);
  const t = a.tests.find(x => x.stage === 'pre');
  assert.equal(t.sprint10_sec, 1.95, `Sprint 10 m (${p} / ${n})`);
  assert.equal(t.vift_kmh, 20.5);
  assert.equal(a.measurements.find(m => m.month_label === 'Septembre').weight_kg, 75, 'poids');
}

/* ---------- 3) Aucun mélange entre joueurs ---------- */
const lucas = parse('Louis', 'Brunel');
const lt = lucas.tests.find(t => t.stage === 'pre');
assert.equal(lt.sprint10_sec, null, 'Sprint 10 m vide ici : celui du joueur voisin ne fuit pas');
assert.equal(lt.five05_left_sec, 2.21, 'valeur propre à ce joueur');
assert.equal(lt.shirado_sec, 150);
assert.notEqual(lt.shirado_sec, pre.shirado_sec, 'Shirado distinct du premier joueur');
assert.equal(lucas.measurements.find(m => m.month_label === 'Septembre').weight_kg, 73.5);

/* ---------- 4) Les lignes agrégées ne sont jamais des joueurs ---------- */
for (const nom of ['Moyenne', 'Écart-type', 'N'])
  assert.throws(() => parse(null, nom), /pas été trouvé/, `« ${nom} » n'est pas un joueur`);

/* ---------- 5) Un joueur absent du classeur échoue proprement ---------- */
assert.throws(() => parse('Jean', 'Inexistant'), /pas été trouvé dans cet Excel/);

console.log('OK — import Excel validé sur la structure Tests_Physiques_N2-5 (3 joueurs).');
