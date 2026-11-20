/* lmfc_v64.sql : les questionnaires après le RPE ne sont proposés que pour J, J-1 et J-2, et son retour.
   Sur les migrations réelles (full-db.mjs) :
     - une séance d'il y a 3 jours, RPE donné : plus de questionnaire, l'envoi est refusé ;
     - aujourd'hui et avant-hier : proposés et envoyables ;
     - le RPE garde ses 14 jours ;
     - le retour rend l'état d'avant.
   Lancement : node tests/v64-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v64-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const SEANCE = 'Après séance — N2 et Espoirs';
// lmfc_v62.sql crée ses questionnaires pour les clubs existants : il passe après les données de test.
const { db, rest } = await fullDb(pg, { until: 'lmfc_v61.sql' });
assert.deepEqual(rest.slice(0, 3), ['lmfc_v62.sql', 'lmfc_v63.sql', 'lmfc_v64.sql'], 'v64 suit v63');
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const rows = async (s, p) => (await q(s, p)).rows;
await db.exec(sqlFile('lmfc_v62.sql'));
await db.exec(sqlFile('lmfc_v63.sql'));
await db.exec(sqlFile('lmfc_v64.sql'));
await db.exec(sqlFile('lmfc_v64.sql'));   // rejouable

const form = Number((await rows(`select id from public.custom_forms where club_id = 1 and titre = $1`, [SEANCE]))[0].id);
const v = (await rows(`select version_no, questions from public.custom_form_versions where form_id = $1 order by version_no desc limit 1`, [form]))[0];
await as(P.admin, () => q(`select public.custom_form_save($1, $2, null, $3::jsonb, $4::bigint[], true, $5)`, [form, SEANCE, JSON.stringify(v.questions), [T.pro], v.version_no]));

const sess = {};
for (const back of [3, 2, 0]) {
  sess[back] = Number((await rows(`insert into public.sessions (club_id, titre, date_seance, team_id, created_by)
    values (1, 'Séance J-${back}', current_date - ${back}, ${T.pro}, '${P.coachPro}') returning id`))[0].id);
  await as(P.joueurPro, () => q(`select public.rpe_set($1, 6)`, [sess[back]]));   // le RPE reste ouvert 14 jours
}
const pending = await as(P.joueurPro, async () => (await q(`select * from public.custom_forms_my_pending()`)).rows.filter(r => r.form_id == form));
assert.deepEqual(pending.map(r => r.occurrence), [`s${sess[0]}`, `s${sess[2]}`], 'aujourd’hui et avant-hier seulement');

const answers = Object.fromEntries(pending[0].questions.filter(x => x.required).map(x => [x.id, x.type === 'choice' ? x.options[0] : 5]));
const submit = (occ) => as(P.joueurPro, () => q(`select public.custom_form_submit($1, $2::jsonb, $3)`, [pending[0].version_id, JSON.stringify(answers), occ]));
await assert.rejects(submit(`s${sess[3]}`), /n’est plus à remplir/, 'J-3 refusé');
await submit(`s${sess[2]}`);
await submit(`s${sess[0]}`);
assert.equal((await rows(`select count(*)::int n from public.custom_form_responses where form_id = $1`, [form]))[0].n, 2, 'deux réponses');

// Retour arrière sur une base vierge : état d'avant, à l'identique.
const fresh = await fullDb(pg, { until: 'lmfc_v61.sql' });
await seed(fresh.db);
await fresh.db.exec(sqlFile('lmfc_v62.sql'));
await fresh.db.exec(sqlFile('lmfc_v63.sql'));
const start = await catalog(fresh.db);
await fresh.db.exec(sqlFile('lmfc_v64.sql'));
await fresh.db.exec(sqlFile('lmfc_v64_retour.sql'));
await fresh.db.exec(sqlFile('lmfc_v64_retour.sql'));   // rejouable
assert.deepEqual(await catalog(fresh.db), start, 'le retour rend l’état d’avant');

console.log('v64-sql : OK');
