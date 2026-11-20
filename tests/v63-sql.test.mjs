/* lmfc_v63.sql : formulaires plus fiables et plus libres, et son retour arrière.
   Sur les migrations réelles (full-db.mjs) :
     - un nombre envoyé en texte (« 8 ») est enregistré comme le nombre 8, « Non » reste refusé
       pour une échelle, « false » vaut Non pour Oui / non, une liste vide vaut sans réponse ;
     - niveaux d'une échelle : vérifiés à l'enregistrement, seules leurs valeurs sont acceptées ;
       la question d'origine (RPE) change ses niveaux, pas ses bornes ;
     - Mes formulaires rend le jour et trie du plus récent au plus ancien ;
     - suppression : effacé sans réponse, archivé avec réponses (réponses intactes), droits ;
     - le texte de réglage de lmfc_v62.sql n'est plus montré aux joueurs ;
     - le retour est refusé après une suppression archivée, et rend l'état d'avant sinon.
   Lancement : node tests/v63-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v63-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const SEANCE = 'Après séance — N2 et Espoirs';
// lmfc_v62.sql crée ses questionnaires pour les clubs existants : il passe après les données de test.
const { db, rest } = await fullDb(pg, { until: 'lmfc_v61.sql' });
assert.deepEqual(rest.slice(0, 2), ['lmfc_v62.sql', 'lmfc_v63.sql'], 'v63 suit v62');
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const rows = async (s, p) => (await q(s, p)).rows;
await db.exec(sqlFile('lmfc_v62.sql'));
await db.exec(sqlFile('lmfc_v63.sql'));
await db.exec(sqlFile('lmfc_v63.sql'));   // rejouable

// Le texte de réglage n'est plus dans les questionnaires.
assert.equal((await rows(`select count(*)::int n from public.custom_form_versions where description like '%activez-le%'`))[0].n, 0, 'versions nettoyées');
assert.equal((await rows(`select count(*)::int n from public.custom_forms where description like '%activez-le%'`))[0].n, 0, 'formulaires nettoyés');

const formId = async (titre, club = 1) => Number((await rows(`select id from public.custom_forms where club_id = $1 and titre = $2`, [club, titre]))[0].id);
const latest = async (id) => (await rows(`select version_no, questions, description from public.custom_form_versions where form_id = $1 order by version_no desc limit 1`, [id]))[0];
const save = (uid, id, titre, questions, teams, version, active = true) => as(uid, () =>
  q(`select public.custom_form_save($1, $2, null, $3::jsonb, $4::bigint[], $6, $5) r`, [id, titre, JSON.stringify(questions), teams, version, active]));

// Questionnaire séance attribué à Pro, avec une échelle à niveaux et un Oui / non en plus.
const seance = await formId(SEANCE);
const v1 = await latest(seance);
const niveaux = [{ valeur: 1, libelle: 'Facile', couleur: '#2e7d32' }, { valeur: 3, libelle: 'Moyen', couleur: '#ef6c00' }, { valeur: 5, libelle: 'Dur', couleur: null }];
const questions = [...v1.questions,
  { id: 'humeur', label: 'Ton humeur', type: 'scale', min: 1, max: 5, required: true, niveaux },
  { id: 'sommeil_ok', label: 'Bien dormi ?', type: 'boolean', required: true }];
await save(P.admin, seance, SEANCE, questions, [T.pro], v1.version_no);
assert.deepEqual((await latest(seance)).questions.find(x => x.id === 'humeur').niveaux, niveaux, 'niveaux enregistrés');

// Niveaux invalides : refusés à l'enregistrement.
const bad = async (n, why, re = /niveau|niveaux/i) => {
  const v = await latest(seance);
  const qs = v.questions.map(x => (x.id === 'humeur' ? { ...x, niveaux: n } : x));
  await assert.rejects(save(P.admin, seance, SEANCE, qs, [T.pro], v.version_no), re, why);
};
await bad([{ valeur: 1, libelle: 'a' }], 'un seul niveau');
await bad([{ valeur: 1, libelle: 'a' }, { valeur: 6, libelle: 'b' }], 'valeur hors bornes');
await bad([{ valeur: 1, libelle: 'a' }, { valeur: 1, libelle: 'b' }], 'valeur en double', /même valeur/);
await bad([{ valeur: 1, libelle: 'a', couleur: 'red' }, { valeur: 2, libelle: 'b' }], 'couleur invalide');
await bad([{ valeur: 1.5, libelle: 'a' }, { valeur: 2, libelle: 'b' }], 'valeur non entière');
await bad([{ valeur: 1, libelle: 'x'.repeat(61) }, { valeur: 2, libelle: 'b' }], 'libellé trop long');

// RPE d'origine : niveaux libres, bornes fixes.
{
  const v = await latest(seance);
  const rpeLevels = Array.from({ length: 10 }, (_, i) => ({ valeur: i + 1, libelle: `Niveau ${i + 1}`, couleur: i < 4 ? '#2e7d32' : i < 7 ? '#ef6c00' : '#c62828' }));
  const withRpe = v.questions.map(x => (x.id === 'rpe' ? { ...x, niveaux: rpeLevels } : x));
  await save(P.admin, seance, SEANCE, withRpe, [T.pro], v.version_no);
  assert.equal((await latest(seance)).questions.find(x => x.id === 'rpe').niveaux.length, 10, 'RPE : niveaux personnalisés');
  const v2 = await latest(seance);
  const moved = v2.questions.map(x => (x.id === 'rpe' ? { ...x, min: 2, niveaux: x.niveaux.slice(1) } : x));
  await assert.rejects(save(P.admin, seance, SEANCE, moved, [T.pro], v2.version_no), /intitulé et les niveaux/, 'RPE : bornes figées');
}

// Séances : deux jours, RPE puis questionnaire.
const sess = [];
for (const back of [3, 0]) {
  sess.push(Number((await rows(`insert into public.sessions (club_id, titre, date_seance, team_id, created_by)
    values (1, 'Séance J-${back}', current_date - ${back}, ${T.pro}, '${P.coachPro}') returning id`))[0].id));
}
for (const s of sess) await as(P.joueurPro, () => q(`select public.rpe_set($1, 6)`, [s]));
const pend = await as(P.joueurPro, async () => (await q(`select * from public.custom_forms_my_pending()`)).rows);
const mine = pend.filter(r => r.form_id == seance);
assert.deepEqual(mine.map(r => r.occurrence), [`s${sess[1]}`, `s${sess[0]}`], 'le plus récent d’abord');
assert.ok(mine.every(r => r.jour instanceof Date), 'jour rendu');
assert.equal(mine[0].description, null, 'pas de texte de réglage pour le joueur');

const p = mine[0], occ = p.occurrence;
// Ce qu'envoyait le navigateur : les listes en texte.
const base = Object.fromEntries(p.questions.filter(x => x.required).map(x => [x.id, x.type === 'choice' ? x.options[0] : x.type === 'boolean' ? 'false' : x.id === 'humeur' ? '3' : '8']));
const submit = (answers, o = occ) => as(P.joueurPro, () => q(`select public.custom_form_submit($1, $2::jsonb, $3)`, [p.version_id, JSON.stringify(answers), o]));
await assert.rejects(submit({ ...base, plaisir: 'Non' }), /Réponse numérique attendue pour « As-tu pris du plaisir/, '« Non » n’est pas un nombre');
await assert.rejects(submit({ ...base, humeur: '2' }), /hors échelle/, 'valeur hors niveaux');
await assert.rejects(submit({ ...base, humeur: 4 }), /hors échelle/, 'nombre hors niveaux');
await assert.rejects(submit({ ...base, plaisir: '' }), /Réponds à « As-tu pris du plaisir/, 'liste vide : obligatoire manquant');
await submit({ ...base, temps_pre: '', douleur_zone: '', temps_post: '12,5' });
const saved = (await rows(`select answers from public.custom_form_responses where occurrence = $1`, [occ]))[0].answers;
assert.equal(saved.depense_musculaire, 8, '« 8 » enregistré comme le nombre 8');
assert.equal(typeof saved.depense_musculaire, 'number');
assert.equal(saved.humeur, 3, 'niveau enregistré par sa valeur');
assert.equal(saved.sommeil_ok, false, '« false » : Non');
assert.equal(saved.temps_post, 12.5, '« 12,5 » : 12.5');
assert.ok(!('temps_pre' in saved) && !('douleur_zone' in saved), 'facultatifs vides : sans réponse');
assert.ok(!(await as(P.joueurPro, async () => (await q(`select * from public.custom_forms_my_pending()`)).rows)).some(r => r.occurrence === occ), 'plus à remplir');

// Suppression : un formulaire sans réponse est effacé.
const libre = Number((await save(P.admin, null, 'Essai', [{ id: 'a', label: 'A ?', type: 'text', required: true }], [T.pro], null)).rows[0].r.id);
await assert.rejects(as(P.coachPro, () => q(`select public.custom_form_delete($1)`, [libre])), /réservée/, 'le coach ne supprime pas');
await assert.rejects(as(P.adminB, () => q(`select public.custom_form_delete($1)`, [libre])), /introuvable/, 'autre club refusé');
assert.equal((await as(P.admin, () => q(`select public.custom_form_delete($1) r`, [libre]))).rows[0].r, 'supprime');
assert.equal((await rows(`select count(*)::int n from public.custom_forms where id = $1`, [libre]))[0].n, 0, 'effacé');

// Avec des réponses : archivé, réponses intactes, ne se réactive pas.
const before = (await rows(`select count(*)::int n from public.custom_form_responses where form_id = $1`, [seance]))[0].n;
assert.equal((await as(P.admin, () => q(`select public.custom_form_delete($1) r`, [seance]))).rows[0].r, 'archive');
const arch = (await rows(`select actif, archive_le, (select count(*) from public.custom_form_teams t where t.form_id = f.id)::int equipes from public.custom_forms f where id = $1`, [seance]))[0];
assert.ok(!arch.actif && arch.archive_le && arch.equipes === 0, 'archivé, désactivé, sans équipe');
assert.equal((await rows(`select count(*)::int n from public.custom_form_responses where form_id = $1`, [seance]))[0].n, before, 'réponses gardées');
const va = await latest(seance);
await assert.rejects(save(P.admin, seance, SEANCE, va.questions, [T.pro], va.version_no), /supprimé/, 'pas de réactivation');

// Formulaire d'origine du club : administrateur seulement, toujours archivé.
const origine = Number((await rows(`select id from public.custom_forms where club_id = 1 and source = 'courbatures' and created_by is null`))[0].id);
await assert.rejects(as(P.prepaPro, () => q(`select public.custom_form_delete($1)`, [origine])), /administrateur/, 'prépa : refusé');
assert.equal((await as(P.admin, () => q(`select public.custom_form_delete($1) r`, [origine]))).rows[0].r, 'archive');
// Une nouvelle équipe ne le reçoit pas.
await q(`insert into public.teams (id, club_id, nom) overriding system value values (90, 1, 'Nouvelle')`);
assert.equal((await rows(`select count(*)::int n from public.custom_form_teams where form_id = $1`, [origine]))[0].n, 0, 'nouvelle équipe : pas le formulaire supprimé');

// Retour : refusé après une suppression archivée.
await assert.rejects(db.exec(sqlFile('lmfc_v63_retour.sql')), /supprimés/, 'retour refusé');

// Retour arrière sur une base vierge : état d'avant, à l'identique.
const fresh = await fullDb(pg, { until: 'lmfc_v61.sql' });
await seed(fresh.db);
await fresh.db.exec(sqlFile('lmfc_v62.sql'));
const start = await catalog(fresh.db);
await fresh.db.exec(sqlFile('lmfc_v63.sql'));
await fresh.db.exec(sqlFile('lmfc_v63_retour.sql'));
await fresh.db.exec(sqlFile('lmfc_v63_retour.sql'));   // rejouable
assert.deepEqual(await catalog(fresh.db), start, 'le retour rend l’état d’avant');

console.log('v63-sql : OK');
