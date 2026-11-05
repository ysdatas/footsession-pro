/* Base de test complète : un vrai Postgres (PGlite, WASM) sur lequel passent
   TOUTES les migrations réelles, dans l'ordre du README, avec ce que Supabase
   apporte (rôles anon et authenticated, droits par défaut, schémas auth et
   storage). Les autres tests *-sql recréent à la main les fonctions de rôle :
   ici, rien n'est recopié, un écart entre le test et la production se voit.
   Utilisée par access-matrix-sql.test.mjs et v39-sql.test.mjs.
   PGlite s'installe hors du projet (CLAUDE.md, « Tests »). */
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/* Migrations dans l'ordre d'exécution : la liste du README fait foi. */
export function migrations() {
  const readme = read('README.md'), start = readme.indexOf('## 🗄 Migrations Supabase');
  const block = readme.slice(readme.indexOf('```', start) + 3, readme.indexOf('```', readme.indexOf('```', start) + 3));
  return [...block.matchAll(/^\s*\d+\.\s+supabase\/([\w.-]+\.sql)/gm)].map(m => m[1]);
}
export const sqlFile = (name) => read(`supabase/${name}`);

const SUPABASE = `
create role anon; create role authenticated; create role service_role;
create schema auth; create schema storage;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}',
  created_at timestamptz default now(), email_confirmed_at timestamptz, last_sign_in_at timestamptz);
create table public.sim (uid uuid);
insert into public.sim values (null);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.sim $$;
create function auth.role() returns text language sql stable as
  $$ select case when (select uid from public.sim) is null then 'anon' else 'authenticated' end $$;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint,
  allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text,
  owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.objects enable row level security;
grant usage on schema auth, storage, public to authenticated, anon, service_role;
grant select on public.sim to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, anon;
grant select on storage.buckets to authenticated, anon;
`;

/* Base à l'état de la migration until (comprise), ou de la dernière. */
export async function fullDb({ PGlite, pgcrypto, pg_trgm, unaccent }, { until = null } = {}) {
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm, unaccent } });
  await db.exec(SUPABASE);
  await db.exec('create extension if not exists pgcrypto; create extension if not exists pg_trgm; create extension if not exists unaccent;');
  const list = migrations(), end = until ? list.indexOf(until) + 1 : list.length;
  if (until && !end) throw new Error(`${until} absente du README`);
  for (const file of list.slice(0, end)) {
    try { await db.exec(sqlFile(file)); } catch (e) { throw new Error(`${file} : ${e.message}`); }
  }
  const rest = list.slice(end);
  return { db, rest };
}

/* Comptes du club LMFC et d'un autre club. */
const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
export const P = {
  admin: U(1), coachPro: U(2), coachU17: U(3), coachEsp: U(4), coachU14: U(5), coachDeux: U(6), coachSans: U(7), prepaPro: U(8), prepaU14: U(9),
  lecteur: U(10), lecteurU17: U(11), joueurPro: U(12), joueurU14: U(13), adminB: U(14), sansClub: U(15), lectureClub: U(16),
};
/* Équipes : 1 Pro, 2 N2, 3 Espoirs, 4 U17, 5 U14, 6 l'autre club.
   Joueurs : 1 Pro, 2 U17 + Espoirs, 3 sans équipe, 4 U14 (mineure), 5 autre club, 6 N2. */
export const T = { pro: 1, n2: 2, espoirs: 3, u17: 4, u14: 5, autre: 6 };
export const J = { pro: 1, mixte: 2, sans: 3, mineure: 4, autre: 5, n2: 6 };

export async function seed(db) {
  // En deux temps : la garde des profils vide les équipes d'un compte qui change de club.
  const profile = (who, role, teams, club = 1) => `update public.profiles set club_id = ${club}, role = '${role}' where id = '${who}';
    update public.profiles set team_ids = '{${teams.join(',')}}' where id = '${who}';`;
  await db.exec(`
insert into public.clubs (nom, join_code) values ('LMFC', 'AAAA'), ('Autre', 'BBBB');
insert into public.teams (club_id, nom) values (1, 'Pro'), (1, 'N2'), (1, 'Espoirs'), (1, 'U17'), (1, 'U14'), (2, 'X');
insert into auth.users (id, email, email_confirmed_at) select u, u::text || '@test.fr', now() from unnest(array[${Object.values(P).map(x => `'${x}'`).join(',')}]::uuid[]) u;
${profile(P.admin, 'admin', [])}
${profile(P.coachPro, 'coach', [1])} ${profile(P.coachU17, 'coach', [4])} ${profile(P.coachEsp, 'coach', [3])} ${profile(P.coachU14, 'coach', [5])}
${profile(P.coachDeux, 'coach', [3, 4])} ${profile(P.coachSans, 'coach', [])} ${profile(P.prepaPro, 'prepa', [1])} ${profile(P.prepaU14, 'prepa', [5])}
${profile(P.lecteur, 'lecteur', [])} ${profile(P.lecteurU17, 'lecteur', [4])} ${profile(P.joueurPro, 'joueur', [])} ${profile(P.joueurU14, 'joueur', [])}
${profile(P.adminB, 'admin', [], 2)} ${profile(P.lectureClub, 'coach', [])}
update public.profiles set lecture_club = true where id = '${P.lectureClub}';
update public.profiles set club_id = null, role = 'coach' where id = '${P.sansClub}';
insert into public.players (club_id, nom, prenom, team_id, other_team_ids, auth_user_id, date_naissance) values
 (1, 'PRO', 'Paul', 1, '{}', '${P.joueurPro}', '1998-01-01'), (1, 'MIXTE', 'Max', 4, '{3}', null, '2009-01-01'),
 (1, 'SANSEQUIPE', 'Sam', null, '{}', null, '2012-01-01'), (1, 'MINEURE', 'Mina', 5, '{}', '${P.joueurU14}', '2012-05-01'),
 (2, 'AUTRE', 'Club', 6, '{}', null, null), (1, 'REGION', 'Nina', 2, '{}', null, '2003-01-01');
`);
}

/* Agit comme ce compte (uid), sous le rôle de l'API : RLS active. null : anonyme. */
export function actor(db) {
  return async function as(uid, fn) {
    await db.exec(`reset role; update public.sim set uid = ${uid ? `'${uid}'` : 'null'}; set role ${uid ? 'authenticated' : 'anon'};`);
    try { return await fn(); } finally { await db.exec('reset role; update public.sim set uid = null;'); }
  };
}

/* Tout ce que les migrations définissent : sert à vérifier qu'un retour arrière
   rend exactement l'état de départ. */
export async function catalog(db) {
  const rows = async (s) => (await db.query(s)).rows;
  return {
    policies: await rows(`select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies order by 1, 2, 3`),
    functions: await rows(`select p.proname, pg_get_function_identity_arguments(p.oid) args, pg_get_functiondef(p.oid) def,
        (select array_agg(a::text order by a::text) from unnest(p.proacl) a) acl
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' order by 1, 2`),
    triggers: await rows(`select c.relname, g.tgname, pg_get_triggerdef(g.oid) def, g.tgenabled from pg_trigger g join pg_class c on c.oid = g.tgrelid
      where not g.tgisinternal order by 1, 2`),
    columns: await rows(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' order by 1, 2`),
    constraints: await rows(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`),
    tables: await rows(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`),
  };
}
