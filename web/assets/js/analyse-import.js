/* ============================================================
   LMFC Performance — analyse-import.js
   Import d'un export XML de Sportscode (Hudl) : lecture et plan, sans écran
   (la fenêtre est dans analyse-import-ui.js ; tests/sportscode-import.test.mjs).
     - le fichier est lu dans le navigateur, rien n'est envoyé (DOMParser) ;
       chaque <instance> : début, fin (secondes de la vidéo), code, libellés ;
     - un joueur par ligne : le code (« Tigane BRENNER », « 10 BRENNER ») ou un
       libellé qui nomme un joueur du club le relie à sa fiche ; nom complet
       d'abord, nom seul s'il n'y a qu'un joueur de ce nom ; une ligne qui ne
       nomme personne reste à relier à la main ;
     - l'action d'une instance : son code, ou, si le code est le joueur, son
       premier autre libellé (sinon « Capsule ») ; chaque action reçoit une
       action de l'Analyse (Passe, Tir…) ou reste « À coder » ;
     - les libellés qui nomment une valeur (« Réussie », « Pied droit »,
       « 1re mi-temps ») la remplissent ; les autres deviennent des tags.
   ============================================================ */

const scNorm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SC_RES = { ok: ['reussi', 'reussie', 'reussite', 'gagne', 'gagnee', 'success', 'successful', 'won', 'win', 'complete'],
  ko: ['rate', 'ratee', 'manque', 'manquee', 'perdu', 'perdue', 'echec', 'fail', 'failed', 'unsuccessful', 'lost', 'incomplete'] };
/* Code Sportscode → action de l'Analyse, quand rien n'a été choisi (l'ordre compte : duel aérien avant duel). */
const SC_GUESS = [['duel_air', /duel aer|aerien|aerial|jeu de tete|header/], ['duel_sol', /\bduel|\b1c1\b|\b1v1\b|tackle|tacle/],
  ['recuperation', /recup|recovery|interception|ballon gagne|regain/], ['centre', /\bcentre|\bcross/], ['tir', /\btirs?\b|shot|shoot|frappe/],
  ['passe', /\bpasse|\bpass/]];
const scGuess = (type) => SC_GUESS.find(([, re]) => re.test(scNorm(type)))?.[0] || '';

/* ---------- Lecture (navigateur) ---------- */
function scRead(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Ce fichier n’est pas un XML lisible.');
  const txt = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent.trim() ?? '';
  const list = [...doc.getElementsByTagName('instance')].map(el => ({
    start: Number(txt(el, 'start')), end: Number(txt(el, 'end')), code: txt(el, 'code'),
    labels: [...el.getElementsByTagName('label')].map(l => ({ group: txt(l, 'group'), text: txt(l, 'text') })).filter(l => l.text),
  })).filter(x => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start && x.code);
  if (!list.length) throw new Error('Aucune action (<instance>) dans ce fichier : est-ce bien un export XML de Sportscode ?');
  return list;
}

/* ---------- Joueurs ---------- */
/* Nom complet : « tigane brenner », « brenner tigane », « t brenner ». */
const scFull = (p) => { const pr = scNorm(p.prenom), no = scNorm(p.nom); return pr && no ? [`${pr} ${no}`, `${no} ${pr}`, `${pr[0]} ${no}`] : []; };
const scHas = (t, n) => !!n && (t === n || t.startsWith(`${n} `) || t.endsWith(` ${n}`));
/* Le joueur que nomme ce texte (« 10 BRENNER » : le numéro du maillot) ; deux joueurs possibles : personne. */
function scWho(text, players) {
  const t = scNorm(text).replace(/^\d+ /, '');
  if (!t) return null;
  const full = players.filter(p => scFull(p).some(n => scHas(t, n)));
  if (full.length) return full.length === 1 ? full[0] : null;
  const nom = players.filter(p => scNorm(p.nom).length >= 4 && scHas(t, scNorm(p.nom)));
  return nom.length === 1 ? nom[0] : null;
}

/* Une ligne par joueur reconnu (ou par code qui ne nomme personne) :
   { total, rows: [{ key, name, player_id, items: [{ start, end, type, labels }] }] }, les joueurs reconnus d'abord. */
