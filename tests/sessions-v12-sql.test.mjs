/* Durées à virgule et statuts (supabase/lmfc_v12.sql) sur un vrai Postgres
   (PGlite, WASM), à partir des colonnes entières d'avant la migration.
   Lancement : npm i --no-save @electric-sql/pglite && node tests/sessions-v12-sql.test.mjs
   (sans PGlite installé, le test est ignoré). */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.log('sessions-v12-sql : ignoré (npm i --no-save @electric-sql/pglite pour le lancer)');
  process.exit(0);
}
const read = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8');
const db = new PGlite();
const q = (s, p) => db.query(s, p);
const one = async (s, p) => (await q(s, p)).rows[0];

// Colonnes telles qu'en production avant la migration (schema.sql, add_procedure_sequences.sql, lmfc_v9.sql).
await db.exec(`
create table public.sessions (id bigint generated always as identity primary key, titre text not null, duree_min int default 90);
create table public.procedures (id bigint generated always as identity primary key, session_id bigint not null references public.sessions on delete cascade,
  nom text not null default 'Procédé', duree_min int default 20, temps_recup_min int, nb_sequences int,
  duree_sequence_min numeric(5,1) check (duree_sequence_min is null or duree_sequence_min > 0));
create table public.attendance (id bigint generated always as identity primary key, player_id bigint not null, session_id bigint not null,
  present boolean default false, statut text, invite boolean not null default false, unique (player_id, session_id));
alter table public.attendance add constraint attendance_statut_check check (statut is null
  or statut in ('present', 'reprise', 'retard', 'absent', 'excuse', 'blesse', 'malade', 'selection'));
create function public.attendance_sync_present() returns trigger language plpgsql as $$
begin if new.statut is not null then new.present := new.statut in ('present', 'reprise', 'retard'); end if; return new; end; $$;
create trigger trg_attendance_present before insert or update on public.attendance for each row execute function public.attendance_sync_present();
insert into public.sessions (titre) values ('Séance');
insert into public.procedures (session_id, nom, duree_min, temps_recup_min, nb_sequences, duree_sequence_min) values (1, 'Ancien', 20, 1, 3, 4);
insert into public.attendance (player_id, session_id, statut) values (1, 1, 'retard'), (2, 1, 'malade');
`);
// Comme l'API (PostgREST) : le corps JSON passe par json_populate_record, qui refusait 11.5 pour un entier.
const viaApi = (json) => q(`insert into public.procedures overriding system value select * from json_populate_record(null::public.procedures, $1)`, [json]);
await assert.rejects(viaApi(JSON.stringify({ id: 50, session_id: 1, nom: 'Toro', duree_min: 11.5 })), /integer/, 'avant : 11,5 refusé (le bug)');
await db.exec(read('lmfc_v12.sql'));
await db.exec(read('lmfc_v12.sql'));   // rejouable

// 1) Durées décimales enregistrées telles quelles ; les anciennes valeurs restent.
assert.equal((await one(`select duree_min from public.procedures where nom = 'Ancien'`)).duree_min, '20.00');
await viaApi(JSON.stringify({ id: 50, session_id: 1, nom: 'Toro', duree_min: 11.5, temps_recup_min: 1, nb_sequences: 5, duree_sequence_min: 1.5 }));
await q(`insert into public.procedures (session_id, nom, duree_min, temps_recup_min, nb_sequences, duree_sequence_min) values (1, 'Rondo', 3.5, 0.5, 3, 1.25)`);
const r = await one(`select duree_min, temps_recup_min, duree_sequence_min from public.procedures where nom = 'Rondo'`);
assert.deepEqual([r.duree_min, r.temps_recup_min, r.duree_sequence_min], ['3.50', '0.50', '1.25'], 'récup 0,5 et séquence 1,25 gardées');
await assert.rejects(q(`update public.procedures set duree_sequence_min = 0 where nom = 'Toro'`), /check/, 'contrainte > 0 conservée');
await q(`update public.sessions set duree_min = 87.5`);
assert.equal((await one(`select duree_min from public.sessions`)).duree_min, '87.50');

// 2) Statuts : anciens conservés, groupe pro hors séance, « autre » suit la case participe.
const st = async (pid) => one(`select statut, statut_libre, present from public.attendance where player_id = $1`, [pid]);
assert.deepEqual(await st(1), { statut: 'retard', statut_libre: null, present: true }, 'ancien statut gardé');
await q(`insert into public.attendance (player_id, session_id, statut, present) values (3, 1, 'groupe_pro', true)`);
assert.equal((await st(3)).present, false, 'groupe pro : ne participe pas');
await q(`insert into public.attendance (player_id, session_id, statut, statut_libre, present) values (4, 1, 'autre', 'Soins', false), (5, 1, 'autre', 'Adapté', true)`);
assert.deepEqual(await st(4), { statut: 'autre', statut_libre: 'Soins', present: false });
assert.deepEqual(await st(5), { statut: 'autre', statut_libre: 'Adapté', present: true }, 'participe coché');
await q(`update public.attendance set statut = 'present', present = false where player_id = 5`);
assert.deepEqual(await st(5), { statut: 'present', statut_libre: null, present: true }, 'retour à un statut connu : motif effacé');
await assert.rejects(q(`update public.attendance set statut = 'vacances' where player_id = 1`), /check/, 'statut inconnu refusé');
await assert.rejects(q(`update public.attendance set statut = 'autre', statut_libre = repeat('x', 41) where player_id = 1`), /check/, 'motif limité à 40 caractères');

console.log('sessions-v12-sql : OK (2 scénarios)');
