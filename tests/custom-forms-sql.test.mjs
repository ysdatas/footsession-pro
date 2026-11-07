/* Formulaires versionnés : permissions, périmètre équipe, versions conservées,
   erreurs atomiques et retour arrière. Requiert PGlite comme les autres tests SQL. */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([
    import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/pgcrypto'),
    import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent'),
  ]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('custom-forms-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db, rest } = await fullDb(pg, { until: 'lmfc_v43.sql' });
assert.deepEqual(rest.slice(0, 2), ['lmfc_v44.sql', 'lmfc_v45.sql'], 'v44 et v45 sont les migrations suivantes');
await seed(db);
const as = actor(db), q = (sql, params = []) => db.query(sql, params);
const before = await catalog(db);
await db.exec(sqlFile('lmfc_v44.sql'));
await db.exec(sqlFile('lmfc_v44.sql'));
await db.exec(sqlFile('lmfc_v45.sql'));
await db.exec(sqlFile('lmfc_v45.sql'));

const questions1 = [
  { id: 'charge', label: 'Comment était la charge ?', type: 'scale', min: 1, max: 10, required: true },
  { id: 'retour', label: 'Un commentaire ?', type: 'textarea', required: false },
];
const save = (uid, { id = null, title = 'Effort de séance', description = null, questions = questions1, teams = [T.pro], active = true, version = null } = {}) =>
  as(uid, () => q(`select public.custom_form_save($1, $2, $3, $4::jsonb, $5::bigint[], $6, $7) result`,
    [id, title, description, JSON.stringify(questions), teams, active, version]));

const created = (await save(P.admin, { description: 'Questionnaire équipe', teams: [T.pro, T.n2] })).rows[0].result;
const formId = Number(created.id);
assert.equal(created.version_no, 1, 'création : première version');
assert.deepEqual((await as(P.admin, () => q(`select team_id from public.custom_form_teams where form_id = $1 order by team_id`, [formId]))).rows.map(x => Number(x.team_id)), [T.pro, T.n2], 'deux équipes affectées');
assert.equal((await as(P.prepaPro, () => q(`select count(*)::int n from public.custom_forms where id = $1`, [formId]))).rows[0].n, 1,
  'préparateur affecté à Pro voit ce formulaire');
assert.equal((await as(P.prepaU14, () => q(`select count(*)::int n from public.custom_forms where id = $1`, [formId]))).rows[0].n, 0,
  'préparateur U14 ne voit pas un formulaire affecté seulement à Pro et N2');
await as(P.admin, () => q(`update public.profiles set team_ids = '{}'::bigint[] where id = $1`, [P.prepaPro]));
assert.deepEqual((await as(P.prepaPro, () => q(`select public.custom_form_can_manage_team($1) p, public.custom_form_can_manage_team($2) n`, [T.pro, T.u14]))).rows[0], { p: false, n: false },
  'un préparateur sans équipe ne gère aucune équipe');
await assert.rejects(save(P.prepaPro, { teams: [T.u14] }), /hors de votre périmètre/i, 'un préparateur sans équipe n’affecte rien');
assert.equal((await as(P.prepaPro, () => q(`select count(*)::int n from public.custom_forms where id = $1`, [formId]))).rows[0].n, 0,
  'un préparateur sans équipe ne lit pas les formulaires des équipes');
await as(P.admin, () => q(`update public.profiles set team_ids = array[$1]::bigint[] where id = $2`, [T.pro, P.prepaPro]));
assert.equal((await as(P.lecteur, () => q(`select count(*)::int n from public.custom_forms`))).rows[0].n, 0,
  'lecteur ne lit pas les formulaires');
assert.equal((await as(P.coachPro, () => q(`select count(*)::int n from public.custom_forms`))).rows[0].n, 0,
  'coach ne gère pas les formulaires');

await assert.rejects(save(P.coachPro), /réservée aux administrateurs/i, 'coach refusé par la fonction de sauvegarde');
await assert.rejects(save(P.prepaPro, { teams: [T.pro, T.n2] }), /hors de votre périmètre/i, 'préparateur refusé hors équipe');
await assert.rejects(save(P.prepaPro, { id: formId, title: 'Tentative non atomique', teams: [T.pro], version: 1 }),
  /équipe hors de votre périmètre/i, 'un formulaire partagé hors périmètre ne peut pas être modifié par la prépa');
assert.equal((await q(`select titre from public.custom_forms where id = $1`, [formId])).rows[0].titre, 'Effort de séance', 'refus : titre inchangé');
assert.equal((await q(`select count(*)::int n from public.custom_form_versions where form_id = $1`, [formId])).rows[0].n, 1, 'refus : pas de version partielle');

const questions2 = [...questions1, { id: 'sommeil', label: 'Comment as-tu dormi ?', type: 'choice', options: ['Bien', 'Moyen', 'Mal'], required: true }];
const changed = (await save(P.admin, { id: formId, title: 'Effort du joueur', questions: questions2, teams: [T.pro, T.n2], version: 1 })).rows[0].result;
assert.equal(changed.version_no, 2, 'modification de questions : nouvelle version');
assert.equal((await q(`select titre from public.custom_form_versions where form_id = $1 and version_no = 1`, [formId])).rows[0].titre, 'Effort de séance', 'la version historique reste intacte');
assert.equal((await save(P.admin, { id: formId, title: 'Effort du joueur', questions: questions2, teams: [T.pro, T.n2], version: 2 })).rows[0].result.version_no, 2,
  'enregistrer sans changement ne crée pas de version inutile');

const playerPending = await as(P.joueurPro, () => q(`select * from public.custom_forms_my_pending()`));
assert.equal(playerPending.rows.length, 1, 'le joueur voit le formulaire actif affecté à son équipe');
assert.equal(Number(playerPending.rows[0].version_id), Number((await q(`select id from public.custom_form_versions where form_id = $1 and version_no = 2`, [formId])).rows[0].id));
assert.equal((await as(P.joueurU14, () => q(`select count(*)::int n from public.custom_forms_my_pending()`))).rows[0].n, 0,
  'un joueur hors des équipes affectées ne voit pas le formulaire');
await assert.rejects(as(P.joueurU14, () => q(`select public.custom_form_submit($1, $2::jsonb)`, [playerPending.rows[0].version_id,
  JSON.stringify({ charge: 7, sommeil: 'Bien' })])), /ne concerne pas tes équipes/i, 'le serveur refuse un joueur hors équipe');
await assert.rejects(as(P.joueurPro, () => q(`select public.custom_form_submit($1, $2::jsonb)`, [playerPending.rows[0].version_id, JSON.stringify({ charge: 7 })])),
  /Réponds à « Comment as-tu dormi \? »/i, 'les réponses obligatoires sont vérifiées côté serveur');
const submitted = await as(P.joueurPro, () => q(`select public.custom_form_submit($1, $2::jsonb) result`, [playerPending.rows[0].version_id,
  JSON.stringify({ charge: 7, retour: 'Bonne séance', sommeil: 'Bien' })]));
assert.ok(submitted.rows[0].result.response_id, 'le joueur peut envoyer sa réponse');
assert.equal((await as(P.joueurPro, () => q(`select count(*)::int n from public.custom_forms_my_pending()`))).rows[0].n, 0,
  'une réponse retire la version de la liste à remplir');
const history = await as(P.joueurPro, () => q(`select * from public.custom_forms_my_history()`));
assert.equal(history.rows.length, 1, 'le joueur voit sa réponse dans son historique');
assert.equal(history.rows[0].titre, 'Effort du joueur', 'le titre de la version est copié dans la réponse');
assert.equal(history.rows[0].version_no, 2, 'la réponse garde le numéro de version soumis');
assert.equal(history.rows[0].answers.charge, 7, 'les réponses sont conservées');
await assert.rejects(as(P.joueurPro, () => q(`select public.custom_form_submit($1, $2::jsonb)`, [playerPending.rows[0].version_id,
  JSON.stringify({ charge: 7, sommeil: 'Bien' })])), /déjà répondu/i, 'une réponse à une même version ne peut pas être écrasée');
assert.equal((await as(P.coachPro, () => q(`select count(*)::int n from public.custom_form_responses`))).rows[0].n, 1,
  'le coach de l’équipe affectée lit la réponse');
assert.equal((await as(P.coachU14, () => q(`select count(*)::int n from public.custom_form_responses`))).rows[0].n, 0,
  'un coach hors équipe ne lit pas la réponse');
assert.equal((await as(P.joueurU14, () => q(`select count(*)::int n from public.custom_form_responses`))).rows[0].n, 0,
  'un autre joueur ne lit pas la réponse');
assert.equal((await as(P.adminB, () => q(`select count(*)::int n from public.custom_form_responses`))).rows[0].n, 0,
  'un administrateur d’un autre club ne lit pas la réponse');
await assert.rejects(as(P.joueurPro, () => q(`update public.custom_form_responses set answers = '{}'::jsonb`)),
  /permission denied|row-level security/i, 'une réponse existante ne peut pas être modifiée directement');
assert.equal((await as(P.prepaPro, () => q(`select count(*)::int n from public.custom_form_responses`))).rows[0].n, 1,
  'le préparateur de l’équipe lit la réponse');
assert.equal((await as(P.prepaU14, () => q(`select count(*)::int n from public.custom_form_responses`))).rows[0].n, 0,
  'un préparateur d’une autre équipe ne la lit pas');
assert.equal((await as(P.lecteur, () => q(`select count(*)::int n from public.custom_form_responses`))).rows[0].n, 0,
  'le lecteur ne lit aucune réponse');
// Une exception « Aucun » sur le joueur vaut aussi pour ses réponses.
await q(`insert into public.staff_player_access (profile_id, player_id, club_id, niveau) values ($1, ${J.pro}, 1, 'aucun')`, [P.coachPro]);
assert.equal((await as(P.coachPro, () => q(`select count(*)::int n from public.custom_form_responses`))).rows[0].n, 0,
  'exception « Aucun » : le coach ne lit plus les réponses de ce joueur');
await q(`delete from public.staff_player_access`);
await q(`update public.profiles set role = 'analyste', team_ids = '{${T.pro}}' where id = $1`, [P.coachSans]);
assert.equal((await as(P.coachSans, () => q(`select count(*)::int n from public.custom_form_responses`))).rows[0].n, 1,
  'l’analyste de l’équipe lit la réponse');
await q(`update public.profiles set team_ids = '{${T.u14}}' where id = $1`, [P.coachSans]);
assert.equal((await as(P.coachSans, () => q(`select count(*)::int n from public.custom_form_responses`))).rows[0].n, 0,
  'un analyste d’une autre équipe ne la lit pas');
await q(`update public.profiles set role = 'coach', team_ids = '{}' where id = $1`, [P.coachSans]);

await assert.rejects(as(P.joueurPro, () => q(`select public.custom_form_submit($1, $2::jsonb)`, [playerPending.rows[0].version_id,
  JSON.stringify(Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`q${i}`, 1])))])), /Réponses invalides/, 'trop de réponses : refusé');

