/* Droits par équipe et par joueur (supabase/lmfc_v19.sql) sur un vrai
   Postgres (PGlite, WASM), RLS active et appels directs à la base :
   qui voit et qui modifie joueurs, vidéos, séquences, données physiques,
   séances, matchs, stockage et corbeille.
   Lancement : npm i --no-save @electric-sql/pglite && node tests/rights-sql.test.mjs
   (sans PGlite installé, le test est ignoré). */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.log('rights-sql : ignoré (npm i --no-save @electric-sql/pglite pour le lancer)');
  process.exit(0);
}
const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const ADMIN = U(1), N2 = U(2), U19 = U(3), NONE = U(4), LECT = U(5), PREPA = U(6), JOUEUR = U(7), AUTRE = U(8);
const db = new PGlite();
const q = (s, p) => db.query(s, p);

await db.exec(`
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key);
create table public.sim (uid uuid);
insert into public.sim values (null);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.sim $$;
create table public.clubs (id bigint generated always as identity primary key, nom text);
insert into public.clubs (nom) values ('LMFC'), ('Autre');
create table public.teams (id bigint generated always as identity primary key, club_id bigint not null references public.clubs, nom text);
insert into public.teams (club_id, nom) values (1, 'N2'), (1, 'U19'), (2, 'X');
create table public.profiles (id uuid primary key, club_id bigint references public.clubs, role text, nom text,
  team_id bigint, team_ids bigint[] not null default '{}');
insert into auth.users select unnest(array['${ADMIN}','${N2}','${U19}','${NONE}','${LECT}','${PREPA}','${JOUEUR}','${AUTRE}']::uuid[]);
insert into public.profiles (id, club_id, role, nom, team_ids) values
  ('${ADMIN}', 1, 'admin', 'Admin', '{}'), ('${N2}', 1, 'coach', 'Coach N2', '{1}'), ('${U19}', 1, 'coach', 'Coach U19', '{2}'),
  ('${NONE}', 1, 'coach', 'Coach sans équipe', '{}'), ('${LECT}', 1, 'coach', 'Coach lecture', '{2}'),
  ('${PREPA}', 1, 'prepa', 'Prépa N2', '{1}'), ('${JOUEUR}', 1, 'joueur', 'Joueur', '{}'), ('${AUTRE}', 2, 'admin', 'Admin autre', '{}');
create function public.my_club_id() returns bigint language sql stable security definer as $$ select club_id from public.profiles where id = auth.uid() $$;
create function public.has_role(variadic r text[]) returns boolean language sql stable security definer as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = any(r)) $$;
create function public.is_club_admin() returns boolean language sql stable security definer as $$ select public.has_role('admin') $$;
create function public.can_edit() returns boolean language sql stable security definer as $$ select public.has_role('admin','coach') $$;
create function public.can_manage_videos() returns boolean language sql stable security definer as $$ select public.has_role('admin','coach') $$;
create function public.can_manage_plans() returns boolean language sql stable security definer as $$ select public.has_role('admin','coach','prepa') $$;
create function public.can_view_performance() returns boolean language sql stable security definer as $$ select public.has_role('admin','coach','prepa') $$;
create function public.is_performance_editor() returns boolean language sql stable security definer as $$ select public.has_role('admin','prepa') $$;
create function public.is_video_stats_staff() returns boolean language sql stable security definer as $$ select public.has_role('admin','coach') $$;
create function public.is_staff() returns boolean language sql stable security definer as $$ select exists (select 1 from public.profiles where id = auth.uid() and role <> 'joueur') $$;

create table public.players (id bigint generated always as identity primary key, club_id bigint not null references public.clubs, nom text,
  team_id bigint, other_team_ids bigint[] default '{}', auth_user_id uuid, photo_path text, hidden_sections text[] default '{}');
insert into public.players (club_id, nom, team_id, other_team_ids, auth_user_id) values
  (1, 'P1 N2', 1, '{}', '${JOUEUR}'), (1, 'P2 U19', 2, '{}', null), (1, 'P3 U19+N2', 2, '{1}', null), (1, 'P4 sans équipe', null, '{}', null),
  (2, 'P5 autre club', 3, '{}', null);
create table public.player_videos (id bigint generated always as identity primary key, club_id bigint, player_id bigint references public.players, titre text);
create table public.video_sequences (id bigint generated always as identity primary key, club_id bigint, player_id bigint, video_id bigint,
  label text, created_by uuid default auth.uid(), submitted_at timestamptz);
create table public.video_views (id bigint generated always as identity primary key, video_id bigint);
create table public.player_video_selections (id bigint generated always as identity primary key, club_id bigint, player_id bigint, video_id bigint);
create table public.player_physical_tests (id bigint generated always as identity primary key, club_id bigint, player_id bigint, stage text);
create table public.player_physical_measurements (id bigint generated always as identity primary key, club_id bigint, player_id bigint);
create table public.player_performance_notes (id bigint generated always as identity primary key, club_id bigint, player_id bigint, kind text);
create table public.player_performance_media (id bigint generated always as identity primary key, club_id bigint, player_id bigint);
create table public.player_programs (id bigint generated always as identity primary key, club_id bigint, player_id bigint, visible_to_player boolean);
create table public.program_exercises (id bigint generated always as identity primary key, club_id bigint, player_id bigint, video_id bigint);
create table public.player_career (id bigint generated always as identity primary key, club_id bigint, player_id bigint);
create table public.matches (id bigint generated always as identity primary key, club_id bigint, team_id bigint, adversaire text, created_by uuid default auth.uid());
create table public.match_players (id bigint generated always as identity primary key, club_id bigint, match_id bigint, player_id bigint);
create table public.sessions (id bigint generated always as identity primary key, club_id bigint, team_id bigint, titre text,
  acces text default 'equipe', created_by uuid);
create table public.session_access (session_id bigint, profile_id uuid, niveau text, primary key (session_id, profile_id));
create table public.procedures (id bigint generated always as identity primary key, session_id bigint);
create table public.tactical_schemas (id bigint generated always as identity primary key, procedure_id bigint, video_id bigint);
create table public.trash (id bigint generated always as identity primary key, batch bigint default 1, club_id bigint, tbl text not null,
  row_id bigint, root_id bigint, root_tbl text not null, data jsonb not null, extra jsonb, deleted_by uuid, deleted_at timestamptz default now());
create function public.trash_right(p text) returns boolean language sql stable security definer as $$
  select case p when 'players' then public.is_club_admin() when 'player_videos' then public.can_manage_videos() else public.can_edit() end $$;
create function public.trash_session_visible(p bigint) returns boolean language sql stable as $$ select true $$;
create function public.noop() returns trigger language plpgsql as $$ begin return old; end $$;
create trigger trash_capture before delete on public.player_videos for each row execute function public.noop();
create schema storage;
create table storage.objects (id bigint generated always as identity primary key, bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.objects enable row level security;
create policy logos_read on storage.objects for select using (bucket_id = 'logos');
grant usage on schema auth, storage to authenticated;
grant select on public.sim, public.clubs, public.teams to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
`);
for (const t of ['players', 'player_videos', 'video_sequences', 'video_views', 'player_video_selections', 'player_physical_tests',
  'player_physical_measurements', 'player_performance_notes', 'player_performance_media', 'player_programs', 'program_exercises',
  'player_career', 'matches', 'match_players', 'sessions', 'session_access', 'trash', 'profiles']) {
  await db.exec(`alter table public.${t} enable row level security;`);
}
// Règles déjà en place (lmfc_v10, v14…) que la migration ne touche pas.
await db.exec(`
create policy "players_read_self" on public.players for select using (auth_user_id = auth.uid());
create policy "videos_read_player" on public.player_videos for select
  using (exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid()));
create policy profiles_read on public.profiles for select using (id = auth.uid() or (club_id = public.my_club_id() and public.is_club_admin()));
create policy profiles_admin on public.profiles for update using (club_id = public.my_club_id() and public.is_club_admin());
create policy profiles_self on public.profiles for update using (id = auth.uid());
create policy trash_read on public.trash for select using (club_id = public.my_club_id() and public.trash_right(root_tbl));
create policy session_access_read on public.session_access for select using (true);
`);
const v19 = readFileSync(new URL('../supabase/lmfc_v19.sql', import.meta.url), 'utf8');
await db.exec(v19);
await db.exec(v19);   // rejouable
await db.exec(`
create trigger guard_profile before update on public.profiles for each row execute function public.guard_profile_membership_changes();
create policy sessions_read on public.sessions for select using (public.session_level(id, club_id, created_by, acces, team_id) <> 'aucun');
create policy sessions_update on public.sessions for update using (public.session_level(id, club_id, created_by, acces, team_id) = 'modification');
grant usage on all sequences in schema public to authenticated;`);

