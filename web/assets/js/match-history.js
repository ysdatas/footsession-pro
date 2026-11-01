/* ============================================================
   LMFC Performance — match-history.js
   Statistiques de match d'un effectif et historique d'un joueur, à
   partir de ce qui est saisi ou importé dans match_players (lmfc_v11,
   cartons : lmfc_v33). Rien n'est déduit : une valeur jamais saisie
   reste « — », pas 0.
     - matchSquad(rows) : une ligne par joueur (pur : tests/match-history.test.mjs) ;
     - mhSquadHtml / mhHistoryHtml : le tableau de l'effectif (Retours de
       match → Effectif) et l'historique d'un joueur (même page, et
       onglet « Matchs » de la fiche, staff seulement) ;
     - mountPlayerMatches : l'onglet de la fiche.
   La base décide de ce qui est lu : un compte joueur ne lit aucun match
   (team_level = « aucun », lmfc_v19 / v22 ; tests/rights-sql).
     - mhCompetitions / mhDuplicates : regrouper les matchs par compétition,
       repérer ceux saisis deux fois (purs, testés).
   Dépend de app.js (escapeHtml, playerFullName, fmtDateFr) et de
   procedure-time.js (BILAN_NOTES) dans les pages.
   ============================================================ */

const STATUTS_MATCH = [['titulaire', 'Titulaire'], ['remplacant', 'Remplaçant'], ['non_entre', 'Non entré']];
const STATUT_MATCH_LABEL = Object.fromEntries(STATUTS_MATCH);
const LIEUX = { domicile: 'Domicile', exterieur: 'Extérieur', neutre: 'Terrain neutre' };
const RESULTATS = { v: 'Victoire', n: 'Nul', d: 'Défaite' };

const resultOf = (m) => (m.score_pour == null || m.score_contre == null ? null
  : m.score_pour > m.score_contre ? 'v' : m.score_pour < m.score_contre ? 'd' : 'n');

/* Une ligne par joueur. Joué = titulaire, remplaçant entré, ou des minutes sans statut. */
function matchSquad(rows) {
  const by = new Map();
  rows.forEach(r => { if (!by.has(r.player_id)) by.set(r.player_id, []); by.get(r.player_id).push(r); });
  const known = (list, k) => list.filter(r => r[k] !== null && r[k] !== undefined);
  const sum = (list, k) => { const v = known(list, k); return v.length ? v.reduce((s, r) => s + Number(r[k]), 0) : null; };
  return [...by].map(([player_id, list]) => {
    const played = list.filter(r => r.statut === 'titulaire' || r.statut === 'remplacant' || (!r.statut && Number(r.minutes) > 0));
    const timed = known(played, 'minutes'), min = sum(played, 'minutes');
    const cards = known(list, 'cartons_jaunes').length || known(list, 'carton_rouge').length;
    return {
      player_id, conv: list.length, played: played.length,
      tit: list.filter(r => r.statut === 'titulaire').length,
      min, perMatch: timed.length ? min / timed.length : null,
      buts: sum(list, 'buts'), passes: sum(list, 'passes'),
      jaunes: cards ? sum(list, 'cartons_jaunes') ?? 0 : null,
      rouges: cards ? list.filter(r => r.carton_rouge).length : null,
      notes: ['plus', 'egal', 'moins'].map(k => list.filter(r => r.note === k).length),
    };
  });
}

/* ---------- Compétitions et doublons ----------
   Une compétition se reconnaît à sa clé, pas à son libellé exact :
   « COUPE GAMBARDELLA CRÉDIT AGRICOLE - U19 - U18 4ème tour » et
   « coupe gambardella » → « coupe gambardella ». Un nom qui ne ressemble
   pas à une compétition (nom d'équipe lu par erreur à l'import :
   « LE MANS FC ») → '' : « Compétition non renseignée ». */
