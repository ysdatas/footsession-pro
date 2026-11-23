/* ============================================================
   LMFC Performance — calendar-forms.js (calendrier, joueur)
   Dans la fiche d'une séance ou d'un match, ce qui reste à remplir, rangé
   comme le joueur le vit :
     - Avant (PRE) : courbatures du matin (soreness.js, lmfc_v35.sql), le
       jour même d'une séance ; questionnaires du jour (« j » + date) et
       « Avant le match » (lmfc_v65.sql) ;
     - Après (POST) : questionnaires de cette séance ou de ce match
       (« s »/« m » + id), proposés une fois le RPE noté (le RPE reste au-dessus,
       calRpe dans calendrier-page.js).
   Un questionnaire s'ouvre dans Mes formulaires (?f=version&o=occurrence).
   « Répondre » sur une carte du jour (calendar-player.js) ouvre la même chose en
   fenêtre : « Sélectionner une phase », PRE ou POST, puis ce qu'il y a à remplir
   (une seule chose : elle s'ouvre directement).
   Dépend de app.js (escapeHtml), calendar-utils.js (calToday), soreness.js, rpe.js,
   calendrier-page.js (calOpenRpe).
   ============================================================ */

/* Avant le match (lmfc_v65.sql) : même occurrence « m » qu'après, le titre les distingue. */
const cqBefore = (f) => /^Avant le match/.test(f.titre || '');
const cqLink = (f) => `<a class="btn btn-sm" href="mes-formulaires.html?f=${Number(f.version_id)}&o=${encodeURIComponent(f.occurrence || '')}">${escapeHtml(String(f.titre || 'Questionnaire').split(' · ')[0])}</a>`;

/* Ce qu'il reste à faire pour une séance ou un match : courbatures du jour, questionnaires PRE et POST. */
async function cqData(i) {
  const today = i.kind === 'seance' && i.date === calToday();
  const [pending, sore] = await Promise.all([sb.rpc('custom_forms_my_pending'), today ? sb.rpc('my_soreness_today') : { data: [] }]);
  if (pending.error) console.warn('Questionnaires à remplir illisibles', pending.error.message);
  if (sore.error && !['PGRST202', '42883'].includes(sore.error.code)) console.warn('Courbatures du jour illisibles', sore.error.message);
  const forms = pending.data || [], own = (i.kind === 'match' ? 'm' : 's') + i.id;
  return { sore: (sore.data || [])[0] || null,
    pre: forms.filter(f => f.occurrence === `j${i.date}` || (f.occurrence === own && cqBefore(f))),
    post: forms.filter(f => f.occurrence === own && !cqBefore(f)) };
}

async function calQuest(i) {
  const box = document.getElementById('calQuest');
  if (!box) return;
  const { sore: s, pre, post } = await cqData(i);
  if (!document.body.contains(box)) return;   // fiche fermée ou changée pendant le chargement
  const soreBtn = s ? `<button type="button" class="btn btn-sm${s.niveau == null ? ' btn-primary' : ''}" id="calSoreBtn">${s.niveau == null
    ? 'Courbatures du matin' : `Courbatures : ${Number(s.niveau)}/10, modifier`}</button>` : '';
  const part = (title, items) => `<div class="cal-quest-part"><h3 class="as-h4">${title}</h3><div class="cal-quest-btns">${items.join('')}</div></div>`;
  const parts = [(soreBtn || pre.length) && part('Avant (PRE)', [soreBtn, ...pre.map(cqLink)]), post.length && part('Après (POST)', post.map(cqLink))].filter(Boolean);
  box.classList.toggle('hidden', !parts.length);   // gardé caché : le RPE noté peut le remplir ensuite
  box.innerHTML = parts.join('');
  document.getElementById('calSoreBtn')?.addEventListener('click', () => openSorenessSheet({ today: s, onSaved: (r) => { Object.assign(s, r); calQuest(i); } }));
}

