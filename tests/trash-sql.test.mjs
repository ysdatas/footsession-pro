/* Corbeille (supabase/lmfc_v5.sql) sur un vrai Postgres (PGlite, WASM) :
   schéma réduit fidèle aux clés étrangères réelles, rôles simulés.
   Capture en cascade, restauration complète, liens rétablis, droits.
   Lancement : npm i --no-save @electric-sql/pglite && node tests/trash-sql.test.mjs
   (sans PGlite installé, le test est ignoré). */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.log('trash-sql : ignoré (npm i --no-save @electric-sql/pglite pour le lancer)');
  process.exit(0);
}
const SQL = readFileSync(new URL('../supabase/lmfc_v5.sql', import.meta.url), 'utf8');
const SQL_V6 = readFileSync(new URL('../supabase/lmfc_v6.sql', import.meta.url), 'utf8');

const db = new PGlite();
const q = (s, p) => db.query(s, p);
const one = async (s, p) => (await q(s, p)).rows[0];

await db.exec(`
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key);
create table public.sim (uid uuid, role text);
insert into public.sim values ('00000000-0000-0000-0000-000000000001', 'admin');
create function auth.uid() returns uuid language sql stable as $$ select uid from public.sim $$;
create table public.clubs (id bigint generated always as identity primary key, nom text);
create table public.profiles (id uuid primary key, club_id bigint references public.clubs on delete set null, role text);
create function public.my_club_id() returns bigint language sql stable as $$ select club_id from public.profiles where id = auth.uid() $$;
create function public.has_role(variadic r text[]) returns boolean language sql stable as $$ select (select role from public.sim) = any(r) $$;
create function public.can_edit() returns boolean language sql stable as $$ select public.has_role('admin','coach') $$;
create function public.is_club_admin() returns boolean language sql stable as $$ select public.has_role('admin') $$;
create function public.can_manage_videos() returns boolean language sql stable as $$ select public.has_role('admin','coach') $$;
create function public.can_manage_plans() returns boolean language sql stable as $$ select public.has_role('admin','coach','prepa') $$;
insert into auth.users values ('00000000-0000-0000-0000-000000000001');
insert into public.clubs (nom) values ('LMFC'), ('Autre');
insert into public.profiles values ('00000000-0000-0000-0000-000000000001', 1, 'admin');

create table public.teams (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, nom text not null, unique (club_id, nom));
create table public.players (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, nom text, team_id bigint references public.teams on delete set null);
create table public.sessions (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, titre text not null, date_seance date not null default now(), team_id bigint references public.teams on delete set null);
create table public.procedures (id bigint generated always as identity primary key, session_id bigint not null references public.sessions on delete cascade, nom text not null default 'Procédé');
create table public.player_videos (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, player_id bigint not null references public.players on delete cascade, titre text, storage_path text not null);
create table public.tactical_schemas (id bigint generated always as identity primary key, procedure_id bigint not null unique references public.procedures on delete cascade, image_path text, video_id bigint references public.player_videos on delete set null);
create table public.attendance (id bigint generated always as identity primary key, player_id bigint not null references public.players on delete cascade, session_id bigint not null references public.sessions on delete cascade, present boolean, unique (player_id, session_id));
create table public.session_comments (id bigint generated always as identity primary key, session_id bigint not null references public.sessions on delete cascade, body text);
create table public.exercise_templates (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, nom text not null);
create table public.player_career (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, player_id bigint not null references public.players on delete cascade, club_name text not null);
create table public.video_sequences (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, player_id bigint not null references public.players on delete cascade, video_id bigint not null references public.player_videos on delete cascade, label text, drawings jsonb not null default '[]');
create table public.video_views (id bigint generated always as identity primary key, video_id bigint not null references public.player_videos on delete cascade, player_id bigint not null references public.players on delete cascade);
create table public.player_video_selections (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, player_id bigint not null references public.players on delete cascade, video_id bigint not null references public.player_videos on delete cascade, unique (player_id, video_id));
create table public.player_performance_notes (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, player_id bigint not null references public.players on delete cascade, kind text, title text);
create table public.player_performance_media (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, player_id bigint not null references public.players on delete cascade, note_id bigint references public.player_performance_notes on delete cascade, storage_path text);
create table public.player_physical_measurements (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, player_id bigint not null references public.players on delete cascade, month_label text, weight_kg numeric);
create table public.player_physical_tests (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, player_id bigint not null references public.players on delete cascade, stage text, vift_kmh numeric);
create table public.player_programs (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, player_id bigint not null references public.players on delete cascade, title text not null);
create table public.club_access (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, email text, player_id bigint references public.players on delete cascade);
create table public.program_exercises (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, player_id bigint not null references public.players on delete cascade, title text not null, video_id bigint references public.player_videos on delete set null, image_path text);
`);
await db.exec(SQL);
await db.exec(SQL);   // rejouable

