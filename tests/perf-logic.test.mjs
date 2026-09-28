/* Vérification minimale des deux logiques qui ont déjà cassé :
   - la détection du joueur dans l'Excel (un nombre comme 1,77 ne doit
     jamais être pris pour un nom) ;
   - le radar, qui ne doit relier que les axes réellement renseignés.
   Lancement : node tests/perf-logic.test.mjs
   Le fichier de page est chargé dans un contexte vm avec un DOM factice :
   pas de framework, pas de build. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const stubEl = new Proxy({}, {
  get: (_, k) =>
    k === 'classList' ? stubEl
    : k === 'dataset' ? {}
    : k === 'value' || k === 'textContent' || k === 'innerHTML' || k === 'href' ? ''
    : k === 'files' ? []
    : k === 'getAttribute' ? (() => '')
    : () => stubEl,
});
const document = {
  getElementById: () => stubEl,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => stubEl,
  head: stubEl, body: stubEl,
  addEventListener() {}, removeEventListener() {},
};

const ctx = vm.createContext({
  document,
  window: { location: { search: '', href: '' }, addEventListener() {} },
  location: { search: '' },
  URLSearchParams,
  sb: { auth: { getSession: async () => ({ data: { session: null } }) } },
  XLSX: {},
  requireAuth: async () => null,     // loadPage() sort immédiatement
  setTimeout, clearTimeout, console, Number, Math, String, Boolean, Set, Map, Promise, JSON, Object, Array, Date,
});
vm.runInContext(readFileSync('web/assets/js/player-performance-page.js', 'utf8'), ctx);

/* ---------- 1) Détection du joueur dans l'Excel ---------- */
vm.runInContext(`player = { prenom: 'Simon', nom: 'Bertin' };`, ctx);
const findPlayerRow = rows => vm.runInContext('findPlayerRow', ctx)(rows);

// 4 lignes d'en-tête, puis des données. 1,77 / 1,87 sont des tailles.
const header = [[], [], [], []];
const rows = [
  ...header,
  [1, 'ARNOUX Nathan', 1.77, 72.4],
  [2, 'BERTIN Simon', 1.87, 64.5],
  ['', 'Moyenne', 1.82, 68.4],
];
assert.equal(findPlayerRow(rows).index, 5, 'la ligne du joueur ciblé doit être trouvée');
assert.equal(findPlayerRow(rows).name, 'BERTIN Simon');

// Nom seul, ordre inversé, et rien qui ressemble à un nombre.
assert.equal(findPlayerRow([...header, [1, 'Simon Bertin']]).index, 4, 'ordre prénom/nom inversé');
assert.equal(findPlayerRow([...header, [1, 'Bertin']]).index, 4, 'nom de famille seul');
assert.equal(findPlayerRow([...header, [1, 1.77, 1.87, 64.5]]), null,
  'aucun nombre ne doit être interprété comme un nom');
assert.equal(findPlayerRow([...header, [1, 'Moyenne'], [2, 'Ecart type']]), null,
  'les lignes agrégées ne sont pas des joueurs');

/* ---------- 2) Radar et données partielles ---------- */
const radarSvg = vm.runInContext('radarSvg', ctx);
const axes = ['profile_start', 'profile_agility', 'profile_speed', 'profile_endurance', 'profile_core'];
const testWith = n => Object.fromEntries(axes.slice(0, n).map(k => [k, 6]));
const pointCount = svg => (svg.match(/class="radar-area-dot"/g) || []).length;
const polyPoints = svg => {
  const m = svg.match(/<poly(?:gon|line) points="([^"]+)" class="radar-area/);
  return m ? m[1].trim().split(/\s+/).length : 0;
};
const refPoints = svg => (svg.match(/class="radar-ref-dot"/g) || []).length;

for (const n of [0, 1, 2, 3, 4, 5]) {
  const svg = radarSvg(testWith(n));
  assert.equal(pointCount(svg), n, `${n} valeur(s) => ${n} point(s) tracé(s)`);
  // On ne relie jamais plus de points qu'il n'y a de valeurs : aucun axe
  // manquant ne doit être ramené au centre du radar.
  assert.equal(polyPoints(svg), n >= 2 ? n : 0, `${n} valeur(s) => tracé sur ${n} sommets`);
}
assert.ok(radarSvg(testWith(2)).includes('<polyline'), '2 valeurs => un trait, pas un polygone');
assert.ok(radarSvg(testWith(3)).includes('<polygon points'), '3 valeurs => un polygone');
assert.equal(radarSvg(testWith(5)).includes('radar-area-dot'), true);

/* ---------- 3) Série « moyenne du club » ---------- */
// Sans moyennes chargées, une seule série est tracée.
assert.equal(refPoints(radarSvg(testWith(5))), 0, 'pas de moyenne club => pas de 2e série');
vm.runInContext(`clubAverages = { profile_start: 5, profile_agility: 5.2, profile_speed: 4.8 };`, ctx);
const withRef = radarSvg(testWith(5));
assert.equal(refPoints(withRef), 3, 'la moyenne club ne trace que ses axes renseignés');
assert.equal(pointCount(withRef), 5, 'la série du joueur reste complète');
assert.ok(withRef.indexOf('radar-ref') < withRef.indexOf('class="radar-area"'),
  'la moyenne club passe sous le joueur');
vm.runInContext(`clubAverages = null;`, ctx);

console.log('OK — détection Excel et radar partiel vérifiés.');
