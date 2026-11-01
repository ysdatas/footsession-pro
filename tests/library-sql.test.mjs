/* Bibliothèque vidéo (supabase/lmfc_v24.sql, lmfc_v25.sql) sur un vrai
   Postgres (PGlite), RLS active : création (titre + vidéo suffisent),
   droits par rôle, équipe et personne, limites d'octroi, fichiers et
   versions, tags sans doublons, recherche « tous » / « au moins un »,
   tenue avec 5 000 procédés. Les séances : library-sessions-sql.test.mjs.
   Lancement : npm i --no-save @electric-sql/pglite && node tests/library-sql.test.mjs
   (sans PGlite installé, le test échoue : il n'a rien vérifié). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { libraryDb, USERS } from './library-db.mjs';
import { TAG_CASES } from './library-logic.test.mjs';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.error('library-sql : PGlite absent, test NON lancé (npm i --no-save @electric-sql/pglite)');
  process.exit(1);
}
const { ADMIN, N2, N2B, U19, NONE, PREPA, PREPA19, SCOUT, JOUEUR, AUTRE } = USERS;
const { q, rows, one, ko, file, item, visible, level } = await libraryDb(PGlite);
const RLS = /row-level security|permission denied/;
const upd = async (uid, sql, p) => (await rows(uid, `${sql} returning id`, p)).length;

/* ---------- 1. Création : titre + vidéo ---------- */
const A = await item(N2, 'Rondo 4c2');
const B = await item(ADMIN, 'Jeu de position');
const C = await item(NONE, 'Privé du coach sans équipe');
const D = await item(AUTRE, 'Autre club');
assert.deepEqual(await one(ADMIN, 'select acces_roles, acces_teams, acces_niveau, statut, created_by from public.library_items where id = $1', [A]),
  { acces_roles: ['coach', 'prepa'], acces_teams: [1], acces_niveau: 'lecture', statut: 'actif', created_by: N2 }, 'défaut : staff des équipes du créateur');
assert.deepEqual((await one(ADMIN, 'select acces_teams from public.library_items where id = $1', [B])).acces_teams, [], 'admin : tout le club');
assert.deepEqual((await one(ADMIN, 'select acces_roles from public.library_items where id = $1', [C])).acces_roles, [], 'coach sans équipe : privé');
assert.equal((await one(N2, 'select v.version_no from public.library_items i join public.library_versions v on v.id = i.current_version_id where i.id = $1', [A])).version_no, 1);
for (const who of [PREPA, SCOUT, JOUEUR]) {
  await ko(who, `insert into public.library_files (club_id, storage_path) values (1, 'r2/1/lib/1.mp4')`, [], RLS, 'fichier : admin et coachs seulement');
}
const fN2 = await file(N2);
for (const who of [PREPA, SCOUT]) await ko(who, 'select public.library_create_item($1, $2)', ['x', fN2], /réservé/, 'procédé : admin et coachs seulement');
await ko(N2, `insert into public.library_items (club_id, titre) values (1, 'direct')`, [], RLS, 'procédé : jamais sans vidéo');
await ko(N2, `insert into public.library_versions (item_id, file_id, version_no) values ($1, $2, 9)`, [A, fN2], RLS, 'version : par la fonction seulement');
await ko(N2, `insert into public.library_files (club_id, storage_path) values (1, 'r2/2/lib/5.mp4')`, [], /check constraint|row-level/, 'chemin d’un autre club refusé');

/* ---------- 2. Qui voit quoi ---------- */
const expected = { [ADMIN]: [A, B, C], [N2]: [A, B], [N2B]: [A, B], [U19]: [B], [NONE]: [B, C], [PREPA]: [A, B],
  [PREPA19]: [B], [SCOUT]: [], [JOUEUR]: [], [AUTRE]: [D] };
for (const [who, ids] of Object.entries(expected)) assert.deepEqual(await visible(who), ids, `visibles pour ${who}`);
assert.deepEqual([await level(N2, A), await level(N2B, A), await level(PREPA, A), await level(U19, A), await level(ADMIN, C)],
  ['gestion', 'lecture', 'lecture', 'aucun', 'gestion']);
