/* lmfc_v49.sql : timeline de codage (onglet Analyse), sur toutes les migrations
   réelles (full-db.mjs), avec des comptes distincts (coach, lecteur, joueur,
   coach d'une autre équipe, autre club).
   - un clip réservé au staff est invisible du joueur par toutes les voies :
     lecture, modification, suppression, fonctions, corbeille ; il ne peut ni
     en créer ni le démasquer ; les anciennes séquences restent visibles ;
   - save_sequence_code : clip + codage en une transaction (un refus n'en laisse rien) ;
     toujours réservé au staff à la création, visibilité jamais touchée ensuite ;
   - bulk_update_sequence_codes : tags sans doublon, champs communs, action
     jamais changée, tout ou rien ;
   - undo_sequence_changes : défait sans écraser ce qui a changé depuis ;
   - catalogue : droits, archivage, renommage clips + catalogue ;
   - rejouable ; lmfc_v49_retour.sql refusé tant qu'il reste un clip réservé au
     staff, puis rend l'état d'avant à l'identique.
   Lancement : voir access-matrix-sql.test.mjs (PGlite relié le temps du test). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('analyse-v49-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db } = await fullDb(pg, { until: 'lmfc_v48.sql' });
const before = await catalog(db);
await db.exec(sqlFile('lmfc_v49.sql'));
await db.exec(sqlFile('lmfc_v49.sql'));   // rejouable
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const rows = async (uid, s, p) => (await as(uid, () => q(s, p))).rows;
const one = async (uid, s, p) => (await rows(uid, s, p))[0];
const fails = async (uid, s, re, msg) => assert.rejects(as(uid, () => q(s)), re, msg);
const J$ = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const code = async (id) => (await q(`select * from public.sequence_codes where sequence_id = $1`, [id])).rows[0];
const count = async (t) => (await q(`select count(*)::int n from public.${t}`)).rows[0].n;

// Une vidéo du joueur Pro et une ancienne séquence (d'avant la migration : visible du joueur).
await db.exec(`
insert into public.player_videos (id, club_id, player_id, titre, storage_path) overriding system value values
  (301, 1, ${J.pro}, 'Match A', 'r2/1/a.mp4'), (302, 2, ${J.autre}, 'Autre', 'r2/2/b.mp4');
insert into public.video_sequences (id, club_id, player_id, video_id, label, start_sec, end_sec) overriding system value values
  (401, 1, ${J.pro}, 301, 'Ancienne', 10, 20);`);
assert.equal((await q(`select staff_only from public.video_sequences where id = 401`)).rows[0].staff_only, false, 'ancienne séquence : visibilité inchangée');

/* ---------- Créer un clip et son codage, en une transaction ---------- */
const save = (id, start, end, c) => `select public.save_sequence_code(${id ?? 'null'}, 301, 'Séquence 2', ${start}, ${end}, ${J$(c)}) id`;
const clip = Number((await one(P.coachPro, save(null, 50, 58, { action: 'passe', resultat: 'ok', direction: 'verticale', tags: ['A'], minute_match: 12 }))).id);
const seq = (await q(`select * from public.video_sequences where id = $1`, [clip])).rows[0];
assert.deepEqual([seq.staff_only, Number(seq.player_id), Number(seq.club_id), seq.label, Number(seq.start_sec)], [true, J.pro, 1, 'Séquence 2', 50],
  'créé depuis l\'Analyse : réservé au staff, joueur et club pris sur la vidéo');
assert.deepEqual((({ action, resultat, direction, tags, minute_match }) => ({ action, resultat, direction, tags, minute_match }))(await code(clip)),
  { action: 'passe', resultat: 'ok', direction: 'verticale', tags: ['A'], minute_match: 12 });

// Un refus n'en laisse rien : ni séquence, ni codage.
const [nSeq, nCode] = [await count('video_sequences'), await count('sequence_codes')];
await fails(P.coachPro, save(null, 60, 65, { action: 'passe', resultat: 'but' }), /resultat_check/, 'résultat de tir sur une passe');
await fails(P.coachPro, save(null, 70, 60, { action: 'passe' }), /check/, 'fin avant le début');
await fails(P.coachPro, `select public.save_sequence_code(null, 999, 'X', 1, 2, '{}'::jsonb)`, /Vidéo introuvable/);
await fails(P.lecteur, save(null, 60, 65, { action: 'passe' }), /row-level|violates/, 'le lecteur ne crée pas de clip');
await fails(P.coachU14, save(null, 60, 65, { action: 'passe' }), /Vidéo introuvable|row-level|violates/, 'coach sans droit sur le joueur');
assert.deepEqual([await count('video_sequences'), await count('sequence_codes')], [nSeq, nCode], 'aucun clip créé à moitié');

