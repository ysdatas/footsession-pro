/* lmfc_v61.sql (un seul RPE de séance par demi-journée) et son retour arrière,
   sur les migrations réelles (full-db.mjs). Un joueur Pro qui joue aussi en N2 :
     - sans présence notée, il voit les deux séances du matin et choisit ; sa
       réponse décide, l'autre n'est plus à noter et rpe_set la refuse ;
     - l'après-midi reste à part ; une séance sans heure touche toute la journée ;
     - noté absent d'un côté, ou présent de l'autre : la bonne séance seule ;
     - la base refuse un second RPE à la même demi-journée, même hors rpe_set ;
     - le staff qui saisit sur une séance y déplace le RPE (« deplace ») ;
     - rpe_slot_others : le staff voit l'autre séance, ni anonyme ni lecteur ;
     - le retour rend l'état d'avant, sans effacer de réponse.
   Lancement : node tests/v61-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, J, T } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v61-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db, rest } = await fullDb(pg, { until: 'lmfc_v60.sql' });
assert.equal(rest[0], 'lmfc_v61.sql', 'v61 est la migration suivante');
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const one = async (s) => (await q(s)).rows[0];
await q(`update public.players set other_team_ids = '{${T.n2}}' where id = ${J.pro}`);   // Pro qui joue aussi en N2

const session = async (team, day, heure, titre) => Number((await one(`insert into public.sessions (club_id, titre, date_seance, heure, team_id)
  values (1, '${titre}', current_date - ${day}, ${heure ? `'${heure}'` : 'null'}, ${team}) returning id`)).id);
const proAm = await session(T.pro, 0, '10:00', 'Pro matin'), n2Am = await session(T.n2, 0, '10:30', 'N2 matin');
const n2Pm = await session(T.n2, 0, '15:00', 'N2 soir');
const proJ1 = await session(T.pro, 1, '09:00', 'Pro hier'), n2J1 = await session(T.n2, 1, '09:30', 'N2 hier');
const proJ2 = await session(T.pro, 2, '09:00', 'Pro J2'), n2J2 = await session(T.n2, 2, '09:30', 'N2 J2');
const proJ3 = await session(T.pro, 3, null, 'Pro sans heure'), n2J3 = await session(T.n2, 3, '17:00', 'N2 J3');

const rpeSet = (uid, s, v, player = null) => as(uid, () => q(`select public.rpe_set(${s}, ${v}${player ? `, ${player}` : ''}) r`)).then(x => x.rows[0].r);
const mine = async () => new Map((await as(P.joueurPro, () => q('select session_id, rpe, equipe, ailleurs from public.my_rpe_sessions()'))).rows
  .map(r => [Number(r.session_id), r]));
const att = (s, statut, present = false) => q(`insert into public.attendance (player_id, session_id, statut, present) values (${J.pro}, ${s}, '${statut}', ${present})`);

// Avant : les deux séances du matin se notent, l'une après l'autre.
await rpeSet(P.joueurPro, proJ3, 5);
await rpeSet(P.joueurPro, n2J3, 5);
const before = await catalog(db);
await db.exec(sqlFile('lmfc_v61.sql'));
await db.exec(sqlFile('lmfc_v61.sql'));   // rejouable

/* Rien de noté : il choisit. */
let m = await mine();
assert.equal(m.get(proAm).equipe, 'Pro');
assert.equal(m.get(n2Am).equipe, 'N2');
assert.equal(m.get(proAm).ailleurs, null, 'sans présence, les deux séances du matin restent proposées');
assert.equal(m.get(n2Am).ailleurs, null);
await rpeSet(P.joueurPro, n2Am, 6);   // il s'est entraîné avec la N2
m = await mine();
assert.equal(m.get(proAm).ailleurs, 'N2 matin – N2 à 10:30', 'la séance Pro du matin se note avec la N2');
assert.equal(m.get(n2Pm).ailleurs, null, 'l’après-midi reste à part');
await assert.rejects(rpeSet(P.joueurPro, proAm, 4), /déjà noté \(N2 matin – N2 à 10:30\)/);
assert.equal((await rpeSet(P.joueurPro, n2Pm, 7)).rpe, 7, 'il note l’après-midi');

