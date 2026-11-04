/* lmfc_v37.sql sur un vrai Postgres (PGlite), RLS active :
   1) club_link_player réattribue : un compte change de fiche, une fiche
      change de compte ; admin du club seulement ;
   2) matches.hors_plateforme : une liste, 30 au plus ;
   3) schémas enregistrés : créateur posé par la base, privé par défaut,
      partagé avec le club au choix du créateur ; l'admin voit tout et
      seul lui attribue ; les anciens (sans créateur) restent partagés ;
      ni joueur ni lecteur ; la corbeille le rend à son créateur.
      Migration passée deux fois.
   Lancement : PGlite installé hors du projet, relié en node_modules,
   puis node tests/v37-sql.test.mjs (sans PGlite : échec). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { libraryDb, USERS } from './library-db.mjs';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.error('v37-sql : PGlite absent, test NON lancé');
  process.exit(1);
}
const { ADMIN, N2, N2B, PREPA, SCOUT, JOUEUR, AUTRE } = USERS;
const J2 = '00000000-0000-0000-0000-000000000099';
const { db, q, rows, one, ko } = await libraryDb(PGlite);
const read = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8');
const fn = (file, name) => { const s = read(file), a = s.indexOf(`create or replace function public.${name}(`); return s.slice(a, s.indexOf('\n$$;', a) + 4); };

// Fiches (une dans l'autre club), un 2e compte joueur, les schémas tels que schema.sql les crée avec
// un ancien schéma sans créateur, ce que v37 reprend (matchs, RPE, calendrier), puis v37 deux fois.
await db.exec(`alter table public.players add column auth_user_id uuid unique, add column other_team_ids bigint[] not null default '{}';
  create table public.staff_player_access (profile_id uuid, player_id bigint, niveau text);
  ${fn('lmfc_v22.sql', 'player_level_for')}
  ${fn('lmfc_v19.sql', 'player_level')}
  insert into public.players (club_id, nom, team_id) values (1, 'BARAKAT', 1), (1, 'DUPONT', 1), (2, 'AILLEURS', null);
  insert into auth.users values ('${J2}'); insert into public.profiles (id, club_id, role, nom) values ('${J2}', 1, 'coach', 'Compte 2');
  create table public.exercise_templates (id bigint generated always as identity primary key,
    club_id bigint not null references public.clubs on delete cascade, created_by uuid, nom text not null, categorie text,
    data jsonb, canvas_json jsonb, image_path text, created_at timestamptz default now());
  alter table public.exercise_templates enable row level security;
  create policy templates_read on public.exercise_templates for select using (club_id = public.my_club_id());
  create policy templates_write on public.exercise_templates for all
    using (club_id = public.my_club_id() and public.can_edit()) with check (club_id = public.my_club_id() and public.can_edit());
  grant select, insert, update, delete on public.exercise_templates to authenticated;
  create trigger trash_capture before delete on public.exercise_templates for each row execute function public.trash_capture('root', '');
  insert into public.exercise_templates (club_id, nom) values (1, 'Ancien rondo');`);
for (const f of ['lmfc_v11.sql', 'lmfc_v27.sql', 'lmfc_v28.sql', 'lmfc_v29.sql', 'lmfc_v30.sql', 'lmfc_v37.sql', 'lmfc_v37.sql']) await db.exec(read(f));
await db.exec('grant usage on all sequences in schema public to authenticated;');

/* ---------- 1. Fiche ↔ compte ---------- */
const link = (uid, profile, player) => one(uid, 'select public.club_link_player($1, $2)', [profile, player]);
const owners = async () => Object.fromEntries((await q('select id, auth_user_id from public.players where club_id = 1 order by id')).rows
  .map(r => [Number(r.id), r.auth_user_id]));
await link(ADMIN, JOUEUR, 1);
await link(ADMIN, JOUEUR, 2);
assert.deepEqual(await owners(), { 1: null, 2: JOUEUR, 3: null }, 'le compte change de fiche (avant : « déjà associé à une autre fiche »)');
await link(ADMIN, J2, 2);
assert.deepEqual(await owners(), { 1: null, 2: J2, 3: null }, 'la fiche change de compte, l’ancien compte la quitte');
assert.equal((await q(`select role from public.profiles where id = '${J2}'`)).rows[0].role, 'joueur', 'le compte devient joueur');
await ko(N2, 'select public.club_link_player($1, $2)', [JOUEUR, 1], /réservée à l’administrateur/, 'un coach ne lie pas');
await ko(AUTRE, 'select public.club_link_player($1, $2)', [JOUEUR, 1], /ne fait pas partie de votre club/, 'admin d’un autre club');
await ko(ADMIN, 'select public.club_link_player($1, $2)', [JOUEUR, 4], /fiche joueur ne fait pas partie/, 'fiche d’un autre club');
await ko(ADMIN, 'select public.club_link_player($1, $2)', [ADMIN, 1], /vous-même/, 'pas soi-même');

