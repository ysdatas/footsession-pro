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
   ============================================================ */

const SR_AVIS = [['individuel', 'Sa performance'], ['collectif', 'L’équipe']];   // comme match-feedback.js
const srOcc = (s) => (s.match ? `m${s.id}` : `s${s.id}`);
const srAnswer = (v) => (v == null || v === '' ? '' : v === true ? 'Oui' : v === false ? 'Non' : String(v));

/* Avis et questions ajoutées des séances ou matchs affichés. Sans la migration, la vue montre le reste. */
async function loadSrResp() {
  const occ = SR.sessions.map(srOcc), matchIds = SR.sessions.filter(s => s.match).map(s => s.id);
  const [fb, cf] = await Promise.all([
    matchIds.length ? sb.from('match_feedback').select('match_id, player_id, individuel, collectif').in('match_id', matchIds) : { data: [] },
    occ.length ? sb.from('custom_form_responses').select('form_id, form_title_snapshot, player_id, occurrence, questions_snapshot, answers').in('occurrence', occ) : { data: [] },
  ]);
  if (fb.error) console.warn('Suivi RPE : avis de match illisibles', fb.error);
  if (cf.error) console.warn('Suivi RPE : questions ajoutées illisibles', cf.error);
  return { fb: fb.data || [], cf: cf.data || [] };
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
      Les questions et leurs intitulés se règlent dans Formulaires.</p>${cards.join('')}`);
}

/* Une séance ou un match : un tableau joueurs × questions. */
function srRespCard(s, j, open) {
  const occ = srOcc(s), extra = SR.resp.cf.filter(r => r.occurrence === occ);
  const fb = new Map(SR.resp.fb.filter(x => x.match_id === s.id && s.match).map(x => [x.player_id, x]));
  // Questions ajoutées : celles des formulaires répondus, dans leur ordre, sans doublon.
  const qs = [], seen = new Set(), titles = new Set();
  extra.forEach(r => {
    titles.add(r.form_title_snapshot);
    (r.questions_snapshot || []).forEach(q => { if (!seen.has(`${r.form_id}:${q.id}`)) { seen.add(`${r.form_id}:${q.id}`); qs.push({ form: r.form_id, id: q.id, label: q.label || 'Question' }); } });
  });
  const rows = SR.players.map((p, i) => ({ p, c: SR.cells[i][j] })).filter(x => x.c !== null);
  const answered = rows.filter(({ p, c }) => c?.v || fb.has(p.id) || extra.some(r => r.player_id === p.id)).length;
  const head = ['RPE', ...(s.match ? SR_AVIS.map(([, l]) => l) : []), ...qs.map(q => q.label)];
  const body = rows.map(({ p, c }) => {
    const rpe = c?.v ? `<span class="sr-resp-rpe" style="--rpe:${rpeColor(c.v)}" title="${escapeHtml(rpeLabel(c.v))}">${c.v}</span>`
      : `<span class="sr-resp-none">${c === 'abs' ? 'abs.' : c === 'wait' ? 'en attente' : '—'}</span>`;
    const avis = s.match ? SR_AVIS.map(([k]) => srRespCell(fb.get(p.id)?.[k])) : [];
    const more = qs.map(q => srRespCell(extra.find(r => r.player_id === p.id && r.form_id === q.form)?.answers?.[q.id]));
    return `<tr><th scope="row">${escapeHtml(playerFullName(p))}</th><td>${rpe}</td>${[...avis, ...more].join('')}</tr>`;
  }).join('');
  return `<details class="card sr-resp"${open ? ' open' : ''}><summary>
      <span class="sr-resp-when">${escapeHtml(srWhen(s))}</span><span class="sr-resp-title">${escapeHtml(s.adversaire || s.titre || 'Séance')}</span>
      <span class="sr-resp-count">${answered} / ${rows.length}</span></summary>
    <div class="sr-resp-body">
      <p class="sr-resp-meta"><a href="${srHref(s)}">${s.match ? 'Ouvrir le match' : 'Ouvrir la séance'}</a>${titles.size ? ` | Questions ajoutées : ${[...titles].map(escapeHtml).join(', ')}` : ''}</p>
      ${rows.length ? `<div class="sr-resp-wrap"><table class="sr-resp-table"><thead><tr><th scope="col">Joueur</th>${head.map(h => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${body}</tbody></table></div>` : '<p class="text-muted">Aucun joueur concerné.</p>'}
    </div></details>`;
}

/* Une réponse : texte replié à 3 lignes (entier au survol), « — » si vide. */
function srRespCell(v) {
  const t = srAnswer(v);
  return t ? `<td><span class="sr-txt" title="${escapeHtml(t)}">${escapeHtml(t)}</span></td>` : '<td><span class="sr-resp-none">—</span></td>';
}
