/* lmfc_v54.sql (joueurs extérieurs) et son retour arrière, sur les migrations
   réelles (full-db.mjs) :
     - création par la fonction seulement ; ni équipe ni compte ;
     - retrouvé par tout le staff du club (lecteur exclu), modifié par admin,
       coach, analyste ;
     - concerné seulement par les séances et matchs où il est inscrit ;
     - une équipe ou un compte en font un joueur du club ;
     - rattachement à une fiche du club : récapitulatif sans effet, tout passe
       (présence, RPE, bilan, feuille de match), refus en cas de doublon, fiche
       extérieure à la corbeille ;
     - lmfc_v54_retour.sql refuse tant qu'un joueur extérieur existe, puis rend
       l'état d'avant à l'identique ; la migration se rejoue.
   Lancement : node tests/v54-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v54-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db } = await fullDb(pg, { until: 'lmfc_v53.sql' });
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
await db.exec(`
insert into public.sessions (club_id, created_by, titre, date_seance, team_id, acces) values
 (1, '${P.coachU14}', 'U14 + essai', current_date, ${T.u14}, 'equipe'), (1, '${P.coachU17}', 'U17 + essai', current_date + 1, ${T.u17}, 'equipe'),
 (1, '${P.coachU14}', 'U14 sans lui', current_date + 2, ${T.u14}, 'equipe');
insert into public.matches (club_id, created_by, team_id, date_match, adversaire) values (1, '${P.coachU14}', ${T.u14}, current_date, 'ANGERS SCO');
`);
const before = await catalog(db);
await db.exec(sqlFile('lmfc_v54.sql'));
await db.exec(sqlFile('lmfc_v54.sql'));   // rejouable

const call = (uid, s) => as(uid, async () => (await q(s)).rows[0]);
const create = (uid, nom = 'DUPONT', prenom = 'Léo') => call(uid, `select public.player_exterieur_create('${prenom}', '${nom}', '2012-03-04', 'Stade Lavallois U14', 'À l''essai') id`).then(r => Number(r.id));
const sees = (uid, id) => as(uid, async () => (await q(`select count(*)::int n from public.players where id = $1`, [id])).rows[0].n === 1);
const tryIt = (uid, s) => as(uid, () => db.transaction(async (tx) => { const r = await tx.query(s); await tx.rollback(); return r; }))
  .then(() => 'permis', () => 'refusé');

/* Création. */
await assert.rejects(create(P.prepaU14), /administrateur, les coachs et les analystes/, 'préparateur : ne crée pas');
await assert.rejects(create(P.lecteur), /administrateur/, 'lecteur : jamais');
const X = await create(P.coachU14);
assert.deepEqual((await q(`select exterieur, team_id, other_team_ids, auth_user_id, origine, exterieur_infos from public.players where id = ${X}`)).rows[0],
  { exterieur: true, team_id: null, other_team_ids: [], auth_user_id: null, origine: 'Stade Lavallois U14', exterieur_infos: 'À l’essai'.replace('’', "'") });
await as(P.coachU14, () => q(`insert into public.players (club_id, nom, prenom, team_id, exterieur) values (1, 'API', 'Faux', ${T.u14}, true)`));
assert.equal((await q(`select exterieur from public.players where nom = 'API'`)).rows[0].exterieur, false, 'par l’API : jamais extérieur');
await as(P.coachU14, () => q(`update public.players set exterieur = true where nom = 'API'`));
assert.equal((await q(`select exterieur from public.players where nom = 'API'`)).rows[0].exterieur, false, 'ni après coup');
await q(`delete from public.players where nom = 'API'`);

/* Droits : tout le staff le retrouve, le lecteur non. */
assert.equal(await sees(P.coachU17, X), true, 'coach d’une autre équipe : le retrouve');
assert.equal(await sees(P.prepaPro, X), true, 'préparateur : le lit');
assert.equal(await sees(P.lecteur, X), false, 'lecteur : ne le voit pas');
assert.equal(await sees(P.joueurPro, X), false, 'joueur : ne le voit pas');
assert.equal(await sees(P.adminB, X), false, 'autre club : ne le voit pas');
assert.equal(await tryIt(P.coachU17, `update public.players set origine = 'Changée' where id = ${X}`), 'permis');
assert.equal((await q(`select origine from public.players where id = ${X}`)).rows[0].origine, 'Stade Lavallois U14', 'transaction annulée');
assert.equal(await as(P.prepaPro, async () => (await q(`update public.players set origine = 'x' where id = ${X} returning id`)).rows.length), 0, 'préparateur : ne modifie pas');

