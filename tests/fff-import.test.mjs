/* Import du calendrier FFF (web/assets/js/fff-import.js) sur un vrai texte
   copié depuis epreuves.fff.fr (tests/fixtures-fff-calendrier.txt :
   octobre avec bandeau cookies, menus et pied de page, puis novembre).
   Rencontres jouées, à venir, forfait, plateaux sans score ; clé stable
   malgré un report ; notre côté ; règle de mise à jour.
   Lancement : node tests/fff-import.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ String, Number, Map, Set });
vm.runInContext(readFileSync('web/assets/js/fff-import.js', 'utf8'), ctx);
const run = (code) => vm.runInContext(code, ctx);
ctx.TEXT = readFileSync('tests/fixtures-fff-calendrier.txt', 'utf8');
const { matches, skipped } = run('fffParse(TEXT)');
const find = (date, home, away) => matches.find(m => m.date === date && m.home === home && (!away || m.away === away));
const plain = (o) => JSON.parse(JSON.stringify(o));

/* ---------- 1. Lecture ---------- */
const dates = ctx.TEXT.split('\n').filter(l => /^(LUN|MAR|MER|JEU|VEN|SAM|DIM) \d{2} /.test(l)).length;
assert.equal(matches.length, dates, 'chaque rencontre du texte est reconnue');
assert.equal(skipped, 0);
assert.equal(dates, 56);
assert.deepEqual(plain(find('2026-10-03', 'LE MANS FC 2', 'FC NANTES 2')), { date: '2026-10-03', heure: '18:00', stade: null, competition: 'N2 - Senior',
  journee: 'Journée 4', home: 'LE MANS FC 2', away: 'FC NANTES 2', score_home: 0, score_away: 1, statut: null }, 'match joué');
assert.deepEqual(plain(find('2026-11-07', 'FONTENAY VENDEE')), { date: '2026-11-07', heure: '18:00', stade: null, competition: 'N2 - Senior',
  journee: 'Journée 7', home: 'FONTENAY VENDEE', away: 'LE MANS FC 2', score_home: null, score_away: null, statut: null }, 'match à venir');
const forfait = find('2026-11-06', 'LE MANS FC 2', 'CHAMPFLEUR ES');
assert.deepEqual([forfait.away, forfait.score_home, forfait.statut], ['CHAMPFLEUR ES', null, 'FORFAIT GÉNÉRAL'], 'forfait');
const plateau = find('2026-11-28', 'F.C. ST SATURNIN LA MILESSE');
assert.deepEqual([plateau.stade, plateau.away, plateau.heure, plateau.competition, plateau.journee],
  ['STADE VALÈRE HUET 2', 'LE MANS FOOTBALL CLUB 1', '10:30', 'U11 Départemental / Phase 1 - Animation Départementale U11', 'POULE A'], 'plateau sans score');
const avantPied = find('2026-10-17', 'LA PATRIOTE BONNETABLE');
assert.deepEqual([avantPied.away, avantPied.competition, avantPied.journee], ['LE MANS FOOTBALL CLUB 4', 'U13 Coupe Departementale / Phase 1 - DEPARTEMENTALE', '1ER TOUR'],
  'dernière rencontre avant le pied de page : le texte qui suit est ignoré');
assert.equal(find('2026-11-01', 'CHATEAU GONTIER ANC').competition, 'Coupe Pays de la Loire Seniors Féminines ABSOLIS - Senior F', 'tour de coupe retiré');
assert.equal(run(`fffParse('Bienvenue\\nMENU\\n12\\n3\\nFin').matches.length`), 0, 'texte sans rencontre');
assert.equal(run(`fffParse('SAM 03 XYZ 2026 - 18H00\\nN2 - Senior Journée 4\\nA\\n1\\n0\\nB').matches.length`), 0, 'mois inconnu : rien inventé');
assert.equal(run(`fffParse('SAM 03 OCT 2026 - 18H00\\nA\\n1\\n0\\nB').skipped`), 1, 'compétition absente : ignorée et comptée');
// Page « Le match » collée : du texte avant la compétition dépasse les 120 caractères d'un stade (matches_stade_len).
ctx.MATCH_PAGE = ['SAM 24 OCT 2026 - 15H00', 'Stade Municipal de Bouchemaine', 'Rue du Stade, 49080 Bouchemaine — accès par le parking nord, vestiaires côté tribune, arbitre désigné par le district',
  'National 3 - Senior Journée 8', 'BOUCHEMAINE ES', '2', '4', 'LE MANS FC', 'Facebook', 'twitter', 'nulllogo ans'].join('\n');
const page = run('fffParse(MATCH_PAGE)').matches[0];
assert.deepEqual([page.stade, page.home, page.away, page.score_home, page.heure], [null, 'BOUCHEMAINE ES', 'LE MANS FC', 2, '15:00'], 'stade trop long : écarté, le match reste');

