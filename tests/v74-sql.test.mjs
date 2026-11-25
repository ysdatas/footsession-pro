/* lmfc_v74.sql : une vidéo de match pour plusieurs joueurs (import Sportscode), et son retour arrière.
   Sur les migrations réelles (full-db.mjs). Même fichier pour le joueur Pro et la joueuse N2 :
     - chacun lit sa ligne de vidéo et SES séquences, jamais celles de l'autre ;
     - video_path_in_use : vrai tant qu'une ligne du club se sert du fichier, même d'un joueur
       que le coach ne voit pas ; faux à la dernière ; faux pour un joueur ; fermé à anon ;
     - le retour rend l'état d'avant.
   Lancement : node tests/v74-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v74-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db, rest } = await fullDb(pg, { until: 'lmfc_v73.sql' });
assert.equal(rest[0], 'lmfc_v74.sql', 'v74 est la migration suivante');
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const rows = async (s, p) => (await q(s, p)).rows;
const PATH = 'r2/1/1/1700000000.mp4';
const video = async (player) => Number((await rows(`insert into public.player_videos (club_id, player_id, storage_path, titre) values (1, $1, $2, 'Match contre Rennes') returning id`,
  [player, PATH]))[0].id);
const vPro = await video(J.pro), vN2 = await video(J.n2);
for (const [p, v, s] of [[J.pro, vPro, 10], [J.pro, vPro, 30], [J.n2, vN2, 50]]) {
  await q(`insert into public.video_sequences (club_id, player_id, video_id, label, start_sec, end_sec) values (1, $1, $2, 'PASSE', $3::numeric, $3::numeric + 4)`, [p, v, s]);
}

const before = await catalog(db);
await db.exec(sqlFile('lmfc_v74.sql'));
await db.exec(sqlFile('lmfc_v74.sql'));   // rejouable

/* Chacun le match et ses séquences. */
assert.deepEqual((await as(P.joueurPro, () => rows('select id from public.player_videos'))).map(r => Number(r.id)), [vPro], 'sa ligne de vidéo seulement');
assert.deepEqual((await as(P.joueurPro, () => rows('select start_sec from public.video_sequences order by start_sec'))).map(r => Number(r.start_sec)), [10, 30],
  'ses séquences, pas celles de la joueuse N2');

/* Fichier encore utilisé. */
const inUse = (who) => as(who, () => rows(`select public.video_path_in_use($1) r`, [PATH])).then(r => r[0].r);
assert.equal(await inUse(P.coachPro), true);
await q('delete from public.player_videos where id = $1', [vPro]);
assert.equal(await inUse(P.coachPro), true, 'la ligne N2, que le coach Pro ne voit pas, s’en sert encore');
assert.equal(await inUse(P.joueurPro), false, 'rien pour un joueur');
await q('delete from public.player_videos where id = $1', [vN2]);
assert.equal(await inUse(P.coachPro), false, 'plus aucune ligne : le fichier peut partir');
await assert.rejects(as(null, () => q('select public.video_path_in_use($1)', [PATH])), /permission denied/, 'fermé à anon (42501)');

/* Retour. */
await db.exec(sqlFile('lmfc_v74_retour.sql'));
await db.exec(sqlFile('lmfc_v74_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), before, 'le retour rend l’état d’avant');

console.log('v74-sql : OK');
