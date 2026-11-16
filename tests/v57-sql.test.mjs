/* lmfc_v57.sql (prénoms et noms mis en forme) et son retour arrière, sur les
   migrations réelles (full-db.mjs) :
     - fmt_prenom / fmt_nom : majuscules, accents, traits d'union, apostrophes, espaces ;
     - l'aperçu (lmfc_v57_apercu.sql) annonce exactement ce que la migration change ;
     - fiches existantes mises en forme, noms d'avant gardés ; rejouable sans perte ;
     - toute écriture ensuite (fiche, joueur extérieur) est mise en forme ;
     - le retour rend les noms d'avant, sauf ceux modifiés depuis, et l'état d'avant.
   Lancement : node tests/v57-sql.test.mjs (PGlite relié en node_modules, CLAUDE.md). */
import assert from 'node:assert/strict';
import { fullDb, sqlFile, seed, actor, catalog, P, T } from './full-db.mjs';

let pg;
try {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }, { unaccent }] = await Promise.all([import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'), import('@electric-sql/pglite/contrib/pg_trgm'), import('@electric-sql/pglite/contrib/unaccent')]);
  pg = { PGlite, pgcrypto, pg_trgm, unaccent };
} catch {
  console.error('v57-sql : PGlite absent, test NON lancé (voir CLAUDE.md, « Tests »)');
  process.exit(1);
}

const { db } = await fullDb(pg, { until: 'lmfc_v56.sql' });
await seed(db);
const as = actor(db), q = (s, p) => db.query(s, p);
await db.exec(`
insert into public.players (club_id, team_id, nom, prenom) values
 (1, ${T.u14}, 'kharroubi', 'adnane'), (1, ${T.u14}, '  de la   fuente ', 'jean-pierre'), (1, ${T.u14}, 'kanté', 'n''golo'),
 (1, ${T.u14}, 'BAZABADILA', ' élodie   marie '), (1, ${T.u14}, 'DÉJÀ', 'Bien');
`);
const names = async () => Object.fromEntries((await q(`select id, prenom, nom from public.players order by id`)).rows.map(r => [r.id, `${r.prenom} ${r.nom}`]));
const before = await catalog(db);
const start = await names();
const preview = (await q(sqlFile('lmfc_v57_apercu.sql'))).rows.map(r => `${r.prenom_apres} ${r.nom_apres}`).sort();

await db.exec(sqlFile('lmfc_v57.sql'));
const after = await names();
const changed = Object.keys(after).filter(id => after[id] !== start[id]).map(id => after[id]).sort();
assert.deepEqual(changed, ['Adnane KHARROUBI', 'Jean-Pierre DE LA FUENTE', "N'Golo KANTÉ", 'Élodie Marie BAZABADILA'].sort(), 'mise en forme');
assert.deepEqual(preview, changed, 'l’aperçu annonce exactement ce qui change');
assert.equal(Object.values(after).filter(n => n === 'Bien DÉJÀ').length, 1, 'déjà en forme : inchangé');
assert.equal((await q(`select count(*)::int n from public.lmfc_v57_noms_avant`)).rows[0].n, 4, 'noms d’avant gardés');
await db.exec(sqlFile('lmfc_v57.sql'));   // rejouable
assert.equal((await q(`select nom from public.lmfc_v57_noms_avant where nom = 'kharroubi'`)).rows.length, 1, 'rejouer ne remplace pas le nom d’origine');
assert.equal(await as(P.coachU14, async () => (await q(`select count(*)::int n from public.lmfc_v57_noms_avant`)).rows.length ? 'lu' : 'rien').catch(() => 'refusé'), 'refusé',
  'sauvegarde illisible par l’API');

/* Écritures ensuite : fiche par l'API, joueur extérieur, modification. */
await as(P.coachU14, () => q(`insert into public.players (club_id, team_id, nom, prenom) values (1, ${T.u14}, 'martin', 'noé')`));
assert.equal((await q(`select prenom || ' ' || nom n from public.players where nom = 'MARTIN'`)).rows[0].n, 'Noé MARTIN', 'création par l’API');
const x = (await as(P.coachU14, () => q(`select public.player_exterieur_create('léo', 'dupont-moreau') id`))).rows[0].id;
assert.equal((await q(`select prenom || ' ' || nom n from public.players where id = $1`, [x])).rows[0].n, 'Léo DUPONT-MOREAU', 'joueur extérieur');
await as(P.coachU14, () => q(`update public.players set prenom = 'ADNANE' where nom = 'KHARROUBI'`));
const id1 = Object.keys(start).find(id => start[id] === 'adnane kharroubi');
assert.equal((await names())[id1], 'Adnane KHARROUBI', 'modification mise en forme');
// Modifiée depuis : le retour la garde telle qu'elle est.
const id2 = Object.keys(start).find(id => start[id] === "n'golo kanté");
await q(`update public.players set prenom = 'Ngolo' where id = $1`, [id2]);

/* Retour arrière. */
await db.exec(sqlFile('lmfc_v57_retour.sql'));
await db.exec(sqlFile('lmfc_v57_retour.sql'));   // rejouable
const back = await names();
assert.equal(back[id1], 'adnane kharroubi', 'nom d’avant rendu');
assert.equal(back[id2], 'Ngolo KANTÉ', 'fiche modifiée depuis : gardée');
assert.equal(Object.values(back).includes('Noé MARTIN'), true, 'fiche créée depuis : gardée');
assert.deepEqual(await catalog(db), before, 'retour arrière : état d’avant à l’identique');
await db.exec(sqlFile('lmfc_v57.sql'));
console.log('v57-sql : OK');
