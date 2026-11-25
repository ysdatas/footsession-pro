/* Éditeur d'un formulaire (formulaires-page.js) : fenêtre, questions, lecture.
   Le type de réponse se choisit comme le joueur le verra : Curseur, Pastilles, Oui / non,
   Choix unique ou multiple, Silhouette du corps, Nombre, Texte (CF_KINDS) ; « Curseur »
   et « Pastilles » sont deux échelles (curseur : false pour les pastilles), « Silhouette »
   un choix multiple marqué corps (form-body.js).
   Les questions d'origine (fixe, lmfc_v47.sql) ne changent que d'intitulé, et de niveaux
   pour le RPE (lmfc_v63.sql) : la base le vérifie. Les questions se déplacent (↑ ↓) ;
   une échelle se règle niveau par niveau (valeur, libellé, couleur) : la valeur reste
   le nombre enregistré, utile aux calculs. */
const CF_LEAD = 'Les réponses déjà reçues ne changent pas. Changer les questions repropose le formulaire aux joueurs ; le renommer, non.';
const CF_LEAD_ORIGIN = 'Les réponses déjà reçues ne changent pas. Les questions ajoutées sont posées avec la question d’origine, sur le même écran. Une équipe n’a qu’un formulaire de chaque sorte : la cocher ici la retire de l’autre.';
/* [valeur, libellé, groupe, ce que voit le joueur] */
const CF_KINDS = [
  ['scale', 'Curseur', 'Échelle', 'Le joueur glisse un curseur coloré d’un niveau à l’autre.'],
  ['scale-chips', 'Pastilles', 'Échelle', 'Le joueur touche une pastille par niveau.'],
  ['boolean', 'Oui / non', 'Choix', 'Deux boutons : Oui, Non.'],
  ['choice', 'Choix unique', 'Choix', 'Une seule réponse parmi vos choix.'],
  ['multi', 'Choix multiple', 'Choix', 'Plusieurs réponses possibles parmi vos choix.'],
  ['body', 'Silhouette du corps', 'Choix', 'Le joueur touche les zones du corps, face et dos (plusieurs possibles).'],
  ['number', 'Nombre', 'Saisie libre', 'Un nombre : minutes, kilos…'],
  ['text', 'Texte court', 'Saisie libre', 'Une ligne de texte.'],
  ['textarea', 'Texte long', 'Saisie libre', 'Un commentaire de quelques lignes.'],
];
const cfKindOf = (q) => (q.type === 'scale' ? (q.curseur === false ? 'scale-chips' : 'scale') : q.type === 'multi' && q.corps ? 'body' : q.type);
const cfKindType = (k) => (k === 'scale-chips' ? 'scale' : k === 'body' ? 'multi' : k);
const cfKindHint = (k) => CF_KINDS.find(x => x[0] === k)?.[3] || '';
/* Une question neuve, du type choisi (boutons « Ajouter », formulaires-page.js). */
function cfNewQuestion(kind) {
  const q = { id: cfUid(), label: '', type: cfKindType(kind), required: true };
  if (q.type === 'scale') Object.assign(q, { min: 0, max: 10, curseur: kind === 'scale' });
  if (kind === 'body') Object.assign(q, { corps: true, options: [...FB_DEFAULT] });
  return q;
}

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
  // Un formulaire existant s'ouvre replié : réglages résumés, une ligne par question ; un nouveau, tout ouvert.
  const fresh = !form?.id;
  document.getElementById('cfSettings').open = fresh;
  document.getElementById('cfQuestions').innerHTML = questions.map(q => cfQuestionHtml(q, fresh)).join('');
  cfSettingsSum();
  cfCountQuestions();
  document.getElementById('cfSave').disabled = false;
  openModal('cfEditor');
  document.getElementById('cfName').focus();
}

/* Quand le poser (lmfc_v65.sql) : moment, jours, veille ou jour du match, période.
   Après séance ou match : choisi à la création seulement (le formulaire en devient une copie
   du formulaire d'origine) ; un formulaire d'origine ne règle que sa période. */
