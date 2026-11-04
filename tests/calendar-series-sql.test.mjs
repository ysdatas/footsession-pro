/* Calendrier, phase 2 (supabase/lmfc_v30.sql) sur un vrai Postgres (PGlite),
   RLS active : séries (calendar_add), joueurs ajoutés ou retirés
   (club_event_players, statut non_concerne), plusieurs séances dans la
   journée (lmfc_v37.sql), ce que voit chaque joueur
   (my_calendar et lecture directe), RPE refusé au non concerné, RPE ouvert
   par le calendrier sans que le coach écrive la séance, file des
   notifications regroupées par joueur. Migration passée deux fois.
   Lancement : PGlite installé hors du projet, relié en node_modules,
   puis node tests/calendar-series-sql.test.mjs (sans PGlite : échec). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { libraryDb, USERS } from './library-db.mjs';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.error('calendar-series-sql : PGlite absent, test NON lancé');
  process.exit(1);
}
const { ADMIN, N2, U19, PREPA, SCOUT, JOUEUR } = USERS;
const J2 = '00000000-0000-0000-0000-000000000098', J3 = '00000000-0000-0000-0000-000000000099';
const { db, q, rows, one, ko } = await libraryDb(PGlite);
const read = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8');
const fn = (file, name) => { const s = read(file), a = s.indexOf(`create or replace function public.${name}(`); return s.slice(a, s.indexOf('\n$$;', a) + 4); };
const NO = /Vous ne pouvez rien créer/;

// Joueurs : 1 ADAME (N2, JOUEUR), 2 BARAKAT (N2, J2), 3 CISSE (U19, J3), chacun avec un téléphone abonné.
await db.exec(`alter table public.players add column auth_user_id uuid, add column other_team_ids bigint[] not null default '{}';
  alter table public.sessions add column duree_min numeric(6,2) default 90;
  insert into auth.users values ('${J2}'), ('${J3}');
  insert into public.profiles (id, club_id, role, nom) values ('${J2}', 1, 'joueur', 'Joueur 2'), ('${J3}', 1, 'joueur', 'Joueur U19');
  update public.players set auth_user_id = '${JOUEUR}' where id = 1;
  insert into public.players (club_id, nom, team_id, auth_user_id) values (1, 'BARAKAT', 1, '${J2}'), (1, 'CISSE', 2, '${J3}');
  create table public.staff_player_access (profile_id uuid, player_id bigint, niveau text);
  ${fn('lmfc_v22.sql', 'player_level_for')}
  ${fn('lmfc_v19.sql', 'player_level')}
  create table public.exercise_templates (id bigint generated always as identity primary key, club_id bigint not null, created_by uuid, nom text);`);
for (const f of ['lmfc_v11.sql', 'lmfc_v27.sql', 'lmfc_v28.sql', 'lmfc_v29.sql', 'lmfc_v16.sql', 'lmfc_v30.sql', 'lmfc_v30.sql', 'lmfc_v37.sql', 'lmfc_v37.sql']) await db.exec(read(f));
await db.exec(`grant usage on all sequences in schema public to authenticated;
  insert into public.push_subscriptions (user_id, club_id, endpoint, p256dh, auth) values
    ${[JOUEUR, J2, J3].map((u, i) => `('${u}', 1, 'https://fcm.googleapis.com/fcm/send/t${i}', '${'A'.repeat(87)}', '${'B'.repeat(22)}')`).join(', ')};`);

const D = async (n) => (await q('select (current_date + $1::int)::text d', [n])).rows[0].d;
const add = (uid, kind, list, players = {}) => one(uid, 'select public.calendar_add($1, $2::jsonb, $3::jsonb) r', [kind, JSON.stringify(list), JSON.stringify(players)]);
const cal = async (uid) => (await rows(uid, 'select kind, titre from public.my_calendar(current_date - 2, current_date + 30) order by date_cal, kind'))
  .map(r => `${r.kind}:${r.titre}`);
const take = async (uid) => (await one(uid, 'select public.calendar_notifs_take(12) r')).r;
const inbox = (t) => Object.fromEntries(t.messages.map(m => [m.subs[0].endpoint.slice(-2), `${m.title} | ${m.body}`]));
const [d1, d2, d3] = [await D(2), await D(3), await D(9)];

/* ---------- 1. Une série de séances ---------- */
await q(`insert into public.sessions (club_id, team_id, titre, date_seance) values (1, 1, 'Déjà là', $1)`, [d2]);
const SERIE = '11111111-1111-1111-1111-111111111111';
const sessions = [d1, d2, d3].map(date => ({ titre: 'Entraînement', date, heure: '10:30', team_id: 1, serie_id: SERIE, duree_min: 75 }));
const r1 = (await add(N2, 'seance', sessions, { add: [3], remove: [2] })).r;
assert.deepEqual([r1.created.length, r1.skipped], [3, []], 'trois séances créées : une date où l’équipe a déjà une séance en reçoit une de plus');
assert.equal((await add(N2, 'seance', sessions, { add: [3], remove: [2] })).r.created.length, 0, 'double envoi : rien de plus');
assert.deepEqual((await rows(ADMIN, 'select duree_min::int d, heure::text h from public.sessions where serie_id = $1', [SERIE])).map(r => `${r.d}/${r.h}`),
  ['75/10:30:00', '75/10:30:00', '75/10:30:00']);
