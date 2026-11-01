/* Feuille de match collée (web/assets/js/match-sheet.js), au format réel de
   la page « Le match » d'epreuves.fff.fr (relevé le 01/11/2026), noms
   inventés : composition, changements, avertissements, exclusion, buts,
   notre bloc repéré par le nom du club, minutes avec la durée seulement,
   rapprochement des noms (complets ou « PRÉNOM N. »).
   Lancement : node tests/match-sheet.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ String, Number, Map, Set, Math, JSON });
for (const f of ['fff-import.js', 'match-sheet.js']) vm.runInContext(readFileSync(`web/assets/js/${f}`, 'utf8'), ctx);
const run = (code) => JSON.parse(JSON.stringify(vm.runInContext(code, ctx)));

// Seniors : noms complets, buteurs nommés ; nous jouons à l'extérieur.
ctx.SENIOR = `Univers FFF
SE CONNECTER
DIM 25 OCT 2026 - 17H15
L1 - Senior Journée 8
AJ AUXERRE
1
2
LE MANS FC
RECHERCHE
Le match
RÉSUMÉ
DÉBUT DU MATCH
22’
Avertissement pour LE MANS FC
PAUL MARTIN
est averti
48’
But pour LE MANS FC
inscrit par
LEO DURAND
53’
Changement pour LE MANS FC
HUGO PETIT
remplace
PAUL MARTIN
56’
But pour AJ AUXERRE
inscrit par
JEAN ADVERSE
70’
Exclusion pour AJ AUXERRE
MARC ADVERSE
est exclu
90+3’
But pour LE MANS FC
inscrit par
HUGO PETIT
FIN DU MATCH
COMPOSITION
AJ AUXERRE
TITULAIRES
1
JEAN ADVERSE
4
MARC ADVERSE
REMPLAÇANTS
17
LUC ADVERSE
LE MANS FC
TITULAIRES
8
PAUL MARTIN
9
LEO DURAND
13
SAMI BEN ALI
REMPLAÇANTS
10
HUGO PETIT
23
RAYAN TOURE
LIEU DE LA RENCONTRE
STADE DE L'ABBE DESCHAMPS`;
const s = run(`msParse(SENIOR, 'Le Mans FC')`);
assert.deepEqual([s.head.date, s.head.heure, s.head.competition, s.side, s.team], ['2026-10-25', '17:15', 'L1 - Senior', 'away', 'LE MANS FC']);
assert.deepEqual(s.teams, ['AJ AUXERRE', 'LE MANS FC'], 'deux blocs, le nôtre repéré par le nom du club');
assert.equal(s.goalsKnown, true, '2 buts nommés pour 2 marqués');
const p = Object.fromEntries(s.players.map(x => [x.name, x]));
assert.deepEqual(s.players.map(x => x.name), ['PAUL MARTIN', 'LEO DURAND', 'SAMI BEN ALI', 'HUGO PETIT', 'RAYAN TOURE'], 'jamais un joueur adverse');
assert.deepEqual([p['PAUL MARTIN'].statut, p['PAUL MARTIN'].sorti, p['PAUL MARTIN'].cartons_jaunes], ['titulaire', 53, 1]);
assert.deepEqual([p['HUGO PETIT'].statut, p['HUGO PETIT'].entre, p['HUGO PETIT'].buts], ['remplacant', 53, 1], 'entré à la 53e, buteur à la 90+3');
assert.deepEqual([p['RAYAN TOURE'].statut, p['RAYAN TOURE'].buts], ['non_entre', 0], 'remplaçant non entré');
assert.deepEqual([p['LEO DURAND'].buts, p['SAMI BEN ALI'].buts], [1, 0], 'tous les buts nommés : les autres en ont 0');
assert.equal(s.players.some(x => x.carton_rouge), false, 'l’exclusion est adverse');
assert.deepEqual(s.players.map(x => run(`msMinutes(${JSON.stringify(x)}, 90)`)), [53, 90, 90, 37, 0], 'minutes avec la durée');
assert.deepEqual(s.players.map(x => run(`msMinutes(${JSON.stringify(x)}, null)`)), [null, null, null, null, null], 'sans durée : rien d’inventé');

// Jeunes : « PRÉNOM N. », aucun buteur publié, rentrées multiples ; le club à domicile.
ctx.JEUNES = ['SAM 03 OCT 2026 - 11H00', 'Critérium Régional 1 U13 - U13 - U12 Journée 3', 'LE MANS FC', '1', '0', 'VERTOU USSA',
  'RÉSUMÉ', 'DÉBUT DU MATCH', '12’', 'Changement pour LE MANS FC', 'YANIS B.', 'remplace', 'NOAH D.',
  '20’', 'Changement pour LE MANS FC', 'NOAH D.', 'remplace', 'YANIS B.', '30’', 'Changement pour VERTOU USSA', 'TOM V.', 'remplace', 'LEO V.',
  '35’', 'Avertissement pour LE MANS FC', 'ELIOT P.', 'est averti', 'FIN DU MATCH',
  'COMPOSITION', 'LE MANS FC', 'TITULAIRES', '1', 'ELIOT P.', '2', 'NOAH D.', 'REMPLAÇANTS', '12', 'YANIS B.',
  'VERTOU USSA', 'TITULAIRES', '1', 'LEO V.', 'REMPLAÇANTS', '12', 'TOM V.', 'LIEU DE LA RENCONTRE'].join('\n');
const j = run(`msParse(JEUNES, 'Le Mans FC')`);
assert.deepEqual([j.side, j.goalsKnown], ['home', false]);
assert.deepEqual(j.players.map(x => [x.name, x.statut, x.buts, x.cartons_jaunes]), [['ELIOT P.', 'titulaire', null, 1], ['NOAH D.', 'titulaire', null, 0], ['YANIS B.', 'remplacant', null, 0]],
  'buteurs non publiés : buts inconnus, pas zéro');
assert.deepEqual(j.players.map(x => run(`msMinutes(${JSON.stringify(x)}, 60)`)), [60, null, 8], 'Noah sorti puis rentré : minutes à saisir ; Yanis entré à la 12e, sorti à la 20e : 8');
assert.equal(run(`msParse(JEUNES, 'Le Mans Villaret AS').team`), null, 'un autre club : aucun bloc attribué');

/* ---------- Rapprochement des noms ---------- */
ctx.ROSTER = [{ id: 1, prenom: 'Paul', nom: 'Martin', team_id: 1 }, { id: 2, prenom: 'Léo', nom: 'Durand', team_id: 1 }, { id: 3, prenom: 'Hugo', nom: 'Petit', team_id: 2 },
  { id: 4, prenom: 'Yanis', nom: 'Bakari', team_id: 5 }, { id: 5, prenom: 'Yanis', nom: 'Benali', team_id: 5 }, { id: 6, prenom: 'Noah', nom: 'Dia', team_id: 5 },
  { id: 7, prenom: 'Eliot', nom: 'Perrin', team_id: 5 }, { id: 8, prenom: 'Eliot', nom: 'Pons', team_id: 9 }, { id: 9, prenom: 'Sami', nom: 'Ben Ali', team_id: 1 }];
