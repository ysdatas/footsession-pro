/* Séance enrichie (supabase/lmfc_v9.sql) sur un vrai Postgres (PGlite, WASM) :
   statut → present, invités du club seulement, équipes / staff par procédé,
   bilans lus par le staff seul, corbeille, lien de partage public.
   Lancement : npm i --no-save @electric-sql/pglite && node tests/sessions-v9-sql.test.mjs
   (sans PGlite installé, le test est ignoré). */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.log('sessions-v9-sql : ignoré (npm i --no-save @electric-sql/pglite pour le lancer)');
  process.exit(0);
}
const SQL_V5 = readFileSync(new URL('../supabase/lmfc_v5.sql', import.meta.url), 'utf8');
const SQL_V9 = readFileSync(new URL('../supabase/lmfc_v9.sql', import.meta.url), 'utf8');

const ADMIN = '00000000-0000-0000-0000-000000000001';
const COACH = '00000000-0000-0000-0000-000000000002';
const PREPA = '00000000-0000-0000-0000-000000000003';
const JOUEUR = '00000000-0000-0000-0000-000000000004';
const ROLES = { [ADMIN]: 'admin', [COACH]: 'coach', [PREPA]: 'prepa', [JOUEUR]: 'joueur' };
const db = new PGlite();
const q = (s, p) => db.query(s, p);
const one = async (s, p) => (await q(s, p)).rows[0];

await db.exec(`
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key);
create table public.sim (uid uuid, role text);
insert into public.sim values ('${ADMIN}', 'admin');
create function auth.uid() returns uuid language sql stable as $$ select uid from public.sim $$;
create table public.clubs (id bigint generated always as identity primary key, nom text, logo_path text, color text);
insert into public.clubs (nom) values ('LMFC'), ('Autre');
create table public.profiles (id uuid primary key, club_id bigint references public.clubs, role text);
insert into auth.users values ('${ADMIN}'), ('${COACH}'), ('${PREPA}'), ('${JOUEUR}');
insert into public.profiles values ('${ADMIN}', 1, 'admin'), ('${COACH}', 1, 'coach'), ('${PREPA}', 1, 'prepa'), ('${JOUEUR}', 1, 'joueur');
create function public.my_club_id() returns bigint language sql stable security definer as $$ select club_id from public.profiles where id = auth.uid() $$;
create function public.has_role(variadic r text[]) returns boolean language sql stable as $$ select (select role from public.sim) = any(r) $$;
create function public.can_edit() returns boolean language sql stable as $$ select public.has_role('admin','coach') $$;
create function public.is_club_admin() returns boolean language sql stable as $$ select public.has_role('admin') $$;
create function public.is_staff() returns boolean language sql stable as $$ select not public.has_role('joueur') $$;
create function public.can_manage_videos() returns boolean language sql stable as $$ select public.has_role('admin','coach') $$;
create function public.can_manage_plans() returns boolean language sql stable as $$ select public.has_role('admin','coach','prepa') $$;

create table public.teams (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, nom text not null);
insert into public.teams (club_id, nom) values (1, 'U18'), (1, 'U15');
create table public.players (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade,
  nom text not null, prenom text, numero int, team_id bigint references public.teams on delete set null);
insert into public.players (club_id, nom, team_id) values (1, 'ADAME', 1), (1, 'BARAKAT', 1), (1, 'CISSE', 2), (2, 'ÉTRANGER', null);
create table public.sessions (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade,
  created_by uuid, titre text not null, date_seance date not null default now(), team_id bigint references public.teams on delete set null,
  notes text, share_token text unique, equipes jsonb not null default '[]');
create table public.procedures (id bigint generated always as identity primary key, session_id bigint not null references public.sessions on delete cascade,
  ordre int default 1, nom text not null default 'Procédé');
create table public.tactical_schemas (id bigint generated always as identity primary key, procedure_id bigint not null unique references public.procedures on delete cascade, image_path text);
create table public.session_comments (id bigint generated always as identity primary key, session_id bigint not null references public.sessions on delete cascade,
  author text, body text not null, created_at timestamptz default now());
create table public.attendance (id bigint generated always as identity primary key, player_id bigint not null references public.players on delete cascade,
  session_id bigint not null references public.sessions on delete cascade, present boolean default false, unique (player_id, session_id));

alter table public.sessions enable row level security;
create policy sessions_read on public.sessions for select using (club_id = public.my_club_id());
create policy sessions_write on public.sessions for all using (club_id = public.my_club_id() and public.can_edit()) with check (club_id = public.my_club_id() and public.can_edit());
alter table public.players enable row level security;
create policy players_read on public.players for select using (club_id = public.my_club_id());
alter table public.procedures enable row level security;
create policy procedures_read on public.procedures for select using (exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id()));
create policy procedures_write on public.procedures for all using (public.can_edit()) with check (public.can_edit());
alter table public.attendance enable row level security;
create policy attendance_read on public.attendance for select using (public.is_staff() and exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id()));
grant usage on schema auth to authenticated;
grant select on public.sim, public.profiles, public.teams to authenticated;
grant select, insert, update, delete on public.sessions, public.players, public.procedures, public.attendance to authenticated;
grant usage on all sequences in schema public to authenticated;
`);
await db.exec(`
insert into public.sessions (club_id, titre) values (1, 'Ancienne séance');
insert into public.session_comments (session_id, author, body, created_at) values
  (1, 'Jean', 'Bonne intensité', '2026-09-01 10:00'), (1, null, 'Revoir les transitions', '2026-09-01 11:00');
`);
await db.exec(SQL_V5);
await db.exec(SQL_V9);
await db.exec(SQL_V9);   // rejouable
// 0) Commentaires de la cellule recopiés une seule fois dans le commentaire de séance.
assert.equal((await one(`select notes from public.sessions where id = 1`)).notes, 'Jean : Bonne intensité\nRevoir les transitions',
  'cellule → commentaire général, sans doublon au second passage');