await db.exec(`
insert into public.teams (club_id, nom) values (1, 'N2');
insert into public.players (club_id, nom, team_id) values (1, 'ADAME', 1), (1, 'BARAKAT', 1);
insert into public.sessions (club_id, titre, team_id) values (1, 'Séance A', 1), (1, 'Séance B', null);
insert into public.procedures (session_id, nom) values (1, 'Rondo'), (1, 'Jeu réduit'), (2, 'Finition');
insert into public.player_videos (club_id, player_id, titre, storage_path) values (1, 1, 'VS Nantes', 'r2/1/1/1.mp4');
insert into public.tactical_schemas (procedure_id, image_path, video_id) values (1, '1/procedure-1.png', 1), (2, null, null);
insert into public.attendance (player_id, session_id, present) values (1, 1, true), (2, 1, false);
insert into public.session_comments (session_id, body) values (1, 'ok');
insert into public.video_sequences (club_id, player_id, video_id, label, drawings) values (1, 1, 1, 'But', '[{"t":1}]'), (1, 1, 1, 'Pressing', '[]');
insert into public.video_views (video_id, player_id) values (1, 1);
insert into public.player_video_selections (club_id, player_id, video_id) values (1, 1, 1);
insert into public.player_performance_notes (club_id, player_id, kind, title) values (1, 1, 'objective', null);
insert into public.player_performance_media (club_id, player_id, note_id, storage_path) values (1, 1, 1, '1/a.jpg'), (1, 1, 1, '1/b.jpg');
insert into public.program_exercises (club_id, player_id, title, video_id) values (1, 1, 'Gainage', 1);
insert into public.player_physical_measurements (club_id, player_id, month_label, weight_kg) values (1, 1, 'Août', 72.4), (1, 1, 'Septembre', 72.9);
insert into public.player_physical_tests (club_id, player_id, stage, vift_kmh) values (1, 1, 'pre', 19.5);
insert into public.player_career (club_id, player_id, club_name) values (1, 1, 'Stade Lavallois');
insert into public.player_programs (club_id, player_id, title) values (1, 1, 'Nordic');
insert into public.club_access (club_id, email, player_id) values (1, 'joueur@example.test', 1);
`);
const count = async (t) => Number((await one(`select count(*) n from public.${t}`)).n);
const trashRoots = async () => (await q(`select id, tbl, row_id from public.trash where root_id is null order by id`)).rows;

// 1. Une image retirée seule (édition d'un objectif) : pas de corbeille.
await q(`delete from public.player_performance_media where id = 2`);
assert.equal(await count('trash'), 0, 'image seule : rien en corbeille');

// 2. Séance supprimée : elle + exercices + schémas + présences + commentaires.
await q(`delete from public.sessions where id = 1`);
let roots = await trashRoots();
assert.deepEqual(roots.map(r => r.tbl), ['sessions']);
const sessRoot = roots[0].id;
const kids = (await q(`select tbl from public.trash where root_id = $1 order by id`, [sessRoot])).rows.map(r => r.tbl);
assert.deepEqual(kids.sort(), ['attendance', 'attendance', 'procedures', 'procedures', 'session_comments', 'tactical_schemas', 'tactical_schemas'].sort());
assert.equal(await count('procedures'), 1);

// 3. Vidéo supprimée : séquences, vues, sélections ; lien du programme et du schéma remis à zéro.
await q(`delete from public.player_videos where id = 1`);
roots = await trashRoots();
assert.deepEqual(roots.map(r => r.tbl), ['sessions', 'player_videos']);
const vidRoot = roots[1].id;
const vk = (await q(`select tbl from public.trash where root_id = $1`, [vidRoot])).rows.map(r => r.tbl).sort();
assert.deepEqual(vk, ['player_video_selections', 'video_sequences', 'video_sequences', 'video_views']);
assert.equal((await one(`select video_id from public.program_exercises where id = 1`)).video_id, null);

// 4. Restaurer la vidéo : tout revient, mêmes identifiants, lien du programme rétabli.
const n = (await one(`select public.trash_restore($1) n`, [[vidRoot]])).n;
assert.equal(n, 1);
assert.equal(await count('video_sequences'), 2);
assert.deepEqual((await one(`select drawings from public.video_sequences where label = 'But'`)).drawings, [{ t: 1 }]);
assert.equal((await one(`select video_id from public.program_exercises where id = 1`)).video_id, 1);
assert.equal(await count('player_video_selections'), 1);
assert.equal((await one(`select id from public.player_videos`)).id, 1);
assert.equal(Number((await one(`select count(*) n from public.trash where id = $1 or root_id = $1`, [vidRoot])).n), 0);

