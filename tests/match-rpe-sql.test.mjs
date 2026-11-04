/* RPE après le match (supabase/lmfc_v38.sql) sur un vrai Postgres (PGlite),
   RLS active : qui note (sans feuille le groupe, avec feuille ceux qui ont
   joué), délai J+14, une seule réponse, correction du staff, qui lit,
   my_rpe_matches, rpe_history (séances et matchs, droits), corbeille,
   règles lecteur. Migration passée deux fois.
   Lancement : PGlite installé hors du projet, relié en node_modules,
   puis node tests/match-rpe-sql.test.mjs (sans PGlite : échec). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { libraryDb, USERS } from './library-db.mjs';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.error('match-rpe-sql : PGlite absent, test NON lancé');
  process.exit(1);
}
const { ADMIN, N2, U19, PREPA, SCOUT, JOUEUR, AUTRE } = USERS;
const J2 = '00000000-0000-0000-0000-000000000099';
const { db, q, rows, one, ko } = await libraryDb(PGlite);
const read = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8');
const fn = (file, name) => { const s = read(file), a = s.indexOf(`create or replace function public.${name}(`); return s.slice(a, s.indexOf('\n$$;', a) + 4); };
const DENIED = /permission denied|row-level security/;

// Deux joueurs N2 avec un compte, niveaux d'accès (lmfc_v19/v22), matchs et leurs règles par équipe
// (lmfc_v11, v19), RPE et calendrier (v27 à v37), puis v38 deux fois.
await db.exec(`alter table public.players add column auth_user_id uuid, add column other_team_ids bigint[] not null default '{}';
  insert into auth.users values ('${J2}'); insert into public.profiles (id, club_id, role, nom) values ('${J2}', 1, 'joueur', 'Joueur 2');
  update public.players set auth_user_id = '${JOUEUR}' where id = 1;
  insert into public.players (club_id, nom, team_id, auth_user_id) values (1, 'BARAKAT', 1, '${J2}');
  create table public.staff_player_access (profile_id uuid, player_id bigint, niveau text);
  ${fn('lmfc_v22.sql', 'player_level_for')}
  ${fn('lmfc_v19.sql', 'player_level')}
  create table public.exercise_templates (id bigint generated always as identity primary key, club_id bigint not null, created_by uuid, nom text);`);
await db.exec(read('lmfc_v11.sql'));
const v19 = read('lmfc_v19.sql');
await db.exec(v19.slice(v19.indexOf('drop policy if exists matches_read'), v19.indexOf('drop policy if exists match_players_write')));
for (const f of ['lmfc_v27.sql', 'lmfc_v28.sql', 'lmfc_v29.sql', 'lmfc_v30.sql', 'lmfc_v36.sql', 'lmfc_v37.sql', 'lmfc_v38.sql', 'lmfc_v38.sql']) await db.exec(read(f));
await db.exec('grant usage on all sequences in schema public to authenticated;');

const match = async (team, days, heure = null) => Number((await q(`insert into public.matches (club_id, team_id, adversaire, date_match, heure, created_by)
  values (1, $1, 'ADVERSAIRE', current_date + $2::int, $3, $4) returning id`, [team, days, heure, ADMIN])).rows[0].id);
const sheet = (m, player, statut, minutes = null) => q(`insert into public.match_players (club_id, match_id, player_id, statut, minutes) values (1, $1, $2, $3, $4)`, [m, player, statut, minutes]);
const set = (uid, m, v, p = null) => one(uid, 'select public.match_rpe_set($1, $2, $3) r', [m, v, p]);
const NOT_MINE = /ne te concerne pas/;

/* ---------- 1. Qui note ---------- */
const SANS = await match(1, -2);                // N2, pas de feuille : tout le groupe
assert.deepEqual((await set(JOUEUR, SANS, 7)).r, { rpe: 7, corrige: false }, 'sans feuille : le joueur du groupe note');
assert.equal((await set(J2, SANS, 6)).r.rpe, 6, 'sans feuille : l’autre aussi');

const FEUILLE = await match(1, -3);             // N2, feuille remplie
await sheet(FEUILLE, 1, 'titulaire', 90);
await sheet(FEUILLE, 2, 'non_entre');
assert.equal((await set(JOUEUR, FEUILLE, 8)).r.rpe, 8, 'sur la feuille, il a joué : il note');
await ko(J2, 'select public.match_rpe_set($1, $2)', [FEUILLE, 5], NOT_MINE, 'non entré : il ne note pas');

