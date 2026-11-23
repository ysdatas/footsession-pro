/* lmfc_v70.sql (RPE sur deux jours, chaque équipe à part) et son retour arrière,
   sur les migrations réelles (full-db.mjs). Un joueur Pro qui joue aussi en N2 :
     - deux séances à la même demi-journée : il note les deux, aucune n'est « ailleurs » ;
     - noté présent dans une équipe : l'autre séance reste à noter ;
     - le staff qui saisit sur une séance ne retire plus la réponse de l'autre ;
     - rpe_slot_others ne rend plus rien ;
     - J-2 se note encore, J-3 n'est plus proposé et rpe_set le refuse (séance et match) ;
     - témoin rpe_regles() fermé à anon ;
     - le retour rend l'état d'avant, sans effacer de réponse.
   Lancement : node tests/v70-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, J, T } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v70-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db, rest } = await fullDb(pg, { until: 'lmfc_v69.sql' });
assert.equal(rest[0], 'lmfc_v70.sql', 'v70 est la migration suivante');
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const one = async (s) => (await q(s)).rows[0];
await q(`update public.players set other_team_ids = '{${T.n2}}' where id = ${J.pro}`);   // Pro qui joue aussi en N2

const session = async (team, day, heure, titre) => Number((await one(`insert into public.sessions (club_id, titre, date_seance, heure, team_id)
  values (1, '${titre}', current_date - ${day}, ${heure ? `'${heure}'` : 'null'}, ${team}) returning id`)).id);
const proAm = await session(T.pro, 0, '10:00', 'Pro matin'), n2Am = await session(T.n2, 0, '10:30', 'N2 matin');
const proJ1 = await session(T.pro, 1, '09:00', 'Pro hier'), n2J1 = await session(T.n2, 1, '09:30', 'N2 hier');
const proJ2 = await session(T.pro, 2, '09:00', 'Pro J2'), proJ3 = await session(T.pro, 3, '09:00', 'Pro J3');
const match = async (day) => Number((await one(`insert into public.matches (club_id, team_id, adversaire, date_match, created_by)
  values (1, ${T.pro}, 'ADV', current_date - ${day}, '${P.admin}') returning id`)).id);
const m2 = await match(2), m3 = await match(3);

const rpeSet = (uid, s, v, player = null) => as(uid, () => q(`select public.rpe_set(${s}, ${v}${player ? `, ${player}` : ''}) r`)).then(x => x.rows[0].r);
const matchSet = (uid, m, v) => as(uid, () => q(`select public.match_rpe_set(${m}, ${v}) r`)).then(x => x.rows[0].r);
const mine = async () => new Map((await as(P.joueurPro, () => q('select session_id, rpe, equipe, ailleurs from public.my_rpe_sessions()'))).rows
  .map(r => [Number(r.session_id), r]));

// Avant (v61) : la réponse de la N2 rend la séance Pro « ailleurs ».
await rpeSet(P.joueurPro, n2J1, 6);
assert.equal((await mine()).get(proJ1).ailleurs, 'N2 hier – N2 à 09:30', 'avant : règle de la demi-journée');
const before = await catalog(db);
await db.exec(sqlFile('lmfc_v70.sql'));
await db.exec(sqlFile('lmfc_v70.sql'));   // rejouable

/* Chaque équipe à part. */
let m = await mine();
assert.equal(m.get(proJ1).ailleurs, null, 'la réponse en N2 ne change plus rien chez les Pro');
assert.equal((await rpeSet(P.joueurPro, proJ1, 5)).rpe, 5, 'il note aussi la séance Pro de la même demi-journée');
assert.equal((await rpeSet(P.joueurPro, n2Am, 6)).rpe, 6);
assert.equal((await rpeSet(P.joueurPro, proAm, 4)).rpe, 4, 'deux séances du même matin : deux réponses');
await q(`insert into public.attendance (player_id, session_id, statut, present) values (${J.pro}, ${proJ2}, 'present', true)`);
m = await mine();
assert.ok([proAm, n2Am, proJ1, n2J1, proJ2].every(id => m.get(id).ailleurs === null), 'jamais « ailleurs »');
assert.equal(m.get(proAm).equipe, 'Pro');

/* Le staff saisit sur une séance : l'autre réponse reste. */
const saved = await rpeSet(P.coachPro, proAm, 7, J.pro);
assert.deepEqual(saved, { rpe: 7, corrige: true }, 'plus de « deplace »');
assert.deepEqual((await q(`select session_id, rpe from public.session_rpe where player_id = ${J.pro} and session_id in (${proAm}, ${n2Am}) order by session_id`)).rows
  .map(r => [Number(r.session_id), r.rpe]), [[proAm, 7], [n2Am, 6]], 'la réponse de la N2 n’est pas retirée');
assert.equal((await as(P.coachPro, () => q(`select * from public.rpe_slot_others(array[${proAm}, ${proJ1}]::bigint[])`))).rows.length, 0, 'plus de case « ailleurs »');

/* Deux jours, pas plus. */
assert.ok(m.has(proJ2), 'J-2 encore proposé');
assert.ok(!m.has(proJ3), 'J-3 n’est plus proposé');
await assert.rejects(rpeSet(P.joueurPro, proJ3, 5), /jusqu’à 2 jours après la séance/);
assert.equal((await rpeSet(P.joueurPro, proJ2, 5)).rpe, 5, 'J-2 se note');
assert.equal((await matchSet(P.joueurPro, m2, 6)).rpe, 6, 'match à J-2 : se note');
await assert.rejects(matchSet(P.joueurPro, m3, 6), /jusqu’à 2 jours après le match/);
assert.equal((await rpeSet(P.coachPro, proJ3, 6, J.pro)).rpe, 6, 'le staff saisit toujours sans délai');
await assert.rejects(as(P.coachPro, () => q(`select public.rpe_remind_take('seance', ${proJ3}, array[${J.pro}]::bigint[])`)), /jusqu’à 2 jours après/,
  'relance : le refus dit le nouveau délai');

/* Témoin. */
assert.deepEqual((await as(P.joueurPro, () => q('select public.rpe_regles() r'))).rows[0].r, { jours: 2, demi_journee: false });
await assert.rejects(as(null, () => q('select public.rpe_regles()')), /permission denied/, 'témoin fermé à anon (42501)');

/* Retour arrière : état d'avant, réponses gardées. */
const n = (await one('select count(*)::int n from public.session_rpe')).n;
await db.exec(sqlFile('lmfc_v70_retour.sql'));
await db.exec(sqlFile('lmfc_v70_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), before, 'le retour rend l’état d’avant');
assert.equal((await one('select count(*)::int n from public.session_rpe')).n, n, 'aucune réponse effacée');
const n2Pm = await session(T.n2, 0, '11:00', 'N2 fin de matinée');
await assert.rejects(rpeSet(P.joueurPro, n2Pm, 4), /une seule réponse par demi-journée|déjà noté/, 'après le retour : de nouveau un seul RPE par demi-journée');

console.log('v70-sql : OK');
