/* Bibliothèque vidéo et séances (supabase/lmfc_v25.sql) sur un vrai
   Postgres (PGlite), RLS active : session_level_for = session_level, lien
   refusé quand des personnes de la séance n'ont pas accès à la vidéo
   (ni contournement par la séance, ni par son lien public), même vidéo
   dans plusieurs séances, version figée, archivage et retrait sans perte
   pour les séances, corbeille, suppression définitive protégée, Worker.
   Lancement : npm i --no-save @electric-sql/pglite && node tests/library-sessions-sql.test.mjs
   (sans PGlite installé, le test échoue : il n'a rien vérifié). */
import assert from 'node:assert/strict';
import { libraryDb, USERS } from './library-db.mjs';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.error('library-sessions-sql : PGlite absent, test NON lancé (npm i --no-save @electric-sql/pglite)');
  process.exit(1);
}
const { ADMIN, N2, N2B, U19, NONE, PREPA, PREPA19, SCOUT, JOUEUR } = USERS;
const { db, q, rows, one, ko, file, item } = await libraryDb(PGlite);

const A = await item(N2, 'Rondo 4c2');          // staff N2
const Z = await item(ADMIN, 'Jeu de position'); // tout le club
const U = await item(U19, 'Centres U19');       // staff U19
const cur = async (id) => (await one(ADMIN, 'select current_version_id v from public.library_items where id = $1', [id])).v;
const session = async (uid, titre, team, acces = 'equipe') =>
  (await one(uid, 'insert into public.sessions (club_id, titre, team_id, acces) values (1, $1, $2, $3) returning id', [titre, team, acces])).id;
const proc = async (uid, sid, nom = 'Procédé') => (await one(uid, 'insert into public.procedures (session_id, nom) values ($1, $2) returning id', [sid, nom])).id;
const link = (uid, p, v) => one(uid, 'select * from public.library_link_procedure($1, $2)', [p, v]);
const names = async (uid, sid, it) => (await rows(uid, 'select nom from public.library_session_gaps($1, $2)', [sid, it])).map(r => r.nom);
const fileVisible = async (uid, versionId) => (await rows(uid,
  'select f.id from public.library_files f join public.library_versions v on v.file_id = f.id where v.id = $1', [versionId])).length === 1;

const S1 = await session(N2, 'Séance N2', 1);
const S3 = await session(ADMIN, 'Séance du club', 1, 'club');
const S4 = await session(N2, 'Autre séance N2', 1);

/* ---------- 1. Même règle que session_level ---------- */
await rows(ADMIN, `insert into public.session_access (session_id, profile_id, niveau) values ($1, $2, 'lecture')`, [S4, PREPA19]);
for (const who of Object.values(USERS)) {
  for (const sid of [S1, S3, S4]) {
    const r = await one(who, 'select public.session_access_level($1) l', [sid]);
    const f = (await q(`select public.session_level_for($1, s.id, s.club_id, s.created_by, s.acces, s.team_id) l from public.sessions s where s.id = $2`, [who, sid])).rows[0];
    assert.equal(f.l, r.l, `session_level_for = session_level (${who}, séance ${sid})`);
  }
}
await rows(ADMIN, 'delete from public.session_access where session_id = $1', [S4]);

/* ---------- 2. Lier : seulement si toute la séance peut lire la vidéo ---------- */
const p1 = await proc(N2, S1, 'Rondo');
const vA1 = await cur(A);
assert.deepEqual(await names(N2, S1, A), [], 'séance N2 : son staff voit la vidéo');
assert.deepEqual(await link(N2, p1, vA1), { item_id: A, version_id: vA1, titre: 'Rondo 4c2' }, 'lien et titre figé');
const pClub = await proc(ADMIN, S3);
assert.deepEqual(await names(ADMIN, S3, A), ['Coach U19', 'Coach sans équipe', 'Prépa U19'], 'séance du club : qui ne lirait pas la vidéo');
await ko(ADMIN, 'select public.library_link_procedure($1, $2)', [pClub, vA1], /non partageable : Coach U19, Coach sans équipe, Prépa U19/, 'avertissement nominatif, lien refusé');
assert.equal((await one(ADMIN, 'select library_version_id v from public.procedures where id = $1', [pClub])).v, null);
assert.ok(await link(ADMIN, pClub, await cur(Z)), 'vidéo ouverte au club : acceptée');
// Par l'API directe aussi : vidéo qu'on ne peut pas lire, titre forgé.
const p1b = await proc(N2, S1);
await ko(N2, 'update public.procedures set library_version_id = $2 where id = $1', [p1b, await cur(U)], /pas accès/, 'vidéo invisible : refus');
await ko(N2, 'insert into public.procedures (session_id, library_version_id) values ($1, $2)', [S1, await cur(U)], /pas accès/);
await rows(N2, `update public.procedures set library_titre = 'Faux', library_item_id = $2 where id = $1`, [p1, U]);
assert.deepEqual(await one(N2, 'select library_titre, library_item_id from public.procedures where id = $1', [p1]), { library_titre: 'Rondo 4c2', library_item_id: A });
await ko(PREPA, 'select public.library_link_procedure($1, $2)', [p1b, vA1], /lecture seule/, 'séance en lecture : pas de lien');
await ko(SCOUT, 'select public.library_link_procedure($1, $2)', [p1b, vA1], /lecture seule|row-level/);

