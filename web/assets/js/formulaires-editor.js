/* Éditeur d'un formulaire (formulaires-page.js) : fenêtre, questions, lecture.
   Les questions d'origine (fixe, lmfc_v47.sql) ne changent que d'intitulé, et de niveaux
   pour le RPE (lmfc_v63.sql) : la base le vérifie. Les questions se déplacent (↑ ↓) ;
   une échelle se règle niveau par niveau (valeur, libellé, couleur) : la valeur reste
   le nombre enregistré, utile aux calculs. */
const CF_LEAD = 'Les réponses déjà reçues ne changent pas. Modifier les questions propose de nouveau le formulaire aux joueurs ; le renommer, non.';
const CF_LEAD_ORIGIN = 'Les réponses déjà reçues ne changent pas. Une question ajoutée est posée dans « Mes formulaires », après la réponse d’origine. Une équipe n’a qu’un formulaire de chaque sorte : la cocher ici la retire de l’autre.';
const CF_PALETTE = ['#2e7d32', '#ef6c00', '#c62828'];   // couleur proposée pour un nouveau niveau : vert, orange, rouge
/* Réglages rapides d'une échelle : remplacent les niveaux affichés, modifiables ensuite. */
const CF_PRESETS = {
  '0-10': () => cfRange(0, 10), '1-10': () => cfRange(1, 10), '1-5': () => cfRange(1, 5),
  intensite: () => FQ_RPE_PRESET.map(n => ({ ...n })),
};
function cfRange(min, max) { return Array.from({ length: max - min + 1 }, (_, i) => ({ valeur: min + i, libelle: '', couleur: null })); }

function cfOpen(id, copy = false) {
  const found = id == null ? null : CF.forms.find(x => Number(x.id) === Number(id));
  if (id != null && !found) return;
  // Une copie n'existe qu'à l'enregistrement : annuler ne laisse rien derrière soi.
  const form = copy ? { ...found, id: null, copy_of: found.id, titre: `${found.titre} (copie)`.slice(0, 100), actif: true, team_ids: [] } : found;
  CF.editing = form;
  document.getElementById('cfTitle').textContent = copy ? `Copier « ${found.titre} »` : form ? `Modifier « ${form.titre} »` : 'Nouveau formulaire';
  document.getElementById('cfLead').textContent = form?.source ? CF_LEAD_ORIGIN : CF_LEAD;
  document.getElementById('cfName').value = form?.titre || '';
  document.getElementById('cfDescription').value = form?.description || '';
  document.getElementById('cfActive').checked = form?.actif ?? true;
  document.getElementById('cfEditorStatus').textContent = '';
  cfPlanFill(form, copy);
  document.getElementById('cfTeams').innerHTML = CF.teams.length ? CF.teams.map(team => `<label class="cf-team"><input type="checkbox" value="${team.id}"${form?.team_ids.includes(Number(team.id)) ? ' checked' : ''}><span>${escapeHtml(team.nom)}</span></label>`).join('')
    : '<p class="text-muted">Aucune équipe n’est disponible dans votre périmètre.</p>';
  const questions = form?.version?.questions || [{ id: cfUid(), label: '', type: 'text', required: true }];
  document.getElementById('cfQuestions').innerHTML = questions.map(cfQuestionHtml).join('');
  cfCountQuestions();
  document.getElementById('cfSave').disabled = false;
  openModal('cfEditor');
  document.getElementById('cfName').focus();
}

/* Quand le poser (lmfc_v65.sql) : moment, jours, veille ou jour du match, période.
   Après séance ou match : choisi à la création seulement (le formulaire en devient une copie
   du formulaire d'origine) ; un formulaire d'origine ne règle que sa période. */
