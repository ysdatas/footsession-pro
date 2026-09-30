/* ============================================================
   FootSession Pro — auth.js (Chemin B / Supabase)
   Garde d'accès commune à toutes les pages authentifiées :
   vérifie la session, charge le profil (rôle + club), et
   redirige vers l'onboarding si l'utilisateur n'a pas encore
   de club.
   ============================================================ */

/**
 * À appeler en haut de chaque page protégée.
 * @param {object} opts - { requireClub: bool (défaut true) }
 * @returns {Promise<{user, profile}>}
 */
async function requireAuth(opts = {}) {
  const requireClub = opts.requireClub !== false;

  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return null; }

  let { data: profile, error } = await sb
    .from('profiles')
    .select('id, nom, role, club_id, prefs, clubs(nom, color, logo_path, join_code, saison_start)')
    .eq('id', session.user.id)
    .single();

  /* Replis successifs : une migration pas encore passée ne doit jamais
     empêcher la connexion. On retire d'abord saison_start, puis prefs.
     Le dernier jeu de colonnes est celui du schéma d'origine. */
  const FALLBACKS = [
    'id, nom, role, club_id, prefs, clubs(nom, color, logo_path, join_code)',
    'id, nom, role, club_id, clubs(nom, color, logo_path, join_code)',
  ];
  for (const cols of FALLBACKS) {
    if (!error) break;
    ({ data: profile, error } = await sb
      .from('profiles').select(cols).eq('id', session.user.id).single());
  }

  if (error) {
    console.error('requireAuth: lecture du profil impossible', error);
    window.location.href = 'index.html';
    return null;
  }

  /* Les comptes joueurs sont cantonnés à leur espace : vidéos, lecture,
     liaison de compte et leur propre fiche Performance (en lecture seule,
     l'écriture étant refusée par la RLS, pas par l'UI).

     L'hébergement sert les pages sans extension (/player-performance et non
     /player-performance.html). On compare donc sur le nom sans « .html »,
     sinon aucune page ne correspond et le joueur est renvoyé en boucle sur
     ses vidéos. */
  const currentPage = (window.location.pathname.split('/').pop() || '')
    .replace(/\.html$/i, '') || 'index';
  const PLAYER_PAGES = ['mes-videos', 'voir-video', 'player-join', 'player-performance', 'mon-programme'];
  if (profile.role === 'joueur' && !PLAYER_PAGES.includes(currentPage)) {
    console.warn(`requireAuth: page « ${currentPage} » interdite au rôle joueur, renvoi sur mes-videos`);
    window.location.replace('mes-videos.html');
    return null;
  }

  if (requireClub && !profile.club_id) {
    window.location.href = 'onboarding.html';
    return null;
  }

  window.CURRENT_USER = session.user;
  window.CURRENT_PROFILE = profile;

  // Menu, équipes et pages réservées à certains rôles (nav.js, pages staff).
  if (profile.role !== 'joueur' && typeof navGuard === 'function') {
    if (!navGuard(profile)) return null;
    const { data: teams, error: teamsError } = await sb.from('teams')
      .select('id, nom, sort_order').order('sort_order').order('nom');
    if (teamsError) console.warn('Équipes indisponibles (migration roles_teams_preventions.sql non passée ?) :', teamsError.message);
    window.CLUB_TEAMS = teams || [];
    renderNav(profile);
  }
  return { user: session.user, profile };
}

async function logout() {
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

/** Vrai si le rôle courant peut créer/modifier (pas viewer). */
function canEdit(role) {
  return ['admin', 'coach', 'analyste', 'prepa'].includes(role);
}

/* Mêmes règles que les helpers SQL de roles_teams_preventions.sql :
   l'interface masque, la RLS refuse. */
const canEditPerformanceData = (role) => ['admin', 'prepa'].includes(role);
const canManageVideos        = (role) => ['admin', 'coach', 'analyste'].includes(role);
const canManagePlans         = (role) => ['admin', 'coach', 'prepa'].includes(role);
const canSeeVideoStats       = (role) => ['admin', 'coach', 'analyste'].includes(role);

const ROLE_LABELS = {
  admin: 'Administrateur', coach: 'Coach', analyste: 'Analyste vidéo',
  prepa: 'Préparateur physique', joueur: 'Joueur', viewer: 'Lecture seule',
};
