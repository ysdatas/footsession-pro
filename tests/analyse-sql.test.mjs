/* lmfc_v48.sql : codage des séquences (onglet Analyse), sur toutes les
   migrations réelles (full-db.mjs).
   - valeurs hors liste, catégorie incohérente, codage d'un autre joueur : refusés ;
   - droits : le coach écrit, le lecteur lit sans écrire, le joueur, un coach
     d'une autre équipe et un autre club ne voient rien ;
   - rename_sequence_tag : renommer sans doublon, supprimer, droits respectés ;
   - corbeille : le codage part et revient avec sa séquence ;
   - rejouable ; lmfc_v48_retour.sql refusé tant qu'il y a du codage, puis rend
     l'état d'avant, à l'identique.
   Lancement : voir access-matrix-sql.test.mjs (PGlite relié le temps du test). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('analyse-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db } = await fullDb(pg, { until: 'lmfc_v47.sql' });
const before = await catalog(db);
await db.exec(sqlFile('lmfc_v48.sql'));
await db.exec(sqlFile('lmfc_v48.sql'));   // rejouable
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const rows = async (uid, s, p) => (await as(uid, () => q(s, p))).rows;
const fails = async (uid, s, re, msg) => assert.rejects(as(uid, () => q(s)), re, msg);

// Une vidéo et deux séquences du joueur Pro ; une séquence d'un autre club.
await db.exec(`
insert into public.player_videos (id, club_id, player_id, titre, storage_path) overriding system value values
  (301, 1, ${J.pro}, 'Match A', 'r2/1/a.mp4'), (302, 2, ${J.autre}, 'Autre', 'r2/2/b.mp4');
insert into public.video_sequences (id, club_id, player_id, video_id, start_sec, end_sec) overriding system value values
  (401, 1, ${J.pro}, 301, 10, 20), (402, 1, ${J.pro}, 301, 30, 40), (403, 2, ${J.autre}, 302, 5, 9);`);

/* ---------- Écriture par le coach, horodatage serveur ---------- */
await as(P.coachPro, () => q(`update public.player_videos set poste = 'MC', lieu = 'domicile' where id = 301`));
assert.deepEqual((await q(`select poste, lieu from public.player_videos where id = 301`)).rows[0], { poste: 'MC', lieu: 'domicile' });
await as(P.coachPro, () => q(`insert into public.sequence_codes (sequence_id, player_id, club_id, action, resultat, periode, direction, touches,
  distance, zone_depart, zone_arrivee, tiers_depart, x1, y1, x2, y2, tags, updated_by)
  values (401, ${J.pro}, 1, 'passe', 'ok', 1, 'horizontale', 1, 'longue', 'base', 'couloir_droit', 1, 20, 50, 70, 90, '{Anticipation,Prise d''information}', null)`));
await as(P.coachPro, () => q(`insert into public.sequence_codes (sequence_id, player_id, club_id, action, resultat, categorie, tags)
  values (402, ${J.pro}, 1, 'duel_sol', 'ko', 'interception', '{Anticipation}')`));
const c401 = (await q(`select updated_by, action, x2 from public.sequence_codes where sequence_id = 401`)).rows[0];
assert.equal(c401.updated_by, P.coachPro, "l'auteur est posé par le serveur, pas par le client");
assert.equal(c401.x2, 70);

/* ---------- Valeurs refusées ---------- */
const ins = (cols, vals) => `insert into public.sequence_codes (sequence_id, player_id, club_id, ${cols}) values (402, ${J.pro}, 1, ${vals})
  on conflict (sequence_id) do update set action = excluded.action`;
await fails(P.coachPro, `update public.player_videos set poste = 'ATT' where id = 301`, /player_videos_poste_check/, 'poste hors liste');
await fails(P.coachPro, `update public.player_videos set lieu = 'neutre' where id = 301`, /player_videos_lieu_check/, 'lieu hors liste');
await fails(P.coachPro, `update public.sequence_codes set categorie = 'cpa' where sequence_id = 402`, /categorie_check/, 'catégorie aérienne sur un duel terrestre');
await fails(P.coachPro, `update public.sequence_codes set direction = 'verticale' where sequence_id = 402`, /champs_check/, 'direction sur un duel');
await fails(P.coachPro, `update public.sequence_codes set pied = 'droit' where sequence_id = 402`, /champs_check/, 'pied sur un duel');
await fails(P.coachPro, `update public.sequence_codes set resultat = 'but' where sequence_id = 402`, /resultat_check/, 'résultat de tir sur un duel');
await fails(P.coachPro, `update public.sequence_codes set action = null where sequence_id = 402`, /resultat_check|categorie_check/, 'résultat sans action');
// Un tir puis une passe complète, sur la même séquence : les champs de chaque action sont acceptés.
await as(P.coachPro, () => q(`update public.sequence_codes set action = 'tir', resultat = 'but', categorie = 'six_metres', pied = 'gauche', touches = 1 where sequence_id = 402`));
await fails(P.coachPro, `update public.sequence_codes set resultat = 'ok' where sequence_id = 402`, /resultat_check/, 'réussi / raté sur un tir');
await as(P.coachPro, () => q(`update public.sequence_codes set action = 'duel_sol', resultat = 'ko', categorie = 'interception', pied = null, touches = null where sequence_id = 402`));
await as(P.coachPro, () => q(`update public.sequence_codes set lignes = 'mediane', pied = 'droit' where sequence_id = 401`));
await fails(P.coachPro, `update public.sequence_codes set x1 = 10 where sequence_id = 402`, /point_check/, 'x sans y');
await fails(P.coachPro, `update public.sequence_codes set zone_depart = 'exterieur' where sequence_id = 402`, /zone_depart_check/, 'zone hors liste');
await fails(P.coachPro, `update public.sequence_codes set tags = '{""}' where sequence_id = 402`, /tags_check/, 'tag vide');
await fails(P.coachPro, ins('action', `'passe'`).replace(`(402, ${J.pro}`, `(403, ${J.pro}`), /violates|viole|row-level/, 'codage rattaché au mauvais joueur ou club');