const CF_SOURCES = ['rpe_seance', 'rpe_match'];
const CF_MODES = ['jour', 'semaine', 'seance', 'avant_match', 'apres_seance', 'apres_match'];   // planning (lmfc_v65.sql, lmfc_v72.sql)
function cfPlanFill(form, copy) {
  const moment = document.getElementById('cfMoment'), plan = form?.planning || {};
  const fixed = !!form?.source;   // après séance, match, courbatures, avis : la sorte ne change pas
  moment.querySelectorAll('[data-cf-extra]').forEach(o => o.remove());
  // Un formulaire « une fois » ou planifié ne devient pas un formulaire après séance : on en crée un nouveau.
  moment.querySelectorAll('option').forEach(o => { o.disabled = fixed ? o.value !== form.source : !!form && CF_SOURCES.includes(o.value); });
  if (fixed && !moment.querySelector(`option[value="${form.source}"]`)) moment.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(form.source)}" data-cf-extra>${escapeHtml(cfSources[form.source]?.quand || form.source)}</option>`);
  moment.value = fixed ? form.source : plan.mode || '';
  moment.disabled = fixed;
  document.getElementById('cfMomentLock').classList.toggle('hidden', !fixed);
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
  if (CF_MODES.includes(mode) && !source) plan.mode = mode;
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
  document.getElementById('cfQuestions').insertAdjacentHTML('afterbegin', fixed.map(q => cfQuestionHtml(q, false)).join(''));
  document.getElementById('cfLead').textContent = base ? CF_LEAD_ORIGIN : CF_LEAD;
  cfCountQuestions();
}

/* Une question, repliable : replié, son intitulé et son type de réponse sur une ligne. */
function cfQuestionHtml(question, open = true) {
  const id = escapeHtml(question.id || cfUid()), choices = Array.isArray(question.options) ? question.options.join('\n') : '';
  const lock = question.fixe ? ' disabled' : '';   // question d'origine : seul son intitulé change (lmfc_v47.sql)
  const kind = cfKindOf(question), type = cfKindType(kind);
  const levels = type === 'scale' && (!question.fixe || question.id === 'rpe');
  const groups = [...new Set(CF_KINDS.map(k => k[2]))].map(g => `<optgroup label="${g}">${CF_KINDS.filter(k => k[2] === g)
    .map(([v, l]) => `<option value="${v}"${kind === v ? ' selected' : ''}>${l}</option>`).join('')}</optgroup>`).join('');
  return `<details class="cf-question" data-question-id="${id}"${question.fixe ? ' data-fixe' : ''}${open ? ' open' : ''}>
    <summary class="cf-q-sum"><span class="cf-q-n" aria-hidden="true"></span><span class="cf-q-title" data-cf-sum>${escapeHtml(question.label || 'Nouvelle question')}</span>
      <span class="cf-q-chip" data-cf-sum-kind>${escapeHtml(CF_KINDS.find(k => k[0] === kind)?.[1] || '')}</span></summary>
    <div class="cf-q-body">
    <div class="cf-q-top">
      <div class="field cf-q-label"><label for="cf-label-${id}">Question</label><input id="cf-label-${id}" data-cf-label required maxlength="180" value="${escapeHtml(question.label || '')}" placeholder="Votre question"></div>
      <div class="cf-q-actions">
        <button class="btn btn-sm btn-icon" type="button" data-cf-move="-1" aria-label="Monter la question">↑</button>
        <button class="btn btn-sm btn-icon" type="button" data-cf-move="1" aria-label="Descendre la question">↓</button>
        ${question.fixe && !question.retirable ? '<span class="cf-q-lock">Question d’origine</span>'
          : '<button class="btn btn-sm btn-icon cf-q-remove" type="button" data-cf-remove-question aria-label="Retirer cette question">×</button>'}
      </div>
    </div>
    <div class="cf-q-row">
      <div class="field cf-q-kind"><label for="cf-type-${id}">Réponse</label><select id="cf-type-${id}" data-cf-type${lock}>${groups}</select></div>
      <label class="check cf-q-required"><input type="checkbox" data-cf-required${question.required === false ? '' : ' checked'}${lock}> Obligatoire</label>
    </div>
    <p class="cf-q-hint" data-cf-hint>${escapeHtml(cfKindHint(kind))}</p>
    <div class="field cf-q-options${['choice', 'multi'].includes(type) && !question.fixe ? '' : ' hidden'}"><label for="cf-options-${id}">Choix proposés, un par ligne</label><textarea id="cf-options-${id}" data-cf-options rows="3" maxlength="1000" placeholder="Option 1\nOption 2">${escapeHtml(choices)}</textarea></div>
    <details class="cf-q-levels${levels ? '' : ' hidden'}" data-cf-levels-box><summary>Régler les niveaux : valeurs, libellés, couleurs</summary>${cfLevelsHtml(question)}</details>
    </div></details>`;
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
  if (e.target.closest('[data-cf-fold]')) {   // tout ouvrir, ou tout replier
    const all = [...document.querySelectorAll('#cfQuestions .cf-question')], open = !all.every(d => d.open);
    all.forEach(d => { d.open = open; });
    return true;
  }
  return cfLevelsClick(e);   // formulaires-levels.js
}

