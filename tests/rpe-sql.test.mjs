/* RPE après la séance (supabase/lmfc_v29.sql) sur un vrai Postgres (PGlite),
   RLS active : une évaluation par joueur et par séance ; le joueur ne note
   que ses séances, du jour même à J+2, et ne voit que son RPE ; le staff
   qui suit le joueur le lit et le corrige (marqué) ; le lecteur, les autres
   joueurs et le staff d'une autre équipe ne voient rien ; aucune écriture
   directe ; corbeille avec la séance. Migration passée deux fois.
   Lancement : PGlite installé hors du projet, relié en node_modules,
   puis node tests/rpe-sql.test.mjs (sans PGlite : échec). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { libraryDb, USERS } from './library-db.mjs';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.error('rpe-sql : PGlite absent, test NON lancé');
  process.exit(1);
}
const { ADMIN, N2, U19, PREPA, PREPA19, SCOUT, JOUEUR, AUTRE } = USERS;
const J2 = '00000000-0000-0000-0000-000000000099';
const { db, q, rows, one, ko } = await libraryDb(PGlite);
const read = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8');
const fn = (file, name) => { const s = read(file), a = s.indexOf(`create or replace function public.${name}(`); return s.slice(a, s.indexOf('\n$$;', a) + 4); };
const DENIED = /permission denied|row-level security/;

// Deux joueurs de l'équipe N2 avec un compte, niveau sur les joueurs (lmfc_v19, v22), séances datées autour d'aujourd'hui.
await db.exec(`alter table public.players add column auth_user_id uuid, add column other_team_ids bigint[] not null default '{}';
  insert into auth.users values ('${J2}'); insert into public.profiles (id, club_id, role, nom) values ('${J2}', 1, 'joueur', 'Joueur 2');
  update public.players set auth_user_id = '${JOUEUR}' where id = 1;
  insert into public.players (club_id, nom, team_id, auth_user_id) values (1, 'BARAKAT', 1, '${J2}');
  create table public.staff_player_access (profile_id uuid, player_id bigint, niveau text);
  ${fn('lmfc_v22.sql', 'player_level_for')}
  ${fn('lmfc_v19.sql', 'player_level')}`);
for (const f of ['lmfc_v11.sql', 'lmfc_v27.sql', 'lmfc_v28.sql', 'lmfc_v29.sql', 'lmfc_v29.sql']) await db.exec(read(f));
await db.exec('grant usage on all sequences in schema public to authenticated;');
const ses = async (team, days, titre) => Number((await q(`insert into public.sessions (club_id, team_id, titre, date_seance)
  values (1, $1, $2, current_date + $3::int) returning id`, [team, titre, days])).rows[0].id);
const S1 = await ses(1, 0, 'Aujourd’hui'), S2 = await ses(1, -1, 'Hier'), S3 = await ses(1, -3, 'Il y a 3 jours');
const S4 = await ses(2, 0, 'U19'), S5 = await ses(2, 0, 'U19 avec invité'), S6 = await ses(1, 1, 'Demain');
await q('insert into public.attendance (player_id, session_id, invite) values (1, $1, true)', [S5]);
const set = (uid, s, v, p = null) => one(uid, 'select public.rpe_set($1, $2, $3) r', [s, v, p]);
const mine = async (uid) => (await rows(uid, 'select session_id, player_id, rpe from public.session_rpe order by session_id, player_id'))
  .map(r => `${r.session_id}/${r.player_id}:${r.rpe}`);

/* ---------- 1. Le joueur note sa séance, une seule fois ---------- */
assert.deepEqual((await set(JOUEUR, S1, 7)).r, { rpe: 7, corrige: false });
assert.deepEqual((await set(JOUEUR, S1, 8)).r, { rpe: 8, corrige: false }, 'il se reprend : même ligne');
assert.equal((await one(ADMIN, 'select count(*)::int n from public.session_rpe where session_id = $1', [S1])).n, 1, 'une évaluation par séance');
for (const bad of [0, 11]) await ko(JOUEUR, 'select public.rpe_set($1, $2)', [S1, bad], /1 à 10/, `RPE ${bad} refusé`);
await ko(JOUEUR, 'select public.rpe_set($1, $2)', [S3, 5], /fermée/, 'J+3 : fermé');
await ko(JOUEUR, 'select public.rpe_set($1, $2)', [S6, 5], /fermée/, 'séance à venir : pas encore');
await ko(JOUEUR, 'select public.rpe_set($1, $2)', [S4, 5], /ne te concerne pas/, 'autre équipe');
assert.equal((await set(JOUEUR, S5, 4)).r.rpe, 4, 'invité à une séance U19 : il la note');
await set(JOUEUR, S2, 6);
await ko(JOUEUR, `insert into public.session_rpe (club_id, session_id, player_id, rpe) values (1, $1, 1, 3)`, [S6], DENIED, 'aucune écriture directe');
assert.equal((await rows(JOUEUR, 'update public.session_rpe set rpe = 1 returning id').catch(() => [])).length, 0, 'ni mise à jour directe');
await ko(ADMIN, 'select public.rpe_set($1, $2)', [S1, 5], /ne te concerne pas/, 'un compte staff sans p_player : refusé');

