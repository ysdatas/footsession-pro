/* Retours de match (supabase/lmfc_v11.sql) sur un vrai Postgres (PGlite,
   WASM), RLS active : le staff lit, admin et coachs écrivent, le joueur
   ne voit rien ; club vérifié ; corbeille avec les joueurs du match.
   Lancement : npm i --no-save @electric-sql/pglite && node tests/matches-sql.test.mjs
   (sans PGlite installé, le test est ignoré). */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.log('matches-sql : ignoré (npm i --no-save @electric-sql/pglite pour le lancer)');
  process.exit(0);
}
const read = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8');
const U = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const ADMIN = U(1), COACH = U(2), PREPA = U(3), JOUEUR = U(4);
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
create table public.teams (id bigint generated always as identity primary key, club_id bigint not null references public.clubs, nom text not null);
insert into public.teams (club_id, nom) values (1, 'N2'), (2, 'Ailleurs');
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
create table public.players (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade, nom text not null);
insert into public.players (club_id, nom) values (1, 'ADAME'), (1, 'BARAKAT'), (2, 'ÉTRANGER');
-- Tables de séance minimales : lmfc_v9.sql (restauration générique de la corbeille) s'y applique.
create table public.sessions (id bigint generated always as identity primary key, club_id bigint not null references public.clubs on delete cascade,
  titre text not null default 'Séance', notes text, share_token text, equipes jsonb not null default '[]');
create table public.procedures (id bigint generated always as identity primary key, session_id bigint not null references public.sessions on delete cascade, ordre int default 1, nom text);
create table public.tactical_schemas (id bigint generated always as identity primary key, procedure_id bigint not null references public.procedures on delete cascade, image_path text);
create table public.attendance (id bigint generated always as identity primary key, player_id bigint not null references public.players on delete cascade,
  session_id bigint not null references public.sessions on delete cascade, present boolean, unique (player_id, session_id));
create table public.session_comments (id bigint generated always as identity primary key, session_id bigint not null references public.sessions on delete cascade,
  author text, body text not null, created_at timestamptz default now());
alter table public.players add column prenom text, add column numero int;
alter table public.players enable row level security;
create policy players_read on public.players for select using (club_id = public.my_club_id());
grant usage on schema auth to authenticated;
grant select on public.sim, public.profiles, public.teams, public.players to authenticated;
`);
await db.exec(read('lmfc_v5.sql'));
await db.exec(read('lmfc_v9.sql'));
await db.exec(read('lmfc_v11.sql'));
await db.exec(read('lmfc_v11.sql'));   // rejouable
await db.exec(`grant usage on all sequences in schema public to authenticated;`);

const as = async (uid, fn) => {
  await q('update public.sim set uid = $1, role = $2', [uid, ROLES[uid]]);
  await db.exec('set role authenticated');
  try { return await fn(); } finally { await db.exec('reset role'); await q('update public.sim set uid = $1, role = $2', [ADMIN, 'admin']); }
};

// 1) Le coach enregistre un match et ses joueurs.
const m = await as(COACH, () => one(`insert into public.matches (club_id, team_id, adversaire, date_match, competition, lieu, score_pour, score_contre, commentaire)
  values (1, 1, 'FC Nantes B', '2026-10-04', 'N2', 'domicile', 2, 1, 'Bonne seconde période') returning id, created_by`));
assert.equal(m.created_by, COACH);
await as(COACH, () => q(`insert into public.match_players (club_id, match_id, player_id, statut, minutes, buts, passes, note, commentaire)
  values (1, $1, 1, 'titulaire', 90, 1, 0, 'plus', 'Très présent dans les duels'), (1, $1, 2, 'remplacant', 25, 0, 1, 'egal', null)`, [m.id]));

// 2) Lecture : le staff (préparateur compris) ; jamais le joueur.
assert.equal((await as(PREPA, () => q(`select * from public.match_players`))).rows.length, 2, 'le préparateur lit');
assert.equal((await as(JOUEUR, () => q(`select * from public.matches`))).rows.length, 0, 'le joueur ne voit rien');
await assert.rejects(as(PREPA, () => q(`update public.matches set score_pour = 3 returning id`)).then(r => { if (!r.rows.length) throw new Error('row-level security : rien modifié'); }),
  /row-level security/, 'le préparateur ne modifie pas');

// 3) Club vérifié : équipe, joueur d'un autre club refusés ; valeurs bornées.
await assert.rejects(as(COACH, () => q(`insert into public.matches (club_id, team_id, adversaire, date_match) values (1, 2, 'X', '2026-10-05')`)), /row-level security/, 'équipe d’un autre club');
await assert.rejects(as(COACH, () => q(`insert into public.match_players (club_id, match_id, player_id) values (1, $1, 3)`, [m.id])), /row-level security/, 'joueur d’un autre club');
await assert.rejects(q(`update public.match_players set note = 'bof' where player_id = 1`), /check/, 'note inconnue');
await assert.rejects(q(`update public.match_players set minutes = 200 where player_id = 1`), /check/, 'minutes bornées');
await assert.rejects(q(`insert into public.matches (club_id, adversaire, date_match) values (1, '  ', '2026-10-05')`), /check/, 'adversaire obligatoire');

// 4) Historique d'un joueur : ses matchs, du plus récent au plus ancien.
await as(COACH, async () => {
  const m2 = await one(`insert into public.matches (club_id, team_id, adversaire, date_match, score_pour, score_contre) values (1, 1, 'Stade Briochin', '2026-10-11', 0, 0) returning id`);
  await q(`insert into public.match_players (club_id, match_id, player_id, statut, minutes, note) values (1, $1, 1, 'titulaire', 80, 'moins')`, [m2.id]);
});
const hist = (await as(PREPA, () => q(`select m.adversaire, mp.note from public.match_players mp join public.matches m on m.id = mp.match_id
  where mp.player_id = 1 order by m.date_match desc`))).rows.map(r => `${r.adversaire}:${r.note}`);
assert.deepEqual(hist, ['Stade Briochin:moins', 'FC Nantes B:plus'], 'historique du joueur');

// 5) Corbeille : le match revient avec ses joueurs.
await as(COACH, () => q(`delete from public.matches where id = $1`, [m.id]));
assert.equal(Number((await one(`select count(*) n from public.match_players where match_id = $1`, [m.id])).n), 0);
const root = await as(COACH, () => one(`select id from public.trash where tbl = 'matches' and root_id is null`));
assert.ok(root, 'match visible dans la corbeille du coach');
await as(COACH, () => q(`select public.trash_restore($1)`, [[root.id]]));
assert.equal(Number((await one(`select count(*) n from public.match_players where match_id = $1`, [m.id])).n), 2, 'joueurs restaurés');

console.log('matches-sql : OK (5 scénarios)');
