/* ============================================================
   FootSession Pro — player-nav.js
   Espace joueur : même barre sur toutes ses pages
   (Ma performance · Mon programme terrain · Mes vidéos ·
   Déconnexion), et garde commune de ces pages.
   ============================================================ */

const PLAYER_NAV = [
  ['player-performance', 'Ma performance'],
  ['mon-programme', 'Mon programme terrain'],
  ['mes-videos', 'Mes vidéos'],
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
    window.location.href = 'index.html';
  });
}

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
  renderPlayerNav();
  return player;
}
