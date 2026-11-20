/* lmfc_v60.sql (les coachs saisissent les tests et les mesures physiques) et son
   retour arrière, sur les migrations réelles (full-db.mjs) :
     - le coach ajoute, modifie, supprime tests et mesures des joueurs de ses équipes ;
     - jamais ceux d'une autre équipe, ni en déplaçant une ligne vers un autre joueur ;
     - le préparateur garde ses droits ; le lecteur et le joueur n'écrivent rien ;
     - can_edit_physical() est fermée à l'anonyme ;
     - le retour rend l'état d'avant à l'identique, sans effacer les données.
   Lancement : node tests/v60-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v60-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db, rest } = await fullDb(pg, { until: 'lmfc_v59.sql' });
assert.equal(rest[0], 'lmfc_v60.sql', 'v60 est la migration suivante');
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const ids = (uid, s, p) => as(uid, async () => (await q(s, p)).rows.map(r => Number(r.id)));
const refused = (uid, s, p) => assert.rejects(as(uid, () => q(s, p)), /row-level security|permission denied/i, `refus attendu : ${s}`);
// Un mois par ligne : une seule mesure par joueur et par mois (performance_one_row_per_period.sql).
const addMeasure = (player, kg, month = 'Novembre') => `insert into public.player_physical_measurements (club_id, player_id, month_label, weight_kg)
  values (1, ${player}, '${month}', ${kg}) returning id`;
const addTest = (player) => `insert into public.player_physical_tests (club_id, player_id, stage, tested_at, source, sprint10_sec)
  values (1, ${player}, 'pre', '2026-09-01', 'manuel', 1.9) returning id`;

// Avant : le coach consulte, sans saisir.
await refused(P.coachU14, addMeasure(J.mineure, 52));
await refused(P.coachU14, addTest(J.mineure));
const proMeasure = (await ids(P.admin, addMeasure(J.pro, 80)))[0];

const before = await catalog(db);
await db.exec(sqlFile('lmfc_v60.sql'));
await db.exec(sqlFile('lmfc_v60.sql'));   // rejouable

/* Coach U14 : les joueurs de son équipe. */
const m = (await ids(P.coachU14, addMeasure(J.mineure, 52)))[0];
assert.ok(m, 'le coach U14 ajoute une mesure à sa joueuse');
assert.deepEqual(await ids(P.coachU14, `update public.player_physical_measurements set weight_kg = 52.5 where id = ${m} returning id`), [m],
  'il la modifie');
const t = (await ids(P.coachU14, addTest(J.mineure)))[0];
assert.ok(t, 'il saisit un test');
assert.deepEqual(await ids(P.coachU14, `update public.player_physical_tests set sprint10_sec = 1.85 where id = ${t} returning id`), [t]);

/* Jamais hors de ses équipes. */
await refused(P.coachU14, addMeasure(J.pro, 70, 'Octobre'));
await refused(P.coachU14, addTest(J.pro));
assert.deepEqual(await ids(P.coachU14, `update public.player_physical_measurements set weight_kg = 1 where id = ${proMeasure} returning id`), [],
  'pas la mesure d’un joueur Pro');
assert.deepEqual(await ids(P.coachU14, `delete from public.player_physical_measurements where id = ${proMeasure} returning id`), []);
await refused(P.coachU14, `update public.player_physical_measurements set player_id = ${J.pro} where id = ${m}`);
await refused(P.coachU14, `update public.player_physical_tests set player_id = ${J.pro} where id = ${t}`);

/* Les autres rôles. */
assert.ok((await ids(P.prepaU14, addMeasure(J.mineure, 53, 'Octobre')))[0], 'le préparateur U14 saisit toujours');
await refused(P.prepaU14, addMeasure(J.pro, 70, 'Octobre'));
await refused(P.lecteur, addMeasure(J.mineure, 50, 'Septembre'));
await refused(P.joueurU14, addMeasure(J.mineure, 50, 'Septembre'));
await refused(P.joueurU14, addTest(J.mineure));
await refused(null, 'select public.can_edit_physical()');
assert.equal((await as(P.coachU14, () => q('select public.can_edit_physical() r'))).rows[0].r, true);
assert.equal((await as(P.lecteur, () => q('select public.can_edit_physical() r'))).rows[0].r, false);

/* Suppression par le coach. */
assert.deepEqual(await ids(P.coachU14, `delete from public.player_physical_tests where id = ${t} returning id`), [t]);
assert.deepEqual(await ids(P.coachU14, `delete from public.player_physical_measurements where id = ${m} returning id`), [m]);

/* Retour arrière : état d'avant, données gardées. */
const kept = (await ids(P.coachU14, addMeasure(J.mineure, 54, 'Décembre')))[0];
await db.exec(sqlFile('lmfc_v60_retour.sql'));
await db.exec(sqlFile('lmfc_v60_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), before, 'le retour rend l’état d’avant');
await refused(P.coachU14, addMeasure(J.mineure, 55, 'Janvier'));
assert.equal((await q(`select count(*)::int n from public.player_physical_measurements where id = ${kept}`)).rows[0].n, 1,
  'ce que le coach a saisi reste');

console.log('v60-sql : OK');
