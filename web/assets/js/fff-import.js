/* ============================================================
   LMFC Performance — fff-import.js
   Calendrier FFF collé dans « Retours de match » (matchs-fff.js).
   La FFF n'ouvre pas d'API aux clubs (requêtes serveur refusées,
   feuilles de match fermées) : le staff copie la page de son club sur
   epreuves.fff.fr (tout sélectionner, copier) et la colle. Ici, des
   fonctions pures, testées sur un vrai texte de la page
   (tests/fff-import.test.mjs) :
     - fffParse : les rencontres reconnues (le reste du texte, menus,
       bandeau cookies, est ignoré) ;
     - fffKey : la rencontre une fois pour toutes (saison, compétition,
       journée ou tour, domicile, extérieur ; sans la date : un report
       met à jour) ;
     - fffOurSides : notre équipe dans chaque rencontre, d'après le nom du
       club (« LE MANS FC », « LE MANS FC 2 » ; jamais « LE MANS VILLARET
       AS ») : l'adversaire n'est jamais pris pour nous ;
     - fffGuessTeam : l'équipe du club (N2, U17…) d'après la compétition ;
     - fffIncoming / fffMerge : les champs du match et la règle de mise
       à jour (un champ modifié par le staff est gardé).
   ============================================================ */

const FFF_FIELDS = ['date_match', 'heure', 'competition', 'adversaire', 'lieu', 'stade', 'score_pour', 'score_contre'];
const FFF_MONTHS = { JANV: 1, JAN: 1, FEVR: 2, FEV: 2, MARS: 3, MAR: 3, AVR: 4, MAI: 5, JUIN: 6, JUN: 6,
  JUIL: 7, JUL: 7, AOUT: 8, AOU: 8, SEPT: 9, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const fffNorm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ').trim();
const FFF_DATE = /^(LUN|MAR|MER|JEU|VEN|SAM|DIM)\.? (\d{1,2}) ([A-Z]+)\.? (\d{4})(?: (\d{1,2})H(\d{2}))?$/;
const FFF_ROUND = /\s+((?:Journée|Journee)\s+\d+|\d+\s*(?:er|e|ème|eme)\s+tour|(?:1er|\d+e)\s*TOUR.*|POULE\s+\S+)$/i;
const FFF_STATUS = /FORFAIT|REPORT|ANNUL|ARR[EÊ]T|HUIS|PENALIT|PÉNALIT/i;

/* Date FFF (« SAM 03 OCT 2026 - 18H00 ») : { date: '2026-10-03', heure: '18:00' }, ou null. */
function fffDate(line) {
  const m = fffNorm(line).match(FFF_DATE);
  const month = m && FFF_MONTHS[m[3]];
  if (!month) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return { date: `${m[4]}-${pad(month)}-${pad(m[2])}`, heure: m[5] ? `${pad(m[5])}:${m[6]}` : null };
}

/* Mots d'un nom d'équipe : points supprimés (« F.C. » = « FC »), « FOOTBALL CLUB » = « FC ». */
const fffWords = (s) => fffNorm(String(s ?? '').replace(/\./g, '')).replace(/\bFOOTBALL CLUB\b/g, 'FC').split(' ').filter(Boolean);
/* Le nom est-il une équipe du club ? Ses premiers mots sont ceux du club :
   « LE MANS FC », « LE MANS FC 2 », « LE MANS FC FEM 2 » oui ;
   « LE MANS F.C.S. », « LE MANS VILLARET AS » non (d'autres clubs). */
const fffIsClub = (name, club) => { const c = fffWords(club), n = fffWords(name); return c.length > 0 && c.every((w, i) => n[i] === w); };
/* Ligne de compétition (et pas un nom d'équipe ni une adresse). */
const FFF_COMP = /journ[ée]e|tour|poule|phase|plateau|senior|\bu\d{2}\b|r[ée]gional|national|district|coupe|championnat|crit[ée]rium|amica|f[ée]minin|futsal|ligue|\b[ldnr]\d\b/i;

/* Rencontres du texte collé. Après la date : [stade], compétition, domicile,
   puis le score (deux nombres), l'heure (« 18:00 ») ou « - », puis
   l'extérieur et un éventuel statut (« FORFAIT GÉNÉRAL »). Rencontre
   d'animation (plateau U10…) : ni score ni heure, la compétition est
   la ligne qui nomme une journée, un tour, une poule ou une phase. */
function fffParse(text) {
  // Une ligne répétée à la suite (logo puis nom de l'équipe) ne compte qu'une fois ; jamais un chiffre (score 1 – 1).
  const lines = String(text ?? '').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
    .filter((l, i, all) => l !== all[i - 1] || /^\d{1,2}$/.test(l));
  const starts = lines.map((l, i) => (fffDate(l) ? i : -1)).filter(i => i >= 0);
  const matches = [];
  let skipped = 0;
  starts.forEach((s, n) => {
    const block = lines.slice(s + 1, starts[n + 1] ?? lines.length);
    const when = fffDate(lines[s]);
    // Score, heure ou « - » : au plus 2 lignes de stade, la compétition et le domicile avant lui.
    const k = block.slice(0, 6).findIndex((l, i) => (/^\d{1,2}$/.test(l) && /^\d{1,2}$/.test(block[i + 1] || ''))
      || /^\d{1,2}:\d{2}$/.test(l) || l === '-');
    let comp, home, away, scores = null, next;
    if (k >= 2) {
      // La compétition : la ligne au-dessus du domicile, sinon la plus proche qui ressemble à une compétition.
      comp = FFF_COMP.test(block[k - 2]) ? k - 2 : block.slice(0, k - 1).findLastIndex(l => FFF_COMP.test(l));
      if (comp < 0) comp = k - 2;
      home = block[k - 1];
      if (/^\d{1,2}$/.test(block[k])) { scores = [Number(block[k]), Number(block[k + 1])]; next = k + 2; } else next = k + 1;
      away = block[next];
    } else if (k < 0) {
      comp = block.slice(0, 4).findIndex(l => /journ[ée]e|tour|poule|phase|plateau/i.test(l));
      home = block[comp + 1]; away = block[comp + 2]; next = comp + 2;
    } else comp = -1;
    if (!home || !away || comp < 0) { skipped++; return; }
    const full = block[comp];
    const round = full.match(FFF_ROUND);
    const status = FFF_STATUS.test(block[next + 1] || '') ? block[next + 1] : null;
    // Page d'un match collée : du texte s'intercale avant la compétition. Un stade tient en 120 caractères (matches_stade_len).
    const stade = block.slice(0, comp).join(' ');
    matches.push({
      date: when.date, heure: when.heure, stade: stade && stade.length <= 120 ? stade : null,
      competition: (round ? full.slice(0, round.index) : full).replace(/[\s\-–]+$/, ''), journee: round ? round[1] : null,
      home, away, score_home: scores ? scores[0] : null, score_away: scores ? scores[1] : null, statut: status,
    });
  });
  return { matches, skipped };
}

/* Saison sportive (juillet → juin) d'une date ISO. */
const fffSeason = (date) => { const [y, m] = date.split('-').map(Number); return m >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`; };
/* Clé d'une rencontre : la journée ou le tour la situent, pas la date (un
   report met à jour). Plateau d'animation (« POULE A ») : la même affiche
   revient plusieurs fois dans la saison, la date les distingue. */
const fffKey = (m) => [fffSeason(m.date), fffNorm(m.competition),
  /journ|tour/i.test(m.journee || '') ? fffNorm(m.journee) : m.date, fffNorm(m.home), fffNorm(m.away)].join('|');

/* Notre côté de chaque rencontre : 'home', 'away', null (à choisir : deux
   équipes du club) ou 'none' (le club n'y joue pas). Le nom du club décide ;
   s'il n'apparaît nulle part dans le texte, les règles du texte (secours). */
function fffOurSides(matches, club = '') {
  const known = fffWords(club).length > 0 && matches.some(m => fffIsClub(m.home, club) || fffIsClub(m.away, club));
  const old = known ? [] : fffOurSidesByText(matches);
  return matches.map((m, i) => {
    if (!known) return old[i];   // nom du club absent du texte : règles du texte, sans rien imposer de plus
    const h = fffIsClub(m.home, club), a = fffIsClub(m.away, club);
    if (h !== a) return h ? 'home' : 'away';
    return h ? null : 'none';   // deux équipes du club : à choisir ; aucune : pas notre rencontre
  });
}
/* Secours, sans le nom du club : 1. dans une compétition, le seul nom présent
   dans toutes ses rencontres ; 2. un nom déjà reconnu ailleurs dans le texte ;
   3. le côté qui commence comme nos noms quand l'autre non. */
function fffOurSidesByText(matches) {
  const groups = new Map();
  matches.forEach(m => { const g = groups.get(m.competition) || []; g.push(m); groups.set(m.competition, g); });
  const ours = new Set(), side = new Map();
  for (const g of groups.values()) {
    const everywhere = [g[0].home, g[0].away].filter(n => g.every(m => m.home === n || m.away === n));
    if (everywhere.length === 1) { ours.add(everywhere[0]); g.forEach(m => side.set(m, m.home === everywhere[0] ? 'home' : 'away')); }
  }
  const prefixes = new Set([...ours].map(n => fffNorm(n).split(' ').slice(0, 2).join(' ')));
  const isPrefixed = (n) => prefixes.has(fffNorm(n).split(' ').slice(0, 2).join(' '));
  return matches.map(m => {
    if (side.has(m)) return side.get(m);
    for (const test of [(n) => ours.has(n), isPrefixed]) {
      const h = test(m.home), a = test(m.away);
      if (h !== a) return h ? 'home' : 'away';
    }
    return null;
  });
}

/* Équipe du club pour une rencontre : celle dont le nom (« N2 », « U17 ») figure
   dans la compétition (« National 2 » compte pour « N2 »), si une seule ; sinon null. */
function fffGuessTeam(m, teams) {
  const comp = fffNorm(m.competition).replace(/\b(NATIONAL|REGIONAL|DISTRICT|LIGUE) (\d)\b/g, (x, w, n) => `${x} ${w[0]}${n}`);
  const words = new Set(comp.split(' '));
  const hits = (teams || []).filter(t => { const w = fffNorm(t.nom).split(' ').filter(Boolean); return w.length && w.every(x => words.has(x)); });
  return hits.length === 1 ? hits[0].id : null;
}

/* Champs d'un match de la plateforme, vus de notre côté. */
function fffIncoming(m, side) {
  const home = side === 'home';
  return {
    date_match: m.date, heure: m.heure, competition: m.competition, adversaire: home ? m.away : m.home,
    lieu: home ? 'domicile' : 'exterieur', stade: m.stade,
    score_pour: home ? m.score_home : m.score_away, score_contre: home ? m.score_away : m.score_home,
  };
}

const fffSame = (a, b) => String(a ?? '').slice(0, a && /^\d\d:\d\d/.test(a) ? 5 : undefined)
  === String(b ?? '').slice(0, b && /^\d\d:\d\d/.test(b) ? 5 : undefined);
/* Mise à jour d'un match déjà importé. Un champ prend la valeur de la FFF
   s'il est vide ou s'il vaut encore la dernière valeur importée. Modifié par
   le staff, il est gardé ; signalé (kept) seulement si la FFF l'a changé
   aussi. Une valeur absente côté FFF n'efface rien. */
function fffMerge(existing, incoming) {
  const prev = existing.ext_data || {}, patch = {}, changed = [], kept = [];
  for (const f of FFF_FIELDS) {
    const next = incoming[f], cur = existing[f];
    if (next == null || next === '' || fffSame(cur, next)) continue;
    if (cur == null || cur === '' || fffSame(cur, prev[f])) { patch[f] = next; changed.push(f); } else if (!fffSame(next, prev[f])) kept.push(f);
  }
  return { patch, changed, kept };
}
