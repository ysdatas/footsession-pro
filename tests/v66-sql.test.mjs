/* lmfc_v66.sql : championnats du club, et son retour arrière.
   Sur les migrations réelles (full-db.mjs) :
     - le staff qui gère les matchs crée un championnat ; le lecteur le lit, n'écrit pas ;
       le joueur et un autre club ne le voient pas ; nom unique dans le club ;
     - un match prend un championnat de son club, jamais celui d'un autre club ;
     - supprimer un championnat garde le match (championnat vidé) ;
     - le retour rend l'état d'avant.
   Lancement : node tests/v66-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v66-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db, rest } = await fullDb(pg, { until: 'lmfc_v65.sql' });
assert.equal(rest[0], 'lmfc_v66.sql', 'v66 est la migration suivante');
await seed(db);
const start = await catalog(db);
await db.exec(sqlFile('lmfc_v66.sql'));
await db.exec(sqlFile('lmfc_v66.sql'));   // rejouable
const as = actor(db), q = (s, p) => db.query(s, p);

const add = (uid, nom, club = 1) => as(uid, () => q(`insert into public.competitions (club_id, nom, libelles_fff) values ($1, $2, '{"NATIONAL 2 - POULE C"}') returning id`, [club, nom]));
const n2 = Number((await add(P.admin, 'National 2')).rows[0].id);
await add(P.coachPro, 'Coupe Gambardella');
await assert.rejects(add(P.coachPro, 'national 2 '), /duplicate|unique/i, 'nom unique sans casse ni espace');
await assert.rejects(add(P.lecteur, 'Amical'), /row-level security|policy/i, 'le lecteur n’écrit pas');
await assert.rejects(add(P.joueurPro, 'Amical'), /row-level security|policy/i, 'le joueur n’écrit pas');
await assert.rejects(add(P.admin, 'Autre club', 2), /row-level security|policy/i, 'pas dans un autre club');
const read = (uid) => as(uid, async () => (await q(`select nom from public.competitions order by nom`)).rows.map(r => r.nom));
assert.deepEqual(await read(P.lecteur), ['Coupe Gambardella', 'National 2'], 'le lecteur lit');
assert.deepEqual(await read(P.joueurPro), [], 'le joueur ne voit rien');
assert.deepEqual(await read(P.adminB), [], 'l’autre club ne voit rien');

// Un match de l'équipe prend le championnat ; celui d'un autre club est refusé.
await q(`insert into public.matches (id, club_id, team_id, adversaire, date_match, created_by) overriding system value
  values (501, 1, ${T.pro}, 'Nantes', current_date, '${P.coachPro}')`);
await as(P.coachPro, () => q(`update public.matches set competition_id = $1 where id = 501`, [n2]));
assert.equal(Number((await q(`select competition_id from public.matches where id = 501`)).rows[0].competition_id), n2);
const other = Number((await q(`insert into public.competitions (club_id, nom) values (2, 'Ligue B') returning id`)).rows[0].id);
await assert.rejects(q(`update public.matches set competition_id = $1 where id = 501`, [other]), /n’appartient pas au club/, 'championnat d’un autre club refusé');

// Supprimer le championnat : le match reste, à classer.
await as(P.admin, () => q(`delete from public.competitions where id = $1`, [n2]));
const m = (await q(`select competition_id from public.matches where id = 501`)).rows[0];
assert.ok(m && m.competition_id === null, 'match gardé, championnat vidé');

// Retour arrière : état d'avant, à l'identique.
await db.exec(sqlFile('lmfc_v66_retour.sql'));
await db.exec(sqlFile('lmfc_v66_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), start, 'le retour rend l’état d’avant');

console.log('v66-sql : OK');
