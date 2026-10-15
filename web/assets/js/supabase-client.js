/* ============================================================
   LMFC Performance — client Supabase (Chemin B)
   Charge le SDK Supabase via CDN (aucun build, aucun npm requis).
   ============================================================ */

const SUPABASE_URL = 'https://ygnvijxspkrqhasvjfqg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ebJBeOm5WM5j8mOPHUknoA_zzdcWVG4';

/* Journal de temps (diagnostic) : ?perf=1 dans l'adresse l'active pour cet
   appareil (?perf=0 l'arrête). Chaque requête à la base, sa durée et l'heure
   de la page s'affichent dans la console du navigateur. */
const PERF_LOG = (() => {
  try {
    const q = new URLSearchParams(location.search).get('perf');
    if (q === '1') localStorage.setItem('lmfc-perf', '1');
    if (q === '0') localStorage.removeItem('lmfc-perf');
    return localStorage.getItem('lmfc-perf') === '1';
  } catch { return false; }
})();
const perfRows = [];
function perfFetch(url, opts) {
  if (!PERF_LOG) return fetch(url, opts);
  const t0 = performance.now();
  const done = (status) => {
    perfRows.push({ requête: String(url).replace(SUPABASE_URL, '').split('?')[0], début_ms: Math.round(t0), durée_ms: Math.round(performance.now() - t0), statut: status });
    clearTimeout(perfFetch.timer);
    perfFetch.timer = setTimeout(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      console.log(`[perf] ${location.pathname} · page reçue ${Math.round(nav?.responseEnd || 0)} ms · prête ${Math.round(nav?.domContentLoadedEventEnd || 0)} ms`);
      console.table(perfRows);
    }, 1200);
  };
  return fetch(url, opts).then(r => { done(r.status); return r; }, e => { done(e?.name || 'erreur'); throw e; });
}

// window.supabase est injecté par le script CDN chargé juste avant ce fichier.
// persistSession + autoRefreshToken : l'utilisateur reste connecté d'une visite
// à l'autre sans ressaisir son mot de passe (le jeton est renouvelé tout seul).
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'footsession-auth',
  },
  // Jamais de « Chargement… » sans fin : une requête sans réponse échoue au
  // bout de 30 s et la page l'affiche. Les envois de fichiers en sont exclus.
  global: {
    fetch: (url, opts = {}) => (opts.signal || /\/storage\/v1\/object/.test(url) && opts.method && opts.method !== 'GET'
      ? perfFetch(url, opts) : perfFetch(url, { ...opts, signal: AbortSignal.timeout(30000) })),
  },
});

/* ---------- Vidéos joueurs ----------
   Les nouvelles vidéos sont sur Cloudflare R2 (chemin « r2/… »), servies
   par le Worker du site (worker/index.js) : bande passante gratuite. Les
   anciennes restent lisibles dans le bucket Supabase « player-videos ». */
const VIDEO_MAX_BYTES = 95 * 1024 * 1024;   // = MAX_BYTES du Worker
const isR2Video = (path) => path.startsWith('r2/');

/* Appel au Worker du site (/api/…) avec le jeton de l'utilisateur. */
async function siteApi(route, init = {}, what = 'Serveur') {
  const { data: { session } } = await sb.auth.getSession();
  let r;
  try {
    r = await fetch(`/api/${route}`, {
      signal: AbortSignal.timeout(15000),   // sans réponse en 15 s : erreur affichée, pas d'attente sans fin
      ...init, headers: { authorization: `Bearer ${session?.access_token || ''}`, ...init.headers },
    });
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new Error(`${what} : pas de réponse, réessayez.`);
    throw e;
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `${what} indisponible (${r.status}).`);
  return body;
}
const videoApi = (route, init) => siteApi(`videos/${route}`, init, 'Serveur vidéo');

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

/* Envoi d'un fichier. XHR plutôt que fetch : seul XHR donne l'avancement
   de l'envoi (onProgress reçoit 0 → 1). signal : AbortController pour annuler. */
async function uploadVideoFile(path, file, { onProgress, signal } = {}) {
  const { data: { session } } = await sb.auth.getSession();
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', `/api/videos/file/${path}`);
    x.setRequestHeader('authorization', `Bearer ${session?.access_token || ''}`);
    x.setRequestHeader('content-type', file.type || 'video/mp4');
    if (onProgress) x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => {
      let body = {};
      try { body = JSON.parse(x.responseText); } catch { /* réponse vide */ }
      if (x.status >= 200 && x.status < 300) resolve(body);
      else reject(new Error(body.error || `Serveur vidéo indisponible (${x.status}).`));
    };
    x.onerror = () => reject(new Error('Connexion interrompue pendant l’envoi.'));
    x.onabort = () => reject(Object.assign(new Error('Envoi annulé.'), { name: 'AbortError' }));
    if (signal?.aborted) return x.onabort();
    signal?.addEventListener('abort', () => x.abort(), { once: true });
    x.send(file);
  });
}
async function removeVideoFile(path) {
  if (isR2Video(path)) return videoApi(`file/${path}`, { method: 'DELETE' });
  const { error } = await sb.storage.from('player-videos').remove([path]);
  if (error) throw error;
}

/* ---------- Corbeille (supabase/lmfc_v5.sql) ----------
   Migration passée : une suppression garde la ligne ET ses fichiers
   (vidéo, images) jusqu'à la suppression définitive depuis la page
   Corbeille. Avant la migration, les fichiers partent avec la ligne,
   comme avant. */
let trashCheck = null;
const trashReady = () => (trashCheck ??= sb.from('trash').select('id', { head: true, count: 'exact' }).limit(1)
  .then(({ error }) => !error, () => false));
/* Fin du message de confirmation d'une suppression. */
const trashNote = async () => ((await trashReady()) ? '\n\nRécupérable depuis la Corbeille.' : '\n\nC’est définitif.');