// La règle ensembliste (my_library_items) répond comme library_level.
const sameRule = async () => {
  for (const who of Object.values(USERS)) {
    const byLevel = (await rows(who, `select i.id from public.library_items i where public.library_level(i.id) <> 'aucun' order by 1`, [])).length;
    assert.equal((await visible(who)).length, byLevel, `my_library_items = library_level (${who})`);
  }
};

/* ---------- 3. Modifier, régler l'accès ---------- */
assert.equal(await upd(N2B, `update public.library_items set titre = 'x' where id = $1`, [A]), 0, 'lecture : pas de modification');
assert.equal(await upd(N2, `update public.library_items set acces_niveau = 'modification' where id = $1`, [A]), 1);
assert.equal(await upd(N2B, `update public.library_items set titre = 'Rondo 4c2 (orientation)' where id = $1`, [A]), 1, 'coach de l’équipe : modification');
assert.equal(await upd(PREPA, `update public.library_items set titre = 'x' where id = $1`, [A]), 0, 'prépa : toujours en lecture');
await ko(N2B, `update public.library_items set statut = 'archive' where id = $1`, [A], /créateur/, 'statut : gestion seulement');
await ko(N2, `update public.library_items set acces_teams = '{1,2}' where id = $1`, [A], /propres équipes/, 'pas une équipe qui n’est pas la sienne');
await ko(N2, `update public.library_items set acces_teams = '{}' where id = $1`, [A], /tout le club/, 'pas tout le club');
await ko(ADMIN, `update public.library_items set acces_teams = '{3}' where id = $1`, [A], /inconnue/, 'équipe d’un autre club');
assert.equal(await upd(ADMIN, `update public.library_items set acces_teams = '{2,1}' where id = $1`, [A]), 1, 'l’admin ouvre aux U19');
assert.ok((await visible(U19)).includes(A));
assert.equal(await upd(N2, `update public.library_items set titre = 'Rondo 4c2' where id = $1`, [A]), 1, 'ouverture de l’admin conservée par le créateur');
assert.equal(await upd(N2, `update public.library_items set acces_teams = '{1}' where id = $1`, [A]), 1, 'retirer une équipe : permis');
await ko(N2, `update public.library_items set acces_teams = '{1,2}' where id = $1`, [A], /propres équipes/, 'la remettre : non');
await ko(N2, `update public.library_items set created_by = $2 where id = $1`, [A, N2B], /permission denied/, 'créateur figé');
// Exceptions nominatives.
await rows(N2, `insert into public.library_access (item_id, profile_id, niveau) values ($1, $2, 'lecture'), ($1, $3, 'aucun')`, [A, U19, N2B]);
assert.ok((await visible(U19)).includes(A) && !(await visible(N2B)).includes(A), 'lecture pour U19, aucun pour N2 bis');
for (const [who, lvl, why] of [[PREPA19, 'modification', 'modification : admin ou coach'], [JOUEUR, 'lecture', 'jamais un joueur'],
  [SCOUT, 'lecture', 'jamais le lecteur'], [N2, 'lecture', 'pas le créateur']]) {
  await ko(N2, `insert into public.library_access (item_id, profile_id, niveau) values ($1, $2, $3)`, [A, who, lvl], RLS, why);
}
await ko(U19, `insert into public.library_access (item_id, profile_id, niveau) values ($1, $2, 'lecture')`, [A, PREPA19], RLS, 'sans gestion : aucun octroi');
await sameRule();

