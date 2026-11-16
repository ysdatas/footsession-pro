/* lmfc_v52.sql (fusion de deux séances) et son retour arrière, sur les migrations
   réelles (full-db.mjs) :
     - il faut pouvoir modifier les deux séances ; le récapitulatif ne change rien ;
     - la cible reçoit équipes, lignes sans doublon, procédés à la suite, champs vides ;
       les doublons de la source sont mis de côté (rien ne compte deux fois) ;
     - la source reste, vide, marquée fusionnée ; la marque ne s'écrit pas par l'API ;
       les joueurs ne la voient plus ;
     - l'annulation rend tout, dans l'ordre inverse des fusions, et garde ce qui a
       été ajouté depuis à la cible ;
     - lmfc_v52_retour.sql refuse tant qu'une fusion est en place, puis rend l'état
       d'avant à l'identique ; la migration se rejoue.
   Lancement : node tests/v52-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v52-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db } = await fullDb(pg, { until: 'lmfc_v51.sql' });
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const S1 = 1, S2 = 2, S3 = 3;
await db.exec(`
insert into public.sessions (club_id, created_by, titre, date_seance, team_id, acces) values
 (1, '${P.coachU17}', 'U17', current_date + 2, ${T.u17}, 'equipe');
insert into public.sessions (club_id, created_by, titre, date_seance, heure, lieu, notes, team_id, acces) values
 (1, '${P.coachEsp}', 'Espoirs', current_date + 2, '18:00', 'Annexe', 'Note Espoirs', ${T.espoirs}, 'equipe');
insert into public.sessions (club_id, created_by, titre, date_seance, team_id, acces) values
 (1, '${P.coachU17}', 'U17 bis', current_date + 2, ${T.u17}, 'equipe');
insert into public.attendance (session_id, player_id, statut, invite) values
 (${S1}, ${J.mixte}, 'present', false), (${S2}, ${J.mixte}, 'absent', false), (${S2}, ${J.n2}, 'present', true);
insert into public.session_rpe (club_id, session_id, player_id, rpe) values
 (1, ${S1}, ${J.mixte}, 5), (1, ${S2}, ${J.mixte}, 7), (1, ${S2}, ${J.n2}, 6);
insert into public.session_bilans (session_id, player_id, note, commentaire) values (${S2}, ${J.n2}, 'plus', 'Bien');
insert into public.session_comments (session_id, user_id, author, body) values (${S2}, '${P.coachEsp}', 'Coach', 'Commentaire Espoirs');
insert into public.procedures (session_id, ordre, nom) values (${S1}, 0, 'P1 U17'), (${S1}, 1, 'P2 U17'), (${S2}, 0, 'P1 Espoirs');
insert into public.session_access (session_id, profile_id, niveau) values (${S2}, '${P.coachPro}', 'lecture');
`);
const before = await catalog(db);
await db.exec(sqlFile('lmfc_v52.sql'));
await db.exec(sqlFile('lmfc_v52.sql'));   // rejouable

const call = (uid, s) => as(uid, async () => (await q(s)).rows[0]);
const merge = (uid, src, tgt, apply) => call(uid, `select public.session_merge(${src}, ${tgt}, ${apply}) r`).then(r => r.r);
const undo = (uid, src) => call(uid, `select public.session_merge_undo(${src}) r`).then(r => r.r);
const rows = async (tbl, sid, cols = 'player_id') => (await q(`select ${cols} from public.${tbl} where session_id = $1 order by 1`, [sid])).rows;
const sess = async (id) => (await q(`select team_id, other_team_ids, to_char(heure, 'HH24:MI') heure, lieu, notes, fusionnee_dans from public.sessions where id = $1`, [id])).rows[0];
const snapshot = async () => ({
  s1: await sess(S1), s2: await sess(S2),
  att1: await rows('attendance', S1, 'player_id, statut'), att2: await rows('attendance', S2, 'player_id, statut'),
  rpe1: await rows('session_rpe', S1, 'player_id, rpe'), rpe2: await rows('session_rpe', S2, 'player_id, rpe'),
  proc1: await rows('procedures', S1, 'ordre, nom'), proc2: await rows('procedures', S2, 'ordre, nom'),
  bil2: await rows('session_bilans', S2), com2: await rows('session_comments', S2, 'body'), acc2: await rows('session_access', S2, 'profile_id'),
});
const start = await snapshot();

/* Droits : les deux séances modifiables. */
await assert.rejects(merge(P.coachU17, S2, S1, false), /modifier les deux séances/, 'coach U17 : pas la séance Espoirs');
await assert.rejects(merge(P.lecteur, S2, S1, false), /modifier les deux séances/, 'lecteur : jamais');
await assert.rejects(merge(P.coachDeux, S1, S1, false), /deux séances différentes/, 'même séance refusée');