/* ---------- 2. Clé : saison, compétition, journée ou tour, domicile, extérieur ---------- */
ctx.M = find('2026-11-07', 'FONTENAY VENDEE');
assert.equal(run('fffKey(M)'), '2026-2027|N2 SENIOR|JOURNEE 7|FONTENAY VENDEE|LE MANS FC 2');
ctx.P1 = find('2026-10-03', 'ANILLE BRAYE FOOTBALL');
ctx.P2 = find('2026-11-21', 'ANILLE BRAYE FOOTBALL');
assert.notEqual(run('fffKey(P1)'), run('fffKey(P2)'), 'plateau : même affiche, deux dates, deux rencontres');
assert.equal(run(`fffKey({ ...M, date: '2026-11-21', heure: '15:00' })`), run('fffKey(M)'), 'match reporté : même clé');
assert.equal(run(`fffSeason('2027-03-01')`), '2026-2027');
assert.equal(run(`fffSeason('2027-07-01')`), '2027-2028');
assert.notEqual(run(`fffKey({ ...M, home: M.away, away: M.home })`), run('fffKey(M)'), 'match retour : autre clé');
assert.equal(new Set(run('fffParse(TEXT).matches.map(fffKey)')).size, matches.length, 'aucune clé en double dans le texte');

/* ---------- 3. Notre côté ---------- */
ctx.ALL = matches;
const sides = run('fffOurSides(ALL)');
matches.forEach((m, i) => {
  if (sides[i]) assert.match(m[sides[i]], /^LE MANS F/, `${m.date} ${m.home}–${m.away} : notre équipe`);
});
const sideOf = (date, home, away) => sides[matches.indexOf(find(date, home, away))];
assert.equal(sideOf('2026-10-03', 'LE MANS FC 2', 'FC NANTES 2'), 'home');
assert.equal(sideOf('2026-11-07', 'FONTENAY VENDEE'), 'away');
assert.equal(sideOf('2026-10-03', 'LE MANS FC FEM 2'), 'home', 'derby résolu par la compétition (deux mois collés)');
ctx.OCT = run(`fffParse(TEXT.slice(0, TEXT.indexOf('NOVEMBRE 2026'))).matches`);
const octSides = run('fffOurSides(OCT)');
assert.equal(octSides[ctx.OCT.findIndex(m => m.home === 'LE MANS FC FEM 2')], null, 'derby seul : à choisir');
assert.ok(sides.filter(s => s === null).length <= 2, 'presque tout est reconnu sans aide');

/* ---------- 4. Champs du match et mise à jour ---------- */
const inc = plain(run(`fffIncoming(M, 'away')`));
assert.deepEqual(inc, { date_match: '2026-11-07', heure: '18:00', competition: 'N2 - Senior', adversaire: 'FONTENAY VENDEE',
  lieu: 'exterieur', stade: null, score_pour: null, score_contre: null });
ctx.INC = inc;
ctx.SAVED = { ...inc, heure: '18:00:00', commentaire: 'Bloc bas', ext_data: inc };
const merge = (code) => plain(run(code));
assert.deepEqual(merge('fffMerge(SAVED, INC)'), { patch: {}, changed: [], kept: [] }, 'rien de neuf (heure lue « 18:00:00 »)');
assert.deepEqual(merge(`fffMerge(SAVED, { ...INC, score_pour: 2, score_contre: 1 })`),
  { patch: { score_pour: 2, score_contre: 1 }, changed: ['score_pour', 'score_contre'], kept: [] }, 'le score arrive');
assert.deepEqual(merge(`fffMerge(SAVED, { ...INC, date_match: '2026-11-21', heure: '15:00' })`).changed, ['date_match', 'heure'], 'report');
ctx.EDITED = { ...ctx.SAVED, adversaire: 'Fontenay', heure: '20:00:00' };
assert.deepEqual(merge('fffMerge(EDITED, INC)'), { patch: {}, changed: [], kept: [] }, 'modifié par le staff, FFF inchangée : rien, sans alerte');
assert.deepEqual(merge(`fffMerge(EDITED, { ...INC, heure: '17:00', adversaire: 'FONTENAY VF' })`),
  { patch: {}, changed: [], kept: ['heure', 'adversaire'] }, 'modifié des deux côtés : la saisie du staff est gardée et signalée');
ctx.SCORED = { ...ctx.SAVED, score_pour: 3, score_contre: 0 };
assert.deepEqual(merge('fffMerge(SCORED, INC)').patch, {}, 'valeur absente côté FFF : rien n’est effacé');
ctx.MANUAL = { date_match: '2026-11-07', heure: null, competition: 'N2', adversaire: 'Fontenay', lieu: 'exterieur', stade: null };
assert.deepEqual(merge('fffMerge(MANUAL, INC)'), { patch: { heure: '18:00' }, changed: ['heure'], kept: ['competition', 'adversaire'] },
  'match saisi à la main puis rattaché : seuls les vides se remplissent');
assert.ok(!('commentaire' in merge(`fffMerge(SAVED, { ...INC, commentaire: 'x' })`).patch), 'commentaire jamais touché');


