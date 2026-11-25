/* lmfc_v73.sql : statut « Groupe <équipe> » et renvoi à la séance du groupe, et son retour arrière.
   Sur les migrations réelles (full-db.mjs). Le joueur Pro, noté « Groupe Espoirs » à la séance Pro du matin
   par le coach Pro (qui n'a aucun droit sur les Espoirs) :
     - il est noté présent, en invité, à la séance Espoirs du matin ; pas à celle de l'après-midi ;
     - la séance Pro du matin ne lui demande plus de RPE, celle des Espoirs oui ;
     - réenregistrée sans son groupe (calendrier) : il reste ; groupe obligatoire, d'une équipe du club ; groupe_de jamais écrit par le staff ;
     - « Groupe N2 » sans séance N2 ce matin : le renvoi Espoirs part, la séance Pro lui redemande son RPE ;
       une séance N2 créée ensuite ce matin le reçoit ;
     - une présence déjà notée là-bas (blessé) n'est pas touchée ; une ligne renvoyée changée par le staff reste ;
     - présence retirée : le renvoi part ;
     - témoin attendance_groupes() fermé à anon ; le retour rend l'état d'avant (« Autre », motif « Groupe N2 »).
   Lancement : node tests/v73-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, J, T } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v73-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db, rest } = await fullDb(pg, { until: 'lmfc_v72.sql' });
assert.equal(rest[0], 'lmfc_v73.sql', 'v73 est la migration suivante');
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const rows = async (s, p) => (await q(s, p)).rows;
const sess = async (team, heure, titre) => Number((await rows(`insert into public.sessions (club_id, titre, date_seance, heure, team_id)
  values (1, $1, current_date, $2::time, $3) returning id`, [titre, heure, team]))[0].id);
const proAm = await sess(T.pro, '10:00', 'Pro matin'), espAm = await sess(T.espoirs, '08:15', 'Espoirs matin');
const espPm = await sess(T.espoirs, '16:30', 'Espoirs aprem');

const before = await catalog(db);
await db.exec(sqlFile('lmfc_v73.sql'));
await db.exec(sqlFile('lmfc_v73.sql'));   // rejouable

const mark = (statut, team = null, who = P.coachPro, session = proAm) => as(who, () => q(`insert into public.attendance (player_id, session_id, statut, groupe_team_id)
  values ($1, $2, $3, $4) on conflict (player_id, session_id) do update set statut = excluded.statut, groupe_team_id = excluded.groupe_team_id`,
  [J.pro, session, statut, team]));
const att = async (s) => (await rows(`select statut, present, invite, groupe_de, groupe_team_id from public.attendance where player_id = $1 and session_id = $2`, [J.pro, s]))[0] || null;
const ok = async (s) => (await rows(`select public.player_session_ok($1, $2) r`, [J.pro, s]))[0].r;
const toRate = async () => (await as(P.joueurPro, () => rows('select session_id from public.my_rpe_sessions()'))).map(r => Number(r.session_id));

/* Groupe Espoirs : renvoi à la séance Espoirs du matin, en invité ; rien l'après-midi. */
await mark('groupe', T.espoirs);
assert.deepEqual(await att(proAm), { statut: 'groupe', present: false, invite: false, groupe_de: null, groupe_team_id: T.espoirs });
assert.deepEqual(await att(espAm), { statut: 'present', present: true, invite: true, groupe_de: proAm, groupe_team_id: null }, 'présent aux Espoirs, invité');
assert.equal(await att(espPm), null, 'pas l’après-midi');
assert.equal(await ok(proAm), false, 'la séance Pro ne lui demande plus rien');
const rate = await toRate();
assert.ok(rate.includes(espAm) && !rate.includes(proAm), 'RPE : Espoirs matin, pas Pro matin');

/* Réenregistrée sans son groupe (fiche du calendrier, lmfc_v43.sql) : le groupe reste. */
await as(P.coachPro, () => q(`insert into public.attendance (player_id, session_id, statut) values ($1, $2, 'groupe')
  on conflict (player_id, session_id) do update set statut = excluded.statut`, [J.pro, proAm]));
