/* Menu latéral (web/assets/js/nav.js) : rubriques par rôle, ordre et
   masquage choisis par l'utilisateur, pages interdites, équipe courante.
   Lancement : node tests/nav.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let redirected = null;
const window = {
  location: { pathname: '/club', replace: (url) => { redirected = url; } },
  CLUB_TEAMS: [{ id: 3, nom: 'N2' }, { id: 5, nom: 'U19' }],
  CURRENT_PROFILE: { prefs: {} },
};
const ctx = vm.createContext({ window, console, Number, Set, Map });
vm.runInContext(readFileSync('web/assets/js/nav.js', 'utf8'), ctx);
const run = (code) => vm.runInContext(code, ctx);
const keys = (role, prefs) => run(`orderedNavItems(${JSON.stringify(role)}, ${JSON.stringify(prefs)})`)
  .filter(i => !i.hidden).map(i => i.key);

// Trois comptes : le coach a tout le travail du staff, pas la gestion du club.
assert.ok(keys('coach', {}).includes('videos'), 'coach : Vidéos');
assert.ok(!keys('coach', {}).includes('club'), 'coach : pas de Mon club');
assert.ok(keys('admin', {}).includes('club'), 'admin : Mon club');

// Préparateur physique : performance et joueurs, ni séances, ni vidéos, ni tableau.
const prepa = keys('prepa', {});
for (const k of ['dashboard', 'players', 'performance', 'faq']) assert.ok(prepa.includes(k), `prépa : ${k}`);
for (const k of ['sessions', 'videos', 'tactical', 'analytics', 'club']) assert.ok(!prepa.includes(k), `prépa : pas de ${k}`);
// Un joueur n'a aucune rubrique du staff.
assert.equal(keys('joueur', {}).length, 0, 'joueur : pas de menu staff');

// Ordre et masquage choisis par l'utilisateur.
const prefs = { nav: { order: ['players', 'dashboard', 'sessions'], hidden: ['analytics'] } };
const mine = keys('admin', prefs);
assert.equal(mine.slice(0, 3).join(), 'players,dashboard,sessions', 'ordre personnalisé');
assert.ok(!mine.includes('analytics'), 'rubrique masquée');
// Paramètres n'est pas une rubrique : on y accède par son nom, en bas du menu.
assert.ok(!keys('admin', {}).includes('settings'), 'Paramètres hors du menu');
// Une rubrique absente de l'ordre enregistré (ajoutée plus tard) reste affichée.
assert.ok(mine.includes('faq'), 'nouvelle rubrique conservée');

// Page interdite au rôle : renvoi au tableau de bord.
assert.equal(run(`navGuard({ role: 'coach' })`), false);
assert.equal(redirected, 'dashboard.html');
redirected = null;
assert.equal(run(`navGuard({ role: 'admin' })`), true);
assert.equal(redirected, null);
// La fiche d'un joueur (player-performance) dépend de la rubrique Joueurs : le prépa y a accès.
window.location.pathname = '/player-performance';
assert.equal(run(`navGuard({ role: 'prepa' })`), true);
window.location.pathname = '/videos';
assert.equal(run(`navGuard({ role: 'prepa' })`), false, 'prépa : pas de Vidéos');
redirected = null;

// Équipe courante : seulement si elle existe encore dans le club.
window.CURRENT_PROFILE.prefs.team_id = 5;
assert.equal(run('currentTeamId()'), 5);
window.CURRENT_PROFILE.prefs.team_id = 99;
assert.equal(run('currentTeamId()'), null, 'équipe supprimée = toutes les équipes');

// Corbeille : tout le staff (chacun n'y voit que ce qu'il pouvait supprimer, RLS).
for (const r of ['admin', 'coach', 'prepa']) assert.ok(keys(r, {}).includes('trash'), `${r} : Corbeille`);

// Mémoire de navigation (app.js) : le menu rouvre la dernière page vue de
// chaque rubrique, fiche et onglet compris ; depuis la rubrique, sa page principale.
const mem = {};
Object.assign(ctx, {
  PAGE: 'faq',
  pageOf: (href) => href.split(/[?#]/)[0].replace(/\.html$/, ''),
  lastUrl: (p) => mem[p]?.u || null,
  latestUrl: (pages) => pages.map(p => mem[p]).filter(Boolean).sort((a, b) => b.t - a.t)[0]?.u || null,
});
const href = (k) => window.resolveNavHref(k);
assert.equal(href('players'), 'players.html', 'rien de vu : page de la rubrique');
mem.players = { u: 'players.html?q=al', t: 1 };
mem['player-performance'] = { u: 'player-performance.html?id=12&tab=performance', t: 2 };
assert.equal(href('players'), 'player-performance.html?id=12&tab=performance', 'depuis la FAQ : la fiche laissée, onglet compris');
ctx.PAGE = 'player-performance';
assert.equal(href('players'), 'players.html?q=al', 'depuis la fiche : la liste telle qu’on l’a laissée');
ctx.PAGE = 'faq';
mem.comparaison = { u: 'comparaison.html?tab=evolution', t: 3 };
assert.equal(href('performance'), 'comparaison.html?tab=evolution', 'Performance : sa page, onglet compris');
assert.equal(href('inconnue'), null);

console.log('nav.test.mjs : OK');
