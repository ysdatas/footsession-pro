/* Worker vidéos (worker/index.js) : droits, liens signés et lecture
   partielle (Range), avec un R2 en mémoire et un faux Supabase qui
   applique les mêmes règles que la RLS.
   Lancement : node tests/video-worker.test.mjs */
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

/* ---------- R2 en mémoire (Range : « a-b », « a- », « -n ») ---------- */
const store = new Map();
const meta = (o) => ({ size: o.data.length, httpEtag: '"v1"', writeHttpMetadata: (h) => h.set('content-type', o.type) });
const VIDEOS = {
  async head(key) { const o = store.get(key); return o ? meta(o) : null; },
  async get(key, opts = {}) {
    const o = store.get(key);
    if (!o) return null;
    let range;
    const h = opts.range?.get('range');
    if (h) {
      const [, a, b] = h.match(/^bytes=(\d*)-(\d*)$/);
      range = a === '' ? { suffix: Number(b) } : b === '' ? { offset: Number(a) } : { offset: Number(a), length: Number(b) - Number(a) + 1 };
      if (range.offset >= o.data.length) throw new Error('InvalidRange');
    }
    const start = !range ? 0 : 'suffix' in range ? o.data.length - range.suffix : range.offset;
    const end = range?.length ? start + range.length : o.data.length;
    // Comme en production : obj.range porte des clés vides (offset, length, suffix
    // à undefined), ce qui donnait « bytes NaN-NaN » avant le calcul par l'en-tête.
    return { ...meta(o), range: range && { offset: undefined, length: undefined, suffix: undefined }, body: new Blob([o.data.slice(start, end)]).stream() };
  },
  async put(key, body, opts) { store.set(key, { data: new Uint8Array(await new Response(body).arrayBuffer()), type: opts.httpMetadata.contentType }); },
  async delete(key) { store.delete(key); },
};