/* ---------- Lecture et droits ---------- */
const seen = async (uid) => (await rows(uid, `select sequence_id from public.sequence_codes order by 1`)).map(r => Number(r.sequence_id));
assert.deepEqual(await seen(P.coachPro), [401, 402]);
assert.deepEqual(await seen(P.lecteur), [401, 402], 'le lecteur (scout) lit');
assert.deepEqual(await seen(P.joueurPro), [], "le joueur n'y a pas accès");
assert.deepEqual(await seen(P.coachU14), [], "un coach d'une autre équipe ne voit pas ce joueur");
assert.deepEqual(await seen(P.adminB), [], 'un autre club ne voit rien');
await fails(P.lecteur, `insert into public.sequence_codes (sequence_id, player_id, club_id) values (401, ${J.pro}, 1)`, /row-level|violates/, 'le lecteur ne crée pas');
await as(P.lecteur, () => q(`update public.sequence_codes set resultat = 'ko' where sequence_id = 401`));
await as(P.lecteur, () => q(`delete from public.sequence_codes where sequence_id = 401`));
assert.equal((await q(`select resultat from public.sequence_codes where sequence_id = 401`)).rows[0]?.resultat, 'ok', 'le lecteur ne modifie ni ne supprime');
await as(P.coachU14, () => q(`update public.sequence_codes set resultat = 'ko' where sequence_id = 401`));
assert.equal((await q(`select resultat from public.sequence_codes where sequence_id = 401`)).rows[0].resultat, 'ok', 'coach sans droit sur le joueur');

/* ---------- Tags : renommer sans doublon, supprimer ---------- */
const tags = async () => (await q(`select sequence_id, tags from public.sequence_codes order by 1`)).rows.map(r => r.tags);
assert.equal((await rows(P.lecteur, `select public.rename_sequence_tag('Anticipation', 'X') n`))[0].n, 0, 'le lecteur ne renomme rien');
assert.equal((await rows(P.coachPro, `select public.rename_sequence_tag('Prise d''information', 'Anticipation') n`))[0].n, 1);
assert.deepEqual(await tags(), [['Anticipation'], ['Anticipation']], 'fusion sans doublon');
assert.equal((await rows(P.coachPro, `select public.rename_sequence_tag('Anticipation', '  ') n`))[0].n, 2, 'nom vide = suppression');
assert.deepEqual(await tags(), [[], []]);
await fails(P.coachPro, `select public.rename_sequence_tag('', 'Y')`, /Tag à renommer manquant/);

/* ---------- Corbeille : le codage suit sa séquence ---------- */
await as(P.coachPro, () => q(`delete from public.video_sequences where id = 401`));
assert.equal((await q(`select count(*)::int n from public.sequence_codes where sequence_id = 401`)).rows[0].n, 0);
const root = (await q(`select id from public.trash where tbl = 'video_sequences' and row_id = 401`)).rows[0].id;
assert.equal((await q(`select count(*)::int n from public.trash where tbl = 'sequence_codes' and root_id = $1`, [root])).rows[0].n, 1);
await as(P.coachPro, () => q(`select public.trash_restore(array[${root}]::bigint[])`));
assert.deepEqual((await q(`select action, zone_arrivee, x1 from public.sequence_codes where sequence_id = 401`)).rows[0],
  { action: 'passe', zone_arrivee: 'couloir_droit', x1: 20 }, 'codage restauré avec la séquence');

/* ---------- Retour arrière ---------- */
await assert.rejects(db.exec(sqlFile('lmfc_v48_retour.sql')), /séquences sont codées/);
await db.exec('rollback');   // le refus laisse la transaction du script ouverte
await db.exec(`delete from public.sequence_codes; delete from public.trash where tbl = 'sequence_codes';`);
await assert.rejects(db.exec(sqlFile('lmfc_v48_retour.sql')), /poste ou un lieu/);
await db.exec('rollback');
await db.exec(`update public.player_videos set poste = null, lieu = null;`);
await db.exec(sqlFile('lmfc_v48_retour.sql'));
await db.exec(sqlFile('lmfc_v48_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), before, "le retour arrière rend l'état d'avant lmfc_v48.sql");

console.log('analyse-sql : OK');
