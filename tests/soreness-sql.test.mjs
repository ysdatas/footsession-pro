/* Courbatures avant la séance (supabase/lmfc_v35.sql) sur un vrai Postgres
   (PGlite), RLS active : une réponse par jour, le jour d'une séance du
   joueur ; 0 sans muscle, 1 à 10 avec au moins un muscle connu ; alerte au
   3e jour de calendrier du même muscle (pas avec un trou, pas avec un autre
   muscle), une par jour ; qui lit (joueur, staff qui le suit, jamais le
   lecteur) ; « Vu » ; appareils du staff à prévenir, une seule fois.
   Migration passée deux fois.
   Lancement : PGlite installé hors du projet, relié en node_modules,
   puis node tests/soreness-sql.test.mjs (sans PGlite : échec). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { libraryDb, USERS } from './library-db.mjs';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.error('soreness-sql : PGlite absent, test NON lancé');
  process.exit(1);
}
const { ADMIN, N2, U19, PREPA, SCOUT, JOUEUR } = USERS;
const J2 = '00000000-0000-0000-0000-000000000099';
const { db, q, rows, one, ko } = await libraryDb(PGlite);
const read = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8');
const fn = (file, name) => { const s = read(file), a = s.indexOf(`create or replace function public.${name}(`); return s.slice(a, s.indexOf('\n$$;', a) + 4); };
const DENIED = /permission denied|row-level security/;

// Deux joueurs N2 avec un compte (comme rpe-sql), RPE (player_session_ok), appareils (lmfc_v16), puis v35 deux fois.
await db.exec(`alter table public.players add column auth_user_id uuid, add column other_team_ids bigint[] not null default '{}';
  insert into auth.users values ('${J2}'); insert into public.profiles (id, club_id, role, nom) values ('${J2}', 1, 'joueur', 'Joueur 2');
  update public.players set auth_user_id = '${JOUEUR}', prenom = 'Yanis' where id = 1;
  insert into public.players (club_id, nom, team_id, auth_user_id) values (1, 'BARAKAT', 1, '${J2}');
  create table public.staff_player_access (profile_id uuid, player_id bigint, niveau text);
  ${fn('lmfc_v22.sql', 'player_level_for')}
  ${fn('lmfc_v19.sql', 'player_level')}`);
for (const f of ['lmfc_v11.sql', 'lmfc_v27.sql', 'lmfc_v28.sql', 'lmfc_v29.sql', 'lmfc_v16.sql', 'lmfc_v35.sql', 'lmfc_v35.sql']) await db.exec(read(f));
await db.exec('grant usage on all sequences in schema public to authenticated;');
const ses = async (team, days) => Number((await q(`insert into public.sessions (club_id, team_id, titre, date_seance)
  values (1, $1, 'Séance', current_date + $2::int) returning id`, [team, days])).rows[0].id);
const set = (uid, n, m = []) => one(uid, 'select public.soreness_set($1, $2) r', [n, m]);
// Jours passés : écrits directement (la fonction ne travaille que sur aujourd'hui).
const past = (player, days, n, m) => q(`insert into public.player_soreness (club_id, player_id, jour, niveau, muscles)
  values (1, $1, current_date - $2::int, $3, $4)`, [player, days, n, m]);

/* ---------- 1. Pas de séance aujourd'hui : fermé ---------- */
await ses(1, 1);
await ko(JOUEUR, 'select public.soreness_set($1, $2)', [3, ['mollets']], /Pas de séance aujourd’hui/, 'séance demain seulement');
await ses(2, 0);
await ko(JOUEUR, 'select public.soreness_set($1, $2)', [3, ['mollets']], /Pas de séance aujourd’hui/, 'séance du jour d’une autre équipe');
const S1 = await ses(1, 0);
assert.deepEqual(await rows(JOUEUR, 'select session_id, niveau from public.my_soreness_today()'), [{ session_id: S1, niveau: null }], 'séance du jour, pas encore répondu');

/* ---------- 2. Réponses ---------- */
assert.deepEqual((await set(JOUEUR, 0, ['mollets'])).r, { niveau: 0, muscles: [], alerte: false }, '0 : fin du questionnaire, muscles ignorés');
await ko(JOUEUR, 'select public.soreness_set($1, $2)', [4, []], /au moins un muscle/, '1 à 10 sans muscle');
await ko(JOUEUR, 'select public.soreness_set($1, $2)', [4, ['nuque']], /inconnu/, 'muscle inconnu');
for (const bad of [-1, 11]) await ko(JOUEUR, 'select public.soreness_set($1, $2)', [bad, ['mollets']], /0 à 10/, `niveau ${bad}`);
assert.deepEqual((await set(JOUEUR, 4, ['mollets', 'biceps', 'mollets'])).r, { niveau: 4, muscles: ['biceps', 'mollets'], alerte: false }, 'il se reprend : même jour, même ligne');
assert.equal((await one(ADMIN, 'select count(*)::int n from public.player_soreness where player_id = 1')).n, 1);
await ko(ADMIN, 'select public.soreness_set($1, $2)', [2, ['mollets']], /réservé aux joueurs/, 'un compte staff ne répond pas');
await ko(JOUEUR, `insert into public.player_soreness (club_id, player_id, jour, niveau) values (1, 1, current_date - 9, 0)`, [], DENIED, 'aucune écriture directe');

