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
  addEventListener: () => {},
};
// Page déjà chargée, sans menu : le dessin depuis la mémoire (renderNavFromCache) n'a rien à faire.
const document = { readyState: 'complete', querySelector: () => null };
const ctx = vm.createContext({ window, document, console, Number, Set, Map, JSON });
// auth.js d'abord, comme dans les pages : rôles et page d'accueil de chaque compte.
vm.runInContext(readFileSync('web/assets/js/auth.js', 'utf8'), ctx);
vm.runInContext(readFileSync('web/assets/js/nav.js', 'utf8'), ctx);
const run = (code) => vm.runInContext(code, ctx);
const keys = (role, prefs) => run(`orderedNavItems(${JSON.stringify(role)}, ${JSON.stringify(prefs)})`)
  .filter(i => !i.hidden).map(i => i.key);

// Trois comptes : le coach a tout le travail du staff, pas la gestion du club.
assert.ok(keys('coach', {}).includes('videos'), 'coach : Vidéos');
assert.ok(!keys('coach', {}).includes('club'), 'coach : pas de Mon club');
assert.ok(keys('admin', {}).includes('club'), 'admin : Mon club');

// Préparateur physique : performance, joueurs, et les séances qu'on lui ouvre
// (lecture, lmfc_v10.sql) ; ni vidéos, ni tableau.
const prepa = keys('prepa', {});
for (const k of ['dashboard', 'players', 'performance', 'sessions', 'matches', 'faq']) assert.ok(prepa.includes(k), `prépa : ${k}`);
for (const k of ['videos', 'tactical', 'analytics', 'club']) assert.ok(!prepa.includes(k), `prépa : pas de ${k}`);
// Un joueur n'a aucune rubrique du staff.
assert.equal(keys('joueur', {}).length, 0, 'joueur : pas de menu staff');

// Calendrier (lmfc_v28.sql) : tout le staff, jamais le lecteur ; après les quatre onglets du
// téléphone, qui restent Accueil, Séances, Matchs, Joueurs.
for (const role of ['admin', 'coach', 'prepa']) assert.ok(keys(role, {}).includes('calendar'), `${role} : Calendrier`);
assert.equal(keys('coach', {}).slice(0, 4).join(), 'dashboard,sessions,matches,players', 'onglets du téléphone inchangés');

// Lecteur (scout, lmfc_v22.sql) : joueurs, performance, vidéos et FAQ, rien d'autre.
assert.equal(keys('lecteur', {}).join(), 'players,performance,videos,faq', 'lecteur : menu de consultation');

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

// Lecteur : une page interdite le renvoie sur Joueurs, sa page d'accueil
// (le tableau de bord lui est interdit : y renvoyer tournerait en boucle).
for (const page of ['dashboard', 'sessions', 'session-edit', 'matchs', 'tactical-board', 'analytics', 'club', 'notifications', 'trash']) {
  window.location.pathname = `/${page}`;
  redirected = null;
  assert.equal(run(`navGuard({ role: 'lecteur' })`), false, `lecteur : pas de ${page}`);
  assert.equal(redirected, 'players.html', `lecteur : ${page} renvoie sur Joueurs`);
}
for (const page of ['players', 'player-performance', 'comparaison', 'videos', 'faq', 'settings']) {
  window.location.pathname = `/${page}`;
  redirected = null;
  assert.equal(run(`navGuard({ role: 'lecteur' })`), true, `lecteur : ${page} permise`);
  assert.equal(redirected, null, `lecteur : ${page} sans redirection`);
}
window.location.pathname = '/club';
run(`navGuard({ role: 'coach' })`);
assert.equal(redirected, 'dashboard.html', 'staff : toujours renvoyé au tableau de bord');
redirected = null;
// Page d'accueil après connexion (auth.js).
assert.equal(run(`homeFor({ role: 'lecteur', club_id: 1 })`), 'players.html');
assert.equal(run(`homeFor({ role: 'coach', club_id: 1 })`), 'dashboard.html');
assert.equal(run(`homeFor({ role: 'joueur', club_id: 1 })`), 'mon-espace.html');
assert.equal(run(`homeFor({ role: 'lecteur', club_id: null })`), 'onboarding.html');
// Droits côté interface : le lecteur consulte (vue staff, statistiques de
// visionnage) mais aucun helper d'écriture ne le laisse passer.
assert.equal(run(`isStaffRole('lecteur') && isReader('lecteur') && canSeeVideoStats('lecteur')`), true);
for (const f of ['canEdit', 'canEditPerformanceData', 'canManageVideos', 'canManagePlans', 'canChangePlayerPhoto']) {
  assert.equal(run(`${f}('lecteur')`), false, `lecteur : pas de ${f}`);
}
assert.equal(run(`isReader('coach')`), false);

// Équipe courante : seulement si elle existe encore dans le club.
window.CURRENT_PROFILE.prefs.team_id = 5;
assert.equal(run('currentTeamId()'), 5);
window.CURRENT_PROFILE.prefs.team_id = 99;
assert.equal(run('currentTeamId()'), null, 'équipe supprimée = toutes les équipes');
// Compte rattaché à une équipe (Mon club → Membres) : elle s'impose au choix du menu.
window.CURRENT_PROFILE.team_id = 3;
window.CURRENT_PROFILE.prefs.team_id = 5;
assert.equal(run('currentTeamId()'), 3, 'équipe du compte prioritaire');
window.CURRENT_PROFILE.team_id = 99;
assert.equal(run('currentTeamId()'), 5, 'équipe du compte supprimée : retour au choix du menu');
delete window.CURRENT_PROFILE.team_id;
// Plusieurs équipes (lmfc_v14.sql) : le choix du menu parmi elles, la première par défaut, jamais « toutes ».
window.CURRENT_PROFILE.team_ids = [3, 5];
window.CURRENT_PROFILE.prefs.team_id = 5;
assert.equal(run('currentTeamId()'), 5, 'U19 choisie parmi N2 + U19');
window.CURRENT_PROFILE.prefs.team_id = null;
assert.equal(run('currentTeamId()'), 3, 'sans choix : la première de ses équipes');
window.CURRENT_PROFILE.team_ids = [5];
window.CURRENT_PROFILE.prefs.team_id = 3;
assert.equal(run('currentTeamId()'), 5, 'une seule équipe : imposée');
delete window.CURRENT_PROFILE.team_ids;
// Joueurs : équipe principale, autres équipes, ou sans équipe.
const calls = [];
run('byPlayerTeam')({ or: (f) => { calls.push(f); return 'filtré'; } }, 3);
assert.equal(calls[0], 'team_id.eq.3,team_id.is.null,other_team_ids.cs.{3}');
const inTeam = (p) => run('playerInTeam')(p, 3);
assert.ok(inTeam({ team_id: 5, other_team_ids: [3] }), 'U19 qui joue aussi en N2');
assert.ok(inTeam({ team_id: null }), 'sans équipe : partout');
assert.ok(!inTeam({ team_id: 5, other_team_ids: [] }), 'U19 seulement');

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
