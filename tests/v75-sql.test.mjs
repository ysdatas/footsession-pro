/* lmfc_v75.sql : la vidéo d'un match (player_videos.match_id), et son retour arrière.
   Sur les migrations réelles (full-db.mjs) :
     - le coach Pro relie au match la vidéo d'un joueur qu'il peut modifier ; pas celle d'un joueur U14 ;
     - le joueur lit sa ligne et son match ;
     - match supprimé : la vidéo reste au joueur, sans match ;
     - témoin match_videos_ok() fermé à anon ; le retour rend l'état d'avant.
   Lancement : node tests/v75-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, J, T } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v75-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db, rest } = await fullDb(pg, { until: 'lmfc_v74.sql' });
assert.equal(rest[0], 'lmfc_v75.sql', 'v75 est la migration suivante');
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const rows = async (s, p) => (await q(s, p)).rows;
await q(`insert into public.matches (id, club_id, team_id, adversaire, date_match, created_by) overriding system value values
  (701, 1, ${T.pro}, 'Rennes', current_date - 1, '${P.coachPro}')`);

const before = await catalog(db);
await db.exec(sqlFile('lmfc_v75.sql'));
await db.exec(sqlFile('lmfc_v75.sql'));   // rejouable

const PATH = 'r2/1/1/1700000001.mp4';
const add = (who, player) => as(who, () => q(`insert into public.player_videos (club_id, player_id, storage_path, titre, match_id)
  values (1, $1, $2, 'Match contre Rennes', 701) returning id`, [player, PATH]));
const vPro = Number((await add(P.coachPro, J.pro)).rows[0].id);
await assert.rejects(add(P.coachPro, J.mineure), /row-level security|violates/, 'joueur U14 : refusé au coach Pro');
assert.deepEqual((await as(P.joueurPro, () => rows('select id, match_id from public.player_videos'))).map(r => [Number(r.id), Number(r.match_id)]),
  [[vPro, 701]], 'le joueur lit sa ligne et son match');

await q('delete from public.matches where id = 701');
assert.equal((await rows('select match_id from public.player_videos where id = $1', [vPro]))[0].match_id, null, 'match supprimé : la vidéo reste');

assert.equal((await as(P.coachPro, () => rows('select public.match_videos_ok() r')))[0].r, true);
await assert.rejects(as(null, () => q('select public.match_videos_ok()')), /permission denied/, 'témoin fermé à anon (42501)');

await db.exec(sqlFile('lmfc_v75_retour.sql'));
await db.exec(sqlFile('lmfc_v75_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), before, 'le retour rend l’état d’avant');
assert.equal((await rows('select count(*)::int n from public.player_videos'))[0].n, 1, 'la vidéo reste');

console.log('v75-sql : OK');
