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

/* ---------- Vidéos joueurs ----------
   Les nouvelles vidéos sont sur Cloudflare R2 (chemin « r2/… »), servies
   par le Worker du site (worker/index.js) : bande passante gratuite. Les
   anciennes restent lisibles dans le bucket Supabase « player-videos ». */
const VIDEO_MAX_BYTES = 95 * 1024 * 1024;   // = MAX_BYTES du Worker
const isR2Video = (path) => path.startsWith('r2/');

async function videoApi(route, init = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(`/api/videos/${route}`, {
    ...init, headers: { authorization: `Bearer ${session?.access_token || ''}`, ...init.headers },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Serveur vidéo indisponible (${r.status}).`);
  return body;
}

// Liens de lecture : Map chemin → URL. Une vidéo refusée ou introuvable est absente.
async function videoUrls(paths) {
  const urls = new Map();
  const r2 = paths.filter(isR2Video), old = paths.filter(p => !isR2Video(p));
  const chunks = [];
  for (let i = 0; i < r2.length; i += 100) chunks.push(r2.slice(i, i + 100));   // 100 par appel au Worker
  await Promise.all([
    ...chunks.map(async (c) => {
      const { urls: signed } = await videoApi('sign', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths: c }),
      });
      Object.entries(signed).forEach(([p, u]) => urls.set(p, u));
    }),
    old.length && sb.storage.from('player-videos').createSignedUrls(old, 3600).then(({ data, error }) => {
      if (error) throw error;
      (data || []).forEach((d, i) => { if (d?.signedUrl) urls.set(old[i], d.signedUrl); });
    }),
  ]);
  return urls;
}
const videoUrl = async (path) => (await videoUrls([path])).get(path) || null;

const uploadVideoFile = (path, file) => videoApi(`file/${path}`, {
  method: 'PUT', headers: { 'content-type': file.type || 'video/mp4' }, body: file,
});
async function removeVideoFile(path) {
  if (isR2Video(path)) return videoApi(`file/${path}`, { method: 'DELETE' });
  const { error } = await sb.storage.from('player-videos').remove([path]);
  if (error) throw error;
}