// Modifier découpage, visibilité et codage ensemble ; un codage refusé annule aussi le découpage.
await as(P.coachPro, () => q(save(clip, 51, 59, { action: 'passe', resultat: 'ko', tags: ['A'] })));
assert.deepEqual([Number((await q(`select start_sec from public.video_sequences where id = $1`, [clip])).rows[0].start_sec), (await code(clip)).resultat,
  (await code(clip)).direction], [51, 'ko', 'verticale'], 'un champ non envoyé garde sa valeur');
await as(P.coachPro, () => q(save(clip, null, null, { direction: null, minute_match: null })));
assert.deepEqual([(await code(clip)).direction, (await code(clip)).minute_match, (await code(clip)).resultat], [null, null, 'ko'], 'un champ envoyé à null est vidé');
await fails(P.coachPro, save(clip, 52, 60, { action: 'duel_sol', resultat: 'ok', direction: 'verticale' }), /champs_check/);
assert.equal(Number((await q(`select start_sec from public.video_sequences where id = $1`, [clip])).rows[0].start_sec), 51, 'découpage annulé avec le codage refusé');

/* ---------- Le joueur ne voit ni ne touche un clip réservé au staff ---------- */
const seen = async (uid) => (await rows(uid, `select id from public.video_sequences order by 1`)).map(r => Number(r.id));
const ids = (...a) => a.sort((x, y) => x - y);   // le clip créé reçoit un petit identifiant, l'ancienne séquence est 401
assert.deepEqual(await seen(P.coachPro), ids(401, clip));
assert.deepEqual(await seen(P.lecteur), ids(401, clip), 'le lecteur (scout) voit les clips du staff');
assert.deepEqual(await seen(P.joueurPro), [401], 'le joueur ne voit que la séquence partagée');
assert.deepEqual(await seen(P.coachU14), [], "un coach d'une autre équipe ne voit pas ce joueur");
assert.deepEqual(await seen(P.adminB), [], 'un autre club ne voit rien');
await fails(null, `select id from public.video_sequences`, /permission denied/, 'anonyme : refusé avant même la lecture');
assert.equal((await rows(P.joueurPro, `select 1 from public.sequence_codes`)).length, 0, 'aucun codage pour le joueur');
// Sans filtre (aucune lecture préalable) comme avec : rien ne bouge.
await as(P.joueurPro, () => q(`update public.video_sequences set label = 'vu', staff_only = false where id = ${clip}`));
await as(P.joueurPro, () => q(`update public.video_sequences set label = 'vu'`));
await as(P.joueurPro, () => q(`delete from public.video_sequences`));
const after = (await q(`select id, label, staff_only from public.video_sequences order by id desc`)).rows.map(r => [Number(r.id), r.label, r.staff_only]);
assert.deepEqual(after, [[401, 'vu', false], [clip, 'Séquence 2', true]], 'le joueur ne modifie, ne démasque ni ne supprime le clip du staff (sa séquence partagée, si)');
await fails(P.joueurPro, `insert into public.video_sequences (club_id, player_id, video_id, start_sec, end_sec, staff_only) values (1, ${J.pro}, 301, 1, 2, true)`,
  /row-level|violates/, 'le joueur ne crée pas de clip réservé au staff');
await as(P.joueurPro, () => q(`insert into public.video_sequences (club_id, player_id, video_id, start_sec, end_sec) values (1, ${J.pro}, 301, 1, 2)`));
// Par les fonctions : rien non plus.
await fails(P.joueurPro, save(clip, 1, 2, { action: 'passe' }), /Séquence introuvable/);
await fails(P.joueurPro, `select public.bulk_update_sequence_codes(array[${clip}]::bigint[], '{}'::jsonb, array['X'], null)`, /introuvable|row-level|violates/);
assert.deepEqual((await one(P.joueurPro, `select public.undo_sequence_changes(${J$([{ sequence_id: clip, before: { tags: [] }, after: { tags: ['A'] } }])}) r`)).r,
  { restored: 0, kept: 1 }, 'le joueur ne défait rien');