const CF_SOURCES = ['rpe_seance', 'rpe_match'];
function cfPlanFill(form, copy) {
  const moment = document.getElementById('cfMoment'), plan = form?.planning || {};
  const fixed = !!form?.source;   // après séance, match, courbatures, avis : la sorte ne change pas
  moment.querySelectorAll('[data-cf-extra]').forEach(o => o.remove());
  // Un formulaire « une fois » ou planifié ne devient pas un formulaire après séance : on en crée un nouveau.
  moment.querySelectorAll('option').forEach(o => { o.disabled = fixed ? o.value !== form.source : !!form && CF_SOURCES.includes(o.value); });
  if (fixed && !moment.querySelector(`option[value="${form.source}"]`)) moment.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(form.source)}" data-cf-extra>${escapeHtml(cfSources[form.source]?.quand || form.source)}</option>`);
  moment.value = fixed ? form.source : plan.mode || '';
  moment.disabled = fixed;
  document.querySelectorAll('#cfDays input').forEach(x => { x.checked = (plan.jours || []).includes(Number(x.value)); });
  document.getElementById('cfMatchWhen').value = plan.quand || 'veille';
  document.getElementById('cfFrom').value = plan.du || '';
  document.getElementById('cfTo').value = plan.au || '';
  cfPlanUi();
}

function cfPlanUi() {
  const mode = document.getElementById('cfMoment').value;
  document.getElementById('cfDays').classList.toggle('hidden', mode !== 'semaine');
  document.getElementById('cfMatchWhenField').classList.toggle('hidden', mode !== 'avant_match');
}

/* Le réglage lu dans l'éditeur ; null : une fois, sans période. error si incomplet. */
function cfReadPlan(source) {
  const mode = document.getElementById('cfMoment').value, du = document.getElementById('cfFrom').value, au = document.getElementById('cfTo').value;
  const plan = {};
  if (['jour', 'semaine', 'avant_match'].includes(mode) && !source) plan.mode = mode;
  if (plan.mode === 'semaine') {
    plan.jours = [...document.querySelectorAll('#cfDays input:checked')].map(x => Number(x.value));
    if (!plan.jours.length) return { error: 'Cochez au moins un jour de la semaine.' };
  }
  if (plan.mode === 'avant_match') plan.quand = document.getElementById('cfMatchWhen').value;
  if (du) plan.du = du;
  if (au) plan.au = au;
  if (du && au && du > au) return { error: 'La période commence après sa fin : vérifiez Du et Au.' };
  return { plan: Object.keys(plan).length ? plan : null };
}

/* Nouveau formulaire posé après chaque séance ou match : il part d'une copie du formulaire d'origine
   du club (custom_form_duplicate), dont la question RPE vient en tête, verrouillée. */
function cfMomentChange() {
  cfPlanUi();
  if (CF.editing?.id || (CF.editing?.source && !CF.editing?.copy_of)) return;   // formulaire enregistré : sa sorte ne change pas
  const source = CF_SOURCES.includes(document.getElementById('cfMoment').value) ? document.getElementById('cfMoment').value : '';
  if (source === (CF.editing?.source || '')) return;
  document.querySelectorAll('#cfQuestions .cf-question[data-fixe]').forEach(x => x.remove());
  const base = source ? CF.forms.find(f => f.source === source && !f.created_by) || CF.forms.find(f => f.source === source) : null;
  if (source && !base) {
    document.getElementById('cfEditorStatus').textContent = 'Le formulaire d’origine de ce moment n’est pas visible : demandez à un administrateur.';
    document.getElementById('cfMoment').value = '';
  }
  const fixed = (base?.version?.questions || []).filter(q => q.fixe);
  CF.editing = base ? { source, copy_of: base.id, version: { questions: fixed } } : null;
  document.getElementById('cfQuestions').insertAdjacentHTML('afterbegin', fixed.map(cfQuestionHtml).join(''));
  document.getElementById('cfLead').textContent = base ? CF_LEAD_ORIGIN : CF_LEAD;
  cfCountQuestions();
}