/* ---------- Faux Supabase : qui voit quoi, qui gère les vidéos ---------- */
// writes : joueurs que le compte peut modifier (player_level, lmfc_v19.sql).
// lib : fichiers de la bibliothèque lisibles (library_files) ; release : library_file_release.
const LIB_PRIVE = 'r2/7/lib/1700000101.mp4', LIB_UTILISE = 'r2/7/lib/1700000102.mp4';
const USERS = {
  staff7: { can: true, club: 7, sees: (p) => p.startsWith('r2/7/'), writes: () => true,
    lib: (p) => p.startsWith('r2/7/lib/') && p !== LIB_PRIVE, release: (p) => p.startsWith('r2/7/lib/') && p !== LIB_UTILISE },
  joueur12: { can: false, club: 7, sees: (p) => p.startsWith('r2/7/12/'), writes: () => false, lib: () => false, release: () => false },
  staff8: { can: true, club: 8, sees: (p) => p.startsWith('r2/8/'), writes: () => true, lib: (p) => p.startsWith('r2/8/lib/'), release: () => false },
  coachU19: { can: true, club: 7, sees: (p) => p.startsWith('r2/7/'), writes: (id) => id !== 12,   // joueur 12 : lecture seule
    lib: () => true, release: () => false },
};
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  assert.equal(u.origin, 'https://sb.test');
  assert.equal(init.headers.apikey, 'cle-publique');
  const user = USERS[init.headers.authorization.replace('Bearer ', '')];
  if (!user) return new Response('{"message":"JWT expired"}', { status: 401 });
  if (u.pathname === '/rest/v1/rpc/can_manage_videos') return Response.json(user.can);
  if (u.pathname === '/rest/v1/rpc/my_club_id') return Response.json(user.club);
  if (u.pathname === '/rest/v1/rpc/player_level') return Response.json(user.writes(JSON.parse(init.body).p_player) ? 'modification' : 'lecture');
  if (u.pathname === '/rest/v1/rpc/library_file_release') return Response.json(user.release(JSON.parse(init.body).p_path));
  if (u.pathname === '/rest/v1/player_videos' || u.pathname === '/rest/v1/library_files') {
    const asked = u.searchParams.get('storage_path').match(/"[^"]+"/g).map(s => s.slice(1, -1));
    assert.ok(asked.every(p => /\/lib\//.test(p) === u.pathname.endsWith('library_files')), 'chaque chemin vérifié sur sa table');
    const sees = u.pathname.endsWith('library_files') ? user.lib : user.sees;
    return Response.json(asked.filter(sees).map(storage_path => ({ storage_path })));
  }
  return new Response('inconnu', { status: 404 });
};

const env = { VIDEOS, SUPABASE_URL: 'https://sb.test', SUPABASE_KEY: 'cle-publique', VIDEO_URL_SECRET: 'secret-de-test' };
const call = (method, path, { token, body, headers = {} } = {}, e = env) => worker.fetch(new Request(`https://site.test${path}`, {
  method, body, headers: { ...(token && { authorization: `Bearer ${token}` }), ...headers },
}), e);
const put = (key, token, bytes, type = 'video/mp4') => call('PUT', `/api/videos/file/${key}`,
  { token, body: bytes, headers: { 'content-type': type, 'content-length': String(bytes.length) } });
const sign = (token, paths) => call('POST', '/api/videos/sign', { token, body: JSON.stringify({ paths }) });

const A = 'r2/7/12/1700000000.mp4', B = 'r2/7/13/1700000001.mov', C = 'r2/8/20/1700000002.mp4';
const bytes = new TextEncoder().encode('0123456789');

/* ---------- Envoi ---------- */
assert.equal((await call('GET', '/api/autre')).status, 404, 'hors /api/videos : rien');
assert.equal((await put(A, 'joueur12', bytes)).status, 403, 'un joueur n’envoie pas');
assert.equal((await put(A, 'staff8', bytes)).status, 403, 'le staff d’un autre club non plus');
assert.equal((await put(A, 'inconnu', bytes)).status, 403, 'jeton expiré : refusé');
assert.equal((await put(A, null, bytes)).status, 403, 'sans jeton : refusé');
assert.equal((await put('r2/7/12/../../x.mp4', 'staff7', bytes)).status, 400, 'chemin hors format : refusé');
assert.equal((await call('PUT', `/api/videos/file/${A}`, { token: 'staff7', body: bytes,
  headers: { 'content-length': String(96 * 1024 * 1024) } })).status, 413, 'au-delà de 95 Mo : refusé');
assert.equal((await put(A, 'coachU19', bytes)).status, 403, 'joueur en lecture seule pour ce coach : pas d’envoi');
assert.equal((await put(A, 'staff7', bytes)).status, 201, 'le staff vidéo du club envoie');
assert.equal((await put(B, 'staff7', bytes, 'text/html')).status, 201);
assert.equal(store.get(B).type, 'video/mp4', 'un type non vidéo est ramené à video/mp4');
assert.equal((await put(C, 'staff8', bytes)).status, 201);

/* ---------- Liens de lecture : la RLS décide ---------- */
const urlsOf = async (token, paths) => (await (await sign(token, paths)).json()).urls;
assert.deepEqual(Object.keys(await urlsOf('joueur12', [A, B, C])), [A], 'le joueur ne reçoit que ses vidéos');
assert.deepEqual(Object.keys(await urlsOf('staff7', [A, B, C])), [A, B], 'le staff : celles de son club');
assert.deepEqual(Object.keys(await urlsOf('staff8', [A, B])), [], 'rien du club voisin');
assert.equal((await sign(null, [A])).status, 401);
assert.equal((await sign('inconnu', [A])).status, 401, 'session expirée');
assert.equal((await sign('staff7', ['../etc/passwd'])).status, 400);
assert.equal((await sign('staff7', Array(101).fill(A))).status, 400, '100 chemins au plus par appel');
assert.equal((await call('GET', '/api/videos/sign')).status, 405);

/* ---------- Lecture ---------- */
const url = (await urlsOf('joueur12', [A]))[A];
assert.match(url, /^\/api\/videos\/file\/r2\/7\/12\/1700000000\.mp4\?e=\d+&s=[\w-]+$/);
let r = await call('GET', url);
assert.equal(r.status, 200);
assert.equal(await r.text(), '0123456789');
assert.equal(r.headers.get('content-type'), 'video/mp4');
assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
assert.equal(r.headers.get('accept-ranges'), 'bytes');
assert.equal(r.headers.get('content-length'), '10');

r = await call('GET', url, { headers: { range: 'bytes=0-1' } });     // première requête de Safari
assert.equal(r.status, 206);
assert.equal(r.headers.get('content-range'), 'bytes 0-1/10');
assert.equal(r.headers.get('content-length'), '2');
assert.equal(await r.text(), '01');
r = await call('GET', url, { headers: { range: 'bytes=4-' } });
assert.equal(r.headers.get('content-range'), 'bytes 4-9/10');
assert.equal(await r.text(), '456789');
r = await call('GET', url, { headers: { range: 'bytes=-3' } });
assert.equal(r.headers.get('content-range'), 'bytes 7-9/10');
assert.equal(await r.text(), '789');
r = await call('GET', url, { headers: { range: 'bytes=8-500' } });   // fin au-delà du fichier : bornée
assert.equal(r.headers.get('content-range'), 'bytes 8-9/10');
assert.equal(r.headers.get('content-length'), '2');
assert.equal(await r.text(), '89');
assert.equal((await call('GET', url, { headers: { range: 'bytes=50-60' } })).status, 416, 'plage hors du fichier');
r = await call('GET', `${url}&dl=1&n=VS Nantes/../x`);   // vidéo d'origine (compilation)
assert.equal(r.headers.get('content-disposition'), 'attachment; filename="VS-Nantes-..-x.mp4"', 'nom nettoyé, pas de chemin');
assert.equal(await r.text(), '0123456789');
r = await call('HEAD', url);
assert.equal(r.status, 200);
assert.equal(r.headers.get('content-length'), '10');

// .mov d'iPhone (video/quicktime) : annoncé video/mp4, que Firefox accepte aussi.
const M = 'r2/7/12/1700000003.mov';
assert.equal((await put(M, 'staff7', bytes, 'video/quicktime')).status, 201);
r = await call('GET', (await urlsOf('joueur12', [M]))[M], { headers: { range: 'bytes=0-' } });
assert.equal(r.headers.get('content-type'), 'video/mp4');
assert.equal(r.headers.get('content-range'), 'bytes 0-9/10');
assert.equal(await r.text(), '0123456789');

const [, e, s] = url.match(/e=(\d+)&s=(.+)$/);
assert.equal((await call('GET', url.replace(/s=.+$/, 's=AAAA'))).status, 403, 'signature falsifiée');
assert.equal((await call('GET', url.replace(/s=.+$/, 's=%%%'))).status, 403, 'signature illisible');
assert.equal((await call('GET', `/api/videos/file/${B}?e=${e}&s=${s}`)).status, 403, 'la signature ne vaut que pour son chemin');
assert.equal((await call('GET', `/api/videos/file/${A}?e=${Number(e) + 60}&s=${s}`)).status, 403, 'échéance modifiée');
const hmac = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.VIDEO_URL_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const signed = async (msg) => Buffer.from(await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode(msg))).toString('base64url');
const past = Math.floor(Date.now() / 1000) - 1;
assert.equal((await call('GET', `/api/videos/file/${A}?e=${e}&s=${await signed(`${A}:${e}`)}`)).status, 200, 'signature recalculée : valide');
assert.equal((await call('GET', `/api/videos/file/${A}?e=${past}&s=${await signed(`${A}:${past}`)}`)).status, 403, 'lien bien signé mais expiré');
assert.equal((await call('GET', `/api/videos/file/${A}`)).status, 403, 'sans signature');

