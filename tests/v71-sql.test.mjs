/* lmfc_v71.sql (un seul RPE par demi-journée, de nouveau) et son retour arrière,
   sur les migrations réelles (full-db.mjs). Un joueur Pro qui joue aussi en N2 :
     - noté présent en N2 seulement : les deux séances du matin restent à noter
       (une présence ne ferme rien, aucune n'est « ailleurs ») ;
     - il note la N2 : la séance Pro du même matin est fermée (« ailleurs ») et
       rpe_set la refuse sans nommer d'équipe ; l'après-midi reste ouvert ;
     - Suivi RPE : rpe_slot_others rend sa réponse en N2, avec l'équipe ;
     - le staff qui saisit sur la séance Pro y déplace la réponse ;
     - la base refuse un second RPE inséré à la main ;
     - témoins rpe_demi_journee() et rpe_regles() ;
     - le retour rend l'état d'avant, sans effacer de réponse.
   Lancement : node tests/v71-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, J, T } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v71-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db, rest } = await fullDb(pg, { until: 'lmfc_v70.sql' });
assert.equal(rest[0], 'lmfc_v71.sql', 'v71 est la migration suivante');
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const one = async (s) => (await q(s)).rows[0];
await q(`update public.players set other_team_ids = '{${T.n2}}' where id = ${J.pro}`);   // Pro qui joue aussi en N2

const session = async (team, heure, titre) => Number((await one(`insert into public.sessions (club_id, titre, date_seance, heure, team_id)
  values (1, '${titre}', current_date, '${heure}', ${team}) returning id`)).id);
const proAm = await session(T.pro, '10:00', 'Pro matin'), n2Am = await session(T.n2, '08:15', 'N2 matin');
const proPm = await session(T.pro, '16:30', 'Pro aprem'), proYa = await one(`insert into public.sessions (club_id, titre, date_seance, heure, team_id)
  values (1, 'Pro hier', current_date - 1, '10:00', ${T.pro}) returning id`).then(x => Number(x.id));

const rpeSet = (uid, s, v, player = null) => as(uid, () => q(`select public.rpe_set(${s}, ${v}${player ? `, ${player}` : ''}) r`)).then(x => x.rows[0].r);
const mine = async () => new Map((await as(P.joueurPro, () => q('select session_id, rpe, ailleurs from public.my_rpe_sessions()'))).rows
  .map(r => [Number(r.session_id), r]));

const before = await catalog(db);
await db.exec(sqlFile('lmfc_v71.sql'));
await db.exec(sqlFile('lmfc_v71.sql'));   // rejouable

/* Une présence ne ferme rien. */
await q(`insert into public.attendance (player_id, session_id, statut, present) values (${J.pro}, ${n2Am}, 'present', true)`);
let m = await mine();
assert.ok([proAm, n2Am].every(id => m.get(id).ailleurs === null), 'présent en N2 : les deux séances du matin restent à noter');

/* Il note la N2 : le matin Pro se ferme, l'après-midi non. */
assert.equal((await rpeSet(P.joueurPro, n2Am, 6)).rpe, 6);
m = await mine();
assert.equal(m.get(proAm).ailleurs, 'N2 matin – N2 à 08:15', 'séance Pro du matin : déjà notée ailleurs');
assert.equal(m.get(proPm).ailleurs, null, 'après-midi : autre demi-journée');
assert.equal(m.get(n2Am).ailleurs, null, 'la séance notée n’est pas « ailleurs »');
await assert.rejects(rpeSet(P.joueurPro, proAm, 5), (e) => /une seule réponse par demi-journée/.test(e.message) && !/N2/.test(e.message),
  'refusé, sans nommer d’équipe');
assert.equal((await rpeSet(P.joueurPro, proPm, 4)).rpe, 4, 'l’après-midi se note');
assert.equal((await rpeSet(P.joueurPro, proYa, 5)).rpe, 5, 'la veille se note');

/* Suivi RPE : la réponse donnée en N2, avec l'équipe. */
const others = (await as(P.coachPro, () => q(`select * from public.rpe_slot_others(array[${proAm}, ${proPm}]::bigint[])`))).rows;
assert.deepEqual(others.map(r => [Number(r.session_id), Number(r.player_id), Number(r.other_id), r.other_rpe, r.other_team]),
  [[proAm, J.pro, n2Am, 6, 'N2']], 'case grise « en N2 · 6 » sur la séance Pro du matin seulement');
await assert.rejects(as(null, () => q(`select * from public.rpe_slot_others(array[${proAm}]::bigint[])`)), /permission denied/, 'fermé à anon');
assert.equal((await as(P.joueurPro, () => q(`select count(*)::int n from public.rpe_slot_others(array[${proAm}]::bigint[])`))).rows[0].n, 0, 'rien pour un joueur');

/* La base refuse un second RPE ; le staff déplace la réponse. */
await assert.rejects(q(`insert into public.session_rpe (club_id, session_id, player_id, rpe) values (1, ${proAm}, ${J.pro}, 3)`), /Un seul RPE par demi-journée/);
const moved = await rpeSet(P.coachPro, proAm, 7, J.pro);
assert.equal(moved.rpe, 7);
assert.equal(moved.deplace, 'N2 matin – N2 à 08:15', 'la réponse de la N2 vient sur la séance Pro');
assert.deepEqual((await q(`select session_id from public.session_rpe where player_id = ${J.pro} and session_id in (${proAm}, ${n2Am})`)).rows
  .map(r => Number(r.session_id)), [proAm]);

/* Témoins. */
assert.equal((await as(P.joueurPro, () => q('select public.rpe_demi_journee() r'))).rows[0].r, true);
assert.deepEqual((await as(P.joueurPro, () => q('select public.rpe_regles() r'))).rows[0].r, { jours: 2, demi_journee: true });
await assert.rejects(as(null, () => q('select public.rpe_demi_journee()')), /permission denied/, 'témoin fermé à anon (42501)');

/* Retour arrière : état d'avant, réponses gardées. */
const n = (await one('select count(*)::int n from public.session_rpe')).n;
await db.exec(sqlFile('lmfc_v71_retour.sql'));
await db.exec(sqlFile('lmfc_v71_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), before, 'le retour rend l’état d’avant');
assert.equal((await one('select count(*)::int n from public.session_rpe')).n, n, 'aucune réponse effacée');
assert.equal((await rpeSet(P.joueurPro, n2Am, 6)).rpe, 6, 'après le retour : chaque équipe à part');

console.log('v71-sql : OK');
