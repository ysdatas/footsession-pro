/* Mes formulaires (joueur) : tout ce qu'il a à remplir, regroupé (player-todo.js,
   todo-parts.js), puis ses réponses (lmfc_v45.sql).
   Un questionnaire par séance ou match et par moment (« Questionnaire après séance » :
   l'effort et les autres questions ensemble), replié, un seul ouvert à la fois.
   Venu de l'accueil ou du calendrier (?u=clé), celui-là s'ouvre.
   L'envoi est validé côté serveur ; le navigateur ne peut ni lire les réponses
   d'un autre joueur ni remplacer une réponse déjà envoyée. */
const MF = { player: null, items: [], history: [], historyMore: false, busy: false, demo: false };
const MF_PAGE = 50;   // réponses chargées à la fois ; custom_forms_my_history en rend 100 au plus

(async () => {
  const pending = document.getElementById('mfPending');
  pending.addEventListener('submit', mfSubmit);
  pending.addEventListener('change', mfProgress);
  pending.addEventListener('input', mfProgress);
  document.addEventListener('toggle', mfToggle, true);   // un seul questionnaire ouvert
  if (mfLocalPreview()) {
    MF.demo = true;
    MF.items = ptBuild(mfDemo());
    document.getElementById('mfPreviewNotice').classList.remove('hidden');
    document.getElementById('mfSubtitle').textContent = 'Réponds à tes questionnaires et retrouve tes réponses précédentes.';
    mfRender();
    return;
  }
  try {
    MF.player = await requirePlayer();
    if (!MF.player) return;
    document.getElementById('mfHistoryMore').addEventListener('click', mfMore);
    markReminderOpened();   // app.js : relance du staff ouverte (venue de l'accueil, ?rappel=)
    await mfLoad();
  } catch (e) {
    console.error('Mes formulaires indisponibles', e);
    pending.innerHTML = `<p class="text-danger">${escapeHtml(mfError(e))}</p>`;
    document.getElementById('mfSubtitle').textContent = 'Tes formulaires ne sont pas disponibles pour le moment.';
  }
})();

function mfLocalPreview() {
  return ['localhost', '127.0.0.1'].includes(location.hostname)
    && new URLSearchParams(location.search).get('preview') === '1';
}

/* Aperçu local : une séance d'hier à noter avec ses questions, les courbatures du jour,
   un questionnaire « une fois » ; rien n'est envoyé. */
function mfDemo() {
  const qs = [
    { id: 'rpe', label: 'Comment as-tu ressenti l’effort de toute la séance ?', type: 'scale', min: 1, max: 10, required: true, fixe: true },
    { id: 'plaisir', label: 'As-tu pris du plaisir ?', type: 'scale', min: 0, max: 10, required: true },
    { id: 'douleur', label: 'As-tu des douleurs ?', type: 'boolean', required: true },
    { id: 'commentaire', label: 'Un commentaire pour le staff ?', type: 'textarea', required: false },
  ];
  return {
    rpe: [{ id: 1, match: false, titre: 'Séance Espoirs', date: ptDay(1), date_seance: ptDay(1), heure: '16:30:00', rpe: null, form_questions: qs }],
    sore: { session_id: 2, titre: 'Séance Espoirs', heure: '16:30:00', niveau: null, muscles: [], form_questions: [] },
    avis: [], feedback: [],
    forms: [{ form_id: 9003, version_id: 9004, version_no: 1, titre: 'Questionnaire de la semaine', description: 'Aide ton staff à préparer la semaine.', occurrence: '', jour: null,
      questions: [{ id: 'sommeil', label: 'Comment as-tu dormi ?', type: 'choice', required: true, options: ['Bien', 'Moyen', 'Mal'] }] }],
  };
}

function mfIso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function mfError(e) {
  return ['PGRST202', 'PGRST203', '42883'].includes(e?.code)
    ? 'Les formulaires joueurs ne sont pas encore installés. Les migrations lmfc_v45.sql et lmfc_v47.sql sont nécessaires.'
    : e?.message || 'Une erreur est survenue.';
}

async function mfLoad() {
  document.getElementById('mfPending').innerHTML = '<div class="empty">Chargement des formulaires…</div>';
  document.getElementById('mfHistory').innerHTML = '<div class="empty">Chargement de l’historique…</div>';
  const [todo, history] = await Promise.all([ptLoad(), sb.rpc('custom_forms_my_history', { p_limit: MF_PAGE })]);
  if (todo.error || history.error) throw todo.error || history.error;
  MF.items = todo.items;
  MF.history = history.data || [];
  MF.historyMore = MF.history.length === MF_PAGE;
  const n = MF.items.length;
  document.getElementById('mfSubtitle').textContent = n
    ? `${n} questionnaire${n === 1 ? '' : 's'} à remplir.`
    : 'Tout est à jour. Retrouve ici tes réponses précédentes.';
  mfRender();
}