/* ---------- 4. Fichiers, empreintes, versions ---------- */
const fileOfA = (await one(N2, 'select v.file_id from public.library_items i join public.library_versions v on v.id = i.current_version_id where i.id = $1', [A])).file_id;
assert.equal((await rows(NONE, 'select id from public.library_files where id = $1', [fileOfA])).length, 0, 'fichier d’un procédé invisible : illisible');
await ko(NONE, 'select public.library_create_item($1, $2)', ['vol', fileOfA], /introuvable/, 'pas d’appropriation par l’id');
const SHA = 'ab'.repeat(32);
const fSha = await file(N2, SHA);
const E = (await one(N2, 'select public.library_create_item($1, $2, $3) as id', ['Transition 7c7', fSha, SHA])).id;
await ko(N2, `insert into public.library_files (club_id, storage_path, sha256) values (1, 'r2/1/lib/77.mp4', $1)`, [SHA], /duplicate|unique/, 'même fichier : une seule fois par club');
assert.deepEqual(await one(N2, 'select * from public.library_file_by_hash($1)', [SHA.toUpperCase()]), { file_id: fSha, item_id: E, titre: 'Transition 7c7' });
assert.deepEqual(await one(NONE, 'select * from public.library_file_by_hash($1)', [SHA]), { file_id: fSha, item_id: null, titre: null }, 'procédé invisible : non nommé');
const E2 = (await one(NONE, 'select public.library_create_item($1, $2, $3) as id', ['Ma transition', fSha, SHA])).id;
assert.equal((await one(ADMIN, 'select count(*)::int n from public.library_files where sha256 = $1', [SHA])).n, 1, 'réutilisé sans second envoi');
assert.ok((await visible(NONE)).includes(E2));
await ko(N2B, 'select public.library_add_version($1, $2)', [E, await file(N2B)], /pas modifier/, 'nouvelle version : modification requise');
const v2 = (await one(N2, 'select public.library_add_version($1, $2, null, $3) as id', [A, await file(N2), 'Meilleur angle'])).id;
assert.deepEqual(await one(N2, 'select current_version_id, (select array_agg(version_no order by version_no) from public.library_versions where item_id = $1) nos from public.library_items where id = $1', [A]),
  { current_version_id: v2, nos: [1, 2] }, 'remplacement : version 2 courante, version 1 conservée');

/* ---------- 5. Tags partagés, sans doublons ---------- */
const tag = async (uid, label) => (await one(uid, 'select public.library_tag_ensure($1) as t', [label])).t;
const rondo = await tag(N2, '#Rondo');
assert.deepEqual(rondo, { id: rondo.id, label: 'Rondo', created: true });
for (const same of ['rondo ', '#RONDO', '  # rondo']) assert.equal((await tag(N2B, same)).id, rondo.id, `« ${same} » = #Rondo`);
assert.equal((await tag(N2, 'Réversibilité')).id, (await tag(U19, '#reversibilite')).id, 'accents');
const t7 = await tag(N2, '7c7');
assert.equal((await tag(N2, '7 C 7')).id, t7.id, 'espaces');
const t7vs = await tag(N2, '7 vs 7');
assert.notEqual(t7vs.id, t7.id);
await ko(PREPA, 'select public.library_tag_ensure($1)', ['x'], /réservée/, 'prépa : pas de création de tag');
await ko(N2, 'select public.library_tag_ensure($1)', ['#'], /vide/);
await rows(N2, 'insert into public.library_item_tags (item_id, tag_id) values ($1, $2), ($1, $3), ($4, $3)', [A, rondo.id, t7vs.id, E]);
await ko(U19, 'insert into public.library_item_tags (item_id, tag_id) values ($1, $2)', [B, rondo.id], RLS, 'tag sur un procédé non modifiable');
const uses = async (uid) => Object.fromEntries((await rows(uid, 'select label, uses from public.library_tags_list()')).map(r => [r.label, r.uses]));
assert.equal((await uses(N2))['7 vs 7'], 2);
assert.equal((await uses(N2B))['7 vs 7'], 1, 'N2 bis ne voit plus A : comptes des procédés visibles seulement');
await ko(N2, 'select public.library_tag_rename($1, $2)', [rondo.id, '7C7'], /existe déjà/, 'renommer vers un tag existant : fusionner');
await ko(N2B, 'select public.library_tag_rename($1, $2)', [rondo.id, 'Rondos'], /renommer/, 'pas son tag');
await rows(N2, 'select public.library_tag_rename($1, $2)', [rondo.id, 'Rondos']);
assert.equal((await one(N2, 'select key from public.library_tags where id = $1', [rondo.id])).key, 'rondos');
await rows(N2, 'insert into public.library_item_tags (item_id, tag_id) values ($1, $2)', [A, t7.id]);
assert.equal((await one(N2, 'select public.library_tag_merge($1, $2) as n', [t7vs.id, t7.id])).n, 2, 'fusion : 2 procédés repris');
assert.deepEqual((await rows(N2, 'select item_id from public.library_item_tags where tag_id = $1 order by 1', [t7.id])).map(r => r.item_id), [A, E]);
await ko(N2, 'select public.library_tag_delete($1)', [t7.id], /utilisé par 2/, 'tag utilisé : jamais supprimé en silence');
await ko(N2, 'select public.library_tag_delete($1, 1)', [t7.id], /utilisé par 2/, 'nombre confirmé périmé');
assert.equal((await one(N2, 'select public.library_tag_delete($1, 2) as n', [t7.id])).n, 2);
await rows(ADMIN, 'insert into public.library_item_tags (item_id, tag_id) values ($1, $2)', [B, rondo.id]);
await ko(N2, 'select public.library_tag_rename($1, $2)', [rondo.id, 'Rondo'], /renommer/, 'tag porté par un procédé qu’il ne modifie pas');
await rows(ADMIN, 'select public.library_tag_rename($1, $2)', [rondo.id, 'Rondo']);

