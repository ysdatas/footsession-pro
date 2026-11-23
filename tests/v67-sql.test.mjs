/* lmfc_v67.sql : questions à choix multiple, et son retour arrière.
   Sur les migrations réelles (full-db.mjs) :
     - custom_form_save accepte « multi » avec 2 à 12 choix distincts, refuse sans choix ;
     - custom_form_submit range la liste dans l'ordre des choix, sans doublon ;
     - choix inconnu, texte seul ou liste de nombres refusés ;
     - liste vide = sans réponse : refusée si obligatoire, rien d'enregistré sinon ;
     - les autres types ne changent pas ;
     - le retour désactive les formulaires à choix multiple et rend les fonctions d'avant.
   Lancement : node tests/v67-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v67-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db, rest } = await fullDb(pg, { until: 'lmfc_v66.sql' });
assert.equal(rest[0], 'lmfc_v67.sql', 'v67 est la migration suivante');
await seed(db);
const start = await catalog(db);
await db.exec(sqlFile('lmfc_v67.sql'));
await db.exec(sqlFile('lmfc_v67.sql'));   // rejouable
const as = actor(db), q = (s, p) => db.query(s, p);

const MUSCLES = ['Ischio-jambiers', 'Quadriceps', 'Fessiers', 'Mollets'];
const save = (questions, titre = 'Courbatures') => as(P.admin, () => q(`select public.custom_form_save(null, $1, null, $2::jsonb, $3::bigint[], true, null) r`,
  [titre, JSON.stringify(questions), [T.pro]]));

assert.ok((await as(P.admin, () => q(`select public.custom_form_question_types() t`))).rows[0].t.includes('multi'), 'témoin : types acceptés');
await q('set role anon');
await assert.rejects(q(`select public.custom_form_question_types()`), /permission denied/, 'témoin fermé à anon (42501)');
await q('reset role');

// Enregistrement : choix exigés, distincts.
await assert.rejects(save([{ id: 'zones', label: 'Où ?', type: 'multi', required: true }]), /2 à 12 réponses/, 'multi sans choix refusé');
await assert.rejects(save([{ id: 'zones', label: 'Où ?', type: 'multi', required: true, options: ['Genou'] }]), /2 à 24 réponses/, 'un seul choix refusé');
await assert.rejects(save([{ id: 'zones', label: 'Où ?', type: 'multi', required: true, options: ['Genou', 'Genou'] }]), /distincts/, 'doublon refusé');
const many = (n) => Array.from({ length: n }, (_, i) => `Zone ${i + 1}`);
await assert.rejects(save([{ id: 'zones', label: 'Où ?', type: 'multi', required: true, options: many(25) }]), /2 à 24/, '25 choix refusés');
await assert.rejects(save([{ id: 'zones', label: 'Où ?', type: 'choice', required: true, options: many(13) }]), /2 à 12/, 'choix simple : 12 au plus');
await save([{ id: 'zones', label: 'Où ?', type: 'multi', required: true, corps: true, options: many(24) }], 'Silhouette');   // 24 choix, marque « corps » gardée
await assert.rejects(save([{ id: 'x', label: 'X', type: 'inconnu', required: true }]), /invalide/, 'type inconnu toujours refusé');
const corps = (await q(`select v.questions->0->'corps' c from public.custom_form_versions v join public.custom_forms f on f.id = v.form_id where f.titre = 'Silhouette'`)).rows[0].c;
assert.equal(corps, true, 'la marque « corps » est enregistrée');
const form = Number((await save([
  { id: 'zones', label: 'Muscles concernés', type: 'multi', required: true, options: MUSCLES },
  { id: 'autres', label: 'Autres gênes', type: 'multi', required: false, options: ['Genou', 'Cheville'] },
  { id: 'forme', label: 'Ta forme ?', type: 'scale', min: 0, max: 10, required: false },
])).rows[0].r.id);
const version = Number((await q(`select id from public.custom_form_versions where form_id = $1`, [form])).rows[0].id);

// Envoi : erreurs d'abord (rien n'est enregistré), puis la bonne réponse.
const submit = (answers) => as(P.joueurPro, () => q(`select public.custom_form_submit($1, $2::jsonb, '')`, [version, JSON.stringify(answers)]));
for (const [answers, re, why] of [
  [{ zones: [] }, /Réponds à « Muscles concernés »/, 'liste vide sur une question obligatoire'],
  [{}, /Réponds à/, 'question obligatoire absente'],
  [{ zones: ['Biceps'] }, /Choix invalide/, 'choix inconnu'],
  [{ zones: 'Quadriceps' }, /Choix invalide/, 'texte seul au lieu d’une liste'],
  [{ zones: [1, 2] }, /Choix invalide/, 'liste de nombres'],
  [{ zones: ['Quadriceps', null] }, /Choix invalide/, 'élément vide'],
  [{ zones: ['Quadriceps'], forme: 12 }, /hors échelle/, 'les autres types sont toujours contrôlés'],
]) await assert.rejects(submit(answers), re, why);
await submit({ zones: ['Mollets', 'Ischio-jambiers', 'Mollets'], autres: [], forme: 4 });
const saved = (await q(`select answers from public.custom_form_responses where form_version_id = $1`, [version])).rows;
assert.equal(saved.length, 1);
assert.deepEqual(saved[0].answers, { zones: ['Ischio-jambiers', 'Mollets'], forme: 4 }, 'ordre des choix, sans doublon, liste vide facultative omise');

// Retour arrière : formulaire désactivé, fonctions d'avant ; rejouable.
await db.exec(sqlFile('lmfc_v67_retour.sql'));
await db.exec(sqlFile('lmfc_v67_retour.sql'));
assert.equal((await q(`select actif from public.custom_forms where id = $1`, [form])).rows[0].actif, false, 'formulaire à choix multiple désactivé');
assert.equal((await q(`select count(*)::int n from public.custom_form_responses where form_id = $1`, [form])).rows[0].n, 1, 'réponse gardée');
await assert.rejects(save([{ id: 'zones', label: 'Où ?', type: 'multi', required: true, options: MUSCLES }]), /invalide/, 'multi refusé après le retour');
assert.deepEqual(await catalog(db), start, 'le retour rend les fonctions d’avant');

console.log('v67-sql : OK');
