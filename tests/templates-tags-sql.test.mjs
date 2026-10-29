/* Tags des schémas enregistrés (supabase/lmfc_v26.sql) sur un vrai
   Postgres (PGlite), RLS active : les tags de la bibliothèque vidéo
   servent aussi aux schémas (exercise_templates). Droits par rôle et par
   club, lecteur et joueur sans écriture, pas de doublon, fusion et
   suppression qui comptent les schémas, retour avec le schéma restauré
   depuis la corbeille. Migration passée deux fois (rejouable).
   Lancement : PGlite installé hors du projet, relié en node_modules,
   puis node tests/templates-tags-sql.test.mjs (sans PGlite : échec). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { libraryDb, USERS } from './library-db.mjs';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {
  console.error('templates-tags-sql : PGlite absent, test NON lancé');
  process.exit(1);
}
const { ADMIN, N2, U19, PREPA, SCOUT, JOUEUR, AUTRE } = USERS;
const { db, rows, one, ko, item } = await libraryDb(PGlite);
const RLS = /row-level security|permission denied/;

// Schémas enregistrés tels que schema.sql les crée, avec leur corbeille (lmfc_v5.sql).
await db.exec(`
create table public.exercise_templates (id bigint generated always as identity primary key,
  club_id bigint not null references public.clubs on delete cascade, created_by uuid, nom text not null, categorie text,
  data jsonb, canvas_json jsonb, image_path text, created_at timestamptz default now());
alter table public.exercise_templates enable row level security;
create policy templates_read on public.exercise_templates for select using (club_id = public.my_club_id());
create policy templates_write on public.exercise_templates for all
  using (club_id = public.my_club_id() and public.can_edit()) with check (club_id = public.my_club_id() and public.can_edit());
grant select, insert, update, delete on public.exercise_templates to authenticated;
create trigger trash_capture before delete on public.exercise_templates for each row execute function public.trash_capture('root', '');`);
const v26 = readFileSync(new URL('../supabase/lmfc_v26.sql', import.meta.url), 'utf8');
await db.exec(v26);
await db.exec(v26);

const tpl = async (uid, nom) => (await one(uid,
  'insert into public.exercise_templates (club_id, nom) values (public.my_club_id(), $1) returning id', [nom])).id;
const tag = async (uid, label) => (await one(uid, 'select public.library_tag_ensure($1) as t', [label])).t;
const link = (uid, t, g) => rows(uid, 'insert into public.exercise_template_tags (template_id, tag_id) values ($1, $2)', [t, g]);
const tagsOf = async (uid, t) => (await rows(uid,
  'select tag_id from public.exercise_template_tags where template_id = $1 order by tag_id', [t])).map(r => Number(r.tag_id));
const uses = async (uid, id) => (await rows(uid, 'select uses from public.library_tags_list() where id = $1', [id]))[0]?.uses;

/* ---------- 1. Ajouter des tags : admin et coachs du club ---------- */
const T1 = await tpl(N2, 'Rondo 4c2');
const T2 = await tpl(ADMIN, 'Conservation 7c7');
const TX = await tpl(AUTRE, 'Autre club');
const rondo = await tag(N2, '#Rondo');
const sept = await tag(ADMIN, '7c7');
const ailleurs = await tag(AUTRE, 'rondo');
assert.equal(rondo.created, true);
await link(N2, T1, rondo.id);
await link(U19, T1, sept.id);   // un schéma est au club : tout coach le classe
assert.deepEqual(await tagsOf(N2, T1), [Number(rondo.id), Number(sept.id)].sort((a, b) => a - b));
for (const who of [PREPA, SCOUT, JOUEUR]) await ko(who, 'insert into public.exercise_template_tags values ($1, $2)', [T2, rondo.id], RLS, `${who} : pas d'ajout`);
await ko(N2, 'insert into public.exercise_template_tags values ($1, $2)', [TX, rondo.id], RLS, 'schéma d’un autre club');
await ko(N2, 'insert into public.exercise_template_tags values ($1, $2)', [T2, ailleurs.id], RLS, 'tag d’un autre club');
await ko(PREPA, 'select public.library_tag_ensure($1)', ['transition'], /réservée/, 'création de tag : admin et coachs');

/* ---------- 2. Pas de doublon ---------- */
const again = await tag(U19, '  # RONDO ');
assert.deepEqual([again.id, again.created], [rondo.id, false], 'même clé : le tag existant est repris');
await ko(N2, 'insert into public.exercise_template_tags values ($1, $2)', [T1, rondo.id], /duplicate|unique/, 'un tag une fois par schéma');

