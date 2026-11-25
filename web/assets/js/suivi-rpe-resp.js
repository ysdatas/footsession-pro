/* ============================================================
   LMFC Performance — suivi-rpe-resp.js (suivi-rpe)
   Vue « Réponses » : un bloc par jour (lundi, mardi…, dans l'ordre), et dans
   chaque jour une tuile par séance ou match, de la plus tôt à la plus tard,
   l'heure en gros (la plus récente choisie) ; une tuile touchée montre
   aussitôt, en dessous, ce que chaque joueur concerné a répondu :
     - le RPE (session_rpe, match_rpe : déjà lus par suivi-rpe-page.js) ;
     - l'avis de match (match_feedback, lmfc_v36.sql) ;
     - les questions ajoutées dans Formulaires (custom_form_responses,
       occurrence « s12 » pour une séance, « m12 » pour un match, lmfc_v47.sql).
   Lecture seule : la RLS ne montre que les équipes du compte. Les intitulés
   des questions ajoutées sont ceux de la version à laquelle le joueur a répondu.
   Tableau joueurs × questions : en-têtes et joueur (photo, nom) restent visibles
   en défilant ; colonnes élargissables ; une réponse longue s'ouvre au clic.
   « — » : pas de réponse au questionnaire ; « · » : questionnaire rempli, question
   laissée vide. Les valeurs sont celles enregistrées, jamais recalculées.
   Tri et filtre (sur l'appareil, sans relire la base) : un clic sur un en-tête trie
   la colonne (les réponses d'abord, puis en attente, sans réponse, ailleurs, abs.,
   chacun regroupé) ; les pastilles n'affichent qu'un statut du RPE.
   ============================================================ */

const SR_AVIS = [['individuel', 'Sa performance'], ['collectif', 'L’équipe']];   // comme match-feedback.js
const srOcc = (s) => (s.match ? `m${s.id}` : `s${s.id}`);
/* Statut du RPE d'un joueur : [clé, ordre de tri après les valeurs, libellé de la pastille]. */
const SR_STATUS = { ok: [0, 'Ont répondu'], wait: [1, 'En attente'], none: [2, 'Sans réponse'], away: [3, 'Autre équipe'], abs: [4, 'Absents'] };
const srStatus = (c) => (c?.v ? 'ok' : c === 'abs' ? 'abs' : c === 'away' ? 'away' : c === 'wait' ? 'wait' : 'none');
const srInitials = (p) => `${(p.prenom || '')[0] || ''}${(p.nom || '')[0] || ''}`.toUpperCase() || '?';

/* Avis et questions ajoutées des séances ou matchs affichés. Sans la migration, la vue montre le reste. */
async function loadSrResp() {
  const occ = SR.sessions.map(srOcc), matchIds = SR.sessions.filter(s => s.match).map(s => s.id);
  const [fb, cf, photos] = await Promise.all([
    matchIds.length ? sb.from('match_feedback').select('match_id, player_id, individuel, collectif').in('match_id', matchIds) : { data: [] },
    occ.length ? sb.from('custom_form_responses').select('form_id, form_title_snapshot, player_id, occurrence, questions_snapshot, answers').in('occurrence', occ) : { data: [] },
    signedUrls('player-photos', SR.players.map(p => p.photo_path)).catch(() => new Map()),   // liens gardés 23 h (app.js)
  ]);
  if (fb.error) console.warn('Suivi RPE : avis de match illisibles', fb.error);
  if (cf.error) console.warn('Suivi RPE : questions ajoutées illisibles', cf.error);
  return { fb: fb.data || [], cf: cf.data || [], photos };
}

