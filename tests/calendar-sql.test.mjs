/* Calendrier commun (supabase/lmfc_v28.sql) sur un vrai Postgres (PGlite),
   RLS active : événements du club lus selon l'équipe, écrits par l'admin
   et les coachs de l'équipe ; le joueur voit les séances, matchs et
   événements de ses équipes (et ses invitations), jamais les notes ni les
   informations ; le lecteur ne voit rien. Migration passée deux fois.
   Lancement : PGlite installé hors du projet, relié en node_modules,
   puis node tests/calendar-sql.test.mjs (sans PGlite : échec). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { libraryDb, USERS } from './library-db.mjs';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.error('calendar-sql : PGlite absent, test NON lancé');
  process.exit(1);
}
const { ADMIN, N2, U19, NONE, PREPA, SCOUT, JOUEUR, AUTRE } = USERS;
const { db, q, rows, one, ko } = await libraryDb(PGlite);
const read = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8');
const RLS = /row-level security|permission denied/;

// Matchs (lmfc_v11, v27), compte joueur lié à sa fiche, puis le calendrier.
await db.exec(`alter table public.players add column auth_user_id uuid, add column other_team_ids bigint[] not null default '{}';
  update public.players set auth_user_id = '${JOUEUR}' where id = 1;
  insert into public.players (club_id, nom) values (1, 'BARAKAT');`);
for (const f of ['lmfc_v11.sql', 'lmfc_v27.sql', 'lmfc_v28.sql', 'lmfc_v28.sql']) await db.exec(read(f));
await db.exec('grant usage on all sequences in schema public to authenticated; grant delete on public.teams to authenticated;');

const id = async (sql, p) => Number((await q(`${sql} returning id`, p)).rows[0].id);
const S1 = await id(`insert into public.sessions (club_id, team_id, titre, date_seance, notes, heure) values (1, 1, 'Transitions', '2026-11-03', 'Note staff', '10:30')`);
const S2 = await id(`insert into public.sessions (club_id, team_id, titre, date_seance) values (1, 2, 'Séance U19', '2026-11-04')`);
const S3 = await id(`insert into public.sessions (club_id, team_id, titre, date_seance) values (1, 2, 'U19 avec invité', '2026-11-05')`);
const S4 = await id(`insert into public.sessions (club_id, team_id, titre, date_seance) values (1, 1, 'Hors période', '2027-01-10')`);
await q(`insert into public.attendance (player_id, session_id, invite) values (1, $1, true)`, [S3]);
const M1 = await id(`insert into public.matches (club_id, team_id, adversaire, date_match, heure, stade, infos, commentaire) values
  (1, 1, 'FONTENAY VENDEE', '2026-11-07', '18:00', 'Massabielle', 'Infos staff', 'Commentaire staff')`);
const M2 = await id(`insert into public.matches (club_id, team_id, adversaire, date_match) values (1, 2, 'U19 adverse', '2026-11-08')`);

/* ---------- 1. Événements : qui écrit ---------- */
const ev = async (uid, team, titre, notes = null) => (await one(uid,
  `insert into public.club_events (club_id, team_id, titre, date_event, notes) values (1, $1, $2, '2026-11-10', $3) returning id`, [team, titre, notes])).id;
const E1 = await ev(ADMIN, null, 'Réunion du club', 'Salle du club, 19 h');
const E2 = await ev(N2, 1, 'Stage N2');
const E3 = await ev(U19, 2, 'Tournoi U19');
await ko(N2, `insert into public.club_events (club_id, team_id, titre, date_event) values (1, 2, 'x', '2026-11-11')`, [], RLS, 'coach : pas une autre équipe');
await ko(N2, `insert into public.club_events (club_id, team_id, titre, date_event) values (1, null, 'x', '2026-11-11')`, [], RLS, 'coach : pas tout le club');
await ko(N2, `insert into public.club_events (club_id, team_id, titre, date_event) values (1, 3, 'x', '2026-11-11')`, [], RLS, 'équipe d’un autre club');
for (const who of [PREPA, SCOUT, JOUEUR, NONE]) {
  await ko(who, `insert into public.club_events (club_id, team_id, titre, date_event) values (1, 1, 'x', '2026-11-11')`, [], RLS, `${who} : pas d'événement`);
}
assert.equal((await rows(N2, `update public.club_events set titre = 'Autre' where id = $1 returning id`, [E3])).length, 0, 'coach N2 : pas l’événement U19');
assert.equal((await rows(JOUEUR, `update public.club_events set titre = 'Autre' where id = $1 returning id`, [E1])).length, 0, 'joueur : lecture seule');
assert.equal((await rows(JOUEUR, `delete from public.club_events where id = $1 returning id`, [E2])).length, 0, 'joueur : ne supprime rien');
const before = (await one(ADMIN, 'select updated_at from public.club_events where id = $1', [E2])).updated_at;
assert.equal((await rows(N2, `update public.club_events set heure = '09:00' where id = $1 returning id`, [E2])).length, 1, 'coach : son équipe');
assert.ok((await one(ADMIN, 'select updated_at from public.club_events where id = $1', [E2])).updated_at >= before);
await assert.rejects(q(`insert into public.club_events (club_id, titre, date_event) values (1, '  ', '2026-11-10')`), /check/, 'titre obligatoire');