/* ---------- 3. Lecture ---------- */
assert.equal((await tagsOf(PREPA, T1)).length, 2, 'préparateur : lit les tags');
for (const who of [SCOUT, JOUEUR, AUTRE]) assert.deepEqual(await tagsOf(who, T1), [], `${who} : ne lit rien`);
assert.equal(await uses(N2, rondo.id), 1, 'un schéma compte comme un usage');
await item(N2, 'Vidéo rondo', [rondo.id]);
assert.equal(await uses(N2, rondo.id), 2, 'vidéos et schémas comptés ensemble');

/* ---------- 4. Retirer : admin et coachs ; jamais via la corbeille ---------- */
for (const who of [PREPA, SCOUT, JOUEUR]) {
  assert.equal((await rows(who, 'delete from public.exercise_template_tags where template_id = $1 returning 1', [T1])).length, 0, `${who} : rien retiré`);
}
await rows(N2, 'delete from public.exercise_template_tags where template_id = $1 and tag_id = $2', [T1, sept.id]);
assert.deepEqual(await tagsOf(N2, T1), [Number(rondo.id)]);
assert.equal((await one(ADMIN, `select count(*)::int n from public.trash where tbl = 'exercise_template_tags'`)).n, 0, 'tag retiré seul : pas de corbeille');

/* ---------- 5. Fusionner et supprimer comptent les schémas ---------- */
const rondos = await tag(N2, 'Rondos');
await link(N2, T2, rondos.id);
await link(N2, T1, rondos.id);
assert.equal((await one(ADMIN, 'select public.library_tag_merge($1, $2) n', [rondos.id, rondo.id])).n, 2, 'fusion : 2 schémas repris');
assert.deepEqual(await tagsOf(N2, T2), [Number(rondo.id)], 'le schéma reçoit le tag d’arrivée');
assert.deepEqual(await tagsOf(N2, T1), [Number(rondo.id)], 'déjà porteur : pas de doublon');
assert.equal(await uses(N2, rondo.id), 3);
await ko(ADMIN, 'select public.library_tag_delete($1, $2)', [rondo.id, 1], /3 procédé/, 'nombre affiché périmé : refus');
await link(N2, T2, sept.id);
assert.equal((await one(ADMIN, 'select public.library_tag_delete($1, $2) n', [sept.id, 1])).n, 1);
assert.deepEqual(await tagsOf(N2, T2), [Number(rondo.id)], 'tag supprimé : retiré du schéma, le schéma reste');
assert.equal((await one(N2, 'select count(*)::int n from public.exercise_templates where id = $1', [T2])).n, 1);

/* ---------- 6. Corbeille : le schéma revient avec ses tags ---------- */
const transition = await tag(N2, 'transition');
await link(N2, T1, transition.id);
await rows(N2, 'delete from public.exercise_templates where id = $1', [T1]);
assert.deepEqual(await tagsOf(ADMIN, T1), [], 'supprimé : tags partis avec lui');
const root = (await one(N2, `select id from public.trash where tbl = 'exercise_templates' and row_id = $1`, [T1])).id;
assert.equal((await one(N2, `select count(*)::int n from public.trash where root_id = $1 and tbl = 'exercise_template_tags'`, [root])).n, 2);
await rows(N2, 'select public.trash_restore($1)', [[root]]);
assert.deepEqual(await tagsOf(N2, T1), [Number(rondo.id), Number(transition.id)], 'restauré avec ses tags');

// Tag supprimé pendant que le schéma est à la corbeille : le schéma revient sans lui.
await rows(N2, 'delete from public.exercise_templates where id = $1', [T1]);
await one(ADMIN, 'select public.library_tag_delete($1, $2)', [transition.id, 0]);
const root2 = (await one(N2, `select id from public.trash where tbl = 'exercise_templates' and row_id = $1`, [T1])).id;
await rows(N2, 'select public.trash_restore($1)', [[root2]]);
assert.deepEqual(await tagsOf(N2, T1), [Number(rondo.id)], 'tag disparu : le schéma revient quand même');

/* ---------- 7. Règles lecteur et accès anonyme ---------- */
const policies = (await rows(ADMIN, `select policyname from pg_policies where tablename = 'exercise_template_tags'
  and permissive = 'RESTRICTIVE' order by 1`)).map(r => r.policyname);
assert.deepEqual(policies, ['lecteur_no_delete', 'lecteur_no_insert', 'lecteur_no_update']);
assert.equal((await db.query(`select has_table_privilege('anon', 'public.exercise_template_tags', 'select') a`)).rows[0].a, false);

console.log('templates-tags-sql : OK');