function cfQuestionHtml(question) {
  const id = escapeHtml(question.id || cfUid()), choices = Array.isArray(question.options) ? question.options.join('\n') : '';
  const lock = question.fixe ? ' disabled' : '';   // question d'origine : seul son intitulé change (lmfc_v47.sql)
  const levels = question.type === 'scale' && (!question.fixe || question.id === 'rpe');
  return `<fieldset class="cf-question" data-question-id="${id}"${question.fixe ? ' data-fixe' : ''}>
    <legend class="sr-only">Question</legend>
    <div class="cf-question-fields">
      <div class="field"><label for="cf-label-${id}">Intitulé</label><input id="cf-label-${id}" data-cf-label required maxlength="180" value="${escapeHtml(question.label || '')}" placeholder="Votre question"></div>
      <div class="field"><label for="cf-type-${id}">Type de réponse</label><select id="cf-type-${id}" data-cf-type${lock}>${Object.entries(cfTypeLabels).map(([value, label]) => `<option value="${value}"${question.type === value ? ' selected' : ''}>${label}</option>`).join('')}</select></div>
      <div class="field cf-q-options${question.type === 'choice' && !question.fixe ? '' : ' hidden'}"><label for="cf-options-${id}">Choix proposés, un par ligne</label><textarea id="cf-options-${id}" data-cf-options rows="3" maxlength="1000" placeholder="Option 1\nOption 2">${escapeHtml(choices)}</textarea></div>
      <div class="cf-q-levels${levels ? '' : ' hidden'}" data-cf-levels-box>${cfLevelsHtml(question)}</div>
      <label class="check cf-q-required"><input type="checkbox" data-cf-required${question.required === false ? '' : ' checked'}${lock}> Réponse obligatoire</label>
    </div>
    <div class="cf-q-actions">
      <button class="btn btn-sm btn-icon" type="button" data-cf-move="-1" aria-label="Monter la question">↑</button>
      <button class="btn btn-sm btn-icon" type="button" data-cf-move="1" aria-label="Descendre la question">↓</button>
      ${question.fixe && !question.retirable ? '<span class="cf-q-lock">Question d’origine</span>'
        : '<button class="btn btn-sm cf-q-remove" type="button" data-cf-remove-question aria-label="Supprimer cette question">Retirer</button>'}
    </div>
  </fieldset>`;
}

/* Les niveaux d'une échelle : valeur, libellé, couleur (facultative). */
function cfLevelsHtml(question) {
  const fixed = !!question.fixe;
  const levels = question.type === 'scale' ? fqLevels(question) : cfRange(1, 10);
  return `<p class="cf-levels-head">Niveaux de l’échelle <span class="text-muted">${fixed ? '(valeurs de 1 à 10 : le RPE en dépend)' : '(valeur enregistrée, libellé et couleur montrés au joueur)'}</span></p>
    <div class="cf-levels-presets" role="group" aria-label="Réglages rapides">
      ${fixed ? '' : '<button class="btn btn-sm" type="button" data-cf-preset="0-10">0 à 10</button><button class="btn btn-sm" type="button" data-cf-preset="1-10">1 à 10</button><button class="btn btn-sm" type="button" data-cf-preset="1-5">1 à 5</button>'}
      <button class="btn btn-sm" type="button" data-cf-preset="intensite">Intensité 1 à 10 (libellés)</button>
    </div>
    <div class="cf-levels" data-cf-levels>${levels.map(cfLevelRow).join('')}</div>
    <button class="btn btn-sm" type="button" data-cf-level-add>+ Niveau</button>`;
}

