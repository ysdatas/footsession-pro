/* lmfc_v55.sql (accès préparés avant la première connexion) et son retour arrière,
   sur les migrations réelles (full-db.mjs) :
     - une invitation du staff exige des équipes ou « lecture club » ; admin et joueur non ;
     - sans périmètre (invitation d'avant la migration) : 'en_attente', le compte reste sans club ;
     - à la première connexion : rôle, équipes du club seulement, lecture club,
       responsabilité, nom s'il n'en a pas ; le compte arrive dans son périmètre ;
     - l'admin change ensuite la responsabilité d'un membre ;
     - le retour rend l'état d'avant à l'identique ; la migration se rejoue.
   Lancement : node tests/v55-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v55-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db } = await fullDb(pg, { until: 'lmfc_v54.sql' });
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
// Comptes neufs, confirmés, sans club ; une invitation d'avant la migration (sans périmètre).
const U = (n) => `00000000-0000-0000-0000-0000000000${n}`;
const NEW = { scout: U(91), coach: U(92), ancien: U(93), joueur: U(94), lecteurClub: U(95) };
await db.exec(`
insert into auth.users (id, email, email_confirmed_at) values ${Object.entries(NEW).map(([k, id]) => `('${id}', '${k}@test.fr', now())`).join(', ')};
update public.profiles set club_id = null, role = 'coach', nom = null where id in (${Object.values(NEW).map(x => `'${x}'`).join(', ')});
insert into public.club_access (club_id, email, role, created_by) values (1, 'ancien@test.fr', 'lecteur', '${P.admin}');
`);
const before = await catalog(db);
await db.exec(sqlFile('lmfc_v55.sql'));
await db.exec(sqlFile('lmfc_v55.sql'));   // rejouable

const invite = (fields) => as(P.admin, () => q(`insert into public.club_access (club_id, email, role, nom, responsabilite, team_ids, lecture_club, player_id, created_by)
  values (1, $1, $2, $3, $4, $5, $6, $7, '${P.admin}')`, [fields.email, fields.role, fields.nom ?? null, fields.resp ?? null, fields.teams ?? [], !!fields.club, fields.player ?? null]));
const claim = (uid) => as(uid, async () => (await q(`select public.claim_club_access() r`)).rows[0].r);
const prof = async (uid) => (await q(`select club_id, role, team_ids, lecture_club, responsabilite, nom from public.profiles where id = $1`, [uid])).rows[0];

/* Périmètre obligatoire pour le staff. */
await assert.rejects(invite({ email: 'x@test.fr', role: 'coach' }), /club_access_perimetre_check/, 'coach sans équipe : refusé');
await assert.rejects(invite({ email: 'x@test.fr', role: 'lecteur' }), /club_access_perimetre_check/, 'scout sans équipe ni « tout le club » : refusé');
await assert.rejects(invite({ email: 'x@test.fr', role: 'coach', teams: [T.u14], resp: 'chef' }), /club_access_v55_check/, 'responsabilité inconnue : refusée');
await invite({ email: 'x@test.fr', role: 'admin' });
await q(`delete from public.club_access where email = 'x@test.fr'`);

/* Invitations préparées. */
await invite({ email: 'scout@test.fr', role: 'lecteur', nom: 'Sam Scout', resp: 'scout', teams: [T.u17] });
await invite({ email: 'coach@test.fr', role: 'coach', nom: 'Chloé Coach', resp: 'responsable_categorie', teams: [T.u14, T.u17, T.autre] });
await invite({ email: 'lecteurclub@test.fr', role: 'lecteur', resp: 'directeur_sportif', club: true });
await invite({ email: 'joueur@test.fr', role: 'joueur', player: J.sans });

/* Première connexion. */
assert.equal(await claim(NEW.ancien), 'en_attente', 'invitation sans périmètre : en attente');
assert.equal((await prof(NEW.ancien)).club_id, null, 'en attente : aucun club, aucun accès');
assert.equal(await claim(NEW.scout), 'lecteur');
assert.deepEqual(await prof(NEW.scout), { club_id: 1, role: 'lecteur', team_ids: [T.u17], lecture_club: false, responsabilite: 'scout', nom: 'Sam Scout' });
assert.equal(await claim(NEW.coach), 'coach');
assert.deepEqual((await prof(NEW.coach)).team_ids, [T.u17, T.u14].sort((a, b) => a - b), 'équipes du club seulement (l’équipe d’un autre club est ignorée)');
assert.equal(await claim(NEW.lecteurClub), 'lecteur');
assert.deepEqual(await prof(NEW.lecteurClub), { club_id: 1, role: 'lecteur', team_ids: [], lecture_club: true, responsabilite: 'directeur_sportif', nom: null });
assert.equal(await claim(NEW.joueur), 'joueur', 'joueur : sans périmètre, sa fiche suffit');

/* Il arrive dans son périmètre : le scout U17 lit les joueurs U17, pas les autres. */
const visible = (uid) => as(uid, async () => (await q(`select id from public.players order by id`)).rows.map(r => Number(r.id)));
assert.deepEqual(await visible(NEW.scout), [J.mixte], 'scout U17 : son équipe seulement');
assert.ok((await visible(NEW.coach)).includes(J.mineure) && !(await visible(NEW.coach)).includes(J.pro), 'coach U14 + U17 : ses équipes');

/* L'admin complète l'ancienne invitation : elle s'active. */
await as(P.admin, () => q(`update public.club_access set team_ids = '{${T.n2}}' where email = 'ancien@test.fr'`));
assert.equal(await claim(NEW.ancien), 'lecteur', 'périmètre défini : activée');
assert.deepEqual((await prof(NEW.ancien)).team_ids, [T.n2]);

/* Ensuite : l'admin change la responsabilité ; le membre ne le peut pas lui-même. */
await as(P.admin, () => q(`update public.profiles set responsabilite = 'entraineur_principal' where id = '${NEW.coach}'`));
assert.equal((await prof(NEW.coach)).responsabilite, 'entraineur_principal');
await as(NEW.coach, () => q(`update public.profiles set responsabilite = 'directeur_sportif', nom = 'Chloé C.' where id = '${NEW.coach}'`));
assert.deepEqual([(await prof(NEW.coach)).responsabilite, (await prof(NEW.coach)).nom], ['entraineur_principal', 'Chloé C.'], 'le membre change son nom, pas sa responsabilité');

/* Retour arrière. */
await db.exec(sqlFile('lmfc_v55_retour.sql'));
await db.exec(sqlFile('lmfc_v55_retour.sql'));   // rejouable
assert.deepEqual(await catalog(db), before, 'retour arrière : état d’avant à l’identique');
await db.exec(sqlFile('lmfc_v55.sql'));
console.log('v55-sql : OK');
