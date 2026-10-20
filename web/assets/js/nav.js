/* ============================================================
   LMFC Performance — nav.js
   Menu latéral commun à toutes les pages du staff :
     - rubriques filtrées selon le rôle (et pages interdites
       redirigées vers la page d'accueil du rôle) ;
     - ordre et rubriques masquées choisis par chaque utilisateur
       (profiles.prefs.nav, réglable dans Paramètres) ;
     - équipe de travail : celle du compte s'il est rattaché à une équipe
       (profiles.team_id, réglé par l'administrateur), sinon celle choisie
       dans le sélecteur (profiles.prefs.team_id).
   Appelé par requireAuth() une fois le profil chargé.
   ============================================================ */

const STAFF_ROLES = ['admin', 'coach'];            // travail terrain : séances, vidéos, tableau
const ALL_STAFF   = ['admin', 'coach', 'prepa'];   // + préparateur physique
const READER      = 'lecteur';                     // scout : consultation seule (lmfc_v22.sql)

/* Paramètres n'est pas une rubrique : on y va par son nom, en bas du
   menu (renderUserMenu). */
const NAV_ITEMS = [
  { key: 'dashboard',   href: 'dashboard.html',      label: 'Accueil',           roles: ALL_STAFF },
  { key: 'sessions',    href: 'sessions.html',       label: 'Séances',           roles: ALL_STAFF },   // prépa : séances ouvertes (lmfc_v10.sql)
  { key: 'matches',     href: 'matchs.html',         label: 'Retours de match',  roles: ALL_STAFF },   // prépa : lecture (lmfc_v11.sql)
  { key: 'players',     href: 'players.html',        label: 'Joueurs',           roles: [...ALL_STAFF, READER] },
  { key: 'performance', href: 'comparaison.html',    label: 'Performance',       roles: [...ALL_STAFF, READER] },
  { key: 'videos',      href: 'videos.html',         label: 'Vidéos joueurs',    roles: [...STAFF_ROLES, READER] },
  { key: 'tactical',    href: 'tactical-board.html', label: 'Tableau tactique',  roles: STAFF_ROLES },
  { key: 'analytics',   href: 'analytics.html',      label: 'Bilan & Analytics', roles: STAFF_ROLES },
  { key: 'faq',         href: 'faq.html',            label: 'FAQ',               roles: [...ALL_STAFF, READER] },
  { key: 'club',        href: 'club.html',           label: 'Mon club',          roles: ['admin'] },
  { key: 'notifications', href: 'notifications.html', label: 'Notifications',    roles: ['admin'] },   // lmfc_v16.sql
  { key: 'trash',       href: 'trash.html',          label: 'Corbeille',         roles: ALL_STAFF },
];

/* Icônes du menu et de l'accueil (tracés Lucide, 24 × 24, trait 2). */
const NAV_IC = {
  dashboard: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  sessions: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  matches: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h6"/>',
  players: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  performance: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  videos: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.41V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  tactical: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 4v16"/><circle cx="12" cy="12" r="3"/>',
  analytics: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  faq: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
  club: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  notifications: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  scale: '<path d="M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0zM19 7l-3 7a4 4 0 0 0 6 0z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const navIc = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${NAV_IC[k] || NAV_IC.plus}</svg>`;

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
    .map((item, i) => ({ ...item, rank: rank(item, i), hidden: hidden.has(item.key) }))
    .filter(item => item.roles.includes(role))
    .sort((a, b) => a.rank - b.rank);
}

/* Faux si la page courante est interdite à ce rôle (redirection lancée
   vers sa page d'accueil : le tableau de bord, interdit au lecteur, le
   renverrait en boucle). */
function navGuard(profile) {
  const page = currentPageName();
  const key = NAV_PARENT[page] || NAV_ITEMS.find(i => i.href === `${page}.html`)?.key;
  const item = NAV_ITEMS.find(i => i.key === key);
  if (!item || item.roles.includes(profile.role)) return true;
  console.warn(`navGuard: page « ${page} » interdite au rôle ${profile.role}`);
  window.location.replace(roleHome(profile.role));   // auth.js
  return false;
}

