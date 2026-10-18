/* Notifications (supabase/lmfc_v16.sql) sur un vrai Postgres (PGlite,
   WASM), RLS active : chacun enregistre son appareil, l'administrateur
   voit ceux de son club, personne d'autre ; services d'envoi connus
   seulement ; un appareil repris par un autre compte change de main.
   Lancement : npm i --no-save @electric-sql/pglite && node tests/push-sql.test.mjs
   (sans PGlite installé, le test est ignoré). */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.error('push-sql : PGlite absent, test NON lancé (npm i --no-save @electric-sql/pglite)');
  process.exit(1);
}
const U = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const ADMIN = U(1), COACH = U(2), JOUEUR = U(4), J2 = U(5), AUTRE = U(9), SANS = U(8);
const db = new PGlite();
const q = (s, p) => db.query(s, p);

await db.exec(`
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key);
create table public.sim (uid uuid);
insert into public.sim values (null);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.sim $$;
create table public.clubs (id bigint generated always as identity primary key, nom text);
insert into public.clubs (nom) values ('LMFC'), ('Autre');
create table public.profiles (id uuid primary key, club_id bigint references public.clubs, role text);
insert into auth.users values ('${ADMIN}'), ('${COACH}'), ('${JOUEUR}'), ('${J2}'), ('${AUTRE}'), ('${SANS}');
insert into public.profiles values ('${ADMIN}', 1, 'admin'), ('${COACH}', 1, 'coach'), ('${JOUEUR}', 1, 'joueur'),
  ('${J2}', 1, 'joueur'), ('${AUTRE}', 2, 'admin'), ('${SANS}', null, 'joueur');
create function public.my_club_id() returns bigint language sql stable security definer as $$ select club_id from public.profiles where id = auth.uid() $$;
create function public.is_club_admin() returns boolean language sql stable security definer as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;
grant usage on schema auth to authenticated;
grant select on public.sim to authenticated;
`);
const v16 = readFileSync(new URL('../supabase/lmfc_v16.sql', import.meta.url), 'utf8');
await db.exec(v16);
await db.exec(v16);   // rejouable

const as = async (uid, fn) => {
  await q('update public.sim set uid = $1', [uid]);
  await db.exec('set role authenticated');
  try { return await fn(); } finally { await db.exec('reset role'); }
};
const P256 = 'B'.repeat(87), AUTH = 'a'.repeat(22);
const subscribe = (uid, endpoint, p = P256, a = AUTH) => as(uid, () => q('select public.push_subscribe($1, $2, $3)', [endpoint, p, a]));
const seen = (uid) => as(uid, async () => (await q('select user_id::text, endpoint from public.push_subscriptions order by id')).rows);
const APPLE = 'https://web.push.apple.com/abc', FCM = 'https://fcm.googleapis.com/fcm/send/xyz';

await subscribe(JOUEUR, APPLE);
await subscribe(J2, FCM);
await subscribe(AUTRE, 'https://updates.push.services.mozilla.com/wpush/v2/zz');
await subscribe(COACH, 'https://wns2-par02p.notify.windows.com/w/?token=1');

assert.deepEqual((await seen(JOUEUR)).map(r => r.endpoint), [APPLE], 'le joueur ne voit que son appareil');
assert.equal((await seen(COACH)).length, 1, 'un coach ne voit que le sien');
assert.equal((await seen(ADMIN)).length, 3, 'l’admin voit les appareils de son club');
assert.equal((await seen(AUTRE)).length, 1, 'l’admin d’un autre club ne voit pas les nôtres');

// Écriture directe interdite ; seulement push_subscribe.
await assert.rejects(as(JOUEUR, () => q(`insert into public.push_subscriptions (user_id, club_id, endpoint, p256dh, auth) values ($1, 1, $2, $3, $4)`, [J2, FCM + '2', P256, AUTH])), /permission/);
await assert.rejects(as(JOUEUR, () => q(`update public.push_subscriptions set user_id = $1`, [JOUEUR])), /permission/);
// Services d'envoi connus et clés bien formées seulement.
await assert.rejects(subscribe(JOUEUR, 'https://pirate.test/collect'), /push_endpoint_check/);
await assert.rejects(subscribe(JOUEUR, 'http://fcm.googleapis.com/x'), /push_endpoint_check/);
await assert.rejects(subscribe(JOUEUR, APPLE + '2', 'pas une clé'), /push_keys_check/);
await assert.rejects(subscribe(SANS, APPLE + '3'), /aucun club/, 'compte sans club refusé');
await assert.rejects(subscribe(null, APPLE + '4'), /aucun club/, 'anonyme refusé');

// Téléphone prêté : le même appareil passe au compte qui s'abonne, sans doublon.
await subscribe(J2, APPLE);
assert.deepEqual((await seen(JOUEUR)), [], 'l’ancien compte ne reçoit plus sur cet appareil');
assert.deepEqual((await seen(J2)).map(r => r.endpoint).sort(), [APPLE, FCM].sort());

// Suppression : le joueur retire le sien, pas celui d'un autre ; l'admin nettoie son club.
assert.equal((await as(JOUEUR, () => q(`delete from public.push_subscriptions where endpoint = $1 returning id`, [FCM]))).rows.length, 0);
assert.equal((await as(J2, () => q(`delete from public.push_subscriptions where endpoint = $1 returning id`, [FCM]))).rows.length, 1);
assert.equal((await as(AUTRE, () => q(`delete from public.push_subscriptions where endpoint = $1 returning id`, [APPLE]))).rows.length, 0, 'autre club : rien');
assert.equal((await as(ADMIN, () => q(`delete from public.push_subscriptions where endpoint = $1 returning id`, [APPLE]))).rows.length, 1);
// Compte supprimé : ses appareils partent avec lui.
await db.exec(`delete from auth.users where id = '${COACH}'`);
assert.equal((await q(`select count(*)::int as n from public.push_subscriptions where user_id = $1`, [COACH])).rows[0].n, 0);

console.log('push-sql : OK (RLS, push_subscribe, services connus, appareil repris)');
