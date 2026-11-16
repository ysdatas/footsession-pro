/* lmfc_v51.sql (séances communes à plusieurs équipes) et son retour arrière, sur
   les migrations réelles (full-db.mjs) :
     - le staff de chaque équipe de la séance a ses droits d'équipe sur elle ;
     - on n'ajoute que ses équipes, on ne retire une équipe qu'avec ses droits
       (créateur et admin exceptés) ;
     - la base range la liste (sans doublon, sans l'équipe principale, seulement le club) ;
     - les joueurs de chaque équipe sont concernés (RPE, calendrier, annonces) ;
     - supprimer l'équipe principale : la première associée la remplace ;
     - lmfc_v51_retour.sql refuse tant qu'une équipe est associée, puis rend
       l'état d'avant à l'identique ; la migration se rejoue.
   Lancement : node tests/v51-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v51-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db } = await fullDb(pg, { until: 'lmfc_v50.sql' });
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
// Un analyste des Espoirs (le jeu de comptes commun n'en a pas).
const ANALYSTE = '00000000-0000-0000-0000-000000000099';
await db.exec(`
insert into auth.users (id, email, email_confirmed_at) values ('${ANALYSTE}', 'analyste@test.fr', now());
update public.profiles set club_id = 1, role = 'analyste' where id = '${ANALYSTE}';
update public.profiles set team_ids = '{${T.espoirs}}' where id = '${ANALYSTE}';
insert into public.sessions (club_id, created_by, titre, date_seance, team_id, acces) values
 (1, '${P.coachU17}', 'U17 commune', current_date + 3, ${T.u17}, 'equipe'),
 (1, '${P.admin}', 'U14 principale', current_date + 4, ${T.u14}, 'equipe');
`);
const S1 = 1, S2 = 2;
const before = await catalog(db);
await db.exec(sqlFile('lmfc_v51.sql'));
await db.exec(sqlFile('lmfc_v51.sql'));   // rejouable

const tryIt = (uid, s) => as(uid, () => q(s)).then(() => 'permis', (e) => (e.message.includes('42501') || e.code === '42501' ? 'refusé' : `refusé : ${e.message}`));
const level = (uid, id = S1) => as(uid, async () => (await q(`select public.session_access_level($1) l`, [id])).rows[0].l);
const teams = async (id = S1) => (await q(`select team_id, other_team_ids from public.sessions where id = $1`, [id])).rows[0];
const ok = async (player, id = S1) => (await q(`select public.player_session_ok($1, $2) ok`, [player, id])).rows[0].ok;
const setOthers = (uid, ids) => tryIt(uid, `update public.sessions set other_team_ids = '{${ids.join(',')}}' where id = ${S1}`);

/* Avant toute association : la séance U17 est fermée aux Espoirs et aux U14. */
assert.equal(await level(P.coachEsp), 'aucun', 'coach Espoirs : rien avant association');
assert.equal(await ok(J.mineure), false, 'joueuse U14 non concernée avant association');

/* On n'ajoute que ses propres équipes. */
assert.equal(await setOthers(P.coachU17, [T.u14]), 'refusé', 'coach U17 ne range pas la séance chez les U14');
assert.deepEqual(await teams(), { team_id: T.u17, other_team_ids: [] }, 'refus : rien de changé');
assert.equal(await setOthers(P.coachDeux, [T.espoirs]), 'permis', 'coach U17 + Espoirs associe les Espoirs');
assert.equal(await level(P.coachEsp), 'modification', 'coach Espoirs : droits de son équipe sur la séance');
assert.equal(await level(ANALYSTE), 'modification', 'analyste des Espoirs : droits de son équipe');
assert.equal(await level(P.coachU14), 'aucun', 'coach U14 : toujours rien');
assert.equal(await level(P.lecteurU17), 'aucun', 'lecteur : jamais de séance (inchangé)');
assert.equal(await as(P.coachEsp, async () => (await q(`select count(*)::int n from public.my_editable_sessions()`)).rows[0].n), 1,
  'séance commune dans les séances modifiables du coach Espoirs');

/* La base range la liste : doublons, équipe principale, autre club retirés. */
await q(`update public.sessions set other_team_ids = '{${T.u14},${T.espoirs},${T.espoirs},${T.u17},${T.autre}}' where id = ${S1}`);
assert.deepEqual(await teams(), { team_id: T.u17, other_team_ids: [T.espoirs, T.u14] }, 'liste rangée par la base');

