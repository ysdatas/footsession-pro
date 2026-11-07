/* Éditeur d'un formulaire (formulaires-page.js) : fenêtre, questions, lecture.
   Les questions d'origine (fixe, lmfc_v47.sql) ne changent que d'intitulé : la base le vérifie. */
const CF_LEAD = 'Les réponses déjà reçues ne changent pas. Modifier les questions propose de nouveau le formulaire aux joueurs ; le renommer, non.';
const CF_LEAD_ORIGIN = 'Les réponses déjà reçues ne changent pas. Une question ajoutée est posée dans « Mes formulaires », après la réponse d’origine. Une équipe n’a qu’un formulaire de chaque sorte : la cocher ici la retire de l’autre.';

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
  document.getElementById('cfTeams').innerHTML = CF.teams.length ? CF.teams.map(team => `<label class="cf-team"><input type="checkbox" value="${team.id}"${form?.team_ids.includes(Number(team.id)) ? ' checked' : ''}><span>${escapeHtml(team.nom)}</span></label>`).join('')
    : '<p class="text-muted">Aucune équipe n’est disponible dans votre périmètre.</p>';
  const questions = form?.version?.questions || [{ id: cfUid(), label: '', type: 'text', required: true }];
  document.getElementById('cfQuestions').innerHTML = questions.map(cfQuestionHtml).join('');
  cfCountQuestions();
  document.getElementById('cfSave').disabled = false;
  openModal('cfEditor');
  document.getElementById('cfName').focus();
}

function cfQuestionHtml(question) {
  const id = question.id || cfUid(), choices = Array.isArray(question.options) ? question.options.join('\n') : '';
  const lock = question.fixe ? ' disabled' : '';   // question d'origine : seul son intitulé change (lmfc_v47.sql)
  return `<fieldset class="cf-question" data-question-id="${escapeHtml(id)}">
    <legend class="sr-only">Question</legend>
    <div class="cf-question-fields">
      <div class="field"><label for="cf-label-${escapeHtml(id)}">Intitulé</label><input id="cf-label-${escapeHtml(id)}" data-cf-label required maxlength="180" value="${escapeHtml(question.label || '')}" placeholder="Votre question"></div>
      <div class="field"><label for="cf-type-${escapeHtml(id)}">Type de réponse</label><select id="cf-type-${escapeHtml(id)}" data-cf-type${lock}>${Object.entries(cfTypeLabels).map(([value, label]) => `<option value="${value}"${question.type === value ? ' selected' : ''}>${label}</option>`).join('')}</select></div>
      <div class="field cf-q-options${question.type === 'choice' && !question.fixe ? '' : ' hidden'}"><label for="cf-options-${escapeHtml(id)}">Choix proposés, un par ligne</label><textarea id="cf-options-${escapeHtml(id)}" data-cf-options rows="3" maxlength="1000" placeholder="Option 1\nOption 2">${escapeHtml(choices)}</textarea></div>
      <label class="check cf-q-required"><input type="checkbox" data-cf-required${question.required === false ? '' : ' checked'}${lock}> Réponse obligatoire</label>
    </div>
    ${question.fixe && !question.retirable ? '<span class="cf-q-lock">Question d’origine</span>'
      : '<button class="btn btn-sm cf-q-remove" type="button" data-cf-remove-question aria-label="Supprimer cette question">Retirer</button>'}
  </fieldset>`;
}

function cfQuestionChange(e) {
  const select = e.target.closest('[data-cf-type]');
  if (!select) return;
  select.closest('.cf-question').querySelector('.cf-q-options').classList.toggle('hidden', select.value !== 'choice');
}

function cfCountQuestions() {
  const count = document.querySelectorAll('#cfQuestions .cf-question').length;
  document.getElementById('cfQuestionCount').textContent = `(${count}/30)`;
  document.querySelector('[data-cf-add-question]').disabled = count >= 30;
}

function cfReadEditor() {
  const questions = [...document.querySelectorAll('#cfQuestions .cf-question')].map(row => {
    const origin = CF.editing?.version?.questions?.find(x => x.id === row.dataset.questionId && x.fixe);
    if (origin) return { ...origin, label: row.querySelector('[data-cf-label]').value.trim() };
    const type = row.querySelector('[data-cf-type]').value;
    const q = { id: row.dataset.questionId, label: row.querySelector('[data-cf-label]').value.trim(), type,
      required: row.querySelector('[data-cf-required]').checked };
    if (type === 'choice') q.options = row.querySelector('[data-cf-options]').value.split('\n').map(x => x.trim()).filter(Boolean);
    if (type === 'scale') { q.min = 1; q.max = 10; }
    return q;
  });
  return { id: CF.editing?.id ?? null, copy_of: CF.editing?.copy_of ?? null, source: CF.editing?.source ?? null, title: document.getElementById('cfName').value.trim(),
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
  if (form.active && !form.team_ids.length) { message.textContent = 'Affectez un formulaire actif à au moins une équipe.'; return; }
  if (form.questions.some(q => q.type === 'choice' && (q.options.length < 2 || new Set(q.options.map(x => x.toLocaleLowerCase('fr'))).size !== q.options.length))) {
    message.textContent = 'Chaque question à choix doit avoir au moins deux options distinctes.'; return;
  }
  await cfPersist(form);
}
