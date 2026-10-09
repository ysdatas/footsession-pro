/* Droits d'accès par séance (supabase/lmfc_v10.sql) sur un vrai Postgres
   (PGlite, WASM), RLS active, comptes simulés : ancienne séance inchangée,
   nouvelle séance réservée au staff de son équipe, réglages nominatifs,
   garde du créateur, tables liées, corbeille.
   Lancement : npm i --no-save @electric-sql/pglite && node tests/sessions-access-sql.test.mjs
   (sans PGlite installé, le test est ignoré). */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.log('sessions-access-sql : ignoré (npm i --no-save @electric-sql/pglite pour le lancer)');
  process.exit(0);
}
const read = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8');

const U = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const ADMIN = U(1), CREATEUR = U(2), COACH_U18 = U(3), COACH_U15 = U(4), PREPA_U18 = U(5), PREPA_LIBRE = U(6), JOUEUR = U(7);
const ROLES = { [ADMIN]: 'admin', [CREATEUR]: 'coach', [COACH_U18]: 'coach', [COACH_U15]: 'coach', [PREPA_U18]: 'prepa', [PREPA_LIBRE]: 'prepa', [JOUEUR]: 'joueur' };
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
create table public.teams (id bigint generated always as identity primary key, club_id bigint not null references public.clubs, nom text not null);
insert into public.teams (club_id, nom) values (1, 'U18'), (1, 'U15');
create table public.profiles (id uuid primary key, club_id bigint references public.clubs, role text, team_id bigint references public.teams);
insert into auth.users select unnest(array['${ADMIN}','${CREATEUR}','${COACH_U18}','${COACH_U15}','${PREPA_U18}','${PREPA_LIBRE}','${JOUEUR}'])::uuid;
insert into public.profiles values ('${ADMIN}', 1, 'admin', null), ('${CREATEUR}', 1, 'coach', 1), ('${COACH_U18}', 1, 'coach', 1),
  ('${COACH_U15}', 1, 'coach', 2), ('${PREPA_U18}', 1, 'prepa', 1), ('${PREPA_LIBRE}', 1, 'prepa', null), ('${JOUEUR}', 1, 'joueur', null);
create function public.my_club_id() returns bigint language sql stable security definer as $$ select club_id from public.profiles where id = auth.uid() $$;
create function public.has_role(variadic r text[]) returns boolean language sql stable as $$ select (select role from public.sim) = any(r) $$;
create function public.can_edit() returns boolean language sql stable as $$ select public.has_role('admin','coach') $$;
create function public.is_club_admin() returns boolean language sql stable as $$ select public.has_role('admin') $$;
create function public.is_staff() returns boolean language sql stable as $$ select not public.has_role('joueur') $$;
create function public.can_manage_videos() returns boolean language sql stable as $$ select public.has_role('admin','coach') $$;
create function public.can_manage_plans() returns boolean language sql stable as $$ select public.has_role('admin','coach','prepa') $$;

create table public.players (id bigint generated always as identity primary key, club_id bigint not null references public.clubs,
  nom text not null, prenom text, numero int, team_id bigint references public.teams);
insert into public.players (club_id, nom, team_id) values (1, 'ADAME', 1), (1, 'BARAKAT', 1);
create table public.sessions (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade,
  created_by uuid, titre text not null, date_seance date not null default now(), team_id bigint references public.teams on delete set null,
  notes text, share_token text unique, equipes jsonb not null default '[]');
create table public.procedures (id bigint generated always as identity primary key, session_id bigint not null references public.sessions on delete cascade,
  ordre int default 1, nom text not null default 'Procédé');
create table public.tactical_schemas (id bigint generated always as identity primary key, procedure_id bigint not null unique references public.procedures on delete cascade, image_path text);
create table public.attendance (id bigint generated always as identity primary key, player_id bigint not null references public.players on delete cascade,
  session_id bigint not null references public.sessions on delete cascade, present boolean default false, unique (player_id, session_id));