/* Récapitulatif : tout est compté, rien ne bouge. */
const plan = await merge(P.coachDeux, S2, S1, false);
assert.equal(plan.applique, false);
assert.equal(plan.meme_date, true);
assert.deepEqual(plan.joueurs, { source: 2, cible: 1, total: 2 }, 'joueurs sans doublon');
assert.deepEqual(plan.equipes_ajoutees, ['Espoirs']);
assert.deepEqual(plan.informations, ['heure', 'lieu', 'notes']);
assert.deepEqual(plan.lignes.attendance, { deplacees: 1, doublons: 1 });
assert.deepEqual(plan.lignes.session_rpe, { deplacees: 1, doublons: 1 });
assert.deepEqual(plan.lignes.session_bilans, { deplacees: 1, doublons: 0 });
assert.deepEqual(plan.lignes.session_access, { deplacees: 1, doublons: 0 });
assert.equal(plan.lignes.session_comments, 1);
assert.equal(plan.lignes.procedures, 1);
assert.deepEqual(await snapshot(), start, 'récapitulatif : rien de modifié');

/* Fusion. */
const done = await merge(P.coachDeux, S2, S1, true);
assert.equal(done.applique, true);
assert.ok(done.fusion_id, 'journal écrit');
assert.deepEqual(await sess(S1), { team_id: T.u17, other_team_ids: [T.espoirs], heure: '18:00', lieu: 'Annexe', notes: 'Note Espoirs', fusionnee_dans: null },
  'cible : équipe associée et champs vides complétés');
assert.deepEqual(await rows('attendance', S1, 'player_id, statut'), [{ player_id: J.mixte, statut: 'present' }, { player_id: J.n2, statut: 'present' }],
  'présences : la ligne de la cible reste, l’autre arrive');
assert.deepEqual(await rows('session_rpe', S1, 'player_id, rpe'), [{ player_id: J.mixte, rpe: 5 }, { player_id: J.n2, rpe: 6 }], 'RPE : une par joueur');
assert.deepEqual(await rows('procedures', S1, 'ordre, nom'), [{ ordre: 0, nom: 'P1 U17' }, { ordre: 1, nom: 'P2 U17' }, { ordre: 2, nom: 'P1 Espoirs' }],
  'procédés à la suite');
assert.equal((await rows('session_comments', S1, 'body')).length, 1, 'commentaire déplacé');
assert.equal((await rows('session_access', S1, 'profile_id')).length, 1, 'droit nominatif déplacé');
const shell = await sess(S2);
assert.equal(Number(shell.fusionnee_dans), S1, 'source marquée');
for (const tbl of ['attendance', 'session_rpe', 'session_bilans', 'session_comments', 'session_access', 'procedures']) {
  assert.equal((await rows(tbl, S2, 'id')).length, 0, `source vide : ${tbl}`);
}
assert.equal((await q(`select count(*)::int n from public.sessions`)).rows[0].n, 3, 'aucune séance supprimée');