const as = async (uid, fn) => {
  await q('update public.sim set uid = $1', [uid]);
  await db.exec('set role authenticated');
  try { return await fn(); } finally { await db.exec('reset role'); }
};
const ids = async (uid, sql) => as(uid, async () => (await q(sql)).rows.map(r => Number(r.id)).sort((a, b) => a - b));
const n = async (uid, sql, params) => as(uid, async () => (await q(sql, params)).rows.length);
const ok = async (uid, sql, params) => as(uid, () => q(sql, params));
const ko = (uid, sql, params, why) => assert.rejects(as(uid, () => q(sql, params)), /row-level security|violates|réservée/, why);
const P = { P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };

// Exceptions réglées par l'admin : U19 lit P1 ; N2 n'a plus accès à P3 (pourtant « joue aussi en » N2).
await ok(ADMIN, `insert into public.staff_player_access (profile_id, player_id, club_id, niveau) values ($1, 1, 1, 'lecture'), ($2, 3, 1, 'aucun')`, [U19, N2]);
await ok(ADMIN, `update public.profiles set lecture_club = true where id = $1`, [LECT]);

/* ---------- 1. Joueurs visibles ---------- */
const players = 'select id from public.players order by id';
assert.deepEqual(await ids(ADMIN, players), [1, 2, 3, 4], 'admin : tout son club');
assert.deepEqual(await ids(N2, players), [1, 4], 'coach N2 : son équipe et les sans-équipe, pas P3 (exception « aucun »)');
assert.deepEqual(await ids(U19, players), [1, 2, 3, 4], 'coach U19 : son équipe + P1 en lecture (exception)');
assert.deepEqual(await ids(NONE, players), [], 'coach sans équipe : rien');
assert.deepEqual(await ids(LECT, players), [1, 2, 3, 4], 'lecture club : tout');
assert.deepEqual(await ids(PREPA, players), [1, 3, 4], 'prépa N2 : son équipe (P3 joue aussi en N2)');
assert.deepEqual(await ids(JOUEUR, players), [1], 'joueur : sa fiche');
assert.deepEqual(await ids(AUTRE, players), [5], 'autre club : les siens');
assert.deepEqual(await as(U19, async () => (await q('select player_id::int, niveau from public.my_player_levels() order by 1')).rows),
  [{ player_id: 1, niveau: 'lecture' }, { player_id: 2, niveau: 'modification' }, { player_id: 3, niveau: 'modification' }, { player_id: 4, niveau: 'modification' }]);

