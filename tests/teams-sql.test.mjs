/* Profils, équipes et visibilité (supabase/lmfc_v7.sql) sur un vrai
   Postgres (PGlite, WASM) : schéma réduit, rôles simulés, requêtes
   faites comme depuis le site (rôle « authenticated », RLS active).
   Lancement : npm i --no-save @electric-sql/pglite && node tests/teams-sql.test.mjs
   (sans PGlite installé, le test est ignoré). */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.log('teams-sql : ignoré (npm i --no-save @electric-sql/pglite pour le lancer)');
  process.exit(0);
}
const SQL_V7 = readFileSync(new URL('../supabase/lmfc_v7.sql', import.meta.url), 'utf8');

const ADMIN = '00000000-0000-0000-0000-000000000001';
const COACH = '00000000-0000-0000-0000-000000000002';
const PREPA = '00000000-0000-0000-0000-000000000003';
const JOUEUR = '00000000-0000-0000-0000-000000000004';
const db = new PGlite();
const one = async (s, p) => (await db.query(s, p)).rows[0];

await db.exec(`
create role anon; create role authenticated;
create schema auth;
create table public.sim (uid uuid);
insert into public.sim values ('${ADMIN}');
create function auth.uid() returns uuid language sql stable as $$ select uid from public.sim $$;
create table public.clubs (id bigint generated always as identity primary key, nom text);
insert into public.clubs (nom) values ('LMFC'), ('Autre');
create table public.teams (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, nom text not null);
insert into public.teams (club_id, nom) values (1, 'N2'), (1, 'U19'), (2, 'Ailleurs');
create table public.profiles (id uuid primary key, club_id bigint references public.clubs, role text, prefs jsonb default '{}');
insert into public.profiles values ('${ADMIN}', 1, 'admin'), ('${COACH}', 1, 'coach'), ('${PREPA}', 1, 'prepa'), ('${JOUEUR}', 1, 'joueur');
create table public.players (id bigint generated always as identity primary key, club_id bigint not null references public.clubs, nom text,
  team_id bigint references public.teams on delete set null);
insert into public.players (club_id, nom, team_id) values (1, 'Adame', 1), (2, 'Étranger', 3);

create function public.my_club_id() returns bigint language sql stable security definer set search_path = public as $$
  select club_id from public.profiles where id = auth.uid() $$;
create function public.can_manage_plans() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'coach', 'prepa')) $$;
create function public.is_club_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;
-- Comme les fonctions du serveur (create_club, claim_club_access…) : propriétaire, droits étendus.
create function public.rpc_set_my_role(p text) returns void language sql security definer set search_path = public as $$
  update public.profiles set role = p where id = auth.uid() $$;

alter table public.profiles enable row level security;
create policy profiles_read  on public.profiles for select using (club_id = public.my_club_id() or id = auth.uid());
create policy profiles_self  on public.profiles for update using (id = auth.uid());
create policy profiles_admin on public.profiles for update using (club_id = public.my_club_id() and public.is_club_admin());
alter table public.teams enable row level security;
create policy teams_read on public.teams for select using (club_id = public.my_club_id());
alter table public.players enable row level security;
create policy players_read on public.players for select using (club_id = public.my_club_id());
create policy players_update on public.players for update using (club_id = public.my_club_id());
grant usage on schema auth to authenticated;
grant select, update on public.profiles, public.players to authenticated;
grant select on public.teams, public.sim to authenticated;
`);

const as = async (uid, fn) => {
  await db.query('update public.sim set uid = $1', [uid]);
  await db.exec('set role authenticated');
  try { return await fn(); } finally { await db.exec('reset role'); }
};

await db.exec(SQL_V7);
await db.exec(SQL_V7);   // rejouable

// 1) Un compte ne se promeut pas lui-même, ne change ni de club ni d'équipe.
await as(JOUEUR, () => db.query(`update public.profiles set role = 'admin', club_id = 2, team_id = 1, prefs = '{"x":1}' where id = auth.uid()`));
assert.deepEqual(await one(`select role, club_id, team_id, prefs from public.profiles where id = $1`, [JOUEUR]),
  { role: 'joueur', club_id: 1, team_id: null, prefs: { x: 1 } }, 'auto-promotion bloquée, préférences enregistrées');
await as(COACH, () => db.query(`update public.profiles set team_id = 2 where id = auth.uid()`));
assert.equal((await one(`select team_id from public.profiles where id = $1`, [COACH])).team_id, null, 'le coach ne choisit pas son équipe');

// 2) Les fonctions du serveur gardent la main sur le profil de l'appelant.
await as(PREPA, () => db.query(`select public.rpc_set_my_role('coach')`));
assert.equal((await one(`select role from public.profiles where id = $1`, [PREPA])).role, 'coach', 'RPC du serveur autorisée');
await db.query(`update public.profiles set role = 'prepa' where id = $1`, [PREPA]);

// 3) L'administrateur rattache un membre à une équipe de SON club.
await as(ADMIN, () => db.query(`update public.profiles set team_id = 1 where id = $1`, [COACH]));
assert.equal((await one(`select team_id from public.profiles where id = $1`, [COACH])).team_id, 1, 'coach rattaché à N2');
await assert.rejects(as(ADMIN, () => db.query(`update public.profiles set team_id = 3 where id = $1`, [COACH])),
  /Équipe inconnue/, 'équipe d’un autre club refusée');
await db.query(`delete from public.teams where id = 1`);
assert.equal((await one(`select team_id from public.profiles where id = $1`, [COACH])).team_id, null, 'équipe supprimée : toutes les équipes');
await db.query(`insert into public.teams (id, club_id, nom) overriding system value values (1, 1, 'N2')`);
await db.query(`update public.players set team_id = 1 where id = 1`);   // la suppression l'avait vidée

// 4) Autres équipes : celles du club seulement, sans doublon ni l'équipe principale.
await as(COACH, () => db.query(`update public.players set other_team_ids = '{2,1,2,3,999}' where id = 1`));
assert.deepEqual((await one(`select other_team_ids from public.players where id = 1`)).other_team_ids, [2], 'U19 seule retenue');

// 5) Ce que voit le joueur : staff du club seulement, rubriques connues seulement.
assert.equal((await as(PREPA, () => one(`select public.set_player_hidden_sections('{1,2}', '{tests,suivi,tests}') n`))).n, 1,
  'le préparateur règle son club, pas l’autre');
assert.deepEqual((await one(`select hidden_sections from public.players where id = 1`)).hidden_sections, ['suivi', 'tests']);
assert.deepEqual((await one(`select hidden_sections from public.players where id = 2`)).hidden_sections, [], 'autre club intact');
await assert.rejects(as(JOUEUR, () => db.query(`select public.set_player_hidden_sections('{1}', '{}')`)), /Réservé/, 'refusé au joueur');
await assert.rejects(as(ADMIN, () => db.query(`select public.set_player_hidden_sections('{1}', '{photo}')`)), /hidden_sections_check/, 'rubrique inconnue refusée');

console.log('teams-sql : OK (5 scénarios)');