const questions3 = [...questions2, { id: 'energie', label: 'Énergie aujourd’hui ?', type: 'boolean', required: true }];
await save(P.admin, { id: formId, title: 'Effort mis à jour', questions: questions3, teams: [T.pro, T.n2], version: 2 });
assert.equal((await as(P.joueurPro, () => q(`select * from public.custom_forms_my_history()`))).rows[0].titre, 'Effort du joueur',
  'une nouvelle version ne modifie pas l’instantané historique');
assert.equal((await as(P.joueurPro, () => q(`select count(*)::int n from public.custom_forms_my_pending()`))).rows[0].n, 1,
  'une nouvelle version est proposée même après la réponse à la précédente');
await assert.rejects(as(P.joueurPro, () => q(`select public.custom_form_submit($1, $2::jsonb)`, [playerPending.rows[0].version_id,
  JSON.stringify({ charge: 7, sommeil: 'Bien' })])), /a changé/i, 'une version devenue ancienne ne peut pas être soumise');
await assert.rejects(save(P.admin, { id: formId, title: 'Écrasement obsolète', teams: [T.pro], version: 1 }), /a changé depuis son ouverture/i,
  'une version périmée est refusée');
assert.equal((await q(`select titre from public.custom_forms where id = $1`, [formId])).rows[0].titre, 'Effort mis à jour', 'refus obsolète atomique');
await save(P.admin, { id: formId, title: 'Effort mis à jour', questions: questions3, teams: [T.pro, T.n2], active: false, version: 3 });
assert.equal((await q(`select actif from public.custom_forms where id = $1`, [formId])).rows[0].actif, false, 'désactivation sans suppression');
assert.equal((await q(`select count(*)::int n from public.custom_form_versions where form_id = $1`, [formId])).rows[0].n, 3, 'versions conservées après désactivation');

