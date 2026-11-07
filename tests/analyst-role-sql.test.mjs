/* Rôle Analyste vidéo : exécute les vraies migrations et teste le périmètre
   RLS, les invitations, les vidéos joueurs et le retour arrière avec PGlite.
   Lancement : node tests/analyst-role-sql.test.mjs */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([
    import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/pgcrypto'),
    import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent'),
  ]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('analyst-role-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db, rest } = await fullDb(pg, { until: 'lmfc_v41.sql' });
assert.deepEqual(rest.slice(0, 2), ['lmfc_v42.sql', 'lmfc_v43.sql'], 'v42 et la migration calendrier suivante');
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const ids = (uid, s, p) => as(uid, async () => (await q(s, p)).rows.map(r => Number(r.id)));
const changed = async (uid, s, p) => (await as(uid, () => q(s, p))).affectedRows;
const refused = (uid, s, p) => assert.rejects(as(uid, () => q(s, p)),
  /row-level security|permission denied|Seul l’administrateur|Choisissez une équipe|Cette séance ne peut être rangée|Vous ne pouvez rien créer|reste attaché à son joueur|Rubrique de joueur inconnue/i, `refus attendu : ${s}`);

// L'admin attribue le rôle à un compte existant sans équipe : Pro est affectée.
await as(P.admin, () => q(`select public.club_set_member_role($1, 'analyste')`, [P.coachSans]));
assert.deepEqual((await q(`select role, team_ids from public.profiles where id = $1`, [P.coachSans])).rows[0],
  { role: 'analyste', team_ids: [T.pro] }, 'attribution du rôle : équipe Pro par défaut');
assert.deepEqual(await ids(P.coachSans, `select id from public.players order by id`), [J.pro], 'Pro visible, autres équipes fermées');
const staffIds = (await as(P.coachSans, () => q(`select id from public.club_staff()`))).rows.map(r => r.id);
assert.ok(!staffIds.includes(P.coachU14), 'l’analyste ne récupère pas les responsables des autres équipes');
assert.equal((await as(P.coachSans, () => q(`select public.can_edit_players() p, public.can_manage_player_videos() v,
  public.can_manage_videos() g, public.can_edit() e, public.is_performance_editor() d`))).rows[0].p, true);
const helpers = (await as(P.coachSans, () => q(`select public.can_manage_player_videos() v,
  public.can_manage_videos() g, public.can_edit() e, public.is_performance_editor() d`))).rows[0];
assert.deepEqual(helpers, { v: true, g: false, e: false, d: true }, 'droits joueurs distincts des droits globaux');

assert.equal(await changed(P.coachSans, `update public.players set poste = 'Gardien' where id = ${J.pro}`), 1, 'fiche Pro modifiable');
assert.equal(await changed(P.coachSans, `update public.players set poste = 'Gardien' where id = ${J.mineure}`), 0, 'fiche U14 invisible');
await refused(P.coachSans, `insert into public.players (club_id, nom, team_id) values (1, 'Hors périmètre', ${T.u14})`);
assert.equal(await changed(P.coachSans, `insert into public.players (club_id, nom, team_id)
  values (1, 'Nouveau Pro', ${T.pro})`), 1, 'création d’un joueur dans son équipe');
const addedPlayer = (await as(P.coachSans, () => q(`select id from public.players where nom = 'Nouveau Pro'`))).rows[0]?.id;
assert.ok(addedPlayer, 'création d’un joueur dans son équipe');

// La migration ferme les WITH CHECK de performances : un changement de joueur
// sur une ligne existante ne permet pas de déplacer les données vers les U14.
const perf = (await as(P.coachSans, () => q(`insert into public.player_physical_tests
  (club_id, player_id, stage, tested_at, source, sprint10_sec)
  values (1, ${J.pro}, 'pre', '2026-09-01', 'manuel', 1.8) returning id`))).rows[0].id;
assert.deepEqual(await ids(P.coachSans, `select id from public.player_physical_tests where player_id = ${J.pro}`), [perf],
  'l’analyste lit les tests des joueurs autorisés');
await refused(P.coachSans, `update public.player_physical_tests set player_id = ${J.mineure} where id = ${perf}`);
await refused(P.coachSans, `insert into public.player_physical_tests
  (club_id, player_id, stage, tested_at, source) values (1, ${J.mineure}, 'pre', '2026-09-01', 'manuel')`);

// Vidéos, séquences et R2 : droits sur le joueur autorisé, sans gestion de la bibliothèque.
const video = (await as(P.coachSans, () => q(`insert into public.player_videos
  (club_id, player_id, titre, storage_path) values (1, ${J.pro}, 'Analyse Pro', 'r2/1/1/1700000000.mp4') returning id`))).rows[0].id;
await refused(P.coachSans, `update public.player_videos set player_id = ${J.mineure} where id = ${video}`);
const seq = (await as(P.coachSans, () => q(`insert into public.video_sequences
  (club_id, player_id, video_id, label, start_sec, end_sec)
  values (1, ${J.pro}, ${video}, 'Pressing', 2, 5) returning id`))).rows[0].id;
assert.equal(await changed(P.coachSans, `update public.video_sequences set staff_feedback = 'Bien joué' where id = ${seq}`), 1,
  'l’analyste peut annoter une séquence comme staff');
await refused(P.coachSans, `update public.video_sequences set player_id = ${J.mineure} where id = ${seq}`);
await refused(P.coachSans, `insert into public.player_videos (club_id, player_id, titre, storage_path)
  values (1, ${J.mineure}, 'U14', 'r2/1/4/1700000001.mp4')`);
await q(`insert into storage.buckets (id, name) values ('player-videos', 'player-videos') on conflict (id) do nothing`);
await as(P.coachSans, () => q(`insert into storage.objects (bucket_id, name) values ('player-videos', '1/${J.pro}/1700000000.mp4')`));
await refused(P.coachSans, `insert into storage.objects (bucket_id, name) values ('player-videos', '1/${J.mineure}/1700000001.mp4')`);
const recipientRoles = (await as(P.joueurPro, () => q(`select role from public.sequence_recipients(${J.pro})`))).rows.map(r => r.role);
assert.ok(recipientRoles.includes('analyste'), 'l’analyste autorisé apparaît aux destinataires des séquences');

// L'admin peut étendre le périmètre à N2, sans ouvrir les U14.
await as(P.admin, () => q(`update public.profiles set team_ids = array[${T.pro}, ${T.n2}]::bigint[] where id = $1`, [P.coachSans]));
assert.deepEqual(await ids(P.coachSans, `select id from public.players order by id`), [J.pro, J.n2, addedPlayer], 'Pro + N2 après autorisation admin');
assert.equal((await q(`select public.player_level_for($1, $2) l`, [P.coachSans, J.mineure])).rows[0].l, 'aucun', 'U14 reste fermé');

// Droits de séance, match, calendrier, RPE et schémas introduits par v42.
const beforeV42 = await catalog(db);
for (const file of rest.slice(0, 1)) { await db.exec(sqlFile(file)); await db.exec(sqlFile(file)); }
const sessionId = (await as(P.coachSans, () => q(`insert into public.sessions (club_id, titre, date_seance, team_id)
  values (1, 'Séance Analyste', current_date, ${T.pro}) returning id`))).rows[0].id;
assert.equal((await q(`select acces from public.sessions where id = $1`, [sessionId])).rows[0].acces,
  'equipe', 'création Analyste toujours limitée à son équipe');
await as(P.coachSans, () => q(`insert into public.attendance (player_id, session_id, invite)
  values (${J.pro}, ${sessionId}, true)`));
await refused(P.coachSans, `insert into public.attendance (player_id, session_id, invite)
  values (${J.mineure}, ${sessionId}, true)`);
await refused(P.coachSans, `insert into public.sessions (club_id, titre, date_seance, team_id)
  values (1, 'Séance U14', current_date, ${T.u14})`);
await refused(P.coachSans, `update public.sessions set team_id = ${T.u14} where id = ${sessionId}`);
await as(P.coachSans, () => q(`insert into public.session_access (session_id, profile_id, niveau)
  values (${sessionId}, $1, 'aucun')`, [P.coachPro]));

const series = await as(P.coachSans, () => q(`select public.calendar_add('seance', $1::jsonb, '{}'::jsonb) result`, [JSON.stringify([
  { titre: 'Séance série Analyste', date: '2026-11-07', team_id: T.pro, serie_id: '00000000-0000-0000-0000-000000000042' },
])]));
assert.equal(series.rows[0].result.created.length, 1, 'création de série dans son équipe');
await refused(P.coachSans, `select public.calendar_add('evenement',
  '[{"titre":"Événement U14","date":"2026-11-07","team_id":${T.u14}}]'::jsonb)`);
const event = await as(P.coachSans, () => q(`select public.calendar_add('evenement',
  '[{"titre":"Tournoi Pro","date":"2026-11-08","team_id":${T.pro}}]'::jsonb,
  '{"add":[${J.pro}]}'::jsonb) result`));
assert.equal(event.rows[0].result.created.length, 1, 'événement et joueur de l’équipe autorisés');

const matchId = (await as(P.coachSans, () => q(`insert into public.matches (club_id, team_id, adversaire, date_match)
  values (1, ${T.pro}, 'Adversaire Pro', current_date) returning id`))).rows[0].id;
await refused(P.coachSans, `insert into public.matches (club_id, team_id, adversaire, date_match)
  values (1, ${T.u14}, 'Adversaire U14', current_date)`);
await as(P.coachSans, () => q(`insert into public.match_players (club_id, match_id, player_id, statut, minutes)
  values (1, ${matchId}, ${J.pro}, 'titulaire', 90)`));
await refused(P.coachSans, `insert into public.match_players (club_id, match_id, player_id)
  values (1, ${matchId}, ${J.mineure})`);
await as(P.coachSans, () => q(`select public.rpe_set($1, 8, $2)`, [sessionId, J.pro]));
await as(P.coachSans, () => q(`select public.match_rpe_set($1, 7, $2)`, [matchId, J.pro]));
assert.equal((await as(P.coachSans, () => q(`select count(*)::int n from public.session_rpe where player_id = ${J.pro}`))).rows[0].n, 1,
  'correction RPE de séance dans le périmètre');
assert.equal((await as(P.coachSans, () => q(`select count(*)::int n from public.match_rpe where player_id = ${J.pro}`))).rows[0].n, 1,
  'correction RPE de match dans le périmètre');

const noteId = (await as(P.coachSans, () => q(`insert into public.player_performance_notes (club_id, player_id, kind, title)
  values (1, ${J.pro}, 'objective', 'Objectif Analyste') returning id`))).rows[0].id;
await refused(P.coachSans, `update public.player_performance_notes set player_id = ${J.mineure} where id = ${noteId}`);
const mediaId = (await as(P.coachSans, () => q(`insert into public.player_performance_media (club_id, player_id, storage_path)
  values (1, ${J.pro}, '1/${J.pro}/objectif.jpg') returning id`))).rows[0].id;
await refused(P.coachSans, `update public.player_performance_media set player_id = ${J.mineure} where id = ${mediaId}`);
assert.equal((await as(P.coachSans, () => q(`select public.set_player_hidden_sections(array[${J.pro}, ${J.mineure}]::bigint[], array['radar']) n`))).rows[0].n, 1,
  'sections modifiables seulement pour les joueurs attribués');
await refused(P.coachSans, `select public.set_player_hidden_sections(array[${J.pro}]::bigint[], array['secret'])`);

await q(`insert into storage.buckets (id, name) values ('schemas', 'schemas') on conflict (id) do nothing`);
const procedureId = (await as(P.coachSans, () => q(`insert into public.procedures (session_id, nom) values ($1, 'Procédé Analyste') returning id`, [sessionId]))).rows[0].id;
await as(P.coachSans, () => q(`insert into public.tactical_schemas (procedure_id, canvas_json, image_path)
  values ($1, '{}'::jsonb, '1/sessions/${sessionId}/schema.jpg')`, [procedureId]));
await as(P.coachSans, () => q(`insert into storage.objects (bucket_id, name) values ('schemas', '1/sessions/${sessionId}/schema.jpg')`));
const otherSessionId = (await as(P.admin, () => q(`insert into public.sessions (club_id, titre, date_seance, team_id)
  values (1, 'Séance hors périmètre', current_date, ${T.u14}) returning id`))).rows[0].id;
await refused(P.coachSans, `insert into storage.objects (bucket_id, name) values ('schemas', '1/sessions/${otherSessionId}/schema.jpg')`);
const templateId = (await as(P.coachSans, () => q(`insert into public.exercise_templates (club_id, nom, partage)
  values (1, 'Modèle privé Analyste', false) returning id`))).rows[0].id;
await refused(P.coachSans, `update public.exercise_templates set partage = true where id = ${templateId}`);
await as(P.coachSans, () => q(`insert into storage.objects (bucket_id, name) values ('schemas', '1/users/${P.coachSans}/templates/model.jpg')`));
await refused(P.coachSans, `insert into storage.objects (bucket_id, name) values ('schemas', '1/users/${P.coachU14}/templates/model.jpg')`);

await db.exec(sqlFile('lmfc_v42_retour.sql'));
const afterRollback = await catalog(db);
const rollbackDiff = Object.keys(beforeV42).filter((key) => JSON.stringify(beforeV42[key]) !== JSON.stringify(afterRollback[key]));
assert.deepEqual(rollbackDiff, [], 'retour v42 restaure les fonctions et politiques v41');

// Un analyste invité reçoit lui aussi Pro à la première connexion confirmée.
await as(P.admin, () => q(`insert into public.club_access (club_id, email, role, created_by)
  values (1, $1, 'analyste', $2)`, [`${P.sansClub}@test.fr`, P.admin]));
assert.equal((await as(P.sansClub, () => q(`select public.claim_club_access() role`))).rows[0].role, 'analyste', 'invitation réclamée');
assert.deepEqual((await q(`select role, team_ids from public.profiles where id = $1`, [P.sansClub])).rows[0],
  { role: 'analyste', team_ids: [T.pro] }, 'nouvel analyste affecté à Pro');

// Sans équipe Pro (ni aucune équipe), le rôle ne tombe jamais sur le repli
// historique qui ouvrait tous les joueurs du club.
const NO_TEAM = '00000000-0000-0000-0000-000000000019';
await db.exec(`insert into public.clubs (nom, join_code) values ('Sans équipes', 'CCCC');
  insert into auth.users (id, email, email_confirmed_at) values ('${NO_TEAM}', 'analyste-isole@test.fr', now());
  insert into public.players (club_id, nom) values (3, 'Joueur non classé');
  update public.profiles set club_id = 3, role = 'coach', team_ids = '{}' where id = '${NO_TEAM}';
  update public.profiles set club_id = 3, role = 'admin', team_ids = '{}' where id = '${P.adminB}';`);
await as(P.adminB, () => q(`select public.club_set_member_role($1, 'analyste')`, [NO_TEAM]));
const noTeamPlayer = (await q(`select id from public.players where nom = 'Joueur non classé'`)).rows[0].id;
assert.equal((await q(`select public.player_level_for($1, $2) l`, [NO_TEAM, noTeamPlayer])).rows[0].l, 'aucun',
  'club sans équipe : analyste sans équipe ne voit aucun joueur');
assert.deepEqual(await ids(NO_TEAM, `select id from public.players`), [], 'aucune fiche visible sans autorisation équipe');
await refused(NO_TEAM, `insert into public.players (club_id, nom) values (3, 'Création sans équipe')`);
assert.equal((await as(NO_TEAM, () => q(`select public.team_level(null) l`))).rows[0].l, 'aucun',
  'aucune portée implicite sur les séances/matchs sans équipe');

// Retour arrière protégé : d'abord refusé si des utilisateurs utilisent encore ce rôle.
await assert.rejects(db.exec(sqlFile('lmfc_v41_retour.sql')), /réattribuez les profils Analyste vidéo/i);
await db.exec('rollback');
await as(P.admin, () => q(`select public.club_set_member_role($1, 'coach')`, [P.coachSans]));
await as(P.admin, () => q(`select public.club_set_member_role($1, 'coach')`, [P.sansClub]));
await as(P.adminB, () => q(`select public.club_set_member_role($1, 'coach')`, [NO_TEAM]));
await as(P.admin, () => q(`delete from public.club_access where email = $1`, [`${P.sansClub}@test.fr`]));
await db.exec(sqlFile('lmfc_v41_retour.sql'));
assert.equal((await q(`select to_regprocedure('public.can_manage_player_videos()') fn`)).rows[0].fn, null,
  'retour arrière : helper Analyste supprimé');
await db.close();
console.log('analyst-role-sql : OK (RLS joueurs/performance/vidéos, équipe par défaut, rôle global, rollback)');
