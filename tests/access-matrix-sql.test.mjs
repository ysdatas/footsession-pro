/* Matrice des droits sur les migrations réelles (full-db.mjs) : pour chaque
   profil, ce qu'il voit et ce qu'il peut écrire, par appels directs à la base,
   comme un compte qui contourne l'interface. Les données sont posées AVANT
   lmfc_v39.sql à lmfc_v42.sql, qui passent deux fois (rejouables).
   Lancement : node tests/access-matrix-sql.test.mjs, avec PGlite relié en
   node_modules (CLAUDE.md, « Tests ») ; sans lui, le test échoue. */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, P, T, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('access-matrix-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db, rest } = await fullDb(pg, { until: 'lmfc_v38.sql' });
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const ids = (uid, s, p) => as(uid, async () => (await q(s, p)).rows.map(r => Number(r.id)));
const refused = (uid, s, re = /row-level security|42501|permission denied|Seul l’administrateur|ne peut être rangée|se règle dans Mon club|dernier rattachement|Choisissez une équipe/) =>
  assert.rejects(as(uid, () => q(s)), re, `refus attendu : ${s}`);
const changed = async (uid, s) => (await as(uid, () => q(s))).affectedRows;
const level = async (uid, player) => (await q(`select public.player_level_for($1, $2) l`, [uid, player])).rows[0].l;

/* ---------- Données posées avant la migration ---------- */
await db.exec(`
insert into public.sessions (club_id, created_by, titre, date_seance, team_id, acces, serie_id) values
 (1, '${P.coachU14}', 'U14 ancienne', '2026-09-01', ${T.u14}, 'club', null),
 (1, '${P.coachU14}', 'U14 équipe', '2026-10-01', ${T.u14}, 'equipe', null),
 (1, '${P.coachPro}', 'Pro équipe', '2026-10-02', ${T.pro}, 'equipe', null),
 (1, '${P.admin}', 'Sans équipe ancienne', '2026-09-03', null, 'club', null),
 (1, '${P.coachPro}', 'Pro ancienne de série', '2026-09-04', ${T.pro}, 'club', gen_random_uuid()),
 (1, '${P.coachU14}', 'U14 ancienne supprimée', '2026-09-05', ${T.u14}, 'club', null);
insert into public.procedures (session_id, nom) values (2, 'Procédé U14 à supprimer');
insert into public.attendance (player_id, session_id, statut) values (${J.mineure}, 1, 'present'), (${J.mineure}, 2, 'present');
insert into public.session_bilans (session_id, player_id, note, commentaire) values (1, ${J.mineure}, 'moins', 'Bilan d’une mineure');
insert into public.matches (club_id, team_id, adversaire, date_match, created_by) values
 (1, ${T.u14}, 'Adv U14', '2026-10-03', '${P.coachU14}'), (1, ${T.pro}, 'Adv Pro', '2026-10-03', '${P.coachPro}'), (1, ${T.u14}, 'Adv U14 supprimé', '2026-10-04', '${P.coachU14}');
insert into public.match_players (club_id, match_id, player_id, statut, commentaire) values (1, 3, ${J.mineure}, 'titulaire', 'Note sur une mineure');
insert into public.exercise_templates (club_id, created_by, nom, partage, image_path) values
 (1, '${P.coachU14}', 'Privé U14', false, '1/templates/10.jpg'), (1, '${P.coachPro}', 'Partagé Pro', true, '1/templates/11.jpg'),
 (1, '${P.coachU14}', 'Privé U14 supprimé', false, null), (1, '${P.coachPro}', 'Partagé supprimé', true, null);
insert into storage.buckets (id, name, public) values ('schemas', 'schemas', true), ('logos', 'logos', false) on conflict (id) do nothing;
insert into storage.objects (bucket_id, name) values ('schemas', '1/procedure-1-1.jpg'), ('schemas', '1/templates/10.jpg'), ('schemas', '1/templates/11.jpg'),
 ('schemas', '1/templates/12.jpg'), ('schemas', '2/procedure-9-1.jpg'), ('logos', '1/logo-1.png'), ('logos', '2/logo-2.png');
`);
await as(P.coachU14, () => q(`delete from public.matches where adversaire = 'Adv U14 supprimé'`));
await as(P.coachU14, () => q(`delete from public.exercise_templates where nom = 'Privé U14 supprimé'`));
await as(P.coachPro, () => q(`delete from public.exercise_templates where nom = 'Partagé supprimé'`));
await as(P.coachU14, () => q(`delete from public.procedures where nom = 'Procédé U14 à supprimer'`));
await as(P.coachU14, () => q(`delete from public.sessions where titre = 'U14 ancienne supprimée'`));
const before = (await q(`select updated_at from public.sessions where id = 1`)).rows[0].updated_at;

/* ---------- La migration, deux fois ---------- */
assert.deepEqual(rest.slice(0, 5), ['lmfc_v39.sql', 'lmfc_v40.sql', 'lmfc_v41.sql', 'lmfc_v42.sql', 'lmfc_v43.sql'], 'migrations après lmfc_v38');
for (const file of rest.slice(0, 4)) { await db.exec(sqlFile(file)); await db.exec(sqlFile(file)); }

/* ---------- Anciennes séances ---------- */
assert.deepEqual((await q(`select id, acces from public.sessions order by id`)).rows.map(r => `${r.id}:${r.acces}`),
  ['1:equipe', '2:equipe', '3:equipe', '4:club', '5:equipe'], 'avec une équipe : staff de l’équipe ; sans équipe : inchangée');
assert.deepEqual((await q(`select updated_at from public.sessions where id = 1`)).rows[0].updated_at, before, 'date de modification inchangée');
assert.equal((await q(`select count(*)::int c from public.lmfc_v39_acces_club where source = 'sessions'`)).rows[0].c, 2);
assert.equal((await q(`select data->>'acces' a from public.trash where tbl = 'sessions'`)).rows[0].a, 'equipe', 'séance à la corbeille : même règle');

/* ---------- Joueurs visibles, profil par profil ---------- */
const VISIBLE = [
  ['admin', [J.pro, J.mixte, J.sans, J.mineure, J.n2]], ['coachPro', [J.pro]], ['coachU17', [J.mixte]], ['coachEsp', [J.mixte]], ['coachU14', [J.mineure]],
  ['coachDeux', [J.mixte]], ['coachSans', []], ['prepaPro', [J.pro]], ['prepaU14', [J.mineure]], ['lecteur', [J.pro, J.mixte, J.mineure, J.n2]],
  ['lecteurU17', [J.mixte]], ['lectureClub', [J.pro, J.mixte, J.mineure, J.n2]], ['joueurPro', [J.pro]], ['joueurU14', [J.mineure]], ['adminB', [J.autre]], ['sansClub', []],
];
for (const [who, list] of VISIBLE) assert.deepEqual(await ids(P[who], `select id from public.players order by id`), list, `joueurs vus par ${who}`);
await assert.rejects(as(null, () => q(`select id from public.players`)), /permission denied/, 'sans compte : refusé');

/* Niveau sur le joueur sans équipe : l'admin seul, sauf exception nominative. */
assert.equal(await level(P.admin, J.sans), 'modification');
for (const who of ['coachPro', 'coachU14', 'prepaPro', 'lecteur', 'lecteurU17', 'lectureClub']) assert.equal(await level(P[who], J.sans), 'aucun', `${who} sur le joueur sans équipe`);
assert.equal(await level(P.lectureClub, J.mineure), 'lecture', 'lecture club : les joueurs des équipes, en lecture');
await q(`insert into public.staff_player_access (profile_id, player_id, club_id, niveau) values ($1, ${J.sans}, 1, 'lecture'), ($2, ${J.pro}, 1, 'lecture'), ($3, ${J.pro}, 1, 'aucun')`,
  [P.coachPro, P.lecteurU17, P.lecteur]);
assert.equal(await level(P.coachPro, J.sans), 'lecture', 'exception : ouvre le joueur sans équipe');
assert.equal(await level(P.lecteurU17, J.pro), 'lecture', 'exception : ouvre un joueur à un lecteur limité');
assert.equal(await level(P.lecteur, J.pro), 'aucun', 'exception : retire un joueur à un lecteur');
assert.equal(await level(P.lecteurU17, J.mineure), 'aucun', 'lecteur limité : rien hors de ses équipes');
await q(`delete from public.staff_player_access`);
// Club sans équipe : personne n'est écarté.
await q(`insert into public.clubs (nom, join_code) values ('Sans équipes', 'CCCC')`);
await q(`insert into public.players (club_id, nom) values (3, 'SEUL')`);
const seul = (await q(`select id from public.players where nom = 'SEUL'`)).rows[0].id;
await q(`update public.profiles set club_id = 3, role = 'lecteur', team_ids = '{}', team_id = null where id = $1`, [P.sansClub]);
assert.equal(await level(P.sansClub, seul), 'lecture', 'club sans équipe : le lecteur lit toujours');
await q(`update public.profiles set role = 'coach' where id = $1`, [P.sansClub]);
assert.equal(await level(P.sansClub, seul), 'modification', 'club sans équipe : le coach modifie toujours');
await q(`update public.profiles set club_id = null where id = $1`, [P.sansClub]);

/* ---------- Séances ---------- */
const SESSIONS = [['admin', [1, 2, 3, 4, 5]], ['coachPro', [3, 4, 5]], ['coachU17', [4]], ['coachU14', [1, 2, 4]], ['prepaPro', [3, 4, 5]], ['prepaU14', [1, 2, 4]],
  ['lecteur', []], ['joueurPro', []], ['joueurU14', []], ['adminB', []], ['sansClub', []]];
for (const [who, list] of SESSIONS) assert.deepEqual(await ids(P[who], `select id from public.sessions order by id`), list, `séances vues par ${who}`);
for (const who of ['coachPro', 'coachU17', 'prepaPro', 'lecteur', 'joueurPro']) {
  assert.deepEqual(await ids(P[who], `select session_id id from public.session_bilans`), [], `bilans lus par ${who}`);
  assert.deepEqual(await ids(P[who], `select id from public.attendance where session_id = 1`), [], `présences U14 lues par ${who}`);
}
assert.deepEqual(await ids(P.coachU14, `select session_id id from public.session_bilans`), [1], 'le coach de l’équipe lit son bilan');
assert.equal(await changed(P.coachPro, `update public.sessions set titre = 'modifié' where id = 1`), 0, 'le coach Pro ne touche plus la séance U14');

// Créer : dans ses équipes seulement.
await refused(P.coachU14, `insert into public.sessions (club_id, titre, date_seance, team_id) values (1, 'Injectée', '2026-11-03', ${T.pro})`);
await refused(P.coachSans, `insert into public.sessions (club_id, titre, date_seance, team_id) values (1, 'Injectée', '2026-11-03', ${T.pro})`);
await refused(P.prepaPro, `insert into public.sessions (club_id, titre, date_seance, team_id) values (1, 'Prépa', '2026-11-03', ${T.pro})`);
await refused(P.coachU14, `select public.calendar_add('seance', '[{"date":"2026-11-02","titre":"Série","team_id":${T.pro}}]')`, /rien créer pour cette équipe/);
assert.equal(await changed(P.coachU14, `insert into public.sessions (club_id, titre, date_seance, team_id) values (1, 'U14 neuve', '2026-11-03', ${T.u14})`), 1);
assert.equal(await changed(P.coachU14, `insert into public.sessions (club_id, titre, date_seance, team_id) values (1, 'Sans équipe neuve', '2026-11-03', null)`), 1);
assert.equal(await changed(P.admin, `insert into public.sessions (club_id, titre, date_seance, team_id) values (1, 'Admin', '2026-11-03', ${T.pro})`), 1);
assert.equal((await as(P.coachU14, () => q(`select public.calendar_add('seance', '[{"date":"2026-11-02","titre":"Série","team_id":${T.u14}}]') r`))).rows[0].r.created.length, 1);

// Déplacer : vers ses équipes seulement ; le joueur Pro ne reçoit pas de séance injectée.
await refused(P.coachU14, `update public.sessions set team_id = ${T.pro} where id = 2`);
assert.deepEqual((await as(P.joueurPro, () => q(`select id from public.my_calendar('2026-08-01', '2026-11-05') where kind = 'seance' order by id`))).rows.map(r => Number(r.id)).filter(x => x === 2), []);
await q(`insert into public.sessions (club_id, created_by, titre, date_seance, team_id) values (1, '${P.coachDeux}', 'Deux équipes', '2026-11-03', ${T.u17})`);
const deux = (await q(`select id from public.sessions where titre = 'Deux équipes'`)).rows[0].id;
assert.equal(await changed(P.coachDeux, `update public.sessions set team_id = ${T.espoirs} where id = ${deux}`), 1, 'entre ses équipes : permis');
assert.equal(await changed(P.admin, `update public.sessions set team_id = ${T.pro} where id = ${deux}`), 1, 'l’admin range où il veut');
// Réglage nominatif : modifie la séance d'une autre équipe sans la déplacer ailleurs.
await q(`insert into public.session_access (session_id, profile_id, niveau) values (3, $1, 'modification')`, [P.coachU14]);
assert.equal(await changed(P.coachU14, `update public.sessions set notes = 'nominatif', team_id = ${T.pro} where id = 3`), 1, 'équipe inchangée : permis');
await refused(P.coachU14, `update public.sessions set team_id = ${T.n2} where id = 3`);
await q(`delete from public.session_access`);
// « Tout le staff du club », choisi par son créateur, reste possible.
assert.equal(await changed(P.coachPro, `update public.sessions set acces = 'club' where id = 3`), 1);
assert.deepEqual(await ids(P.coachU14, `select id from public.sessions where id = 3`), [3], 'ouverte par son créateur : le choix est respecté');
await q(`update public.sessions set acces = 'equipe' where id = 3`);

/* ---------- Fiche joueur ---------- */
const link = /se règle dans Mon club/, teamRule = /Seul l’administrateur|dernier rattachement/;
await refused(P.coachPro, `update public.players set auth_user_id = '${P.coachPro}' where id = ${J.pro}`, link);
await refused(P.admin, `update public.players set auth_user_id = null where id = ${J.pro}`, link);
await refused(P.coachPro, `insert into public.players (club_id, nom, team_id, auth_user_id) values (1, 'X', ${T.pro}, '${P.coachPro}')`, link);
await refused(P.coachPro, `update public.players set team_id = ${T.u14} where id = ${J.pro}`, teamRule);
await refused(P.coachPro, `update public.players set other_team_ids = '{${T.n2}}' where id = ${J.pro}`, teamRule);
await refused(P.coachU17, `update public.players set other_team_ids = '{}' where id = ${J.mixte}`, teamRule);   // retire Espoirs, qui n'est pas à lui
await refused(P.coachU17, `update public.players set team_id = ${T.espoirs}, other_team_ids = '{}' where id = ${J.mixte}`);
await refused(P.coachPro, `update public.players set team_id = null, other_team_ids = '{}' where id = ${J.pro}`);
assert.deepEqual(await ids(P.coachPro, `select id from public.players where id = ${J.pro}`), [J.pro], 'après refus, le coach garde accès à la fiche');
assert.equal(await changed(P.coachDeux, `update public.players set team_id = ${T.espoirs}, other_team_ids = '{${T.u17}}' where id = ${J.mixte}`), 1, 'entre ses équipes : permis');
assert.equal(await changed(P.admin, `update public.players set team_id = ${T.u17}, other_team_ids = '{${T.espoirs}}' where id = ${J.mixte}`), 1, 'l’admin rattache librement');
assert.equal(await changed(P.coachPro, `update public.players set poste = 'Milieu', team_id = ${T.pro}, other_team_ids = '{}' where id = ${J.pro}`), 1, 'équipes inchangées : la fiche se modifie');
// Créer : dans une de ses équipes, jamais sans équipe.
await refused(P.coachPro, `insert into public.players (club_id, nom) values (1, 'Sans équipe')`);
await refused(P.coachPro, `insert into public.players (club_id, nom, team_id) values (1, 'U14', ${T.u14})`);
await refused(P.coachPro, `insert into public.players (club_id, nom, team_id, other_team_ids) values (1, 'Deux', ${T.pro}, '{${T.n2}}')`, teamRule);
assert.equal(await changed(P.coachPro, `insert into public.players (club_id, nom, team_id) values (1, 'NOUVEAU', ${T.pro})`), 1);
assert.equal(await changed(P.admin, `insert into public.players (club_id, nom) values (1, 'ORPHELIN')`), 1, 'l’admin crée sans équipe');
// Les fonctions de Mon club et l'import d'invitation passent toujours.
await as(P.admin, () => q(`select public.club_link_player($1, ${J.n2})`, [P.joueurPro]));
assert.deepEqual((await q(`select id from public.players where auth_user_id = $1`, [P.joueurPro])).rows.map(r => Number(r.id)), [J.n2], 'club_link_player réattribue');
await as(P.admin, () => q(`select public.club_link_player($1, ${J.pro})`, [P.joueurPro]));

/* ---------- Corbeille ---------- */
const trash = async (uid) => (await as(uid, () => q(`select tbl, coalesce(data->>'nom', data->>'adversaire', data->>'titre', data->>'commentaire') n from public.trash order by id`))).rows.map(r => `${r.tbl}:${r.n}`);
const u14 = ['matches:Adv U14 supprimé', 'match_players:Note sur une mineure', 'exercise_templates:Privé U14 supprimé', 'procedures:Procédé U14 à supprimer', 'sessions:U14 ancienne supprimée'];
assert.deepEqual(await trash(P.coachU14), [...u14.slice(0, 3), 'exercise_templates:Partagé supprimé', ...u14.slice(3)], 'corbeille du coach U14');
assert.deepEqual(await trash(P.coachPro), ['exercise_templates:Partagé supprimé'], 'corbeille du coach Pro : rien des U14');
assert.deepEqual(await trash(P.coachEsp), ['exercise_templates:Partagé supprimé'], 'corbeille du coach Espoirs');
assert.equal((await trash(P.admin)).length, 6, 'l’admin voit tout');
for (const who of ['lecteur', 'joueurU14', 'adminB', 'sansClub']) assert.deepEqual(await trash(P[who]), [], `corbeille de ${who}`);
const rootId = async (t, nom) => (await q(`select id from public.trash where tbl = $1 and data->>'nom' = $2`, [t, nom])).rows[0].id;
const prive = await rootId('exercise_templates', 'Privé U14 supprimé');
assert.equal((await as(P.coachPro, () => q(`select public.trash_restore(array[${prive}]::bigint[]) n`))).rows[0].n, 0, 'restauration refusée : schéma privé d’un autre');
assert.equal(await changed(P.coachPro, `delete from public.trash where id = ${prive}`), 0, 'purge refusée : schéma privé d’un autre');
assert.equal((await as(P.coachU14, () => q(`select public.trash_restore(array[${prive}]::bigint[]) n`))).rows[0].n, 1, 'le créateur restaure son schéma');
assert.equal((await q(`select created_by from public.exercise_templates where nom = 'Privé U14 supprimé'`)).rows[0].created_by, P.coachU14);

/* ---------- Stockage ---------- */
const files = async (uid, bucket = 'schemas') => (await as(uid, () => q(`select name from storage.objects where bucket_id = $1 order by name`, [bucket]))).rows.map(r => r.name);
const club1 = ['1/procedure-1-1.jpg', '1/templates/10.jpg', '1/templates/11.jpg', '1/templates/12.jpg'];
assert.deepEqual(await files(P.admin), club1, 'l’admin voit tout son club');
assert.deepEqual(await files(P.coachU14), club1, 'le créateur voit son image privée');
assert.deepEqual(await files(P.coachPro), club1.filter(n => !n.endsWith('/10.jpg')), 'image d’un schéma privé cachée');
assert.deepEqual(await files(P.joueurU14), ['1/procedure-1-1.jpg', '1/templates/12.jpg'], 'joueur : ni schémas privés ni partagés');
assert.deepEqual(await files(P.adminB), ['2/procedure-9-1.jpg'], 'autre club : son dossier seulement');
assert.deepEqual(await files(P.sansClub), [], 'compte sans club : rien');
await assert.rejects(files(null), /permission denied/, 'sans compte : refusé');
assert.deepEqual(await files(P.coachPro, 'logos'), ['1/logo-1.png'], 'logos : son club');

/* ---------- Appels directs ---------- */
for (const who of [P.joueurU14, P.coachPro, null]) {
  await assert.rejects(as(who, () => q(`select public.player_level_for('${P.admin}', 1)`)), /permission denied/);
  await assert.rejects(as(who, () => q(`select public.recompute_player_profile_scores(1, 'pre', '2026-2027', null)`)), /permission denied/);
}
// Les déclencheurs s'en servent toujours : un test saisi recalcule les profils.
await as(P.prepaPro, () => q(`insert into public.player_physical_tests (club_id, player_id, stage, season_key, tested_at, source, sprint10_sec) values (1, ${J.pro}, 'pre', '2026-2027', '2026-09-01', 'manuel', 1.8)`));

/* ---------- Tout le reste, par table ---------- */
const tables = (await q(`select tablename from pg_tables where schemaname = 'public' and tablename <> 'sim' order by 1`)).rows.map(r => r.tablename);
for (const t of tables) {
  assert.equal((await q(`select relrowsecurity r from pg_class where oid = 'public.${t}'::regclass`)).rows[0].r, true, `RLS sur ${t}`);
  await as(null, async () => {
    const r = await q(`select count(*)::int c from public.${t}`).catch(e => { assert.match(e.message, /permission denied/); return { rows: [{ c: 0 }] }; });
    assert.equal(r.rows[0].c, 0, `${t} lisible sans compte`);
  });
}
const withClub = (await q(`select table_name t from information_schema.columns where table_schema = 'public' and column_name = 'club_id' and table_name <> 'sim'`)).rows.map(r => r.t);
for (const t of withClub) {
  await as(P.adminB, async () => {
    const r = await q(`select count(*)::int c from public.${t} where club_id = 1`).catch(e => { assert.match(e.message, /permission denied/); return { rows: [{ c: 0 }] }; });
    assert.equal(r.rows[0].c, 0, `${t} : lignes de LMFC vues par l’autre club`);
  });
}
// Toute table RLS porte les trois règles du lecteur, sauf ces trois : internes ou propres à chacun.
const uncovered = (await q(`select c.relname t from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname <> 'sim'
  and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname in ('lecteur_no_insert', 'lecteur_no_update', 'lecteur_no_delete')) < 3 order by 1`)).rows.map(r => r.t);
assert.deepEqual(uncovered, ['calendar_notifs', 'profiles', 'push_subscriptions'], 'trois règles du lecteur');
// Ce que l'anonyme peut appeler : rien de plus que cette liste.
const anon = (await q(`select p.proname n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
  and p.prorettype <> 'trigger'::regtype and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') order by 1`)).rows.map(r => r.n);
assert.deepEqual(anon, ['can_edit', 'get_shared_session', 'is_club_admin', 'library_tag_clean', 'library_tag_key', 'library_text_key', 'my_club_id', 'valid_hidden_sections'], 'fonctions ouvertes à l’anonyme');
assert.equal((await q(`select count(*)::int c from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
  and not exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%')`)).rows[0].c, 0, 'toute fonction security definer fixe son search_path');

// Rejouable : un second passage ne referme pas une séance rouverte depuis par son créateur.
await q(`update public.sessions set acces = 'club' where id = 3`);
await db.exec(sqlFile('lmfc_v39.sql'));
assert.equal((await q(`select acces from public.sessions where id = 3`)).rows[0].acces, 'club', 'rejoué : le choix de son créateur reste');

console.log('access-matrix-sql : OK (16 profils : joueurs, séances, fiches, corbeille, stockage, appels directs, anonyme, autre club)');
process.exit(0);