function cfLevelRow(n) {
  const uid = cfUid(), color = /^#[0-9a-f]{6}$/i.test(n.couleur || '') ? n.couleur : '';
  return `<div class="cf-level" data-cf-level>
    <label class="sr-only" for="cf-lv-v-${uid}">Valeur</label><input id="cf-lv-v-${uid}" class="cf-level-v" type="number" min="0" max="10" step="1" value="${Number(n.valeur)}" data-cf-lv-value required>
    <label class="sr-only" for="cf-lv-l-${uid}">Libellé</label><input id="cf-lv-l-${uid}" class="cf-level-l" maxlength="60" value="${escapeHtml(n.libelle || '')}" placeholder="Libellé (facultatif)" data-cf-lv-label>
    <label class="cf-level-c" title="Couleur"><input type="checkbox" data-cf-lv-colored${color ? ' checked' : ''} aria-label="Couleur pour ce niveau">
      <input type="color" value="${color || CF_PALETTE[Math.min(2, Math.floor(Number(n.valeur) / 4))]}" data-cf-lv-color aria-label="Couleur du niveau"></label>
    <button class="btn btn-sm cf-level-x" type="button" data-cf-level-remove aria-label="Retirer ce niveau">×</button>
  </div>`;
}

/* Clics de l'éditeur : déplacer une question, régler ses niveaux. Rend true si le clic est traité. */
function cfEditorClick(e) {
  const move = e.target.closest('[data-cf-move]');
  if (move) {
    const row = move.closest('.cf-question'), up = move.dataset.cfMove === '-1';
    const other = up ? row.previousElementSibling : row.nextElementSibling;
    if (other) { up ? other.before(row) : other.after(row); move.focus(); }
    return true;
  }
  const preset = e.target.closest('[data-cf-preset]');
  if (preset) {
    preset.closest('[data-cf-levels-box]').querySelector('[data-cf-levels]').innerHTML = CF_PRESETS[preset.dataset.cfPreset]().map(cfLevelRow).join('');
    return true;
  }
  const add = e.target.closest('[data-cf-level-add]');
  if (add) {
    const list = add.closest('[data-cf-levels-box]').querySelector('[data-cf-levels]');
    const used = [...list.querySelectorAll('[data-cf-lv-value]')].map(x => Number(x.value));
    const next = [...Array(11).keys()].find(v => !used.includes(v) && v > Math.max(-1, ...used)) ?? [...Array(11).keys()].find(v => !used.includes(v));
    if (next == null || used.length >= 11) { toast('Une échelle a 11 niveaux au plus (de 0 à 10).', 'error'); return true; }
    list.insertAdjacentHTML('beforeend', cfLevelRow({ valeur: next, libelle: '', couleur: null }));
    return true;
  }
  const remove = e.target.closest('[data-cf-level-remove]');
  if (remove) {
    if (remove.closest('[data-cf-levels]').children.length <= 2) { toast('Une échelle garde au moins deux niveaux.', 'error'); return true; }
    remove.closest('[data-cf-level]').remove();
    return true;
  }
  return false;
}

function cfQuestionChange(e) {
  if (e.target.matches('[data-cf-lv-color]')) { e.target.closest('.cf-level-c').querySelector('[data-cf-lv-colored]').checked = true; return; }
  const select = e.target.closest('[data-cf-type]');
  if (!select) return;
  const row = select.closest('.cf-question');
  row.querySelector('.cf-q-options').classList.toggle('hidden', select.value !== 'choice');
  row.querySelector('[data-cf-levels-box]').classList.toggle('hidden', select.value !== 'scale');
}

function cfCountQuestions() {
  const count = document.querySelectorAll('#cfQuestions .cf-question').length;
  document.getElementById('cfQuestionCount').textContent = `(${count}/30)`;
  document.querySelector('[data-cf-add-question]').disabled = count >= 30;
}

/* Les niveaux lus dans l'éditeur ; error si une valeur est fausse ou en double. */
function cfReadLevels(row) {
  const levels = [...row.querySelectorAll('[data-cf-level]')].map(x => ({
    valeur: Number(x.querySelector('[data-cf-lv-value]').value),
    libelle: x.querySelector('[data-cf-lv-label]').value.trim(),
    couleur: x.querySelector('[data-cf-lv-colored]').checked ? x.querySelector('[data-cf-lv-color]').value : null,
  })).sort((a, b) => a.valeur - b.valeur);
  const bad = levels.length < 2 || levels.some(n => !Number.isInteger(n.valeur) || n.valeur < 0 || n.valeur > 10)
    || new Set(levels.map(n => n.valeur)).size !== levels.length;
  return { levels, bad };
}

