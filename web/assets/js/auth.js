/* ============================================================
   LMFC Performance — auth.js (Chemin B / Supabase)
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

  // Profil et équipes partent ensemble : un aller-retour de moins sur chaque page du staff.
  // (Un compte joueur n'en a pas l'usage ici : la réponse est simplement ignorée.)
  const [{ data: profile, error }, teamsRes] = await Promise.all([
    sb.from('profiles')
      .select('id, nom, role, club_id, team_id, team_ids, prefs, clubs(nom, color, logo_path, join_code, saison_start)')
      .eq('id', session.user.id).single(),
    sb.from('teams').select('id, nom, sort_order').order('sort_order').order('nom'),
  ]);

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
  const PLAYER_PAGES = ['mon-espace', 'mes-videos', 'voir-video', 'player-performance', 'mon-programme'];
  if (profile.role === 'joueur' && !PLAYER_PAGES.includes(currentPage)) {
    console.warn(`requireAuth: page « ${currentPage} » interdite au rôle joueur, renvoi sur son espace`);
    window.location.replace(homeFor(profile));
    return null;
  }

  if (requireClub && !profile.club_id) {
    window.location.href = 'onboarding.html';
    return null;
  }

  window.CURRENT_USER = session.user;
  window.CURRENT_PROFILE = profile;
  // Couleur du club relue à chaque page : un changement fait par
  // l'administrateur arrive chez tout le monde (theme.js).
  if (typeof applyClubColor === 'function' && profile.clubs) applyClubColor(profile.clubs.color);

  // Menu, équipes et pages réservées à certains rôles (nav.js, pages staff).
  if (profile.role !== 'joueur' && typeof navGuard === 'function') {
    if (!navGuard(profile)) return null;
    if (teamsRes.error) console.warn('Équipes indisponibles :', teamsRes.error.message);
    window.CLUB_TEAMS = teamsRes.data || [];
    renderNav(profile);   // et le garde pour le dessiner tout de suite à la page suivante (nav.js)
  }
  return { user: session.user, profile };
}

/* Page d'accueil selon le compte : espace joueur, tableau de bord du
   staff, ou création de club pour un compte qui n'a encore aucun accès. */
function homeFor(profile) {
  if (!profile?.club_id) return 'onboarding.html';
  return profile.role === 'joueur' ? 'mon-espace.html' : 'dashboard.html';
}

/* Rattache le compte au club si l'administrateur a enregistré son adresse
   e-mail (Mon club → Accès). Sans effet sinon. */
async function claimClubAccess() {
  const { error } = await sb.rpc('claim_club_access');
  if (error) console.warn('claim_club_access :', error.message);
}

async function logout() {
  if (typeof clearNavMemory === 'function') clearNavMemory();
  if (typeof clearNavCache === 'function') clearNavCache();
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

/* Quatre comptes (lmfc_v4.sql) : admin, coach, prepa (préparateur
   physique), joueur. L'interface masque, la RLS refuse.
     admin  : tout, plus la gestion du club ;
     coach  : séances, joueurs, vidéos, objectifs ; consulte la
              performance sans modifier les données physiques ;
     prepa  : données physiques, tests, import Excel, objectifs et
              préventions ; ni vidéos ni séances. */
const STAFF_ALL = ['admin', 'coach', 'prepa'];
const isStaffRole = (role) => STAFF_ALL.includes(role);
function canEdit(role) {                       // séances, fiches joueurs, schémas
  return ['admin', 'coach'].includes(role);
}
const canEditPerformanceData = (role) => ['admin', 'prepa'].includes(role);
const canManageVideos        = (role) => ['admin', 'coach'].includes(role);
const canManagePlans         = (role) => STAFF_ALL.includes(role);
const canSeeVideoStats       = (role) => ['admin', 'coach'].includes(role);
const canChangePlayerPhoto   = (role) => canEdit(role) || canEditPerformanceData(role);

const ROLE_LABELS = { admin: 'Administrateur', coach: 'Coach', prepa: 'Préparateur physique', joueur: 'Joueur' };

/* Photo d'un joueur : RPC set_player_photo (lmfc_v4.sql), seule écriture
   permise au préparateur sur la fiche. Sans la migration : mise à jour
   directe, comme avant. */
async function savePlayerPhotoPath(playerId, path) {
  const { error } = await sb.rpc('set_player_photo', { p_player_id: playerId, p_path: path });
  if (!error) return null;
  if (!/set_player_photo|function|PGRST202/i.test(`${error.code} ${error.message}`)) return error;
  console.warn('set_player_photo indisponible (lmfc_v4.sql non passée ?) :', error.message);
  return (await sb.from('players').update({ photo_path: path }).eq('id', playerId)).error;
}
