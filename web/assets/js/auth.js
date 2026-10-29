/* ============================================================
   LMFC Performance — auth.js (Chemin B / Supabase)
   Garde d'accès commune à toutes les pages authentifiées :
   vérifie la session, charge le profil (rôle + club), et
   redirige vers l'onboarding si l'utilisateur n'a pas encore
   de club.
   ============================================================ */

/* ---------- Profil en mémoire (par onglet) ----------
   Chaque page attendait le profil et les équipes (un aller-retour à la
   base, 0,25 à 0,5 s) avant de charger ses données. La page repart
   maintenant de ceux de la page précédente et les relit en fond :
   rôle, club ou équipes changés → la page se recharge aussitôt ;
   le reste (nom, préférences, couleur) est simplement mis à jour.
   Les droits restent ceux de la base (RLS). Vidé à la déconnexion. */
const AUTH_CACHE = 'lmfc-auth';
function readAuthCache(uid) {
  try { const c = JSON.parse(sessionStorage.getItem(AUTH_CACHE) || 'null'); return c?.profile?.id === uid ? c : null; }
  catch { return null; }
}
/* Le rôle est aussi retenu sur l'appareil (lmfc-role) : theme.js le pose sur
   <html> avant le premier affichage, pour réserver la place des boutons et
   cartes de l'accueil (CLS, dashboard.css). Rien de sensible : le rôle seul. */
function writeAuthCache(profile, teams) {
  try { sessionStorage.setItem(AUTH_CACHE, JSON.stringify({ profile, teams })); localStorage.setItem('lmfc-role', profile.role); } catch { /* stockage indisponible : réseau */ }
}
const clearAuthCache = () => { try { sessionStorage.removeItem(AUTH_CACHE); localStorage.removeItem('lmfc-role'); } catch { /* idem */ } };
/* Sans attente réseau, la page reprendrait la main avant que ses derniers
   scripts soient chargés (club-access.js après club-page.js…) : on attend
   la fin de la lecture du document, quelques millisecondes. */
const documentParsed = () => (document.readyState === 'loading'
  ? new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true })) : null);
/* Ce qui décide de ce que la page montre : s'il change, on recharge. */
const authScope = (p, teams) => JSON.stringify([p.role, p.club_id, p.team_id ?? null, p.team_ids || [],
  p.prefs?.team_id ?? null, p.clubs?.saison_start ?? null, (teams || []).map(t => t.id)]);

/**
 * À appeler en haut de chaque page protégée.
 * @param {object} opts - { requireClub: bool (défaut true) }
 * @returns {Promise<{user, profile}>}
 */