// 5. Restaurer la séance : exercices, schéma (et son lien vidéo, revenue entre-temps ? non : la vidéo
//    était là quand la séance est partie, son lien est dans la copie), présences, commentaire.
await one(`select public.trash_restore($1) n`, [[sessRoot]]);
assert.equal(await count('procedures'), 3);
assert.equal(await count('tactical_schemas'), 2);
assert.equal(await count('attendance'), 2);
assert.equal((await one(`select team_id from public.sessions where id = 1`)).team_id, 1);

// 6. Séquence seule (racine), puis restauration.
await q(`delete from public.video_sequences where label = 'Pressing'`);
roots = await trashRoots();
assert.deepEqual(roots.map(r => r.tbl), ['video_sequences']);
await one(`select public.trash_restore($1) n`, [[roots[0].id]]);
assert.equal(await count('video_sequences'), 2);

// 7. Équipe : joueurs et séances détachés puis rattachés à la restauration.
await q(`delete from public.teams where id = 1`);
assert.equal((await one(`select count(*) n from public.players where team_id is null`)).n, 2);
roots = await trashRoots();
await one(`select public.trash_restore($1) n`, [[roots[0].id]]);
assert.equal(Number((await one(`select count(*) n from public.players where team_id = 1`)).n), 2);
assert.equal((await one(`select team_id from public.sessions where id = 1`)).team_id, 1);

// 8. Équipe recréée sous le même nom : restauration refusée avec un message clair, rien de perdu.
await q(`delete from public.teams where id = 1`);
await q(`insert into public.teams (club_id, nom) values (1, 'N2')`);
roots = await trashRoots();
await assert.rejects(q(`select public.trash_restore($1)`, [[roots[0].id]]), /existe déjà/);
assert.equal(Number((await one(`select count(*) n from public.trash`)).n), 1, 'la corbeille garde l’équipe');
await q(`delete from public.trash`);