/* ---------- 3. La séance ne donne jamais accès à la vidéo ---------- */
assert.ok(await fileVisible(PREPA, vA1), 'prépa N2 : lit la vidéo de la séance');
await rows(N2, `insert into public.session_access (session_id, profile_id, niveau) values ($1, $2, 'lecture')`, [S1, U19]);
assert.equal((await rows(U19, 'select id from public.procedures where id = $1', [p1])).length, 1, 'U19 voit la séance…');
assert.ok(!(await fileVisible(U19, vA1)), '… mais pas la vidéo');
assert.deepEqual((await rows(N2, 'select procedure_id, nom from public.library_session_check($1)', [S1])), [{ procedure_id: p1, nom: 'Coach U19' }],
  'séance ouverte depuis : signalé');
await rows(N2, 'update public.sessions set share_token = $2 where id = $1', [S1, 'jeton-public']);
await db.exec('set role anon');
const shared = (await q(`select public.get_shared_session('jeton-public') s`)).rows[0].s;
await db.exec('reset role');
assert.equal(shared.procedures.length, 2);
assert.ok(shared.procedures.every(p => !('library_version_id' in p) && !('library_item_id' in p) && !('library_titre' in p)), 'lien public : rien de la bibliothèque');

/* ---------- 4. Même vidéo, plusieurs séances, version figée ---------- */
const p4 = await proc(N2, S4, 'Rondo bis');
await link(N2, p4, vA1);
assert.equal((await rows(N2, 'select session_id from public.library_usages($1)', [A])).length, 2);
assert.equal((await rows(PREPA, 'select session_id from public.library_usages($1)', [A])).length, 2);
assert.deepEqual(await one(N2, 'select * from public.library_usage_count($1)', [A]), { seances: 2, corbeille: 0 });
assert.equal((await one(ADMIN, 'select count(distinct v.file_id)::int n from public.procedures p join public.library_versions v on v.id = p.library_version_id where p.library_item_id = $1', [A])).n, 1, 'un seul fichier');
const vA2 = (await one(N2, 'select public.library_add_version($1, $2) id', [A, await file(N2)])).id;
assert.equal((await one(N2, 'select library_version_id v from public.procedures where id = $1', [p1])).v, vA1, 'remplacement : la séance garde la version 1');
await rows(N2, 'update public.library_items set titre = $2 where id = $1', [A, 'Rondo 4c2 (nouveau titre)']);
await ko(N2, 'select public.library_link_procedure($1, $2)', [p1, vA2], /Coach U19 voit cette séance/, 'U19 voit la séance sans la vidéo : pas de mise à jour');
await rows(N2, 'delete from public.session_access where session_id = $1', [S1]);
await link(N2, p1, vA2);
assert.deepEqual(await one(N2, 'select library_version_id v, library_titre t from public.procedures where id = $1', [p1]), { v: vA2, t: 'Rondo 4c2' },
  'mise à jour voulue : nouvelle version, titre d’origine');
await link(N2, p1, vA1);

/* ---------- 5. Archiver, retirer : les séances restent lisibles ---------- */
await rows(N2, `update public.library_items set statut = 'archive' where id = $1`, [A]);
await ko(N2, 'select public.library_link_procedure($1, $2)', [p1b, vA2], /archivé ou retiré/, 'archivé : plus ajoutable');
assert.ok(await fileVisible(PREPA, vA1), 'archivé : la séance lit toujours sa vidéo');
await rows(N2, `update public.library_items set statut = 'retire' where id = $1`, [A]);
assert.ok(await fileVisible(PREPA, vA1), 'retiré : idem');
assert.equal((await rows(PREPA, 'select session_id from public.library_usages($1)', [A])).length, 2);
await rows(N2, `update public.library_items set statut = 'actif' where id = $1`, [A]);