/* ---------- 2. Qui lit ---------- */
assert.deepEqual(await mine(JOUEUR), [`${S1}/1:8`, `${S2}/1:6`, `${S5}/1:4`], 'le joueur : les siens');
assert.deepEqual(await mine(J2), [], 'un autre joueur : rien');
assert.deepEqual(await mine(N2), [`${S1}/1:8`, `${S2}/1:6`], 'coach N2 : ses séances (pas la séance U19)');
assert.deepEqual(await mine(PREPA), await mine(N2), 'préparateur N2 : idem');
assert.deepEqual(await mine(U19), [], 'coach U19 : le joueur N2 ne lui est pas ouvert');
for (const who of [PREPA19, SCOUT, AUTRE]) assert.deepEqual(await mine(who), [], `${who} : rien`);
assert.equal((await mine(ADMIN)).length, 3);

/* ---------- 3. Correction du staff, marquée ---------- */
assert.deepEqual((await set(PREPA, S1, 6, 1)).r, { rpe: 6, corrige: true }, 'préparateur de l’équipe : corrige');
const row = await one(ADMIN, 'select saisi_par, corrige_par from public.session_rpe where session_id = $1 and player_id = 1', [S1]);
assert.deepEqual([row.saisi_par, row.corrige_par], [JOUEUR, PREPA], 'saisie du joueur et correction du staff distinguées');
await ko(JOUEUR, 'select public.rpe_set($1, $2)', [S1, 9], /corrigé/, 'corrigé : le joueur ne le change plus');
await ko(U19, 'select public.rpe_set($1, $2, $3)', [S1, 5, 1], /réservée/, 'coach d’une autre équipe : refusé');
await ko(SCOUT, 'select public.rpe_set($1, $2, $3)', [S1, 5, 1], /réservée/, 'lecteur : refusé');
await ko(N2, 'select public.rpe_set($1, $2, $3)', [S4, 5, 1], /réservée/, 'séance qui ne concerne pas le joueur');
assert.deepEqual((await set(N2, S3, 5, 2)).r, { rpe: 5, corrige: true }, 'le staff saisit pour un joueur qui n’a pas répondu (même après J+2)');
assert.equal((await set(N2, S1, null, 1)).r, null, 'effacer');
assert.deepEqual((await set(JOUEUR, S1, 7)).r, { rpe: 7, corrige: false }, 'effacé : le joueur peut renoter');

/* ---------- 4. Séances à noter, évolution ---------- */
const todo = await rows(JOUEUR, 'select session_id, rpe, corrige from public.my_rpe_sessions()');
assert.deepEqual(todo.map(r => `${r.session_id}:${r.rpe}`).sort(), [`${S1}:7`, `${S2}:6`, `${S5}:4`].sort(), 'aujourd’hui, hier, invitation ; ni J+3 ni demain ni U19');
assert.deepEqual((await rows(J2, 'select session_id, rpe from public.my_rpe_sessions()')).map(r => `${r.session_id}:${r.rpe}`).sort(),
  [`${S1}:null`, `${S2}:null`].sort(), 'joueur 2 : à noter');
assert.deepEqual(await rows(N2, 'select * from public.my_rpe_sessions()'), [], 'staff : pas de liste à noter');
assert.equal((await rows(JOUEUR, 'select * from public.rpe_history(1)')).length, 3, 'le joueur : son évolution');
assert.deepEqual(await rows(J2, 'select * from public.rpe_history(1)'), [], 'un autre joueur : rien');
assert.equal((await rows(N2, 'select * from public.rpe_history(2)'))[0].corrige, true, 'staff : évolution, saisie du staff marquée');
assert.deepEqual(await rows(U19, 'select * from public.rpe_history(1)'), [], 'coach U19 : rien');
await ko(JOUEUR, 'select public.player_session_ok(1, $1)', [S1], DENIED, 'fonction interne');

/* ---------- 5. Règles lecteur, anonyme, corbeille ---------- */
assert.deepEqual((await rows(ADMIN, `select policyname from pg_policies where tablename = 'session_rpe' and permissive = 'RESTRICTIVE' order by 1`))
  .map(r => r.policyname), ['lecteur_no_delete', 'lecteur_no_insert', 'lecteur_no_update']);
assert.equal((await q(`select has_function_privilege('anon', 'public.rpe_set(bigint, integer, bigint)', 'execute') a`)).rows[0].a, false);
await rows(N2, 'delete from public.sessions where id = $1', [S2]);
assert.deepEqual(await mine(JOUEUR), [`${S1}/1:7`, `${S5}/1:4`], 'séance supprimée : son RPE part');
const root = (await one(N2, `select id from public.trash where tbl = 'sessions' and row_id = $1`, [S2])).id;
await rows(N2, 'select public.trash_restore($1)', [[root]]);
assert.deepEqual(await mine(JOUEUR), [`${S1}/1:7`, `${S2}/1:6`, `${S5}/1:4`], 'restaurée avec le RPE');

console.log('rpe-sql : OK (saisie, fenêtre, confidentialité, correction, évolution, corbeille)');