/* « Aujourd'hui », « Hier », « mardi 17 novembre ». */
function mfDayLabel(iso) {
  const today = new Date(), yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (iso === mfIso(today)) return 'Aujourd’hui';
  if (iso === mfIso(yest)) return 'Hier';
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T12:00`));
}

/* Des éléments rangés par jour, dans l'ordre reçu. */
function mfByDay(items, dayOf) {
  const groups = [];
  for (const item of items) {
    const day = dayOf(item), last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item); else groups.push({ day, items: [item] });
  }
  return groups;
}

function mfRender() {
  const box = document.getElementById('mfPending'), n = MF.items.length;
  document.getElementById('mfPendingCount').textContent = n ? `${n} à remplir` : '';
  // Venu de l'accueil ou du calendrier : ?u=clé ; anciens liens : ?f=version&o=occurrence.
  const want = new URLSearchParams(location.search), key = want.get('u');
  const legacy = (it) => want.has('f') && it.parts.some(p => p.type === 'form' && String(p.form.version_id) === want.get('f') && (p.form.occurrence || '') === (want.get('o') || ''));
  const asked = MF.items.findIndex(it => it.key === key || legacy(it));
  if ((key || want.has('f')) && !MF.demo) {
    history.replaceState(null, '', location.pathname);   // recharger après l'envoi n'y revient pas
    if (asked < 0) toast('Ce questionnaire est déjà rempli. Merci !');
  }
  box.innerHTML = n ? MF.items.map((it, i) => ptCardHtml(it, i, i === Math.max(0, asked))).join('')
    : '<div class="empty">Tout est à jour : rien à remplir pour le moment.</div>';
  if (asked > 0) box.querySelector('[data-pt-card][open]')?.scrollIntoView({ block: 'start' });
  mfRenderHistory();
}

// À part : charger l'historique ne doit pas effacer un questionnaire en cours de saisie.
function mfRenderHistory() {
  document.getElementById('mfHistoryCount').textContent = MF.history.length ? `${MF.history.length} réponse${MF.history.length === 1 ? '' : 's'}` : '';
  const day = (r) => { const d = r.submitted_at ? new Date(r.submitted_at) : null; return d && !Number.isNaN(d.getTime()) ? mfIso(d) : null; };
  document.getElementById('mfHistory').innerHTML = MF.history.length
    ? mfByDay(MF.history, day).map(g => `<div class="mf-day"><h3 class="mf-day-title">${escapeHtml(g.day ? mfDayLabel(g.day) : 'Date inconnue')}</h3>
      ${g.items.map(mfHistoryHtml).join('')}</div>`).join('')
    : '<div class="empty">Tes réponses envoyées apparaîtront ici.</div>';
  document.getElementById('mfHistoryMore').classList.toggle('hidden', !MF.historyMore);
}

async function mfMore(e) {
  const button = e.currentTarget;
  button.disabled = true;
  try {
    const { data, error } = await sb.rpc('custom_forms_my_history', { p_limit: MF_PAGE, p_offset: MF.history.length });
    if (error) throw error;
    MF.history.push(...(data || []));
    MF.historyMore = (data || []).length === MF_PAGE;
    mfRenderHistory();
  } catch (err) {
    console.error('Historique des formulaires illisible', err);
    toast(mfError(err), 'error');
  } finally { button.disabled = false; }
}

/* Une réponse touchée : la question n'est plus à revoir, le compte suit ; échelle en pastilles : son libellé. */
function mfProgress(e) {
  const card = e.target.closest?.('[data-pt-card]');
  if (!card) return;
  ptProgress(card);
  const box = e.target.closest('[data-mf-q]');
  box?.classList.remove('is-missing');
  const out = box?.querySelector('[data-mf-out]'), part = box?.closest('[data-pt-part]');
  if (!out || !part) return;
  const [n, k] = part.dataset.ptPart.split('-').map(Number), p = MF.items[n]?.parts[k];
  const q = (p?.type === 'form' ? p.form.questions : p?.extras || []).find(x => x.id === box.dataset.mfQ);
  if (q) out.textContent = fqLevel(q, box.querySelector('input:checked')?.value)?.libelle || '';
}

/* Un seul questionnaire ouvert : en ouvrir un referme les autres. */
function mfToggle(e) {
  const card = e.target;
  if (!card.matches?.('[data-pt-card]') || !card.open) return;
  document.querySelectorAll('[data-pt-card][open]').forEach(x => { if (x !== card) x.open = false; });
}

async function mfSubmit(e) {
  const form = e.target.closest('[data-pt-form]');
  if (!form) return;
  e.preventDefault();
  const n = Number(form.dataset.ptForm), item = MF.items[n];
  if (MF.busy || !item) return;
  MF.busy = true;
  try {
    await ptSubmit(form, item, n, { demo: MF.demo, after: async () => {
      if (!MF.demo) return mfLoad();
      MF.items = MF.items.filter(x => x !== item);
      return mfRender();
    } });
  } finally { MF.busy = false; }
}

/* Une réponse envoyée, repliée : titre et heure ; ouverte, chaque question et la réponse enregistrée. */
function mfHistoryHtml(response) {
  const questions = Array.isArray(response.questions) ? response.questions : [];
  const answers = response.answers && typeof response.answers === 'object' ? response.answers : {};
  const when = response.submitted_at ? new Date(response.submitted_at) : null;
  const time = when && !Number.isNaN(when.getTime()) ? new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short' }).format(when) : '';
  // Titre sans équipe (ptTitle, player-todo.js) ; la séance ou le match, s'il est dans le titre enregistré.
  const context = String(response.titre || '').split(' · ').slice(1).join(' | ');
  return `<details class="mf-history-card">
    <summary><span class="mf-card-title">${escapeHtml(ptTitle(response.titre))}</span>
      <span class="mf-card-sub">${escapeHtml(context)}</span>
      <time datetime="${escapeHtml(response.submitted_at || '')}">${escapeHtml(time)}</time></summary>
    <dl class="mf-answer-list">${questions.filter(q => !q.fixe).map(q => `<div class="mf-answer"><dt>${escapeHtml(q.label || 'Question')}</dt>
      <dd>${escapeHtml(fqAnswerText(q, answers[q.id]) || 'Sans réponse')}</dd></div>`).join('')}</dl>
  </details>`;
}