const HORS = await match(1, -4);                // le joueur 1 n'est pas sur la feuille
await sheet(HORS, 2, 'titulaire', 70);
await ko(JOUEUR, 'select public.match_rpe_set($1, $2)', [HORS, 5], NOT_MINE, 'hors de la feuille : il ne note pas');

const ZERO = await match(1, -5);                // minutes à zéro : il n'a pas joué, quel que soit le statut
await sheet(ZERO, 1, 'remplacant', 0);
await sheet(ZERO, 2, 'titulaire');
await ko(JOUEUR, 'select public.match_rpe_set($1, $2)', [ZERO, 5], NOT_MINE, 'zéro minute : il ne note pas');
assert.equal((await set(J2, ZERO, 5)).r.rpe, 5, 'titulaire sans minutes renseignées : il note');

const VIDE = await match(1, -6);                // feuille commencée, statut et minutes vides
await sheet(VIDE, 1, null);
assert.equal((await set(JOUEUR, VIDE, 4)).r.rpe, 4, 'sur la feuille, rien de renseigné : il note');
await ko(J2, 'select public.match_rpe_set($1, $2)', [VIDE, 4], NOT_MINE, 'feuille commencée sans lui : il ne note pas');

const AUTRE_EQUIPE = await match(2, -1);        // U19 : pas son équipe
await ko(JOUEUR, 'select public.match_rpe_set($1, $2)', [AUTRE_EQUIPE, 5], NOT_MINE, 'autre équipe, sans feuille : non');
const RENFORT = await match(2, -7);             // U19, mais sur la feuille
await sheet(RENFORT, 1, 'remplacant', 20);
assert.equal((await set(JOUEUR, RENFORT, 6)).r.rpe, 6, 'autre équipe, mais il a joué : il note');
await ko(ADMIN, 'select public.match_rpe_set($1, $2)', [SANS, 5], NOT_MINE, 'un compte staff ne note pas pour lui-même');

/* ---------- 2. Délai, valeurs, réponse unique ---------- */
const J14 = await match(1, -14), J15 = await match(1, -15), DEMAIN = await match(1, 1);
assert.equal((await set(JOUEUR, J14, 3)).r.rpe, 3, 'J+14 : encore ouvert');
await ko(JOUEUR, 'select public.match_rpe_set($1, $2)', [J15, 3], /fermée/, 'J+15 : fermé');
await ko(JOUEUR, 'select public.match_rpe_set($1, $2)', [DEMAIN, 3], /fermée/, 'match à venir : fermé');
await ko(JOUEUR, 'select public.match_rpe_set($1, $2)', [SANS, 8], /déjà enregistré/, 'une seule réponse');
await ko(JOUEUR, 'select public.match_rpe_set($1, $2)', [SANS, null], /Choisis une valeur/, 'le joueur n’efface pas');
await ko(JOUEUR, 'select public.match_rpe_set($1, $2)', [SANS, 11], /de 1 à 10/, 'hors échelle');
await ko(JOUEUR, 'select public.match_rpe_set($1, $2, $3)', [SANS, 9, 1], /réservée/, 'il ne passe pas par la correction du staff');
await ko(JOUEUR, 'select public.match_rpe_set($1, $2, $3)', [SANS, 9, 2], /réservée/, 'ni pour un autre joueur');
await ko(AUTRE, 'select public.match_rpe_set($1, $2)', [SANS, 5], /introuvable/, 'autre club');
await ko(JOUEUR, `insert into public.match_rpe (club_id, match_id, player_id, rpe) values (1, ${HORS}, 1, 5)`, [], DENIED, 'aucune écriture directe');
await ko(JOUEUR, 'update public.match_rpe set rpe = 1', [], DENIED, 'ni modification');
await ko(JOUEUR, 'delete from public.match_rpe', [], DENIED, 'ni suppression');

