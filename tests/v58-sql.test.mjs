/* lmfc_v58.sql (suivi des vidéos regardées) et son retour arrière, sur les
   migrations réelles (full-db.mjs) :
     - la règle : vue à 80 % du temps lu (durée inconnue : fin atteinte), ouverte, à voir ;
       un saut jusqu'à la fin n'en fait pas une vidéo vue ;
     - track_video_view note la séquence regardée (de cette vidéo, pas réservée au staff) ;
     - video_watch_detail : lectures, temps lu, progression, statut, séquences regardées ;
     - video_watch_summary : par joueur visible seulement ; refusé au préparateur et au joueur ;
     - le retour rend l'état d'avant à l'identique ; la migration se rejoue.
   Lancement : node tests/v58-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v58-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db } = await fullDb(pg, { until: 'lmfc_v57.sql' });
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
// Trois vidéos envoyées à la joueuse U14 (compte joueurU14) : 100 s, 60 s, durée inconnue ; une au joueur Pro.
await db.exec(`
insert into public.player_videos (club_id, player_id, titre, storage_path, duree_sec) values
 (1, ${J.mineure}, 'Match A', 'a.mp4', 100), (1, ${J.mineure}, 'Match B', 'b.mp4', 60), (1, ${J.mineure}, 'Match C', 'c.mp4', null),
 (1, ${J.pro}, 'Pro', 'p.mp4', 100);
-- L'auteur d'une séquence est le compte connecté (guard_video_sequence) : simulé ici.
update public.sim set uid = '${P.coachU14}';
insert into public.video_sequences (club_id, player_id, video_id, label, start_sec, end_sec) values
 (1, ${J.mineure}, 1, 'Pressing', 10, 30), (1, ${J.mineure}, 1, 'Relance', 40, 50);
update public.sim set uid = '${P.joueurU14}';
insert into public.video_sequences (club_id, player_id, video_id, label, start_sec, end_sec) values (1, ${J.mineure}, 1, 'Sa séquence', 60, 70);
update public.sim set uid = '${P.coachU14}';
insert into public.video_sequences (club_id, player_id, video_id, label, start_sec, end_sec, staff_only) values (1, ${J.mineure}, 2, 'Staff seulement', 0, 10, true);
update public.sim set uid = null;
`);
const before = await catalog(db);
await db.exec(sqlFile('lmfc_v58.sql'));
await db.exec(sqlFile('lmfc_v58.sql'));   // rejouable

/* La règle. */
const st = async (w, d, c, n) => (await q(`select public.video_watch_status($1, $2, $3, $4) s`, [w, d, c, n])).rows[0].s;
assert.deepEqual([await st(0, 100, false, 0), await st(5, 100, false, 1), await st(80, 100, false, 2), await st(30, 100, true, 1), await st(0, null, true, 1)],
  ['a_voir', 'ouverte', 'vue', 'ouverte', 'vue'], 'à voir, ouverte, vue (80 %), saut à la fin = ouverte, durée inconnue + fin = vue');

/* Lectures de la joueuse, par la fonction de suivi (comme la page). */
const track = (args) => as(P.joueurU14, async () => Number((await q(`select public.track_video_view(${args}) id`)).rows[0].id));
const beat = (video, view, n) => Promise.all(Array.from({ length: n }, () => track(`${video}, ${view}, 0, 30, false, null`)));
let v = await track('1, null, 0, 0, false, 100, 1');            // séquence « Pressing » (20 s)
await beat(1, v, 1);                                            // 30 s lues
v = await track('1, null, 0, 0, false, 100, 4');                // séquence d'une autre vidéo : ignorée
await beat(1, v, 2);                                            // 60 s de plus : 90 s sur 100 → vue
v = await track('2, null, 0, 0, false, 60, 4');                 // séquence réservée au staff : ignorée
await track(`2, ${v}, 60, 0, true, null`);                      // saut à la fin, 0 s lue : ouverte
assert.deepEqual((await q(`select sequence_id from public.video_views order by id`)).rows.map(r => r.sequence_id === null ? null : Number(r.sequence_id)), [1, null, null],
  'séquence notée seulement si elle est de la vidéo et visible du joueur');
await assert.rejects(as(P.joueurPro, () => q(`select public.track_video_view(1)`)), /introuvable/, 'pas la vidéo d’un autre');

/* Détail (fiche) et résumé (liste). */
const detail = await as(P.coachU14, async () => (await q(`select * from public.video_watch_detail(${J.mineure})`)).rows);
const byTitle = Object.fromEntries(detail.map(r => [r.titre, r]));
assert.deepEqual([byTitle['Match A'].statut, byTitle['Match A'].lectures, byTitle['Match A'].regarde_sec, byTitle['Match A'].progression], ['vue', 2, 90, 90]);
assert.deepEqual([byTitle['Match A'].sequences, byTitle['Match A'].sequences_vues], [2, 1], 'séquences envoyées par le staff : 2, dont 1 regardée');
assert.deepEqual([byTitle['Match B'].statut, byTitle['Match B'].progression, byTitle['Match B'].sequences], ['ouverte', 0, 0], 'saut à la fin : ouverte ; séquence staff seulement : pas comptée');
assert.deepEqual([byTitle['Match C'].statut, byTitle['Match C'].lectures], ['a_voir', 0]);
const summary = async (uid) => as(uid, async () => Object.fromEntries((await q(`select * from public.video_watch_summary()`)).rows
  .map(r => [r.player_id, [r.videos, r.vues, r.ouvertes, r.a_voir]])));
assert.deepEqual((await summary(P.coachU14))[J.mineure], [3, 1, 1, 1], 'coach U14 : 3 vidéos, 1 vue, 1 ouverte, 1 à voir');
assert.equal((await summary(P.coachU14))[J.pro], undefined, 'coach U14 : pas le joueur Pro');
assert.deepEqual(Object.keys(await summary(P.admin)).map(Number).sort(), [J.pro, J.mineure].sort(), 'admin : tous');
assert.deepEqual(await summary(P.prepaU14), {}, 'préparateur : rien (comme la lecture de video_views)');
assert.deepEqual(await summary(P.joueurU14), {}, 'joueur : rien');
assert.equal(await as(P.coachPro, async () => (await q(`select * from public.video_watch_detail(${J.mineure})`)).rows.length), 0, 'coach Pro : pas le détail de la joueuse U14');

/* Retour arrière. */
await db.exec(sqlFile('lmfc_v58_retour.sql'));
await db.exec(sqlFile('lmfc_v58_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), before, 'retour arrière : état d’avant à l’identique');
assert.equal((await q(`select count(*)::int n from public.video_views`)).rows[0].n, 3, 'les lectures restent');
await db.exec(sqlFile('lmfc_v58.sql'));
console.log('v58-sql : OK');