/* ---------- 2. Modifier un joueur ---------- */
assert.equal(await n(U19, `update public.players set nom = 'x' where id = 1 returning id`), 0, 'lecture : pas de modification');
assert.equal(await n(U19, `update public.players set nom = 'P2 U19' where id = 2 returning id`), 1);
assert.equal(await n(LECT, `update public.players set nom = 'x' where id = 1 returning id`), 0, 'lecture club : lecture seulement');
await ko(N2, `insert into public.players (club_id, nom, team_id) values (1, 'Nouveau', 2)`, [], 'coach N2 : pas de joueur dans une autre équipe');
await ok(N2, `insert into public.players (club_id, nom, team_id) values (1, 'Nouveau N2', 1)`);
await assert.rejects(as(U19, () => q(`select public.set_player_photo(1, '1/1/x.jpg')`)), /réservée/, 'photo : pas en lecture');

/* ---------- 3. Vidéos et séquences envoyées par le joueur ---------- */
await ok(N2, `insert into public.player_videos (club_id, player_id, titre) values (1, 1, 'Match P1')`);
await ko(N2, `insert into public.player_videos (club_id, player_id, titre) values (1, 2, 'Match P2')`, [], 'coach N2 : pas de vidéo pour P2');
await ok(U19, `insert into public.player_videos (club_id, player_id, titre) values (1, 2, 'Match P2')`);
await ok(JOUEUR, `insert into public.video_sequences (club_id, player_id, video_id, label, submitted_at) values (1, 1, 1, 'Mon action', now())`);
const seqs = 'select id from public.video_sequences';
for (const [who, sees, why] of [[ADMIN, 1, 'admin'], [N2, 1, 'coach de son équipe'], [U19, 1, 'exception lecture'], [LECT, 1, 'lecture club'],
  [NONE, 0, 'coach sans équipe'], [PREPA, 0, 'préparateur : pas un destinataire'], [AUTRE, 0, 'autre club']]) {
  assert.equal((await ids(who, seqs)).length, sees, `séquence du joueur : ${why}`);
}
assert.equal(await n(U19, `update public.video_sequences set label = 'x' returning id`), 0, 'lecture : pas de retour possible');
const recipients = await as(JOUEUR, async () => (await q('select nom from public.sequence_recipients(1) order by nom')).rows.map(r => r.nom));
assert.deepEqual(recipients, ['Coach N2', 'Coach U19', 'Coach lecture', 'Admin'].sort(), 'destinataires : admins et coachs qui ont accès');
assert.equal((await as(N2, async () => (await q('select nom from public.sequence_recipients(2)')).rows)).length, 0, 'pas pour un joueur hors de portée');
assert.deepEqual(await ids(N2, 'select id from public.player_videos'), [1], 'coach N2 : vidéos de son équipe');