const MH_STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'd', 'l', 'et', 'en']);
const mhWords = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(w => w && !MH_STOP.has(w));
const MH_COMP = /journ[ée]e|tour|poule|phase|plateau|senior|\bu\d{2}\b|r[ée]gional|national|district|coupe|championnat|crit[ée]rium|amica|f[ée]minin|futsal|ligue|\b[ldnr]\d\b/i;   // = FFF_COMP (fff-import.js)
function mhCompKey(name) {
  const head = String(name || '').split(/\s[-–]\s/)[0];
  return MH_COMP.test(String(name || '')) ? mhWords(head).slice(0, 2).join(' ') : '';
}
/* Libellé tout en capitales ou tout en minuscules (FFF, saisie rapide) → « Coupe Gambardella » ; U19, N2 gardés. */
const mhTitle = (s) => (s === s.toUpperCase() || s === s.toLowerCase()
  ? s.split(' ').map(w => (/\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' ') : s);
/* Compétitions des matchs : clé, libellé le plus fréquent (à égalité le plus complet), nombre ; « non renseignée » en dernier. */
function mhCompetitions(list) {
  const by = new Map();
  list.forEach(m => {
    const key = mhCompKey(m.competition), head = String(m.competition || '').split(/\s[-–]\s/)[0].trim();
    const g = by.get(key) || by.set(key, { key, n: 0, labels: new Map() }).get(key);
    g.n += 1;
    if (key) g.labels.set(head, (g.labels.get(head) || 0) + 1);
  });
  return [...by.values()].map(g => ({ key: g.key, n: g.n,
    label: g.key ? mhTitle([...g.labels].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0]) : 'Compétition non renseignée' }))
    .sort((a, b) => (!a.key) - (!b.key) || b.n - a.n || a.label.localeCompare(b.label, 'fr'));
}
/* Doublons possibles : même date et même adversaire (premier mot distinctif : « BOUCHEMAINE ES » = « bouchemaine »),
   quelle que soit l'équipe (un match saisi à la main puis importé de la FFF). id → les autres matchs du groupe. */
const MH_CLUB_WORDS = new Set(['fc', 'as', 'us', 'es', 'sc', 'ac', 'af', 'aj', 'cs', 'js', 'st', 'sco', 'ofc', 'ussa', 'usja', 'stade', 'union', 'olympique', 'sporting', 'racing', 'entente', 'club', 'football']);
const mhOppKey = (s) => mhWords(s).find(w => w.length > 2 && !MH_CLUB_WORDS.has(w)) || mhWords(s)[0] || '';
function mhDuplicates(list) {
  const by = new Map(), out = new Map();
  list.forEach(m => { const k = `${m.date_match}|${mhOppKey(m.adversaire)}`; by.set(k, [...(by.get(k) || []), m]); });
  by.forEach(group => { if (group.length > 1) group.forEach(m => out.set(m.id, group.filter(x => x !== m))); });
  return out;
}