function scPlan(list, players) {
  const seen = new Map(), who = (t) => { if (!seen.has(t)) seen.set(t, scWho(t, players)); return seen.get(t); };
  const rows = new Map();
  for (const x of list) {
    const byCode = who(x.code), byLabel = byCode ? null : x.labels.find(l => who(l.text));
    const p = byCode || (byLabel && who(byLabel.text)), key = p ? `p${p.id}` : `c:${x.code}`;
    const rest = x.labels.map(l => l.text).filter(t => !who(t));
    const type = byCode ? rest[0] || 'Capsule' : x.code;
    if (!rows.has(key)) rows.set(key, { key, name: byCode ? x.code : byLabel ? byLabel.text : x.code, player_id: p ? p.id : null, items: [] });
    rows.get(key).items.push({ start: x.start, end: x.end, type, labels: rest.filter(t => t !== type) });
  }
  return { total: list.length, rows: [...rows.values()].sort((a, b) => (b.player_id != null) - (a.player_id != null) || b.items.length - a.items.length) };
}

/* Actions des lignes reliées à un joueur : [[type, nombre]], la plus fréquente d'abord. */
function scTypes(plan, assign) {
  const n = new Map();
  plan.rows.filter(r => assign[r.key]).forEach(r => r.items.forEach(it => n.set(it.type, (n.get(it.type) || 0) + 1)));
  return [...n].sort((a, b) => b[1] - a[1]);
}

/* ---------- Codage ---------- */
/* Un libellé qui nomme une valeur d'un champ de l'action (ou du contexte) : [champ, valeur], sinon null. */
function scValue(rows, text, draft) {
  const t = scNorm(text);
  for (const d of rows) {
    if (draft[d.key] != null) continue;
    // « Réussie », « droit », ou en fin de libellé : « Pied droit », « Passe courte » (4 lettres au moins).
    let v = d.values.find(([val, l]) => [scNorm(l), t.length >= 3 && scNorm(val)].some(x => x && (x === t || (x.length >= 4 && t.endsWith(` ${x}`)))))?.[0];
    if (v == null && d.key === 'resultat') v = Object.keys(SC_RES).find(k => SC_RES[k].includes(t) && d.values.some(([val]) => val === k));
    if (v != null) return [d.key, AN_NUM.includes(d.key) ? Number(v) : d.key === 'pression' ? v === 'true' : v];
  }
  return null;
}

/* Codage d'une action importée : l'action choisie, les valeurs reconnues, le reste en tags. */
function scDraft(item, action, off = 0) {
  const A = AN_ACTIONS[action], r = (x) => Math.round(Math.max(0, x + off) * 100) / 100;
  const d = { start_sec: r(item.start), end_sec: r(item.end), action: A ? action : null, tags: [] };
  const rows = [...(A ? [...A.filters, ...(A.more || [])] : []), ...AN_CODE_COMMON];
  for (const text of item.labels) {
    const hit = scValue(rows, text, d);
    if (hit) d[hit[0]] = hit[1];
    else if (!d.tags.includes(text)) d.tags.push(text.slice(0, 60));
  }
  if (!A && !d.tags.includes(item.type)) d.tags.unshift(item.type.slice(0, 60));   // à coder : l'action reste trouvable dans les tags
  return d;
}

/* Séquences d'un joueur à créer : actions cochées, sans ce qui est déjà sur sa vidéo (même début et fin, à 0,5 s)
   ni ce qui commence après la fin de la vidéo. picks : { type: { action, on } }. */
function scDrafts(items, picks, clips, { off = 0, dur = 0 } = {}) {
  const out = [], have = [...clips];
  let skipped = 0, beyond = 0;
  for (const it of items) {
    if (!picks[it.type]?.on) continue;
    const d = scDraft(it, picks[it.type].action, off);
    if (dur > 0) d.end_sec = Math.min(d.end_sec, Math.round(dur * 100) / 100);
    if ((dur > 0 && d.start_sec >= dur) || d.end_sec - d.start_sec < 0.5) { beyond++; continue; }
    if (have.some(c => Math.abs(c.start_sec - d.start_sec) < 0.5 && Math.abs(c.end_sec - d.end_sec) < 0.5)) { skipped++; continue; }
    have.push(d);
    out.push({ label: it.type.slice(0, 60), draft: d });
  }
  return { out: out.sort((a, b) => a.draft.start_sec - b.draft.start_sec), skipped, beyond };
}
