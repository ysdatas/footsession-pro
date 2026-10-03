/* ============================================================
   LMFC Performance — player-nav.js
   Espace joueur : la même coque sur toutes ses pages.
   - En-tête : logo LMFC Performance, rubriques (ordinateur),
     déconnexion. Même hauteur, même place, sur chaque page.
   - Téléphone : barre d'onglets en bas, à portée de pouce
     (Performance · Programme · Vidéos).
   Les pages 100 % joueur portent <body data-shell="player"> : la
   coque s'affiche dès le chargement. La page Performance, partagée
   avec le staff, l'affiche seulement pour un compte joueur.
   Contient aussi la garde commune de ces pages (requirePlayer).
   ============================================================ */

const PLAYER_NAV = [
  ['player-performance', 'Ma performance', 'Performance', 'activity'],
  ['mon-programme', 'Mon programme terrain', 'Programme', 'target'],
  ['mes-videos', 'Mes vidéos', 'Vidéos', 'video'],
];
const PA_ICON = {
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  video: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.41V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
};
const paIc = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${PA_ICON[k]}</svg>`;

function renderPlayerShell() {
  if (document.querySelector('.pa-bar')) return;
  let page = (location.pathname.split('/').pop() || '').replace(/\.html$/i, '');
  if (page === 'voir-video') page = 'mes-videos';
  const link = ([key, long, short, icon], cls) => {
    const on = key === page;
    return `<a class="${cls}${on ? ' is-active' : ''}" href="${key}.html"${on ? ' aria-current="page"' : ''}>${paIc(icon)}<span>${cls === 'pa-tab' ? short : long}</span></a>`;
  };
  document.body.classList.add('pa-body');
  document.body.insertAdjacentHTML('afterbegin', `
    <header class="pa-bar">
      <a class="pa-brand" href="player-performance.html" aria-label="LMFC Performance, accueil de l’espace joueur"><img class="brand-crest" src="assets/img/lmfc-logo.png" alt="" width="30" height="30">LMFC <span class="brand-pro">Performance</span></a>
      <nav class="pa-links" aria-label="Espace joueur">${PLAYER_NAV.map(n => link(n, 'pa-link')).join('')}</nav>
      <button class="pa-logout" type="button" title="Se déconnecter">${paIc('logout')}<span>Déconnexion</span></button>
    </header>`);
  document.body.insertAdjacentHTML('beforeend',
    `<nav class="pa-tabbar" aria-label="Espace joueur">${PLAYER_NAV.map(n => link(n, 'pa-tab')).join('')}</nav>`);
  document.querySelector('.pa-logout').addEventListener('click', async () => {
    await sb.auth.signOut();
    window.location.href = 'index.html';
  });
}
/* Ancien nom, encore appelé par la page Performance. */
const renderPlayerNav = renderPlayerShell;

/* Garde des pages du joueur : connecté, compte joueur, fiche liée.
   Un compte staff est renvoyé vers son espace. Renvoie la fiche
   { id, nom, prenom, club_id } ou null (redirection en cours). */
async function requirePlayer() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return null; }
  const { data: profile } = await sb.from('profiles')
    .select('role, club_id').eq('id', session.user.id).maybeSingle();
  if (profile && profile.role !== 'joueur') {
    window.location.replace(profile.club_id ? 'dashboard.html' : 'onboarding.html');
    return null;
  }
  const { data: player, error } = await sb.from('players').select('id, nom, prenom, club_id')
    .eq('auth_user_id', session.user.id).maybeSingle();
  if (error) throw error;
  if (!player) { window.location.href = 'index.html'; return null; }
  renderPlayerShell();
  return player;
}

if (document.body?.dataset.shell === 'player') renderPlayerShell();
