/* lmfc_v42.sql ne doit rien retirer aux autres comptes, et donne à l'analyste
   le GPS et les avis de match de ses équipes. Migrations réelles (full-db.mjs),
   sur deux chemins :
     - la production : v42 passée après v43 et v46 (elle y manquait le 06/11) ;
     - l'ordre du README, jusqu'à lmfc_v46.sql.
   Ce fichier garde aussi les règles du RPE (lmfc_v37.sql, lmfc_v38.sql) après
   toutes les migrations : une fonction réécrite doit repartir de sa dernière
   version, pas d'une ancienne.
   Lancement : voir access-matrix-sql.test.mjs. */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v42-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const HASH = (c) => c.repeat(64);
const ANALYSTE = P.coachSans;   // devient analyste de l'équipe Pro

async function run(label, before, after, rollback) {
  const { db } = await fullDb(pg, { until: 'lmfc_v38.sql' });
  await seed(db);
  for (const f of before) await db.exec(sqlFile(f));
  const as = actor(db), q = (s, p) => db.query(s, p);
  const ok = (uid, s, p) => as(uid, () => q(s, p));
  const no = (uid, s, re, p) => assert.rejects(as(uid, () => q(s, p)), re, `${label} : refus attendu : ${s}`);
  const ids = async (uid, s, p) => (await ok(uid, s, p)).rows.map(r => Number(r.id));
  const start = await catalog(db);
  for (const f of after) { await db.exec(sqlFile(f)); await db.exec(sqlFile(f)); }   // rejouables

  const today = (await q(`select current_date::text d`)).rows[0].d;
  await q(`update public.profiles set role = 'analyste', team_ids = '{${T.pro}}' where id = $1`, [ANALYSTE]);
  await db.exec(`
insert into public.sessions (id, club_id, created_by, titre, date_seance, team_id, acces) overriding system value values
 (101, 1, '${P.coachU14}', 'U14', '${today}', ${T.u14}, 'equipe'), (102, 1, '${P.coachPro}', 'Pro', '${today}', ${T.pro}, 'equipe');
insert into public.matches (id, club_id, team_id, adversaire, date_match, created_by) overriding system value values
 (201, 1, ${T.pro}, 'Adv Pro', '${today}', '${P.coachPro}'), (202, 1, null, 'Sans équipe', '${today}', '${P.coachPro}'), (203, 1, ${T.u14}, 'Adv U14', '${today}', '${P.coachU14}');
insert into public.club_events (id, club_id, team_id, titre, date_event) overriding system value values (301, 1, null, 'Événement du club', '${today}');
insert into public.match_feedback (club_id, match_id, player_id, individuel) values (1, 201, ${J.pro}, 'Pro'), (1, 203, ${J.mineure}, 'Mineure');
insert into public.gps_imports (id, club_id, team_id, date_seance, fichier, file_hash, fournisseur, colonnes, nb_joueurs, importe_par) overriding system value values
 (401, 1, ${T.pro}, '${today}', 'pro.csv', '${HASH('a')}', 'catapult', '[]', 1, '${P.prepaPro}'),
 (402, 1, ${T.u14}, '${today}', 'u14.csv', '${HASH('b')}', 'catapult', '[]', 1, '${P.prepaU14}'),
 (403, 1, null, '${today}', 'club.csv', '${HASH('c')}', 'catapult', '[]', 0, '${P.admin}');
insert into public.gps_rows (club_id, import_id, player_id, nom_lu, raw, metrics) values (1, 401, ${J.pro}, 'PRO', '{}', '{}'), (1, 402, ${J.mineure}, 'MINEURE', '{}', '{}');
insert into public.gps_player_aliases (club_id, nom_lu, player_id) values (1, 'Pro P.', ${J.pro}), (1, 'Mineure M.', ${J.mineure});
insert into public.gps_settings (club_id, player_metrics) values (1, '{distance}');
`);

  /* ---------- RPE : une seule réponse du joueur, le staff corrige (lmfc_v37.sql, lmfc_v38.sql) ---------- */
  await ok(P.joueurU14, `select public.rpe_set(101, 6)`);
  await no(P.joueurU14, `select public.rpe_set(101, 2)`, /déjà enregistré/);
  assert.equal((await q(`select rpe from public.session_rpe where session_id = 101`)).rows[0].rpe, 6, `${label} : la réponse du joueur reste`);
  await ok(P.prepaU14, `select public.rpe_set(101, 5, ${J.mineure})`);
  assert.equal((await q(`select rpe, corrige_par from public.session_rpe where session_id = 101`)).rows[0].corrige_par, P.prepaU14, `${label} : le prépa corrige, c'est marqué`);
  await ok(P.coachU14, `select public.rpe_set(101, 4, ${J.mineure})`);
  await ok(ANALYSTE, `select public.rpe_set(102, 7, ${J.pro})`);
  await no(ANALYSTE, `select public.rpe_set(101, 7, ${J.mineure})`, /Correction réservée/);
  await no(P.prepaPro, `select public.rpe_set(101, 7, ${J.mineure})`, /Correction réservée/);
  await ok(P.joueurPro, `select public.match_rpe_set(201, 7)`);
  await no(P.joueurPro, `select public.match_rpe_set(201, 2)`, /déjà enregistré : demande au staff/);
  await ok(P.prepaPro, `select public.match_rpe_set(201, 6, ${J.pro})`);
  await ok(ANALYSTE, `select public.match_rpe_set(201, 5, ${J.pro})`);
  await no(ANALYSTE, `select public.match_rpe_set(203, 5, ${J.mineure})`, /Correction réservée/);

  /* ---------- Administrateur et coachs : rien ne leur est retiré ---------- */
  const event = (team = 'null') => `select public.calendar_add('evenement', '[{"date":"${today}","titre":"Réunion","team_id":${team}}]')`;
  assert.equal((await ok(P.admin, event())).rows[0].calendar_add.created.length, 1, `${label} : l'admin crée un événement « Tout le club »`);
  assert.equal((await ok(P.admin, `update public.club_events set titre = 'Renommé' where id = 301`)).affectedRows, 1, `${label} : et le modifie`);
  await no(P.admin, `update public.club_events set team_id = ${T.autre} where id = 301`, /row-level security/);
  await no(P.coachPro, event(), /rien créer/);
  await no(ANALYSTE, event(), /rien créer/);
  assert.equal((await ok(P.coachPro, event(T.pro))).rows[0].calendar_add.created.length, 1, `${label} : le coach crée pour son équipe`);
  assert.equal((await ok(ANALYSTE, event(T.pro))).rows[0].calendar_add.created.length, 1, `${label} : l'analyste aussi`);
  assert.equal((await ok(ANALYSTE, `update public.club_events set titre = 'Non' where id = 301`)).affectedRows, 0, `${label} : pas les événements du club`);

  assert.equal((await ok(P.admin, `update public.matches set commentaire = 'admin' where id = 202`)).affectedRows, 1, `${label} : l'admin modifie un match sans équipe d'un autre`);
  assert.equal((await ok(P.coachPro, `update public.matches set commentaire = 'créateur' where id = 202`)).affectedRows, 1, `${label} : son créateur aussi`);
  assert.equal((await ok(P.coachU14, `update public.matches set commentaire = 'non' where id = 202`)).affectedRows, 0, `${label} : pas un autre coach`);
  assert.equal((await ok(ANALYSTE, `update public.matches set commentaire = 'non' where id = 202`)).affectedRows, 0, `${label} : ni l'analyste`);
  await no(P.admin, `update public.matches set team_id = ${T.autre} where id = 201`, /row-level security/);
  assert.equal((await ok(ANALYSTE, `update public.matches set commentaire = 'analyste' where id = 201`)).affectedRows, 1, `${label} : l'analyste modifie le match de son équipe`);

  // Club sans équipe : l'événement et le match n'en ont pas, et restent possibles.
  await q(`insert into public.clubs (nom, join_code) values ('Sans équipes', 'CCCC')`);
  await q(`update public.profiles set club_id = 3, role = 'coach' where id = $1`, [P.sansClub]);
  assert.equal((await ok(P.sansClub, event())).rows[0].calendar_add.created.length, 1, `${label} : club sans équipe, événement`);
  await ok(P.sansClub, `insert into public.matches (club_id, adversaire, date_match) values (3, 'X', '${today}')`);

  /* ---------- Analyste : GPS et avis de match de ses équipes, rien d'autre ---------- */
  assert.deepEqual(await ids(ANALYSTE, `select id from public.gps_imports order by id`), [401], `${label} : imports GPS vus`);
  assert.deepEqual((await ok(ANALYSTE, `select player_id from public.gps_rows`)).rows.map(r => Number(r.player_id)), [J.pro], `${label} : mesures GPS vues`);
  assert.deepEqual((await ok(ANALYSTE, `select player_id from public.gps_player_aliases`)).rows.map(r => Number(r.player_id)), [J.pro], `${label} : noms GPS vus`);
  assert.equal((await ok(ANALYSTE, `select player_metrics from public.gps_settings`)).rows.length, 1, `${label} : il lit les indicateurs ouverts aux joueurs`);
  assert.deepEqual((await ok(ANALYSTE, `select player_id from public.match_feedback`)).rows.map(r => Number(r.player_id)), [J.pro], `${label} : avis de match vus`);

  const save = (team, player, hash) => `select public.gps_import_save('${JSON.stringify({ team_id: team, date_seance: today, fichier: 'x.csv', file_hash: HASH(hash), fournisseur: 'catapult', colonnes: [], nb_joueurs: 1 })}'::jsonb,
    '${JSON.stringify([{ player_id: player, nom_lu: 'Nom', raw: {}, metrics: {} }])}'::jsonb, '[]'::jsonb)`;
  await ok(ANALYSTE, save(T.pro, J.pro, 'd'));
  await no(ANALYSTE, save(T.u14, J.mineure, 'e'), /row-level security/);
  await no(ANALYSTE, save(null, J.pro, 'f'), /row-level security/);
  await no(ANALYSTE, save(T.pro, J.mineure, '0'), /row-level security/);
  assert.equal((await ok(ANALYSTE, `select public.gps_import_cancel(401) c`)).rows[0].c, true, `${label} : il annule un import de son équipe`);
  assert.equal((await ok(ANALYSTE, `select public.gps_import_cancel(402) c`)).rows[0].c, false, `${label} : pas celui d'une autre équipe`);
  assert.equal((await ok(ANALYSTE, `select public.gps_import_cancel(403) c`)).rows[0].c, false, `${label} : ni un import sans équipe`);
  await no(ANALYSTE, `insert into public.gps_settings (club_id, player_metrics) values (1, '{}') on conflict (club_id) do update set player_metrics = '{}'`, /row-level security/);
  assert.equal((await ok(ANALYSTE, `update public.gps_settings set player_metrics = '{}'`)).affectedRows, 0, `${label} : le réglage du club ne lui appartient pas`);
  await ok(ANALYSTE, `insert into public.gps_player_aliases (club_id, nom_lu, player_id) values (1, 'P. Pro', ${J.pro})`);
  await no(ANALYSTE, `insert into public.gps_player_aliases (club_id, nom_lu, player_id) values (1, 'M. Mineure', ${J.mineure})`, /row-level security/);

  // Les autres comptes gardent leur GPS.
  await ok(P.prepaPro, save(T.pro, J.pro, '1'));
  assert.deepEqual(await ids(P.coachU14, `select id from public.gps_imports where id in (401, 402, 403) order by id`), [402, 403], `${label} : coach U14`);
  assert.deepEqual(await ids(P.admin, `select id from public.gps_imports where id in (401, 402, 403) order by id`), [401, 402, 403], `${label} : admin`);
  assert.equal((await ok(P.prepaU14, `update public.gps_settings set player_metrics = '{distance}'`)).affectedRows, 1, `${label} : le prépa règle toujours le GPS du club`);
  await no(P.coachPro, save(T.pro, J.pro, '2'), /row-level security/);
  assert.equal((await ok(P.lecteur, `select id from public.gps_rows`)).rows.length, 0, `${label} : jamais le lecteur`);

  if (rollback) {
    await q(`update public.profiles set role = 'coach', team_ids = '{}' where id = $1`, [ANALYSTE]);
    await db.exec(sqlFile('lmfc_v42_retour.sql'));
    await db.exec(sqlFile('lmfc_v42_retour.sql'));
    const back = await catalog(db);
    for (const k of Object.keys(start)) assert.deepEqual(back[k], start[k], `${label} : retour arrière, ${k} à l'identique`);
  }
  await db.close();
}

await run('production', ['lmfc_v39.sql', 'lmfc_v40.sql', 'lmfc_v41.sql', 'lmfc_v43.sql', 'lmfc_v46.sql'], ['lmfc_v42.sql'], true);
await run('ordre du README', [], ['lmfc_v39.sql', 'lmfc_v40.sql', 'lmfc_v41.sql', 'lmfc_v42.sql', 'lmfc_v43.sql', 'lmfc_v44.sql', 'lmfc_v45.sql', 'lmfc_v46.sql'], false);

console.log('v42-sql : OK (RPE, admin, coachs, analyste et GPS, retour arrière ; ordre de la production et du README)');
process.exit(0);