assert.equal((await one(P.joueurPro, `select public.rename_sequence_tag('A', 'B') n`)).n, 0);
assert.equal(await one(P.joueurPro, `select public.sequence_code_patch(${clip}, '{"tags": []}'::jsonb) ok`).then(r => r.ok), false);
assert.deepEqual((await code(clip)).tags, ['A'], 'codage intact');
// La fonction ne change jamais la visibilité : la séquence partagée le reste, le clip du staff aussi.
await as(P.coachPro, () => q(`select public.save_sequence_code(401, 301, null, 11, 21, '{"action": "passe", "resultat": "ok"}'::jsonb)`));
assert.deepEqual((await q(`select id, staff_only from public.video_sequences where id in (401, ${clip}) order by id desc`)).rows.map(r => r.staff_only), [false, true]);
assert.ok((await seen(P.joueurPro)).includes(401) && !(await seen(P.joueurPro)).includes(clip), 'coder une séquence partagée ne la cache pas au joueur');
// La règle suit la colonne, dans les deux sens (écriture directe du staff, hors interface).
await as(P.coachPro, () => q(`update public.video_sequences set staff_only = false where id = ${clip}`));
assert.ok((await seen(P.joueurPro)).includes(clip), 'démasqué par le staff : visible du joueur');
assert.equal((await rows(P.joueurPro, `select 1 from public.sequence_codes`)).length, 0, 'même démasqué, son codage reste réservé au staff');
await as(P.coachPro, () => q(`update public.video_sequences set staff_only = true where id = ${clip}`));
assert.ok(!(await seen(P.joueurPro)).includes(clip));
await db.exec(`delete from public.sequence_codes where sequence_id = 401`);   // 401 redevient « pas codée » pour la suite

/* ---------- Plusieurs clips d'un coup ---------- */
const duel = Number((await one(P.coachPro, save(null, 80, 85, { action: 'duel_sol', resultat: 'ok', categorie: 'marquage', tags: ['A', 'B'] }))).id);
const bulk = (ids, set, add, del) => `select public.bulk_update_sequence_codes(array[${ids}]::bigint[], ${J$(set)}, ${add ? `array[${add.map(t => `'${t}'`)}]` : 'null'},
  ${del ? `array[${del.map(t => `'${t}'`)}]` : 'null'}) r`;
// 401 n'est pas codée ; clip est une passe ; duel un duel terrestre.
let ch = (await one(P.coachPro, bulk([401, clip, duel], { periode: 2, action: 'tir' }, ['B', 'C', 'B'], null))).r;
assert.deepEqual([(await code(401)).action, (await code(clip)).action, (await code(duel)).action], ['tir', 'passe', 'duel_sol'],
  'l\'action n\'est posée que sur le clip pas encore codé, jamais changée ailleurs');
assert.deepEqual([(await code(401)).tags, (await code(clip)).tags, (await code(duel)).tags], [['B', 'C'], ['A', 'B', 'C'], ['A', 'B', 'C']], 'tags ajoutés sans doublon, les autres restent');
assert.deepEqual([(await code(clip)).periode, (await code(clip)).resultat], [2, 'ko'], 'champ commun écrit, champs techniques intacts');
assert.equal(ch.length, 3);
assert.deepEqual(ch.find(c => c.sequence_id === duel), { sequence_id: duel, before: { periode: null, tags: ['A', 'B'] }, after: { periode: 2, tags: ['A', 'B', 'C'] } },
  'avant / après : les seuls champs changés');
// Tout ou rien : un champ incompatible avec UN clip, une séquence inconnue, un champ interdit.
await fails(P.coachPro, bulk([clip, duel], { direction: 'verticale' }, ['Z'], null), new RegExp(`Séquence ${duel} : valeur incompatible`));
await fails(P.coachPro, bulk([clip, 99999], {}, ['Z'], null), /1 séquence\(s\) sur 2 introuvable/);
await fails(P.coachPro, bulk([clip], { x1: 5 }, null, null), /ne se modifie pas en groupe/);
await fails(P.lecteur, bulk([clip], {}, ['Z'], null), /introuvable|row-level|violates|refusée/, 'le lecteur ne modifie pas en groupe');
assert.ok(!(await code(clip)).tags.includes('Z'), 'rien n\'a été modifié par les opérations refusées');

/* ---------- Défaire sans écraser ce qui a changé depuis ---------- */
// Depuis l'opération : un tag ajouté sur clip, la mi-temps corrigée sur duel, « B » retiré de 401.
await db.exec(`update public.sequence_codes set tags = tags || '{Depuis}' where sequence_id = ${clip};
  update public.sequence_codes set periode = 1 where sequence_id = ${duel};
  update public.sequence_codes set tags = '{C}' where sequence_id = 401;`);