/* Joueurs : ceux de chaque équipe, une fois. */
assert.equal(await ok(J.mineure), true, 'joueuse U14 concernée');
assert.equal(await ok(J.mixte), true, 'joueur U17 + Espoirs concerné');
assert.equal(await ok(J.n2), false, 'joueuse N2 non concernée');
const cal = await as(P.joueurU14, async () => (await q(`select id from public.my_calendar(current_date, current_date + 30) where kind = 'seance'`)).rows.map(r => Number(r.id)));
assert.ok(cal.includes(S1), 'séance commune dans le calendrier de la joueuse U14');
const dest = (await q(`select array_agg(x order by x) a from public.calendar_recipients('seance', ${S1}, ${T.u17}, 1, '{${T.espoirs},${T.u14}}') x`)).rows[0].a;
assert.deepEqual(dest.map(Number), [J.mineure], 'annonces : joueurs avec compte des équipes de la séance, sans doublon');

/* Retirer une équipe : avec ses droits, ou en étant le créateur, ou l'admin. */
assert.equal(await setOthers(P.coachDeux, [T.espoirs]), 'refusé', 'coach U17 + Espoirs ne retire pas les U14');
assert.equal(await setOthers(P.coachU14, [T.u14]), 'refusé', 'coach U14 ne retire pas les Espoirs');
assert.equal(await setOthers(P.coachU14, [T.espoirs]), 'permis', 'coach U14 retire son équipe');
assert.equal(await level(P.coachU14), 'aucun', 'coach U14 : plus rien après retrait');
assert.equal(await setOthers(P.coachU17, []), 'permis', 'le créateur retire les Espoirs');
assert.equal(await tryIt(P.coachEsp, `update public.sessions set titre = 'x' where id = ${S1}`), 'permis', 'mise à jour sans effet pour le coach Espoirs');
assert.equal((await q(`select titre from public.sessions where id = ${S1}`)).rows[0].titre, 'U17 commune', 'plus de droit, rien modifié');
assert.equal(await tryIt(P.coachDeux, `update public.sessions set team_id = ${T.espoirs} where id = ${S1}`), 'permis', 'déplacée par qui a les deux équipes');
assert.equal(await tryIt(P.coachEsp, `update public.sessions set team_id = ${T.u17} where id = ${S1}`), 'refusé', 'coach Espoirs ne la range pas chez les U17');

/* Création avec une équipe associée : mêmes règles. */
const insert = (uid, team, others) => tryIt(uid, `insert into public.sessions (club_id, titre, date_seance, team_id, other_team_ids)
  values (1, 'Neuve', current_date, ${team}, '{${others.join(',')}}')`);
assert.equal(await insert(P.coachU17, T.u17, [T.u14]), 'refusé', 'création : pas d’équipe associée hors des siennes');
assert.equal(await insert(P.coachDeux, T.u17, [T.espoirs]), 'permis', 'création avec ses deux équipes');

/* Équipe principale supprimée : la première associée la remplace ; une équipe associée supprimée sort de la liste. */
await q(`update public.sessions set other_team_ids = '{${T.espoirs},${T.n2}}' where id = ${S2}`);
await q(`update public.sessions set other_team_ids = '{${T.u14}}' where id = ${S1}`);
await as(P.admin, () => q(`delete from public.teams where id = ${T.u14}`));
assert.deepEqual(await teams(S2), { team_id: T.n2, other_team_ids: [T.espoirs] }, 'principale supprimée : la première associée la remplace');
assert.deepEqual(await teams(S1), { team_id: T.espoirs, other_team_ids: [] }, 'équipe associée supprimée : retirée');

/* Retour arrière : refusé tant qu'une équipe est associée, puis état d'avant à l'identique. */
await assert.rejects(db.exec(sqlFile('lmfc_v51_retour.sql')), /Retour refusé : 2 séance/, 'retour refusé avec une équipe associée');
await db.exec(`rollback; update public.sessions set other_team_ids = '{}'`);
await db.exec(sqlFile('lmfc_v51_retour.sql'));
await db.exec(sqlFile('lmfc_v51_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), before, 'retour arrière : état d’avant à l’identique');
await db.exec(sqlFile('lmfc_v51.sql'));
assert.deepEqual(await teams(), { team_id: T.espoirs, other_team_ids: [] }, 'migration rejouée après le retour');

console.log('v51-sql : OK');
