/* ============================================================
   LMFC Performance — nav.js
   Menu latéral commun à toutes les pages du staff :
     - rubriques filtrées selon le rôle (et pages interdites
       redirigées vers le tableau de bord) ;
     - ordre et rubriques masquées choisis par chaque utilisateur
       (profiles.prefs.nav, réglable dans Paramètres) ;
     - sélecteur d'équipe (profiles.prefs.team_id).
   Appelé par requireAuth() une fois le profil chargé.
   ============================================================ */

const STAFF_ROLES = ['admin', 'coach'];            // travail terrain : séances, vidéos, tableau
const ALL_STAFF   = ['admin', 'coach', 'prepa'];   // + préparateur physique

/* Paramètres n'est pas une rubrique : on y va par son nom, en bas du
   menu (renderUserMenu). */
const NAV_ITEMS = [
  { key: 'dashboard',   href: 'dashboard.html',      label: 'Accueil',           roles: ALL_STAFF },
  { key: 'sessions',    href: 'sessions.html',       label: 'Séances',           roles: STAFF_ROLES },
  { key: 'players',     href: 'players.html',        label: 'Joueurs',           roles: ALL_STAFF },
  { key: 'performance', href: 'comparaison.html',    label: 'Performance',       roles: ALL_STAFF },
  { key: 'videos',      href: 'videos.html',         label: 'Vidéos joueurs',    roles: STAFF_ROLES },
  { key: 'tactical',    href: 'tactical-board.html', label: 'Tableau tactique',  roles: STAFF_ROLES },
  { key: 'analytics',   href: 'analytics.html',      label: 'Bilan & Analytics', roles: STAFF_ROLES },
  { key: 'faq',         href: 'faq.html',            label: 'FAQ',               roles: ALL_STAFF },
  { key: 'club',        href: 'club.html',           label: 'Mon club',          roles: ['admin'] },
  { key: 'trash',       href: 'trash.html',          label: 'Corbeille',         roles: ALL_STAFF },
];

/* Pages sans entrée de menu : rubrique qu'elles « allument ». */
const NAV_PARENT = { 'player': 'players', 'player-performance': 'performance', 'session-edit': 'sessions' };

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
    .map((item, i) => ({ ...item, rank: rank(item, i), hidden: hidden.has(item.key) }))
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

/* Lien de rubrique (menu) : la dernière page vue dans cette rubrique,
   fiche et onglet compris. Depuis la rubrique elle-même, on remonte
   à sa page principale (avec ses filtres). */
window.resolveNavHref = (key) => {
  const item = NAV_ITEMS.find(i => i.key === key);
  if (!item) return null;
  const root = pageOf(item.href);
  const pages = [root, ...Object.keys(NAV_PARENT).filter(p => NAV_PARENT[p] === key)];
  return (pages.includes(PAGE) ? lastUrl(root) : latestUrl(pages)) || item.href;
};

function renderNav(profile) {
  const nav = document.querySelector('#sidebar .nav');
  if (!nav) return;
  // Téléphone : le menu est replié, le logo reste visible dans la barre du
  // haut (sauf sur le tableau tactique, plein écran).
  if (!document.querySelector('.m-appbar, .tb-page')) {
    document.body.insertAdjacentHTML('afterbegin',
      '<header class="m-appbar"><a class="m-brand" href="dashboard.html" aria-label="LMFC Performance — accueil"><img class="brand-crest" src="assets/img/lmfc-logo.png" alt="" width="30" height="30">LMFC&nbsp;<span class="brand-pro">Performance</span></a></header>');
  }
  const page = currentPageName();
  const activeKey = NAV_PARENT[page] || NAV_ITEMS.find(i => i.href === `${page}.html`)?.key;
  nav.innerHTML = orderedNavItems(profile.role, profile.prefs)
    .filter(item => !item.hidden)
    .map(item => `<a class="nav-item${item.key === activeKey ? ' active' : ''}" href="${item.href}" data-mem="${item.key}"${item.key === activeKey ? ' aria-current="page"' : ''}>`
      + `<span class="nav-dot"></span>${escapeHtml(item.label)}</a>`)
    .join('');
  renderUserMenu(profile);
  renderPageKicker(profile);

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

/* Où suis-je ? Club et équipe de travail, au-dessus du titre de chaque
   page (même ligne que la date de l'accueil). */
function renderPageKicker(profile) {
  const head = document.querySelector('.page-head > div:first-child');
  if (!head || head.querySelector('.page-kicker')) return;
  const team = currentTeam();
  const parts = [profile.clubs?.nom || 'Le Mans FC', team ? team.nom : ((window.CLUB_TEAMS || []).length ? 'Toutes les équipes' : null)];
  head.insertAdjacentHTML('afterbegin', `<p class="page-kicker">${parts.filter(Boolean).map(escapeHtml).join(' · ')}</p>`);
}

/* Bloc « moi » en bas du menu : nom, fonction, déconnexion. Un clic
   sur le nom propose un seul lien, Paramètres, où tout est regroupé. */
function fillUserBlock(name, role) {
  const box = document.querySelector('#sidebar .sidebar-user');
  if (!box) return null;
  const initials = name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  box.querySelector('.avatar') && (box.querySelector('.avatar').textContent = initials);
  box.querySelector('.su-name') && (box.querySelector('.su-name').textContent = name);
  box.querySelector('.su-role') && (box.querySelector('.su-role').textContent = role.toUpperCase());
  return box;
}

const SETTINGS_IC = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

function renderUserMenu(profile) {
  const box = fillUserBlock(profile.nom || 'Utilisateur', ROLE_LABELS[profile.role] || profile.role || '');
  if (!box || box.dataset.menu) return;
  box.dataset.menu = '1';
  const onSettings = currentPageName() === 'settings';
  const trigger = el('button', { type: 'button', class: `su-trigger${onSettings ? ' is-current' : ''}`,
    'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'userMenu', title: 'Paramètres' });
  ['.avatar', '.su-meta'].forEach(sel => { const n = box.querySelector(sel); if (n) trigger.append(n); });
  trigger.insertAdjacentHTML('beforeend', '<svg class="su-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>');
  box.prepend(trigger);

  const menu = el('div', { class: 'user-menu', id: 'userMenu', role: 'menu', hidden: 'hidden' });
  menu.innerHTML = `<a role="menuitem" href="settings.html">${SETTINGS_IC}Paramètres</a>`;
  box.append(menu);

  const setOpen = (open) => {
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('a').focus();
  };
  trigger.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
  document.addEventListener('click', (e) => { if (!menu.hidden && !box.contains(e.target)) setOpen(false); });
  document.addEventListener('keydown', (e) => {
    if (!menu.hidden && e.key === 'Escape') { setOpen(false); trigger.focus(); }
  });
}
