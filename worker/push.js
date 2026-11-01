/* ============================================================
   LMFC Performance — Worker : notifications sur téléphone (Web Push).
     GET  /api/push/key   → clé publique du serveur (abonnement d'un appareil)
     POST /api/push/send  { title, body, url, player_ids, self }
     POST /api/push/calendar  → changements du calendrier faits par l'appelant
   L'envoi libre est réservé à l'administrateur du club. Celui du
   calendrier ne prend rien de la page : la base (lmfc_v30.sql) a préparé
   les messages et les destinataires de SES changements. Joueurs et appareils
   sont lus avec SON jeton : la RLS ne donne que ceux de son club
   (supabase/lmfc_v16.sql). Chaque message est chiffré pour l'appareil
   (RFC 8291, aes128gcm) et signé par la clé du serveur (VAPID,
   RFC 8292), avec WebCrypto seulement.
   Configuration : var VAPID_PUBLIC_KEY (wrangler.jsonc, publique) et
   secret VAPID_PRIVATE_KEY (tableau de bord Cloudflare, jamais dans le
   code). Changer de clés oblige chaque appareil à se réabonner.
   ============================================================ */
import { fail, ConfigError, tokenOf, supabase, b64u, unb64u } from './common.js';

const SUBJECT = 'https://lmfcperformance.com';   // contact du serveur, exigé par Apple et Google
// La page envoie par paquets : le Worker gratuit permet 50 sous-requêtes par appel.
const MAX_PLAYERS = 15;
const MAX_DEVICES = 40;
const TTL = 2 * 86400;                           // téléphone éteint : message gardé 2 jours
const URL_RE = /^[a-z-]+\.html(\?[\w=&-]*)?$/;   // page du site ouverte au toucher
const UUID_RE = /^[0-9a-f-]{36}$/;

const enc = (s) => new TextEncoder().encode(s);
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => { out.set(p, at); return at + p.length; }, 0);
  return out;
};

export async function push(request, env, route) {
  if (route === 'key') return request.method === 'GET' ? Response.json({ key: publicKey(env) }) : fail(405, 'Méthode non autorisée.');
  if (route === 'send') return request.method === 'POST' ? send(request, env) : fail(405, 'Méthode non autorisée.');
  if (route === 'calendar') return request.method === 'POST' ? calendar(request, env) : fail(405, 'Méthode non autorisée.');
  return new Response('Not found', { status: 404 });
}

function publicKey(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    throw new ConfigError('Notifications : VAPID_PUBLIC_KEY (wrangler.jsonc) ou secret VAPID_PRIVATE_KEY (Workers > footsession-pro > Settings > Variables and Secrets) absent.');
  }
  return env.VAPID_PUBLIC_KEY;
}

async function send(request, env) {
  const token = tokenOf(request);
  if (!token) return fail(401, 'Connexion requise.');
  const msg = await request.json().catch(() => null) || {};
  const title = String(msg.title || '').trim(), body = String(msg.body || '').trim();
  const ids = Array.isArray(msg.player_ids) ? msg.player_ids : [];
  if (!title || title.length > 80 || body.length > 300) return fail(400, 'Titre (80 caractères) ou message (300) invalide.');
  if (ids.length > MAX_PLAYERS || !ids.every(Number.isSafeInteger) || (!ids.length && !msg.self)) return fail(400, 'Destinataires invalides.');
  const url = URL_RE.test(msg.url || '') ? msg.url : 'index.html';
  publicKey(env);   // réglage manquant : on le dit avant tout le reste

  const admin = await supabase(env, token, '/rest/v1/rpc/is_club_admin', { method: 'POST', body: '{}' });
  if (admin === null) return fail(401, 'Session expirée : reconnecte-toi.');
  if (admin !== true) return fail(403, 'Envoi réservé à l’administrateur du club.');

  const users = new Set();
  if (msg.self) users.add(userIdOf(token));
  if (ids.length) {
    const rows = await supabase(env, token, `/rest/v1/players?select=auth_user_id&auth_user_id=not.is.null&id=in.(${ids.join(',')})`);
    (rows || []).forEach(r => users.add(r.auth_user_id));
  }
  const list = [...users].filter(u => UUID_RE.test(u || ''));
  const subs = list.length
    ? await supabase(env, token, `/rest/v1/push_subscriptions?select=id,user_id,endpoint,p256dh,auth&user_id=in.(${list.join(',')})`) || []
    : [];
  if (subs.length > MAX_DEVICES) return fail(413, 'Trop d’appareils en un seul envoi.');
  const { results, gone } = await deliver(env, token, subs.map(sub => ({ sub, msg: { title, body, url } })));
  const ok = subs.filter((_, i) => results[i] === 'ok');
  return Response.json({ devices: subs.length, sent: ok.length, users: new Set(ok.map(s => s.user_id)).size, gone });
}