/* ---------- 6. Recherche ---------- */
const [tR, tP, tT] = [rondo.id, (await tag(N2, 'pressing')).id, (await tag(N2, 'transition')).id];
const s1 = await item(ADMIN, 'Conservation sous pression', [tR, tP]);
const s2 = await item(ADMIN, 'Pressing à la perte', [tP, tT]);
const s3 = await item(ADMIN, 'Échauffement rondo', [tR]);
const search = async (uid, qtext, tags, mode = 'all', statut = 'actif') =>
  (await rows(uid, 'select id from public.library_search($1, $2, $3, $4)', [qtext, tags, mode, statut])).map(r => r.id).sort((a, b) => a - b);
assert.deepEqual(await search(N2, '', [tR, tP]), [s1], 'tous les tags');
assert.deepEqual(await search(N2, '', [tR, tP], 'any'), [A, B, s1, s2, s3].sort((a, b) => a - b), 'au moins un');
assert.deepEqual(await search(N2, 'ECHAUFFEMENT', []), [s3], 'casse et accents');
assert.deepEqual(await search(N2, 'press', [], 'all'), [s1, s2], 'titre ou tag, début de mot');
assert.deepEqual(await search(N2, 'rondo pression', []), [s1], 'tous les mots');
await rows(ADMIN, `update public.library_items set statut = 'archive' where id = $1`, [s2]);
assert.deepEqual(await search(N2, 'pressing', []), [s1], 'archivé : hors de la vue par défaut');
assert.deepEqual(await search(N2, 'pressing', [], 'all', 'archive'), [s2]);
await rows(ADMIN, `update public.library_items set statut = 'retire' where id = $1`, [s2]);
assert.deepEqual(await search(N2, '', [], 'all', 'retire'), [], 'retiré : seulement pour la gestion');
assert.deepEqual(await search(ADMIN, '', [], 'all', 'retire'), [s2]);
const page = await rows(N2, 'select id, total, tag_ids from public.library_search($1, $2, $3, $4, 2, 0)', ['', [], 'all', 'actif']);
assert.equal(page.length, 2);
assert.equal(Number(page[0].total), (await search(N2, '', [])).length, 'total de toutes les pages');

/* ---------- 7. 5 000 procédés, 200 tags ---------- */
await q(`insert into public.library_tags (club_id, label) select 1, 'tag ' || g from generate_series(1, 200) g`);
await q(`insert into public.library_files (club_id, storage_path) select 1, 'r2/1/lib/' || (900000 + g) || '.mp4' from generate_series(1, 5000) g`);
await q(`insert into public.library_items (club_id, titre, created_by, acces_teams, acces_roles)
  select 1, 'Procédé ' || g || case when g % 7 = 0 then ' rondo' else '' end, $1, case when g % 3 = 0 then '{2}'::bigint[] else '{1}' end, '{coach,prepa}'
  from generate_series(1, 5000) g`, [ADMIN]);