/* Doublon refusé par la base, même hors rpe_set. */
await assert.rejects(q(`insert into public.session_rpe (club_id, session_id, player_id, rpe) values (1, ${proAm}, ${J.pro}, 3)`),
  /Un seul RPE par demi-journée/);

/* Staff : il voit l'autre séance ; anonyme et lecteur, rien. */
const others = (await as(P.coachPro, () => q(`select * from public.rpe_slot_others(array[${proAm}]::bigint[])`))).rows;
assert.equal(others.length, 1);
assert.deepEqual([Number(others[0].player_id), Number(others[0].other_id), others[0].other_rpe, Number(others[0].owner_id)], [J.pro, n2Am, 6, n2Am]);
assert.equal((await as(P.lecteur, () => q(`select * from public.rpe_slot_others(array[${proAm}]::bigint[])`))).rows.length, 0);
await assert.rejects(as(null, () => q(`select * from public.rpe_slot_others(array[${proAm}]::bigint[])`)), /permission denied/);
await assert.rejects(as(P.joueurPro, () => q(`select public.rpe_slot_owner(${J.pro}, ${proAm})`)), /permission denied/);

/* Le staff Pro dit qu'il était avec les Pro : le RPE y vient. */
const moved = await rpeSet(P.coachPro, proAm, 7, J.pro);
assert.equal(moved.deplace, 'N2 matin – N2 à 10:30');
assert.deepEqual((await q(`select session_id from public.session_rpe where player_id = ${J.pro} and session_id in (${proAm}, ${n2Am})`)).rows
  .map(r => Number(r.session_id)), [proAm]);

/* Noté absent avec les Pro : seule la N2 se note. */
await att(proJ1, 'absent');
m = await mine();
assert.equal(m.get(proJ1).ailleurs, 'N2 hier – N2 à 09:30');
assert.equal(m.get(n2J1).ailleurs, null);
await assert.rejects(rpeSet(P.joueurPro, proJ1, 5), /t’attend à une autre séance \(N2 hier – N2 à 09:30\)/);
assert.equal((await rpeSet(P.joueurPro, n2J1, 5)).rpe, 5);

/* Noté présent en N2 : la séance Pro n'est pas proposée. */
await att(n2J2, 'present', true);
m = await mine();
assert.equal(m.get(proJ2).ailleurs, 'N2 J2 – N2 à 09:30');
await assert.rejects(rpeSet(P.joueurPro, proJ2, 5), /t’attend/);

/* Une séance sans heure touche toute la journée ; les doublons d'avant restent à leur place. */
assert.equal((await one(`select count(*)::int n from public.session_rpe where player_id = ${J.pro} and session_id in (${proJ3}, ${n2J3})`)).n, 2);
m = await mine();
assert.equal(m.get(proJ3).ailleurs, null, 'un doublon d’avant : chaque séance garde le sien');
const dups = (await as(P.coachPro, () => q(`select * from public.rpe_slot_others(array[${proJ3}]::bigint[])`))).rows;
assert.deepEqual([Number(dups[0].other_id), dups[0].other_rpe], [n2J3, 5], 'le staff voit le doublon');

/* Retour arrière : état d'avant, réponses gardées. */
const n = (await one('select count(*)::int n from public.session_rpe')).n;
await db.exec(sqlFile('lmfc_v61_retour.sql'));
await db.exec(sqlFile('lmfc_v61_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), before, 'le retour rend l’état d’avant');
assert.equal((await one('select count(*)::int n from public.session_rpe')).n, n, 'aucune réponse effacée');

console.log('v61-sql : OK');
