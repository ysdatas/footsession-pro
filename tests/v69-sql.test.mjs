/* lmfc_v69.sql : zone de douleur sur la silhouette, et son retour arrière.
   Sur les migrations réelles (full-db.mjs) :
     - les zones de la base sont celles de form-body.js (FB_DEFAULT), dans le même ordre ;
     - questionnaires après séance ou match : une version de plus, seule douleur_zone change
       (« multi », silhouette, zones puis choix ajoutés par le club) ; rejouable ;
     - un formulaire « une fois » n'est pas touché (il serait reposé) ;
     - réponse en liste acceptée, alerte douleur avec la zone ; nouveaux clubs : même question ;
     - le retour remet la question d'avant (nouvelle version) et l'état d'avant.
   Lancement : node tests/v69-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fullDb, sqlFile, seed, actor, catalog, P, T } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v69-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

// FB_DEFAULT de form-body.js, tel que le navigateur le calcule.
const ctx = { document: { addEventListener() {} }, escapeHtml: (s) => s };
vm.runInNewContext(`${readFileSync(new URL('../web/assets/js/form-body.js', import.meta.url), 'utf8')}\nthis.out = FB_DEFAULT;`, ctx);
const FB_DEFAULT = [...ctx.out];

const { db, rest } = await fullDb(pg, { until: 'lmfc_v68.sql' });
assert.equal(rest[0], 'lmfc_v69.sql', 'v69 est la migration suivante');
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const rows = async (s, p) => (await q(s, p)).rows;
await q(`select public.custom_forms_seed_questionnaires(1)`);
const start = await catalog(db);

const form = async (titre) => Number((await rows(`select id from public.custom_forms where club_id = 1 and titre = $1`, [titre]))[0].id);
const latest = async (id) => (await rows(`select version_no, questions, description from public.custom_form_versions where form_id = $1 order by version_no desc limit 1`, [id]))[0];
const zoneOf = (v) => v.questions.find(x => x.id === 'douleur_zone');
const save = (id, titre, questions, version, teams = [T.pro]) => as(P.admin, () => q(`select public.custom_form_save($1, $2, null, $3::jsonb, $4::bigint[], true, $5) r`,
  [id, titre, JSON.stringify(questions), teams, version]));

// Avant : séance Section activée pour l'équipe Pro, avec un choix ajouté par le club ; un formulaire « une fois ».
const SECTION = 'Après séance — Section', seance = await form(SECTION);
const v0 = await latest(seance);
await save(seance, SECTION, v0.questions.map(x => (x.id === 'douleur_zone' ? { ...x, options: [...x.options.filter(o => o !== 'Autre'), 'Côtes'] } : x)), v0.version_no);
const before = await latest(seance);
const once = Number((await save(null, 'Une fois', [{ id: 'douleur_zone', label: 'Où ?', type: 'choice', required: false, options: ['Genou', 'Cheville'] }], null)).rows[0].r.id);

await db.exec(sqlFile('lmfc_v69.sql'));
await db.exec(sqlFile('lmfc_v69.sql'));   // rejouable : pas de seconde version

assert.deepEqual((await as(P.admin, () => q(`select public.custom_form_body_zones() z`))).rows[0].z, FB_DEFAULT, 'zones de la base = FB_DEFAULT de form-body.js');
await q('set role anon');
await assert.rejects(q(`select public.custom_form_body_zones()`), /permission denied/, 'témoin fermé à anon (42501)');
await q('reset role');

const after = await latest(seance);
assert.equal(after.version_no, before.version_no + 1, 'une version de plus, une seule');
assert.deepEqual(zoneOf(after), { ...zoneOf(before), type: 'multi', corps: true, options: [...FB_DEFAULT, 'Côtes'] }, 'zones, puis le choix du club');
assert.deepEqual(after.questions.filter(x => x.id !== 'douleur_zone'), before.questions.filter(x => x.id !== 'douleur_zone'), 'les autres questions ne bougent pas');
for (const t of ['Après séance — N2 et Espoirs', 'Après match — Espoirs et réserve', 'Après match — Section']) {
  assert.equal(zoneOf(await latest(await form(t))).type, 'multi', `${t} : silhouette`);
}
assert.equal(zoneOf(await latest(once)).type, 'choice', 'formulaire « une fois » laissé');
assert.equal(zoneOf({ questions: (await rows(`select public.custom_form_questionnaire('match_section') q`))[0].q }).corps, true, 'nouveaux clubs : silhouette');

// Le joueur répond en liste ; l'alerte douleur garde la zone.
const s = Number((await rows(`insert into public.sessions (club_id, titre, date_seance, team_id, created_by) values (1, 'Séance', current_date, ${T.pro}, '${P.coachPro}') returning id`))[0].id);
await as(P.joueurPro, () => q(`select public.rpe_set($1, 6)`, [s]));
const p = (await as(P.joueurPro, async () => (await q(`select * from public.custom_forms_my_pending()`)).rows)).find(r => r.occurrence === `s${s}`);
assert.ok(p && zoneOf(p).corps, 'questionnaire proposé, avec la silhouette');
await as(P.joueurPro, () => q(`select public.custom_form_submit($1, $2::jsonb, $3)`,
  [p.version_id, JSON.stringify({ plaisir: 7, vie_perso: 7, douleur: 4, douleur_zone: ['Cheville', 'Genou'] }), `s${s}`]));
const alert = (await as(P.coachPro, async () => (await q(`select * from public.form_alerts_open()`)).rows)).find(a => a.mode === 'douleur');
assert.deepEqual(JSON.parse(alert.detail), ['Genou', 'Cheville'], 'alerte : zones dans l’ordre de la silhouette');

// Retour : la question d'avant revient (une version de plus), réponses intactes.
await db.exec(sqlFile('lmfc_v69_retour.sql'));
await db.exec(sqlFile('lmfc_v69_retour.sql'));
const back = await latest(seance);
assert.equal(back.version_no, after.version_no + 1, 'une version de plus au retour, une seule');
assert.deepEqual(back.questions, before.questions, 'questions d’avant');
assert.equal((await rows(`select count(*)::int n from public.custom_form_responses where form_id = $1`, [seance]))[0].n, 1, 'réponse gardée');
assert.equal(zoneOf({ questions: (await rows(`select public.custom_form_questionnaire('match_section') q`))[0].q }).type, 'choice', 'nouveaux clubs : comme avant');
assert.deepEqual(await catalog(db), start, 'le retour rend les fonctions d’avant');

console.log('v69-sql : OK');
