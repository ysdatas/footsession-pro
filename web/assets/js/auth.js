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

  const { data: profile, error } = await sb
    .from('profiles')
    .select('id, nom, role, club_id, clubs(nom, color, logo_path, join_code)')
    .eq('id', session.user.id)
    .single();

  if (error) { console.error(error); window.location.href = 'index.html'; return null; }

  if (requireClub && !profile.club_id) {
    window.location.href = 'onboarding.html';
    return null;
  }

  window.CURRENT_USER = session.user;
  window.CURRENT_PROFILE = profile;
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

const ROLE_LABELS = {
  admin: 'Administrateur', coach: 'Coach', analyste: 'Analyste vidéo',
  prepa: 'Préparateur physique', viewer: 'Lecture seule',
};
