/* ============================================================
   LMFC Performance — match-sheet.js
   Feuille de match collée depuis epreuves.fff.fr (page « Le match »
   d'une rencontre jouée : tout sélectionner, copier, coller). Pur,
   testé : tests/match-sheet.test.mjs. Pour l'équipe du club :
     - en-tête (fffParse) : date, heure, compétition, score ;
     - COMPOSITION : titulaires et remplaçants (numéro, nom) ;
     - RÉSUMÉ : changements (« X remplace Y »), avertissements,
       exclusions, buts (« inscrit par ») et leur minute.
   msMatch rapproche chaque nom des fiches du club : nom complet
   (seniors) ou « PRÉNOM N. » (jeunes) ; reconnu, à confirmer, à
   choisir, non reconnu ; l'équipe du match d'abord.
   Rien n'est inventé : une donnée absente de la feuille reste vide
   (buts des jeunes, minutes sans durée de match, changements multiples).
   Dépend de fff-import.js (fffParse, fffOurSides, fffIsClub, fffNorm).
   ============================================================ */

const MS_STOP = /^(LIEU DE LA RENCONTRE|OFFICIELS|D[ÉE]TAIL DE L.INSTALLATION|LA F[ÉE]D[ÉE]RATION)$/i;
const MS_NUM = /^\d{1,3}$/;