// 9. Exercice d'une séance supprimé seul (.in) : racine, avec son schéma ; parent disparu => message.
await q(`delete from public.procedures where id in (1, 2)`);
roots = await trashRoots();
assert.deepEqual(roots.map(r => r.tbl), ['procedures', 'procedures']);
const sch = (await q(`select root_id from public.trash where tbl = 'tactical_schemas' order by id`)).rows.map(r => r.root_id);
assert.deepEqual(sch, [roots[0].id, roots[1].id], 'chaque schéma suit son exercice');
await q(`delete from public.sessions where id = 1`);
await assert.rejects(q(`select public.trash_restore($1)`, [[roots[0].id]]), /n'existe plus/);

// 10. Objectif : ses images partent et reviennent avec lui.
await q(`delete from public.trash`);
await q(`delete from public.player_performance_notes where id = 1`);
roots = await trashRoots();
assert.equal((await q(`select * from public.trash where root_id = $1`, [roots[0].id])).rows.length, 1);
await one(`select public.trash_restore($1)`, [[roots[0].id]]);
assert.equal(await count('player_performance_media'), 1);

// 11. Droits : un préparateur ne voit pas les vidéos et ne peut pas les restaurer.
await q(`delete from public.trash`);
await q(`delete from public.player_videos where id = 1`);
await q(`update public.sim set role = 'prepa'`);
await db.exec(`grant usage on schema public, auth to authenticated; grant select on all tables in schema public to authenticated; grant select on all tables in schema auth to authenticated`);
await q(`set role authenticated`);
assert.equal((await q(`select * from public.trash`)).rows.length, 0, 'prepa : vidéo invisible');
assert.equal((await one(`select public.trash_restore(array(select id from public.trash))`)).trash_restore, 0);
await assert.rejects(q(`insert into public.trash (batch, tbl, root_tbl, data) values (1, 'x', 'x', '{}')`), /permission|denied/i);
await q(`reset role`);
await q(`update public.sim set role = 'coach'`);
await q(`set role authenticated`);
assert.equal((await q(`select * from public.trash where root_id is null`)).rows.length, 1, 'coach : vidéo visible');
await q(`delete from public.trash`);   // suppression définitive (politique trash_purge)
await q(`reset role`);
assert.equal(await count('trash'), 0);

// 12. Joueur supprimé : UNE entrée dans la corbeille, avec toute sa fiche ;
//     la restauration remet tout, même ce qui est parti avant son parent.
await q(`update public.sim set role = 'admin'`);
await q(`delete from public.trash`);
// Une vidéo et ses séquences, pour vérifier qu'elles reviennent avec le joueur.
await q(`insert into public.player_videos (club_id, player_id, titre, storage_path) values (1, 1, 'Retour', 'r2/1/1/2.mp4')`);
await q(`insert into public.video_sequences (club_id, player_id, video_id, label, drawings) select 1, 1, id, 'But', '[{"t":1}]' from public.player_videos where titre = 'Retour'`);
await q(`insert into public.video_views (video_id, player_id) select id, 1 from public.player_videos where titre = 'Retour'`);
const before = {};
for (const t of ['player_videos', 'video_sequences', 'video_views', 'player_video_selections', 'player_performance_notes',
  'player_performance_media', 'program_exercises', 'player_physical_measurements', 'player_physical_tests', 'player_career',
  'player_programs', 'club_access']) before[t] = await count(t);
await q(`delete from public.players where id = 1`);
roots = await trashRoots();
assert.deepEqual(roots.map(r => r.tbl), ['players'], 'un joueur = une seule entrée');
for (const t of Object.keys(before)) assert.equal(await count(t), 0, `${t} parti avec le joueur`);
assert.equal(await count('players'), 1);
await one(`select public.trash_restore($1)`, [[roots[0].id]]);
for (const [t, n] of Object.entries(before)) assert.equal(await count(t), n, `${t} revenu`);
assert.deepEqual((await one(`select drawings from public.video_sequences where label = 'But'`)).drawings, [{ t: 1 }]);
assert.equal(await count('trash'), 0);
// Suppression d'un joueur refusée au coach (trash_right = administrateur) : la corbeille ne la lui montre pas.
await q(`delete from public.players where id = 1`);
await q(`update public.sim set role = 'coach'`);
await q(`set role authenticated`);
assert.equal((await q(`select * from public.trash where tbl = 'players'`)).rows.length, 0, 'coach : joueur supprimé invisible');
await q(`reset role`);
await q(`update public.sim set role = 'admin'`);
await one(`select public.trash_restore(array(select id from public.trash where root_id is null))`);
assert.equal(await count('players'), 2);

// 13. lmfc_v6 : un point (programme terrain) porte sa vidéo et ses exercices.
await db.exec(SQL_V6);
await db.exec(SQL_V6);   // rejouable
const vid1 = (await one(`insert into public.player_videos (club_id, player_id, titre, storage_path) values (1, 1, 'Appuis', 'r2/1/1/9.mp4') returning id`)).id;
const vid2 = (await one(`insert into public.player_videos (club_id, player_id, titre, storage_path) values (1, 2, 'Autre', 'r2/1/2/9.mp4') returning id`)).id;
const ex1 = (await one(`insert into public.program_exercises (club_id, player_id, title) values (1, 1, 'Échelle') returning id`)).id;
const ex2 = (await one(`insert into public.program_exercises (club_id, player_id, title) values (1, 1, 'Haies basses') returning id`)).id;
const exOther = (await one(`insert into public.program_exercises (club_id, player_id, title) values (1, 2, 'Autre') returning id`)).id;
const pt = (await one(`insert into public.player_performance_notes (club_id, player_id, kind, title, video_id, exercise_ids)
  values (1, 1, 'strength', 'Appuis', $1, $2) returning id`, [vid1, [ex2, ex1]])).id;
await assert.rejects(q(`update public.player_performance_notes set video_id = $1 where id = $2`, [vid2, pt]), /pas à ce joueur/, 'vidéo d’un autre joueur refusée');
await assert.rejects(q(`update public.player_performance_notes set exercise_ids = $1 where id = $2`, [[ex1, exOther], pt]), /pas à ce joueur/, 'exercice d’un autre joueur refusé');
await q(`update public.player_performance_notes set exercise_ids = $1 where id = $2`, [[ex2, ex1, 999999], pt]);   // introuvable : accepté
await q(`update public.player_performance_notes set exercise_ids = $1 where id = $2`, [[ex2, ex1], pt]);
await q(`delete from public.trash`);
//     exercice supprimé puis restauré : il retrouve sa place (même identifiant)
await q(`delete from public.program_exercises where id = $1`, [ex1]);
await one(`select public.trash_restore(array(select id from public.trash where root_id is null))`);
assert.deepEqual((await one(`select exercise_ids from public.player_performance_notes where id = $1`, [pt])).exercise_ids.map(Number), [ex2, ex1]);
//     joueur supprimé puis restauré : le point revient avec ses liens, sans erreur
await q(`delete from public.players where id = 1`);
await one(`select public.trash_restore(array(select id from public.trash where root_id is null))`);
const back = await one(`select video_id, exercise_ids from public.player_performance_notes where id = $1`, [pt]);
assert.equal(Number(back.video_id), Number(vid1));
assert.deepEqual(back.exercise_ids.map(Number), [ex2, ex1]);
assert.equal(await count('trash'), 0);

// 14. Club supprimé : aucune erreur, rien gardé.
await q(`delete from public.clubs where id = 1`);
assert.equal(await count('trash'), 0);
console.log('trash-sql : OK (14 scénarios)');