/* ---------- 5. Le club est la référence (bug « Guingamp ») ---------- */
const clubSides = run(`fffOurSides(ALL, 'Le Mans FC')`);
matches.forEach((m, i) => {
  if (clubSides[i] === 'home' || clubSides[i] === 'away') assert.match(m[clubSides[i]], /^LE MANS (FC|FOOTBALL CLUB)\b/, `${m.home}–${m.away} : le camp du club`);
});
assert.equal(clubSides[matches.indexOf(find('2026-10-03', 'LE MANS FC FEM 2'))], 'home', 'Le Mans Villaret AS n’est pas le club');
// Amicaux : toutes les équipes seniors mélangées ; Guingamp affronte LE MANS FC et LE MANS FC 2.
ctx.AMICAUX = run(`fffParse(['VEN 02 OCT 2026 - 18H00', 'MATCHS AMICAUX FFF NIVEAU 2 - Senior Journée 1', 'EA GUINGAMP', '-', 'LE MANS FC',
  'SAM 03 OCT 2026 - 15H00', 'MATCHS AMICAUX FFF NIVEAU 2 - Senior Journée 1', 'EA GUINGAMP', '2', '1', 'LE MANS FC 2',
  'SAM 10 OCT 2026 - 15H00', 'MATCHS AMICAUX FFF NIVEAU 2 - Senior Journée 2', 'STADE LAVALLOIS', '0', '0', 'EA GUINGAMP',
  'DIM 11 OCT 2026 - 15H00', 'MATCHS AMICAUX FFF NIVEAU 2 - Senior Journée 2', 'LE MANS FC 2', '1', '1', 'LE MANS FC 3'].join('\\n')).matches`);
assert.deepEqual(plain(run('fffOurSides(AMICAUX.slice(0, 3))')), ['home', 'home', 'away'], 'sans le nom du club : Guingamp, présent partout, pris pour nous (le bug)');
assert.deepEqual(plain(run(`fffOurSides(AMICAUX.slice(0, 3), 'Le Mans FC')`)), ['away', 'away', 'none'], 'avec le nom du club : corrigé');
assert.deepEqual(plain(run(`fffOurSides(AMICAUX, 'Le Mans FC')`)), ['away', 'away', 'none', null],
  'Le Mans à l’extérieur, rencontre sans le club écartée, derby interne à choisir');
assert.deepEqual(plain(run(`fffOurSides(AMICAUX, 'LE MANS FOOTBALL CLUB')`)), ['away', 'away', 'none', null], '« Football Club » = « FC »');
assert.equal(run(`fffIsClub('LE MANS F.C.S.', 'Le Mans FC')`), false, 'Le Mans F.C.S. : un autre club');
assert.equal(run(`fffIsClub('LE MANS F.C. 2', 'Le Mans FC')`), true);
ctx.INC2 = run(`fffIncoming(AMICAUX[1], 'away')`);
assert.deepEqual([ctx.INC2.adversaire, ctx.INC2.lieu, ctx.INC2.score_pour, ctx.INC2.score_contre], ['EA GUINGAMP', 'exterieur', 1, 2], 'adversaire, lieu et score vus du Mans');

/* ---------- 6. Équipe du club d'après la compétition ---------- */
ctx.TEAMS = [{ id: 1, nom: 'N2' }, { id: 2, nom: 'N3' }, { id: 3, nom: 'U17' }, { id: 4, nom: 'U14' }, { id: 5, nom: 'U15' }];
const guess = (competition) => run(`fffGuessTeam(${JSON.stringify({ competition })}, TEAMS)`);
assert.equal(guess('N2 - Senior'), 1);
assert.equal(guess('National 3 - Senior'), 2, '« National 3 » = N3');
assert.equal(guess('Régional 2 U17 - U17 - U16'), 3);
assert.equal(guess('Régional 1 U14 - U15 - U14'), null, 'U14 et U15 cités : à vérifier, rien d’imposé');
assert.equal(guess('MATCHS AMICAUX FFF NIVEAU 2 - Senior'), null);

/* ---------- 7. Lignes répétées (logo puis nom) ---------- */
const dup = run(`fffParse(['SAM 05 DEC 2026 - 14H00', 'Régional 1 U14 - U15 - U14 Journée 10', 'ANGERS SCO', 'ANGERS SCO', '14:00', 'LE MANS FC'].join('\\n')).matches[0]`);
assert.deepEqual([dup.competition, dup.home, dup.away, dup.stade], ['Régional 1 U14 - U15 - U14', 'ANGERS SCO', 'LE MANS FC', null],
  'la compétition n’est jamais un nom d’équipe');
const noRound = run(`fffParse(['SAM 05 DEC 2026 - 14H00', 'Régional 1 U14 - U15 - U14', 'Complexe du Grand Étang', 'ANGERS SCO', '14:00', 'LE MANS FC'].join('\\n')).matches[0]`);
assert.deepEqual([noRound.competition, noRound.home], ['Régional 1 U14 - U15 - U14', 'ANGERS SCO'], 'compétition reconnue même sans journée');

console.log(`fff-import : OK (${matches.length} rencontres, clé, côté, mise à jour)`);
