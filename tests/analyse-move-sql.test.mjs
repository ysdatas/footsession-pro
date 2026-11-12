/* Timeline de l'onglet Analyse : changer un clip de piste et le dupliquer, sur toutes les
   migrations réelles (full-db.mjs), avec le codage tel que la page l'envoie
   (anMoveCode, anCodePayload : analyse-model.js, analyse-data.js).
   - déplacement duel terrestre → centre : action changée en base, minutage, vidéo,
     joueur, contexte et tags gardés, « Gagné » pas converti ; défait à l'identique ;
   - duplication : nouvelle séquence sur la même vidéo, même découpage, réservée au
     staff, codage copié ou vide ; modifier la copie ne touche pas l'original ;
   - droits : joueur, lecteur, coach d'une autre équipe, autre club refusés ;
   - intégrité : aucune séquence en trop, codage relié à sa séquence, qui et quand.
   Lancement : voir access-matrix-sql.test.mjs (PGlite relié le temps du test). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fullDb, seed, actor, P, J } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('analyse-move-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const page = vm.createContext({});
for (const f of ['analyse-model.js', 'analyse-data.js']) vm.runInContext(readFileSync(`web/assets/js/${f}`, 'utf8'), page);
const js = (code) => JSON.parse(JSON.stringify(vm.runInContext(code, page)));

const { db } = await fullDb(pg, { until: 'lmfc_v49.sql' });
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
const save = async (uid, id, label, start, end, code) => Number((await as(uid, () => q('select public.save_sequence_code($1, 301, $2, $3, $4, $5) id',
  [id, label, start, end, JSON.stringify(code)]))).rows[0].id);
const clip = async (id) => {   // comme la page le lit : séquence + codage
  const s = (await q('select id::int, video_id::int, player_id::int, label, start_sec::float8 start_sec, end_sec::float8 end_sec, staff_only from public.video_sequences where id = $1', [id])).rows[0];
  const c = (await q('select * from public.sequence_codes where sequence_id = $1', [id])).rows[0] || {};
  return { ...c, ...s, tags: c.tags || [] };
};
const nSeq = async () => (await q('select count(*)::int n from public.video_sequences')).rows[0].n;

await db.exec(`insert into public.player_videos (id, club_id, player_id, titre, storage_path) overriding system value values (301, 1, ${J.pro}, 'Match A', 'r2/1/a.mp4');`);
const duel = { action: 'duel_sol', resultat: 'ok', categorie: 'interception', zone_depart: 'carre', periode: 2, pression: true, x1: 40, y1: 30, minute_match: 61, tags: ['Anticipation'] };
const id = await save(P.coachPro, null, 'Séquence 1', 12.5, 19, duel);
const orig = await clip(id);

/* ---------- Déplacement : Duels terrestres → Centres ---------- */
const { code, lost } = js(`anMoveCode(${JSON.stringify(orig)}, 'centre')`);
assert.deepEqual(lost, ['resultat', 'zone_depart', 'categorie'], 'ce qui part est annoncé avant d’écrire');
await save(P.coachPro, id, null, orig.start_sec, orig.end_sec, js(`anCodePayload(${JSON.stringify({ ...code })})`));
const moved = await clip(id);
assert.deepEqual([moved.action, moved.resultat, moved.categorie, moved.zone_depart], ['centre', null, null, null], 'centre en base, « Gagné » pas devenu « Réussi »');
assert.deepEqual([moved.video_id, moved.player_id, moved.start_sec, moved.end_sec, moved.label], [301, J.pro, 12.5, 19, 'Séquence 1'], 'vidéo, joueur, minutage gardés');
assert.deepEqual([moved.periode, moved.pression, moved.x1, moved.y1, moved.minute_match, moved.tags], [2, true, 40, 30, 61, ['Anticipation']], 'contexte, point et tags gardés');
assert.equal(moved.updated_by, P.coachPro, 'qui a modifié : posé par la base');
assert.equal(await nSeq(), 1, 'un déplacement ne crée rien');

// Défaire : seulement si le codage n'a pas bougé depuis ; l'état d'avant revient à l'identique.
const after = js(`anCodePayload(${JSON.stringify(code)})`);
assert.equal(js(`anSameCode(${JSON.stringify(moved)}, ${JSON.stringify(after)})`), true);
await save(P.coachPro, id, null, moved.start_sec, moved.end_sec, js(`anCodePayload(${JSON.stringify(orig)})`));
const back = await clip(id);
for (const k of ['action', 'resultat', 'categorie', 'zone_depart', 'periode', 'pression', 'x1', 'minute_match']) assert.deepEqual(back[k], orig[k], `annulé : ${k}`);
assert.equal(js(`anSameCode(${JSON.stringify(back)}, ${JSON.stringify(after)})`), false, 'recodé depuis : la page ne défait plus');

/* ---------- Duplication ---------- */
const copy = await save(P.coachPro, null, 'Séquence 1 (copie)', orig.start_sec, orig.end_sec, js(`anCodePayload(${JSON.stringify(back)})`));
const empty = await save(P.coachPro, null, 'Séquence 1 (copie)', orig.start_sec, orig.end_sec, {});
assert.notEqual(copy, id);
const c1 = await clip(copy), c2 = await clip(empty);
assert.deepEqual([c1.video_id, c1.start_sec, c1.end_sec, c1.staff_only], [301, 12.5, 19, true], 'même vidéo, même découpage, réservée au staff');
assert.equal((await q('select count(*)::int n from public.player_videos')).rows[0].n, 1, 'le fichier vidéo n’est pas copié');
for (const k of ['action', 'resultat', 'categorie', 'zone_depart', 'periode', 'x1', 'minute_match', 'tags']) assert.deepEqual(c1[k], back[k], `copie avec codage : ${k}`);
assert.deepEqual([c2.action, c2.resultat, c2.tags], [null, null, []], 'copie sans codage : à coder');
// La copie vit sa vie : passée en Centres et rognée, l'original ne bouge pas.
await save(P.coachPro, copy, null, 14, 19, js(`anCodePayload(${JSON.stringify(js(`anMoveCode(${JSON.stringify(c1)}, 'centre')`).code)})`));
const o2 = await clip(id);
assert.deepEqual([o2.action, o2.resultat, o2.start_sec, o2.tags], ['duel_sol', 'ok', 12.5, ['Anticipation']], 'original intact');
assert.deepEqual([(await clip(copy)).action, (await clip(copy)).start_sec], ['centre', 14]);

/* ---------- Droits ---------- */
for (const [who, msg] of [[P.joueurPro, 'joueur'], [P.lecteur, 'lecteur'], [P.coachU14, 'coach d’une autre équipe'], [P.adminB, 'autre club']]) {
  await assert.rejects(save(who, null, 'X', 1, 5, {}), `${msg} : pas de copie`);
  await assert.rejects(save(who, id, null, 12.5, 19, { action: 'tir' }), `${msg} : pas de déplacement`);
}
assert.equal((await clip(id)).action, 'duel_sol');

/* ---------- Intégrité ---------- */
assert.equal(await nSeq(), 3, 'trois séquences : l’original et deux copies voulues, rien de plus');
assert.equal((await q(`select count(*)::int n from public.sequence_codes c left join public.video_sequences s on s.id = c.sequence_id
  where s.id is null or s.player_id <> c.player_id or s.club_id <> c.club_id`)).rows[0].n, 0, 'chaque codage est relié à sa séquence, même joueur, même club');

console.log('analyse-move-sql : OK (déplacement sans conversion et défait, duplication indépendante, droits, intégrité)');