/* ---------- 2. Événements : qui lit ---------- */
const seen = async (uid) => (await rows(uid, 'select id from public.club_events order by id')).map(r => Number(r.id));
assert.deepEqual(await seen(ADMIN), [E1, E2, E3]);
assert.deepEqual(await seen(PREPA), [E1, E2], 'préparateur N2 : club + N2');
assert.deepEqual(await seen(U19), [E1, E3], 'coach U19 : club + U19');
assert.deepEqual(await seen(NONE), [E1], 'coach sans équipe : le club seulement');
assert.deepEqual(await seen(JOUEUR), [E1, E2], 'joueur N2 : club + N2');
assert.deepEqual(await seen(SCOUT), [], 'lecteur : rien');
assert.deepEqual(await seen(AUTRE), [], 'autre club : rien');

/* ---------- 3. Calendrier du joueur ---------- */
const cal = async (uid, from = '2026-11-01', to = '2026-11-30') => rows(uid, 'select * from public.my_calendar($1, $2)', [from, to]);
const mine = await cal(JOUEUR);
assert.deepEqual(mine.map(r => `${r.kind}:${r.id}`),
  [`seance:${S1}`, `seance:${S3}`, `match:${M1}`, `evenement:${E1}`, `evenement:${E2}`], 'ses équipes et ses invitations, dans l’ordre des dates');
const s1 = mine.find(r => r.kind === 'seance' && Number(r.id) === S1);
assert.deepEqual([s1.titre, s1.heure, s1.notes], ['Transitions', '10:30:00', null], 'séance : jamais ses notes');
const m1 = mine.find(r => r.kind === 'match');
assert.deepEqual([m1.titre, m1.stade, m1.heure], ['FONTENAY VENDEE', 'Massabielle', '18:00:00']);
assert.ok(!Object.values(m1).includes('Infos staff') && !Object.values(m1).includes('Commentaire staff'), 'match : ni informations ni commentaire');
assert.equal(mine.find(r => Number(r.id) === E1 && r.kind === 'evenement').notes, 'Salle du club, 19 h', 'événement : ses notes');
const has = (kind, n) => mine.some(r => r.kind === kind && Number(r.id) === n);
assert.ok(!has('seance', S2) && !has('seance', S4) && !has('match', M2) && !has('evenement', E3), 'ni U19 ni hors période');
await q(`update public.players set other_team_ids = '{2}' where id = 1`);
assert.equal((await cal(JOUEUR)).length, 8, '« joue aussi en » U19 : séance, match et événement U19 en plus');
await q(`update public.players set other_team_ids = '{}' where id = 1`);
assert.deepEqual(await cal(JOUEUR, '2026-01-01', '2026-12-31'), [], 'plus de 100 jours : rien');
for (const who of [ADMIN, N2, PREPA, SCOUT]) assert.deepEqual(await cal(who), [], `${who} : pas un compte joueur`);
assert.equal((await rows(JOUEUR, 'select id from public.sessions')).length, 0, 'le joueur ne lit toujours pas les séances');

/* ---------- 4. Heure de séance, règles lecteur, anonyme ---------- */
assert.equal((await rows(N2, `update public.sessions set heure = '17:00' where id = $1 returning heure`, [S1]))[0].heure, '17:00:00');
const restrictive = (await rows(ADMIN, `select policyname from pg_policies where tablename = 'club_events' and permissive = 'RESTRICTIVE' order by 1`)).map(r => r.policyname);
assert.deepEqual(restrictive, ['lecteur_no_delete', 'lecteur_no_insert', 'lecteur_no_update']);
assert.equal((await q(`select has_function_privilege('anon', 'public.my_calendar(date, date)', 'execute') a`)).rows[0].a, false);

/* ---------- 5. Corbeille : les événements reviennent avec leur équipe ---------- */
await rows(ADMIN, 'delete from public.teams where id = 2');
assert.deepEqual(await seen(ADMIN), [E1, E2], 'équipe supprimée : ses événements partent');
const root = (await one(ADMIN, `select id from public.trash where tbl = 'teams' and row_id = 2`)).id;
await rows(ADMIN, 'select public.trash_restore($1)', [[root]]);
assert.deepEqual(await seen(ADMIN), [E1, E2, E3], 'restaurée avec ses événements');

console.log('calendar-sql : OK (écriture, lecture, calendrier du joueur, corbeille)');