await ko(U19, 'select public.calendar_add($1, $2::jsonb)', ['seance', JSON.stringify([{ titre: 'X', date: d1, team_id: 1 }])], NO, 'coach U19 : rien pour la N2');
await ko(PREPA, 'select public.calendar_add($1, $2::jsonb)', ['seance', JSON.stringify([{ titre: 'X', date: d1, team_id: 1 }])], NO, 'préparateur : rien');
await ko(SCOUT, 'select public.calendar_add($1, $2::jsonb)', ['evenement', JSON.stringify([{ titre: 'X', date: d1, team_id: 1 }])], NO, 'lecteur : rien');
await ko(N2, 'select public.calendar_add($1, $2::jsonb)', ['seance', JSON.stringify([{ titre: 'X', date: d1, team_id: null }])], NO, 'coach : pas de séance « tout le club »');

assert.deepEqual((await cal(JOUEUR)).sort(), ['seance:Déjà là', 'seance:Entraînement', 'seance:Entraînement', 'seance:Entraînement'], 'N2 : ses séances');
assert.deepEqual(await cal(J2), ['seance:Déjà là'], 'retiré de la série (non concerné) : il ne la voit plus');
assert.deepEqual(await cal(J3), ['seance:Entraînement', 'seance:Entraînement', 'seance:Entraînement'], 'U19 ajouté : il voit la série, pas le reste de la N2');

/* ---------- 2. Notifications : une série = un message par joueur ---------- */
let t = await take(N2);
assert.deepEqual(inbox(t), { t0: `3 séances ajoutées | Entraînement · du ${await q(`select public.cal_fr_day($1::date) d`, [d1]).then(r => r.rows[0].d)} au ${await q(`select public.cal_fr_day($1::date) d`, [d3]).then(r => r.rows[0].d)}`,
  t2: inbox(t).t2 }, 'ADAME et CISSE : un seul message ; BARAKAT (retiré) : rien');
assert.ok(inbox(t).t2.startsWith('3 séances ajoutées'));
assert.equal(t.more, false);
assert.deepEqual((await take(N2)).messages, [], 'déjà envoyé : rien deux fois');
assert.deepEqual((await take(ADMIN)).messages, [], 'chacun n’envoie que ses propres changements');
await ko(N2, 'select * from public.calendar_notifs', [], /permission denied/, 'file illisible directement');

/* ---------- 3. Événements, joueurs ajoutés ou retirés ---------- */
const ev = (await add(N2, 'evenement', [{ titre: 'Stage', date: d1, team_id: 1, lieu: 'Le Mans' }], { add: [3], remove: [2] })).r.created[0].id;
await add(ADMIN, 'evenement', [{ titre: 'Réunion du club', date: d1, team_id: null }]);
const evs = async (uid) => (await rows(uid, 'select titre from public.club_events order by titre')).map(r => r.titre);
assert.deepEqual(await evs(JOUEUR), ['Réunion du club', 'Stage'], 'N2 : événement de son équipe et du club');
assert.deepEqual(await evs(J2), ['Réunion du club'], 'retiré : même en lecture directe, le serveur le cache');
assert.deepEqual(await evs(J3), ['Réunion du club', 'Stage'], 'U19 ajouté nommément : il le voit');
assert.ok((await cal(J3)).includes('evenement:Stage') && !(await cal(J2)).includes('evenement:Stage'), 'my_calendar applique les exceptions');
assert.equal((await rows(N2, 'select * from public.club_event_players')).length, 2, 'le coach N2 voit les exceptions');
for (const uid of [U19, JOUEUR, SCOUT]) assert.equal((await rows(uid, 'select * from public.club_event_players')).length, 0, `${uid} : aucune exception lue`);
await ko(U19, 'insert into public.club_event_players (club_id, event_id, player_id, inclus) values (1, $1, 1, false)', [ev], /row-level security/, 'U19 : pas d’écriture');
assert.equal((await one(N2, `select public.club_event_set_players(array[$1::bigint], '{"add":[3]}'::jsonb) n`, [ev])).n, 1, 'exceptions remplacées');
assert.deepEqual(await evs(J2), ['Réunion du club', 'Stage'], 'BARAKAT n’est plus retiré : il le voit de nouveau');
t = await take(N2);
assert.ok(t.messages.every(m => m.title === 'Nouvel événement' && m.body.startsWith('Stage · ')), 'nouvel événement annoncé');
assert.deepEqual(Object.keys(inbox(t)).sort(), ['t0', 't2'], 'ADAME et CISSE (BARAKAT était retiré à la création)');
assert.ok((await take(ADMIN)).messages.some(m => m.title === 'Nouvel événement'), 'l’admin envoie la réunion du club');

