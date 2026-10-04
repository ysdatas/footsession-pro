/* ============================================================
   LMFC Performance — player-nav.js
   Espace joueur : la MÊME coque que le staff (nav.js, layout.css).
   - Ordinateur : barre latérale à gauche (blason, rubriques, « moi »
     en bas avec la déconnexion).
   - Téléphone : barre du haut avec le blason, menu repliable, et
     onglets en bas, à portée de pouce.
   Rubriques : Accueil · Performance · Vidéos · Objectifs.
   Les pages 100 % joueur portent <body data-shell="player"> : la
   coque s'affiche dès le chargement. La page Performance, partagée
   avec le staff, l'affiche seulement pour un compte joueur.
   Contient aussi la garde commune de ces pages (requirePlayer).
   Dépend de app.js (el, escapeHtml) et nav.js (fillUserBlock).
   ============================================================ */

const PLAYER_NAV = [
  ['mon-espace', 'Accueil', 'Accueil', 'home'],
  ['player-performance', 'Ma performance', 'Performance', 'activity'],
  ['mes-videos', 'Mes vidéos', 'Vidéos', 'video'],
  ['mon-programme', 'Objectifs & préventions', 'Objectifs', 'target'],
];
const PA_ICON = {
  home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  video: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.41V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
};
const paIc = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${PA_ICON[k]}</svg>`;
const SIDEBAR_HTML = `
  <button class="sidebar-toggle" id="sidebarToggle" aria-label="Menu"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h14M3 10h14M3 14h14"/></svg></button>
  <aside class="sidebar" id="sidebar">
    <a class="brand" href="mon-espace.html" aria-label="LMFC Performance — accueil"><img class="brand-crest" src="assets/img/lmfc-logo.png" alt="" width="36" height="36"><span class="brand-name">LMFC <span class="brand-pro">Performance</span></span></a>
    <nav class="nav" aria-label="Espace joueur"></nav>
    <div class="sidebar-user">
      <div class="avatar" id="uAvatar">…</div>
      <div class="su-meta"><div class="su-name" id="uName">Mon espace</div><div class="su-role" id="uRole">JOUEUR</div></div>
      <a class="logout" href="#" id="logoutLink" title="Déconnexion" aria-label="Déconnexion"><svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H4v14h4M13 14l4-4-4-4M17 10H8"/></svg></a>
    </div>
  </aside>
  <div class="sidebar-backdrop" id="sidebarBackdrop"></div>`;

/* Rubrique du joueur : sa dernière adresse (la lecture d'une vidéo
   compte pour « Mes vidéos »). */
function playerNavHref(key) {
  if (!PLAYER_NAV.some(([k]) => k === key)) return null;
  const pages = key === 'mes-videos' ? ['mes-videos', 'voir-video'] : [key];
  return (pages.includes(PAGE) ? lastUrl(key) : latestUrl(pages)) || `${key}.html`;
}

const playerSignOut = async () => {
  clearNavMemory();
  await sb.auth.signOut();
  window.location.href = 'index.html';
};

function renderPlayerShell() {
  if (document.body.classList.contains('pa-body')) return;
  let page = (location.pathname.split('/').pop() || '').replace(/\.html$/i, '');
  if (page === 'voir-video') page = 'mes-videos';
  document.body.classList.add('pa-body');
  window.resolveNavHref = playerNavHref;   // la page Performance charge aussi nav.js
  if (!document.getElementById('sidebar')) document.body.insertAdjacentHTML('afterbegin', SIDEBAR_HTML);
  const sidebar = document.getElementById('sidebar');
  sidebar.querySelector('.brand')?.setAttribute('href', 'mon-espace.html');
  sidebar.querySelector('.nav').setAttribute('aria-label', 'Espace joueur');
  sidebar.querySelector('.nav').innerHTML = PLAYER_NAV.map(([key, long]) => {
    const on = key === page;
    return `<a class="nav-item${on ? ' active' : ''}" href="${key}.html" data-mem="${key}"${on ? ' aria-current="page"' : ''}><span class="nav-dot"></span>${long}</a>`;
  }).join('');
  if (!document.querySelector('.m-appbar')) {
    document.body.insertAdjacentHTML('afterbegin',
      '<header class="m-appbar"><a class="m-brand" href="mon-espace.html" aria-label="LMFC Performance — accueil"><img class="brand-crest" src="assets/img/lmfc-logo.png" alt="" width="30" height="30">LMFC&nbsp;<span class="brand-pro">Performance</span></a></header>');
  }
  document.body.insertAdjacentHTML('beforeend',
    `<nav class="pa-tabbar" aria-label="Espace joueur">${PLAYER_NAV.map(([key, , short, icon]) => {
      const on = key === page;
      return `<a class="pa-tab${on ? ' is-active' : ''}" href="${key}.html" data-mem="${key}"${on ? ' aria-current="page"' : ''}>${paIc(icon)}<span>${short}</span></a>`;
    }).join('')}</nav>`);
  const out = document.getElementById('logoutLink');
  if (out && !out.dataset.bound) {
    out.dataset.bound = '1';
    out.addEventListener('click', (e) => { e.preventDefault(); playerSignOut(); });
  }
  bindSidebarToggle();
}
/* Ancien nom, encore appelé par la page Performance. */
const renderPlayerNav = renderPlayerShell;

/* Le bloc « moi » prend le nom du joueur une fois sa fiche connue. */
function setPlayerShellUser(player) {
  renderPlayerShell();
  fillUserBlock(`${player?.prenom || ''} ${player?.nom || ''}`.trim() || 'Joueur', 'Joueur');
}

/* Garde des pages du joueur : connecté, compte joueur, fiche liée.
   Un compte staff est renvoyé vers son espace. Renvoie la fiche
   du joueur (select *) ou null (redirection en cours). */
async function requirePlayer() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return null; }
  window.CURRENT_USER = session.user;
  const { data: profile } = await sb.from('profiles')
    .select('role, club_id, clubs(nom, color)').eq('id', session.user.id).maybeSingle();
  if (profile && profile.role !== 'joueur') {
    window.location.replace(profile.club_id ? 'dashboard.html' : 'onboarding.html');
    return null;
  }
  const { data: player, error } = await sb.from('players').select('*')
    .eq('auth_user_id', session.user.id).maybeSingle();
  if (error) throw error;
  if (!player) { window.location.href = 'index.html'; return null; }
  window.PLAYER_CLUB = profile?.clubs?.nom || '';
  if (typeof applyClubColor === 'function' && profile?.clubs) applyClubColor(profile.clubs.color);
  setPlayerShellUser(player);
  return player;
}

if (document.body?.dataset.shell === 'player') renderPlayerShell();