/* ---------- 3. Alerte : 3 jours de calendrier, même muscle ---------- */
await past(1, 1, 5, ['mollets', 'quadriceps']);
await past(1, 2, 3, ['mollets']);
assert.deepEqual((await set(JOUEUR, 4, ['mollets', 'quadriceps'])).r.alerte, true, 'mollets aujourd’hui, hier, avant-hier');
assert.deepEqual((await one(ADMIN, 'select muscles from public.soreness_alerts where player_id = 1')).muscles, ['mollets'], 'quadriceps : 2 jours seulement');
await set(JOUEUR, 4, ['mollets']);
assert.equal((await one(ADMIN, 'select count(*)::int n from public.soreness_alerts')).n, 1, 'une alerte par jour');
assert.equal((await set(JOUEUR, 2, ['biceps'])).r.alerte, false, 'corrigé le jour même : plus d’alerte');
assert.equal((await one(ADMIN, 'select count(*)::int n from public.soreness_alerts')).n, 0, 'alerte pas encore vue retirée');
// Joueur 2 : un trou (pas de réponse hier) remet à zéro.
await past(2, 2, 3, ['dorsaux']); await past(2, 3, 3, ['dorsaux']);
assert.equal((await set(J2, 3, ['dorsaux'])).r.alerte, false, 'un jour sans réponse : pas de série');
await set(JOUEUR, 4, ['mollets']);

/* ---------- 4. Qui lit ---------- */
const seen = async (uid, t) => (await rows(uid, `select player_id from public.${t} order by player_id, jour`)).map(r => Number(r.player_id));
assert.deepEqual(await seen(JOUEUR, 'player_soreness'), [1, 1, 1], 'le joueur : les siennes');
assert.deepEqual(await seen(J2, 'player_soreness'), [2, 2, 2], 'l’autre joueur : les siennes');
assert.deepEqual(await seen(N2, 'player_soreness'), [1, 1, 1, 2, 2, 2], 'coach N2 : ses joueurs');
assert.deepEqual(await seen(PREPA, 'soreness_alerts'), [1], 'prépa N2 : l’alerte');
for (const who of [U19, SCOUT]) {
  assert.deepEqual(await seen(who, 'player_soreness'), [], `${who} : rien`);
  assert.deepEqual(await seen(who, 'soreness_alerts'), [], `${who} : aucune alerte`);
}

/* ---------- 5. Appareils à prévenir, une seule fois ---------- */
const sub = (uid, n) => q(`insert into public.push_subscriptions (user_id, club_id, endpoint, p256dh, auth) values ($1, 1, $2, $3, $4)`,
  [uid, `https://fcm.googleapis.com/fcm/send/${n}`, 'B'.repeat(87), 'a'.repeat(22)]);
await sub(N2, 'coach'); await sub(PREPA, 'prepa'); await sub(U19, 'u19'); await sub(SCOUT, 'scout'); await sub(JOUEUR, 'joueur');
assert.deepEqual((await one(N2, 'select public.soreness_notifs_take() r')).r.messages, [], 'le staff n’envoie rien : seul le joueur déclenche');
const msg = (await one(JOUEUR, 'select public.soreness_notifs_take() r')).r.messages;
assert.equal(msg.length, 1);
assert.deepEqual([msg[0].title, msg[0].body, msg[0].url], ['Courbatures : Yanis ADAME', '3 jours de suite : mollets.', 'suivi-rpe.html?vue=courbatures']);
assert.deepEqual(msg[0].subs.map(s => s.endpoint.split('/').pop()).sort(), ['coach', 'prepa'], 'staff qui suit le joueur ; ni U19, ni lecteur, ni le joueur');
assert.deepEqual((await one(JOUEUR, 'select public.soreness_notifs_take() r')).r.messages, [], 'déjà envoyée : rien la 2e fois');

/* ---------- 6. « Vu » ---------- */
const alert = (await one(ADMIN, 'select id from public.soreness_alerts')).id;
await ko(U19, 'select public.soreness_alert_seen($1)', [alert], /réservée/, 'coach d’une autre équipe');
await ko(SCOUT, 'select public.soreness_alert_seen($1)', [alert], /réservée/, 'lecteur');
await ko(JOUEUR, 'select public.soreness_alert_seen($1)', [alert], /réservée/, 'joueur');
assert.equal((await one(N2, 'select public.soreness_alert_seen($1) r', [alert])).r, true);
assert.equal((await one(ADMIN, 'select vu_par from public.soreness_alerts')).vu_par, N2, 'vue, et par qui');
await set(JOUEUR, 1, ['biceps']);
assert.equal((await one(ADMIN, 'select count(*)::int n from public.soreness_alerts')).n, 1, 'une alerte vue reste, même si la réponse change');

/* ---------- 7. Règles lecteur, anonyme ---------- */
for (const t of ['player_soreness', 'soreness_alerts']) {
  assert.deepEqual((await rows(ADMIN, `select policyname from pg_policies where tablename = $1 and permissive = 'RESTRICTIVE' order by 1`, [t]))
    .map(r => r.policyname), ['lecteur_no_delete', 'lecteur_no_insert', 'lecteur_no_read', 'lecteur_no_update'], `${t} : règles lecteur`);
}
assert.equal((await q(`select has_function_privilege('anon', 'public.soreness_set(integer, text[])', 'execute') a`)).rows[0].a, false);

console.log('soreness-sql : OK (jour de séance, réponses, série de 3 jours, confidentialité, appareils, vu, lecteur)');
