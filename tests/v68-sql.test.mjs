/* lmfc_v68.sql : courbatures, fessiers et psoas, et son retour arrière.
   Sur les migrations réelles (full-db.mjs) :
     - soreness_set accepte fessiers et psoas, garde les dix muscles d'avant ;
     - un muscle inconnu reste refusé, la contrainte protège la table ;
     - le retour est refusé tant qu'une réponse les cite, puis rend l'état d'avant.
   Lancement : node tests/v68-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v68-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db, rest } = await fullDb(pg, { until: 'lmfc_v67.sql' });
assert.equal(rest[0], 'lmfc_v68.sql', 'v68 est la migration suivante');
await seed(db);
const start = await catalog(db);
const as = actor(db), q = (s, p) => db.query(s, p);
await q(`insert into public.sessions (club_id, titre, date_seance, team_id, created_by) values (1, 'Séance', current_date, ${T.pro}, '${P.coachPro}')`);
const set = (n, m) => as(P.joueurPro, async () => (await q(`select public.soreness_set($1, $2) r`, [n, m])).rows[0].r);

await assert.rejects(set(3, ['fessiers']), /Muscle inconnu/, 'avant v68 : fessiers inconnu');
await db.exec(sqlFile('lmfc_v68.sql'));
await db.exec(sqlFile('lmfc_v68.sql'));   // rejouable

assert.ok((await as(P.joueurPro, () => q(`select public.soreness_muscles() m`))).rows[0].m.includes('psoas'), 'témoin : liste des muscles');
await q('set role anon');
await assert.rejects(q(`select public.soreness_muscles()`), /permission denied/, 'témoin fermé à anon (42501)');
await q('reset role');
assert.deepEqual((await set(4, ['psoas', 'fessiers', 'mollets'])).muscles, ['fessiers', 'mollets', 'psoas'], 'fessiers et psoas acceptés');
assert.deepEqual((await set(2, ['biceps', 'abducteurs'])).muscles, ['abducteurs', 'biceps'], 'les muscles d’avant restent');
await assert.rejects(set(3, ['trapezes']), /Muscle inconnu/, 'muscle inconnu refusé');
await assert.rejects(q(`update public.player_soreness set muscles = '{trapezes}'`), /player_soreness_muscles_check/, 'la contrainte protège la table');

// Retour : refusé tant qu'une réponse cite psoas, puis l'état d'avant.
await set(5, ['psoas']);
await assert.rejects(db.exec(sqlFile('lmfc_v68_retour.sql')), /retour arrière refusé/, 'retour refusé, rien perdu');
await q('rollback');   // le fichier ouvre sa transaction : l'erreur la laisse ouverte
await set(5, ['mollets']);
await db.exec(sqlFile('lmfc_v68_retour.sql'));
await db.exec(sqlFile('lmfc_v68_retour.sql'));
await assert.rejects(set(3, ['psoas']), /Muscle inconnu/, 'après le retour : psoas refusé');
await q(`delete from public.player_soreness`);
assert.deepEqual(await catalog(db), start, 'le retour rend l’état d’avant');

console.log('v68-sql : OK');
