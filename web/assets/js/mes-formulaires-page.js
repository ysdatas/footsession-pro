/* Formulaires personnalisés du joueur (lmfc_v45.sql).
   L’envoi est validé côté serveur ; le navigateur ne peut ni lire les réponses
   d’un autre joueur ni remplacer une réponse déjà envoyée. */
const MF = { player: null, pending: [], history: [], historyMore: false, busy: false, demo: false };
const MF_PAGE = 50;   // réponses chargées à la fois ; custom_forms_my_history en rend 100 au plus

(async () => {
  const pending = document.getElementById('mfPending');
  if (mfLocalPreview()) {
    MF.demo = true;
    MF.pending = [{ form_id: 9001, version_id: 9002, version_no: 2, titre: 'Questionnaire après la séance',
      description: 'Aide ton staff à comprendre comment tu as vécu cette séance.', team_nom: 'Pro', questions: [
        { id: 'intensite', label: 'Comment évalues-tu l’intensité ?', type: 'scale', min: 1, max: 10, required: true },
        { id: 'recuperation', label: 'Comment te sens-tu pour la récupération ?', type: 'choice', options: ['Très bien', 'Correctement', 'Difficilement'], required: true },
        { id: 'commentaire', label: 'Un commentaire pour le staff ?', type: 'textarea', required: false },
      ] }];
    MF.history = [{ response_id: 9003, titre: 'Questionnaire de la semaine', version_no: 1, team_nom: 'Pro',
      submitted_at: new Date(Date.now() - 86400000).toISOString(),
      questions: [{ id: 'sommeil', label: 'Comment as-tu dormi ?', type: 'choice', required: true, options: ['Bien', 'Moyen', 'Mal'] }],
      answers: { sommeil: 'Bien' } }];
    document.getElementById('mfPreviewNotice').classList.remove('hidden');
    document.getElementById('mfSubtitle').textContent = 'Réponds aux questionnaires de tes équipes et retrouve tes réponses précédentes.';
    document.getElementById('mfPending').addEventListener('submit', mfSubmit);
    mfRender();
    return;
  }

  try {
    MF.player = await requirePlayer();
    if (!MF.player) return;
    document.getElementById('mfPending').addEventListener('submit', mfSubmit);
    document.getElementById('mfHistoryMore').addEventListener('click', mfMore);
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

function mfError(e) {
  return ['PGRST202', 'PGRST203', '42883'].includes(e?.code)
    ? 'Les formulaires joueurs ne sont pas encore installés. Les migrations lmfc_v45.sql et lmfc_v47.sql sont nécessaires.'
    : e?.message || 'Une erreur est survenue.';
}

async function mfLoad() {
  const pendingBox = document.getElementById('mfPending');
  pendingBox.innerHTML = '<div class="empty">Chargement des formulaires…</div>';
  document.getElementById('mfHistory').innerHTML = '<div class="empty">Chargement de l’historique…</div>';
  const [pending, history] = await Promise.all([
    sb.rpc('custom_forms_my_pending'),
    sb.rpc('custom_forms_my_history', { p_limit: MF_PAGE }),
  ]);
  if (pending.error || history.error) throw pending.error || history.error;
  MF.pending = pending.data || [];
  MF.history = history.data || [];
  MF.historyMore = MF.history.length === MF_PAGE;
  document.getElementById('mfSubtitle').textContent = MF.pending.length
    ? `${MF.pending.length} questionnaire${MF.pending.length === 1 ? '' : 's'} attend${MF.pending.length === 1 ? '' : 'ent'} ta réponse.`
    : 'Retrouve ici les questionnaires de tes équipes et tes réponses précédentes.';
  mfRender();
}

function mfRender() {
  document.getElementById('mfPendingCount').textContent = MF.pending.length ? `${MF.pending.length} en attente` : '';
  document.getElementById('mfPending').innerHTML = MF.pending.length ? MF.pending.map(mfFormHtml).join('')
    : '<div class="empty">Aucun questionnaire à remplir pour le moment.</div>';
  mfRenderHistory();
}

// À part : charger l'historique ne doit pas effacer un questionnaire en cours de saisie.
function mfRenderHistory() {
  document.getElementById('mfHistoryCount').textContent = MF.history.length ? `${MF.history.length} réponse${MF.history.length === 1 ? '' : 's'}` : '';
  document.getElementById('mfHistory').innerHTML = MF.history.length ? MF.history.map(mfHistoryHtml).join('')
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

function mfFormHtml(form, formIndex) {
  const questions = Array.isArray(form.questions) ? form.questions : [];
  return `<article class="mf-card">
    <h3>${escapeHtml(form.titre)}</h3>
    ${form.description ? `<p>${escapeHtml(form.description)}</p>` : ''}
    <div class="mf-card-meta"><span>${escapeHtml(form.team_nom || 'Mon équipe')}</span><span>Version ${Number(form.version_no) || 1}</span><span>${questions.length} question${questions.length === 1 ? '' : 's'}</span></div>
    <form class="mf-fields" data-mf-form="${Number(form.version_id)}" data-mf-occurrence="${escapeHtml(form.occurrence || '')}">
      ${questions.map((q, index) => mfQuestionHtml(q, `${formIndex}-${index}`)).join('')}
      <p class="mf-error" data-mf-error aria-live="polite"></p>
      <button class="btn btn-primary" type="submit">Envoyer mes réponses</button>
    </form>
  </article>`;
}

function mfQuestionHtml(question, index) {
  const id = `mf-${index}-${String(question.id || '').replace(/[^a-z0-9_-]/gi, '')}`;
  const label = `${escapeHtml(question.label || 'Question')}<small>${question.required ? 'Obligatoire' : 'Facultatif'}</small>`;
  const required = question.required ? ' required' : '';
  const input = (control) => `<div class="field mf-field"><label for="${id}">${label}</label>${control}</div>`;
  if (question.type === 'textarea') return input(`<textarea id="${id}" data-mf-answer="${escapeHtml(question.id)}" rows="3" maxlength="2000"${required}></textarea>`);
  if (question.type === 'text') return input(`<input id="${id}" data-mf-answer="${escapeHtml(question.id)}" type="text" maxlength="200"${required}>`);
  if (question.type === 'number') return input(`<input id="${id}" data-mf-answer="${escapeHtml(question.id)}" type="number" step="any"${required}>`);
  if (question.type === 'boolean') return input(`<select id="${id}" data-mf-answer="${escapeHtml(question.id)}"${required}><option value="">Choisir</option><option value="true">Oui</option><option value="false">Non</option></select>`);
  const min = Number.isInteger(Number(question.min)) ? Number(question.min) : 1;
  const max = Number.isInteger(Number(question.max)) ? Number(question.max) : 10;
  const options = question.type === 'choice'
    ? (question.options || []).map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')
    : Array.from({ length: Math.max(0, Math.min(10, max - min + 1)) }, (_, n) => `<option value="${min + n}">${min + n}</option>`).join('');
  return input(`<select id="${id}" data-mf-answer="${escapeHtml(question.id)}"${required}><option value="">Choisir</option>${options}</select>`);
}

async function mfSubmit(e) {
  const form = e.target.closest('[data-mf-form]');
  if (!form) return;
  e.preventDefault();
  if (MF.busy) return;
  if (!form.reportValidity()) return;
  const answers = {};
  form.querySelectorAll('[data-mf-answer]').forEach(field => {
    const value = field.value;
    if (value === '') { answers[field.dataset.mfAnswer] = null; return; }
    if (field.type === 'number') answers[field.dataset.mfAnswer] = Number(value);
    else if (field.tagName === 'SELECT' && (value === 'true' || value === 'false')) answers[field.dataset.mfAnswer] = value === 'true';
    else answers[field.dataset.mfAnswer] = value;
  });
  const versionId = Number(form.dataset.mfForm), button = form.querySelector('button[type="submit"]');
  const error = form.querySelector('[data-mf-error]');
  MF.busy = true; button.disabled = true; error.textContent = 'Envoi…'; error.classList.remove('mf-success');
  try {
    if (MF.demo) {
      const source = MF.pending.find(x => Number(x.version_id) === versionId);
      if (!source) throw new Error('Ce questionnaire n’est plus disponible.');
      MF.history.unshift({ response_id: Date.now(), titre: source.titre, version_no: source.version_no,
        team_nom: source.team_nom, submitted_at: new Date().toISOString(), questions: source.questions, answers });
      MF.pending = MF.pending.filter(x => Number(x.version_id) !== versionId);
    } else {
      const { error: submitError } = await sb.rpc('custom_form_submit', { p_version_id: versionId, p_answers: answers, p_occurrence: form.dataset.mfOccurrence });
      if (submitError) throw submitError;
      await mfLoad();
    }
    if (MF.demo) mfRender();
    toast('Réponse envoyée. Elle est maintenant dans ton historique.', 'success');
    error.textContent = 'Réponse envoyée. Tu peux la consulter dans « Mes réponses ». ';
    error.classList.add('mf-success');
  } catch (err) {
    console.error('Réponse au formulaire non envoyée', err);
    error.textContent = mfError(err);
    button.disabled = false;
  } finally { MF.busy = false; }
}

function mfHistoryHtml(response) {
  const questions = Array.isArray(response.questions) ? response.questions : [];
  const answers = response.answers && typeof response.answers === 'object' ? response.answers : {};
  const when = response.submitted_at ? new Date(response.submitted_at) : null;
  const date = when && !Number.isNaN(when.getTime())
    ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(when) : 'Date inconnue';
  return `<article class="mf-history-card">
    <div class="mf-history-head"><div><h3>${escapeHtml(response.titre || 'Formulaire')}</h3><span class="mf-count">${escapeHtml(response.team_nom || 'Mon équipe')} | Version ${Number(response.version_no) || 1}</span></div><time datetime="${escapeHtml(response.submitted_at || '')}">${escapeHtml(date)}</time></div>
    <dl class="mf-answer-list">${questions.map(q => `<div class="mf-answer"><dt>${escapeHtml(q.label || 'Question')}</dt><dd>${escapeHtml(mfAnswerText(answers[q.id]))}</dd></div>`).join('')}</dl>
  </article>`;
}

function mfAnswerText(value) {
  if (value == null || value === '') return 'Sans réponse';
  if (value === true) return 'Oui';
  if (value === false) return 'Non';
  return String(value);
}