/* ---------- 6. Suppression définitive protégée, corbeille ---------- */
await ko(N2, 'select public.library_purge_item($1)', [A], /utilisé par 2/, 'utilisé : pas de suppression');
await ko(N2B, 'select public.library_purge_item($1)', [A], /réservée/, 'gestion seulement');
await rows(N2, 'delete from public.sessions where id = $1', [S4]);
await link(N2, p1, null);
assert.deepEqual(await one(N2, 'select * from public.library_usage_count($1)', [A]), { seances: 0, corbeille: 1 });
await ko(N2, 'select public.library_purge_item($1)', [A], /dont 1 dans la corbeille/, 'corbeille : la séance pourrait revenir');
await rows(ADMIN, `update public.library_items set acces_roles = '{}' where id = $1`, [A]);   // la vidéo se referme entre-temps
const root = (await one(N2, `select id from public.trash where tbl = 'sessions' and row_id = $1`, [S4])).id;
await rows(N2, 'select public.trash_restore($1)', [[root]]);
assert.equal((await one(N2, 'select library_version_id v from public.procedures where id = $1', [p4])).v, vA1, 'restaurée avec sa vidéo');
await ko(N2, 'select public.library_purge_version($1)', [vA1], /utilisée/, 'version utilisée : conservée');
await ko(N2, 'select public.library_purge_version($1)', [vA2], /en cours/);
await rows(N2, 'delete from public.sessions where id = $1', [S4]);
await rows(N2, `delete from public.trash where tbl = 'sessions' and row_id = $1 or root_id in (select id from public.trash where tbl = 'sessions' and row_id = $1)`, [S4]);
const filesOfA = (await q('select f.storage_path p from public.library_files f join public.library_versions v on v.file_id = f.id where v.item_id = $1 order by 1', [A])).rows.map(r => r.p);
const vZ = await cur(Z);
await rows(ADMIN, 'select public.library_add_version($1, $2)', [Z, (await q('select file_id from public.library_versions where id = $1', [vA1])).rows[0].file_id]);
const purged = (await one(N2, 'select public.library_purge_item($1) p', [A])).p;
assert.deepEqual(purged, filesOfA.filter(p => p !== filesOfA[0]), 'fichiers rendus au Worker, sauf celui qu’un autre procédé utilise');
assert.equal((await q('select count(*)::int n from public.library_items where id = $1', [A])).rows[0].n, 0);
assert.equal((await rows(ADMIN, 'select id from public.library_versions where id = $1', [vZ])).length, 1);

/* ---------- 7. Worker : effacer un fichier R2 ---------- */
const release = async (uid, path) => (await one(uid, 'select public.library_file_release($1) ok', [path])).ok;
assert.equal(await release(N2, purged[0]), true, 'fichier sans ligne (supprimé) : effaçable');
assert.equal(await release(ADMIN, filesOfA[0]), false, 'encore utilisé : refusé');
const orphan = (await one(N2, `insert into public.library_files (club_id, storage_path) values (1, 'r2/1/lib/424242.mp4') returning storage_path p`)).p;
assert.equal(await release(N2B, orphan), false, 'fichier d’un autre : refusé');
assert.equal(await release(PREPA, orphan), false);
assert.equal(await release(N2, 'r2/2/lib/1.mp4'), false, 'autre club');
assert.equal(await release(N2, orphan), true);
assert.equal((await q('select count(*)::int n from public.library_files where storage_path = $1', [orphan])).rows[0].n, 0, 'ligne retirée');

/* ---------- 8. Séances proposées pour « Ajouter à une séance » ---------- */
assert.deepEqual((await rows(N2, 'select id from public.my_editable_sessions()')).map(r => r.id).sort(), [S1, S3].sort());
assert.deepEqual(await rows(PREPA, 'select id from public.my_editable_sessions()'), []);
assert.deepEqual(await rows(JOUEUR, 'select id from public.my_editable_sessions()'), []);
assert.deepEqual(await rows(NONE, 'select * from public.library_session_gaps($1, $2)', [S1, Z]), [], 'séance invisible : aucune information');

console.log('library-sessions-sql : OK (règle des séances, partage refusé, lien public, version figée, archivage, corbeille, suppression, Worker)');
