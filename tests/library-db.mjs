/* Base de test de la bibliothèque vidéo (lmfc_v24.sql, lmfc_v25.sql) :
   un vrai Postgres (PGlite, WASM), RLS active, comptes simulés.
   Les migrations réelles de la corbeille (lmfc_v5, v9) et des séances
   (lmfc_v10) sont passées, puis les fonctions de rôle et de niveau telles
   que lmfc_v22.sql les définit (extraites du fichier), puis les deux
   migrations de la bibliothèque, deux fois chacune (rejouables).
   Utilisée par library-sql.test.mjs et library-sessions-sql.test.mjs. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8');
/* « create or replace function public.<nom>(… $$; » tel qu'écrit dans la migration. */
function fnFrom(file, name) {
  const src = read(file);
  const start = src.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} absente de ${file}`);
  return src.slice(start, src.indexOf('\n$$;', start) + 4);
}

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
export const USERS = {
  ADMIN: U(1), N2: U(2), N2B: U(3), U19: U(4), NONE: U(5), PREPA: U(6), PREPA19: U(7), SCOUT: U(8), JOUEUR: U(9), AUTRE: U(10),
};
const { ADMIN, N2, N2B, U19, NONE, PREPA, PREPA19, SCOUT, JOUEUR, AUTRE } = USERS;

export async function libraryDb(PGlite) {
  const db = new PGlite();
  const q = (s, p) => db.query(s, p);
  await db.exec(`
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key);
create table public.sim (uid uuid);
insert into public.sim values (null);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.sim $$;
create table public.clubs (id bigint generated always as identity primary key, nom text, logo_path text, color text);
insert into public.clubs (nom) values ('LMFC'), ('Autre');
create table public.teams (id bigint generated always as identity primary key, club_id bigint not null references public.clubs, nom text not null);
insert into public.teams (club_id, nom) values (1, 'N2'), (1, 'U19'), (2, 'X');
create table public.profiles (id uuid primary key, club_id bigint references public.clubs, role text, nom text,
  team_id bigint, team_ids bigint[] not null default '{}', lecture_club boolean not null default false, prefs jsonb default '{}');
insert into auth.users select unnest(array['${Object.values(USERS).join("','")}']::uuid[]);
insert into public.profiles (id, club_id, role, nom, team_ids) values
  ('${ADMIN}', 1, 'admin', 'Admin', '{}'), ('${N2}', 1, 'coach', 'Coach N2', '{1}'), ('${N2B}', 1, 'coach', 'Coach N2 bis', '{1}'),
  ('${U19}', 1, 'coach', 'Coach U19', '{2}'), ('${NONE}', 1, 'coach', 'Coach sans équipe', '{}'),
  ('${PREPA}', 1, 'prepa', 'Prépa N2', '{1}'), ('${PREPA19}', 1, 'prepa', 'Prépa U19', '{2}'),
  ('${SCOUT}', 1, 'lecteur', 'Scout', '{1}'), ('${JOUEUR}', 1, 'joueur', 'Joueur', '{}'), ('${AUTRE}', 2, 'admin', 'Admin autre', '{}');
update public.profiles set team_id = team_ids[1];
create function public.my_club_id() returns bigint language sql stable security definer as $$ select club_id from public.profiles where id = auth.uid() $$;
create function public.has_role(variadic r text[]) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = any(r)) $$;
create function public.is_club_admin() returns boolean language sql stable security definer as $$ select public.has_role('admin') $$;
create function public.can_edit() returns boolean language sql stable security definer as $$ select public.has_role('admin','coach') $$;
create function public.can_manage_videos() returns boolean language sql stable security definer as $$ select public.has_role('admin','coach') $$;
create function public.can_manage_plans() returns boolean language sql stable security definer as $$ select public.has_role('admin','coach','prepa') $$;
create function public.is_staff() returns boolean language sql stable security definer as $$ select public.has_role('admin','coach','prepa','lecteur') $$;
alter table public.profiles enable row level security;
create policy profiles_read on public.profiles for select using (id = auth.uid() or (club_id = public.my_club_id() and public.is_club_admin()));

