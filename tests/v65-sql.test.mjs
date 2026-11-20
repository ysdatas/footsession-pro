/* lmfc_v65.sql : quand poser un formulaire, et son retour arrière.
   Sur les migrations réelles (full-db.mjs) :
     - réglages valides ou refusés (custom_form_plan), droits ;
     - chaque jour : un questionnaire par jour, de la création à J, J-1, J-2 ;
     - jours de la semaine : seulement ces jours ;
     - avant le match : la veille ou le jour, occurrence du match ;
     - période : rien hors période, « une fois » refusé hors période ;
     - après séance : la période filtre les questionnaires ajoutés ;
     - le retour rend l'état d'avant.
   Lancement : node tests/v65-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v65-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db, rest } = await fullDb(pg, { until: 'lmfc_v61.sql' });
assert.deepEqual(rest.slice(0, 4), ['lmfc_v62.sql', 'lmfc_v63.sql', 'lmfc_v64.sql', 'lmfc_v65.sql'], 'v65 suit v64');
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const rows = async (s, p) => (await q(s, p)).rows;
for (const f of ['lmfc_v62.sql', 'lmfc_v63.sql', 'lmfc_v64.sql', 'lmfc_v65.sql', 'lmfc_v65.sql']) await db.exec(sqlFile(f));

const day = async (n) => (await rows(`select (current_date + $1::int)::text d`, [n]))[0].d;
const today = await day(0), isodow = Number((await rows(`select extract(isodow from current_date)::int d`))[0].d);
const QS = [{ id: 'forme', label: 'Ta forme ?', type: 'scale', min: 0, max: 10, required: true }];
const create = async (titre) => Number((await as(P.admin, () => q(`select public.custom_form_save(null, $1, null, $2::jsonb, $3::bigint[], true, null) r`,
  [titre, JSON.stringify(QS), [T.pro]]))).rows[0].r.id);
const plan = (uid, id, p) => as(uid, () => q(`select public.custom_form_plan($1, $2::jsonb) r`, [id, p === null ? null : JSON.stringify(p)]));
const pending = async (id) => (await as(P.joueurPro, async () => (await q(`select * from public.custom_forms_my_pending()`)).rows)).filter(r => Number(r.form_id) === id);
const submit = (r, occ = r.occurrence) => as(P.joueurPro, () => q(`select public.custom_form_submit($1, $2::jsonb, $3)`, [r.version_id, JSON.stringify({ forme: 7 }), occ]));
const backdate = (id, n) => q(`update public.custom_forms set created_at = now() - make_interval(days => $2) where id = $1`, [id, n]);

// Réglages refusés.
const f = await create('Bien-être');
for (const [p, why] of [[{ mode: 'mois' }, 'mode inconnu'], [{ mode: 'semaine', jours: [] }, 'semaine sans jour'], [{ mode: 'semaine', jours: [8] }, 'jour 8'],
  [{ mode: 'avant_match' }, 'avant match sans veille ni jour'], [{ du: '2026-12-10', au: '2026-12-01' }, 'du après au'], [{ du: '2026-02-31' }, 'date impossible'],
  [{ mode: 'jour', autre: 1 }, 'clé inconnue']]) {
  await assert.rejects(plan(P.admin, f, p), /Réglage invalide/, why);
}
await assert.rejects(plan(P.coachPro, f, { mode: 'jour' }), /réservée/, 'le coach ne règle pas');
await assert.rejects(plan(P.adminB, f, { mode: 'jour' }), /introuvable/, 'autre club refusé');
await assert.rejects(q(`update public.custom_forms set planning = '{"mode":"x"}' where id = $1`, [f]), /custom_forms_planning_ok/, 'la contrainte protège la colonne');

// Chaque jour : créé il y a 5 jours → J-2, J-1, J.
await plan(P.admin, f, { mode: 'jour' });
await backdate(f, 5);
let p = await pending(f);
assert.deepEqual(p.map(r => r.occurrence), [`j${today}`, `j${await day(-1)}`, `j${await day(-2)}`], 'trois jours, le plus récent d’abord');
await submit(p[1]);
assert.deepEqual((await pending(f)).map(r => r.occurrence), [`j${today}`, `j${await day(-2)}`], 'un jour répondu disparaît');
await assert.rejects(submit(p[0], `j${await day(-3)}`), /plus à remplir/, 'J-3 refusé');
// Créé aujourd'hui : rien pour les jours d'avant.
await backdate(f, 0);
assert.deepEqual((await pending(f)).map(r => r.occurrence), [`j${today}`], 'pas avant sa création');
await backdate(f, 5);

// Jours de la semaine : seulement celui d'aujourd'hui.
const g = await create('Lundi et jeudi');
await plan(P.admin, g, { mode: 'semaine', jours: [isodow] });
await backdate(g, 5);
assert.deepEqual((await pending(g)).map(r => r.occurrence), [`j${today}`], 'seulement le jour choisi');

// Avant le match : la veille d'un match demain, le jour d'un match aujourd'hui.
await q(`insert into public.matches (id, club_id, team_id, adversaire, date_match, created_by) overriding system value values
  (401, 1, ${T.pro}, 'Nantes', current_date + 1, '${P.coachPro}'), (402, 1, ${T.pro}, 'Rennes', current_date, '${P.coachPro}'),
  (403, 1, ${T.u17}, 'Brest', current_date, '${P.coachPro}')`);
const h = await create('Avant match');
await plan(P.admin, h, { mode: 'avant_match', quand: 'veille' });
await backdate(h, 5);
assert.deepEqual((await pending(h)).map(r => r.occurrence).sort(), ['m401', 'm402'], 'veille : demain (aujourd’hui) et aujourd’hui (hier)');
await plan(P.admin, h, { mode: 'avant_match', quand: 'jour' });
const hp = await pending(h);
assert.deepEqual(hp.map(r => r.occurrence), ['m402'], 'jour du match : seulement celui d’aujourd’hui, pas l’autre équipe');
assert.match(hp[0].titre, /Avant le match contre Rennes/);
await submit(hp[0]);
assert.equal((await pending(h)).length, 0);

// Période : hors période, rien ; « une fois » refusé hors période.
await plan(P.admin, f, { mode: 'jour', du: await day(1), au: await day(5) });
assert.equal((await pending(f)).length, 0, 'période à venir : rien');
const once = await create('Une fois');
const op = (await pending(once))[0];
assert.ok(op && op.occurrence === '', 'une fois : proposé');
await plan(P.admin, once, { du: await day(-10), au: await day(-1) });
assert.equal((await pending(once)).length, 0, 'période passée : plus proposé');
await assert.rejects(submit(op), /plus à remplir/, 'envoi refusé hors période');
assert.equal((await plan(P.admin, once, { mode: 'une_fois' })).rows[0].r, null, 'une fois sans période : réglage vide');

// Après séance : seulement la période.
const seance = Number((await rows(`select id from public.custom_forms where club_id = 1 and titre = 'Après séance — N2 et Espoirs'`))[0].id);
await assert.rejects(plan(P.admin, seance, { mode: 'jour' }), /qu’une période/, 'pas de moment pour un formulaire après séance');
const v = (await rows(`select version_no, questions from public.custom_form_versions where form_id = $1 order by version_no desc limit 1`, [seance]))[0];
await as(P.admin, () => q(`select public.custom_form_save($1, 'Après séance — N2 et Espoirs', null, $2::jsonb, $3::bigint[], true, $4)`, [seance, JSON.stringify(v.questions), [T.pro], v.version_no]));
const s = Number((await rows(`insert into public.sessions (club_id, titre, date_seance, team_id, created_by) values (1, 'Séance', current_date, ${T.pro}, '${P.coachPro}') returning id`))[0].id);
await as(P.joueurPro, () => q(`select public.rpe_set($1, 6)`, [s]));
assert.equal((await pending(seance)).length, 1, 'sans période : proposé');
await plan(P.admin, seance, { du: await day(1) });
assert.equal((await pending(seance)).length, 0, 'hors période : pas proposé');

// Retour arrière sur une base vierge : état d'avant, à l'identique.
const fresh = await fullDb(pg, { until: 'lmfc_v61.sql' });
await seed(fresh.db);
for (const f2 of ['lmfc_v62.sql', 'lmfc_v63.sql', 'lmfc_v64.sql']) await fresh.db.exec(sqlFile(f2));
const start = await catalog(fresh.db);
await fresh.db.exec(sqlFile('lmfc_v65.sql'));
await fresh.db.exec(sqlFile('lmfc_v65_retour.sql'));
await fresh.db.exec(sqlFile('lmfc_v65_retour.sql'));   // rejouable
assert.deepEqual(await catalog(fresh.db), start, 'le retour rend l’état d’avant');

console.log('v65-sql : OK');
