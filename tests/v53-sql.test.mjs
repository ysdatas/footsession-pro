/* lmfc_v53.sql (« Ce n'est pas un doublon ») et son retour arrière, sur les
   migrations réelles (full-db.mjs) : qui écrit, lit et retire une décision ;
   paire rangée et unique ; décision supprimée avec son match ; le retour rend
   l'état d'avant à l'identique et la migration se rejoue.
   Lancement : node tests/v53-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v53-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db } = await fullDb(pg, { until: 'lmfc_v52.sql' });
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
// Même jour, même adversaire : U17 et Espoirs (vraiment distincts), et un match de l'autre club.
await db.exec(`
insert into public.matches (club_id, created_by, team_id, date_match, adversaire) values
 (1, '${P.coachU17}', ${T.u17}, '2026-10-17', 'LES SABLES VF'), (1, '${P.coachEsp}', ${T.espoirs}, '2026-10-17', 'LES SABLES VF'),
 (2, '${P.adminB}', ${T.autre}, '2026-10-17', 'LES SABLES VF');
`);
const before = await catalog(db);
await db.exec(sqlFile('lmfc_v53.sql'));
await db.exec(sqlFile('lmfc_v53.sql'));   // rejouable

const tryIt = (uid, s) => as(uid, () => db.transaction(async (tx) => { const r = await tx.query(s); await tx.rollback(); return r; }))
  .then(() => 'permis', () => 'refusé');
const decide = (uid, a, b, club = 1) => `insert into public.match_not_duplicates (club_id, match_a, match_b) values (${club}, ${a}, ${b})`;
const seen = (uid) => as(uid, async () => (await q(`select count(*)::int n from public.match_not_duplicates`)).rows[0].n);

assert.equal(await tryIt(P.coachU17, decide(P.coachU17, 1, 2)), 'refusé', 'coach U17 : ne voit pas le match des Espoirs');
assert.equal(await tryIt(P.coachDeux, decide(P.coachDeux, 2, 1)), 'refusé', 'paire rangée : match_a < match_b');
assert.equal(await tryIt(P.coachDeux, decide(P.coachDeux, 1, 3)), 'refusé', 'pas un match d’un autre club');
assert.equal(await tryIt(P.prepaPro, decide(P.prepaPro, 1, 2)), 'refusé', 'préparateur : ne décide pas');
assert.equal(await tryIt(P.lecteur, decide(P.lecteur, 1, 2)), 'refusé', 'lecteur : jamais');
assert.equal(await tryIt(P.joueurPro, decide(P.joueurPro, 1, 2)), 'refusé', 'joueur : jamais');
await as(P.coachDeux, () => q(decide(P.coachDeux, 1, 2)));
await assert.rejects(as(P.admin, () => q(decide(P.admin, 1, 2))), /match_not_duplicates_pair/, 'une seule décision par paire');
const row = (await q(`select decided_by, decided_at is not null tracee from public.match_not_duplicates`)).rows[0];
assert.deepEqual(row, { decided_by: P.coachDeux, tracee: true }, 'qui et quand');

assert.equal(await seen(P.prepaPro), 1, 'staff du club : lit');
assert.equal(await seen(P.joueurPro), 0, 'joueur : ne lit pas');
assert.equal(await seen(P.adminB), 0, 'autre club : ne lit pas');
assert.equal(await tryIt(P.coachEsp, `delete from public.match_not_duplicates`).then(async () => seen(P.admin)), 1, 'un autre coach ne la retire pas');
await as(P.coachEsp, () => q(`delete from public.match_not_duplicates`));
assert.equal(await seen(P.admin), 1, 'retrait d’un autre : sans effet');
await as(P.admin, () => q(`delete from public.match_not_duplicates`));
assert.equal(await seen(P.admin), 0, 'l’admin la retire');

await as(P.coachDeux, () => q(decide(P.coachDeux, 1, 2)));
await q(`delete from public.matches where id = 2`);
assert.equal(await seen(P.admin), 0, 'supprimée avec son match');

await db.exec(sqlFile('lmfc_v53_retour.sql'));
await db.exec(sqlFile('lmfc_v53_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), before, 'retour arrière : état d’avant à l’identique');
await db.exec(sqlFile('lmfc_v53.sql'));
console.log('v53-sql : OK');
