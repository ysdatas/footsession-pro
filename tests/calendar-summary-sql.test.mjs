/* Récapitulatif calendrier (lmfc_v43.sql) : champs + participants atomiques
   sous RLS, étendu à l'Analyste, refusé hors équipe et retour arrière.
   Lancement : node tests/calendar-summary-sql.test.mjs (PGlite requis). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T, J } from './full-db.mjs';

let PGlite, pgcrypto, pg_trgm, unaccent;
try {
  [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([
    import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/pgcrypto'),
    import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent'),
  ]);
} catch {
  console.error('calendar-summary-sql : PGlite absent, test NON lancé');
  process.exit(1);
}

const { db, rest } = await fullDb({ PGlite, pgcrypto, pg_trgm, unaccent }, { until: 'lmfc_v42.sql' });
assert.deepEqual(rest, ['lmfc_v43.sql'], 'v43 est la migration suivante');
await seed(db);
const as = actor(db);
const q = (sql, params = []) => db.query(sql, params);
const one = async (uid, sql, params = []) => as(uid, () => q(sql, params));
const before = await catalog(db);
await db.exec(sqlFile('lmfc_v43.sql'));
await db.exec(sqlFile('lmfc_v43.sql'));

await as(P.admin, () => q(`update public.profiles set role = 'analyste', team_ids = '{1}' where id = $1`, [P.coachPro]));
const session = (await one(P.admin, `insert into public.sessions (club_id, team_id, titre, date_seance)
  values (1, ${T.pro}, 'Avant', current_date) returning id`)).rows[0].id;
const match = (await one(P.admin, `insert into public.matches (club_id, team_id, adversaire, date_match)
  values (1, ${T.pro}, 'Rival', current_date) returning id`)).rows[0].id;
await one(P.admin, `insert into public.attendance (session_id, player_id, statut, invite) values (${session}, ${J.pro}, 'absent', false)`);
await one(P.admin, `insert into public.match_players (club_id, match_id, player_id, statut) values (1, ${match}, ${J.pro}, 'remplacant')`);

const call = (kind, id, fields, players) => `select public.calendar_summary_update('${kind}', ${id}, '${JSON.stringify(fields)}'::jsonb, '${JSON.stringify(players)}'::jsonb)`;
await one(P.coachPro, call('seance', session,
  { titre: 'Après', date: '2026-11-05', heure: '18:30', lieu: 'domicile', duree_min: 90 },
  [{ player_id: J.pro, inclus: true, statut: 'present', present: true, invite: false }]));
assert.equal((await one(P.admin, `select titre from public.sessions where id = ${session}`)).rows[0].titre, 'Après', 'mise à jour de séance');
assert.equal((await one(P.admin, `select statut from public.attendance where session_id = ${session} and player_id = ${J.pro}`)).rows[0].statut, 'present', 'présence mise à jour');

await assert.rejects(one(P.coachPro, call('seance', session,
  { titre: 'Ne doit pas rester', date: '2026-11-06', heure: '', lieu: '', duree_min: 90 },
  [{ player_id: J.pro, inclus: false }, { player_id: J.mineure, inclus: true, statut: 'present', invite: true }])), /row-level security|permission denied/i,
  'refus RLS sur un joueur hors périmètre');
assert.equal((await one(P.admin, `select titre from public.sessions where id = ${session}`)).rows[0].titre, 'Après', 'échec : champ séance rollback');
assert.equal((await one(P.admin, `select statut from public.attendance where session_id = ${session} and player_id = ${J.pro}`)).rows[0].statut, 'present', 'échec : participants rollback');

await one(P.coachPro, call('match', match,
  { adversaire: 'Rival modifié', date: '2026-11-05', heure: '19:00', lieu: 'exterieur', stade: 'Stade', competition: 'Coupe', score_pour: 2, score_contre: 1 },
  [{ player_id: J.pro, inclus: true, statut: 'titulaire' }]));
assert.equal((await one(P.admin, `select adversaire from public.matches where id = ${match}`)).rows[0].adversaire, 'Rival modifié', 'mise à jour du match');
assert.equal((await one(P.admin, `select statut from public.match_players where match_id = ${match} and player_id = ${J.pro}`)).rows[0].statut, 'titulaire', 'statut du joueur mis à jour');

await assert.rejects(one(P.coachPro, call('match', match,
  { adversaire: 'Rollback', date: '2026-11-05', heure: '', lieu: '', stade: '', competition: '', score_pour: '', score_contre: '' },
  [{ player_id: J.mineure, inclus: true, statut: 'titulaire' }])), /row-level security|permission denied/i,
  'match : refus RLS annule aussi suppression et champs');
assert.equal((await one(P.admin, `select adversaire from public.matches where id = ${match}`)).rows[0].adversaire, 'Rival modifié', 'échec : match rollback');
assert.equal((await one(P.admin, `select count(*)::int n from public.match_players where match_id = ${match} and player_id = ${J.pro}`)).rows[0].n, 1, 'échec : feuille rollback');

await assert.rejects(one(P.coachU17, call('seance', session,
  { titre: 'Hors équipe', date: '2026-11-05', heure: '', lieu: '', duree_min: 90 }, [])), /Séance introuvable|row-level security|permission denied/i,
  'coach d’une autre équipe refusé');
const u17session = (await one(P.admin, `insert into public.sessions (club_id, team_id, titre, date_seance)
  values (1, ${T.u17}, 'Séance U17', current_date) returning id`)).rows[0].id;
await assert.rejects(one(P.coachPro, call('seance', u17session,
  { titre: 'Hors équipe', date: '2026-11-05', heure: '', lieu: '', duree_min: 90 }, [])), /Séance introuvable|row-level security|permission denied/i,
  'l’analyste ne modifie pas une séance hors de ses équipes');
await one(P.coachPro, `select public.calendar_add('seance', '[{"titre":"Créée par Analyste","date":"2026-11-07","team_id":${T.pro}}]'::jsonb)`);
assert.equal((await one(P.admin, `select count(*)::int n from public.sessions where titre = 'Créée par Analyste'`)).rows[0].n, 1,
  'l’analyste conserve le droit calendrier de son équipe');

await db.exec(sqlFile('lmfc_v43_retour.sql'));
assert.deepEqual(await catalog(db), before, 'retour arrière v43 restaure exactement le catalogue');
await db.close();
console.log('calendar-summary-sql : OK (RLS, atomicité, Analyste, rollback)');