function msParse(text, club) {
  const lines = String(text ?? '').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const head = fffParse(text).matches[0] || null;
  const side = head ? fffOurSides([head], club)[0] : null;
  // COMPOSITION : « ÉQUIPE / TITULAIRES / n° / nom … / REMPLAÇANTS / n° / nom … », équipe après équipe.
  const teams = [], c = lines.findIndex(l => /^COMPOSITION$/i.test(l));
  for (let i = c + 1, cur = null, role = null; c >= 0 && i < lines.length && !MS_STOP.test(lines[i]); i++) {
    const l = lines[i];
    if (/^TITULAIRES$/i.test(lines[i + 1] || '') && !MS_NUM.test(l)) { cur = { name: l, players: [] }; teams.push(cur); role = null; continue; }
    if (/^TITULAIRES$/i.test(l)) { role = 'titulaire'; continue; }
    if (/^REMPLA[ÇC]ANTS$/i.test(l)) { role = 'remplacant'; continue; }
    if (cur && role && MS_NUM.test(l) && lines[i + 1] && !MS_NUM.test(lines[i + 1])) cur.players.push({ numero: Number(l), name: lines[++i], role });
  }
  const ours = teams.filter(t => fffIsClub(t.name, club));
  const team = ours.length === 1 ? ours[0] : null;   // aucune ou deux équipes du club : rien n'est attribué
  // RÉSUMÉ : « 48’ / But pour LE MANS FC / inscrit par / NOM », « Changement pour … / X / remplace / Y »…
  const r0 = lines.findIndex(l => /^R[ÉE]SUM[ÉE]$/i.test(l)), r1 = c >= 0 ? c : lines.length, events = [];
  for (let i = r0 + 1, minute = null; r0 >= 0 && i < r1; i++) {
    const l = lines[i], m = /^(\d{1,3})(?:\s*\+\s*\d{1,2})?\s*['’]$/.exec(l);
    if (m) { minute = Number(m[1]); continue; }
    const t = /^(Changement|Avertissement|Exclusion|But) pour (.+)$/i.exec(l);
    if (!t) continue;
    const kind = t[1].toLowerCase(), ev = { kind, team: t[2], minute };
    if (kind === 'changement') { ev.in = lines[i + 1]; ev.out = /^remplace$/i.test(lines[i + 2] || '') ? lines[i + 3] : null; i += ev.out ? 3 : 1; }
    else if (kind === 'but') { let j = i + 1; while (j < r1 && /^(inscrit par|sur penalty|penalty|c\.?s\.?c\.?|contre son camp)$/i.test(lines[j])) j++; ev.name = lines[j]; i = j; }
    else { ev.name = lines[i + 1]; i += 1; }
    if (team && fffNorm(ev.team) === fffNorm(team.name)) events.push(ev);
  }
  const pour = head && (side === 'home' ? head.score_home : side === 'away' ? head.score_away : null);
  const goals = events.filter(e => e.kind === 'but');
  const goalsKnown = goals.length > 0 && pour !== null && goals.length === pour;   // tous les buts du club sont nommés
  const players = (team?.players || []).map(p => {
    const ins = events.filter(e => e.kind === 'changement' && e.in === p.name), outs = events.filter(e => e.kind === 'changement' && e.out === p.name);
    const statut = p.role === 'titulaire' ? 'titulaire' : ins.length ? 'remplacant' : 'non_entre';
    const buts = goals.filter(e => e.name === p.name).length;
    return { ...p, statut, entre: ins[0]?.minute ?? null, sorti: outs[0]?.minute ?? null, multiple: ins.length + outs.length > (statut === 'remplacant' ? 2 : 1),
      buts: buts || (goalsKnown || pour === 0 ? 0 : null),
      cartons_jaunes: r0 >= 0 ? events.filter(e => e.kind === 'avertissement' && e.name === p.name).length : null,
      carton_rouge: r0 >= 0 ? events.some(e => e.kind === 'exclusion' && e.name === p.name) : null };
  });
  return { head, side, team: team?.name || null, teams: teams.map(t => t.name), resume: r0 >= 0, goalsKnown, players };
}

/* Minutes jouées, seulement avec la durée du match ; changements multiples (jeunes) : à saisir. */
function msMinutes(p, duration) {
  if (!duration || p.multiple) return null;
  if (p.statut === 'non_entre') return 0;
  const start = p.statut === 'titulaire' ? 0 : p.entre;
  return start === null || start === undefined ? null : Math.max(0, Math.min(duration, p.sorti ?? duration) - start);
}

/* Lien d'un nom de la feuille avec une fiche : 'exact' (prénom et nom), 'initiale' (« YANIS D. »), 'nom' (nom seul). */
function msLink(name, p) {
  const w = fffNorm(name).split(' ').filter(Boolean), nom = fffNorm(p.nom).split(' ').filter(Boolean), pre = fffNorm(p.prenom).split(' ').filter(Boolean);
  const has = (list) => list.length > 0 && list.every(x => w.includes(x));
  if (!nom.length) return null;
  if (has(nom)) return has(pre) ? 'exact' : pre.length ? null : 'nom';
  const last = w.at(-1);
  return w.length >= 2 && last.length === 1 && has(pre) && nom[0].startsWith(last) ? 'initiale' : null;
}

/* Statuts : 'ok' (un seul, nom complet), 'confirm' (un seul, initiale ou nom seul), 'choose' (plusieurs), 'none'.
   Une fiche visée par deux noms n'est donnée à aucun : à choisir. */
function msMatch(names, roster, teamId) {
  const inTeam = (p) => !!teamId && (p.team_id === teamId || (p.other_team_ids || []).includes(teamId));
  const out = names.map(name => {
    let c = roster.map(p => ({ p, link: msLink(name, p) })).filter(x => x.link);
    if (c.some(x => inTeam(x.p))) c = c.filter(x => inTeam(x.p));
    const exact = c.filter(x => x.link === 'exact');
    if (exact.length === 1) return { name, status: 'ok', player: exact[0].p, candidates: c.map(x => x.p) };
    if (c.length === 1) return { name, status: 'confirm', player: c[0].p, candidates: [c[0].p] };
    return { name, status: c.length ? 'choose' : 'none', player: null, candidates: c.map(x => x.p) };
  });
  const claims = new Map();
  out.filter(r => r.player).forEach(r => claims.set(r.player.id, [...(claims.get(r.player.id) || []), r]));
  for (const list of claims.values()) if (list.length > 1) list.forEach(r => Object.assign(r, { status: 'choose', player: null }));
  return out;
}