create table public.session_comments (id bigint generated always as identity primary key, session_id bigint not null references public.sessions on delete cascade,
  user_id uuid, author text, body text not null, created_at timestamptz default now());

alter table public.sessions enable row level security;
create policy "sessions_read" on public.sessions for select using (club_id = public.my_club_id());
create policy "sessions_write" on public.sessions for all using (club_id = public.my_club_id() and public.can_edit()) with check (club_id = public.my_club_id() and public.can_edit());
alter table public.players enable row level security;
create policy players_read on public.players for select using (club_id = public.my_club_id());
alter table public.procedures enable row level security;
alter table public.tactical_schemas enable row level security;
alter table public.attendance enable row level security;
alter table public.session_comments enable row level security;
create policy "comments_delete" on public.session_comments for delete using (user_id = auth.uid() or public.is_club_admin());
grant usage on schema auth to authenticated;
grant select on public.sim, public.profiles, public.teams to authenticated;
grant select, insert, update, delete on public.sessions, public.players, public.procedures, public.tactical_schemas, public.attendance, public.session_comments to authenticated;
grant usage on all sequences in schema public to authenticated;
-- Une séance d'avant la migration.
insert into public.sessions (club_id, titre, team_id, created_by) values (1, 'Ancienne séance U18', 1, '${CREATEUR}');
`);
await db.exec(read('lmfc_v5.sql'));
await db.exec(read('lmfc_v9.sql'));
await db.exec(read('lmfc_v10.sql'));
await db.exec(read('lmfc_v10.sql'));   // rejouable
await db.exec(`grant select, insert, update, delete on public.session_bilans to authenticated; grant usage on all sequences in schema public to authenticated;`);

const as = async (uid, fn) => {
  await q('update public.sim set uid = $1, role = $2', [uid, ROLES[uid]]);
  await db.exec('set role authenticated');
  try { return await fn(); } finally { await db.exec('reset role'); await q('update public.sim set uid = $1, role = $2', [ADMIN, 'admin']); }
};
const sees = async (uid, id) => (await as(uid, () => q('select id from public.sessions where id = $1', [id]))).rows.length === 1;
const edits = async (uid, id) => (await as(uid, () => q(`update public.sessions set titre = titre || '.' where id = $1 returning id`, [id]))).rows.length === 1;
const level = async (uid, id) => (await as(uid, () => one('select public.session_access_level($1) n', [id]))).n;

// 1) Ancienne séance : rien ne change (le club lit, admin et coachs modifient).
assert.equal((await one(`select acces from public.sessions where id = 1`)).acces, 'club');
assert.ok(await sees(COACH_U15, 1) && await edits(COACH_U15, 1), 'coach d’une autre équipe : comme avant');
assert.ok(await sees(JOUEUR, 1) && !(await edits(PREPA_U18, 1)), 'lecture pour le club, pas de modification pour le préparateur');

// 2) Nouvelle séance : le créateur est celui qui crée, l'accès de base est « equipe ».
const s2 = (await as(CREATEUR, () => one(`insert into public.sessions (club_id, titre, team_id, created_by) values (1, 'Séance U18', 1, '${COACH_U15}') returning id, created_by, acces`)));
assert.equal(s2.created_by, CREATEUR, 'créateur forcé : pas d’usurpation');
assert.equal(s2.acces, 'equipe');
const S = s2.id;
assert.deepEqual([await level(CREATEUR, S), await level(COACH_U18, S), await level(PREPA_U18, S), await level(PREPA_LIBRE, S), await level(COACH_U15, S), await level(JOUEUR, S), await level(ADMIN, S)],
  ['modification', 'lecture', 'lecture', 'lecture', 'aucun', 'aucun', 'modification'], 'niveaux par défaut');
assert.ok(!(await sees(COACH_U15, S)) && !(await sees(JOUEUR, S)), 'autre équipe et joueur : invisible');
assert.ok(await sees(COACH_U18, S) && !(await edits(COACH_U18, S)), 'même équipe : lecture seule');

// 3) Réglages nominatifs par le créateur.
await as(CREATEUR, () => q(`insert into public.session_access (session_id, profile_id, niveau) values ($1, '${COACH_U15}', 'modification'), ($1, '${COACH_U18}', 'aucun')`, [S]));
assert.ok(await edits(COACH_U15, S), 'Jean → modification');
assert.ok(!(await sees(COACH_U18, S)), 'Pierre → aucun accès');
await assert.rejects(as(CREATEUR, () => q(`insert into public.session_access (session_id, profile_id, niveau) values ($1, '${PREPA_U18}', 'modification')`, [S])),
  /row-level security/, 'modification réservée aux comptes admin ou coach');
await assert.rejects(as(CREATEUR, () => q(`insert into public.session_access (session_id, profile_id, niveau) values ($1, '${JOUEUR}', 'lecture')`, [S])),
  /row-level security/, 'jamais un joueur');
// Un compte qui modifie ne règle pas les droits et ne change pas l'accès de base.
await assert.rejects(as(COACH_U15, () => q(`insert into public.session_access (session_id, profile_id, niveau) values ($1, '${PREPA_LIBRE}', 'aucun')`, [S])), /row-level security/);
await as(COACH_U15, () => q(`update public.sessions set acces = 'club', created_by = '${COACH_U15}' where id = $1`, [S]));
assert.deepEqual(await one(`select acces, created_by from public.sessions where id = $1`, [S]), { acces: 'equipe', created_by: CREATEUR }, 'garde du créateur');
// Le créateur ouvre la séance à tout le club.
await as(CREATEUR, () => q(`update public.sessions set acces = 'club' where id = $1`, [S]));
assert.ok(await sees(JOUEUR, S) && !(await sees(COACH_U18, S)), 'tout le club, sauf Pierre (réglage nominatif)');
await as(CREATEUR, () => q(`update public.sessions set acces = 'equipe' where id = $1`, [S]));

// 4) Tables de la séance : mêmes droits.
await as(CREATEUR, () => q(`insert into public.procedures (session_id, nom) values ($1, 'Rondo')`, [S]));
await as(CREATEUR, () => q(`insert into public.attendance (session_id, player_id, statut) values ($1, 1, 'present')`, [S]));
await as(CREATEUR, () => q(`insert into public.session_bilans (session_id, player_id, note) values ($1, 1, 'plus')`, [S]));
for (const t of ['procedures', 'attendance', 'session_bilans']) {
  assert.equal((await as(COACH_U18, () => q(`select 1 from public.${t} where session_id = $1`, [S]))).rows.length, 0, `${t} : invisible sans accès`);
  assert.equal((await as(PREPA_U18, () => q(`select 1 from public.${t} where session_id = $1`, [S]))).rows.length, 1, `${t} : lisible en lecture`);
}
await assert.rejects(as(PREPA_U18, () => q(`insert into public.procedures (session_id, nom) values ($1, 'Intrus')`, [S])), /row-level security/, 'lecture seule');
await as(COACH_U15, () => q(`insert into public.procedures (session_id, nom) values ($1, 'Ajout de Jean')`, [S]));
assert.equal(Number((await one(`select count(*) n from public.procedures where session_id = $1`, [S])).n), 2, 'modification : ajoute un procédé');

// 5) Corbeille : la séance supprimée reste réservée.
await as(CREATEUR, () => q(`delete from public.sessions where id = $1`, [S]));
const inTrash = async (uid) => (await as(uid, () => q(`select 1 from public.trash where tbl = 'sessions' and row_id = $1`, [S]))).rows.length === 1;
assert.deepEqual([await inTrash(CREATEUR), await inTrash(ADMIN), await inTrash(COACH_U15)], [true, true, false], 'auteur et admin seulement');
const root = await one(`select id from public.trash where tbl = 'sessions' and row_id = $1`, [S]);
await as(CREATEUR, () => q(`select public.trash_restore($1)`, [[root.id]]));
assert.equal(await level(COACH_U18, S), 'aucun', 'réglages restaurés avec la séance');

console.log('sessions-access-sql : OK (5 scénarios)');