/* ---------- 3. Correction du staff ---------- */
assert.deepEqual((await set(N2, SANS, 9, 1)).r, { rpe: 9, corrige: true }, 'coach de l’équipe : corrige, marqué');
assert.deepEqual((await set(PREPA, SANS, 8, 1)).r, { rpe: 8, corrige: true }, 'préparateur de l’équipe : corrige');
const row = (await q('select saisi_par, corrige_par from public.match_rpe where match_id = $1 and player_id = 1', [SANS])).rows[0];
assert.deepEqual([row.saisi_par, row.corrige_par], [JOUEUR, PREPA], 'saisie du joueur et correction du staff distinguées');
assert.deepEqual((await set(N2, FEUILLE, 5, 2)).r, { rpe: 5, corrige: true }, 'feuille fausse : le staff saisit pour le non-entré');
await ko(U19, 'select public.match_rpe_set($1, $2, $3)', [SANS, 5, 1], /réservée/, 'coach d’une autre équipe : refusé');
await ko(N2, 'select public.match_rpe_set($1, $2, $3)', [RENFORT, 5, 1], /réservée/, 'il suit le joueur, mais ne lit pas ce match U19');
await ko(U19, 'select public.match_rpe_set($1, $2, $3)', [RENFORT, 5, 1], /réservée/, 'il lit ce match U19, mais ne suit pas ce joueur');
await ko(SCOUT, 'select public.match_rpe_set($1, $2, $3)', [SANS, 5, 1], /réservée/, 'lecteur : refusé');
assert.equal((await one(ADMIN, 'select public.match_rpe_set($1, $2, $3) r', [J14, null, 1])).r, null, 'le staff efface');
assert.equal((await q('select count(*)::int n from public.match_rpe where match_id = $1', [J14])).rows[0].n, 0, 'effacé');
assert.equal((await set(JOUEUR, J14, 4)).r.rpe, 4, 'effacé par le staff : le joueur peut répondre à nouveau');

/* ---------- 4. Qui lit ---------- */
const seen = async (uid) => (await rows(uid, 'select match_id, player_id from public.match_rpe order by match_id, player_id')).map(r => `${r.match_id}/${r.player_id}`);
const j1 = [SANS, FEUILLE, VIDE, RENFORT, J14].sort((a, b) => a - b).map(m => `${m}/1`);
assert.deepEqual(await seen(JOUEUR), j1, 'le joueur : les siens');
assert.deepEqual(await seen(J2), [`${SANS}/2`, `${FEUILLE}/2`, `${ZERO}/2`].sort(), 'l’autre joueur : les siens, jamais ceux du premier');
assert.equal((await seen(ADMIN)).length, 8, 'admin : tous');
assert.ok(!(await seen(N2)).includes(`${RENFORT}/1`), 'coach N2 : pas le match U19 qu’il ne lit pas');
assert.equal((await seen(N2)).length, 7, 'coach N2 : ses joueurs sur ses matchs');
assert.deepEqual(await seen(PREPA), await seen(N2), 'préparateur N2 : idem');
assert.deepEqual(await seen(U19), [], 'coach U19 : lit le match, mais ne suit pas ces joueurs');
for (const who of [SCOUT, AUTRE]) assert.deepEqual(await seen(who), [], `${who} : rien`);

/* ---------- 5. my_rpe_matches : ce qu'il a à noter ---------- */
const AUJ = await match(1, 0, '15:00'), AUJ2 = await match(1, 0, '20:00');
const todo = await rows(JOUEUR, 'select * from public.my_rpe_matches()');
assert.deepEqual(todo.map(r => r.match_id).map(Number).slice(0, 2), [AUJ2, AUJ], 'du plus récent au plus ancien, l’heure départage');
assert.equal(todo[0].titre, 'Match contre ADVERSAIRE', 'un titre que le joueur reconnaît');
assert.equal(todo[0].heure, '20:00:00', 'avec l’heure');
assert.deepEqual(todo.filter(r => r.rpe === null).map(r => Number(r.match_id)), [AUJ2, AUJ], 'à noter : ceux sans réponse');
const listed = new Set(todo.map(r => Number(r.match_id)));
for (const m of [SANS, FEUILLE, VIDE, RENFORT, J14]) assert.ok(listed.has(m), `match ${m} : présent, déjà noté`);
for (const m of [HORS, ZERO, AUTRE_EQUIPE, J15, DEMAIN]) assert.ok(!listed.has(m), `match ${m} : ni hors feuille, ni autre équipe, ni hors délai`);
assert.equal(todo.find(r => Number(r.match_id) === SANS).corrige, true, 'corrigé par le staff : signalé');
assert.deepEqual(await rows(N2, 'select * from public.my_rpe_matches()'), [], 'un compte staff : rien');

