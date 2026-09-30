/* ============================================================
   FootSession Pro — player-nav.js
   Barre de l'espace joueur, identique sur toutes ses pages :
   Mes vidéos · Ma performance · Mon programme · Déconnexion.
   Avant, on ne pouvait se déconnecter que depuis « Mes vidéos ».
   ============================================================ */

const PLAYER_NAV = [
  ['mes-videos', 'Mes vidéos'],
  ['player-performance', 'Ma performance'],
  ['mon-programme', 'Mon programme'],
];

function renderPlayerNav(targetId = 'playerNav') {
  const nav = document.getElementById(targetId);
  if (!nav) return;
  let page = (location.pathname.split('/').pop() || '').replace(/\.html$/i, '');
  if (page === 'voir-video') page = 'mes-videos';
  nav.className = 'player-nav';
  nav.setAttribute('aria-label', 'Espace joueur');
  nav.innerHTML = PLAYER_NAV.map(([key, label]) =>
    `<a class="btn${key === page ? ' btn-primary' : ''}" href="${key}.html"${key === page ? ' aria-current="page"' : ''}>${label}</a>`).join('')
    + '<a class="btn player-logout" href="#">Déconnexion</a>';
  nav.querySelector('.player-logout').addEventListener('click', async (e) => {
    e.preventDefault();
    await sb.auth.signOut();
    window.location.href = 'player-join.html';
  });
}
