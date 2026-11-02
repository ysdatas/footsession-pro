/* Avis des joueurs après le match (supabase/lmfc_v36.sql) sur un vrai
   Postgres (PGlite), RLS active : le joueur répond pour un match passé qui
   le concerne (son équipe, la feuille de match), le reprend quand il veut ;
   ni match à venir, ni match d'une autre équipe, ni compte staff, ni
   écriture directe ; qui lit (le joueur les siennes, le staff qui suit le
   joueur et lit le match, jamais le lecteur ni un autre joueur) ;
   corbeille avec le match. Migration passée deux fois.
   Lancement : PGlite installé hors du projet, relié en node_modules,
   puis node tests/match-feedback-sql.test.mjs (sans PGlite : échec). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { libraryDb, USERS } from './library-db.mjs';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.error('match-feedback-sql : PGlite absent, test NON lancé');
  process.exit(1);
}
const { ADMIN, N2, U19, PREPA, SCOUT, JOUEUR } = USERS;
const J2 = '00000000-0000-0000-0000-000000000099';
const { db, q, rows, one, ko } = await libraryDb(PGlite);
const read = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8');
const fn = (file, name) => { const s = read(file), a = s.indexOf(`create or replace function public.${name}(`); return s.slice(a, s.indexOf('\n$$;', a) + 4); };
const DENIED = /permission denied|row-level security/;

// Deux joueurs N2 avec un compte, niveaux d'accès (lmfc_v19/v22), matchs (lmfc_v11) avec
// leurs règles par équipe (lmfc_v19), puis v36 deux fois.
await db.exec(`alter table public.players add column auth_user_id uuid, add column other_team_ids bigint[] not null default '{}';
  insert into auth.users values ('${J2}'); insert into public.profiles (id, club_id, role, nom) values ('${J2}', 1, 'joueur', 'Joueur 2');
  update public.players set auth_user_id = '${JOUEUR}' where id = 1;
  insert into public.players (club_id, nom, team_id, auth_user_id) values (1, 'BARAKAT', 1, '${J2}');
  create table public.staff_player_access (profile_id uuid, player_id bigint, niveau text);
  ${fn('lmfc_v22.sql', 'player_level_for')}
  ${fn('lmfc_v19.sql', 'player_level')}`);
await db.exec(read('lmfc_v11.sql'));
const v19 = read('lmfc_v19.sql');
await db.exec(v19.slice(v19.indexOf('drop policy if exists matches_read'), v19.indexOf('drop policy if exists match_players_write')));
for (const f of ['lmfc_v36.sql', 'lmfc_v36.sql']) await db.exec(read(f));
await db.exec('grant usage on all sequences in schema public to authenticated;');
const match = async (team, days) => Number((await q(`insert into public.matches (club_id, team_id, adversaire, date_match, created_by)
  values (1, $1, 'ADVERSAIRE', current_date + $2::int, $3) returning id`, [team, days, ADMIN])).rows[0].id);
const set = (uid, m, a, b) => one(uid, 'select public.match_feedback_set($1, $2, $3) r', [m, a, b]);
const M1 = await match(1, -2);   // N2, joué
const MF = await match(1, 3);    // N2, à venir
const MU = await match(2, -1);   // U19, joué : pas l'équipe du joueur
const MS = await match(2, -5);   // U19, joué, le joueur sur la feuille de match

/* ---------- 1. Réponses ---------- */
assert.deepEqual((await set(JOUEUR, M1, '  Des duels gagnés. ', '')).r, { individuel: 'Des duels gagnés.', collectif: null }, 'espaces retirés, réponse vide = rien');
assert.deepEqual((await set(JOUEUR, M1, 'Des duels gagnés, des passes ratées.', 'Bloc compact.')).r,
  { individuel: 'Des duels gagnés, des passes ratées.', collectif: 'Bloc compact.' }, 'il complète');
