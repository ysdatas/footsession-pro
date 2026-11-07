/* lmfc_v46.sql : le récapitulatif du calendrier ne supprime plus de ligne de
   feuille de match par omission, et retirer un joueur d'une séance fonctionne.
   Joué sur deux états, avec les migrations réelles (full-db.mjs) :
     - la production du 06/11/2026 : v39, v40, v41, v43, sans v42 ;
     - le code complet, jusqu'à lmfc_v45.sql.
   Les défauts sont d'abord constatés avant lmfc_v46.sql, puis fermés après ;
   lmfc_v46_retour.sql rend l'état d'avant, à l'identique.
   Lancement : voir access-matrix-sql.test.mjs. */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v46-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const DAY = '2026-11-06';
const fields = (adversaire, score = '') => ({ adversaire, date: DAY, heure: '', lieu: '', stade: '', competition: '', score_pour: score, score_contre: '' });
const sessionFields = (titre) => ({ titre, date: DAY, heure: '', lieu: '', duree_min: '90' });

async function run(label, files, analyst) {
  const { db } = await fullDb(pg, { until: 'lmfc_v38.sql' });
  await seed(db);
  for (const f of files) await db.exec(sqlFile(f));
  const as = actor(db), q = (s, p) => db.query(s, p);
  const summary = (uid, kind, id, f, players) => as(uid, () =>
    q(`select public.calendar_summary_update($1, $2, $3::jsonb, $4::jsonb)`, [kind, id, JSON.stringify(f), JSON.stringify(players)]));
  const sheet = async (m) => (await q(`select player_id, statut, minutes, buts, commentaire from public.match_players where match_id = $1 order by player_id`, [m])).rows;
  const inCalendar = async (uid, id) => (await as(uid, () => q(`select id from public.my_calendar('${DAY}', '${DAY}') where kind = 'seance' and id = ${id}`))).rows.length === 1;
  const attendance = async (s, p) => (await q(`select statut from public.attendance where session_id = $1 and player_id = $2`, [s, p])).rows[0]?.statut;

  // Matchs Pro : le joueur Pro est visible du coach Pro, la joueuse U14 ne l'est pas.
  await db.exec(`
insert into public.matches (id, club_id, team_id, adversaire, date_match, created_by) overriding system value values
 (201, 1, ${T.pro}, 'Avant', '${DAY}', '${P.coachPro}'), (202, 1, ${T.pro}, 'Après', '${DAY}', '${P.coachPro}'), (203, 1, ${T.pro}, 'Retrait', '${DAY}', '${P.coachPro}');
insert into public.match_players (club_id, match_id, player_id, statut, minutes, buts, commentaire) values
 (1, 201, ${J.pro}, 'titulaire', 90, 1, null), (1, 201, ${J.mineure}, 'titulaire', 75, 2, 'Hors périmètre du coach'),
 (1, 202, ${J.pro}, 'titulaire', 90, 1, null), (1, 202, ${J.mineure}, 'titulaire', 75, 2, 'Hors périmètre du coach'),
 (1, 203, ${J.pro}, 'remplacant', null, null, null), (1, 203, ${J.n2}, 'titulaire', 60, 0, null);
insert into public.sessions (id, club_id, created_by, titre, date_seance, team_id, acces) overriding system value values
 (101, 1, '${P.coachPro}', 'Avant', '${DAY}', ${T.pro}, 'equipe'), (102, 1, '${P.coachPro}', 'Après', '${DAY}', ${T.pro}, 'equipe'), (103, 1, '${P.coachPro}', 'Saisie', '${DAY}', ${T.pro}, 'equipe');
insert into public.attendance (player_id, session_id, statut) values (${J.pro}, 103, 'present');
`);
  const visible = [{ player_id: J.pro, inclus: true, statut: 'titulaire' }];

  /* Avant lmfc_v46.sql : les deux défauts existent. */
  await summary(P.coachPro, 'match', 201, fields('Avant', '2'), visible);
  assert.deepEqual((await sheet(201)).map(r => r.player_id).map(Number), [J.pro], `${label} : avant v46, la ligne hors périmètre disparaît`);
  await summary(P.coachPro, 'seance', 101, sessionFields('Avant'), [{ player_id: J.pro, inclus: false, statut: 'absent' }]);
  assert.equal(await inCalendar(P.joueurPro, 101), true, `${label} : avant v46, le joueur retiré reste au calendrier`);

  const start = await catalog(db);
  await db.exec(sqlFile('lmfc_v46.sql'));
  await db.exec(sqlFile('lmfc_v46.sql'));   // rejouable

  /* Feuille de match : rien ne disparaît par omission. */
  await summary(P.coachPro, 'match', 202, fields('Après', '2'), visible);
  const rows = await sheet(202);
  assert.deepEqual(rows.map(r => Number(r.player_id)), [J.pro, J.mineure], `${label} : la ligne hors périmètre reste`);
  assert.deepEqual([rows[1].minutes, rows[1].buts, rows[1].commentaire], [75, 2, 'Hors périmètre du coach'], `${label} : ses données restent`);
  assert.equal((await q(`select score_pour from public.matches where id = 202`)).rows[0].score_pour, 2, `${label} : le score est enregistré`);

  // Un retrait explicite passe sans données ; avec données, il est refusé et rien n'est enregistré.
  await summary(P.coachPro, 'match', 203, fields('Retrait'), [{ player_id: J.pro, inclus: false }]);
  assert.deepEqual((await sheet(203)).map(r => Number(r.player_id)), [J.n2], `${label} : retrait d'un joueur sans données`);
  await q(`update public.profiles set team_ids = '{${T.pro},${T.n2}}' where id = $1`, [P.coachPro]);
  await assert.rejects(summary(P.coachPro, 'match', 203, fields('Refusé', '5'), [{ player_id: J.n2, inclus: false }]), /a des données sur ce match/, `${label} : joueur avec données`);
  assert.deepEqual((await sheet(203)).map(r => Number(r.player_id)), [J.n2], `${label} : refus, la ligne reste`);
  assert.equal((await q(`select adversaire from public.matches where id = 203`)).rows[0].adversaire, 'Retrait', `${label} : refus, rien n'est enregistré`);
  await q(`update public.profiles set team_ids = '{${T.pro}}' where id = $1`, [P.coachPro]);
  // Même par un appel direct : un joueur que le compte ne voit pas ne perd pas ses données.
  await assert.rejects(summary(P.coachPro, 'match', 202, fields('Après', '2'), [{ player_id: J.mineure, inclus: false }]), /Ce joueur a des données sur ce match/, `${label} : joueur invisible retiré`);
  assert.equal((await sheet(202)).length, 2, `${label} : sa ligne reste`);

  /* Séance : retirer fonctionne, avec ou sans présence saisie, et se défait. */
  await summary(P.coachPro, 'seance', 102, sessionFields('Après'), [{ player_id: J.pro, inclus: false, statut: 'absent' }]);
  assert.equal(await attendance(102, J.pro), 'non_concerne', `${label} : sans présence saisie`);
  assert.equal(await inCalendar(P.joueurPro, 102), false, `${label} : le joueur retiré quitte son calendrier`);
  await assert.rejects(as(P.joueurPro, () => q(`select public.rpe_set(102, 5)`)), /ne te concerne pas/, `${label} : plus de RPE attendu`);
  await summary(P.coachPro, 'seance', 103, sessionFields('Saisie'), [{ player_id: J.pro, inclus: false }]);
  assert.equal(await attendance(103, J.pro), 'non_concerne', `${label} : avec une présence saisie`);
  await summary(P.coachPro, 'seance', 102, sessionFields('Après'), [{ player_id: J.pro, inclus: true, statut: 'present', present: true }]);
  assert.equal(await attendance(102, J.pro), 'present', `${label} : remis dans la séance`);
  assert.equal(await inCalendar(P.joueurPro, 102), true, `${label} : il retrouve son calendrier`);

  /* Droits : ceux de la base, inchangés. */
  await assert.rejects(summary(P.coachU17, 'match', 202, fields('Hors équipe'), []), /introuvable|row-level security/, `${label} : coach d'une autre équipe`);
  await assert.rejects(summary(P.coachU17, 'seance', 102, sessionFields('Hors équipe'), []), /introuvable|row-level security/, `${label} : séance d'une autre équipe`);
  await assert.rejects(summary(P.joueurPro, 'match', 202, fields('Joueur'), []), /introuvable|row-level security|permission denied/, `${label} : un joueur ne touche à rien`);
  await assert.rejects(summary(null, 'match', 202, fields('Anonyme'), []), /permission denied/, `${label} : sans compte`);
  if (analyst) {
    await q(`update public.profiles set role = 'analyste', team_ids = '{${T.pro}}' where id = $1`, [P.coachSans]);
    await summary(P.coachSans, 'match', 202, fields('Analyste', '3'), visible);
    assert.equal((await sheet(202)).length, 2, `${label} : l'analyste ne retire pas non plus par omission`);
  }

  /* Retour arrière : à l'identique, deux fois de suite. */
  await db.exec(sqlFile('lmfc_v46_retour.sql'));
  await db.exec(sqlFile('lmfc_v46_retour.sql'));
  const back = await catalog(db);
  for (const k of Object.keys(start)) assert.deepEqual(back[k], start[k], `${label} : retour arrière, ${k} à l'identique`);
  await db.close();
}

await run('production', ['lmfc_v39.sql', 'lmfc_v40.sql', 'lmfc_v41.sql', 'lmfc_v43.sql'], false);
await run('code complet', ['lmfc_v39.sql', 'lmfc_v40.sql', 'lmfc_v41.sql', 'lmfc_v42.sql', 'lmfc_v43.sql', 'lmfc_v44.sql', 'lmfc_v45.sql'], true);

console.log('v46-sql : OK (feuille de match, retrait de séance, droits, retour arrière ; état de production et code complet)');
process.exit(0);