/* La source fusionnée : hors des joueurs, des séances modifiables, et sa marque ne s'écrit pas par l'API. */
assert.equal((await q(`select public.player_session_ok(${J.mixte}, ${S2}) ok`)).rows[0].ok, false, 'joueur : plus concerné par la source');
assert.equal((await q(`select public.player_session_ok(${J.mixte}, ${S1}) ok`)).rows[0].ok, true, 'joueur : concerné par la cible');
const editable = await as(P.coachDeux, async () => (await q(`select id from public.my_editable_sessions()`)).rows.map(r => Number(r.id)));
assert.ok(!editable.includes(S2) && editable.includes(S1), 'séance fusionnée hors des séances modifiables');
await as(P.admin, () => q(`update public.sessions set fusionnee_dans = null, fusionnee_le = null where id = ${S2}`));
assert.equal(Number((await sess(S2)).fusionnee_dans), S1, 'marque intacte malgré l’API');
await as(P.admin, () => q(`insert into public.sessions (club_id, titre, date_seance, fusionnee_dans, fusionnee_le) values (1, 'Injectée', current_date, ${S1}, now())`));
assert.equal((await q(`select fusionnee_dans from public.sessions where titre = 'Injectée'`)).rows[0].fusionnee_dans, null, 'pas de marque à la création');
await q(`delete from public.sessions where titre = 'Injectée'`);
assert.equal(await as(P.coachDeux, async () => (await q(`select count(*)::int n from public.session_merges`)).rows[0].n), 0, 'journal : pas pour un coach');
assert.equal(await as(P.admin, async () => (await q(`select count(*)::int n from public.session_merges`)).rows[0].n), 1, 'journal : lu par l’admin');
await assert.rejects(merge(P.coachDeux, S2, S3, false), /déjà fusionnée/, 'pas deux fois');

/* Ajout après la fusion : il reste dans la cible à l'annulation. */
await q(`insert into public.attendance (session_id, player_id, statut) values (${S1}, ${J.pro}, 'present')`);

/* Ordre inverse : S1 fusionnée dans S3 bloque l'annulation de S2 → S1. */
await merge(P.coachU17, S1, S3, true);   // créateur des deux séances U17 : les Espoirs suivent dans S3
assert.equal(Number((await sess(S1)).fusionnee_dans), S3);
assert.deepEqual((await sess(S3)).other_team_ids, [T.espoirs], 'les équipes suivent la fusion');
await assert.rejects(undo(P.admin, S2), /Annulez d'abord la fusion de « U17 »/, 'ordre inverse imposé');
await undo(P.coachU17, S1);
assert.deepEqual((await sess(S3)).other_team_ids, [], 'annulée : S3 rendue à son état');
await assert.rejects(undo(P.coachU17, S2), /modifier les deux séances/, 'coach U17 : ne défait pas la fusion des Espoirs');
const back = await undo(P.coachDeux, S2);
assert.ok(back.revenues > 0);

/* Tout est revenu ; l'ajout fait depuis reste dans la cible. */
const end = await snapshot();
assert.deepEqual({ ...end, att1: end.att1.filter(r => r.player_id !== J.pro) }, start, 'annulation : état d’avant');
assert.ok(end.att1.some(r => r.player_id === J.pro), 'ajout après la fusion gardé');
assert.equal((await q(`select count(*)::int n from public.session_merges where undone_at is null`)).rows[0].n, 0, 'journal : fusions annulées');

/* Retour arrière : refusé avec une fusion en place, puis état d'avant à l'identique. */
await merge(P.admin, S2, S1, true);
await assert.rejects(db.exec(sqlFile('lmfc_v52_retour.sql')), /Retour refusé : 1 séance/, 'retour refusé pendant une fusion');
await db.exec('rollback');
await undo(P.admin, S2);
await q(`delete from public.attendance where session_id = ${S1} and player_id = ${J.pro}`);
await db.exec(sqlFile('lmfc_v52_retour.sql'));
await db.exec(sqlFile('lmfc_v52_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), before, 'retour arrière : état d’avant à l’identique');
await db.exec(sqlFile('lmfc_v52.sql'));

console.log('v52-sql : OK');
