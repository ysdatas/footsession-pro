/* lmfc_v50.sql : relances RPE, sur toutes les migrations réelles (full-db.mjs).
   - qui relance : le staff qui peut corriger le RPE du joueur ; ni joueur, ni lecteur,
     ni coach d'une autre équipe, ni autre club ;
   - qui reçoit : joueur concerné, sans réponse, saisie encore ouverte, compte lié,
     au moins un appareil ; un match avec feuille : ceux qui ont joué ;
   - pas de doublon pendant 12 h, sauf si la relance n'est arrivée nulle part ;
   - journal lu par le staff qui suit le joueur, jamais écrit directement ;
   - rejouable ; lmfc_v50_retour.sql rend l'état d'avant à l'identique.
   Lancement : voir access-matrix-sql.test.mjs (PGlite relié le temps du test). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('rpe-remind-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db } = await fullDb(pg, { until: 'lmfc_v49.sql' });
const before = await catalog(db);
await db.exec(sqlFile('lmfc_v50.sql'));
await db.exec(sqlFile('lmfc_v50.sql'));   // rejouable
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const take = async (uid, kind, id, players) => (await as(uid, () => q('select public.rpe_remind_take($1, $2, $3) r', [kind, id, players]))).rows[0].r;
const refused = (uid, kind, id, players, re, msg) => assert.rejects(as(uid, () => q('select public.rpe_remind_take($1, $2, $3)', [kind, id, players])), re, msg);
const why = (out) => Object.fromEntries(out.skipped.map(x => [x.player_id, x.reason]));
const logged = async () => (await q('select player_id::int, session_id::int, match_id::int, sent_by::text, devices, delivered from public.rpe_reminders order by id')).rows;

// Pro : PRO (compte, 2 appareils), SANSCOMPTE (pas de compte), MUET (compte, aucun appareil).
const MUET = '00000000-0000-0000-0000-000000000077';
await db.exec(`
insert into auth.users (id) values ('${MUET}');
update public.profiles set club_id = 1, role = 'joueur' where id = '${MUET}';
insert into public.players (club_id, nom, team_id) values (1, 'SANSCOMPTE', 1);
insert into public.players (club_id, nom, team_id, auth_user_id) values (1, 'MUET', 1, '${MUET}');
insert into public.push_subscriptions (user_id, club_id, endpoint, p256dh, auth) values
  ('${P.joueurPro}', 1, 'https://web.push.apple.com/pro1', '${'B'.repeat(87)}', '${'a'.repeat(22)}'),
  ('${P.joueurPro}', 1, 'https://fcm.googleapis.com/fcm/send/pro2', '${'B'.repeat(87)}', '${'a'.repeat(22)}'),
  ('${P.joueurU14}', 1, 'https://fcm.googleapis.com/fcm/send/u14', '${'B'.repeat(87)}', '${'a'.repeat(22)}');
insert into public.sessions (id, club_id, created_by, titre, date_seance, heure, team_id) overriding system value values
  (901, 1, '${P.admin}', 'Vitesse', current_date - 1, '18:00', 1),
  (902, 1, '${P.admin}', 'Ancienne', current_date - 20, null, 1),
  (903, 1, '${P.admin}', 'Demain', current_date + 1, null, 1),
  (904, 1, '${P.admin}', 'U14', current_date, null, 5);
insert into public.matches (id, club_id, team_id, adversaire, date_match, created_by) overriding system value values
  (951, 1, 1, 'RIVAL', current_date - 2, '${P.admin}'), (952, 1, 1, 'FEUILLE', current_date - 2, '${P.admin}');
`);
const [SANS, MU] = (await q(`select id::int from public.players where nom in ('SANSCOMPTE', 'MUET') order by nom desc`)).rows.map(r => r.id);
await q(`insert into public.match_players (club_id, match_id, player_id, statut, minutes) values (1, 952, $1, 'non_entre', 0)`, [J.pro]);

/* ---------- 1. Relance individuelle : message, lien direct, trace ---------- */
let out = await take(P.coachPro, 'seance', 901, [J.pro]);
assert.equal(out.messages.length, 1);
const m = out.messages[0];
assert.equal(m.player_id, J.pro);
assert.equal(m.subs.length, 2, 'les appareils du joueur, et seulement les siens');
assert.equal(m.url, 'mon-espace.html?rpe=s901', 'lien direct vers la saisie de CETTE séance');
assert.match(m.body, /^Vitesse du \d\d\/\d\d à 18:00 : ton RPE/, 'la séance est nommée, avec sa date');
assert.ok(m.title.length <= 80 && m.body.length <= 300);
assert.deepEqual(await logged(), [{ player_id: J.pro, session_id: 901, match_id: null, sent_by: P.coachPro, devices: 2, delivered: null }]);

