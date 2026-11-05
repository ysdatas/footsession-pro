/* lmfc_v39.sql et son retour arrière, sur les migrations réelles (full-db.mjs) :
   les fuites existent avant, disparaissent après, et lmfc_v39_retour.sql rend
   l'état d'avant, à l'identique (règles, fonctions, droits, déclencheurs,
   colonnes, données). Un test de retour arrière qui n'a rien à défaire ne
   prouve rien : la première partie constate que la migration change bien
   quelque chose. Lancement : voir access-matrix-sql.test.mjs. */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v39-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db } = await fullDb(pg, { until: 'lmfc_v38.sql' });
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
await db.exec(`
insert into public.sessions (club_id, created_by, titre, date_seance, team_id, acces) values
 (1, '${P.coachU14}', 'U14 ancienne', '2026-09-01', ${T.u14}, 'club'), (1, '${P.coachU14}', 'U14 supprimée', '2026-09-02', ${T.u14}, 'club'),
 (1, '${P.admin}', 'Sans équipe', '2026-09-03', null, 'club');
insert into public.session_bilans (session_id, player_id, note, commentaire) values (1, ${J.mineure}, 'moins', 'Bilan d’une mineure');
insert into public.exercise_templates (club_id, created_by, nom, partage) values (1, '${P.coachU14}', 'Privé', false);
insert into storage.buckets (id, name) values ('schemas', 'schemas') on conflict (id) do nothing;
insert into storage.objects (bucket_id, name) values ('schemas', '1/procedure-1-1.jpg');
`);
await as(P.coachU14, () => q(`delete from public.exercise_templates where nom = 'Privé'`));
await as(P.coachU14, () => q(`delete from public.sessions where titre = 'U14 supprimée'`));

const bilans = (uid) => as(uid, async () => (await q(`select commentaire from public.session_bilans`)).rows.length);
const level = async (uid) => (await q(`select public.player_level_for($1, ${J.sans}) l`, [uid])).rows[0].l;
const trash = (uid) => as(uid, async () => (await q(`select id from public.trash where tbl = 'exercise_templates'`)).rows.length);
const listed = (uid) => as(uid, async () => (await q(`select name from storage.objects where bucket_id = 'schemas'`)).rows.length);
const leaks = async () => ({ bilan: await bilans(P.coachPro), sansEquipe: await level(P.coachPro), corbeille: await trash(P.coachPro), autreClub: await listed(P.adminB) });
const OPEN = { bilan: 1, sansEquipe: 'modification', corbeille: 1, autreClub: 1 }, CLOSED = { bilan: 0, sansEquipe: 'aucun', corbeille: 0, autreClub: 0 };

// Une écriture de chaque sorte, tentée comme un compte de l'API : acceptée avant, refusée après.
const writes = async () => {
  const tryIt = (uid, s) => as(uid, () => db.transaction(async (tx) => { const r = await tx.query(s); await tx.rollback(); return r; })).then(() => 'permis', () => 'refusé');
  return {
    seanceAutreEquipe: await tryIt(P.coachU14, `insert into public.sessions (club_id, titre, date_seance, team_id) values (1, 'Injectée', '2026-11-03', ${T.pro})`),
    compteLie: await tryIt(P.coachPro, `update public.players set auth_user_id = '${P.coachPro}' where id = ${J.pro}`),
    equipeJoueur: await tryIt(P.coachPro, `update public.players set team_id = ${T.u14} where id = ${J.pro}`),
    appelDirect: await tryIt(P.joueurU14, `select public.recompute_player_profile_scores(1, 'pre', '2026-2027', null)`),
  };
};
const ALLOWED = { seanceAutreEquipe: 'permis', compteLie: 'permis', equipeJoueur: 'permis', appelDirect: 'permis' };
const REFUSED = { seanceAutreEquipe: 'refusé', compteLie: 'refusé', equipeJoueur: 'refusé', appelDirect: 'refusé' };

const acces = async () => (await q(`select id, acces, updated_at from public.sessions order by id`)).rows;
const trashAcces = async () => (await q(`select data->>'acces' a from public.trash where tbl = 'sessions'`)).rows[0].a;

/* Avant : les fuites sont là. */
assert.deepEqual(await leaks(), OPEN, 'fuites constatées avant lmfc_v39');
assert.deepEqual(await writes(), ALLOWED, 'écritures possibles avant lmfc_v39');
const start = await catalog(db), startAcces = await acces();
assert.equal(await trashAcces(), 'club');

/* Après : fermées. */
await db.exec(sqlFile('lmfc_v39.sql'));
assert.deepEqual(await leaks(), CLOSED, 'fuites fermées par lmfc_v39');
assert.deepEqual(await writes(), REFUSED, 'écritures refusées par lmfc_v39');
const applied = await catalog(db);
assert.notDeepEqual(applied, start, 'lmfc_v39 change bien quelque chose');
assert.equal(await trashAcces(), 'equipe');

/* Retour arrière : à l'identique, deux fois de suite (rejouable). */
await db.exec(sqlFile('lmfc_v39_retour.sql'));
await db.exec(sqlFile('lmfc_v39_retour.sql'));
const back = await catalog(db);
for (const k of Object.keys(start)) assert.deepEqual(back[k], start[k], `retour arrière : ${k} à l'identique`);
assert.deepEqual(await acces(), startAcces, 'séances rendues avec leur accès et leur date de modification');
assert.equal(await trashAcces(), 'club');
assert.deepEqual(await leaks(), OPEN, 'retour arrière : comportement d’avant');
assert.deepEqual(await writes(), ALLOWED, 'retour arrière : écritures d’avant');

/* Et de nouveau : le même état qu'au premier passage. */
await db.exec(sqlFile('lmfc_v39.sql'));
const again = await catalog(db);
for (const k of Object.keys(applied)) assert.deepEqual(again[k], applied[k], `second passage : ${k} identique`);
assert.deepEqual(await leaks(), CLOSED);

console.log('v39-sql : OK (fuites avant, fermées après, retour arrière à l’identique, second passage identique)');
process.exit(0);