/* ---------- 4. Données physiques : le préparateur de l'équipe ---------- */
await ok(PREPA, `insert into public.player_physical_tests (club_id, player_id, stage) values (1, 1, 'pre')`);
await ko(PREPA, `insert into public.player_physical_tests (club_id, player_id, stage) values (1, 2, 'pre')`, [], 'prépa N2 : pas les U19');
await ko(N2, `insert into public.player_physical_tests (club_id, player_id, stage) values (1, 1, 'pre')`, [], 'coach : pas le physique (rôle)');
assert.equal((await ids(U19, 'select id from public.player_physical_tests')).length, 1, 'lecture des tests de P1 (exception)');
assert.equal((await ids(NONE, 'select id from public.player_physical_tests')).length, 0);

/* ---------- 5. Séances par équipe ---------- */
await db.exec(`insert into public.sessions (club_id, team_id, titre, created_by) values (1, 1, 'Séance N2', '${ADMIN}'), (1, null, 'Sans équipe', '${ADMIN}'), (1, 2, 'Séance U19', '${U19}')`);
const lvl = (uid, sid) => as(uid, async () => (await q(`select public.session_level(id, club_id, created_by, acces, team_id) as l from public.sessions where id = $1`, [sid])).rows[0]?.l);
assert.equal(await lvl(N2, 1), 'modification', 'coach de l’équipe : modification (avant : lecture)');
assert.equal(await lvl(PREPA, 1), 'lecture', 'prépa de l’équipe : lecture');
assert.equal(await lvl(LECT, 1), 'lecture', 'lecture club');
assert.equal(await lvl(U19, 1), undefined, 'autre coach : rien (la séance n’est même pas lisible)');
assert.equal(await lvl(NONE, 1), undefined);
assert.equal(await lvl(N2, 2), 'lecture', 'séance sans équipe : lecture pour le staff qui a une équipe');
assert.equal(await lvl(U19, 3), 'modification', 'créateur');
await db.exec(`insert into public.session_access values (1, '${U19}', 'modification')`);
assert.equal(await lvl(U19, 1), 'modification', 'réglage nominatif de la séance');
assert.equal(await n(PREPA, `update public.sessions set titre = 'x' where id = 1 returning id`), 0, 'lecture : pas de modification par la base');