/* ---------- Suppression ---------- */
assert.equal((await call('DELETE', `/api/videos/file/${A}`, { token: 'joueur12' })).status, 403);
assert.equal((await call('DELETE', `/api/videos/file/${A}`, { token: 'staff8' })).status, 403);
assert.equal((await call('DELETE', `/api/videos/file/${A}`, { token: 'coachU19' })).status, 403, 'lecture seule : pas de suppression');
assert.equal((await call('DELETE', `/api/videos/file/${A}`, { token: 'staff7' })).status, 200);
assert.equal(store.has(A), false);
assert.equal((await call('GET', url)).status, 404, 'supprimée : introuvable');

/* ---------- Bibliothèque (r2/<club>/lib/…, lmfc_v24.sql) ---------- */
const L = 'r2/7/lib/1700000100.mp4';
assert.equal((await put('r2/7/libx/1.mp4', 'staff7', bytes)).status, 400, 'dossier inconnu : refusé');
assert.equal((await put(L, 'joueur12', bytes)).status, 403, 'un joueur n’envoie rien dans la bibliothèque');
assert.equal((await put(L, 'staff8', bytes)).status, 403, 'ni le staff d’un autre club');
for (const k of [L, LIB_PRIVE, LIB_UTILISE]) assert.equal((await put(k, 'staff7', bytes)).status, 201, 'staff vidéo du club : envoi');
assert.equal((await put('r2/7/lib/1700000103.mp4', 'coachU19', bytes)).status, 201, 'pas de joueur : le droit vidéo du club suffit');
assert.deepEqual(Object.keys(await urlsOf('staff7', [B, L, LIB_PRIVE])), [B, L], 'lecture : ce que library_files montre');
assert.deepEqual(Object.keys(await urlsOf('joueur12', [L])), [], 'joueur : rien de la bibliothèque');
r = await call('GET', (await urlsOf('staff7', [L]))[L], { headers: { range: 'bytes=0-3' } });
assert.equal(r.status, 206);
assert.equal(await r.text(), '0123');
assert.equal((await call('DELETE', `/api/videos/file/${LIB_UTILISE}`, { token: 'staff7' })).status, 403, 'fichier encore utilisé : gardé');
assert.ok(store.has(LIB_UTILISE));
assert.equal((await call('DELETE', `/api/videos/file/${L}`, { token: 'coachU19' })).status, 403, 'refus de la base : gardé');
assert.equal((await call('DELETE', `/api/videos/file/${L}`, { token: 'staff7' })).status, 200);
assert.equal(store.has(L), false);

/* ---------- Secret oublié : erreur claire, rien ne fuit ---------- */
const orig = console.error; let logged = '';
console.error = (...a) => { logged = a.join(' '); };
r = await call('POST', '/api/videos/sign', { token: 'staff7', body: JSON.stringify({ paths: [B] }) }, { ...env, VIDEO_URL_SECRET: '' });
console.error = orig;
assert.equal(r.status, 503, 'réglage Cloudflare manquant : 503, pas une panne');
const shown = (await r.json()).error;
assert.match(shown, /pas encore configuré/, 'la page dit qui prévenir');
assert.doesNotMatch(shown, /VIDEO_URL_SECRET|Cloudflare/, 'aucun détail interne à l’écran');
assert.match(logged, /VIDEO_URL_SECRET/, 'le détail est dans les journaux');
assert.doesNotMatch(logged, /secret-de-test/);

console.log('video-worker : OK');