assert.equal((await att(proAm)).groupe_team_id, T.espoirs, 'le groupe noté reste');
assert.equal((await att(espAm))?.groupe_de, proAm, 'le renvoi reste');

/* Refus et garde. */
const proPm = await sess(T.pro, '16:30', 'Pro aprem');
await assert.rejects(mark('groupe', null, P.coachPro, proPm), /Choisissez le groupe/, 'groupe obligatoire');
await assert.rejects(mark('groupe', T.autre), /Groupe inconnu/);
await as(P.coachPro, () => q(`update public.attendance set groupe_de = $3 where player_id = $1 and session_id = $2`, [J.pro, proAm, espPm]));
assert.equal((await att(proAm)).groupe_de, null, 'groupe_de jamais écrit par le staff');

/* Groupe N2 sans séance N2 ce matin : le renvoi part ; une séance N2 créée ensuite le reçoit. */
await mark('groupe', T.n2);
assert.equal(await att(espAm), null, 'renvoi Espoirs retiré');
assert.equal(await ok(proAm), true, 'sans renvoi, la séance Pro lui demande son RPE');
const n2Am = await sess(T.n2, '11:00', 'N2 matin');
assert.equal((await att(n2Am))?.groupe_de, proAm, 'séance N2 créée ensuite : il y est noté');
assert.equal(await ok(proAm), false);
await q(`update public.sessions set heure = '15:00' where id = $1`, [n2Am]);
assert.equal(await att(n2Am), null, 'séance N2 passée l’après-midi : le renvoi part');
await q(`update public.sessions set heure = '11:00' where id = $1`, [n2Am]);
assert.equal((await att(n2Am))?.statut, 'present', 'revenue le matin : il y revient');

/* Présence déjà notée là-bas : pas touchée ; ligne renvoyée changée par le staff : elle reste. */
await q(`insert into public.attendance (player_id, session_id, statut) values ($1, $2, 'blesse')`, [J.pro, espAm]);
await mark('groupe', T.espoirs);
assert.equal((await att(espAm)).statut, 'blesse', 'blessé aux Espoirs : pas touché');
assert.equal(await att(n2Am), null, 'plus en N2');
await q(`delete from public.attendance where player_id = $1 and session_id = $2`, [J.pro, espAm]);
await mark('groupe', T.n2);
await as(P.admin, () => q(`update public.attendance set statut = 'reprise' where player_id = $1 and session_id = $2`, [J.pro, n2Am]));
assert.equal((await att(n2Am)).groupe_de, null, 'changée par le staff : elle devient la sienne');
await mark('present');
assert.equal((await att(n2Am)).statut, 'reprise', 'elle reste quand le joueur revient');

/* Présence retirée : le renvoi part. */
await q(`delete from public.attendance where player_id = $1 and session_id = $2`, [J.pro, n2Am]);
await mark('groupe', T.n2);
assert.equal((await att(n2Am))?.statut, 'present');
await as(P.coachPro, () => q(`delete from public.attendance where player_id = $1 and session_id = $2`, [J.pro, proAm]));
assert.equal(await att(n2Am), null, 'présence retirée : renvoi retiré');

/* Témoin. */
assert.equal((await as(P.coachPro, () => rows('select public.attendance_groupes() r')))[0].r, true);
await assert.rejects(as(null, () => q('select public.attendance_groupes()')), /permission denied/, 'témoin fermé à anon (42501)');

/* Retour arrière : « Autre », motif « Groupe N2 » ; état d'avant. */
await mark('groupe', T.n2);
const n = (await rows('select count(*)::int n from public.attendance'))[0].n;
await db.exec(sqlFile('lmfc_v73_retour.sql'));
await db.exec(sqlFile('lmfc_v73_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), before, 'le retour rend l’état d’avant');
assert.equal((await rows('select count(*)::int n from public.attendance'))[0].n, n, 'aucune présence effacée');
assert.deepEqual((await rows(`select statut, statut_libre, present from public.attendance where player_id = $1 and session_id = $2`, [J.pro, proAm]))[0],
  { statut: 'autre', statut_libre: 'Groupe N2', present: false });

console.log('v73-sql : OK');