/* Participations : séances U14 et U17, match U14 ; concerné seulement là où il est inscrit. */
await as(P.coachU14, () => q(`insert into public.attendance (session_id, player_id, statut, invite) values (1, ${X}, 'present', true)`));
await as(P.coachU17, () => q(`insert into public.attendance (session_id, player_id, statut, invite) values (2, ${X}, 'present', true)`));
await as(P.coachU14, () => q(`insert into public.match_players (club_id, match_id, player_id, statut, minutes, buts) values (1, 1, ${X}, 'titulaire', 60, 1)`));
await q(`insert into public.session_rpe (club_id, session_id, player_id, rpe) values (1, 1, ${X}, 6)`);
const ok = async (s) => (await q(`select public.player_session_ok(${X}, ${s}) ok`)).rows[0].ok;
assert.deepEqual([await ok(1), await ok(2), await ok(3)], [true, true, false], 'concerné par ses séances seulement');
assert.equal((await q(`select public.player_match_ok(${X}, 1) ok`)).rows[0].ok, true, 'sur la feuille du match');

/* Rattachement à une fiche du club (joueur U14). */
await assert.rejects(call(P.coachU17, `select public.player_exterieur_attach(${X}, ${J.mineure}, false)`), /modifier les deux fiches/, 'coach U17 : pas la fiche U14');
await assert.rejects(call(P.coachU14, `select public.player_exterieur_attach(${J.mineure}, ${X}, false)`), /fiche de joueur extérieur/, 'sens inverse refusé');
const plan = (await call(P.coachU14, `select public.player_exterieur_attach(${X}, ${J.mineure}, false) r`)).r;
assert.deepEqual(plan.lignes, { attendance: 2, match_players: 1, session_rpe: 1 }, 'récapitulatif');
assert.deepEqual(plan.doublons, {}, 'aucun doublon');
assert.equal(await sees(P.admin, X), true, 'récapitulatif : rien de changé');
// Doublon : la joueuse U14 déjà présente à la séance 1 → refus, rien ne bouge.
await q(`insert into public.attendance (session_id, player_id, statut) values (1, ${J.mineure}, 'present')`);
await assert.rejects(call(P.coachU14, `select public.player_exterieur_attach(${X}, ${J.mineure}, true)`), /Rattachement impossible.*attendance : 1/, 'doublon : refus');
assert.equal((await q(`select count(*)::int n from public.attendance where player_id = ${X}`)).rows[0].n, 2, 'refus : rien de déplacé');
await q(`delete from public.attendance where session_id = 1 and player_id = ${J.mineure}`);
const done = (await call(P.coachU14, `select public.player_exterieur_attach(${X}, ${J.mineure}, true) r`)).r;
assert.equal(done.applique, true);
assert.deepEqual((await q(`select session_id from public.attendance where player_id = ${J.mineure} order by 1`)).rows.map(r => Number(r.session_id)), [1, 2], 'présences passées');
assert.equal((await q(`select buts from public.match_players where player_id = ${J.mineure}`)).rows[0].buts, 1, 'feuille de match passée');
assert.equal((await q(`select rpe from public.session_rpe where player_id = ${J.mineure}`)).rows[0].rpe, 6, 'RPE passée');
assert.equal((await q(`select count(*)::int n from public.players where id = ${X}`)).rows[0].n, 0, 'fiche extérieure retirée');
assert.equal((await q(`select count(*)::int n from public.trash where tbl = 'players' and row_id = ${X}`)).rows[0].n, 1, 'à la corbeille');

/* Il rejoint le club : une équipe ou un compte retirent la marque, l'historique reste. */
const Y = await create(P.coachU14, 'MARTIN', 'Noé');
await as(P.coachU14, () => q(`insert into public.attendance (session_id, player_id, statut, invite) values (3, ${Y}, 'present', true)`));
await as(P.coachU14, () => q(`update public.players set team_id = ${T.u14} where id = ${Y}`));
assert.deepEqual((await q(`select exterieur, team_id from public.players where id = ${Y}`)).rows[0], { exterieur: false, team_id: T.u14 }, 'équipe donnée : joueur du club');
assert.equal((await q(`select count(*)::int n from public.attendance where player_id = ${Y}`)).rows[0].n, 1, 'historique gardé');
const Z = await create(P.admin, 'BERNARD', 'Sam');
await as(P.admin, () => q(`select public.club_link_player('${P.coachSans}', ${Z})`));
assert.equal((await q(`select exterieur from public.players where id = ${Z}`)).rows[0].exterieur, false, 'compte lié : joueur du club');

/* Retour arrière. */
const W = await create(P.admin, 'LEROY', 'Tom');
await assert.rejects(db.exec(sqlFile('lmfc_v54_retour.sql')), /Retour refusé : 1 joueur/, 'retour refusé avec un joueur extérieur');
await db.exec('rollback');
await q(`delete from public.players where id = ${W}`);
await db.exec(sqlFile('lmfc_v54_retour.sql'));
await db.exec(sqlFile('lmfc_v54_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), before, 'retour arrière : état d’avant à l’identique');
await db.exec(sqlFile('lmfc_v54.sql'));
console.log('v54-sql : OK');
