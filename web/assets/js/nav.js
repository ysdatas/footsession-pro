/* ============================================================
   FootSession Pro — nav.js
   Menu latéral commun à toutes les pages du staff :
     - rubriques filtrées selon le rôle (et pages interdites
       redirigées vers le tableau de bord) ;
     - ordre et rubriques masquées choisis par chaque utilisateur
       (profiles.prefs.nav, réglable dans Paramètres) ;
     - sélecteur d'équipe (profiles.prefs.team_id).
   Appelé par requireAuth() une fois le profil chargé.
   ============================================================ */

const STAFF_ROLES = ['admin', 'coach'];

/* `fixed` : toujours affichée, pour qu'on ne puisse pas se retirer
   l'accès aux Paramètres (et donc à la personnalisation du menu). */
const NAV_ITEMS = [
  { key: 'dashboard',   href: 'dashboard.html',      label: 'Tableau de bord',   roles: STAFF_ROLES },
  { key: 'sessions',    href: 'sessions.html',       label: 'Séances',           roles: STAFF_ROLES },
  { key: 'players',     href: 'players.html',        label: 'Joueurs',           roles: STAFF_ROLES },
  { key: 'performance', href: 'comparaison.html',    label: 'Performance',       roles: STAFF_ROLES },
  { key: 'videos',      href: 'videos.html',         label: 'Vidéos joueurs',    roles: STAFF_ROLES },
  { key: 'tactical',    href: 'tactical-board.html', label: 'Tableau tactique',  roles: STAFF_ROLES },
  { key: 'analytics',   href: 'analytics.html',      label: 'Bilan & Analytics', roles: STAFF_ROLES },
  { key: 'faq',         href: 'faq.html',            label: 'FAQ',               roles: STAFF_ROLES },
  { key: 'club',        href: 'club.html',           label: 'Mon club',          roles: ['admin'] },
  { key: 'settings',    href: 'settings.html',       label: 'Paramètres',        roles: STAFF_ROLES, fixed: true },
];

/* Pages sans entrée de menu : rubrique qu'elles « allument ». */
const NAV_PARENT = { 'player': 'players', 'player-performance': 'players', 'session-edit': 'sessions' };

function currentPageName() {
  return (window.location.pathname.split('/').pop() || '').replace(/\.html$/i, '') || 'index';
}

/* Rubriques visibles pour ce rôle, dans l'ordre choisi par l'utilisateur.
   Une rubrique ajoutée plus tard (absente de l'ordre enregistré) garde
   sa place par défaut au lieu de disparaître. */
function orderedNavItems(role, prefs) {
  const order = prefs?.nav?.order || [];
  const hidden = new Set(prefs?.nav?.hidden || []);
  const rank = (item, i) => { const r = order.indexOf(item.key); return r >= 0 ? r : 1000 + i; };
  return NAV_ITEMS
    .map((item, i) => ({ ...item, rank: rank(item, i), hidden: !item.fixed && hidden.has(item.key) }))
    .filter(item => item.roles.includes(role))
    .sort((a, b) => a.rank - b.rank);
}

/* Faux si la page courante est interdite à ce rôle (redirection lancée). */
function navGuard(profile) {
  const page = currentPageName();
  const key = NAV_PARENT[page] || NAV_ITEMS.find(i => i.href === `${page}.html`)?.key;
  const item = NAV_ITEMS.find(i => i.key === key);
  if (!item || item.roles.includes(profile.role)) return true;
  console.warn(`navGuard: page « ${page} » interdite au rôle ${profile.role}`);
  window.location.replace('dashboard.html');
  return false;
}

/* Équipe de travail choisie, ou null (= toutes les équipes). */
function currentTeamId() {
  const id = Number(window.CURRENT_PROFILE?.prefs?.team_id);
  return (window.CLUB_TEAMS || []).some(t => t.id === id) ? id : null;
}
function currentTeam() {
  return (window.CLUB_TEAMS || []).find(t => t.id === currentTeamId()) || null;
}
/* Filtre d'équipe d'une requête : l'équipe choisie ET les fiches sans
   équipe. Un joueur ou une séance pas encore rattaché ne doit jamais
   disparaître de l'écran parce qu'une équipe est sélectionnée. */
function byTeam(query, teamId = currentTeamId()) {
  return teamId ? query.or(`team_id.eq.${teamId},team_id.is.null`) : query;
}
function teamName(id) {
  return (window.CLUB_TEAMS || []).find(t => t.id === id)?.nom || '';
}

/* Fusionne `patch` dans les préférences SANS écraser les autres clés
   (réglages du tableau tactique, menu, équipe…). */
async function savePrefsPatch(patch) {
  const { data, error } = await sb.from('profiles').select('prefs').eq('id', window.CURRENT_PROFILE.id).single();
  if (error) throw error;
  const prefs = { ...(data?.prefs || {}), ...patch };
  const { error: e2 } = await sb.from('profiles').update({ prefs }).eq('id', window.CURRENT_PROFILE.id);
  if (e2) throw e2;
  window.CURRENT_PROFILE.prefs = prefs;
  return prefs;
}

function renderNav(profile) {
  const nav = document.querySelector('#sidebar .nav');
  if (!nav) return;
  // Téléphone : le menu est replié, le logo reste visible dans la barre du
  // haut (sauf sur le tableau tactique, plein écran).
  if (!document.querySelector('.m-appbar, .tb-page')) {
    document.body.insertAdjacentHTML('afterbegin',
      '<header class="m-appbar">Foot<span class="brand-accent">Session</span>&nbsp;<span class="brand-pro">Pro</span></header>');
  }
  const page = currentPageName();
  const activeKey = NAV_PARENT[page] || NAV_ITEMS.find(i => i.href === `${page}.html`)?.key;
  nav.innerHTML = orderedNavItems(profile.role, profile.prefs)
    .filter(item => !item.hidden)
    .map(item => `<a class="nav-item${item.key === activeKey ? ' active' : ''}" href="${item.href}">`
      + `<span class="nav-dot"></span>${escapeHtml(item.label)}</a>`)
    .join('');

  document.getElementById('teamSwitch')?.remove();
  const teams = window.CLUB_TEAMS || [];
  if (!teams.length) return;
  const current = currentTeamId();
  const wrap = el('label', { class: 'team-switch', id: 'teamSwitch' }, el('span', {}, 'Équipe'));
  const select = el('select', { 'aria-label': 'Équipe de travail' },
    el('option', { value: '' }, 'Toutes les équipes'),
    teams.map(t => el('option', { value: t.id, selected: t.id === current ? 'selected' : null }, t.nom)));
  select.addEventListener('change', async () => {
    select.disabled = true;
    try {
      await savePrefsPatch({ team_id: select.value ? Number(select.value) : null });
      window.location.reload();
    } catch (e) { select.disabled = false; toast(e.message, 'error'); }
  });
  wrap.append(select);
  nav.before(wrap);
}
