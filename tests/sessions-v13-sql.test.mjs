/* Verrou de la sauvegarde automatique (supabase/lmfc_v13.sql) sur un vrai
   Postgres (PGlite, WASM) : chaque mise à jour change sessions.updated_at,
   et une écriture conditionnée à l'ancienne valeur ne passe plus.
   Lancement : npm i --no-save @electric-sql/pglite && node tests/sessions-v13-sql.test.mjs
   (sans PGlite installé, le test est ignoré). */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.error('sessions-v13-sql : PGlite absent, test NON lancé (npm i --no-save @electric-sql/pglite)');
  process.exit(1);
}
const db = new PGlite();
const one = async (s, p) => (await db.query(s, p)).rows[0];
await db.exec(`create table public.sessions (id bigint generated always as identity primary key, titre text not null,
  created_at timestamptz default now(), updated_at timestamptz default now());
  insert into public.sessions (titre) values ('Séance');`);
const sql = readFileSync(new URL('../supabase/lmfc_v13.sql', import.meta.url), 'utf8');
await db.exec(sql);
await db.exec(sql);   // rejouable

const t0 = (await one(`select updated_at from public.sessions`)).updated_at;
// Onglet A enregistre : la date change.
const a = await one(`update public.sessions set titre = 'A' where id = 1 and updated_at = $1 returning updated_at`, [t0]);
assert.ok(a && a.updated_at > t0, 'la mise à jour avance updated_at');
// Onglet B, ouvert avant, tente d'enregistrer avec l'ancienne date : rien n'est écrit.
assert.equal((await db.query(`update public.sessions set titre = 'B' where id = 1 and updated_at = $1 returning id`, [t0])).rows.length, 0, 'écriture refusée');
assert.equal((await one(`select titre from public.sessions`)).titre, 'A', 'le travail de A est gardé');
// A continue avec la date reçue : ça passe.
assert.ok(await one(`update public.sessions set titre = 'A2' where id = 1 and updated_at = $1 returning id`, [a.updated_at]));

// lmfc_v15.sql : terrain d'effectif, un objet { id: [x, y] } (vide par défaut).
const v15 = readFileSync(new URL('../supabase/lmfc_v15.sql', import.meta.url), 'utf8');
await db.exec(v15);
await db.exec(v15);   // rejouable
assert.deepEqual((await one(`select terrain from public.sessions`)).terrain, {}, 'vide par défaut');
await db.query(`update public.sessions set terrain = '{"7": [50, 12.5]}'`);
assert.deepEqual((await one(`select terrain from public.sessions`)).terrain, { 7: [50, 12.5] });
await assert.rejects(db.query(`update public.sessions set terrain = '[]'`), /check/, 'un objet seulement');

// lmfc_v17.sql : la version d'un schéma suit chaque écriture (adresse de l'image).
await db.exec(`create table public.tactical_schemas (id bigint generated always as identity primary key,
  procedure_id bigint not null unique, canvas_json jsonb, image_path text, vue_terrain text default 'complet', updated_at timestamptz default now());`);
const v17 = readFileSync(new URL('../supabase/lmfc_v17.sql', import.meta.url), 'utf8');
await db.exec(v17);
await db.exec(v17);   // rejouable
// Époque en microsecondes : deux écritures peuvent tomber dans la même milliseconde.
const s1 = await one(`insert into public.tactical_schemas (procedure_id, image_path, updated_at) values (1, 'a.png', '2000-01-01')
  returning extract(epoch from updated_at)::numeric as t`);
assert.ok(Number(s1.t) > Date.parse('2020-01-01') / 1000, 'date posée à la création, même si on en envoie une autre');
// L'horloge de PGlite ne compte qu'en millisecondes (Postgres : en microsecondes) :
// deux écritures d'un vrai client ne tombent jamais dans la même milliseconde.
await new Promise(r => setTimeout(r, 5));
const s2 = await one(`insert into public.tactical_schemas (procedure_id, image_path) values (1, 'b.png')
  on conflict (procedure_id) do update set image_path = excluded.image_path returning extract(epoch from updated_at)::numeric as t, image_path`);
assert.equal(s2.image_path, 'b.png');
assert.ok(Number(s2.t) > Number(s1.t), 'upsert : nouvelle version');

console.log('sessions-v13-sql : OK (verrou, terrain d’effectif, version des schémas)');
