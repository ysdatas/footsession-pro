/* Miniatures des vidéos (supabase/lmfc_v18.sql) sur un vrai Postgres
   (PGlite) : seule une petite image JPEG en data URL est acceptée, la
   migration est rejouable et garde les miniatures déjà prises.
   Lancement : npm i --no-save @electric-sql/pglite && node tests/video-thumbs-sql.test.mjs
   (sans PGlite installé, le test est ignoré). */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.error('video-thumbs-sql : PGlite absent, test NON lancé (npm i --no-save @electric-sql/pglite)');
  process.exit(1);
}
const db = new PGlite();
await db.exec(`
create table public.player_videos (id bigint generated always as identity primary key, titre text);
create table public.video_sequences (id bigint generated always as identity primary key, label text);
insert into public.player_videos (titre) values ('Match'); insert into public.video_sequences (label) values ('Action');`);
const sql = readFileSync(new URL('../supabase/lmfc_v18.sql', import.meta.url), 'utf8');
await db.exec(sql);

const JPEG = 'data:image/jpeg;base64,' + 'A'.repeat(9000);   // ~9 Ko, une vraie miniature fait 6 à 15 Ko
for (const t of ['video_sequences', 'player_videos']) {
  await db.query(`update public.${t} set thumb = $1 where id = 1`, [JPEG]);
  await assert.rejects(db.query(`update public.${t} set thumb = $1 where id = 1`, ['data:image/png;base64,AAAA']), /thumb_check/, `${t} : JPEG seulement`);
  await assert.rejects(db.query(`update public.${t} set thumb = $1 where id = 1`, ['https://ailleurs.test/x.jpg']), /thumb_check/, `${t} : pas d'adresse externe`);
  await assert.rejects(db.query(`update public.${t} set thumb = $1 where id = 1`, ['data:image/jpeg;base64,' + 'A'.repeat(70000)]), /thumb_check/, `${t} : taille bornée`);
  await db.query(`update public.${t} set thumb = null where id = 1`);   // découpage modifié : miniature à reprendre
  await db.query(`update public.${t} set thumb = $1 where id = 1`, [JPEG]);
}
await db.exec(sql);   // rejouable, miniatures gardées
assert.equal((await db.query(`select thumb from public.video_sequences where id = 1`)).rows[0].thumb, JPEG);

console.log('video-thumbs-sql : OK (JPEG data URL bornée, rejouable)');