function cfQuestionChange(e) {
  if (e.target.matches('[data-cf-lv-color]')) { e.target.closest('.cf-level-c').querySelector('[data-cf-lv-colored]').checked = true; return; }
  const select = e.target.closest('[data-cf-type]');
  if (!select) return;
  const row = select.closest('.cf-question'), kind = select.value, type = cfKindType(kind);
  const options = row.querySelector('[data-cf-options]');
  if (kind === 'body' && !options.value.trim()) options.value = FB_DEFAULT.join('\n');   // silhouette : toutes les zones
  row.querySelector('.cf-q-options').classList.toggle('hidden', !['choice', 'multi'].includes(type));
  row.querySelector('[data-cf-levels-box]').classList.toggle('hidden', type !== 'scale');
  row.querySelector('[data-cf-hint]').textContent = cfKindHint(kind);
  row.querySelector('[data-cf-sum-kind]').textContent = select.selectedOptions[0]?.textContent || '';
}

/* L'intitulé tapé se recopie sur la ligne repliée. */
function cfQuestionInput(e) {
  const label = e.target.closest('[data-cf-label]');
  if (label) label.closest('.cf-question').querySelector('[data-cf-sum]').textContent = label.value.trim() || 'Nouvelle question';
}

/* Réglages repliés : « Après chaque séance · N2, Espoirs ». */
function cfSettingsSum() {
  const moment = document.getElementById('cfMoment'), teams = [...document.querySelectorAll('#cfTeams input:checked')].map(x => x.nextElementSibling.textContent);
  document.getElementById('cfSettingsSum').textContent = [moment.selectedOptions[0]?.textContent, teams.join(', ') || 'aucune équipe'].filter(Boolean).join(' · ');
}

function cfCountQuestions() {
  const count = document.querySelectorAll('#cfQuestions .cf-question').length;
  document.getElementById('cfQuestionCount').textContent = `(${count}/30)`;
  document.querySelectorAll('[data-cf-add-question]').forEach(b => { b.disabled = count >= 30; });
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
    const kind = row.querySelector('[data-cf-type]').value, type = cfKindType(kind);
    // Une question déjà enregistrée garde sa règle d'alerte (lmfc_v62.sql) tant que son type ne change pas.
    const prev = CF.editing?.version?.questions?.find(x => x.id === row.dataset.questionId && x.type === type);
    const q = { ...(prev?.alerte ? { alerte: prev.alerte } : {}), id: row.dataset.questionId,
      label: row.querySelector('[data-cf-label]').value.trim(), type, required: row.querySelector('[data-cf-required]').checked };
    if (type === 'choice' || type === 'multi') q.options = row.querySelector('[data-cf-options]').value.split('\n').map(x => x.trim()).filter(Boolean);
    if (kind === 'body') q.corps = true;
    if (type !== 'scale') return q;
    q.curseur = kind === 'scale';   // form-slider.js : curseur, sinon pastilles
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
  if (form.questions.some(q => ['choice', 'multi'].includes(q.type) && (q.options.length < 2 || new Set(q.options.map(x => x.toLocaleLowerCase('fr'))).size !== q.options.length))) {
    message.textContent = 'Chaque question à choix doit avoir au moins deux options distinctes.'; return;
  }
  delete form.error;
  await cfPersist(form);
}