await q(`insert into public.library_versions (item_id, file_id, version_no)
  select i.id, f.id, 1 from (select id, row_number() over (order by id) n from public.library_items where titre like 'Procédé %') i
  join (select id, row_number() over (order by id) n from public.library_files where storage_path like 'r2/1/lib/9%') f using (n)`);
await q(`update public.library_items i set current_version_id = v.id from public.library_versions v where v.item_id = i.id and i.current_version_id is null`);
await q(`insert into public.library_item_tags (item_id, tag_id)
  select i.id, t.id from public.library_items i join public.library_tags t on t.label like 'tag %'
  where i.titre like 'Procédé %' and (i.id + t.id) % 67 in (0, 1, 2) on conflict do nothing`);
await q('analyze');
const [x1, x2] = (await q(`select id from public.library_tags where label in ('tag 10', 'tag 11') order by id`)).rows.map(r => r.id);
const timed = async (label, args) => {
  await rows(N2, 'select id from public.library_search($1, $2, $3)', args);   // à chaud
  const t0 = performance.now();
  const r = await rows(N2, 'select id, total from public.library_search($1, $2, $3)', args);
  const ms = performance.now() - t0;
  console.log(`  recherche ${label} : ${ms.toFixed(1)} ms, ${r[0]?.total ?? 0} résultats`);
  assert.ok(ms < 400, `recherche ${label} trop lente (${ms.toFixed(0)} ms)`);
  return Number(r[0]?.total ?? 0);
};
const naive = async (sql) => Number((await one(N2, sql)).n);
assert.equal(await timed('texte', ['rondo', [], 'all']),
  await naive(`select count(*) n from public.library_items i where i.statut = 'actif' and (i.search_key like '%rondo%'
    or exists (select 1 from public.library_item_tags it join public.library_tags t on t.id = it.tag_id where it.item_id = i.id and t.key like 'rondo%'))`));
assert.equal(await timed('2 tags, tous', ['', [x1, x2], 'all']),
  await naive(`select count(*) n from public.library_items i where i.statut = 'actif' and (select count(*) from public.library_item_tags it where it.item_id = i.id and it.tag_id in (${x1}, ${x2})) = 2`));
assert.equal(await timed('2 tags, au moins un', ['', [x1, x2], 'any']),
  await naive(`select count(*) n from public.library_items i where i.statut = 'actif' and exists (select 1 from public.library_item_tags it where it.item_id = i.id and it.tag_id in (${x1}, ${x2}))`));
await timed('sans filtre', ['', [], 'all']);
await sameRule();

/* ---------- 8. Même clé de tag dans la page et dans la base ---------- */
const ctx = vm.createContext({ String });
vm.runInContext(readFileSync(new URL('../web/assets/js/library.js', import.meta.url), 'utf8'), ctx);
for (const [raw, key] of TAG_CASES) {
  assert.equal((await q('select public.library_tag_key($1) k', [raw])).rows[0].k, key, `base : ${raw}`);
  assert.equal(vm.runInContext(`libTagKey(${JSON.stringify(raw)})`, ctx), key, `page : ${raw}`);
}

/* ---------- 9. Le lecteur n'écrit nulle part ---------- */
const uncovered = (await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'library%' and c.relkind = 'r'
    and (select count(*) from pg_policies p where p.tablename = c.relname and p.permissive = 'RESTRICTIVE'
         and p.policyname in ('lecteur_no_insert', 'lecteur_no_update', 'lecteur_no_delete')) <> 3`)).rows;
assert.deepEqual(uncovered, [], 'les trois règles lecteur sur chaque table de la bibliothèque');
assert.equal((await q(`select count(*)::int n from pg_class where relname like 'library%' and relkind = 'r' and relrowsecurity`)).rows[0].n, 7);   // + library_folders (lmfc_v31.sql)

console.log('library-sql : OK (création, droits, octroi, fichiers, versions, tags, recherche, 5 000 procédés, lecteur)');