/* Une échelle : sans libellé ni couleur et sans trou, de simples bornes ; sinon ses niveaux. */
function cfScale(q, row, fixed) {
  const { levels, bad } = cfReadLevels(row);
  if (bad) return { error: `« ${q.label || 'Échelle'} » : de 2 à 11 niveaux, valeurs entières distinctes de 0 à 10.` };
  const min = fixed ? q.min : levels[0].valeur, max = fixed ? q.max : levels[levels.length - 1].valeur;
  if (fixed && levels.some(n => n.valeur < min || n.valeur > max)) return { error: `« ${q.label} » : valeurs de ${min} à ${max}.` };
  const plain = levels.every(n => !n.libelle && !n.couleur) && levels.length === max - min + 1;
  const out = { ...q, min, max };
  delete out.niveaux;
  if (!plain) out.niveaux = levels;
  if (!fixed && out.min === out.max) return { error: `« ${q.label} » : au moins deux valeurs.` };
  return { q: out };
}

function cfReadEditor() {
  let error = null;
  const questions = [...document.querySelectorAll('#cfQuestions .cf-question')].map(row => {
    const origin = CF.editing?.version?.questions?.find(x => x.id === row.dataset.questionId && x.fixe);
    if (origin) {
      const q = { ...origin, label: row.querySelector('[data-cf-label]').value.trim() };
      if (origin.type !== 'scale' || origin.id !== 'rpe') return q;
      const r = cfScale(q, row, true);
      error ||= r.error;
      return r.q || q;
    }
    const type = row.querySelector('[data-cf-type]').value;
    // Une question déjà enregistrée garde sa règle d'alerte (lmfc_v62.sql) tant que son type ne change pas.
    const prev = CF.editing?.version?.questions?.find(x => x.id === row.dataset.questionId && x.type === type);
    const q = { ...(prev?.alerte ? { alerte: prev.alerte } : {}), id: row.dataset.questionId,
      label: row.querySelector('[data-cf-label]').value.trim(), type, required: row.querySelector('[data-cf-required]').checked };
    if (type === 'choice') q.options = row.querySelector('[data-cf-options]').value.split('\n').map(x => x.trim()).filter(Boolean);
    if (type !== 'scale') return q;
    const r = cfScale(q, row, false);
    error ||= r.error;
    return r.q || q;
  });
  const plan = cfReadPlan(CF.editing?.source);
  error ||= plan.error;
  return { error, planning: plan.plan ?? null, id: CF.editing?.id ?? null, copy_of: CF.editing?.copy_of ?? null, source: CF.editing?.source ?? null, title: document.getElementById('cfName').value.trim(),
    description: document.getElementById('cfDescription').value.trim() || null, questions,
    team_ids: [...document.querySelectorAll('#cfTeams input:checked')].map(x => Number(x.value)),
    active: document.getElementById('cfActive').checked, expected_version: CF.editing?.version?.version_no ?? null };
}

async function cfSave(e) {
  e.preventDefault();
  if (CF.busy) return;
  const form = cfReadEditor();
  const message = document.getElementById('cfEditorStatus');
  if (!form.title || form.questions.some(q => !q.label)) { message.textContent = 'Renseignez le nom du formulaire et chaque question.'; return; }
  if (form.error) { message.textContent = form.error; return; }
  if (form.active && !form.team_ids.length) { message.textContent = 'Affectez un formulaire actif à au moins une équipe.'; return; }
  if (form.questions.some(q => q.type === 'choice' && (q.options.length < 2 || new Set(q.options.map(x => x.toLocaleLowerCase('fr'))).size !== q.options.length))) {
    message.textContent = 'Chaque question à choix doit avoir au moins deux options distinctes.'; return;
  }
  delete form.error;
  await cfPersist(form);
}
