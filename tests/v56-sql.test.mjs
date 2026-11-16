/* lmfc_v56.sql (dernière connexion) et son retour arrière, sur les migrations
   réelles (full-db.mjs) : réservé à l'admin de son club ; dernière connexion d'Auth ;
   nombre de connexions lu dans le journal d'Auth (« login » seulement, période),
   null quand le journal manque ou ne la connaît pas ; le retour rend l'état d'avant.
   Lancement : node tests/v56-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v56-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db } = await fullDb(pg, { until: 'lmfc_v55.sql' });
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
await db.exec(`
update auth.users set last_sign_in_at = now() - interval '2 days' where id = '${P.coachU14}';
update auth.users set last_sign_in_at = now() - interval '90 days' where id = '${P.coachPro}';
update auth.users set last_sign_in_at = now() - interval '1 hour' where id = '${P.prepaPro}';
`);
const before = await catalog(db);
await db.exec(sqlFile('lmfc_v56.sql'));
await db.exec(sqlFile('lmfc_v56.sql'));   // rejouable

const logins = (uid, days = 30) => as(uid, async () => Object.fromEntries((await q(`select * from public.club_member_logins(${days})`)).rows
  .map(r => [r.profile_id, { last: r.last_sign_in_at ? 'connu' : null, n: r.logins }])));

/* Réservé à l'admin, et à son club. */
for (const uid of [P.coachU14, P.prepaPro, P.lecteur, P.joueurPro]) {
  await assert.rejects(logins(uid), /Réservé à l'administrateur/, `${uid} : refusé`);
}
const own = await logins(P.admin);
assert.ok(own[P.coachU14] && !own[P.adminB], 'membres de son club seulement');

/* Sans journal d'Auth (base de test) : dernière connexion, nombre inconnu. */
assert.deepEqual(own[P.coachU14], { last: 'connu', n: null }, 'sans journal : nombre inconnu, pas 0');
assert.deepEqual(own[P.coachEsp], { last: null, n: null }, 'jamais connecté');

/* Avec le journal : seules les connexions de la période comptent ; un renouvellement de jeton n'en est pas une. */
await db.exec(`
create table auth.audit_log_entries (instance_id uuid, id uuid primary key default gen_random_uuid(), payload json, created_at timestamptz, ip_address varchar(64) default '');
insert into auth.audit_log_entries (payload, created_at) values
 ('{"actor_id":"${P.coachU14}","action":"login"}', now() - interval '2 days'),
 ('{"actor_id":"${P.coachU14}","action":"login"}', now() - interval '10 days'),
 ('{"actor_id":"${P.coachU14}","action":"token_refreshed"}', now() - interval '1 day'),
 ('{"actor_id":"${P.coachU14}","action":"login"}', now() - interval '60 days'),
 ('{"actor_id":"${P.coachPro}","action":"login"}', now() - interval '90 days');
`);
const log = await logins(P.admin);
assert.deepEqual(log[P.coachU14], { last: 'connu', n: 2 }, '2 connexions sur 30 jours (le jeton renouvelé ne compte pas)');
assert.deepEqual(log[P.coachPro], { last: 'connu', n: 0 }, 'aucune connexion sur la période');
assert.deepEqual(log[P.prepaPro], { last: 'connu', n: null }, 'connecté dans la période mais absent du journal : nombre inconnu');
assert.equal((await logins(P.admin, 365))[P.coachU14].n, 3, 'période choisie');
assert.equal((await logins(P.admin, 5000))[P.coachPro].n, 1, '365 jours au plus');
await db.exec(`drop table auth.audit_log_entries`);

/* Retour arrière. */
await db.exec(sqlFile('lmfc_v56_retour.sql'));
await db.exec(sqlFile('lmfc_v56_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), before, 'retour arrière : état d’avant à l’identique');
await db.exec(sqlFile('lmfc_v56.sql'));
console.log('v56-sql : OK');
