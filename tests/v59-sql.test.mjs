/* lmfc_v59.sql (relances RPE, avis et vidéos) et son retour arrière, sur les
   migrations réelles (full-db.mjs) :
     - aperçu : rien n'est écrit ; destinataires et raisons ;
     - envoi : trace (sorte, objet, appareils), lien avec la relance ; doublon 12 h ;
       un joueur à jour, sans compte ou sans appareil n'est pas relancé ;
     - les relances d'avis ne bloquent pas la relance RPE du même match ;
     - lecture : remind_opened, par le joueur relancé seulement ;
     - droits par sorte ; le retour rend l'état d'avant à l'identique.
   Lancement : node tests/v59-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v59-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db } = await fullDb(pg, { until: 'lmfc_v58.sql' });
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const KEY = 'B' + 'x'.repeat(86), AUTH = 'y'.repeat(22);
await db.exec(`
insert into public.matches (club_id, created_by, team_id, date_match, adversaire) values (1, '${P.coachU14}', ${T.u14}, current_date - 2, 'ANGERS SCO');
insert into public.match_players (club_id, match_id, player_id, statut, minutes) values (1, 1, ${J.mineure}, 'titulaire', 70);
insert into public.push_subscriptions (user_id, club_id, endpoint, p256dh, auth) values ('${P.joueurU14}', 1, 'https://fcm.googleapis.com/fcm/send/x', '${KEY}', '${AUTH}');
insert into public.player_videos (club_id, player_id, titre, storage_path, duree_sec) values (1, ${J.mineure}, 'A', 'a.mp4', 100), (1, ${J.mineure}, 'B', 'b.mp4', 100);
`);
const before = await catalog(db);
await db.exec(sqlFile('lmfc_v59.sql'));
await db.exec(sqlFile('lmfc_v59.sql'));   // rejouable

const take = (uid, kind, id, players, preview = false) => as(uid, async () =>
  (await q(`select public.remind_take($1, $2, $3, $4) r`, [kind, id, players, preview])).rows[0].r);
const reasons = (r) => Object.fromEntries(r.skipped.map(s => [s.player_id, s.reason]));
const count = async (kind) => (await q(`select count(*)::int n from public.rpe_reminders where kind = $1`, [kind])).rows[0].n;

/* Avis : aperçu, envoi, doublon. */
const pre = await take(P.coachU14, 'avis', 1, [J.mineure, J.pro, J.sans], true);
assert.deepEqual(pre.ready, [J.mineure], 'aperçu : la joueuse sur la feuille');
assert.deepEqual(reasons(pre), { [J.pro]: 'non_suivi', [J.sans]: 'non_suivi' }, 'les autres, avec la raison');
assert.equal(await count('avis'), 0, 'aperçu : rien d’écrit');
const sent = await take(P.coachU14, 'avis', 1, [J.mineure]);
assert.equal(sent.messages.length, 1);
const msg = sent.messages[0];
assert.match(msg.url, new RegExp(`^mon-espace\\.html\\?avis=1&rappel=${msg.reminder}$`), 'lien vers l’avis, avec la relance');
assert.equal(msg.subs.length, 1, 'ses appareils');
assert.deepEqual((await q(`select kind, match_id, session_id, devices, delivered from public.rpe_reminders`)).rows[0],
  { kind: 'avis', match_id: 1, session_id: null, devices: 1, delivered: null }, 'tracé : sorte, objet, appareils, en cours');
assert.equal(reasons(await take(P.coachU14, 'avis', 1, [J.mineure], true))[J.mineure], 'deja_relance', 'pas deux fois en 12 h');
await as(P.coachU14, () => q(`select public.rpe_remind_done('[{"id": ${msg.reminder}, "delivered": 0}]')`));
assert.deepEqual((await take(P.coachU14, 'avis', 1, [J.mineure], true)).ready, [J.mineure], 'non livrée : on peut relancer');