async function renderSrResp(body) {
  if (!SR.resp) {
    const key = srCacheKey(), seq = SR.seq;
    body.classList.add('is-loading');
    const resp = await loadSrResp();
    if (seq !== SR.seq) return;   // une autre équipe ou période a été choisie entre-temps
    SR.resp = resp;
    const hit = SR.cache.get(key);
    if (hit) hit.resp = resp;
    body.classList.remove('is-loading');
    if (SR.view !== 'resp') return;
  }
  // Un bloc par jour, dans l'ordre du calendrier (lundi, mardi…), ses séances côte à côte de la plus tôt à la plus tard
  // (SR.sessions est déjà rangé par date et heure) ; la plus récente est choisie tant qu'aucune autre ne l'est.
  const list = SR.sessions.map((s, j) => ({ s, j, ...srRespCount(j) }));
  const sel = list.find(x => x.s.key === SR.respSel) || list.at(-1);
  SR.respSel = sel.s.key;
  const days = [...new Set(list.map(x => x.s.date_seance))];
  swapKeepView(body, `<div class="sr-days" role="group" aria-label="${SR.scope === 'match' ? 'Matchs' : 'Séances'} par jour">${days.map(d => {
    const day = list.filter(x => x.s.date_seance === d);
    return `<div class="sr-day" style="--n:${day.length}"><p class="sr-day-h">${escapeHtml(srDayName(d))} <b>${d.slice(8, 10)}/${d.slice(5, 7)}</b>${day.length > 1 ? `<small>${day.length} ${SR.scope === 'match' ? 'matchs' : 'séances'}</small>` : ''}</p>
      <div class="sr-day-list">${day.map(x => srRespTile(x, x === sel)).join('')}</div></div>`;
  }).join('')}</div>
    ${srRespCard(sel.s, sel.j)}`);
}

/* Joueurs attendus (sans « autre équipe ») et réponses d'une colonne de la grille. */
function srRespCount(j) {
  const col = SR.cells.map(row => row[j]).filter(c => c !== null && c !== 'away');
  return { done: col.filter(c => c?.v).length, total: col.length };
}

const srDayName = (iso) => { const t = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(new Date(`${iso}T12:00`)); return t[0].toUpperCase() + t.slice(1); };