/* Équipe de travail, ou null (= toutes les équipes). */
function currentTeamId() {
  return teamIdOf(window.CURRENT_PROFILE, window.CLUB_TEAMS || []);
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
/* Même filtre pour les joueurs, qui peuvent jouer dans plusieurs équipes
   (players.other_team_ids, lmfc_v7.sql). */
function byPlayerTeam(query, teamId = currentTeamId()) {
  return teamId ? query.or(`team_id.eq.${teamId},team_id.is.null,other_team_ids.cs.{${teamId}}`) : query;
}
const playerInTeam = (p, teamId) => !teamId || p.team_id === teamId || p.team_id == null || (p.other_team_ids || []).includes(teamId);
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
  if (typeof writeAuthCache === 'function') writeAuthCache(window.CURRENT_PROFILE, window.CLUB_TEAMS);
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

/* Équipes d'un compte (profiles.team_ids, lmfc_v14.sql ; avant : team_id),
   réglées par l'administrateur : vide = toutes. Le profil est passé en
   paramètre : au premier dessin du menu, le profil gardé en mémoire n'est
   pas encore window.CURRENT_PROFILE. */
const accountTeams = (profile, teams) => {
  const ids = (profile?.team_ids?.length ? profile.team_ids : [profile?.team_id]).map(Number).filter(Boolean);
  return teams.filter(t => ids.includes(t.id));
};
/* Une seule équipe : imposée. Plusieurs : le choix du menu parmi elles
   (la première par défaut), jamais « toutes » pour ne rien mélanger. */
const fixedTeamOf = (profile, teams) => { const a = accountTeams(profile, teams); return a.length === 1 ? a[0] : null; };
const teamIdOf = (profile, teams) => {
  const allowed = accountTeams(profile, teams);
  const pref = Number(profile?.prefs?.team_id);
  if ((allowed.length ? allowed : teams).some(t => t.id === pref)) return pref;
  return allowed[0]?.id ?? null;
};

function renderNav(profile, teams = window.CLUB_TEAMS || []) {
  const nav = document.querySelector('#sidebar .nav');
  if (!nav) return;
  // Téléphone : le menu est replié, le logo reste visible dans la barre du
  // haut (sauf sur le tableau tactique, plein écran).
  if (!document.querySelector('.m-appbar, .tb-page')) {
    document.body.insertAdjacentHTML('afterbegin',
      '<header class="m-appbar"><a class="m-brand" href="dashboard.html" aria-label="LMFC Performance — accueil"><img class="brand-crest" src="assets/img/lmfc-logo.png" alt="" width="30" height="30">LMFC&nbsp;<span class="brand-pro">Performance</span></a></header>');
  }
  // Le logo mène à l'accueil du rôle (le lecteur n'a pas de tableau de bord).
  // Pages du joueur : pas d'auth.js, rien à changer.
  const home = typeof roleHome === 'function' ? roleHome(profile.role) : 'dashboard.html';
  document.querySelectorAll('#sidebar .brand, .m-brand').forEach(a => { if (a.getAttribute('href') !== home) a.setAttribute('href', home); });
  const page = currentPageName();
  const activeKey = NAV_PARENT[page] || NAV_ITEMS.find(i => i.href === `${page}.html`)?.key;
  const html = orderedNavItems(profile.role, profile.prefs)
    .filter(item => !item.hidden)
    .map(item => `<a class="nav-item${item.key === activeKey ? ' active' : ''}" href="${item.href}" data-mem="${item.key}"${item.key === activeKey ? ' aria-current="page"' : ''}>`
      + `${navIc(item.key)}<span>${escapeHtml(item.label)}</span></a>`)
    .join('');
  // Redessiné seulement s'il a changé : le second passage (profil frais)
  // ne doit ni clignoter ni perdre la position de défilement.
  const changed = nav.innerHTML !== html;
  if (changed) nav.innerHTML = html;
  renderTeamSwitch(nav, profile, teams);
  renderUserMenu(profile);
  if (changed) restoreNavScroll(nav);   // après l'équipe et le bloc « moi », qui réduisent la hauteur du menu
  renderPageKicker(profile, teams);
  if (profile === window.CURRENT_PROFILE || window.CURRENT_PROFILE?.id === profile.id) saveNavCache(profile, teams);
}

/* Sélecteur d'équipe, au-dessus du menu ; recréé seulement s'il change.
   Compte rattaché à une équipe : son nom, sans choix possible. */
function renderTeamSwitch(nav, profile, teams) {
  const current = teamIdOf(profile, teams), allowed = accountTeams(profile, teams), fixed = fixedTeamOf(profile, teams);
  const sig = JSON.stringify([teams, current, allowed.map(t => t.id)]);
  const old = document.getElementById('teamSwitch');
  if (old && old.dataset.sig === sig) return;
  old?.remove();
  if (!teams.length) return;
  if (fixed) {
    nav.before(el('div', { class: 'team-switch', id: 'teamSwitch', 'data-sig': sig }, el('span', {}, 'Équipe'),
      el('strong', { class: 'team-fixed', title: 'Équipe de votre compte (réglée par l’administrateur du club)' }, fixed.nom)));
    return;
  }
  const wrap = el('label', { class: 'team-switch', id: 'teamSwitch', 'data-sig': sig }, el('span', {}, 'Équipe'));
  const select = el('select', { 'aria-label': 'Équipe de travail' },
    allowed.length ? null : el('option', { value: '' }, 'Toutes les équipes'),
    (allowed.length ? allowed : teams).map(t => el('option', { value: t.id, selected: t.id === current ? 'selected' : null }, t.nom)));
  select.addEventListener('change', async () => {
    select.disabled = true;
    try {
      await savePrefsPatch({ team_id: select.value ? Number(select.value) : null });
      saveNavCache(window.CURRENT_PROFILE, teams);
      window.location.reload();
    } catch (e) { select.disabled = false; toast(e.message, 'error'); }
  });
  wrap.append(select);
  nav.before(wrap);
}

/* Où suis-je ? Club et équipe de travail, au-dessus du titre de chaque
   page (même ligne que la date de l'accueil). */
function renderPageKicker(profile, teams = window.CLUB_TEAMS || []) {
  const head = document.querySelector('.page-head > div:first-child');
  if (!head) return;
  const team = teams.find(t => t.id === teamIdOf(profile, teams));
  const parts = [profile.clubs?.nom || 'Le Mans FC', team ? team.nom : (teams.length ? 'Toutes les équipes' : null)];
  const text = parts.filter(Boolean).join(' · ');
  const kicker = head.querySelector('.page-kicker');
  // Ligne réservée dans la page (page-kicker vide) : remplie sur place, rien ne bouge.
  if (kicker) { if (kicker.textContent !== text) kicker.textContent = text; kicker.removeAttribute('aria-hidden'); return; }
  head.insertAdjacentHTML('afterbegin', `<p class="page-kicker">${escapeHtml(text)}</p>`);
}

/* ---------- Menu instantané ----------
   Le menu dépend du profil (rôle, ordre choisi, équipes), lu sur le
   réseau : à chaque page il apparaissait après coup, et l'équipe et la
   ligne « club · équipe » poussaient la page vers le bas. On garde ce
   qu'il faut pour le dessiner dès la fin du chargement de la page
   (localStorage, même compte seulement) ; requireAuth le redessine avec
   le profil frais, sans rien changer à l'écran si rien n'a changé. */
const NAV_CACHE = 'lmfc-nav-cache';
function saveNavCache(profile, teams) {
  try {
    localStorage.setItem(NAV_CACHE, JSON.stringify({
      profile: { id: profile.id, nom: profile.nom, role: profile.role, team_id: profile.team_id ?? null, team_ids: profile.team_ids || [],
        prefs: { nav: profile.prefs?.nav, team_id: profile.prefs?.team_id ?? null }, clubs: { nom: profile.clubs?.nom } },
      teams: (teams || []).map(t => ({ id: t.id, nom: t.nom })),
    }));
  } catch { /* stockage indisponible : le menu attendra le réseau */ }
}
const clearNavCache = () => { try { localStorage.removeItem(NAV_CACHE); } catch { /* idem */ } };
function renderNavFromCache() {
  if (window.CURRENT_PROFILE || !document.querySelector('#sidebar .nav')) return;
  try {
    const c = JSON.parse(localStorage.getItem(NAV_CACHE) || 'null');
    const uid = JSON.parse(localStorage.getItem('footsession-auth') || 'null')?.user?.id;
    if (!c?.profile || c.profile.role === 'joueur' || !uid || c.profile.id !== uid) return;
    renderNav(c.profile, c.teams || []);
  } catch (e) { console.warn('Menu en mémoire illisible', e); }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderNavFromCache);
else renderNavFromCache();

/* La liste du menu garde sa position d'une page à l'autre ; la rubrique
   active reste visible quand le menu défile (petit écran). */
const NAV_SCROLL = 'lmfc-nav-scroll';
function restoreNavScroll(nav) {
  try { nav.scrollTop = Number(sessionStorage.getItem(NAV_SCROLL)) || 0; } catch { /* stockage indisponible */ }
  const a = nav.querySelector('.active');
  if (a && (a.offsetTop < nav.scrollTop || a.offsetTop + a.offsetHeight > nav.scrollTop + nav.clientHeight)) {
    nav.scrollTop = a.offsetTop - (nav.clientHeight - a.offsetHeight) / 2;
  }
}
window.addEventListener('pagehide', () => {
  const nav = document.querySelector('#sidebar .nav');
  try { if (nav) sessionStorage.setItem(NAV_SCROLL, String(Math.round(nav.scrollTop))); } catch { /* idem */ }
});

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
