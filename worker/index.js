/* ============================================================
   LMFC Performance — Worker Cloudflare : vidéos sur R2.
   Le site reste statique (web/, servi tel quel) ; ce Worker ne
   répond qu'aux adresses /api/videos/… (et /api/push/… :
   notifications, worker/push.js) :
     POST   /api/videos/sign          { paths } → liens de lecture (6 h)
     GET    /api/videos/file/<chemin>?e=&s=   → lecture (Range : Safari)
     PUT    /api/videos/file/<chemin>         → envoi (staff vidéo du club)
     DELETE /api/videos/file/<chemin>         → suppression (idem)
   Les droits restent ceux de Supabase : le Worker interroge l'API
   Supabase avec le jeton de l'utilisateur, la RLS décide. Lire une
   vidéo = pouvoir lire sa ligne player_videos ; envoyer ou supprimer
   = can_manage_videos(), le club du chemin est le sien et le compte
   peut modifier le joueur du chemin (player_level, lmfc_v19.sql).
   Bibliothèque (r2/<club>/lib/…, lmfc_v24.sql) : lire = pouvoir lire
   sa ligne library_files ; envoyer = can_manage_videos() dans son club ;
   supprimer = library_file_release(), qui refuse un fichier encore
   utilisé par un procédé (et donc par une séance).
   Bande passante R2 gratuite : aucune limite de visionnage.
   Configuration (wrangler.jsonc) : binding VIDEOS, vars SUPABASE_URL
   et SUPABASE_KEY (clé publique), secret VIDEO_URL_SECRET (tableau
   de bord Cloudflare, jamais dans le code).
   ============================================================ */

import { fail, ConfigError, tokenOf, supabase, b64u, unb64u } from './common.js';
import { push } from './push.js';

const TTL = 6 * 3600;                    // validité d'un lien de lecture (s)
const MAX_BYTES = 95 * 1024 * 1024;      // le Worker gratuit refuse au-delà de 100 Mo
const MAX_PATHS = 100;
// r2/<club_id>/<player_id>/<horodatage>.<ext> (vidéos joueurs) ou
// r2/<club_id>/lib/<horodatage>.<ext> (bibliothèque) : rien d'autre n'entre dans le bucket.
const KEY_RE = /^r2\/(\d+)\/(\d+|lib)\/\d+\.[a-zA-Z0-9]{1,8}$/;
const isLib = (key) => key.match(KEY_RE)[2] === 'lib';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname.match(/^\/api\/push\/(\w+)$/);
    const m = url.pathname.match(/^\/api\/videos\/(?:(sign)|file\/(.+))$/);
    if (!m && !p) return new Response('Not found', { status: 404 });
    try {
      if (p) return await push(request, env, p[1]);
      if (m[1]) return request.method === 'POST' ? await sign(request, env) : fail(405, 'Méthode non autorisée.');
      const key = decodeURIComponent(m[2]);
      if (!KEY_RE.test(key)) return fail(400, 'Chemin de vidéo invalide.');
      switch (request.method) {
        case 'GET': case 'HEAD': return await read(request, env, key, url);
        case 'PUT': return await write(request, env, key);
        case 'DELETE': return await remove(request, env, key);
        default: return fail(405, 'Méthode non autorisée.');
      }
    } catch (e) {
      console.error('Worker :', request.method, url.pathname, e);
      // Réglage manquant : le détail reste dans les journaux, la page dit seulement qui prévenir.
      const what = p ? 'Notifications pas encore configurées' : 'Serveur vidéo pas encore configuré';
      if (e instanceof ConfigError) return fail(503, `${what} : prévenez l’administrateur du club.`);
      return fail(500, p ? 'Erreur du serveur de notifications.' : 'Erreur du serveur vidéo.');
    }
  },
};

