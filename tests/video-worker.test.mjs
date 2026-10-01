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
    return { ...meta(o), range, body: new Blob([o.data.slice(start, end)]).stream() };
  },
  async put(key, body, opts) { store.set(key, { data: new Uint8Array(await new Response(body).arrayBuffer()), type: opts.httpMetadata.contentType }); },
  async delete(key) { store.delete(key); },
};

/* ---------- Faux Supabase : qui voit quoi, qui gère les vidéos ---------- */
const USERS = {
  staff7: { can: true, club: 7, sees: (p) => p.startsWith('r2/7/') },
  joueur12: { can: false, club: 7, sees: (p) => p.startsWith('r2/7/12/') },
  staff8: { can: true, club: 8, sees: (p) => p.startsWith('r2/8/') },
};
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  assert.equal(u.origin, 'https://sb.test');
  assert.equal(init.headers.apikey, 'cle-publique');
  const user = USERS[init.headers.authorization.replace('Bearer ', '')];
  if (!user) return new Response('{"message":"JWT expired"}', { status: 401 });
  if (u.pathname === '/rest/v1/rpc/can_manage_videos') return Response.json(user.can);
  if (u.pathname === '/rest/v1/rpc/my_club_id') return Response.json(user.club);
  if (u.pathname === '/rest/v1/player_videos') {
    const asked = u.searchParams.get('storage_path').match(/"[^"]+"/g).map(s => s.slice(1, -1));
    return Response.json(asked.filter(user.sees).map(storage_path => ({ storage_path })));
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
assert.equal((await call('GET', url, { headers: { range: 'bytes=50-60' } })).status, 416, 'plage hors du fichier');
r = await call('HEAD', url);
assert.equal(r.status, 200);
assert.equal(r.headers.get('content-length'), '10');

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
assert.equal((await call('DELETE', `/api/videos/file/${A}`, { token: 'staff7' })).status, 200);
assert.equal(store.has(A), false);
assert.equal((await call('GET', url)).status, 404, 'supprimée : introuvable');

/* ---------- Secret oublié : erreur claire, rien ne fuit ---------- */
const orig = console.error; let logged = '';
console.error = (...a) => { logged = a.join(' '); };
r = await call('POST', '/api/videos/sign', { token: 'staff7', body: JSON.stringify({ paths: [B] }) }, { ...env, VIDEO_URL_SECRET: '' });
console.error = orig;
assert.equal(r.status, 500);
assert.match(logged, /VIDEO_URL_SECRET/);

console.log('video-worker : OK');