/* RPE : aperçu sans rien écrire. La relance RPE du même match n'est pas bloquée par celle de l'avis ; son lien porte aussi la relance. */
const rpePre = await as(P.coachU14, async () => (await q(`select public.rpe_remind_take('match', 1, $1, true) r`, [[J.mineure, J.pro]])).rows[0].r);
assert.deepEqual([rpePre.ready, rpePre.messages.length, await count('rpe')], [[J.mineure], 0, 0], 'aperçu RPE : rien d’écrit');
const rpe = await as(P.coachU14, async () => (await q(`select public.rpe_remind_take('match', 1, $1) r`, [[J.mineure]])).rows[0].r);
assert.equal(rpe.messages.length, 1, 'RPE : relancée malgré l’avis');
assert.match(rpe.messages[0].url, /^mon-espace\.html\?rpe=m1&rappel=\d+$/);

/* Avis donné : à jour. */
await as(P.joueurU14, () => q(`select public.match_feedback_set(1, 'Bon match', null)`));
assert.equal(reasons(await take(P.coachU14, 'avis', 1, [J.mineure], true))[J.mineure], 'deja_repondu');

/* Vidéos : à voir, puis à jour. */
const v = await take(P.coachU14, 'video', null, [J.mineure]);
assert.match(v.messages[0].body, /^2 vidéos envoyées par le staff ne sont pas encore regardées/);
assert.match(v.messages[0].url, /^mes-videos\.html\?rappel=\d+$/);
await q(`insert into public.video_views (video_id, player_id, watched_seconds, completed) select id, ${J.mineure}, 95, true from public.player_videos`);
await q(`delete from public.rpe_reminders where kind = 'video'`);
assert.equal(reasons(await take(P.coachU14, 'video', null, [J.mineure], true))[J.mineure], 'a_jour', 'tout regardé : pas de relance');

/* Sans appareil : rien n'est tracé. */
await q(`delete from public.push_subscriptions`);
await q(`delete from public.match_feedback`);
await q(`delete from public.rpe_reminders where kind = 'avis'`);
const none = await take(P.coachU14, 'avis', 1, [J.mineure]);
assert.deepEqual([none.messages.length, reasons(none)[J.mineure], await count('avis')], [0, 'sans_appareil', 0], 'sans appareil : ni envoi ni trace');

/* Lecture : la joueuse ouvre la notification. */
const lu = async () => (await q(`select opened_at is not null lu from public.rpe_reminders where id = $1`, [rpe.messages[0].reminder])).rows[0].lu;
await as(P.joueurPro, () => q(`select public.remind_opened(${rpe.messages[0].reminder})`));
assert.equal(await lu(), false, 'un autre joueur ne la marque pas');
await as(P.joueurU14, () => q(`select public.remind_opened(${rpe.messages[0].reminder})`));
assert.equal(await lu(), true, 'ouverte par la joueuse relancée');

/* Droits. */
await assert.rejects(take(P.lecteur, 'avis', 1, [J.mineure], true), /réservée au staff/);
await assert.rejects(take(P.prepaU14, 'video', null, [J.mineure], true), /réservée au staff/, 'préparateur : pas les vidéos');
assert.ok(await take(P.prepaU14, 'avis', 1, [J.mineure], true), 'préparateur : l’avis');
await assert.rejects(take(P.coachPro, 'avis', 1, [J.mineure], true), /Match introuvable/, 'match d’une autre équipe');
await assert.rejects(take(P.coachU14, 'video', 1, [J.mineure], true), /sans identifiant/);
await q(`update public.matches set date_match = current_date - 40`);
await assert.rejects(take(P.coachU14, 'avis', 1, [J.mineure], true), /30 jours/, 'avis fermé');

/* Retour arrière. */
await q(`insert into public.rpe_reminders (club_id, kind, player_id, sent_by, devices) values (1, 'video', ${J.mineure}, '${P.coachU14}', 1)`);
await db.exec(sqlFile('lmfc_v59_retour.sql'));
await db.exec(sqlFile('lmfc_v59_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), before, 'retour arrière : état d’avant à l’identique');
assert.equal((await q(`select count(*)::int n from public.rpe_reminders`)).rows[0].n, 1, 'la relance RPE reste');
await db.exec(sqlFile('lmfc_v59.sql'));
console.log('v59-sql : OK');