await db.exec(`delete from public.session_comments; delete from public.sessions; delete from public.trash; alter table public.sessions alter column id restart with 1`);

const as = async (uid, fn) => {
  await q('update public.sim set uid = $1, role = $2', [uid, ROLES[uid]]);
  await db.exec('set role authenticated');
  try { return await fn(); } finally { await db.exec('reset role'); await q('update public.sim set uid = $1, role = $2', [ADMIN, 'admin']); }
};

await db.exec(`
insert into public.sessions (club_id, titre, team_id, notes, share_token) values (1, 'Transitions', 1, 'Bilan : intensité moyenne', 'tok');
insert into public.procedures (session_id, ordre, nom) values (1, 1, 'Rondo'), (1, 2, 'Jeu réduit');
`);

// 1) Le statut fait foi sur present ; sans statut, present reste tel quel.
await q(`insert into public.attendance (player_id, session_id, statut) values (1, 1, 'reprise'), (2, 1, 'blesse')`);
await q(`insert into public.attendance (player_id, session_id, present) values (3, 1, true)`);
const presents = async () => (await q(`select player_id, present from public.attendance order by player_id`)).rows.map(r => [r.player_id, r.present]);
assert.deepEqual(await presents(), [[1, true], [2, false], [3, true]], 'reprise compte présent, blessé absent, ancienne ligne inchangée');
await q(`update public.attendance set statut = 'retard' where player_id = 2`);
await q(`update public.attendance set statut = 'malade' where player_id = 1`);
assert.deepEqual(await presents(), [[1, false], [2, true], [3, true]], 'present suit chaque changement de statut');
await assert.rejects(q(`update public.attendance set statut = 'vacances' where player_id = 1`), /attendance_statut_check/, 'statut inconnu refusé');