create table public.players (id bigint generated always as identity primary key, club_id bigint not null references public.clubs,
  nom text not null, prenom text, numero int, team_id bigint references public.teams);
insert into public.players (club_id, nom, team_id) values (1, 'ADAME', 1);
create table public.sessions (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade,
  created_by uuid, titre text not null, date_seance date not null default now(), team_id bigint references public.teams on delete set null,
  notes text, share_token text unique, equipes jsonb not null default '[]');
create table public.procedures (id bigint generated always as identity primary key, session_id bigint not null references public.sessions on delete cascade,
  ordre int default 1, nom text not null default 'Procédé', consignes text);
create table public.tactical_schemas (id bigint generated always as identity primary key, procedure_id bigint not null unique references public.procedures on delete cascade, image_path text);
create table public.attendance (id bigint generated always as identity primary key, player_id bigint not null references public.players on delete cascade,
  session_id bigint not null references public.sessions on delete cascade, present boolean default false, unique (player_id, session_id));
create table public.session_comments (id bigint generated always as identity primary key, session_id bigint not null references public.sessions on delete cascade,
  user_id uuid, author text, body text not null, created_at timestamptz default now());
alter table public.sessions enable row level security;
alter table public.players enable row level security;
create policy players_read on public.players for select using (club_id = public.my_club_id());
alter table public.procedures enable row level security;
alter table public.tactical_schemas enable row level security;
alter table public.attendance enable row level security;
alter table public.session_comments enable row level security;
grant usage on schema auth to authenticated;
grant select on public.sim, public.teams, public.clubs to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.sessions, public.players, public.procedures, public.tactical_schemas,
  public.attendance, public.session_comments to authenticated;
`);
  for (const f of ['lmfc_v5.sql', 'lmfc_v9.sql', 'lmfc_v10.sql']) await db.exec(read(f));
  // Réglages nominatifs des séances (lmfc_v14.sql : profils lisibles par l'admin seul).
  const v14 = read('lmfc_v14.sql');
  await db.exec(fnFrom('lmfc_v14.sql', 'staff_can_receive'));
  await db.exec(v14.slice(v14.indexOf('drop policy if exists session_access_write'), v14.lastIndexOf('commit;')));
  // Fonctions telles qu'en production depuis lmfc_v22.sql.
  for (const name of ['is_lecteur', 'team_level', 'session_level']) await db.exec(fnFrom('lmfc_v22.sql', name));
  for (const f of ['lmfc_v24.sql', 'lmfc_v24.sql', 'lmfc_v25.sql', 'lmfc_v25.sql']) await db.exec(read(f));
  await db.exec(`grant usage on all sequences in schema public to authenticated;
    grant select, insert, update, delete on public.session_bilans, public.session_access to authenticated;`);

  const as = async (uid, fn) => {
    await q('update public.sim set uid = $1', [uid]);
    await db.exec('set role authenticated');
    try { return await fn(); } finally { await db.exec('reset role'); await q('update public.sim set uid = null'); }
  };
  const rows = (uid, sql, p) => as(uid, async () => (await q(sql, p)).rows);
  const one = async (uid, sql, p) => (await rows(uid, sql, p))[0];
  const ko = (uid, sql, p, re, why) => assert.rejects(as(uid, () => q(sql, p)), re, why);
  let stamp = 1000;
  // Fichier envoyé par uid (ligne library_files), empreinte facultative.
  const file = async (uid, sha = null) => (await one(uid, `insert into public.library_files (club_id, storage_path, sha256)
    values (public.my_club_id(), 'r2/' || public.my_club_id() || '/lib/' || $1 || '.mp4', $2) returning id`, [stamp++, sha])).id;
  // Procédé créé par uid : titre + vidéo suffisent.
  const item = async (uid, titre, tags = []) => {
    const f = await file(uid);
    return (await one(uid, 'select public.library_create_item($1, $2, null, null, $3) as id', [titre, f, tags])).id;
  };
  const visible = async (uid) => (await rows(uid, 'select id from public.library_items order by id')).map(r => Number(r.id));
  const level = async (uid, id) => (await one(uid, 'select public.library_level($1) as l', [id])).l;
  return { db, q, as, rows, one, ko, file, item, visible, level };
}
