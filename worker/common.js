/* ============================================================
   LMFC Performance — Worker : outils communs (vidéos, notifications).
   ============================================================ */

export const fail = (status, error) => Response.json({ error }, { status });
/* Réglage Cloudflare manquant : dit clairement quoi corriger (journaux)
   au lieu d'une « erreur du serveur » sans indice. */
export class ConfigError extends Error {}
export const tokenOf = (req) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

export const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

/* Supabase, avec le jeton de l'utilisateur : la RLS décide. null si refusé. */
export async function supabase(env, token, path, init = {}) {
  const r = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: env.SUPABASE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  if (r.ok) return r.status === 204 ? true : r.json();
  if (r.status !== 401) console.warn('Supabase', r.status, path, await r.text());
  return null;
}
