/* Menu latéral (web/assets/js/nav.js) : rubriques par rôle, ordre et
   masquage choisis par l'utilisateur, pages interdites, équipe courante.
   Lancement : node tests/nav.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let redirected = null;
const window = {
  location: { pathname: '/videos', replace: (url) => { redirected = url; } },
  CLUB_TEAMS: [{ id: 3, nom: 'N2' }, { id: 5, nom: 'U19' }],
  CURRENT_PROFILE: { prefs: {} },
};
const ctx = vm.createContext({ window, console, Number, Set, Map });
vm.runInContext(readFileSync('web/assets/js/nav.js', 'utf8'), ctx);
const run = (code) => vm.runInContext(code, ctx);
const keys = (role, prefs) => run(`orderedNavItems(${JSON.stringify(role)}, ${JSON.stringify(prefs)})`)
  .filter(i => !i.hidden).map(i => i.key);

// Le préparateur physique n'a pas la rubrique Vidéos, le coach si.
assert.ok(!keys('prepa', {}).includes('videos'), 'prépa : pas de Vidéos');
assert.ok(keys('coach', {}).includes('videos'), 'coach : Vidéos');

// Ordre et masquage choisis par l'utilisateur.
const prefs = { nav: { order: ['players', 'dashboard', 'sessions'], hidden: ['analytics', 'settings'] } };
const mine = keys('admin', prefs);
assert.equal(mine.slice(0, 3).join(), 'players,dashboard,sessions', 'ordre personnalisé');
assert.ok(!mine.includes('analytics'), 'rubrique masquée');
assert.ok(mine.includes('settings'), 'Paramètres ne peut pas être masqué');
// Une rubrique absente de l'ordre enregistré (ajoutée plus tard) reste affichée.
assert.ok(mine.includes('faq'), 'nouvelle rubrique conservée');

// Page interdite au rôle : renvoi au tableau de bord.
assert.equal(run(`navGuard({ role: 'prepa' })`), false);
assert.equal(redirected, 'dashboard.html');
redirected = null;
assert.equal(run(`navGuard({ role: 'coach' })`), true);
assert.equal(redirected, null);

// Équipe courante : seulement si elle existe encore dans le club.
window.CURRENT_PROFILE.prefs.team_id = 5;
assert.equal(run('currentTeamId()'), 5);
window.CURRENT_PROFILE.prefs.team_id = 99;
assert.equal(run('currentTeamId()'), null, 'équipe supprimée = toutes les équipes');

console.log('nav.test.mjs : OK');