assert.deepEqual((await one(P.coachPro, `select public.undo_sequence_changes(${J$(ch)}) r`)).r, { restored: 2, kept: 1 });
assert.deepEqual([(await code(clip)).tags, (await code(clip)).periode], [['A', 'Depuis'], null], 'ce que l\'opération avait ajouté part, le tag ajouté depuis reste');
assert.deepEqual([(await code(duel)).tags, (await code(duel)).periode], [['A', 'B'], 1], 'mi-temps corrigée depuis : laissée');
assert.deepEqual([(await code(401)).tags, (await code(401)).action, (await code(401)).periode], [[], null, null], '« B » retiré depuis n\'est pas remis');
// Retirer des tags, puis défaire : ils reviennent là où ils étaient.
ch = (await one(P.coachPro, bulk([clip, duel], {}, null, ['A']))).r;
assert.deepEqual([(await code(clip)).tags, (await code(duel)).tags], [['Depuis'], ['B']]);
assert.deepEqual((await one(P.coachPro, `select public.undo_sequence_changes(${J$(ch)}) r`)).r, { restored: 2, kept: 0 });
assert.deepEqual([(await code(clip)).tags, (await code(duel)).tags], [['Depuis', 'A'], ['B', 'A']]);

/* ---------- Catalogue des descripteurs ---------- */
await as(P.coachPro, () => q(`insert into public.sequence_descriptors (nom, categorie, couleur) values ('A', 'tactique', '#ffcc00'), ('Vide', 'technique', null)`));
await fails(P.coachPro, `insert into public.sequence_descriptors (nom) values ('A')`, /unique|duplicate/, 'un nom par club');
await fails(P.coachPro, `insert into public.sequence_descriptors (nom, categorie) values ('X', 'humeur')`, /categorie_check/);
await fails(P.lecteur, `insert into public.sequence_descriptors (nom) values ('L')`, /row-level|violates/, 'le lecteur ne crée pas');
await fails(P.joueurPro, `insert into public.sequence_descriptors (nom) values ('J')`, /row-level|violates/);
await fails(P.coachPro, `insert into public.sequence_descriptors (club_id, nom) values (2, 'Ailleurs')`, /row-level|violates/, 'pas dans un autre club');
const names = async (uid) => (await rows(uid, `select nom from public.sequence_descriptors order by 1`)).map(r => r.nom);
assert.deepEqual([await names(P.coachPro), await names(P.lecteur), await names(P.joueurPro), await names(P.adminB)], [['A', 'Vide'], ['A', 'Vide'], [], []]);
// Archiver : il reste au catalogue et sur les clips.
await as(P.coachPro, () => q(`update public.sequence_descriptors set archived_at = now() where nom = 'A'`));
assert.ok((await code(clip)).tags.includes('A'), 'archivé : toujours sur les clips');
// Renommer : clips et catalogue ensemble ; fusion si le nom existe ; suppression si vide.
assert.equal((await one(P.coachPro, `select public.rename_sequence_tag('A', 'Alpha') n`)).n, 2);
assert.deepEqual([await names(P.coachPro), (await code(duel)).tags], [['Alpha', 'Vide'], ['Alpha', 'B']]);
await as(P.coachPro, () => q(`select public.rename_sequence_tag('Vide', 'Alpha')`));
assert.deepEqual(await names(P.coachPro), ['Alpha'], 'fusion : un seul descripteur');
assert.equal((await one(P.coachPro, `select public.rename_sequence_tag('Alpha', '') n`)).n, 2, 'suppression définitive : retiré des clips');
assert.deepEqual([await names(P.coachPro), (await code(duel)).tags], [[], ['B']]);

/* ---------- Corbeille : le clip du staff y reste réservé ---------- */
await as(P.coachPro, () => q(`delete from public.video_sequences where id = ${duel}`));
assert.equal((await rows(P.joueurPro, `select 1 from public.trash`)).length, 0, 'le joueur ne lit pas la corbeille');
const root = (await q(`select id from public.trash where tbl = 'video_sequences' and row_id = ${duel}`)).rows[0].id;
await as(P.coachPro, () => q(`select public.trash_restore(array[${root}]::bigint[])`));
assert.equal((await q(`select staff_only from public.video_sequences where id = ${duel}`)).rows[0].staff_only, true, 'restauré : toujours réservé au staff');
assert.ok(!(await seen(P.joueurPro)).includes(duel));

/* ---------- Retour arrière ---------- */
await assert.rejects(db.exec(sqlFile('lmfc_v49_retour.sql')), /réservés au staff/);
await db.exec('rollback');   // le refus laisse la transaction du script ouverte
await db.exec(`delete from public.sequence_codes; delete from public.video_sequences; delete from public.trash; delete from public.player_videos;`);
await db.exec(sqlFile('lmfc_v49_retour.sql'));
await db.exec(sqlFile('lmfc_v49_retour.sql'));   // rejouable
const end = await catalog(db);
for (const k of Object.keys(before)) assert.deepEqual(end[k], before[k], `retour arrière : ${k} identique à l'état d'avant`);

console.log('analyse-v49-sql : OK (clips réservés au staff, transactions, groupé, annulation, catalogue, corbeille, retour arrière)');
