/* Données GPS (supabase/lmfc_v32.sql) sur un vrai Postgres (PGlite), RLS
   active : import en une transaction (gps_import_save), même fichier refusé
   tant qu'il n'est pas annulé, annulation, droits par rôle et par joueur,
   joueur limité à my_gps() et aux indicateurs ouverts ; et ce que le staff
   masque au joueur retiré par la base (my_physical_*). Migration passée
   deux fois.
   Lancement : PGlite installé hors du projet, relié en node_modules,
   puis node tests/gps-sql.test.mjs (sans PGlite : échec). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { libraryDb, USERS } from './library-db.mjs';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.error('gps-sql : PGlite absent, test NON lancé');
  process.exit(1);
}
const { ADMIN, N2, U19, PREPA, PREPA19, SCOUT, JOUEUR } = USERS;
const { db, q, rows, one, ko } = await libraryDb(PGlite);
const read = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8');
const fn = (file, name) => { const s = read(file), a = s.indexOf(`create or replace function public.${name}(`); return s.slice(a, s.indexOf('\n$$;', a) + 4); };
const DENIED = /row-level security|permission denied/;

// Joueurs : 1 ADAME (N2, compte JOUEUR), 2 BARAKAT (N2), 3 CISSE (U19) ; tables physiques réduites à leurs colonnes.
await db.exec(`alter table public.players add column auth_user_id uuid, add column other_team_ids bigint[] not null default '{}',
    add column hidden_sections text[] not null default '{}';
  update public.players set auth_user_id = '${JOUEUR}' where id = 1;
  insert into public.players (club_id, nom, team_id) values (1, 'BARAKAT', 1), (1, 'CISSE', 2);
  create table public.staff_player_access (profile_id uuid, player_id bigint, niveau text);
  ${fn('lmfc_v22.sql', 'player_level_for')}
  ${fn('lmfc_v19.sql', 'player_level')}
  create table public.player_physical_measurements (id bigint generated always as identity primary key, player_id bigint, season_key text, month_label text,
    measured_at date, height_cm numeric, weight_kg numeric, body_fat_pct numeric);
  create table public.player_physical_tests (id bigint generated always as identity primary key, player_id bigint, season_key text, stage text, tested_at date,
    sprint10_sec numeric, five05_left_sec numeric, five05_right_sec numeric, five05_avg_sec numeric, sprint40_sec numeric, vift_kmh numeric,
    shirado_sec numeric, sorensen_sec numeric, profile_start numeric, profile_agility numeric, profile_speed numeric, profile_endurance numeric,
    profile_core numeric, source text, updated_at timestamptz);
  insert into public.player_physical_measurements (player_id, season_key, month_label, height_cm, weight_kg, body_fat_pct) values (1, '2026-2027', 'Octobre', 180, 75, 11);
  insert into public.player_physical_tests (player_id, season_key, stage, sprint10_sec, sprint40_sec, profile_speed) values (1, '2026-2027', 'pre', 1.72, 5.1, 7.5);`);
for (const f of ['lmfc_v32.sql', 'lmfc_v32.sql']) await db.exec(read(f));
await db.exec('grant usage on all sequences in schema public to authenticated;');

const HASH = 'a'.repeat(64), HASH2 = 'b'.repeat(64);
const imp = (hash, players, extra = {}) => ({ team_id: 1, date_seance: '2026-10-29', libelle: 'S.L. TFC J-2', fichier: 'S.L. TFC J-2_Full Training.csv',
  file_hash: hash, colonnes: [{ header: 'Distance totale', key: 'distance', unit: 'm' }], ...extra, players });
const save = (uid, i, aliases = []) => one(uid, 'select public.gps_import_save($1::jsonb, $2::jsonb, $3::jsonb) id', [JSON.stringify(i),
  JSON.stringify(i.players.map(id => ({ player_id: id, nom_lu: `JOUEUR ${id}`, raw: { 'Distance totale': '4473' }, metrics: { distance: 4473 + id, vmax: 25.5, sprints: id } }))),
  JSON.stringify(aliases)]);

/* ---------- 1. Qui importe ---------- */
const I1 = Number((await save(PREPA, imp(HASH, [1, 2]), [{ nom_lu: 'adame', player_id: 1 }])).id);
assert.ok(I1 > 0, 'le préparateur de l’équipe importe');
await ko(PREPA, 'select public.gps_import_save($1::jsonb, $2::jsonb)', [JSON.stringify(imp(HASH, [1])),
  JSON.stringify([{ player_id: 1, nom_lu: 'X', raw: {}, metrics: {} }])], /duplicate key|unique/, 'le même fichier : refusé');