/* ---------- « Répondre » : la phase, puis ce qu'il y a à remplir ---------- */
function calReply(i) {
  if (!document.getElementById('calPhase')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="calPhase">
      <div class="modal cal-phase" role="dialog" aria-modal="true" aria-labelledby="calPhaseTitle">
        <h2 class="as-h3" id="calPhaseTitle"></h2>
        <p class="cal-phase-sub" id="calPhaseSub"></p>
        <p class="cal-phase-q">Sélectionner une phase pour le formulaire</p>
        <div class="cal-phase-btns">
          <button type="button" class="cal-phase-btn" data-phase="pre">PRE<small>Avant : courbatures, questionnaires du jour</small></button>
          <button type="button" class="cal-phase-btn" data-phase="post">POST<small>Après : ton effort (RPE), questionnaires</small></button>
        </div>
        <div class="cal-phase-list" id="calPhaseList" aria-live="polite"></div>
        <button type="button" class="btn cal-phase-cancel" data-close="calPhase">Annuler</button>
      </div></div>`);
    document.getElementById('calPhase').addEventListener('click', (e) => {
      const b = e.target.closest('[data-phase]'), act = e.target.closest('[data-cq-act]');
      const st = document.getElementById('calPhase').cq;
      if (b) cqPhase(st, b.dataset.phase);
      if (act) st.acts[Number(act.dataset.cqAct)].run();
    });
  }
  const sheet = document.getElementById('calPhase');
  sheet.cq = { i, data: cqData(i), forms: sb.rpc('my_event_forms', { p_kind: i.kind, p_id: i.id }), acts: [] };
  document.getElementById('calPhaseTitle').textContent = `${CAL_KINDS[i.kind]} – ${calTitleOf(i)}`;
  document.getElementById('calPhaseSub').textContent = [calCap(calDayLabel(i.date)), i.heure].filter(Boolean).join(' à ');
  document.getElementById('calPhaseList').innerHTML = '';
  sheet.querySelectorAll('[data-phase]').forEach(b => b.setAttribute('aria-pressed', 'false'));
  openModal('calPhase');
}

/* PRE ou POST : la liste de ce qu'il y a à remplir ; une seule chose s'ouvre tout de suite. */
async function cqPhase(st, phase) {
  const list = document.getElementById('calPhaseList'), { i } = st;
  document.querySelectorAll('#calPhase [data-phase]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.phase === phase)));
  list.innerHTML = '<p class="cal-phase-note">Chargement…</p>';
  const [{ sore, pre, post }, ev] = await Promise.all([st.data, st.forms]);
  const go = (f) => () => { window.location.href = `mes-formulaires.html?f=${Number(f.version_id)}&o=${encodeURIComponent(f.occurrence || '')}`; };
  const label = (f) => String(f.titre || 'Questionnaire').split(' · ')[0];
  // Après une saisie (sa fenêtre se ferme seule) : la phase revient avec ce qu'il reste.
  const again = () => setTimeout(() => { closeModal('rpeSheet'); closeModal('soreSheet'); st.data = cqData(i); openModal('calPhase'); cqPhase(st, phase); }, 1000);
  st.acts = phase === 'pre'
    ? [...(sore && sore.niveau == null ? [{ text: 'Courbatures du matin', run: () => { closeModal('calPhase'); openSorenessSheet({ today: sore, onSaved: again }); } }] : []),
      ...pre.map(f => ({ text: label(f), run: go(f) }))]
    : [...(i.rpeTodo ? [{ text: 'Mon effort (RPE)', run: () => {
        closeModal('calPhase');
        calOpenRpe(i, (ev.data || []).find(f => f.source === (i.kind === 'match' ? 'rpe_match' : 'rpe_seance')), again);
      } }] : []),
      ...post.map(f => ({ text: label(f), run: go(f) }))];
  if (st.acts.length === 1 && !st.auto) { st.auto = true; return st.acts[0].run(); }
  st.auto = false;
  const none = phase === 'pre'
    ? (sore?.niveau != null ? `Courbatures envoyées (${Number(sore.niveau)}/10). Rien d’autre avant cette séance.` : 'Rien à remplir avant cette séance pour l’instant.')
    : i.rpeAilleurs ? `Ton effort se note avec ${i.rpeAilleurs}.`
      : i.date > calToday() ? 'Tu pourras répondre après la séance.' : 'Tout est rempli pour cette séance. Merci !';
  list.innerHTML = st.acts.length
    ? st.acts.map((a, k) => `<button type="button" class="btn btn-primary cal-phase-act" data-cq-act="${k}">${escapeHtml(a.text)}</button>`).join('')
    : `<p class="cal-phase-note">${escapeHtml(none)}</p>`;
}