/* ---------- 2. Pas de doublon ; une relance arrivée nulle part ne bloque pas ---------- */
assert.deepEqual(why(await take(P.coachPro, 'seance', 901, [J.pro])), { [J.pro]: 'deja_relance' }, 'livraison en cours : pas de deuxième envoi');
await as(P.admin, () => q(`select public.rpe_remind_done($1)`, [JSON.stringify([{ id: m.reminder, delivered: 2 }])]));
assert.equal((await logged())[0].delivered, null, 'un autre compte ne note pas la livraison');
await as(P.coachPro, () => q(`select public.rpe_remind_done($1)`, [JSON.stringify([{ id: m.reminder, delivered: 0 }])]));
await as(P.coachPro, () => q(`select public.rpe_remind_done($1)`, [JSON.stringify([{ id: m.reminder, delivered: 2 }])]));
assert.equal((await logged())[0].delivered, 0, 'livraison notée une fois, par celui qui a relancé');
out = await take(P.coachPro, 'seance', 901, [J.pro]);
assert.equal(out.messages.length, 1, 'arrivée nulle part : on peut relancer');
await as(P.coachPro, () => q(`select public.rpe_remind_done($1)`, [JSON.stringify([{ id: out.messages[0].reminder, delivered: 1 }])]));
assert.deepEqual(why(await take(P.admin, 'seance', 901, [J.pro])), { [J.pro]: 'deja_relance' }, 'reçue : même un autre membre du staff ne relance pas dans les 12 h');
await q(`update public.rpe_reminders set sent_at = now() - interval '13 hours'`);
assert.equal((await take(P.admin, 'seance', 901, [J.pro])).messages.length, 1, '12 h plus tard : nouvelle relance possible');

/* ---------- 3. Équipe : chacun son motif, seul celui qui peut répondre reçoit ---------- */
await q(`delete from public.rpe_reminders`);
out = await take(P.coachPro, 'seance', 901, [J.pro, J.pro, SANS, MU, J.mineure, J.autre]);
assert.deepEqual(out.messages.map(x => x.player_id), [J.pro], 'doublon dans la liste : un seul message');
assert.deepEqual(why(out), { [SANS]: 'sans_compte', [MU]: 'sans_appareil', [J.mineure]: 'non_suivi', [J.autre]: 'non_suivi' });
assert.deepEqual((await logged()).map(r => r.player_id), [J.pro], 'trace : seulement les relances parties');
await q(`delete from public.rpe_reminders`);
await q(`insert into public.session_rpe (club_id, session_id, player_id, rpe, saisi_par) values (1, 901, $1, 6, $2)`, [J.pro, P.joueurPro]);
assert.deepEqual(why(await take(P.coachPro, 'seance', 901, [J.pro])), { [J.pro]: 'deja_repondu' }, 'déjà à jour : pas de relance');
await q(`insert into public.attendance (session_id, player_id, statut) values (901, $1, 'non_concerne')`, [MU]);
assert.deepEqual(why(await take(P.coachPro, 'seance', 901, [MU])), { [MU]: 'non_concerne' }, 'retiré de la séance');

/* ---------- 4. Match : sans feuille le groupe, avec feuille ceux qui ont joué ---------- */
out = await take(P.coachPro, 'match', 951, [J.pro]);
assert.equal(out.messages[0].url, 'mon-espace.html?rpe=m951');
assert.match(out.messages[0].body, /^Match – RIVAL du /);
assert.equal((await logged()).at(-1).match_id, 951);
assert.deepEqual(why(await take(P.coachPro, 'match', 952, [J.pro])), { [J.pro]: 'non_concerne' }, 'resté sur le banc');

/* ---------- 5. Refus : délai, droits, autre équipe, autre club, taille ---------- */
await refused(P.coachPro, 'seance', 902, [J.pro], /saisie est fermée/, 'au-delà de J+14 : le joueur ne peut plus répondre');
await refused(P.coachPro, 'seance', 903, [J.pro], /saisie est fermée/, 'séance pas encore passée');
await refused(P.joueurPro, 'seance', 901, [J.pro], /réservée au staff/, 'un joueur ne relance pas');
await refused(P.lecteur, 'seance', 901, [J.pro], /réservée au staff/, 'le lecteur ne relance pas');
await refused(P.coachU14, 'seance', 901, [J.pro], /introuvable/, 'coach d’une autre équipe');
await refused(P.adminB, 'seance', 901, [J.pro], /introuvable/, 'autre club');
await refused(null, 'seance', 901, [J.pro], /permission denied/, 'anonyme');
await refused(P.coachPro, 'seance', 901, Array.from({ length: 13 }, (_, i) => i + 1), /De 1 à 12/);
await refused(P.coachPro, 'seance', 901, [], /De 1 à 12/);
await refused(P.coachPro, 'autre', 901, [J.pro], /Type inconnu/);
assert.deepEqual(why(await take(P.coachU14, 'seance', 904, [J.mineure])), {}, 'chaque coach relance dans son équipe');

/* ---------- 6. Journal : lu par le staff qui suit le joueur, jamais écrit à la main ---------- */
const seen = async (uid) => (await as(uid, () => q('select player_id::int from public.rpe_reminders'))).rows.map(r => r.player_id).sort();
assert.deepEqual(await seen(P.coachPro), [J.pro]);
assert.deepEqual(await seen(P.admin), [J.pro, J.mineure].sort());
assert.deepEqual(await seen(P.coachU14), [J.mineure]);
for (const who of [P.joueurPro, P.joueurU14, P.lecteur, P.adminB]) assert.deepEqual(await seen(who), [], `journal fermé à ${who}`);
await assert.rejects(as(P.coachPro, () => q(`insert into public.rpe_reminders (club_id, session_id, player_id, sent_by, devices) values (1, 901, ${J.pro}, '${P.coachPro}', 1)`)), /permission denied/);
await assert.rejects(as(P.coachPro, () => q(`delete from public.rpe_reminders`)), /permission denied/);

/* ---------- 7. Retour arrière ---------- */
await db.exec(sqlFile('lmfc_v50_retour.sql'));
await db.exec(sqlFile('lmfc_v50_retour.sql'));
const after = await catalog(db);
for (const k of Object.keys(before)) assert.deepEqual(after[k], before[k], `retour arrière : ${k} identique`);

console.log('rpe-remind-sql : OK (droits, destinataires, délai, doublons, match, journal, retour arrière)');
