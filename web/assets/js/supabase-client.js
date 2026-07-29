/* ============================================================
   FootSession Pro — client Supabase (Chemin B)
   Charge le SDK Supabase via CDN (aucun build, aucun npm requis).
   ============================================================ */

const SUPABASE_URL = 'https://ygnvijxspkrqhasvjfqg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ebJBeOm5WM5j8mOPHUknoA_zzdcWVG4';

// window.supabase est injecté par le script CDN chargé juste avant ce fichier.
// persistSession + autoRefreshToken : l'utilisateur reste connecté d'une visite
// à l'autre sans ressaisir son mot de passe (le jeton est renouvelé tout seul).
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'footsession-auth',
  },
});
