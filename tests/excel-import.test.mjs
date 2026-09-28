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
vm.runInContext(readFileSync('web/assets/js/excel-import.js', 'utf8'), ctx);
const parseExcel = vm.runInContext('parseExcel', ctx);
const workbook = { Sheets: SHEETS, SheetNames: Object.keys(SHEETS) };
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

/* ---------- 6) Import du club : noms présents dans le classeur ---------- */
const excelRoster = vm.runInContext('excelRoster', ctx);
const names = excelRoster(workbook);
assert.equal(names.length, 24, '24 joueurs dans le classeur');
assert.ok(!names.some(n => /moyenne|ecart|n \(/i.test(n.normalize('NFD').replace(/[̀-ͯ]/g, ''))),
  'les lignes agrégées ne sont pas des joueurs');

const split = vm.runInContext('splitExcelName', ctx);
const sp = t => { const r = split(t); return `${r.prenom}|${r.nom}`; };
assert.equal(sp('BERTIN Simon'), 'Simon|BERTIN');
assert.equal(sp('DA SILVA Jean Marc'), 'Jean Marc|DA SILVA', 'nom composé en capitales');
assert.equal(sp('ESTEVE'), '|ESTEVE', 'nom seul');
assert.equal(sp('Simon Bertin'), 'Simon|Bertin', 'sans capitales : dernier mot = nom');

// Nom composé : chaque mot doit être présent, sans assouplir la règle.
const findRow = vm.runInContext('findPlayerRow', ctx);
const rowsDS = [[], [], [], [], [1, 'DA SILVA Jean'], [2, 'SILVA Paulo']];
assert.equal(findRow(rowsDS, { nom: 'Da Silva', prenom: 'Jean' }).index, 4, 'nom composé reconnu');
assert.equal(findRow(rowsDS, { nom: 'Silva', prenom: 'Paulo' }).index, 5, 'homonyme partiel distingué par le prénom');

/* ---------- 7) Fusion avec l'existant : une cellule vide n'efface rien ---------- */
const build = vm.runInContext('buildPlayerImport', ctx);
const simon = parse('Simon', 'Bertin');
const fiche = { id: 40, club_id: 1, nom: 'Bertin', prenom: 'Simon' };
const existingMeasures = [{ id: 9, club_id: 1, player_id: 40, season_key: '2026-2027', month_label: 'Septembre',
  height_cm: 181, weight_kg: 63.0, body_fat_pct: null, source: 'manual', created_at: 'x', updated_at: 'y' }];
const res = build(simon, fiche, { season: '2026-2027', fileName: 'v2.xlsx', userId: 'u1',
  existingMeasures, existingTests: [] });
const merged = res.measurements.find(m => m.month_label === 'Septembre');
assert.equal(merged.height_cm, 181, 'taille saisie à la main conservée (vide dans l’Excel)');
assert.equal(merged.weight_kg, 64.5, 'poids mis à jour par l’Excel');
assert.equal(merged.id, undefined, 'les colonnes techniques ne sont pas renvoyées');
assert.equal(merged.season_key, '2026-2027');
assert.equal(merged.source_file_name, 'v2.xlsx', 'la source reste tracée');
assert.equal(res.changes >= 1 && res.created >= 1, true, 'changements et nouvelles lignes comptés');
// Réimporter le même fichier sur les données fusionnées : aucun changement.
const again = build(simon, fiche, { season: '2026-2027', fileName: 'v2.xlsx', userId: 'u1',
  existingMeasures: res.measurements, existingTests: res.tests });
assert.equal(again.changes, 0, 'réimport à l’identique : rien à changer');
assert.equal(again.created, 0, 'réimport à l’identique : aucune nouvelle ligne');

// Mode remplacer : le fichier fait foi, la taille saisie à la main disparaît.
const replaced = build(simon, fiche, { season: '2026-2027', fileName: 'v2.xlsx', userId: 'u1',
  existingMeasures, existingTests: [], replace: true });
const rSept = replaced.measurements.find(m => m.month_label === 'Septembre');
assert.equal(rSept.height_cm, null, 'remplacer : la valeur absente du fichier n’est pas conservée');
assert.equal(rSept.weight_kg, 64.5);

/* ---------- 8) Orthographe différente : proposition, jamais automatique ---------- */
const lev = vm.runInContext('levenshtein', ctx);
assert.equal(lev('botherel', 'bothorel'), 1);
assert.equal(lev('brunel', 'brunell'), 1);

console.log('OK — import Excel validé sur la structure Tests_Physiques_N2-5 : lecture, noms, fusion, réimport.');