function srRespTile({ s, done, total }, on) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<button type="button" class="sr-tile${s.match ? ' is-match' : ''}" data-sr-tile="${escapeHtml(String(s.key))}" aria-pressed="${on}">
    <span class="sr-tile-when">${s.heure ? escapeHtml(s.heure.slice(0, 5).replace(':', 'h')) : 'Sans heure'}</span>
    <span class="sr-tile-title">${escapeHtml(s.adversaire ? `Match – ${s.adversaire}` : s.titre || 'Séance')}</span>
    <span class="sr-tile-n"><b>${done}</b> / ${total} RPE</span>
    <span class="sr-tile-bar" aria-hidden="true"><i style="width:${pct}%"></i></span></button>`;
}

/* Le joueur : photo (ou initiales) et nom, lien vers toutes ses réponses. */
function srRespWho(p) {
  const url = SR.resp.photos?.get(p.photo_path);
  const face = url ? `<img class="sr-resp-face" src="${escapeHtml(url)}" alt="" loading="lazy" width="28" height="28">`
    : `<span class="sr-resp-face" aria-hidden="true">${escapeHtml(srInitials(p))}</span>`;
  return `<a class="sr-resp-who" href="suivi-rpe?vue=historique&joueur=${Number(p.id)}&team=${Number(SR.team) || ''}" title="Toutes les réponses de ${escapeHtml(playerFullName(p))}">${face}<span>${escapeHtml(playerFullName(p))}</span></a>`;
}

/* Une séance ou un match : un tableau joueurs × questions. */
function srRespCard(s, j) {
  const occ = srOcc(s), extra = SR.resp.cf.filter(r => r.occurrence === occ);
  const fb = new Map(SR.resp.fb.filter(x => x.match_id === s.id && s.match).map(x => [x.player_id, x]));
  // Questions ajoutées : celles des formulaires répondus, dans leur ordre, sans doublon.
  const qs = [], seen = new Set(), titles = new Set();
  extra.forEach(r => {
    titles.add(r.form_title_snapshot);
    (r.questions_snapshot || []).forEach(q => { if (!q.fixe && !seen.has(`${r.form_id}:${q.id}`)) { seen.add(`${r.form_id}:${q.id}`); qs.push({ form: r.form_id, q }); } });
  });
  const rows = SR.players.map((p, i) => ({ p, c: SR.cells[i][j] })).filter(x => x.c !== null);
  const head = [{ label: 'RPE' }, ...(s.match ? SR_AVIS.map(([, l]) => ({ label: l })) : []), ...qs.map(x => x.q)];
  const counts = rows.reduce((m, { c }) => m.set(srStatus(c), (m.get(srStatus(c)) || 0) + 1), new Map());
  const chips = [['all', 'Tous', rows.length], ...Object.entries(SR_STATUS).filter(([k]) => counts.get(k)).map(([k, [, l]]) => [k, l, counts.get(k)])];
  const sortBtn = (k, label) => `<button type="button" class="sr-sort" data-sr-sort="${k}" title="Trier par ${escapeHtml(label)}">${escapeHtml(label)}<span class="sr-sort-ic" aria-hidden="true"></span></button>`;
  const body = rows.map(({ p, c }) => {
    const st = srStatus(c);
    const rpe = c?.v ? `<td class="is-num" data-sort="${Number(c.v)}"><span class="sr-resp-rpe" style="--rpe:${rpeColor(c.v)}" title="${escapeHtml(rpeLabel(c.v))}">${c.v}</span></td>`
      : `<td class="is-num" data-grp="${SR_STATUS[st][0]}"><span class="sr-resp-none sr-st-${st}"${c === 'away' ? ` title="${escapeHtml(`RPE donné avec ${srAway(s, p).other_label}`)}"` : ''}>${
        c === 'abs' ? 'abs.' : c === 'away' ? `en ${escapeHtml(srAwayTeam(srAway(s, p)))} · ${srAway(s, p).other_rpe}` : c === 'wait' ? 'en attente' : '—'}</span></td>`;
    const avis = s.match ? SR_AVIS.map(([k]) => srRespCell({ type: 'textarea', required: false }, fb.get(p.id), fb.get(p.id)?.[k])) : [];
    const more = qs.map(({ form, q }) => { const r = extra.find(x => x.player_id === p.id && x.form_id === form); return srRespCell(q, r, r?.answers?.[q.id]); });
    return `<tr data-st="${st}"><th scope="row" data-sort="${escapeHtml(playerFullName(p).toLocaleLowerCase('fr'))}">${srRespWho(p)}</th>${rpe}${[...avis, ...more].join('')}</tr>`;
  }).join('');
  return `<section class="card sr-resp" aria-label="${escapeHtml(`Réponses : ${s.adversaire || s.titre || 'Séance'}, ${srWhen(s)}`)}">
    <div class="sr-resp-body">
      <div class="sr-resp-head"><h2 class="as-h3">${escapeHtml(s.adversaire ? `Match – ${s.adversaire}` : s.titre || 'Séance')}</h2>
        <p class="sr-resp-meta">${escapeHtml(srWhen(s))} | <a href="${srHref(s)}">${s.match ? 'Ouvrir le match' : 'Ouvrir la séance'}</a>${titles.size ? ` | ${qs.length} question${qs.length > 1 ? 's' : ''} du questionnaire après ${s.match ? 'match' : 'séance'}` : ''}</p></div>
      ${rows.length ? `<div class="sr-resp-filter" role="group" aria-label="Afficher les joueurs">${chips.map(([k, l, n]) =>
        `<button type="button" class="sr-chip sr-st-${k}" data-sr-filter="${k}" aria-pressed="${k === 'all'}">${l} <b>${n}</b></button>`).join('')}</div>
      <div class="sr-resp-wrap"><table class="sr-resp-table"><thead><tr><th scope="col" aria-sort="none">${sortBtn(0, 'Joueur')}</th>${head.map((h, k) =>
        `<th scope="col" aria-sort="none"><div class="sr-th" title="${escapeHtml(h.label || 'Question')}">${sortBtn(k + 1, h.label || 'Question')}</div></th>`).join('')}</tr></thead>
        <tbody>${body}</tbody></table></div>` : '<p class="text-muted">Aucun joueur concerné.</p>'}
    </div></section>`;
}

/* Une réponse, fidèle à ce qui est enregistré : nombre (avec le libellé et la couleur de son niveau),
   Oui / Non, ou texte replié à 3 lignes qui s'ouvre au clic. row : la réponse du joueur au formulaire. */
function srRespCell(q, row, v) {
  if (!row) return '<td class="is-empty"><span class="sr-resp-none" title="Pas de réponse à ce questionnaire">—</span></td>';
  if (v == null || v === '') return `<td class="is-empty"><span class="sr-resp-skip" title="${q.required === false ? 'Facultative, laissée vide' : 'Laissée vide'}">·</span></td>`;
  const t = fqAnswerText(q, v);
  if (typeof v === 'number') {
    const color = fqColor(q, v);
    return `<td class="is-num"><span class="sr-num${color ? ' has-lv' : ''}"${color ? ` style="--lv:${color}"` : ''} title="${escapeHtml(t)}">${escapeHtml(String(v).replace('.', ','))}</span></td>`;
  }
  if (typeof v === 'boolean') return `<td class="is-num"><span class="sr-bool">${t}</span></td>`;
  return `<td><button type="button" class="sr-txt" data-sr-open title="${escapeHtml(t)}">${escapeHtml(t)}</button></td>`;
}

document.addEventListener('click', (e) => {
  const tile = e.target.closest('[data-sr-tile]');
  if (tile && tile.getAttribute('aria-pressed') !== 'true') { SR.respSel = /^m/.test(tile.dataset.srTile) ? tile.dataset.srTile : Number(tile.dataset.srTile); renderSr(); return; }
  const cell = e.target.closest('[data-sr-open]');
  if (cell) cell.classList.toggle('is-open');
  const sort = e.target.closest('[data-sr-sort]'), filter = e.target.closest('[data-sr-filter]');
  if (sort) srSortBy(sort);
  if (filter) srFilterBy(filter);
});

/* Clé de tri d'une case : [groupe, valeur]. Les réponses d'abord, regroupées ensuite par statut, le vide à la fin. */
function srSortKey(td) {
  if (!td) return [9, ''];
  if (td.dataset.grp != null) return [1 + Number(td.dataset.grp), ''];
  if (td.dataset.sort != null) { const n = Number(td.dataset.sort); return [0, Number.isFinite(n) && td.dataset.sort !== '' ? n : td.dataset.sort]; }
  if (td.classList.contains('is-empty')) return [9, ''];
  const t = td.textContent.trim(), n = Number(t.replace(',', '.'));
  return [0, t !== '' && Number.isFinite(n) ? n : t.toLocaleLowerCase('fr')];
}

/* Un clic : tri croissant, un second : décroissant (les groupes restent dans leur ordre, en bas). */
function srSortBy(btn) {
  const th = btn.closest('th'), table = th.closest('table'), k = Number(btn.dataset.srSort);
  const dir = th.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
  table.querySelectorAll('thead th').forEach(x => x.setAttribute('aria-sort', 'none'));
  th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
  const tbody = table.tBodies[0], rows = [...tbody.rows];
  rows.sort((a, b) => {
    const [ga, va] = srSortKey(a.cells[k]), [gb, vb] = srSortKey(b.cells[k]);
    if (ga !== gb) return ga - gb;
    if (va === vb) return 0;
    return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr')) * dir;
  });
  tbody.append(...rows);
}

/* Pastille : seulement les joueurs de ce statut (« Tous » : tout le monde). */
function srFilterBy(btn) {
  const box = btn.closest('.sr-resp-body'), want = btn.dataset.srFilter;
  box.querySelectorAll('[data-sr-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === btn)));
  box.querySelectorAll('tbody tr').forEach(tr => { tr.hidden = want !== 'all' && tr.dataset.st !== want; });
}