await rows(N2, `update public.club_events set heure = '18:00' where id = $1 returning id`, [ev]);
assert.ok((await take(N2)).messages.every(m => m.title === 'Événement modifié' && m.body.endsWith('à 18h00')), 'modification annoncée');
await rows(N2, 'delete from public.club_events where id = $1 returning id', [ev]);
t = await take(N2);
assert.deepEqual(Object.keys(inbox(t)).sort(), ['t0', 't1', 't2'], 'annulation : tous les concernés, calculés avant la suppression');
assert.ok(t.messages.every(m => m.title === 'Événement annulé'));
await add(N2, 'evenement', [{ titre: 'Passé', date: await D(-1), team_id: 1 }]);
assert.deepEqual((await take(N2)).messages, [], 'rien pour le passé');

/* ---------- 4. Non concerné : ni séance, ni RPE ; feuille de match ---------- */
const S = (await q(`insert into public.sessions (club_id, team_id, titre, date_seance) values (1, 1, 'Ce matin', current_date) returning id`)).rows[0].id;
await q(`insert into public.attendance (player_id, session_id, statut) values (2, $1, 'non_concerne')`, [S]);
await ko(J2, 'select public.rpe_set($1, 5)', [S], /ne te concerne pas/, 'non concerné : pas de RPE');
assert.equal((await one(JOUEUR, 'select public.rpe_set($1, 5) r', [S])).r.rpe, 5, 'son coéquipier note la séance');
const M = (await q(`insert into public.matches (club_id, team_id, adversaire, date_match) values (1, 1, 'FC TEST', current_date + 5) returning id`)).rows[0].id;
assert.ok(!(await cal(J3)).includes('match:FC TEST'), 'match de la N2 : pas pour un U19…');
await q('insert into public.match_players (club_id, match_id, player_id) values (1, $1, 3)', [M]);
assert.ok((await cal(J3)).includes('match:FC TEST'), '… sauf s’il est sur la feuille de match');

/* ---------- 5. Le RPE suit le calendrier, pas le travail du coach ---------- */
// Séance posée au calendrier, vide (ni procédé, ni présence) : ouverte le jour même, pas avant.
const PREVUE = '22222222-2222-2222-2222-222222222222';
await add(ADMIN, 'seance', [await D(0), await D(1)].map(date => ({ titre: 'Prévue', date, team_id: 2, serie_id: PREVUE })));
const prevues = (await rows(J3, 'select session_id, titre from public.my_rpe_sessions()')).filter(r => r.titre === 'Prévue');
assert.equal(prevues.length, 1, 'celle du jour, pas celle de demain');
assert.equal((await one(J3, 'select public.rpe_set($1, 6) r', [prevues[0].session_id])).r.rpe, 6, 'notée sans que le coach ait rien écrit');

/* ---------- 6. Autant de séances qu'on veut dans la journée (lmfc_v37.sql) ---------- */
const [j1, j2] = [await D(20), await D(21)], MATIN = '33333333-3333-3333-3333-333333333333';
const matin = [j1, j2].map(date => ({ titre: 'Matin', date, heure: '08:00', team_id: 1, serie_id: MATIN }));
assert.equal((await add(N2, 'seance', matin)).r.created.length, 2);
assert.equal((await add(N2, 'seance', matin)).r.created.length, 0, 'double envoi de la même série : rien de plus');
for (const titre of ['Midi', 'Soir']) assert.equal((await add(N2, 'seance', [{ titre, date: j1, team_id: 1 }])).r.created.length, 1, `${titre} : une de plus le même jour`);
assert.equal((await rows(N2, 'update public.sessions set date_seance = $1 where serie_id = $2 and date_seance = $3 returning id', [j1, MATIN, j2])).length, 1, 'séance déplacée sur un jour où sa série en a déjà une');
assert.equal((await q('select count(*)::int n from public.sessions where team_id = 1 and date_seance = $1', [j1])).rows[0].n, 4, 'quatre séances ce jour-là');

console.log('calendar-series-sql : OK (séries, exceptions, visibilité, RPE, RPE du calendrier, notifications regroupées, plusieurs séances par jour)');
