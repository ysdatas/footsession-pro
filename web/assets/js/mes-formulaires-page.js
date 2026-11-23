/* Formulaires personnalisés du joueur (lmfc_v45.sql, lmfc_v47.sql, lmfc_v63.sql).
   L’envoi est validé côté serveur ; le navigateur ne peut ni lire les réponses
   d’un autre joueur ni remplacer une réponse déjà envoyée.
   Écran compact : les questionnaires sont repliés, du plus récent au plus ancien,
   un seul ouvert à la fois ; ceux de plus de deux jours sont rangés à part.
   Les échelles et Oui / non se touchent (pastilles) ; chaque réponse part avec son
   vrai type : une échelle est un nombre, jamais le texte « 8 ». */
const MF = { player: null, pending: [], history: [], historyMore: false, busy: false, demo: false };
const MF_PAGE = 50;   // réponses chargées à la fois ; custom_forms_my_history en rend 100 au plus
const MF_RECENT_DAYS = 2;   // au-delà : « Plus anciens à remplir », replié
const MF_CHIPS_MAX = 6;     // une question à choix plus longue reste une liste

(async () => {
  const pending = document.getElementById('mfPending');
  pending.addEventListener('submit', mfSubmit);
  pending.addEventListener('change', mfProgress);
  document.addEventListener('toggle', mfToggle, true);   // un seul questionnaire ouvert
  if (mfLocalPreview()) {
    MF.demo = true;
    mfDemo();
    document.getElementById('mfPreviewNotice').classList.remove('hidden');
    document.getElementById('mfSubtitle').textContent = 'Réponds aux questionnaires de tes équipes et retrouve tes réponses précédentes.';
    mfRender();
    return;
  }
  try {
    MF.player = await requirePlayer();
    if (!MF.player) return;
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

/* Aperçu local : quelques questionnaires d'essai, rien n'est envoyé. */
function mfDemo() {
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return mfIso(d); };
  const qs = [
    { id: 'intensite', label: 'Comment évalues-tu l’intensité ?', type: 'scale', min: 1, max: 10, required: true, niveaux: FQ_RPE_PRESET },
    { id: 'plaisir', label: 'As-tu pris du plaisir ?', type: 'scale', min: 0, max: 10, required: true },
    { id: 'douleur', label: 'As-tu des douleurs ?', type: 'boolean', required: true },
    { id: 'zone', label: 'Si oui, où ?', type: 'choice', options: ['Ischio-jambiers', 'Quadriceps', 'Adducteurs', 'Mollets', 'Genou', 'Cheville', 'Autre'], required: false },
    { id: 'muscu', label: 'Temps de musculation après la séance (en minutes)', type: 'number', required: false },
    { id: 'commentaire', label: 'Un commentaire pour le staff ?', type: 'textarea', required: false },
  ];
  MF.pending = [
    { form_id: 9001, version_id: 9002, version_no: 2, titre: `Après séance · Séance Espoirs · ${mfDateFr(day(0))}`, team_nom: 'Espoirs', occurrence: 's1', jour: day(0), questions: qs },
    { form_id: 9001, version_id: 9002, version_no: 2, titre: `Après séance · Séance N2 · ${mfDateFr(day(1))}`, team_nom: 'N2', occurrence: 's2', jour: day(1), questions: qs },
    { form_id: 9001, version_id: 9002, version_no: 2, titre: `Après séance · Séance N2 · ${mfDateFr(day(6))}`, team_nom: 'N2', occurrence: 's3', jour: day(6), questions: qs },
    { form_id: 9003, version_id: 9004, version_no: 1, titre: 'Questionnaire de la semaine', description: 'Aide ton staff à préparer la semaine.', team_nom: 'N2', occurrence: '', jour: null,
      questions: [{ id: 'sommeil', label: 'Comment as-tu dormi ?', type: 'choice', required: true, options: ['Bien', 'Moyen', 'Mal'] }] },
  ];
  MF.history = [{ response_id: 9005, titre: 'Après séance', version_no: 1, team_nom: 'N2', submitted_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    questions: qs, answers: { intensite: 7, plaisir: 8, douleur: false, muscu: 20 } }];
}

function mfIso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function mfDateFr(iso) { return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`; }

function mfError(e) {
  return ['PGRST202', 'PGRST203', '42883'].includes(e?.code)
    ? 'Les formulaires joueurs ne sont pas encore installés. Les migrations lmfc_v45.sql et lmfc_v47.sql sont nécessaires.'
    : e?.message || 'Une erreur est survenue.';
}

async function mfLoad() {
  document.getElementById('mfPending').innerHTML = '<div class="empty">Chargement des formulaires…</div>';
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

/* Jour d'un questionnaire : rendu par la base (lmfc_v63.sql), sinon la date en fin de titre. */
function mfDay(form) {
  if (form.jour) return String(form.jour).slice(0, 10);
  const m = /(\d{2})\/(\d{2})\/(\d{4})\s*$/.exec(form.titre || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/* « Aujourd'hui », « Hier », « mardi 17 novembre ». */
function mfDayLabel(iso) {
  if (!iso) return 'À remplir quand tu veux';
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
  const box = document.getElementById('mfPending');
  document.getElementById('mfPendingCount').textContent = MF.pending.length ? `${MF.pending.length} en attente` : '';
  if (!MF.pending.length) {
    box.innerHTML = '<div class="empty">Aucun questionnaire à remplir pour le moment.</div>';
    mfRenderHistory();
    return;
  }
  // Sans date d'abord (à remplir quand il veut), puis du plus récent au plus ancien.
  const list = MF.pending.map((form, i) => ({ form, i, day: mfDay(form) }))
    .sort((a, b) => (a.day === b.day ? a.i - b.i : !a.day ? -1 : !b.day ? 1 : b.day.localeCompare(a.day)));
  const limit = new Date();
  limit.setDate(limit.getDate() - MF_RECENT_DAYS);
  const recent = list.filter(x => !x.day || x.day >= mfIso(limit)), older = list.filter(x => !recent.includes(x));
  // Venu du calendrier (calendar-forms.js, ?f=version&o=occurrence) : ce questionnaire-là, ouvert.
  const want = new URLSearchParams(location.search);
  const first = list.find(x => String(x.form.version_id) === want.get('f') && (x.form.occurrence || '') === (want.get('o') || '')) || list[0];
  const groups = (items) => mfByDay(items, x => x.day).map(g => `<div class="mf-day"><h3 class="mf-day-title">${escapeHtml(mfDayLabel(g.day))}</h3>
    ${g.items.map(x => mfFormHtml(x.form, x.i, x === first)).join('')}</div>`).join('');
  box.innerHTML = groups(recent) + (older.length ? `<details class="mf-older"${older.includes(first) ? ' open' : ''}><summary>Plus anciens à remplir <span class="mf-count">${older.length}</span></summary>
    ${groups(older)}</details>` : '');
  box.querySelectorAll('[data-mf-form]').forEach(f => mfProgress({ target: f }));
  if (first !== list[0]) box.querySelector('[data-mf-card][open]')?.scrollIntoView({ block: 'start' });
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

/* Un questionnaire replié : titre, séance ou match, nombre de questions ; ouvert, ses questions. */
function mfFormHtml(form, index, open) {
  const questions = Array.isArray(form.questions) ? form.questions : [];
  const [title, ...context] = String(form.titre || 'Formulaire').split(' · ');
  return `<details class="mf-card" data-mf-card${open ? ' open' : ''}>
    <summary><span class="mf-card-title">${escapeHtml(title)}</span>
      <span class="mf-card-sub">${escapeHtml([context.join(' · '), form.team_nom].filter(Boolean).join(' | '))}</span>
      <span class="mf-card-n" data-mf-n>${questions.length} question${questions.length === 1 ? '' : 's'}</span></summary>
    ${form.description ? `<p class="mf-card-desc">${escapeHtml(form.description)}</p>` : ''}
    <form class="mf-fields" novalidate data-mf-form="${Number(form.version_id)}" data-mf-occurrence="${escapeHtml(form.occurrence || '')}" data-mf-index="${index}">
      ${questions.map((q, i) => mfQuestionHtml(q, `${index}-${i}`)).join('')}
      <div class="mf-submit-bar"><p class="mf-error" data-mf-error aria-live="polite"></p>
        <button class="btn btn-primary" type="submit">Envoyer mes réponses</button></div>
    </form>
  </details>`;
}

function mfQuestionHtml(q, index) {
  const id = `mf-${index}-${String(q.id || '').replace(/[^a-z0-9_-]/gi, '')}`, key = escapeHtml(q.id);
  const label = `${escapeHtml(q.label || 'Question')} <small>${q.required ? 'Obligatoire' : 'Facultatif'}</small>`;
  const field = (control) => `<div class="field mf-field" data-mf-q="${key}"><label for="${id}">${label}</label>${control}</div>`;
  // Pastilles : un groupe de boutons radio, une seule réponse, grosse cible au doigt.
  const chips = (opts, cls = '') => `<fieldset class="field mf-field" data-mf-q="${key}"><legend>${label}</legend>
    <div class="mf-chips${cls}" role="radiogroup">${opts.map((o, i) => `<label class="mf-chip"${o.color ? ` style="--lv:${o.color}"` : ''}>
      <input type="radio" name="${id}" value="${escapeHtml(o.value)}" data-mf-answer="${key}" data-mf-kind="${o.kind}"${i === 0 ? ` id="${id}"` : ''}>
      <span class="mf-chip-v">${escapeHtml(o.text)}</span>${o.sub ? `<span class="mf-chip-l">${escapeHtml(o.sub)}</span>` : ''}</label>`).join('')}</div>
    ${q.type === 'scale' ? `<p class="mf-chip-out" data-mf-out aria-live="polite"></p>` : ''}</fieldset>`;
  if (q.type === 'textarea') return field(`<textarea id="${id}" data-mf-answer="${key}" data-mf-kind="text" rows="3" maxlength="2000"></textarea>`);
  if (q.type === 'text') return field(`<input id="${id}" data-mf-answer="${key}" data-mf-kind="text" type="text" maxlength="200">`);
  if (q.type === 'number') return field(`<input id="${id}" data-mf-answer="${key}" data-mf-kind="number" type="text" inputmode="decimal" autocomplete="off">`);
  if (q.type === 'boolean') return chips([{ value: 'true', text: 'Oui', kind: 'boolean' }, { value: 'false', text: 'Non', kind: 'boolean' }], ' is-two');
  if (q.type === 'multi') {   // choix multiple (lmfc_v67.sql) : pastilles à cocher, autant que voulu
    const options = Array.isArray(q.options) ? q.options : [];
    return `<fieldset class="field mf-field" data-mf-q="${key}"><legend>${label} <small>Plusieurs réponses possibles</small></legend>
      ${fbHas(q) ? fbHtml(options) : ''}<div class="mf-chips is-text">${options.map((o, i) => `<label class="mf-chip">
        <input type="checkbox" name="${id}" value="${escapeHtml(o)}" data-mf-answer="${key}" data-mf-kind="multi"${i === 0 ? ` id="${id}"` : ''}>
        <span class="mf-chip-v">${escapeHtml(o)}</span></label>`).join('')}</div></fieldset>`;
  }
  if (q.type === 'choice') {
    const options = Array.isArray(q.options) ? q.options : [];
    if (options.length <= MF_CHIPS_MAX) return chips(options.map(o => ({ value: o, text: o, kind: 'text' })), ' is-text');
    return field(`<select id="${id}" data-mf-answer="${key}" data-mf-kind="text"><option value="">Choisir</option>${options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}</select>`);
  }
  if (q.curseur === true) return fsHtml(q, id, key, label);   // échelle en curseur (form-slider.js)
  const levels = fqLevels(q);   // échelle : la valeur reste un nombre, le libellé s'affiche
  return chips(levels.map(n => ({ value: String(n.valeur), text: String(n.valeur), sub: levels.length <= 5 ? n.libelle : '', color: n.couleur, kind: 'number' })),
    levels.length > 6 ? ' is-scale is-long' : ' is-scale');
}

/* Les réponses d'un questionnaire, chacune avec son vrai type. Erreur : la première question à revoir. */
function mfAnswers(form, questions) {
  const answers = {};
  for (const q of questions) {
    const inputs = [...form.querySelectorAll('[data-mf-answer]')].filter(x => x.dataset.mfAnswer === q.id);
    if (inputs[0]?.type === 'checkbox') {   // choix multiple : la liste cochée, rien coché = sans réponse
      const picked = inputs.filter(x => x.checked).map(x => x.value);
      if (!picked.length && q.required) return { error: `Réponds à « ${q.label} ».`, q };
      answers[q.id] = picked.length ? picked : null;
      continue;
    }
    const input = inputs.find(x => x.type !== 'radio') || inputs.find(x => x.checked) || null;
    const raw = input ? input.value.trim() : '';
    let value = null;
    if (raw !== '') {
      const kind = input.dataset.mfKind;
      if (kind === 'number') {
        value = Number(raw.replace(',', '.'));
        if (!Number.isFinite(value)) return { error: `Indique un nombre pour « ${q.label} ».`, q };
      } else value = kind === 'boolean' ? raw === 'true' : raw;
    }
    if (value === null && q.required) return { error: `Réponds à « ${q.label} ».`, q };
    answers[q.id] = value;
  }
  return { answers };
}

/* Réponses données / questions, et le libellé du niveau choisi sous l'échelle. */
function mfProgress(e) {
  const form = e.target.closest?.('[data-mf-form]');
  if (!form) return;
  const questions = MF.pending[Number(form.dataset.mfIndex)]?.questions || [];
  const done = questions.filter(q => [...form.querySelectorAll('[data-mf-answer]')].some(x => x.dataset.mfAnswer === q.id && (['radio', 'checkbox'].includes(x.type) ? x.checked : x.value.trim() !== ''))).length;
  const n = form.closest('[data-mf-card]')?.querySelector('[data-mf-n]');
  if (n) n.textContent = done ? `${done}/${questions.length} répondues` : `${questions.length} question${questions.length === 1 ? '' : 's'}`;
  const box = e.target.closest?.('[data-mf-q]');
  if (box) box.classList.remove('is-missing');
  const out = box?.querySelector('[data-mf-out]'), q = questions.find(x => x.id === box?.dataset.mfQ);
  if (out && q) out.textContent = fqLevel(q, box.querySelector('input:checked')?.value)?.libelle || '';
}

/* Un seul questionnaire ouvert : en ouvrir un referme les autres. */
function mfToggle(e) {
  const card = e.target;
  if (!card.matches?.('[data-mf-card]') || !card.open) return;
  document.querySelectorAll('[data-mf-card][open]').forEach(x => { if (x !== card) x.open = false; });
}

async function mfSubmit(e) {
  const form = e.target.closest('[data-mf-form]');
  if (!form) return;
  e.preventDefault();
  if (MF.busy) return;
  const source = MF.pending[Number(form.dataset.mfIndex)];
  const error = form.querySelector('[data-mf-error]'), button = form.querySelector('button[type="submit"]');
  const read = mfAnswers(form, source?.questions || []);
  error.classList.remove('mf-success');
  if (read.error) {
    error.textContent = read.error;
    const box = [...form.querySelectorAll('[data-mf-q]')].find(x => x.dataset.mfQ === read.q.id);
    box?.classList.add('is-missing');
    box?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box?.querySelector('input, select, textarea')?.focus({ preventScroll: true });
    return;
  }
  const versionId = Number(form.dataset.mfForm);
  MF.busy = true; button.disabled = true; error.textContent = 'Envoi…';
  try {
    if (MF.demo) {
      MF.history.unshift({ response_id: Date.now(), titre: source.titre.split(' · ')[0], version_no: source.version_no,
        team_nom: source.team_nom, submitted_at: new Date().toISOString(), questions: source.questions, answers: read.answers });
      MF.pending = MF.pending.filter(x => x !== source);
      mfRender();
    } else {
      const { error: submitError } = await sb.rpc('custom_form_submit', { p_version_id: versionId, p_answers: read.answers, p_occurrence: form.dataset.mfOccurrence });
      if (submitError) throw submitError;
      await mfLoad();
    }
    toast('Réponse envoyée. Elle est maintenant dans « Mes réponses ».', 'success');
  } catch (err) {
    console.error('Réponse au formulaire non envoyée', err);
    error.textContent = mfError(err);
    button.disabled = false;
  } finally { MF.busy = false; }
}

/* Une réponse envoyée, repliée : titre et heure ; ouverte, chaque question et la réponse enregistrée. */
function mfHistoryHtml(response) {
  const questions = Array.isArray(response.questions) ? response.questions : [];
  const answers = response.answers && typeof response.answers === 'object' ? response.answers : {};
  const when = response.submitted_at ? new Date(response.submitted_at) : null;
  const time = when && !Number.isNaN(when.getTime()) ? new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short' }).format(when) : '';
  const [title, ...context] = String(response.titre || 'Formulaire').split(' · ');
  return `<details class="mf-history-card">
    <summary><span class="mf-card-title">${escapeHtml(title)}</span>
      <span class="mf-card-sub">${escapeHtml([context.join(' · '), response.team_nom].filter(Boolean).join(' | '))}</span>
      <time datetime="${escapeHtml(response.submitted_at || '')}">${escapeHtml(time)}</time></summary>
    <dl class="mf-answer-list">${questions.filter(q => !q.fixe).map(q => `<div class="mf-answer"><dt>${escapeHtml(q.label || 'Question')}</dt>
      <dd>${escapeHtml(fqAnswerText(q, answers[q.id]) || 'Sans réponse')}</dd></div>`).join('')}</dl>
  </details>`;
}
