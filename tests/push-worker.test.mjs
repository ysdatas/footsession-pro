/* Notifications (worker/push.js) : chiffrement conforme à la RFC 8291
   (son exemple, octet pour octet), signature VAPID vérifiable, envoi
   réservé à l'administrateur, appareils disparus retirés. Faux
   Supabase et faux services d'envoi (Apple, Google) qui déchiffrent
   ce qu'ils reçoivent comme le ferait le téléphone.
   Lancement : node tests/push-worker.test.mjs */
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { encrypt } from '../worker/push.js';
import { b64u, unb64u } from '../worker/common.js';

const S = crypto.subtle;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const enc = (s) => new TextEncoder().encode(s);
const jwkOf = (pub, d) => ({ kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ...(d && { d }) });

/* ---------- 1. Exemple de la RFC 8291 (section 5 et annexe A) ---------- */
{
  const asPub = unb64u('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
  const local = {
    publicKey: await S.importKey('raw', asPub, ECDH, true, []),
    privateKey: await S.importKey('jwk', jwkOf(asPub, 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'), ECDH, false, ['deriveBits']),
  };
  const sub = { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' };
  const body = await encrypt(sub, enc('When I grow up, I want to be a watermelon'), { salt: unb64u('DGv6ra1nlYgDCS1FRnbzlw'), local });
  assert.equal(b64u(body), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    'message chiffré identique à celui de la RFC');
}

/* ---------- 2. Un téléphone : clés de l'appareil, déchiffrement ---------- */
async function phone(endpoint) {
  const keys = await S.generateKey(ECDH, true, ['deriveBits']);
  const secret = crypto.getRandomValues(new Uint8Array(16));
  const pub = new Uint8Array(await S.exportKey('raw', keys.publicKey));
  return { endpoint, p256dh: b64u(pub), auth: b64u(secret), keys, secret, pub };
}
const hkdf = async (salt, ikm, info, n) => new Uint8Array(await S.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info },
  await S.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
async function decrypt(ph, body) {
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen);
  const shared = await S.deriveBits({ name: 'ECDH', public: await S.importKey('raw', asPub, ECDH, false, []) }, ph.keys.privateKey, 256);
  const ikm = await hkdf(ph.secret, shared, new Uint8Array([...enc('WebPush: info\0'), ...ph.pub, ...asPub]), 32);
  const cek = await hkdf(salt, ikm, enc('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc('Content-Encoding: nonce\0'), 12);
  const plain = new Uint8Array(await S.decrypt({ name: 'AES-GCM', iv: nonce }, await S.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), body.slice(21 + idlen)));
  assert.equal(plain.at(-1), 2, 'délimiteur du dernier bloc');
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

/* Clés du serveur (comme celles collées sur Cloudflare). */
const vapid = await S.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const VAPID_PUBLIC_KEY = b64u(await S.exportKey('raw', vapid.publicKey));
const VAPID_PRIVATE_KEY = (await S.exportKey('jwk', vapid.privateKey)).d;

const ADMIN = '00000000-0000-0000-0000-000000000001', JOUEUR = '00000000-0000-0000-0000-000000000004', AUTRE = '00000000-0000-0000-0000-000000000009';
const jwt = (sub) => `x.${b64u(enc(JSON.stringify({ sub })))}.y`;
const TOKENS = { [jwt(ADMIN)]: { admin: true, club: 1 }, [jwt(JOUEUR)]: { admin: false, club: 1 }, [jwt(AUTRE)]: { admin: true, club: 2 } };
const PLAYERS = [{ id: 10, club: 1, auth_user_id: JOUEUR }, { id: 11, club: 1, auth_user_id: null }, { id: 20, club: 2, auth_user_id: AUTRE }];
const iphone = await phone('https://web.push.apple.com/QGuQ1');
const android = await phone('https://fcm.googleapis.com/fcm/send/abc');
const ancien = await phone('https://fcm.googleapis.com/fcm/send/parti');
const monTel = await phone('https://web.push.apple.com/admin');
let SUBS = [
  { id: 1, user_id: JOUEUR, club: 1, ...iphone }, { id: 2, user_id: JOUEUR, club: 1, ...android },
  { id: 3, user_id: JOUEUR, club: 1, ...ancien }, { id: 4, user_id: ADMIN, club: 1, ...monTel },
];
const received = [];
const TAKE = {};   // réponses de calendar_notifs_take par jeton

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.origin !== 'https://sb.test') {   // service d'envoi
    const [scheme, t, k] = init.headers.authorization.match(/^(vapid) t=([^,]+), k=(.+)$/).slice(1);
    assert.equal(scheme, 'vapid');
    assert.equal(k, VAPID_PUBLIC_KEY);
    const [h, c, sig] = t.split('.');
    assert.ok(await S.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapid.publicKey, unb64u(sig), enc(`${h}.${c}`)), 'signature VAPID valide');
    const claims = JSON.parse(new TextDecoder().decode(unb64u(c)));
    assert.equal(claims.aud, u.origin, 'jeton pour CE service');
    assert.match(claims.sub, /^https:\/\//);
    assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600, 'expire en moins de 24 h');
    assert.equal(init.headers['content-encoding'], 'aes128gcm');
    if (u.pathname.endsWith('/parti')) return new Response('', { status: 410 });
    const ph = [iphone, android, monTel].find(p => p.endpoint === url);
    received.push({ to: url, msg: await decrypt(ph, init.body) });
    return new Response('', { status: 201 });
  }
  assert.equal(init.headers.apikey, 'cle-publique');
  const who = TOKENS[init.headers.authorization.replace('Bearer ', '')];
  if (!who) return new Response('{"message":"JWT expired"}', { status: 401 });
  const inList = (k) => (u.searchParams.get(k) || '').replace(/^in\.\(|\)$/g, '').split(',');
  if (u.pathname === '/rest/v1/rpc/is_club_admin') return Response.json(who.admin);
  if (u.pathname === '/rest/v1/rpc/calendar_notifs_take') {   // lmfc_v30.sql : messages préparés par la base, pour CET appelant
    const mine = TAKE[init.headers.authorization.replace('Bearer ', '')] || { messages: [], more: false };
    return Response.json(mine);
  }
  if (u.pathname === '/rest/v1/players') {   // RLS : joueurs du club
    return Response.json(PLAYERS.filter(p => p.club === who.club && p.auth_user_id && inList('id').includes(String(p.id))).map(p => ({ auth_user_id: p.auth_user_id })));
  }
  if (u.pathname === '/rest/v1/push_subscriptions') {   // RLS : appareils du club
    const mine = SUBS.filter(s => s.club === who.club && who.admin);
    if (init.method === 'DELETE') { SUBS = SUBS.filter(s => !(mine.includes(s) && inList('id').includes(String(s.id)))); return new Response(null, { status: 204 }); }
    return Response.json(mine.filter(s => inList('user_id').includes(s.user_id)).map(({ id, user_id, endpoint, p256dh, auth }) => ({ id, user_id, endpoint, p256dh, auth })));
  }
  return new Response('inconnu', { status: 404 });
};

const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_KEY: 'cle-publique', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY };
const call = (method, path, { token, body } = {}, e = env) => worker.fetch(new Request(`https://site.test${path}`, {
  method, body: body && JSON.stringify(body), headers: token ? { authorization: `Bearer ${token}` } : {},
}), e);
const MSG = { title: 'Entraînement avancé', body: 'Rendez-vous 17 h 30 au stade.', url: 'mon-espace.html' };

/* ---------- 3. Clé publique ---------- */
assert.deepEqual(await (await call('GET', '/api/push/key')).json(), { key: VAPID_PUBLIC_KEY });
let r = await call('GET', '/api/push/key', {}, { ...env, VAPID_PRIVATE_KEY: undefined });
assert.equal(r.status, 503, 'clé absente sur Cloudflare : 503');
assert.doesNotMatch((await r.json()).error, /VAPID|secret|Cloudflare/i, 'aucun détail technique à l’écran');

/* ---------- 4. Droits ---------- */
assert.equal((await call('POST', '/api/push/send', { body: { ...MSG, player_ids: [10] } })).status, 401, 'sans connexion');
assert.equal((await call('POST', '/api/push/send', { token: jwt(JOUEUR), body: { ...MSG, player_ids: [10] } })).status, 403, 'un joueur n’envoie pas');
assert.equal((await call('POST', '/api/push/send', { token: jwt(ADMIN), body: { ...MSG, title: '', player_ids: [10] } })).status, 400, 'titre requis');
assert.equal((await call('POST', '/api/push/send', { token: jwt(ADMIN), body: { ...MSG, player_ids: ['10 or 1=1'] } })).status, 400, 'identifiants numériques');
assert.equal((await call('POST', '/api/push/send', { token: jwt(ADMIN), body: { ...MSG, player_ids: Array.from({ length: 16 }, (_, i) => i) } })).status, 400, '15 joueurs par appel');

/* ---------- 5. Envoi : chaque appareil du joueur, l'appareil disparu est retiré ---------- */
r = await call('POST', '/api/push/send', { token: jwt(ADMIN), body: { ...MSG, player_ids: [10, 11] } });
assert.equal(r.status, 200);
assert.deepEqual(await r.json(), { devices: 3, sent: 2, users: 1, gone: 1 });
assert.deepEqual(received.map(x => x.to).sort(), [android.endpoint, iphone.endpoint].sort(), 'iPhone et Android du joueur');
received.forEach(x => assert.deepEqual(x.msg, MSG, 'message déchiffré par le téléphone'));
assert.ok(!SUBS.some(s => s.id === 3), 'appareil désabonné (410) retiré de la base');

/* Lien hors du site remplacé par l'accueil ; l'admin d'un autre club n'atteint pas nos joueurs. */
received.length = 0;
await call('POST', '/api/push/send', { token: jwt(ADMIN), body: { ...MSG, url: 'https://ailleurs.test/', player_ids: [10] } });
assert.ok(received.length && received.every(x => x.msg.url === 'index.html'), 'lien externe refusé');
received.length = 0;
r = await (await call('POST', '/api/push/send', { token: jwt(AUTRE), body: { ...MSG, player_ids: [10] } })).json();
assert.equal(r.devices, 0, 'joueur d’un autre club : aucun appareil');
assert.equal(received.length, 0);

/* « M'envoyer un test » : seulement les appareils de l'admin. */
r = await (await call('POST', '/api/push/send', { token: jwt(ADMIN), body: { ...MSG, self: true } })).json();
assert.deepEqual(r, { devices: 1, sent: 1, users: 1, gone: 0 });
assert.deepEqual(received.map(x => x.to), [monTel.endpoint]);

/* ---------- 6. Calendrier (lmfc_v30.sql) : les messages préparés par la base, rien de la page ---------- */
received.length = 0;
const COACH = '00000000-0000-0000-0000-000000000002';
TOKENS[jwt(COACH)] = { admin: false, club: 1 };
const CAL = { title: '2 séances ajoutées', body: 'Entraînement · du jeu. 07/01 au ven. 08/01', url: 'calendrier.html' };
TAKE[jwt(COACH)] = { messages: [{ ...CAL, subs: [iphone, android].map((p, i) => ({ id: 1 + i, ...p })) }], more: true };
assert.equal((await call('POST', '/api/push/calendar')).status, 401, 'sans connexion');
assert.equal((await call('GET', '/api/push/calendar', { token: jwt(COACH) })).status, 405);
r = await call('POST', '/api/push/calendar', { token: jwt(COACH), body: { title: 'texte de la page', player_ids: [10] } });
assert.deepEqual(await r.json(), { devices: 2, sent: 2, more: true }, 'un coach : ses changements, pas besoin d’être admin');
received.forEach(x => assert.deepEqual(x.msg, CAL, 'texte de la base, jamais celui envoyé par la page'));
TAKE[jwt(COACH)] = { messages: [{ ...CAL, url: 'https://ailleurs.test/', subs: [{ id: 1, ...iphone }] }], more: false };
received.length = 0;
assert.deepEqual(await (await call('POST', '/api/push/calendar', { token: jwt(COACH) })).json(), { devices: 1, sent: 1, more: false });
assert.equal(received[0].msg.url, 'index.html', 'lien hors du site refusé');
assert.deepEqual(await (await call('POST', '/api/push/calendar', { token: jwt(JOUEUR) })).json(), { devices: 0, sent: 0, more: false }, 'rien en attente');

console.log('push-worker : OK (RFC 8291, VAPID, droits, nettoyage, calendrier)');