/* ---------- 6. Matchs par équipe ---------- */
await ok(N2, `insert into public.matches (club_id, team_id, adversaire) values (1, 1, 'Laval')`);
await ko(N2, `insert into public.matches (club_id, team_id, adversaire) values (1, 2, 'Rennes')`, [], 'match d’une autre équipe');
assert.equal(await n(U19, `update public.matches set adversaire = 'x' returning id`), 0);
assert.equal((await ids(PREPA, 'select id from public.matches')).length, 1, 'prépa N2 : lecture');
assert.equal((await ids(U19, 'select id from public.matches')).length, 0, 'coach U19 : pas les matchs N2');
await ok(N2, `insert into public.match_players (club_id, match_id, player_id) values (1, 1, 1)`);
await ko(U19, `insert into public.match_players (club_id, match_id, player_id) values (1, 1, 2)`, [], 'joueur ajouté à un match N2');

/* ---------- 7. Stockage (dossier club/joueur) ---------- */
await ok(N2, `insert into storage.objects (bucket_id, name) values ('player-photos', '1/1/a.jpg')`);
await ko(N2, `insert into storage.objects (bucket_id, name) values ('player-photos', '1/2/a.jpg')`, [], 'photo d’un joueur hors de portée');
await ko(U19, `insert into storage.objects (bucket_id, name) values ('player-photos', '1/1/b.jpg')`, [], 'photo en lecture seule');
assert.equal(await n(U19, `select 1 from storage.objects where bucket_id = 'player-photos'`), 1, 'U19 voit la photo de P1 (lecture)');
assert.equal(await n(NONE, `select 1 from storage.objects where bucket_id = 'player-photos'`), 0);

/* ---------- 8. Corbeille ---------- */
await db.exec(`insert into public.trash (club_id, tbl, row_id, root_tbl, data) values
  (1, 'player_videos', 2, 'player_videos', '{"id": 2, "club_id": 1, "player_id": 2, "titre": "Match P2"}')`);
await db.exec(`delete from public.player_videos where id = 2`);
assert.equal(await n(N2, 'select 1 from public.trash'), 0, 'coach N2 ne voit pas la vidéo supprimée de P2');
assert.equal(await n(U19, 'select 1 from public.trash'), 1);
assert.equal((await as(N2, () => q('select public.trash_restore(array[1]::bigint[]) as n'))).rows[0].n, 0, 'restauration refusée hors de portée');
assert.equal((await q('select count(*)::int as n from public.trash')).rows[0].n, 1, 'élément toujours en corbeille');
assert.equal((await as(U19, () => q('select public.trash_restore(array[1]::bigint[]) as n'))).rows[0].n, 1);
assert.equal((await q('select count(*)::int as n from public.player_videos where id = 2')).rows[0].n, 1, 'vidéo restaurée');

/* ---------- 9. Garde des profils ---------- */
await ok(NONE, `update public.profiles set lecture_club = true, team_ids = '{1}' where id = $1`, [NONE]);
assert.deepEqual((await q(`select lecture_club, team_ids from public.profiles where id = $1`, [NONE])).rows[0], { lecture_club: false, team_ids: [] },
  'on ne se donne pas de droits soi-même');
// Retrait du club : en production par club_remove_member (fonction serveur, hors RLS).
await q('update public.sim set uid = $1', [ADMIN]);
await q(`update public.profiles set club_id = null where id = $1`, [U19]);
assert.equal((await q(`select count(*)::int as n from public.staff_player_access where profile_id = $1`, [U19])).rows[0].n, 0, 'exceptions retirées en quittant le club');
await ko(AUTRE, `insert into public.staff_player_access (profile_id, player_id, club_id, niveau) values ($1, 1, 1, 'modification')`, [N2], 'admin d’un autre club');
await ko(N2, `insert into public.staff_player_access (profile_id, player_id, club_id, niveau) values ($1, 2, 1, 'modification')`, [N2], 'seul l’admin règle les exceptions');

console.log('rights-sql : OK (joueurs, vidéos, séquences, physique, séances, matchs, stockage, corbeille, garde)');
