/* Verrou de la sauvegarde automatique (supabase/lmfc_v13.sql) sur un vrai
   Postgres (PGlite, WASM) : chaque mise à jour change sessions.updated_at,
   et une écriture conditionnée à l'ancienne valeur ne passe plus.
   Lancement : npm i --no-save @electric-sql/pglite && node tests/sessions-v13-sql.test.mjs
   (sans PGlite installé, le test est ignoré). */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.log('sessions-v13-sql : ignoré (npm i --no-save @electric-sql/pglite pour le lancer)');
  process.exit(0);
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

console.log('sessions-v13-sql : OK (verrou)');
