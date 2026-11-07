/* lmfc_v47.sql : le RPE, les courbatures et l'avis de match dans Formulaires.
   Les réponses déjà données ne bougent pas, rien ne change tant que personne ne
   modifie les formulaires, et les réglages valent par équipe, dans la base.
   Joué sur deux états, avec les migrations réelles (full-db.mjs) :
     - la production du 06/11/2026, sans lmfc_v42.sql ;
     - le code complet, où l'analyste existe.
   lmfc_v47_retour.sql rend l'état d'avant, à l'identique.
   Lancement : voir access-matrix-sql.test.mjs. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fullDb, sqlFile, seed, actor, catalog, P, T, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v47-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const page = (f) => readFileSync(new URL(`../web/assets/js/${f}`, import.meta.url), 'utf8');
const SOURCES = ['avis_match', 'courbatures', 'rpe_match', 'rpe_seance'];
const added = { id: 'douleur', label: 'As-tu eu mal ?', type: 'boolean', required: true };

async function run(label, files, analyst) {
  const { db } = await fullDb(pg, { until: 'lmfc_v38.sql' });
  await seed(db);
  for (const f of files) await db.exec(sqlFile(f));
  const as = actor(db), q = (s, p) => db.query(s, p);
  const day = (await q(`select current_date::text d`)).rows[0].d;
  const say = (m) => `${label} : ${m}`;
  if (analyst) await q(`update public.profiles set role = 'analyste', team_ids = '{${T.pro}}' where id = $1`, [P.coachSans]);

  await db.exec(`
insert into public.sessions (id, club_id, created_by, titre, date_seance, team_id, acces) overriding system value values
 (101, 1, '${P.coachPro}', 'Pro A', '${day}', ${T.pro}, 'equipe'), (102, 1, '${P.coachU14}', 'U14 A', '${day}', ${T.u14}, 'equipe'),
 (103, 1, '${P.coachPro}', 'Pro B', '${day}', ${T.pro}, 'equipe'), (104, 1, '${P.coachPro}', 'Pro ancienne', '${day}'::date - 20, ${T.pro}, 'equipe');
insert into public.matches (id, club_id, team_id, adversaire, date_match, created_by) overriding system value values
 (201, 1, ${T.pro}, 'Nantes', '${day}', '${P.coachPro}'), (202, 1, ${T.u14}, 'Angers', '${day}', '${P.coachU14}');
`);
  await as(P.joueurPro, async () => {
    await q(`select public.rpe_set(101, 7)`);
    await q(`select public.match_rpe_set(201, 6)`);
    await q(`select public.soreness_set(3, '{mollets}')`);
    await q(`select public.match_feedback_set(201, 'Bon match', 'Bien en bloc')`);
  });
  const history = async () => ({
    rpe: (await q(`select * from public.session_rpe order by session_id, player_id`)).rows,
    matchRpe: (await q(`select * from public.match_rpe order by match_id, player_id`)).rows,
    courbatures: (await q(`select * from public.player_soreness order by player_id, jour`)).rows,
    avis: (await q(`select * from public.match_feedback order by match_id, player_id`)).rows,
  });
  const answers = await history(), start = await catalog(db);

  // Un formulaire libre et sa réponse : ils passent la migration sans changer.
  const questions = [{ id: 'q1', label: 'Une question', type: 'text', required: true }];
  const save = (uid, id, title, list, teams, version = null, active = true) => as(uid, () =>
    q(`select public.custom_form_save($1, $2, null, $3::jsonb, $4::bigint[], $5, $6) r`, [id, title, JSON.stringify(list), teams, active, version])).then(x => x.rows[0].r);
  const free = (await save(P.admin, null, 'Libre', questions, [T.pro])).id;
  const freeVersion = (await as(P.joueurPro, () => q(`select version_id from public.custom_forms_my_pending()`))).rows[0].version_id;
  await as(P.joueurPro, () => q(`select public.custom_form_submit($1, $2::jsonb)`, [freeVersion, JSON.stringify({ q1: 'Réponse libre' })]));

  await db.exec(sqlFile('lmfc_v47.sql'));
  await db.exec(sqlFile('lmfc_v47.sql'));   // rejouable

  const form = async (source, club = 1) => (await q(`select id from public.custom_forms where club_id = $1 and source = $2 order by id limit 1`, [club, source])).rows[0].id;
  const latest = async (id) => (await q(`select version_no, questions from public.custom_form_versions where form_id = $1 order by version_no desc limit 1`, [id])).rows[0];
  const teamsOf = async (id) => (await q(`select team_id from public.custom_form_teams where form_id = $1 order by team_id`, [id])).rows.map(r => Number(r.team_id));
  const rpeList = (uid) => as(uid, async () => (await q(`select * from public.my_rpe_sessions()`)).rows);
  const ids = (rows, key = 'session_id') => rows.map(r => Number(r[key])).sort((a, b) => a - b);
  const sources = (uid) => as(uid, async () => (await q(`select public.my_form_sources() s`)).rows[0].s.sort());
  const eventForms = (uid, kind, id) => as(uid, async () => (await q(`select source from public.my_event_forms($1, $2)`, [kind, id])).rows.map(r => r.source).sort());
  const pending = (uid) => as(uid, async () => (await q(`select * from public.custom_forms_my_pending()`)).rows);
  const submit = (uid, version, reply, occurrence) => as(uid, () =>
    q(`select public.custom_form_submit($1, $2::jsonb, $3)`, [version, JSON.stringify(reply), occurrence]));

  /* Rien ne change tant que personne ne modifie. */
  for (const [club, teams] of [[1, [T.pro, T.n2, T.espoirs, T.u17, T.u14]], [2, [T.autre]]]) {
    const rows = (await q(`select source, actif, created_by from public.custom_forms where club_id = $1 and source is not null order by source`, [club])).rows;
    assert.deepEqual(rows.map(r => r.source), SOURCES, say(`club ${club} : quatre formulaires, une seule fois`));
    assert.ok(rows.every(r => r.actif), say('actifs'));
    for (const s of SOURCES) assert.deepEqual(await teamsOf(await form(s, club)), teams, say(`${s} : toutes les équipes du club ${club}`));
  }
  assert.deepEqual(await history(), answers, say('aucune réponse touchée'));
  assert.equal((await q(`select count(*)::int n from public.custom_form_responses where form_id = $1`, [free])).rows[0].n, 1, say('la réponse libre reste'));
  assert.deepEqual(ids(await rpeList(P.joueurPro)), [101, 103], say('le joueur Pro note les mêmes séances'));
  assert.deepEqual(ids(await rpeList(P.joueurU14)), [102], say('la joueuse U14 aussi'));
  assert.deepEqual(await pending(P.joueurPro), [], say('rien de plus à remplir'));
  assert.deepEqual(await sources(P.joueurPro), SOURCES, say('son équipe reçoit les quatre'));

  // Mêmes textes qu'à l'écran : la migration ne change aucune question.
  const shown = { rpe: page('rpe.js'), sore: page('soreness.js'), avis: page('match-feedback.js') };
  assert.match(shown.rpe, /Comment as-tu ressenti l’effort de \$\{rpeWhat\(session\)\} \?/);
  assert.match(shown.rpe, /'toute la séance'/);
  assert.match(shown.rpe, /'tout le match'/);
  assert.match(shown.rpe, /'Ton effort'/);
  const labels = async (s) => (await latest(await form(s))).questions.map(x => x.label);
  assert.deepEqual(await labels('rpe_seance'), ['Comment as-tu ressenti l’effort de toute la séance ?']);
  assert.deepEqual(await labels('rpe_match'), ['Comment as-tu ressenti l’effort de tout le match ?']);
  for (const text of await labels('courbatures')) assert.ok(shown.sore.includes(text), say(`courbatures : ${text}`));
  for (const text of await labels('avis_match')) assert.ok(shown.avis.includes(text), say(`avis : ${text}`));
  const muscles = (await latest(await form('courbatures'))).questions[1].options;
  for (const m of muscles) assert.ok(shown.sore.includes(`'${m}'`), say(`muscle : ${m}`));

  /* Renommer, reformuler : le joueur le voit, les réponses ne bougent pas. */
  const rpeForm = await form('rpe_seance'), allTeams = await teamsOf(rpeForm);
  const rpeQuestion = (await latest(rpeForm)).questions[0];
  const reworded = { ...rpeQuestion, label: 'Ta séance était dure comment ?' };
  assert.equal((await save(P.admin, rpeForm, 'Ressenti', [reworded], allTeams, 1)).version_no, 2, say('renommer crée une version'));
  const seen = (await rpeList(P.joueurPro)).find(r => Number(r.session_id) === 101);
  assert.equal(seen.form_titre, 'Ressenti', say('le nom suit'));
  assert.equal(seen.form_questions[0].label, 'Ta séance était dure comment ?', say('la question suit'));
  assert.equal(seen.rpe, 7, say('sa réponse reste'));
  assert.deepEqual(await history(), answers, say('aucune réponse touchée par le renommage'));

  /* Les questions d'origine sont protégées par la base. */
  await assert.rejects(save(P.admin, rpeForm, 'Ressenti', [added], allTeams), /ne se retire pas/, say('retirer le RPE'));
  await assert.rejects(save(P.admin, rpeForm, 'Ressenti', [{ ...reworded, max: 5 }], allTeams), /Seul l’intitulé/, say('changer son échelle'));
  await assert.rejects(save(P.admin, rpeForm, 'Ressenti', [{ ...reworded, type: 'number' }], allTeams), /Seul l’intitulé/, say('changer son type'));
  await assert.rejects(save(P.admin, rpeForm, 'Ressenti', [reworded, { ...added, fixe: true }], allTeams), /ne peut pas être marquée/, say('se faire passer pour une question d’origine'));
  const soreForm = await form('courbatures'), soreQuestions = (await latest(soreForm)).questions;
  await assert.rejects(save(P.admin, soreForm, 'Courbes', [soreQuestions[0]], allTeams), /ne se retire pas/, say('retirer les muscles'));
  const avisForm = await form('avis_match'), avisQuestions = (await latest(avisForm)).questions;
  await save(P.admin, avisForm, 'Ton avis sur le match', [avisQuestions[0]], allTeams);
  await assert.rejects(save(P.admin, avisForm, 'Ton avis sur le match', [added], allTeams), /Gardez au moins une question/, say('avis sans question d’origine'));
  await save(P.admin, avisForm, 'Ton avis sur le match', avisQuestions, allTeams);

  /* Par équipe : c'est l'équipe de la séance ou du match qui décide. */
  const others = allTeams.filter(t => t !== T.u14);
  await save(P.admin, rpeForm, 'Ressenti', [reworded], others);
  assert.deepEqual(await rpeList(P.joueurU14), [], say('équipe décochée : plus de RPE proposé'));
  assert.deepEqual(ids(await rpeList(P.joueurPro)), [101, 103], say('les autres équipes le gardent'));
  assert.deepEqual(await eventForms(P.joueurU14, 'seance', 102), [], say('la fiche du calendrier le sait'));
  assert.ok(!(await sources(P.joueurU14)).includes('rpe_seance'), say('son accueil aussi'));
  assert.equal((await as(P.joueurU14, () => q(`select count(*)::int n from public.my_rpe_matches()`))).rows[0].n, 1, say('le RPE de match reste, c’est un autre formulaire'));
  await save(P.admin, rpeForm, 'Ressenti', [reworded], allTeams);

  const matchForm = await form('rpe_match');
  const others2 = (await teamsOf(matchForm)).filter(t => t !== T.u14);
  const unassign = async (id) => { const v = await latest(id); const t = (await q(`select titre from public.custom_forms where id = $1`, [id])).rows[0].titre; await save(P.admin, id, t, v.questions, others2); };
  await unassign(soreForm);
  await unassign(avisForm);
  await as(P.joueurU14, () => q(`select public.rpe_set(102, 4)`));
  assert.deepEqual((await as(P.joueurU14, () => q(`select * from public.my_soreness_today()`))).rows, [], say('courbatures décochées'));
  assert.equal((await as(P.joueurPro, () => q(`select * from public.my_soreness_today()`))).rows[0].form_titre, 'Courbatures au réveil', say('les autres les gardent'));
  assert.deepEqual((await as(P.joueurU14, () => q(`select * from public.my_avis_matches()`))).rows, [], say('avis décoché'));
  assert.deepEqual(ids((await as(P.joueurPro, () => q(`select * from public.my_avis_matches()`))).rows, 'match_id'), [201], say('les autres le gardent'));
  assert.deepEqual(await eventForms(P.joueurU14, 'match', 202), ['rpe_match'], say('fiche du match U14'));
  assert.deepEqual(await eventForms(P.joueurPro, 'match', 201), ['avis_match', 'rpe_match'], say('fiche du match Pro'));
  assert.deepEqual(await eventForms(P.joueurU14, 'match', 201), [], say('un match qui ne le concerne pas'));
  await save(P.admin, soreForm, 'Courbatures au réveil', soreQuestions, allTeams);
  await save(P.admin, avisForm, 'Ton avis sur le match', avisQuestions, allTeams);

  // Désactivé : plus personne ; séance sans équipe comprise.
  await db.exec(`insert into public.sessions (id, club_id, created_by, titre, date_seance, team_id, acces) overriding system value values (105, 1, '${P.admin}', 'Club', '${day}', null, 'equipe');
    insert into public.attendance (player_id, session_id, statut, invite) values (${J.pro}, 105, 'present', true);`);
  assert.deepEqual(ids(await rpeList(P.joueurPro)), [101, 103, 105], say('séance sans équipe : proposée'));
  await save(P.admin, rpeForm, 'Ressenti', [reworded], allTeams, null, false);
  assert.deepEqual(await rpeList(P.joueurPro), [], say('désactivé : plus proposé'));
  assert.deepEqual(await history().then(h => h.rpe.filter(r => Number(r.session_id) === 101)), answers.rpe, say('désactivé : la réponse reste'));
  await save(P.admin, rpeForm, 'Ressenti', [reworded], allTeams);

  /* Une copie par catégorie, sans toucher aux autres équipes. */
  await assert.rejects(save(P.prepaU14, rpeForm, 'Ressenti U14', [reworded], [T.u14]), /Seul un administrateur/, say('prépa : le formulaire partagé reste à l’admin'));
  const duplicate = (uid, id) => as(uid, () => q(`select public.custom_form_duplicate($1) r`, [id])).then(x => x.rows[0].r);
  for (const [who, why] of [[P.coachU14, 'coach'], [P.lecteur, 'lecteur'], [P.joueurU14, 'joueur'], [P.adminB, 'autre club'], [null, 'anonyme']]) {
    await assert.rejects(duplicate(who, rpeForm), /hors de votre périmètre|permission denied/, say(`${why} : pas de copie`));
  }
  if (analyst) await assert.rejects(duplicate(P.coachSans, rpeForm), /hors de votre périmètre/, say('analyste : pas de copie'));
  const copy = Number((await duplicate(P.prepaU14, rpeForm)).id);
  const copied = (await q(`select titre, source, actif, created_by from public.custom_forms where id = $1`, [copy])).rows[0];
  assert.deepEqual({ ...copied }, { titre: 'Ressenti (copie)', source: 'rpe_seance', actif: false, created_by: P.prepaU14 }, say('copie désactivée, de la même sorte'));
  assert.deepEqual(await teamsOf(copy), [], say('copie sans équipe'));
  assert.deepEqual(ids(await rpeList(P.joueurU14)), [102], say('tant qu’elle n’a pas d’équipe, rien ne change'));
  await assert.rejects(save(P.prepaU14, copy, 'RPE U14', [reworded], [T.pro]), /hors de votre périmètre/, say('prépa : pas l’équipe d’un autre'));
  const u14Question = { ...rpeQuestion, label: 'Séance facile ou dure ?' };
  await save(P.prepaU14, copy, 'RPE U14', [u14Question], [T.u14]);
  assert.deepEqual(await teamsOf(copy), [T.u14], say('la copie a son équipe'));
  assert.ok(!(await teamsOf(rpeForm)).includes(T.u14), say('l’équipe a quitté le formulaire partagé'));
  assert.equal((await teamsOf(rpeForm)).length, allTeams.length - 1, say('les autres équipes y restent'));
  const u14 = (await rpeList(P.joueurU14)).find(r => Number(r.session_id) === 102);
  assert.deepEqual([u14.form_titre, u14.form_questions[0].label], ['RPE U14', 'Séance facile ou dure ?'], say('la catégorie a son questionnaire'));
  assert.equal((await rpeList(P.joueurPro))[0].form_titre, 'Ressenti', say('le Pro garde le sien'));
  await assert.rejects(save(P.prepaU14, copy, 'RPE U14', [{ ...added }], [T.u14]), /ne se retire pas/, say('une copie reste protégée'));

  /* Qui voit quoi. */
  const visible = (uid) => as(uid, async () => (await q(`select count(*)::int n from public.custom_forms where source is not null`)).rows[0].n);
  assert.equal(await visible(P.admin), 5, say('admin : tout son club'));
  assert.equal(await visible(P.adminB), 4, say('autre club : les siens seulement'));
  assert.equal(await visible(P.coachPro), 0, say('coach : pas de gestion'));
  assert.equal(await visible(P.joueurPro), 0, say('joueur : pas de gestion'));
  assert.equal(await visible(P.lecteur), 0, say('lecteur : pas de gestion'));
  if (analyst) assert.equal(await visible(P.coachSans), 0, say('analyste : pas de gestion'));
  await q(`update public.profiles set role = 'prepa', team_ids = '{}' where id = $1`, [P.coachU17]);
  assert.equal(await visible(P.coachU17), 0, say('prépa sans équipe : rien'));
  await q(`update public.profiles set role = 'coach', team_ids = '{${T.u17}}' where id = $1`, [P.coachU17]);
  for (const call of [`public.custom_form_for('rpe_seance', 1, 1)`, `public.custom_forms_seed(1)`, `public.custom_form_defaults('rpe_seance')`]) {
    await assert.rejects(as(P.admin, () => q(`select * from ${call}`)), /permission denied/, say(`${call} : interne`));
    await assert.rejects(as(P.joueurPro, () => q(`select * from ${call}`)), /permission denied/, say(`${call} : interne (joueur)`));
  }
  for (const call of [`public.my_form_sources()`, `public.my_avis_matches()`, `public.my_event_forms('seance', 101)`, `public.custom_forms_my_pending()`]) {
    await assert.rejects(as(null, () => q(`select * from ${call}`)), /permission denied/, say(`${call} : pas sans compte`));
    assert.equal((await as(P.coachPro, () => q(`select count(*)::int n from (select * from ${call}) x`))).rows[0].n, call.includes('sources') ? 1 : 0, say(`${call} : rien pour le staff`));
  }
  await assert.rejects(as(P.joueurPro, () => q(`insert into public.custom_form_teams (form_id, team_id, club_id) values (${rpeForm}, ${T.u14}, 1)`)), /permission denied/, say('écriture directe'));

  /* Nouvelle équipe, nouveau club : comme avant, rien à régler. */
  const newTeam = (await q(`insert into public.teams (club_id, nom) values (1, 'U19') returning id`)).rows[0].id;
  for (const s of SOURCES) assert.ok((await teamsOf(await form(s))).includes(Number(newTeam)), say(`nouvelle équipe : ${s}`));
  const newClub = (await q(`insert into public.clubs (nom, join_code) values ('Neuf', 'CCCC') returning id`)).rows[0].id;
  assert.equal((await q(`select count(*)::int n from public.custom_forms where club_id = $1`, [newClub])).rows[0].n, 4, say('nouveau club'));
  await q(`insert into public.teams (club_id, nom) values ($1, 'Seniors')`, [newClub]);
  assert.equal((await q(`select count(*)::int n from public.custom_form_teams where club_id = $1`, [newClub])).rows[0].n, 4, say('sa première équipe'));

  /* Questions ajoutées : après la réponse d'origine, une fois par séance. */
  await save(P.admin, rpeForm, 'Ressenti', [reworded, added], await teamsOf(rpeForm));
  const rows = await pending(P.joueurPro);
  assert.deepEqual(rows.map(r => r.occurrence), ['s101'], say('seulement la séance déjà notée'));
  assert.deepEqual(rows[0].questions, [added], say('seulement la question ajoutée'));
  assert.ok(rows[0].titre.startsWith('Ressenti · Pro A · '), say('le joueur sait de quelle séance il s’agit'));
  const version = rows[0].version_id;
  await assert.rejects(submit(P.joueurPro, version, {}, 's101'), /Réponds à/, say('réponse obligatoire'));
  await assert.rejects(submit(P.joueurPro, version, { douleur: true }, 's103'), /plus à remplir/, say('séance pas encore notée'));
  await assert.rejects(submit(P.joueurPro, version, { douleur: true }, 's102'), /plus à remplir/, say('séance d’une autre équipe'));
  await assert.rejects(submit(P.joueurPro, version, { douleur: true }, ''), /plus à remplir/, say('sans séance'));
  await assert.rejects(submit(P.joueurU14, version, { douleur: true }, 's101'), /plus à remplir/, say('à la place d’un autre'));
  await submit(P.joueurPro, version, { douleur: true }, 's101');
  await assert.rejects(submit(P.joueurPro, version, { douleur: false }, 's101'), /plus à remplir/, say('une seule réponse'));
  assert.deepEqual(await pending(P.joueurPro), [], say('rien de plus'));
  await as(P.joueurPro, () => q(`select public.rpe_set(103, 5)`));
  assert.deepEqual((await pending(P.joueurPro)).map(r => r.occurrence), ['s103'], say('la séance suivante, même version'));
  await submit(P.joueurPro, version, { douleur: false }, 's103');
  const saved = (await q(`select form_title_snapshot t, team_id, occurrence, answers, questions_snapshot qs from public.custom_form_responses where occurrence = 's101'`)).rows[0];
  assert.equal(Number(saved.team_id), T.pro, say('rangée dans l’équipe de la séance'));
  assert.deepEqual([saved.answers, saved.qs], [{ douleur: true }, [added]], say('réponse et question conservées'));
  const read = (uid) => as(uid, async () => (await q(`select count(*)::int n from public.custom_form_responses where occurrence <> ''`)).rows[0].n);
  assert.equal(await read(P.admin), 2, say('admin'));
  assert.equal(await read(P.coachPro), 2, say('coach de l’équipe'));
  assert.equal(await read(P.prepaPro), 2, say('prépa de l’équipe'));
  assert.equal(await read(P.coachU14), 0, say('coach d’une autre équipe'));
  assert.equal(await read(P.joueurU14), 0, say('autre joueur'));
  assert.equal(await read(P.adminB), 0, say('autre club'));
  if (analyst) assert.equal(await read(P.coachSans), 2, say('analyste de l’équipe'));
  const mine = (await as(P.joueurPro, () => q(`select titre from public.custom_forms_my_history()`))).rows.map(r => r.titre);
  assert.ok(mine.some(t => t.startsWith('Ressenti · Pro A')), say('dans son historique'));

  // Modifier ou désactiver ne perd rien.
  await save(P.admin, rpeForm, 'Ressenti', [reworded], await teamsOf(rpeForm));
  assert.equal(await read(P.coachPro), 2, say('question retirée : les réponses restent'));
  assert.deepEqual((await q(`select questions_snapshot qs from public.custom_form_responses where occurrence = 's101'`)).rows[0].qs, [added], say('avec leur intitulé'));

  // Courbatures et avis : même chemin.
  await save(P.admin, soreForm, 'Courbatures au réveil', [...soreQuestions, added], await teamsOf(soreForm));
  await save(P.admin, avisForm, 'Ton avis sur le match', [...avisQuestions, { ...added, id: 'titulaire', label: 'Content de ton temps de jeu ?' }], await teamsOf(avisForm));
  const more = await pending(P.joueurPro);
  assert.deepEqual(more.map(r => r.occurrence).sort(), [`j${day}`, 'm201'], say('courbatures du jour et avis du match'));
  const avisRow = more.find(r => r.occurrence === 'm201');
  await submit(P.joueurPro, avisRow.version_id, { titulaire: true }, 'm201');
  assert.deepEqual((await pending(P.joueurPro)).map(r => r.occurrence), [`j${day}`], say('il reste les courbatures'));

  // Un formulaire libre ne prend pas d'occurrence, et se comporte comme avant.
  const freeNew = (await save(P.admin, null, 'Libre 2', questions, [T.pro])).id;
  const freeRow = (await pending(P.joueurPro)).find(r => Number(r.form_id) === Number(freeNew));
  assert.equal(freeRow.occurrence, '', say('libre : pas d’occurrence'));
  await assert.rejects(submit(P.joueurPro, freeRow.version_id, { q1: 'x' }, 's101'), /Réponses invalides/, say('libre : occurrence refusée'));
  await as(P.joueurPro, () => q(`select public.custom_form_submit($1, $2::jsonb)`, [freeRow.version_id, JSON.stringify({ q1: 'x' })]));
  await assert.rejects(as(P.joueurPro, () => q(`select public.custom_form_submit($1, $2::jsonb)`, [freeRow.version_id, JSON.stringify({ q1: 'y' })])), /déjà répondu/, say('libre : une seule réponse'));
  assert.deepEqual(await history().then(h => h.avis), answers.avis, say('l’avis du match n’a pas bougé'));

  /* Retour arrière : refusé tant qu'une réponse serait perdue, puis à l'identique. */
  const refused = async (why) => {
    await assert.rejects(db.exec(sqlFile('lmfc_v47_retour.sql')), /des joueurs ont répondu/, say(why));
    await db.exec('rollback');
  };
  await refused('retour refusé : réponses aux questions ajoutées');
  await db.exec(`delete from public.custom_form_responses where occurrence <> ''`);
  await db.exec(`insert into public.trash (batch, club_id, tbl, row_id, root_tbl, data) values (1, 1, 'custom_form_responses', 9, 'players', '{"occurrence": "s101"}')`);
  await refused('retour refusé : réponse à la corbeille');
  await db.exec(`delete from public.trash where tbl = 'custom_form_responses'`);
  await db.exec(sqlFile('lmfc_v47_retour.sql'));
  await db.exec(sqlFile('lmfc_v47_retour.sql'));
  const back = await catalog(db);
  for (const k of Object.keys(start)) assert.deepEqual(back[k], start[k], say(`retour arrière, ${k} à l'identique`));
  assert.equal((await q(`select count(*)::int n from public.custom_forms`)).rows[0].n, 2, say('les formulaires libres restent'));
  assert.equal((await q(`select count(*)::int n from public.custom_form_responses`)).rows[0].n, 2, say('leurs réponses aussi'));
  assert.deepEqual(ids(await rpeList(P.joueurPro)), [101, 103, 105], say('tout le monde retrouve le RPE'));
  await db.close();
}

await run('production', ['lmfc_v39.sql', 'lmfc_v40.sql', 'lmfc_v41.sql', 'lmfc_v43.sql', 'lmfc_v46.sql', 'lmfc_v44.sql', 'lmfc_v45.sql'], false);
await run('code complet', ['lmfc_v39.sql', 'lmfc_v40.sql', 'lmfc_v41.sql', 'lmfc_v42.sql', 'lmfc_v43.sql', 'lmfc_v44.sql', 'lmfc_v45.sql', 'lmfc_v46.sql'], true);

console.log('v47-sql : OK (réponses intactes, textes, équipes, copies, questions ajoutées, droits, retour arrière ; production et code complet)');
process.exit(0);