/* ---------- Rendu ---------- */
const mhVal = (v, d = 0) => (v === null || v === undefined ? '—' : (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('fr-FR'));
const scoreHtml = (m) => {
  const r = resultOf(m);
  return r ? `<span class="mt-res mt-${r}" title="${RESULTATS[r]}">${m.score_pour} – ${m.score_contre}</span>` : '<span class="mt-res">—</span>';
};
const noteHtml = (k) => {
  const n = BILAN_NOTES.find(x => x.key === k);
  return n ? `<span class="mt-note mt-note-${k}" title="${n.label}">${n.sign}</span>` : '';
};
const mhCards = (r) => `${r.cartons_jaunes ? `<span class="mh-card is-y" title="Carton jaune" aria-label="${r.cartons_jaunes} carton${r.cartons_jaunes > 1 ? 's' : ''} jaune${r.cartons_jaunes > 1 ? 's' : ''}">${r.cartons_jaunes > 1 ? '×2' : ''}</span>` : ''}${r.carton_rouge ? '<span class="mh-card is-r" title="Carton rouge" aria-label="Carton rouge"></span>' : ''}`;

const MH_COLS = [['played', 'MJ', 'Matchs joués'], ['tit', 'Tit.', 'Titularisations'], ['min', 'Min.', 'Minutes jouées'], ['perMatch', 'Min/m', 'Minutes par match joué'],
  ['buts', 'Buts', 'Buts'], ['passes', 'Passes', 'Passes décisives'], ['jaunes', 'J', 'Cartons jaunes'], ['rouges', 'R', 'Cartons rouges'], ['conv', 'Conv.', 'Feuilles de match']];

/* Tableau de l'effectif : players = fiches à afficher (celles sans match comprises), sort = clé de tri. */
function mhSquadHtml(players, stats, sort = 'played') {
  const byId = new Map(stats.map(s => [s.player_id, s]));
  const list = players.map(p => ({ p, s: byId.get(p.id) || { conv: 0, played: 0, tit: 0, min: null, perMatch: null, buts: null, passes: null, jaunes: null, rouges: null, notes: [0, 0, 0] } }))
    .sort((a, b) => (sort === 'name' ? playerFullName(a.p).localeCompare(playerFullName(b.p), 'fr')
      : (b.s[sort] ?? -1) - (a.s[sort] ?? -1) || b.s.played - a.s.played || (b.s.min ?? 0) - (a.s.min ?? 0)));
  const th = (k, l, title) => `<th scope="col"${k === 'name' ? '' : ' class="num"'} aria-sort="${sort === k ? 'descending' : 'none'}"><button type="button" data-mh-sort="${k}" title="Trier : ${title}">${l}</button></th>`;
  return `<div class="mh-wrap"><table class="table mh-table">
    <thead><tr>${th('name', 'Joueur', 'nom')}${MH_COLS.map(([k, l, t]) => th(k, l, t)).join('')}<th scope="col" class="num" title="Appréciation du staff : + / = / −">+ / = / −</th></tr></thead>
    <tbody>${list.map(({ p, s }) => `<tr class="${s.conv ? '' : 'is-off'}">
      <th scope="row"><button type="button" class="mh-name" data-mh-player="${p.id}">${escapeHtml(playerFullName(p))}${p.poste ? `<small>${escapeHtml(p.poste)}</small>` : ''}</button></th>
      ${MH_COLS.map(([k]) => `<td class="num">${mhVal(s[k])}</td>`).join('')}
      <td class="num mh-notes">${s.notes.some(Boolean) ? s.notes.join(' / ') : '—'}</td></tr>`).join('')}</tbody>
  </table></div>
  <p class="mh-legend">MJ : matchs joués (titulaire ou entré en jeu) · Conv. : feuilles de match · — : jamais saisi. Cliquez sur un joueur pour son historique.</p>`;
}

/* Historique d'un joueur : rows = ses lignes avec leur match (rows[i].matches), du plus récent au plus ancien.
   link : liens vers matchs.html (fiche joueur) au lieu d'ouvrir la fenêtre du match. */
function mhHistoryHtml(rows, { link = false } = {}) {
  if (!rows.length) return '<div class="empty">Aucun match pour ce joueur.</div>';
  const s = matchSquad(rows)[0];
  const stats = [['Matchs joués', s.played], ['Titularisations', s.tit], ['Minutes', mhVal(s.min)], ['Buts', mhVal(s.buts)], ['Passes', mhVal(s.passes)],
    ['Cartons J / R', s.jaunes === null ? '—' : `${s.jaunes} / ${s.rouges}`], ['+ / = / −', s.notes.join(' / ')]];
  return `<div class="mt-stats">${stats.map(([l, v]) => `<div class="mt-stat"><strong>${v}</strong><span>${l}</span></div>`).join('')}</div>
    <div class="mt-list">${rows.map(r => {
      const m = r.matches, tag = link ? 'a' : 'button';
      const line = [STATUT_MATCH_LABEL[r.statut], r.minutes != null ? `${r.minutes}'` : '',
        r.buts ? `${r.buts} but${r.buts > 1 ? 's' : ''}` : '', r.passes ? `${r.passes} passe${r.passes > 1 ? 's' : ''} déc.` : ''].filter(Boolean).join(' · ');
      return `<${tag} ${link ? `href="matchs.html?id=${m.id}"` : `type="button" data-open-match="${m.id}"`} class="mt-row mt-hist">
        <span class="mt-date">${fmtDateFr(m.date_match)}</span>
        <span class="mt-main"><strong>${escapeHtml(m.adversaire)}</strong>
          <small>${[m.competition, LIEUX[m.lieu]].filter(Boolean).map(escapeHtml).join(' · ') || '&nbsp;'}</small>
          <small class="mh-line">${escapeHtml(line || 'Statut non saisi')} ${mhCards(r)}</small>
          ${r.commentaire ? `<em class="mt-comment">${escapeHtml(r.commentaire)}</em>` : ''}</span>
        ${noteHtml(r.note) || '<span></span>'}
        ${scoreHtml(m)}
      </${tag}>`;
    }).join('')}</div>`;
}

const MH_MATCH_COLS = 'id, adversaire, date_match, competition, lieu, score_pour, score_contre';
async function loadPlayerMatchRows(playerId) {
  const { data, error } = await sb.from('match_players').select(`*, matches(${MH_MATCH_COLS})`).eq('player_id', playerId);
  if (error) throw error;
  return (data || []).filter(r => r.matches).sort((a, b) => String(b.matches.date_match).localeCompare(String(a.matches.date_match)));
}

/* Onglet « Matchs » de la fiche (staff). */
async function mountPlayerMatches(box, player) {
  box.innerHTML = '<p class="text-muted">Chargement…</p>';
  try {
    box.innerHTML = `<div class="section-head"><div><h2>Matchs</h2><p class="text-muted">Saisis dans Retours de match, réservés au staff.</p></div>
      <a class="btn btn-sm" href="matchs.html">Retours de match</a></div>${mhHistoryHtml(await loadPlayerMatchRows(player.id), { link: true })}`;
  } catch (e) {
    console.error('Matchs du joueur illisibles', e);
    box.innerHTML = `<div class="empty text-danger">${escapeHtml(e.message || String(e))}</div>`;
  }
}
