/* ============================================================
   LMFC Performance — suivi-rpe-resp.js (suivi-rpe)
   Vue « Réponses » : pour chaque séance ou match affiché, ce que chaque
   joueur a répondu à ses formulaires, sur une seule carte :
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
   ============================================================ */

const SR_AVIS = [['individuel', 'Sa performance'], ['collectif', 'L’équipe']];   // comme match-feedback.js
const srOcc = (s) => (s.match ? `m${s.id}` : `s${s.id}`);
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
  // La plus récente en haut, seule ouverte.
  const cards = SR.sessions.map((s, j) => ({ s, j })).reverse().map(({ s, j }, i) => srRespCard(s, j, i === 0));
  swapKeepView(body, `<p class="sr-resp-note">Chaque carte rassemble les réponses du joueur après ${SR.scope === 'match' ? 'le match' : 'la séance'} : RPE${SR.scope === 'match' ? ', avis' : ''} et questions ajoutées.
      <span class="sr-resp-legend"><span class="sr-resp-none">—</span> pas de réponse au questionnaire <span class="sr-resp-skip">·</span> question laissée vide (facultative)</span>
      Toucher une réponse longue l’affiche en entier ; le nom d’un joueur ouvre toutes ses réponses.</p>${cards.join('')}`);
}

/* Le joueur : photo (ou initiales) et nom, lien vers toutes ses réponses. */
function srRespWho(p) {
  const url = SR.resp.photos?.get(p.photo_path);
  const face = url ? `<img class="sr-resp-face" src="${escapeHtml(url)}" alt="" loading="lazy" width="28" height="28">`
    : `<span class="sr-resp-face" aria-hidden="true">${escapeHtml(srInitials(p))}</span>`;
  return `<a class="sr-resp-who" href="historique-reponses?joueur=${Number(p.id)}&team=${Number(SR.team) || ''}" title="Toutes les réponses de ${escapeHtml(playerFullName(p))}">${face}<span>${escapeHtml(playerFullName(p))}</span></a>`;
}

/* Une séance ou un match : un tableau joueurs × questions. */
function srRespCard(s, j, open) {
  const occ = srOcc(s), extra = SR.resp.cf.filter(r => r.occurrence === occ);
  const fb = new Map(SR.resp.fb.filter(x => x.match_id === s.id && s.match).map(x => [x.player_id, x]));
  // Questions ajoutées : celles des formulaires répondus, dans leur ordre, sans doublon.
  const qs = [], seen = new Set(), titles = new Set();
  extra.forEach(r => {
    titles.add(r.form_title_snapshot);
    (r.questions_snapshot || []).forEach(q => { if (!q.fixe && !seen.has(`${r.form_id}:${q.id}`)) { seen.add(`${r.form_id}:${q.id}`); qs.push({ form: r.form_id, q }); } });
  });
  const rows = SR.players.map((p, i) => ({ p, c: SR.cells[i][j] })).filter(x => x.c !== null);
  const answered = rows.filter(({ p, c }) => c?.v || fb.has(p.id) || extra.some(r => r.player_id === p.id)).length;
  const head = [{ label: 'RPE' }, ...(s.match ? SR_AVIS.map(([, l]) => ({ label: l })) : []), ...qs.map(x => x.q)];
  const body = rows.map(({ p, c }) => {
    const rpe = c?.v ? `<td class="is-num"><span class="sr-resp-rpe" style="--rpe:${rpeColor(c.v)}" title="${escapeHtml(rpeLabel(c.v))}">${c.v}</span></td>`
      : `<td class="is-num"><span class="sr-resp-none">${c === 'abs' ? 'abs.' : c === 'away' ? 'ailleurs' : c === 'wait' ? 'en attente' : '—'}</span></td>`;
    const avis = s.match ? SR_AVIS.map(([k]) => srRespCell({ type: 'textarea', required: false }, fb.get(p.id), fb.get(p.id)?.[k])) : [];
    const more = qs.map(({ form, q }) => { const r = extra.find(x => x.player_id === p.id && x.form_id === form); return srRespCell(q, r, r?.answers?.[q.id]); });
    return `<tr><th scope="row">${srRespWho(p)}</th>${rpe}${[...avis, ...more].join('')}</tr>`;
  }).join('');
  return `<details class="card sr-resp"${open ? ' open' : ''}><summary>
      <span class="sr-resp-when">${escapeHtml(srWhen(s))}</span><span class="sr-resp-title">${escapeHtml(s.adversaire || s.titre || 'Séance')}</span>
      <span class="sr-resp-count">${answered} / ${rows.length}</span></summary>
    <div class="sr-resp-body">
      <p class="sr-resp-meta"><a href="${srHref(s)}">${s.match ? 'Ouvrir le match' : 'Ouvrir la séance'}</a>${titles.size ? ` | Questions ajoutées : ${[...titles].map(escapeHtml).join(', ')}` : ''}</p>
      ${rows.length ? `<div class="sr-resp-wrap"><table class="sr-resp-table"><thead><tr><th scope="col">Joueur</th>${head.map(h => `<th scope="col"><div class="sr-th" title="${escapeHtml(h.label || 'Question')}">${escapeHtml(h.label || 'Question')}</div></th>`).join('')}</tr></thead>
        <tbody>${body}</tbody></table></div>` : '<p class="text-muted">Aucun joueur concerné.</p>'}
    </div></details>`;
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
  const cell = e.target.closest('[data-sr-open]');
  if (cell) cell.classList.toggle('is-open');
});