assert.equal((await one(ADMIN, 'select count(*)::int n from public.match_feedback where player_id = 1 and match_id = $1', [M1])).n, 1, 'même ligne');
await ko(JOUEUR, 'select public.match_feedback_set($1, $2, $3)', [MF, 'x', null], /pas encore eu lieu/, 'match à venir');
await ko(JOUEUR, 'select public.match_feedback_set($1, $2, $3)', [MU, 'x', null], /Match introuvable/, 'match d’une autre équipe');
await q(`insert into public.match_players (club_id, match_id, player_id, statut) values (1, $1, 1, 'remplacant')`, [MS]);
assert.equal((await set(JOUEUR, MS, 'Entré à la 60e.', null)).r.individuel, 'Entré à la 60e.', 'autre équipe, mais sur la feuille de match');
await ko(JOUEUR, 'select public.match_feedback_set($1, $2, $3)', [M1, 'x'.repeat(2001), null], /2 000 caractères/, 'trop long');
await ko(ADMIN, 'select public.match_feedback_set($1, $2, $3)', [M1, 'x', null], /réservé aux joueurs/, 'un compte staff ne répond pas');
await ko(JOUEUR, `insert into public.match_feedback (club_id, match_id, player_id, individuel) values (1, ${M1}, 2, 'faux')`, [], DENIED, 'aucune écriture directe');
await ko(JOUEUR, `update public.match_feedback set collectif = 'x'`, [], DENIED, 'ni modification directe');

/* ---------- 2. Qui lit ---------- */
await set(J2, M1, 'Moyen.', 'Bonne intensité.');
const seen = async (uid) => (await rows(uid, 'select player_id, match_id from public.match_feedback order by player_id, match_id'))
  .map(r => `${r.player_id}:${r.match_id}`);
assert.deepEqual(await seen(JOUEUR), [`1:${M1}`, `1:${MS}`], 'le joueur : les siennes');
assert.deepEqual(await seen(J2), [`2:${M1}`], 'l’autre joueur : les siennes, jamais celles du premier');
assert.deepEqual(await seen(ADMIN), [`1:${M1}`, `1:${MS}`, `2:${M1}`], 'admin : toutes');
assert.deepEqual(await seen(N2), [`1:${M1}`, `2:${M1}`], 'coach N2 : ses joueurs, sur les matchs qu’il lit');
assert.deepEqual(await seen(PREPA), [`1:${M1}`, `2:${M1}`], 'prépa N2 : idem');
assert.deepEqual(await seen(U19), [], 'coach U19 : lit le match U19, mais ne suit pas ce joueur');
assert.deepEqual(await seen(SCOUT), [], 'lecteur : rien');

/* ---------- 3. Corbeille : l'avis revient avec son match ---------- */
assert.equal((await rows(ADMIN, 'delete from public.matches where id = $1 returning id', [M1])).length, 1);
assert.equal((await one(ADMIN, 'select count(*)::int n from public.match_feedback where match_id = $1', [M1])).n, 0, 'parti avec le match');
const root = (await one(ADMIN, `select id from public.trash where tbl = 'matches' and row_id = $1`, [M1])).id;
assert.equal((await one(ADMIN, `select count(*)::int n from public.trash where root_id = $1 and tbl = 'match_feedback'`, [root])).n, 2, 'dans la corbeille avec lui');
await one(ADMIN, 'select public.trash_restore($1)', [[root]]);
assert.deepEqual((await rows(ADMIN, 'select individuel from public.match_feedback where match_id = $1 order by player_id', [M1])).map(r => r.individuel),
  ['Des duels gagnés, des passes ratées.', 'Moyen.'], 'restauré avec le match');

/* ---------- 4. Règles lecteur, anonyme ---------- */
assert.deepEqual((await rows(ADMIN, `select policyname from pg_policies where tablename = 'match_feedback' and permissive = 'RESTRICTIVE' order by 1`))
  .map(r => r.policyname), ['lecteur_no_delete', 'lecteur_no_insert', 'lecteur_no_update'], 'règles lecteur');
assert.equal((await q(`select has_function_privilege('anon', 'public.match_feedback_set(bigint, text, text)', 'execute') a`)).rows[0].a, false);
assert.equal((await q(`select has_function_privilege('authenticated', 'public.player_match_ok(bigint, bigint)', 'execute') a`)).rows[0].a, false, 'fonction interne');

console.log('match-feedback-sql : OK (réponses, match passé qui le concerne, confidentialité, corbeille, lecteur)');
