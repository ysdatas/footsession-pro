/* Catégories de la page Bilan (analytics-cats.js) :
     - une catégorie seule : ses séances (communes comprises), ses seules présences ;
       jamais un invité d'une autre équipe ni un joueur que le compte ne voit pas ;
     - plusieurs : une séance commune n'est comptée qu'une fois ;
     - « Toutes » : rien n'est retiré ; comparaison par équipe, plus « Sans équipe » ;
     - saisons du club, filtre de requête, choix une / plusieurs / toutes.
   Lancement : node tests/analytics-cats.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = { window: {},
  escapeHtml: (v) => String(v ?? ''),
  teamName: (id) => ({ 5: 'U14', 6: 'U15', 2: 'N2' })[id] || '',
  sessionTeamIds: (s) => [s?.team_id, ...(s?.other_team_ids || [])].filter(Boolean),   // nav.js
};
vm.createContext(context);
for (const f of ['procedure-time.js', 'perf-metrics.js', 'analytics-cats.js']) {
  vm.runInContext(readFileSync(new URL(`../web/assets/js/${f}`, import.meta.url), 'utf8'), context);
}
const run = (code) => vm.runInContext(code, context);
const J = (x) => JSON.parse(JSON.stringify(x));

const U14 = { team_id: 5, other_team_ids: [] }, U15 = { team_id: 6, other_team_ids: [] }, LES2 = { team_id: 6, other_team_ids: [5] };
const EXT = { team_id: null, other_team_ids: [] };
const at = (players, present, statut = present ? 'present' : 'absent') => ({ present, statut, players });
context.SESSIONS = [
  { id: 1, team_id: 6, other_team_ids: [], procedures: [{ duree_min: 20 }],
    attendance: [at(U15, true), at(U15, false), at(U14, true), at(EXT, true), at(null, true)] },   // invité U14, extérieur, joueur invisible
  { id: 2, team_id: 6, other_team_ids: [5], procedures: [{ duree_min: 15 }], attendance: [at(U15, true), at(U14, false), at(LES2, true)] },   // commune
  { id: 3, team_id: 5, other_team_ids: [], procedures: [{ duree_min: 30 }], attendance: [at(U14, true)] },
  { id: 4, team_id: null, other_team_ids: [], procedures: [{ duree_min: 10 }], attendance: [at(U15, true)] },   // sans équipe
  { id: 5, team_id: 6, other_team_ids: [], procedures: [], attendance: [at(U15, false, 'non_concerne')] },
];
const pick = (sel) => J(run(`pickCats(SESSIONS, ${JSON.stringify(sel)})`));
const kpis = (sel) => J(run(`sessionKpis(pickCats(SESSIONS, ${JSON.stringify(sel)}))`));

/* Une catégorie. */
const u15 = pick([6]);
assert.deepEqual(u15.map(s => s.id), [1, 2, 5], 'U15 : ses séances et la séance commune, pas celle sans équipe');
assert.equal(u15[0].attendance.length, 3, 'U15 : ses 2 joueurs et l’extérieur ; ni l’invité U14 ni le joueur invisible');
assert.deepEqual(u15[1].attendance.map(a => a.players.team_id), [6, 6], 'séance commune : les joueurs U15 (dont celui des deux équipes), pas le joueur U14');
assert.deepEqual(kpis([6]), { sessions: 3, procedures: 2, presence: 80, volume: 35 }, 'U15 : 4 présents sur 5 notés (retiré exclu)');
assert.deepEqual(kpis([5]), { sessions: 2, procedures: 2, presence: 67, volume: 45 }, 'U14 : la commune et la sienne ; 2 présents sur 3');

/* Plusieurs, puis toutes. */
assert.deepEqual(kpis([5, 6]).sessions, 4, 'U14 + U15 : la séance commune une seule fois');
assert.deepEqual(kpis([]), { sessions: 5, procedures: 4, presence: 80, volume: 75 }, 'toutes : rien de retiré (8 présents sur 10)');
assert.equal(J(run(`sessionKpis([])`)).presence, null, 'aucune présence notée : pas de 0 %');

/* Comparaison. */
const cmp = J(run(`compareRows(SESSIONS, [], [5, 6, 2])`));
assert.deepEqual(cmp.map(r => [r.label, r.sessions]), [['U14', 2], ['U15', 3], ['N2', 0], ['Sans équipe', 1]], 'toutes : chaque équipe du compte, puis les séances sans équipe');
assert.deepEqual(J(run(`compareRows(SESSIONS, [6, 5], [5, 6, 2])`)).map(r => r.label), ['U15', 'U14'], 'choix : les catégories choisies seulement');
assert.deepEqual(J(run(`compareRows(SESSIONS, [6], [5, 6, 2])`)), [], 'une seule catégorie : pas de comparaison');

/* Libellés, filtre de requête. */
assert.equal(run(`catsLabel([])`), 'Toutes les catégories');
assert.equal(run(`catsLabel([6, 5])`), 'U15 + U14');
assert.equal(run(`catsFilter([6, 5])`), 'team_id.in.(6,5),other_team_ids.ov.{6,5}');

/* Saisons. */
assert.deepEqual(J(run(`seasonBounds('2026-2027', 8)`)), { from: '2026-08-01', to: '2027-07-31' }, 'août à juillet');
assert.deepEqual(J(run(`seasonBounds('2026-2027', 7)`)), { from: '2026-07-01', to: '2027-06-30' }, 'juillet à juin');
assert.deepEqual(J(run(`seasonBounds('2026-2027', 1)`)), { from: '2026-01-01', to: '2026-12-31' }, 'année civile');
const seasons = J(run(`seasonsFrom('2024-09-10', 8)`));
assert.equal(seasons[0], run(`seasonKeyFor(null, 8)`), 'la saison actuelle d’abord');
assert.equal(seasons.at(-1), '2024-2025', 'jusqu’à celle de la première séance');
assert.deepEqual(J(run(`seasonsFrom(null, 8)`)), [seasons[0]], 'sans séance : l’actuelle seule');

/* Boutons : une, plusieurs, toutes. */
run(`var CHOIX = []; var BOX = { innerHTML: '', addEventListener(t, fn) { this.click = fn; } };
renderCatSwitch(BOX, [{ id: 5, nom: 'U14' }, { id: 6, nom: 'U15' }, { id: 2, nom: 'N2' }], [], (sel) => CHOIX.push(sel));`);
const click = (cat) => run(`BOX.click({ target: { closest: () => ({ dataset: { cat: '${cat}' } }) } }); BOX.innerHTML`);
click(6); click(5); click(6);
const html = click('');
assert.deepEqual(J(run('CHOIX')), [[6], [5, 6], [5], []], 'un clic ajoute ou retire, dans l’ordre des équipes ; « Toutes » vide le choix');
assert.match(html, /data-cat="" aria-pressed="true">Toutes les catégories/);
assert.match(click(2), /data-cat="2" aria-pressed="true">N2/);
console.log('analytics-cats : OK');