async function requireAuth(opts = {}) {
  const requireClub = opts.requireClub !== false;

  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return null; }

  // Profil et équipes partent ensemble. (Un compte joueur n'a pas l'usage des
  // équipes ici : la réponse est simplement ignorée.)
  const loadProfile = () => Promise.all([
    sb.from('profiles')
      .select('id, nom, role, club_id, team_id, team_ids, prefs, clubs(nom, color, logo_path, join_code, saison_start)')
      .eq('id', session.user.id).single(),
    sb.from('teams').select('id, nom, sort_order').order('sort_order').order('nom'),
  ]);
  const cached = readAuthCache(session.user.id);
  let profile, teamsRes;
  if (cached) {
    profile = cached.profile;
    teamsRes = { data: cached.teams, error: null };
    loadProfile().then(([{ data: p, error }, t]) => {
      if (error?.code === 'PGRST116') { clearAuthCache(); window.location.href = 'index.html'; return; }   // profil supprimé
      if (error || !p) return console.warn('Profil non relu (réseau) : la page garde celui en mémoire', error?.message);
      const teams = t.error ? cached.teams : (t.data || []);
      writeAuthCache(p, teams);
      if (authScope(p, teams) !== authScope(cached.profile, cached.teams)) { window.location.reload(); return; }
      Object.assign(window.CURRENT_PROFILE, p);
      window.CLUB_TEAMS = teams;
      if (typeof applyClubColor === 'function' && p.clubs) applyClubColor(p.clubs.color);
      if (p.role !== 'joueur' && typeof renderNav === 'function') renderNav(p);
    }).catch(e => console.warn('Profil non relu (réseau)', e));
  } else {
    const [res, t] = await loadProfile();
    if (res.error) {
      console.error('requireAuth: lecture du profil impossible', res.error);
      window.location.href = 'index.html';
      return null;
    }
    profile = res.data;
    teamsRes = t;
    if (!t.error) writeAuthCache(profile, t.data || []);
  }
  // Profil en mémoire ou profil arrivé avant la fin du chargement (réseau lent) :
  // les derniers scripts de la page doivent être là avant qu'elle reprenne la main
  // (Mon club : club-access.js après club-page.js).
  await documentParsed();

  /* Les comptes joueurs sont cantonnés à leur espace : vidéos, lecture,
     liaison de compte et leur propre fiche Performance (en lecture seule,
     l'écriture étant refusée par la RLS, pas par l'UI).

     L'hébergement sert les pages sans extension (/player-performance et non
     /player-performance.html). On compare donc sur le nom sans « .html »,
     sinon aucune page ne correspond et le joueur est renvoyé en boucle sur
     ses vidéos. */
  const currentPage = (window.location.pathname.split('/').pop() || '')
    .replace(/\.html$/i, '') || 'index';
  const PLAYER_PAGES = ['mon-espace', 'mes-videos', 'voir-video', 'player-performance', 'mon-programme', 'calendrier'];
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

/* Page d'accueil selon le compte : espace joueur, liste des joueurs du
   lecteur, tableau de bord du staff, ou création de club pour un compte
   qui n'a encore aucun accès. */
function homeFor(profile) {
  if (!profile?.club_id) return 'onboarding.html';
  return roleHome(profile.role);
}
const roleHome = (role) => ({ joueur: 'mon-espace.html', lecteur: 'players.html' }[role] || 'dashboard.html');

/* Rattache le compte au club si l'administrateur a enregistré son adresse
   e-mail (Mon club → Accès). Sans effet sinon. */
async function claimClubAccess() {
  const { error } = await sb.rpc('claim_club_access');
  if (error) console.warn('claim_club_access :', error.message);
}

async function logout() {
  if (typeof clearNavMemory === 'function') clearNavMemory();
  if (typeof clearNavCache === 'function') clearNavCache();
  clearAuthCache();
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

/* Cinq comptes (lmfc_v4.sql, lmfc_v22.sql) : admin, coach, prepa
   (préparateur physique), lecteur, joueur. L'interface masque, la RLS refuse.
     admin   : tout, plus la gestion du club ;
     coach   : séances, joueurs, vidéos, objectifs ; consulte la
               performance sans modifier les données physiques ;
     prepa   : données physiques, tests, import Excel, objectifs et
               préventions ; ni vidéos ni séances ;
     lecteur : (scout) consulte tout le club, joueurs, performance,
               vidéos ; ni séances ni matchs ; n'écrit rien. */
const STAFF_ALL = ['admin', 'coach', 'prepa'];
const isStaffRole = (role) => STAFF_ALL.includes(role) || role === 'lecteur';
const isReader = (role) => role === 'lecteur';
function canEdit(role) {                       // séances, fiches joueurs, schémas
  return ['admin', 'coach'].includes(role);
}
const canEditPerformanceData = (role) => ['admin', 'prepa'].includes(role);
const canManageVideos        = (role) => ['admin', 'coach'].includes(role);
const canManagePlans         = (role) => STAFF_ALL.includes(role);
const canSeeVideoStats       = (role) => ['admin', 'coach', 'lecteur'].includes(role);
const canChangePlayerPhoto   = (role) => canEdit(role) || canEditPerformanceData(role);

const ROLE_LABELS = { admin: 'Administrateur', coach: 'Coach', prepa: 'Préparateur physique', lecteur: 'Lecteur', joueur: 'Joueur' };

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