// Renommer ne redemande rien aux joueurs : seules des questions changées le font.
const renameId = Number((await save(P.admin, { title: 'À renommer', questions: [{ id: 'humeur', label: 'Ta forme ?', type: 'boolean', required: true }] })).rows[0].result.id);
const firstVersion = (await as(P.joueurPro, () => q(`select version_id from public.custom_forms_my_pending() where form_id = $1`, [renameId]))).rows[0].version_id;
await as(P.joueurPro, () => q(`select public.custom_form_submit($1, $2::jsonb)`, [firstVersion, JSON.stringify({ humeur: true })]));
const renamed = (await save(P.admin, { id: renameId, title: 'Renommé', questions: [{ id: 'humeur', label: 'Ta forme ?', type: 'boolean', required: true }], version: 1 })).rows[0].result;
assert.equal(renamed.version_no, 2, 'un nom changé est conservé dans une version');
assert.equal((await as(P.joueurPro, () => q(`select count(*)::int n from public.custom_forms_my_pending() where form_id = $1`, [renameId]))).rows[0].n, 0,
  'renommer ne repropose pas le formulaire');
const renamedVersion = (await q(`select id from public.custom_form_versions where form_id = $1 and version_no = 2`, [renameId])).rows[0].id;
await assert.rejects(as(P.joueurPro, () => q(`select public.custom_form_submit($1, $2::jsonb)`, [renamedVersion, JSON.stringify({ humeur: false })])),
  /déjà répondu/i, 'mêmes questions : une seule réponse');