/* ---------- Droits vidéo (Supabase, avec le jeton de l'utilisateur) ---------- */
async function canManage(request, env, key) {
  const token = tokenOf(request);
  if (!token) return false;
  const rpc = (fn, args = {}) => supabase(env, token, `/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  const [, clubId, playerId] = key.match(KEY_RE);
  if (playerId === 'lib') {
    // La base retire la ligne du fichier, ou refuse s'il sert encore.
    if (request.method === 'DELETE') return (await rpc('library_file_release', { p_path: key })) === true;
    const [can, club] = await Promise.all([rpc('can_manage_videos'), rpc('my_club_id')]);
    return can === true && club !== null && String(club) === clubId;
  }
  const [can, club, level] = await Promise.all([rpc('can_manage_videos'), rpc('my_club_id'), rpc('player_level', { p_player: Number(playerId) })]);
  return can === true && club !== null && String(club) === clubId && level === 'modification';
}

/* ---------- Liens signés (HMAC-SHA256 du chemin et de l'échéance) ---------- */
async function hmacKey(env) {
  if (!env.VIDEO_URL_SECRET) {
    throw new ConfigError('Serveur vidéo incomplet : secret VIDEO_URL_SECRET absent sur Cloudflare (Workers > footsession-pro > Settings > Variables and Secrets, type « Secret »).');
  }
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.VIDEO_URL_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const signPart = async (env, msg) => b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(msg)));
async function validSig(env, msg, sig) {
  try { return await crypto.subtle.verify('HMAC', await hmacKey(env), unb64u(sig), new TextEncoder().encode(msg)); }
  catch (e) { if (e instanceof DOMException) return false; throw e; }   // signature mal formée
}

async function sign(request, env) {
  const token = tokenOf(request);
  const { paths } = await request.json().catch(() => ({}));
  if (!token) return fail(401, 'Connexion requise.');
  if (!Array.isArray(paths) || !paths.length || paths.length > MAX_PATHS
      || !paths.every(p => typeof p === 'string' && KEY_RE.test(p))) return fail(400, 'Liste de vidéos invalide.');
  // La RLS ne renvoie que les vidéos que cet utilisateur a le droit de voir :
  // vidéos joueurs d'un côté, fichiers de la bibliothèque de l'autre.
  const visible = (table, list) => {
    if (!list.length) return [];
    const q = new URLSearchParams({ select: 'storage_path', storage_path: `in.(${list.map(p => `"${p}"`).join(',')})` });
    return supabase(env, token, `/rest/v1/${table}?${q}`);
  };
  const [players, library] = await Promise.all([
    visible('player_videos', paths.filter(p => !isLib(p))), visible('library_files', paths.filter(isLib))]);
  if (!players || !library) return fail(401, 'Session expirée : reconnecte-toi.');
  const e = Math.floor(Date.now() / 1000) + TTL;
  const urls = {};
  for (const { storage_path: p } of [...players, ...library]) urls[p] = `/api/videos/file/${p}?e=${e}&s=${await signPart(env, `${p}:${e}`)}`;
  return Response.json({ urls });
}

/* ---------- Lecture, avec les requêtes partielles (Range) ---------- */
async function read(request, env, key, url) {
  const e = Number(url.searchParams.get('e'));
  if (!(e > Date.now() / 1000) || !(await validSig(env, `${key}:${e}`, url.searchParams.get('s') || ''))) {
    return fail(403, 'Lien de lecture expiré ou invalide.');
  }
  const ranged = request.method === 'GET' && request.headers.has('range');
  let obj;
  try {
    obj = request.method === 'HEAD' ? await env.VIDEOS.head(key)
      : await env.VIDEOS.get(key, ranged ? { range: request.headers } : {});
  } catch (err) {
    if (ranged) return new Response(null, { status: 416 });   // plage hors du fichier
    throw err;
  }
  if (!obj) return fail(404, 'Vidéo introuvable.');
  const h = new Headers();
  obj.writeHttpMetadata(h);
  // Jamais servi comme une page : seule une vidéo sort de ce bucket.
  // .mov (iPhone, Mac) annoncé en MP4 : même structure, et Firefox refuse video/quicktime.
  const type = h.get('content-type') || '';
  if (!/^video\//.test(type) || type === 'video/quicktime') h.set('content-type', 'video/mp4');
  h.set('x-content-type-options', 'nosniff');
  h.set('etag', obj.httpEtag);
  h.set('accept-ranges', 'bytes');
  h.set('cache-control', 'private, max-age=3600');
  // ?dl=1 : téléchargement du fichier d'origine (compilation, staff), nom lisible.
  if (url.searchParams.get('dl')) {
    const name = (url.searchParams.get('n') || 'video').replace(/[^\w.-]+/g, '-').slice(0, 80);
    h.set('content-disposition', `attachment; filename="${name}.${key.split('.').pop()}"`);
  }
  // Plage recalculée depuis l'en-tête et la taille : la forme de obj.range
  // n'est pas la même partout (en production elle donnait « bytes NaN-NaN »).
  const span = ranged && byteSpan(request.headers.get('range'), obj.size);
  if (span) {
    h.set('content-range', `bytes ${span.start}-${span.end}/${obj.size}`);
    h.set('content-length', String(span.end - span.start + 1));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set('content-length', String(obj.size));
  return new Response(request.method === 'HEAD' ? null : obj.body, { headers: h });
}

/* « bytes=a-b », « bytes=a- », « bytes=-n » → { start, end } inclus, comme R2. */
function byteSpan(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  return start <= end ? { start, end } : null;
}

/* ---------- Envoi et suppression : staff vidéo du club ---------- */
async function write(request, env, key) {
  const len = Number(request.headers.get('content-length'));
  if (!len) return fail(411, 'Taille du fichier inconnue.');
  if (len > MAX_BYTES) return fail(413, `Fichier trop volumineux : ${Math.round(MAX_BYTES / 1048576)} Mo au maximum.`);
  if (!(await canManage(request, env, key))) return fail(403, 'Envoi réservé au staff vidéo du club.');
  const type = request.headers.get('content-type') || '';
  await env.VIDEOS.put(key, request.body, { httpMetadata: { contentType: /^video\/[\w.+-]+$/.test(type) ? type : 'video/mp4' } });
  return Response.json({ ok: true }, { status: 201 });
}

async function remove(request, env, key) {
  if (!(await canManage(request, env, key))) {
    return fail(403, isLib(key) ? 'Fichier encore utilisé, ou suppression non autorisée.' : 'Suppression réservée au staff vidéo du club.');
  }
  await env.VIDEOS.delete(key);
  return Response.json({ ok: true });
}