/* ---------- 2. Joueurs hors plateforme d'un match ---------- */
const m = Number((await q(`insert into public.matches (club_id, team_id, adversaire, date_match) values (1, 1, 'LES SABLES VF', '2026-10-17') returning id`)).rows[0].id);
assert.deepEqual((await q('select hors_plateforme from public.matches where id = $1', [m])).rows[0].hors_plateforme, [], 'vide par défaut');
const extras = [{ nom: 'AUGUSTIN DELBECQUE', numero: 1, statut: 'titulaire', minutes: 90 }, { nom: 'RAUL TORRENTE NAVARRO', numero: 3, statut: 'titulaire', minutes: 90 }];
assert.equal((await rows(N2, 'update public.matches set hors_plateforme = $1 where id = $2 returning id', [JSON.stringify(extras), m])).length, 1, 'le coach les enregistre');
await assert.rejects(q('update public.matches set hors_plateforme = $1 where id = $2', ['{"nom":"X"}', m]), /hors_plateforme_check/, 'une liste seulement');
await assert.rejects(q('update public.matches set hors_plateforme = $1 where id = $2', [JSON.stringify(Array(31).fill({ nom: 'X' })), m]), /hors_plateforme_check/, '30 au plus');

/* ---------- 3. Schémas : créateur et partage ---------- */
const seen = async (uid) => (await rows(uid, 'select nom from public.exercise_templates order by id')).map(r => r.nom);
assert.deepEqual((await q('select created_by, partage from public.exercise_templates')).rows, [{ created_by: null, partage: true }], 'ancien : sans créateur, partagé');
const mine = Number((await one(N2, `insert into public.exercise_templates (club_id, nom, created_by) values (1, 'Toro N2', '${ADMIN}') returning id`)).id);
assert.deepEqual((await q('select created_by, partage from public.exercise_templates where id = $1', [mine])).rows[0], { created_by: N2, partage: false }, 'créateur posé par la base, privé');
assert.deepEqual(await seen(N2), ['Ancien rondo', 'Toro N2'], 'le créateur : les siens et les partagés');
assert.deepEqual(await seen(N2B), ['Ancien rondo'], 'un autre coach : pas le schéma privé');
assert.deepEqual(await seen(PREPA), ['Ancien rondo'], 'prépa : les partagés');
assert.deepEqual(await seen(ADMIN), ['Ancien rondo', 'Toro N2'], 'l’admin voit tout');
for (const who of [JOUEUR, SCOUT]) assert.deepEqual(await seen(who), [], `${who} : rien`);

assert.equal((await rows(N2B, 'update public.exercise_templates set nom = $1 where id = $2 returning id', ['Pris', mine])).length, 0, 'un autre coach ne modifie pas');
await rows(N2, 'update public.exercise_templates set partage = true, created_by = $1 where id = $2', [N2B, mine]);
assert.deepEqual((await q('select created_by, partage from public.exercise_templates where id = $1', [mine])).rows[0], { created_by: N2, partage: true }, 'il partage, mais ne donne pas son schéma');
assert.deepEqual(await seen(N2B), ['Ancien rondo', 'Toro N2'], 'partagé : tout le staff le voit');
assert.equal((await rows(N2B, 'delete from public.exercise_templates where id = $1 returning id', [mine])).length, 0, 'partagé n’est pas à lui : pas de suppression');
assert.equal((await rows(N2B, `update public.exercise_templates set nom = 'x' where nom = 'Ancien rondo' returning id`)).length, 0, 'ancien sans créateur : l’admin seul le modifie');

// L'admin attribue l'ancien schéma à son créateur : il devient le sien, privé.
assert.equal((await rows(ADMIN, `update public.exercise_templates set created_by = $1, partage = false where nom = 'Ancien rondo' returning id`, [N2B])).length, 1);
assert.deepEqual(await seen(N2B), ['Ancien rondo', 'Toro N2'], 'N2B : le sien (attribué) et le partagé');
assert.deepEqual(await seen(N2), ['Toro N2'], 'N2 : plus l’ancien, désormais privé à N2B');
assert.equal((await rows(N2B, `delete from public.exercise_templates where nom = 'Ancien rondo' returning id`)).length, 1, 'son créateur le supprime');
assert.equal((await rows(ADMIN, 'delete from public.exercise_templates where id = $1 returning id', [mine])).length, 1, 'l’admin aussi');
// Corbeille : l'admin restaure, le schéma reste à son créateur.
const root = (await one(ADMIN, `select id from public.trash where tbl = 'exercise_templates' and row_id = $1`, [mine])).id;
await one(ADMIN, 'select public.trash_restore($1)', [[root]]);
assert.deepEqual((await q('select created_by, partage from public.exercise_templates where id = $1', [mine])).rows[0], { created_by: N2, partage: true }, 'restauré : toujours à son créateur');

console.log('v37-sql : OK (fiche ↔ compte réattribuée, joueurs hors plateforme, schémas : créateur, partage, attribution)');