await save(P.admin, { id: renameId, title: 'Renommé', questions: [{ id: 'humeur', label: 'Ta forme ce matin ?', type: 'boolean', required: true }], version: 2 });
assert.equal((await as(P.joueurPro, () => q(`select count(*)::int n from public.custom_forms_my_pending() where form_id = $1`, [renameId]))).rows[0].n, 1,
  'une question changée repropose le formulaire');
await save(P.admin, { id: renameId, title: 'Renommé', questions: [{ id: 'humeur', label: 'Ta forme ce matin ?', type: 'boolean', required: true }], teams: [T.pro], active: false, version: 3 });

// Un membre du staff peut quitter la plateforme : ses formulaires restent.
await q(`update public.profiles set role = 'prepa', team_ids = '{${T.u14}}' where id = $1`, [P.coachEsp]);
const orphanForm = Number((await save(P.coachEsp, { title: 'Créé par un départ', teams: [T.u14] })).rows[0].result.id);
await q(`delete from auth.users where id = $1`, [P.coachEsp]);
assert.equal((await q(`select created_by from public.custom_forms where id = $1`, [orphanForm])).rows[0].created_by, null, 'compte supprimé : le formulaire reste');

await assert.rejects(save(P.admin, { title: 'Choix invalides', questions: [{ id: 'a', label: 'Choix', type: 'choice', options: ['Seul'], required: true }] }),
  /de 2 à 12 réponses/i, 'les options insuffisantes sont refusées');
await assert.rejects(save(P.admin, { title: 'Sans destinataire', teams: [] }), /au moins une équipe/i, 'un formulaire actif doit avoir une équipe');
await assert.rejects(as(P.prepaU14, () => q(`update public.custom_forms set titre = 'Écriture directe' where id = $1`, [formId])),
  /permission denied|row-level security/i, 'aucune écriture directe des tables');

// Un script refusé laisse sa transaction ouverte : le SQL Editor l'annule, ici on le fait à la main.
const refusedScript = async (file, re, label) => { await assert.rejects(db.exec(sqlFile(file)), re, label); await db.exec('rollback'); };
const responsesOf = async () => (await q(`select count(*)::int n from public.custom_form_responses where player_id = ${J.pro}`)).rows[0].n;
const kept = await responsesOf();
await as(P.admin, () => q(`delete from public.players where id = ${J.pro}`));
assert.equal(await responsesOf(), 0, 'joueur supprimé : ses réponses partent avec lui');
assert.equal((await q(`select count(*)::int n from public.trash where tbl = 'custom_form_responses'`)).rows[0].n, kept, 'elles sont à la corbeille');
await q(`truncate public.custom_form_responses restart identity`);
await refusedScript('lmfc_v45_retour.sql', /des réponses de joueurs existent/i, 'retour arrière : une réponse à la corbeille compte aussi');
const trashed = (await q(`select id from public.trash where tbl = 'players' and row_id = ${J.pro}`)).rows[0].id;
await as(P.admin, () => q(`select public.trash_restore(array[${trashed}]::bigint[])`));
assert.equal(await responsesOf(), kept, 'joueur restauré : il retrouve ses réponses');
assert.equal((await as(P.joueurPro, () => q(`select count(*)::int n from public.custom_forms_my_history()`))).rows[0].n, kept, 'et son historique');
const historyIds = async (args) => (await as(P.joueurPro, () => q(`select response_id from public.custom_forms_my_history(${args})`))).rows.map(r => Number(r.response_id));
const allHistory = await historyIds('');
assert.ok(allHistory.length >= 2, 'assez de réponses pour tester la page suivante');
assert.deepEqual([...await historyIds('1, 0'), ...await historyIds('1, 1')], allHistory.slice(0, 2), 'la page suivante reprend où la précédente s’arrête');

await refusedScript('lmfc_v45_retour.sql', /des réponses de joueurs existent/i, 'retour arrière refuse la perte des réponses');
await q(`truncate public.custom_form_responses restart identity`);
await db.exec(sqlFile('lmfc_v45_retour.sql'));
await refusedScript('lmfc_v44_retour.sql', /des formulaires existent/i, 'retour arrière refuse la perte des définitions');
await q(`truncate public.custom_form_teams, public.custom_form_versions, public.custom_forms restart identity cascade`);
await db.exec(sqlFile('lmfc_v44_retour.sql'));
assert.deepEqual(await catalog(db), before, 'retour arrière restaure le catalogue si aucune définition ne subsiste');
await db.close();
console.log('custom-forms-sql : OK (versions, équipes, droits, réponses immuables, historique, retours arrière)');