await ko(N2, 'select public.gps_import_save($1::jsonb, $2::jsonb)', [JSON.stringify(imp(HASH2, [1])),
  JSON.stringify([{ player_id: 1, nom_lu: 'X', raw: {}, metrics: {} }])], DENIED, 'un coach consulte, n’importe pas');
await ko(PREPA19, 'select public.gps_import_save($1::jsonb, $2::jsonb)', [JSON.stringify(imp(HASH2, [1])),
  JSON.stringify([{ player_id: 1, nom_lu: 'X', raw: {}, metrics: {} }])], DENIED, 'préparateur U19 : pas sur un joueur N2');
assert.equal((await one(ADMIN, 'select count(*)::int n from public.gps_imports')).n, 1, 'un refus n’a rien laissé (une transaction)');
await ko(PREPA, `update public.gps_rows set metrics = '{}' returning id`, [], DENIED, 'valeurs jamais modifiées');

/* ---------- 2. Qui lit ---------- */
const seen = async (uid) => (await rows(uid, 'select player_id from public.gps_rows order by player_id')).map(r => Number(r.player_id));
assert.deepEqual(await seen(ADMIN), [1, 2]);
assert.deepEqual(await seen(N2), [1, 2], 'coach N2 : lecture');
assert.deepEqual(await seen(U19), [], 'coach U19 : rien sur la N2');
assert.deepEqual(await seen(SCOUT), [], 'lecteur : rien');
assert.deepEqual(await seen(JOUEUR), [], 'joueur : aucune lecture directe');
assert.deepEqual((await rows(N2, 'select nom_lu, player_id from public.gps_player_aliases')).map(r => `${r.nom_lu}:${r.player_id}`), ['adame:1'], 'correspondance mémorisée');

/* ---------- 3. Joueur : seulement les indicateurs ouverts ---------- */
const mine = async () => (await rows(JOUEUR, 'select libelle, metrics from public.my_gps()')).map(r => [r.libelle, r.metrics]);
assert.deepEqual(await mine(), [], 'aucun indicateur ouvert par défaut');
await ko(N2, `insert into public.gps_settings (club_id, player_metrics) values (1, '{distance}')`, [], DENIED, 'le coach n’ouvre rien');
await one(ADMIN, `insert into public.gps_settings (club_id, player_metrics) values (1, '{distance,vmax}') returning club_id`);
assert.deepEqual(await mine(), [['S.L. TFC J-2', { distance: 4474, vmax: 25.5 }]], 'distance et vitesse max, pas les sprints');

/* ---------- 4. Annuler, réimporter ---------- */
assert.equal((await one(PREPA, 'select public.gps_import_cancel($1) ok', [I1])).ok, true);
assert.deepEqual(await mine(), [], 'import annulé : ses valeurs sortent des fiches');
assert.ok((await one(ADMIN, 'select annule_at, annule_par from public.gps_imports where id = $1', [I1])).annule_par, 'gardé dans l’historique, avec qui l’a annulé');
const I2 = Number((await save(PREPA, imp(HASH, [1]))).id);
assert.ok(I2 > I1, 'le même fichier se réimporte après annulation');
assert.deepEqual((await mine()).length, 1);
for (const uid of [SCOUT, N2]) assert.equal((await one(uid, 'select public.gps_import_cancel($1) ok', [I2])).ok, false, `${uid} : n'annule rien`);
assert.equal((await one(ADMIN, 'select annule_at from public.gps_imports where id = $1', [I2])).annule_at, null, 'toujours actif');

/* ---------- 5. Ce que le staff masque au joueur : retiré par la base ---------- */
await q(`update public.players set hidden_sections = '{test:sprint10_sec,radar,mesure:weight_kg}' where id = 1`);
assert.deepEqual(await one(JOUEUR, 'select sprint10_sec, sprint40_sec, profile_speed from public.my_physical_tests()'),
  { sprint10_sec: null, sprint40_sec: '5.1', profile_speed: null }, 'test et radar masqués : absents, le reste visible');
assert.deepEqual(await one(JOUEUR, 'select height_cm, weight_kg from public.my_physical_measurements()'), { height_cm: '180', weight_kg: null });
await q(`update public.players set hidden_sections = '{suivi}' where id = 1`);
assert.equal((await rows(JOUEUR, 'select * from public.my_physical_measurements()')).length, 0, 'suivi masqué : aucune mesure');

console.log('gps-sql : OK (import, doublon, droits, my_gps, annulation, sections masquées)');