const m = (names, team) => run(`msMatch(${JSON.stringify(names)}, ROSTER, ${team})`).map(r => `${r.name}:${r.status}:${r.player?.id ?? '-'}`);
assert.deepEqual(m(['PAUL MARTIN', 'LEO DURAND', 'SAMI BEN ALI', 'HUGO PETIT', 'RAYAN TOURE'], 1),
  ['PAUL MARTIN:ok:1', 'LEO DURAND:ok:2', 'SAMI BEN ALI:ok:9', 'HUGO PETIT:ok:3', 'RAYAN TOURE:none:-'], 'nom complet, accents et nom composé');
assert.deepEqual(m(['ELIOT P.', 'NOAH D.', 'YANIS B.'], 5), ['ELIOT P.:confirm:7', 'NOAH D.:confirm:6', 'YANIS B.:choose:-'],
  'initiale : à confirmer ; deux Yanis B. : à choisir ; l’Eliot P. d’une autre équipe écarté');
assert.deepEqual(m(['ELIOT P.'], null), ['ELIOT P.:choose:-'], 'sans équipe : deux fiches possibles');
assert.deepEqual(m(['PAUL MARTIN', 'PAUL MARTIN'], 1), ['PAUL MARTIN:choose:-', 'PAUL MARTIN:choose:-'], 'une fiche pour deux noms : à choisir');

console.log('match-sheet : OK (feuille senior et jeunes, minutes, rapprochement)');