/* ---------- 6. rpe_history : séances et matchs ---------- */
await q(`insert into public.sessions (club_id, team_id, titre, date_seance, heure) values (1, 1, 'Séance du matin', current_date, '09:00')`);
const S = Number((await q(`select id from public.sessions where titre = 'Séance du matin'`)).rows[0].id);
await one(JOUEUR, 'select public.rpe_set($1, $2)', [S, 6]);
await set(JOUEUR, AUJ, 7);
const hist = await rows(JOUEUR, 'select * from public.rpe_history(1)');
assert.deepEqual(hist.slice(0, 2).map(r => [r.titre, r.rpe]), [['Match contre ADVERSAIRE', 7], ['Séance du matin', 6]], 'même jour : l’heure ordonne match et séance');
assert.equal(hist[0].session_id, null, 'un match : pas de séance');
assert.equal(Number(hist[1].session_id), S, 'une séance : son numéro');
assert.equal(hist.length, 7, 'toutes ses réponses');
assert.equal((await rows(JOUEUR, 'select * from public.rpe_history(1, 3)')).length, 3, 'limite respectée sur l’ensemble');
assert.equal((await rows(N2, 'select * from public.rpe_history(1)')).length, 6, 'coach N2 : sans le match U19 qu’il ne lit pas');
assert.equal((await rows(ADMIN, 'select * from public.rpe_history(1)')).length, 7, 'admin : tout');
assert.deepEqual(await rows(U19, 'select * from public.rpe_history(1)'), [], 'coach U19 : rien');
assert.deepEqual(await rows(J2, 'select * from public.rpe_history(1)'), [], 'un autre joueur : rien');
assert.deepEqual(await rows(SCOUT, 'select * from public.rpe_history(1)'), [], 'lecteur : rien');

/* ---------- 7. Corbeille : le RPE revient avec son match ---------- */
assert.equal((await rows(ADMIN, 'delete from public.matches where id = $1 returning id', [FEUILLE])).length, 1);
assert.equal((await one(ADMIN, 'select count(*)::int n from public.match_rpe where match_id = $1', [FEUILLE])).n, 0, 'parti avec le match');
const root = (await one(ADMIN, `select id from public.trash where tbl = 'matches' and row_id = $1`, [FEUILLE])).id;
assert.equal((await one(ADMIN, `select count(*)::int n from public.trash where root_id = $1 and tbl = 'match_rpe'`, [root])).n, 2, 'dans la corbeille avec lui');
await one(ADMIN, 'select public.trash_restore($1)', [[root]]);
assert.deepEqual((await rows(ADMIN, 'select rpe from public.match_rpe where match_id = $1 order by player_id', [FEUILLE])).map(r => r.rpe), [8, 5], 'restauré avec le match');

/* ---------- 8. Règles lecteur, anonyme ---------- */
assert.deepEqual((await rows(ADMIN, `select policyname from pg_policies where tablename = 'match_rpe' and permissive = 'RESTRICTIVE' order by 1`))
  .map(r => r.policyname), ['lecteur_no_delete', 'lecteur_no_insert', 'lecteur_no_update'], 'règles lecteur');
for (const f of ['match_rpe_set(bigint, integer, bigint)', 'my_rpe_matches()', 'rpe_history(bigint, integer)']) {
  assert.equal((await q(`select has_function_privilege('anon', 'public.${f}', 'execute') a`)).rows[0].a, false, `anonyme : ${f}`);
  assert.equal((await q(`select has_function_privilege('authenticated', 'public.${f}', 'execute') a`)).rows[0].a, true, `compte : ${f}`);
}
assert.equal((await q(`select has_function_privilege('authenticated', 'public.player_match_rpe_ok(bigint, bigint)', 'execute') a`)).rows[0].a, false, 'fonction interne');

console.log('match-rpe-sql : OK (qui note, délai, réponse unique, correction du staff, lecture, liste, évolution, corbeille, lecteur)');