// 2) Invité : un joueur d'une autre équipe du club, jamais d'un autre club.
await as(COACH, () => q(`update public.attendance set invite = true, statut = 'present' where player_id = 3`));
assert.equal((await one(`select team_id from public.players where id = 3`)).team_id, 2, 'son équipe ne change pas');
await assert.rejects(as(COACH, () => q(`insert into public.attendance (player_id, session_id, statut, invite) values (4, 1, 'present', true)`)),
  /row-level security/, 'joueur d’un autre club refusé');

// 3) Équipes et staff par procédé : des tableaux JSON.
await as(COACH, () => q(`update public.procedures set equipes = '[{"nom":"Rouges","couleur":"#E03131","player_ids":[1,3]}]',
  staff = '[{"nom":"Jean","role":"Animation"},{"nom":"Paul","role":"Gestion vidéo"}]', filme = true where id = 1`));
assert.equal((await one(`select jsonb_array_length(staff) n from public.procedures where id = 1`)).n, 2);
await assert.rejects(q(`update public.procedures set equipes = '{"nom":"x"}' where id = 2`), /procedures_equipes_is_array/, 'objet refusé');
await assert.rejects(q(`update public.procedures set staff = '"Jean"' where id = 2`), /procedures_staff_is_array/, 'texte refusé');
assert.equal((await one(`select filmee from public.sessions where id = 1`)).filmee, false, 'séance non filmée par défaut');

// 4) Bilans : écrits par admin/coach, lus par le staff, jamais par le joueur.
await as(COACH, () => q(`insert into public.session_bilans (session_id, player_id, note, commentaire)
  values (1, 1, 'plus', 'Très bon investissement'), (1, 2, 'moins', 'Manque d’intensité')`));
assert.equal((await as(PREPA, () => q(`select * from public.session_bilans`))).rows.length, 2, 'le préparateur lit');
assert.equal((await as(JOUEUR, () => q(`select * from public.session_bilans`))).rows.length, 0, 'le joueur ne lit rien');
await assert.rejects(as(PREPA, () => q(`insert into public.session_bilans (session_id, player_id, note) values (1, 3, 'egal')`)),
  /row-level security/, 'le préparateur n’écrit pas');
await assert.rejects(q(`insert into public.session_bilans (session_id, player_id, note) values (1, 3, 'bof')`), /check/, 'note inconnue refusée');
await assert.rejects(as(COACH, () => q(`insert into public.session_bilans (session_id, player_id, note) values (1, 4, 'plus')`)),
  /row-level security/, 'joueur d’un autre club refusé');

// 5) Lien public : joueurs de la séance seulement, sans motif ni commentaire général.
const shared = (await one(`select public.get_shared_session('tok') j`)).j;
assert.equal(shared.session.notes, undefined, 'commentaire général non publié');
assert.equal(shared.session.share_token, undefined);
assert.deepEqual(shared.attendance.map(a => a.nom).sort(), ['ADAME', 'BARAKAT', 'CISSE'], 'seulement les joueurs de la séance');
assert.ok(shared.attendance.every(a => !('statut' in a)), 'pas de statut médical');
assert.equal(shared.attendance.find(a => a.nom === 'CISSE').invite, true, 'invité signalé');
assert.equal(shared.procedures[0].equipes[0].nom, 'Rouges', 'équipes du procédé publiées');

// 6) Corbeille : la séance revient avec ses présences et ses bilans.
await as(COACH, () => q(`delete from public.sessions where id = 1`));
assert.equal(Number((await one(`select count(*) n from public.session_bilans`)).n), 0);
const root = await one(`select id from public.trash where root_id is null and tbl = 'sessions'`);
assert.ok(root, 'séance en corbeille');
await as(COACH, () => q(`select public.trash_restore($1)`, [[root.id]]));
assert.deepEqual((await q(`select player_id, note from public.session_bilans order by player_id`)).rows.map(r => [r.player_id, r.note]),
  [[1, 'plus'], [2, 'moins']], 'bilans restaurés');
assert.equal((await one(`select invite from public.attendance where player_id = 3`)).invite, true, 'invité restauré');

console.log('sessions-v9-sql : OK (6 scénarios)');
