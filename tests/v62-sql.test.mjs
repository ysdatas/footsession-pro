/* lmfc_v62.sql : questionnaires après séance et après match, avec alertes, et son retour arrière.
   Sur les migrations réelles (full-db.mjs) :
     - quatre formulaires par club, désactivés et sans équipe, rejouable ;
     - les questions ajoutées se posent après le RPE et se répondent ;
     - alerte « serie » (plaisir sous 5 trois jours de suite), « seuil » (jambes à 3 ou moins),
       « douleur » (au-dessus de 0, avec la zone) ; pas d'alerte sans motif ;
     - seul le staff qui suit l'équipe les voit (pas le joueur, le lecteur, une autre équipe ni un autre club) ;
     - « Vu » retire l'alerte, refusé hors périmètre ;
     - le retour est refusé s'il y a des réponses, et rend l'état d'avant sinon.
   Lancement : node tests/v62-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v62-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const TITRES = ['Après séance — N2 et Espoirs', 'Après séance — Section', 'Après match — Espoirs et réserve', 'Après match — Section'];

const { db, rest } = await fullDb(pg, { until: 'lmfc_v61.sql' });
assert.equal(rest[0], 'lmfc_v62.sql', 'v62 est la migration suivante');
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const rows = async (s, p) => (await q(s, p)).rows;
const start = await catalog(db);
await db.exec(sqlFile('lmfc_v62.sql'));
await db.exec(sqlFile('lmfc_v62.sql'));   // rejouable

// Quatre formulaires par club, désactivés, sans équipe.
for (const club of [1, 2]) {
  const f = await rows(`select titre, source, actif, (select count(*) from public.custom_form_teams t where t.form_id = f.id)::int equipes
    from public.custom_forms f where club_id = $1 and titre = any($2) order by titre`, [club, TITRES]);
  assert.equal(f.length, 4, `club ${club} : quatre questionnaires`);
  assert.ok(f.every(x => !x.actif && x.equipes === 0), `club ${club} : désactivés, sans équipe`);
}
const form = async (titre, club = 1) => Number((await rows(`select id from public.custom_forms where club_id = $1 and titre = $2`, [club, titre]))[0].id);
const latest = async (id) => (await rows(`select version_no, questions, description from public.custom_form_versions where form_id = $1 order by version_no desc limit 1`, [id]))[0];
assert.equal((await latest(await form(TITRES[0]))).questions.length, 12);
assert.equal((await latest(await form(TITRES[1]))).questions.length, 5);
assert.equal((await latest(await form(TITRES[2]))).questions.length, 12);
assert.equal((await latest(await form(TITRES[3]))).questions.length, 9);

// Le club les attribue (l'admin), l'enregistrement garde les règles d'alerte.
const attach = async (titre, team) => {
  const id = await form(titre), v = await latest(id);
  const r = await as(P.admin, () => q(`select public.custom_form_save($1, $2, $6, $3::jsonb, $4::bigint[], true, $5) r`, [id, titre, JSON.stringify(v.questions), [team], v.version_no, v.description]));
  assert.equal(r.rows[0].r.version_no, v.version_no, 'questions inchangées : même version');
  return id;
};
const seanceForm = await attach(TITRES[0], T.pro), matchForm = await attach(TITRES[2], T.pro);
assert.ok((await latest(seanceForm)).questions.some(x => x.alerte?.mode === 'serie'), 'la règle d’alerte reste dans la question');

const day = (await rows(`select current_date::text d`))[0].d;
const sess = [];
for (const [n, back] of [[0, 2], [1, 1], [2, 0]]) {
  sess.push(Number((await rows(`insert into public.sessions (club_id, titre, date_seance, team_id, created_by)
    values (1, 'Séance ${n}', current_date - ${back}, ${T.pro}, '${P.coachPro}') returning id`))[0].id));
}
await q(`insert into public.matches (id, club_id, team_id, adversaire, date_match, created_by) overriding system value
  values (301, 1, ${T.pro}, 'Nantes', current_date, '${P.coachPro}')`);

// Réponse complète : 5 partout, sauf ce que le test précise.
const reply = (questions, over) => Object.fromEntries(questions.filter(x => !x.fixe && (x.required || x.id in over)).map(x => [x.id, x.id in over ? over[x.id] : x.type === 'choice' ? x.options[0] : 5]));
const pending = (occ) => as(P.joueurPro, async () => (await q(`select * from public.custom_forms_my_pending()`)).rows.find(r => r.occurrence === occ));
const answer = async (occ, over) => {
  const p = await pending(occ);
  assert.ok(p, `${occ} : questionnaire à remplir après le RPE`);
  await as(P.joueurPro, () => q(`select public.custom_form_submit($1, $2::jsonb, $3)`, [p.version_id, JSON.stringify(reply(p.questions, over)), occ]));
};
const alerts = (uid) => as(uid, async () => (await q(`select * from public.form_alerts_open() order by mode, question_id`)).rows);

// Sans RPE, rien à remplir ; avec RPE, les questions s'ouvrent.
assert.equal(await pending(`s${sess[0]}`), undefined, 'pas avant le RPE');
const days = [[3, 6, 0, 'Genou'], [4, 6, 0, null], [2, 6, 4, 'Genou']];
for (const [i, [plaisir, vie, douleur, zone]] of days.entries()) {
  await as(P.joueurPro, () => q(`select public.rpe_set($1, 6)`, [sess[i]]));
  await answer(`s${sess[i]}`, { plaisir, vie_perso: vie, douleur, ...(zone && douleur ? { douleur_zone: zone } : {}) });
}

// Staff de l'équipe : plaisir 3 jours de suite sous 5 + douleur du jour (genou). Pas la vie personnelle (6).
let a = await alerts(P.coachPro);
assert.deepEqual(a.map(x => `${x.mode}:${x.question_id}`), ['douleur:douleur', 'serie:plaisir'], 'plaisir en série et douleur');
assert.equal(a.find(x => x.mode === 'douleur').detail, 'Genou');
assert.equal(Number(a.find(x => x.mode === 'douleur').valeur), 4);
assert.equal(a.find(x => x.mode === 'serie').jour.toISOString().slice(0, 10), day);

// Qui ne voit rien : le joueur, le lecteur, un coach d'une autre équipe, l'autre club, un anonyme.
for (const uid of [P.joueurPro, P.lecteur, P.coachU17, P.adminB, null]) {
  assert.deepEqual(await alerts(uid).catch(() => []), [], `${uid || 'anonyme'} : aucune alerte`);
}
assert.equal((await alerts(P.admin)).length, 2, 'l’admin voit celles de son club');

// Série cassée : un jour à 5 ou plus la coupe.
await q(`update public.custom_form_responses set answers = jsonb_set(answers, '{plaisir}', '7') where occurrence = $1`, [`s${sess[2]}`]);
assert.deepEqual((await alerts(P.coachPro)).map(x => x.mode), ['douleur'], 'plaisir remonté : plus de série');
await q(`update public.custom_form_responses set answers = jsonb_set(answers, '{plaisir}', '2') where occurrence = $1`, [`s${sess[2]}`]);

// « Vu » : hors périmètre refusé, dans le périmètre retire l'alerte.
const douleur = (await alerts(P.coachPro)).find(x => x.mode === 'douleur');
const seen = (uid) => as(uid, () => q(`select public.form_alert_seen($1, $2, $3, $4)`, [douleur.player_id, douleur.form_id, douleur.question_id, douleur.jour.toISOString().slice(0, 10)]));
for (const uid of [P.coachU17, P.lecteur, P.joueurPro, P.adminB]) await assert.rejects(seen(uid), /réservée au staff|permission denied/, `${uid} : Vu refusé`);
await seen(P.coachPro);
assert.deepEqual((await alerts(P.coachPro)).map(x => x.mode), ['serie'], 'Vu retire la douleur');

// Match : jambes à 3 ou moins déclenche, 4 non.
await as(P.joueurPro, () => q(`select public.match_rpe_set(301, 6)`));
await answer('m301', { jambes: 3, vie_perso: 4, douleur: 0 });
let seuil = (await alerts(P.coachPro)).filter(x => x.mode === 'seuil');
assert.deepEqual(seuil.map(x => x.question_id), ['jambes'], 'jambes à 3 : alerte, vie personnelle à 4 : non');

// Le retour est refusé tant que des joueurs ont répondu.
await assert.rejects(db.exec(sqlFile('lmfc_v62_retour.sql')), /ont répondu/, 'retour refusé avec des réponses');

// Retour arrière sur une base vierge : état d'avant, à l'identique.
const fresh = await fullDb(pg, { until: 'lmfc_v61.sql' });
await seed(fresh.db);
const before = await catalog(fresh.db);
await fresh.db.exec(sqlFile('lmfc_v62.sql'));
await fresh.db.exec(sqlFile('lmfc_v62_retour.sql'));
await fresh.db.exec(sqlFile('lmfc_v62_retour.sql'));   // rejouable
assert.deepEqual(await catalog(fresh.db), before, 'le retour rend l’état d’avant');
assert.equal((await fresh.db.query(`select count(*)::int n from public.custom_forms where titre = any($1)`, [TITRES])).rows[0].n, 0);
assert.ok(start.functions.length > 0);

console.log('v62-sql : OK');
