/* lmfc_v72.sql : tous les moments pour tous les formulaires, et son retour arrière.
   Sur les migrations réelles (full-db.mjs), un joueur Pro :
     - jours de séance : un questionnaire les jours où il a une séance de l'équipe,
       rien les autres jours ;
     - après chaque séance : une fois la séance commencée, occurrence de la séance ;
       plusieurs formulaires après séance pour la même équipe ;
     - après chaque match : occurrence du match ;
     - la réponse passe (custom_form_submit), puis le questionnaire disparaît ;
     - témoin custom_form_moments() fermé à anon ;
     - le retour est refusé tant qu'un formulaire utilise un nouveau moment, puis
       rend l'état d'avant.
   Lancement : node tests/v72-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v72-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db, rest } = await fullDb(pg, { until: 'lmfc_v71.sql' });
assert.equal(rest[0], 'lmfc_v72.sql', 'v72 est la migration suivante');
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const rows = async (s, p) => (await q(s, p)).rows;
const day = async (n) => (await rows(`select (current_date + $1::int)::text d`, [n]))[0].d;
const today = await day(0), yesterday = await day(-1);

const QS = [{ id: 'forme', label: 'Ta forme ?', type: 'scale', min: 0, max: 10, required: true }];
const create = async (titre) => Number((await as(P.admin, () => q(`select public.custom_form_save(null, $1, null, $2::jsonb, $3::bigint[], true, null) r`,
  [titre, JSON.stringify(QS), [T.pro]]))).rows[0].r.id);
const plan = (id, p) => as(P.admin, () => q(`select public.custom_form_plan($1, $2::jsonb) r`, [id, JSON.stringify(p)]));
const pending = async (id) => (await as(P.joueurPro, async () => (await q(`select * from public.custom_forms_my_pending()`)).rows)).filter(r => Number(r.form_id) === id);
const submit = (r) => as(P.joueurPro, () => q(`select public.custom_form_submit($1, $2::jsonb, $3)`, [r.version_id, JSON.stringify({ forme: 7 }), r.occurrence]));
const backdate = (id) => q(`update public.custom_forms set created_at = now() - interval '5 days' where id = $1`, [id]);

// Séances Pro : hier, aujourd'hui (déjà commencée), ce soir à 23:59:59 ; U17 aujourd'hui (pas son équipe).
const sess = async (team, d, heure, titre) => Number((await rows(`insert into public.sessions (club_id, titre, date_seance, heure, team_id)
  values (1, $1, $2::date, ${heure}, $3) returning id`, [titre, d, team]))[0].id);
const sYa = await sess(T.pro, yesterday, `'10:00'`, 'Pro hier'), sNow = await sess(T.pro, today, `'00:00'`, 'Pro tôt');
const sLater = await sess(T.pro, today, `'23:59:59'`, 'Pro plus tard');
await sess(T.u17, today, `'00:00'`, 'U17');
await q(`insert into public.matches (id, club_id, team_id, adversaire, date_match, created_by) overriding system value values
  (501, 1, ${T.pro}, 'Lens', current_date - 1, '${P.coachPro}')`);

const before = await catalog(db);
await db.exec(sqlFile('lmfc_v72.sql'));
await db.exec(sqlFile('lmfc_v72.sql'));   // rejouable

/* Jours de séance : hier et aujourd'hui, un seul par jour ; pas avant-hier (aucune séance). */
const a = await create('Réveil');
await plan(a, { mode: 'seance' });
await backdate(a);
assert.deepEqual((await pending(a)).map(r => r.occurrence), [`j${today}`, `j${yesterday}`], 'jours de séance seulement, un par jour');

/* Après chaque séance : deux formulaires pour la même équipe ; pas la séance qui n'a pas commencé. */
const b = await create('Bilan 1'), c = await create('Bilan 2');
for (const id of [b, c]) { await plan(id, { mode: 'apres_seance' }); await backdate(id); }
const pb = await pending(b);
assert.deepEqual(pb.map(r => r.occurrence).sort(), [`s${sNow}`, `s${sYa}`].sort(), 'après les séances commencées de son équipe');
assert.ok(!pb.some(r => r.occurrence === `s${sLater}`), 'pas avant son heure');
assert.equal((await pending(c)).length, 2, 'un second formulaire après séance pour la même équipe');
await submit(pb.find(r => r.occurrence === `s${sNow}`));
assert.deepEqual((await pending(b)).map(r => r.occurrence), [`s${sYa}`], 'répondu : il disparaît');

/* Après chaque match. */
const m = await create('Après match');
await plan(m, { mode: 'apres_match' });
await backdate(m);
const pm = await pending(m);
assert.deepEqual(pm.map(r => r.occurrence), ['m501']);
assert.match(pm[0].titre, /Après match · Match contre Lens/);

/* Réglages refusés et témoin. */
await assert.rejects(plan(b, { mode: 'apres_seance', quand: 'veille' }), /Réglage invalide/);
assert.deepEqual((await as(P.admin, () => q('select public.custom_form_moments() r'))).rows[0].r.length, 7);
await assert.rejects(as(null, () => q('select public.custom_form_moments()')), /permission denied/, 'témoin fermé à anon (42501)');

/* Retour : refusé tant qu'un formulaire utilise un nouveau moment. */
await assert.rejects(db.exec(sqlFile('lmfc_v72_retour.sql')), /Retour refusé/);
await q('rollback');   // le fichier refusé laisse sa transaction ouverte
for (const id of [a, b, c, m]) await plan(id, { mode: 'jour' });
const n = (await rows('select count(*)::int n from public.custom_form_responses'))[0].n;
await db.exec(sqlFile('lmfc_v72_retour.sql'));
await db.exec(sqlFile('lmfc_v72_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), before, 'le retour rend l’état d’avant');
assert.equal((await rows('select count(*)::int n from public.custom_form_responses'))[0].n, n, 'aucune réponse effacée');

console.log('v72-sql : OK');