/* Calendrier : un message par joueur, au plus 12 joueurs et 3 appareils
   chacun par appel (sous les 50 sous-requêtes) ; more : la page rappelle. */
async function calendar(request, env) {
  const token = tokenOf(request);
  if (!token) return fail(401, 'Connexion requise.');
  publicKey(env);
  const out = await supabase(env, token, '/rest/v1/rpc/calendar_notifs_take', { method: 'POST', body: JSON.stringify({ p_max: 12 }) });
  if (!out) return fail(502, 'Notifications du calendrier indisponibles.');
  const list = (out.messages || []).flatMap(m => (m.subs || []).map(sub => ({ sub,
    msg: { title: String(m.title).slice(0, 80), body: String(m.body).slice(0, 300), url: URL_RE.test(m.url || '') ? m.url : 'index.html' } })))
    .slice(0, MAX_DEVICES);
  const { results } = await deliver(env, token, list);
  return Response.json({ devices: list.length, sent: results.filter(r => r === 'ok').length, more: !!out.more });
}

/* Chaque appareil reçoit son message, chiffré pour lui et signé (VAPID).
   Un appareil désabonné (404, 410) est effacé si le jeton le permet (admin). */
async function deliver(env, token, list) {
  const key = list.length && await signingKey(env);
  const headers = new Map();   // une signature par service d'envoi (Apple, Google…)
  const results = await Promise.all(list.map(async ({ sub: s, msg }) => {
    try {
      const aud = new URL(s.endpoint).origin;
      if (!headers.has(aud)) headers.set(aud, vapidHeader(env, key, aud));
      const r = await fetch(s.endpoint, {
        method: 'POST',
        headers: { authorization: await headers.get(aud), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: String(TTL), urgency: 'high' },
        body: await encrypt(s, enc(JSON.stringify(msg))),
      });
      if (r.ok) return 'ok';
      if (r.status === 404 || r.status === 410) return 'gone';   // appareil désabonné ou application supprimée
      console.warn('Notification refusée', r.status, aud, await r.text());
    } catch (e) { console.warn('Notification non envoyée', e); }
    return 'fail';
  }));
  const gone = list.filter((_, i) => results[i] === 'gone').map(x => x.sub.id);
  if (gone.length) await supabase(env, token, `/rest/v1/push_subscriptions?id=in.(${gone.join(',')})`, { method: 'DELETE' });
  return { results, gone: gone.length };
}

/* Le jeton a déjà été vérifié par Supabase (is_club_admin) : on lit seulement son « sub ». */
function userIdOf(token) {
  try { return JSON.parse(new TextDecoder().decode(unb64u(token.split('.')[1]))).sub; } catch { return null; }
}

/* ---------- VAPID (RFC 8292) : JWT ES256 signé par la clé du serveur ---------- */
function signingKey(env) {
  const pub = unb64u(publicKey(env));
  return crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: env.VAPID_PRIVATE_KEY,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}
async function vapidHeader(env, key, aud) {
  const part = (o) => b64u(enc(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(unsigned));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/* ---------- Chiffrement du message (RFC 8291, un seul bloc aes128gcm) ----------
   salt et local : imposés seulement par le test (vecteur de la RFC). */
export async function encrypt(sub, payload, { salt = crypto.getRandomValues(new Uint8Array(16)), local } = {}) {
  const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
  const uaPublic = unb64u(sub.p256dh), secret = unb64u(sub.auth);
  local ||= await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, ECDH, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256);
  const ikm = await hkdf(secret, shared, concat(enc('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(payload, Uint8Array.of(2)));
  const header = new Uint8Array(21);   // salt (16) · taille de bloc (4) · longueur de la clé (1)
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, new Uint8Array(sealed));
}
async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8));
}
