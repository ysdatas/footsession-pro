/* Dossiers de la bibliothèque vidéo (supabase/lmfc_v31.sql) sur un vrai
   Postgres (PGlite), RLS active : création sans doublon, droits, vidéo
   créée dans un dossier, déplacement, dossier d'un autre club refusé,
   suppression d'un dossier sans perdre de vidéo, recherche dossier + tags
   + texte, nombres par dossier. Migration passée deux fois (library-db.mjs).
   Lancement : PGlite installé hors du projet, relié en node_modules,
   puis node tests/library-folders-sql.test.mjs (sans PGlite : échec). */
import assert from 'node:assert/strict';
import { libraryDb, USERS } from './library-db.mjs';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.error('library-folders-sql : PGlite absent, test NON lancé');
  process.exit(1);
}
const { ADMIN, N2, PREPA, SCOUT, JOUEUR, AUTRE } = USERS;
const { q, rows, one, ko, file, item } = await libraryDb(PGlite);
const RLS = /row-level security|permission denied/;

/* ---------- 1. Créer, sans doublon ; qui peut ---------- */
const folder = async (uid, nom) => Number((await one(uid, 'insert into public.library_folders (club_id, nom) values (public.my_club_id(), $1) returning id', [nom])).id);
const RONDO = await folder(N2, 'Rondo'), TRANS = await folder(ADMIN, 'Transitions');
await ko(N2, `insert into public.library_folders (club_id, nom) values (1, ' rondo ')`, [], /duplicate key|unique/, '« rondo » = « Rondo » : pas de doublon');
await ko(PREPA, `insert into public.library_folders (club_id, nom) values (1, 'Prépa')`, [], RLS, 'le préparateur lit, ne crée pas');
await ko(SCOUT, `insert into public.library_folders (club_id, nom) values (1, 'Scout')`, [], RLS, 'lecteur : rien');
assert.equal((await rows(SCOUT, 'select * from public.library_folders')).length, 0, 'le lecteur ne voit pas les dossiers');
assert.equal((await rows(JOUEUR, 'select * from public.library_folders')).length, 0, 'le joueur non plus');
assert.equal((await rows(PREPA, 'select * from public.library_folders')).length, 2, 'le préparateur les voit');
assert.equal((await rows(AUTRE, 'select * from public.library_folders')).length, 0, 'un autre club : rien');

/* ---------- 2. Une vidéo dans un dossier ; la déplacer ---------- */
const tag = Number((await one(N2, `select (public.library_tag_ensure('rondo')->>'id')::bigint id`)).id);
const f1 = await file(N2);
const A = Number((await one(N2, 'select public.library_create_item($1, $2, null, null, $3, $4) id', ['Rondo 4c2', f1, [tag], RONDO])).id);
const B = await item(N2, 'Conservation 7c7'), C = await item(N2, 'Rondo de pressing');
assert.equal(Number((await one(N2, 'select folder_id from public.library_items where id = $1', [A])).folder_id), RONDO, 'créée dans son dossier');
assert.equal((await rows(N2, 'update public.library_items set folder_id = $1 where id = $2 returning id', [TRANS, B])).length, 1, 'déplacée par son auteur');
assert.equal((await rows(PREPA, 'update public.library_items set folder_id = $1 where id = $2 returning id', [RONDO, B])).length, 0, 'sans droit de modification : rien ne bouge');
const OTHER = Number((await q(`insert into public.library_folders (club_id, nom) values (2, 'Autre club') returning id`)).rows[0].id);
await ko(N2, 'update public.library_items set folder_id = $1 where id = $2', [OTHER, C], /Dossier inconnu/, 'dossier d’un autre club : refusé');

/* ---------- 3. Chercher : dossier + tags + texte ---------- */
const search = async (folderId, tags = [], text = '') => (await rows(N2, 'select id from public.library_search($1, $2, $3, $4, $5, $6, $7)',
  [text, tags, 'all', 'actif', 48, 0, folderId])).map(r => Number(r.id)).sort();
assert.deepEqual(await search(null), [A, B, C].sort(), 'tous les dossiers');
assert.deepEqual(await search(RONDO), [A], 'le dossier Rondo');
assert.deepEqual(await search(0), [C], 'sans dossier');
assert.deepEqual(await search(null, [tag], 'rondo'), [A], 'tag et texte, tous dossiers');
assert.deepEqual(await search(TRANS, [tag]), [], 'dossier et tag cumulés');
assert.deepEqual((await rows(N2, 'select * from public.library_search()')).length, 3, 'l’ancien appel (sans dossier) marche toujours');
const counts = async (uid) => Object.fromEntries((await rows(uid, 'select nom, n from public.library_folders_list()')).map(r => [r.nom, Number(r.n)]));
assert.deepEqual(await counts(N2), { Rondo: 1, Transitions: 1, 'Sans dossier': 1 });

/* ---------- 4. Archiver, renommer, supprimer : aucune vidéo perdue ---------- */
await rows(N2, `update public.library_folders set nom = 'Rondos', archived_at = now() where id = $1 returning id`, [RONDO]);
assert.deepEqual((await rows(N2, 'select nom, archived from public.library_folders_list() where id = $1', [RONDO])).map(r => [r.nom, r.archived]), [['Rondos', true]]);
await ko(N2, 'update public.library_folders set club_id = 2 where id = $1', [RONDO], RLS, 'le club d’un dossier ne change pas');
assert.equal((await rows(PREPA, 'delete from public.library_folders where id = $1 returning id', [TRANS])).length, 0, 'le préparateur ne supprime pas');
assert.equal((await rows(N2, 'delete from public.library_folders where id = $1 returning id', [TRANS])).length, 1);
assert.equal((await one(N2, 'select folder_id, statut from public.library_items where id = $1', [B])).folder_id, null, 'la vidéo reste, sans dossier');
assert.deepEqual(await search(0), [B, C].sort());

console.log('library-folders-sql : OK (création, doublon, droits, déplacement, recherche cumulée, suppression sans perte)');
