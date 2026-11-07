/* Gestion des formulaires (lmfc_v44.sql, lmfc_v47.sql).
   Les formulaires sont versionnés et affectés aux équipes par RPC. Ceux d'origine
   (RPE, courbatures, avis de match) gardent leurs réponses dans leurs tables.
   L'éditeur est dans formulaires-editor.js. */
const CF = { profile: null, teams: [], forms: [], responses: [], editing: null, busy: false, demo: false, responseOnly: false };
const CF_PAGE = 300;   // réponses chargées à la fois
/* Les questionnaires d'origine : quand le joueur les reçoit, où lire leurs réponses. */
const cfSources = {
  rpe_seance: { quand: 'Après chaque séance', lieu: 'Suivi RPE', page: 'suivi-rpe' },
  rpe_match: { quand: 'Après chaque match', lieu: 'Suivi RPE', page: 'suivi-rpe' },
  courbatures: { quand: 'Les jours de séance, au réveil', lieu: 'Suivi RPE', page: 'suivi-rpe' },
  avis_match: { quand: 'Après chaque match', lieu: 'Matchs', page: 'matchs' },
};
const cfTypeLabels = { text: 'Texte court', textarea: 'Texte long', number: 'Nombre', scale: 'Échelle 1–10', choice: 'Choix', boolean: 'Oui / non' };
const cfUid = () => `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const cfError = (e) => ['42P01', '42703', 'PGRST202', 'PGRST205'].includes(e?.code)
  ? 'Les migrations lmfc_v44.sql, lmfc_v45.sql et lmfc_v47.sql sont nécessaires pour gérer les formulaires et consulter leurs réponses.'
  : e?.message || 'Une erreur est survenue.';

(async () => {
  if (cfLocalPreview()) {
    CF.demo = true;
    CF.profile = { id: 'local-preview', role: 'admin', club_id: 1, team_ids: [] };
    CF.teams = [{ id: 1, nom: 'Pro' }, { id: 2, nom: 'N2' }, { id: 3, nom: 'Espoirs' }, { id: 4, nom: 'U17' }];
    CF.forms = [
      { id: 9000, titre: 'Ton effort', description: null, actif: true, source: 'rpe_seance', team_ids: [1, 2, 3, 4], versions: [{ version_no: 1 }], version: { version_no: 1, questions: [
        { id: 'rpe', label: 'Comment as-tu ressenti l’effort de toute la séance ?', type: 'scale', min: 1, max: 10, required: true, fixe: true },
      ] } },
      { id: 9001, titre: 'Questionnaire d’effort', description: 'Exemple de formulaire attribué à deux équipes.', actif: true, team_ids: [1, 2], versions: [{ version_no: 1 }, { version_no: 2 }], version: { version_no: 2, questions: [
        { id: 'intensite', label: 'Comment évalues-tu l’intensité ?', type: 'scale', min: 1, max: 10, required: true },
        { id: 'ressenti', label: 'Un commentaire ?', type: 'textarea', required: false },
      ] } },
      { id: 9002, titre: 'Récupération', description: '', actif: false, team_ids: [4], versions: [{ version_no: 1 }], version: { version_no: 1, questions: [
        { id: 'sommeil', label: 'Comment as-tu dormi ?', type: 'choice', options: ['Bien', 'Moyen', 'Mal'], required: true },
      ] } },
    ];
    CF.responses = [{ id: 9004, player_name_snapshot: 'Joueur de démonstration', team_name_snapshot: 'Pro',
      form_title_snapshot: 'Questionnaire de récupération', version_no: 1, submitted_at: new Date().toISOString(),
      questions_snapshot: [{ id: 'sommeil', label: 'Comment as-tu dormi ?', type: 'choice' }, { id: 'note', label: 'Un commentaire ?', type: 'textarea' }],
      answers: { sommeil: 'Bien', note: 'Prêt pour la prochaine séance.' } }];
    cfBind();
    fillUserBlock('Aperçu local', 'Administrateur');
    document.getElementById('logoutLink')?.remove();
    document.getElementById('cfPreviewNotice').classList.remove('hidden');
    document.getElementById('cfResponsesStatus').textContent = '1 réponse – aperçu local';
    cfRender();
    cfRenderResponses();
    document.getElementById('cfStatus').textContent = '3 exemples – mode aperçu local';
    return;
  }
  const ctx = await requireAuth();
  if (!ctx) return;
  if (!['admin', 'prepa', 'coach', 'analyste'].includes(ctx.profile.role)) {
    toast('Cette page est réservée au staff autorisé.', 'error');
    location.replace('suivi-rpe');
    return;
  }
  CF.profile = ctx.profile;
  fillUserBlock(ctx.profile.nom || 'Utilisateur', ROLE_LABELS[ctx.profile.role] || ctx.profile.role);
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });
  CF.responseOnly = ['coach', 'analyste'].includes(ctx.profile.role);
  if (CF.responseOnly) {
    document.getElementById('cfManage').hidden = true;
    document.querySelector('[data-cf-new]').hidden = true;
    document.getElementById('cfSubtitle').textContent = 'Consulte les réponses des joueurs de tes équipes.';
    document.getElementById('cfResponsesHint').textContent = 'La base filtre automatiquement les réponses selon tes équipes.';
  }
  cfBind();
  await cfLoad();
})();

function cfLocalPreview() {
  return ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('preview') === '1';
}

function cfBind() {
  document.addEventListener('click', cfClick);
  document.getElementById('cfEditorForm').addEventListener('submit', cfSave);
  document.getElementById('cfQuestions').addEventListener('change', cfQuestionChange);
}

async function cfLoad() {
  const status = document.getElementById('cfStatus'), list = document.getElementById('cfList');
  await cfLoadResponses();
  if (CF.responseOnly) return;
  status.textContent = 'Chargement des formulaires…';
  try {
    const [f, t] = await Promise.all([
      sb.from('custom_forms').select('id, titre, description, actif, source, created_by, updated_at').order('updated_at', { ascending: false }),
      sb.from('teams').select('id, nom').eq('club_id', CF.profile.club_id).order('sort_order').order('nom'),
    ]);
    if (f.error || t.error) throw f.error || t.error;
    const ids = (f.data || []).map(x => x.id);
    const [v, a] = ids.length ? await Promise.all([
      sb.from('custom_form_versions').select('id, form_id, version_no, titre, description, questions, created_at').in('form_id', ids).order('version_no', { ascending: false }),
      sb.from('custom_form_teams').select('form_id, team_id, teams(id, nom)').in('form_id', ids),
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    if (v.error || a.error) throw v.error || a.error;
    const allowed = new Set((CF.profile.team_ids?.length ? CF.profile.team_ids : [CF.profile.team_id]).map(Number).filter(Boolean));
    CF.teams = (t.data || []).filter(x => CF.profile.role === 'admin' || allowed.has(Number(x.id)));
    const versions = new Map();
    for (const row of v.data || []) versions.set(row.form_id, [...(versions.get(row.form_id) || []), row]);
    const teamLinks = new Map();
    for (const row of a.data || []) teamLinks.set(row.form_id, [...(teamLinks.get(row.form_id) || []), Number(row.team_id)]);
    CF.forms = (f.data || []).map(row => {
      const history = versions.get(row.id) || [];
      return { ...row, versions: history, version: history[0] || null, team_ids: teamLinks.get(row.id) || [] };
    });
    const rank = (f) => (f.source ? Object.keys(cfSources).indexOf(f.source) : 9);   // ceux d'origine d'abord
    CF.forms.sort((a, b) => rank(a) - rank(b));
    cfRender();
    status.textContent = CF.forms.length ? `${CF.forms.length} formulaire${CF.forms.length > 1 ? 's' : ''}` : 'Aucun formulaire personnalisé pour le moment.';
  } catch (e) {
    console.error('Formulaires illisibles', e);
    status.textContent = cfError(e);
    list.innerHTML = '';
  }
}

async function cfLoadResponses(more = false) {
  const status = document.getElementById('cfResponsesStatus'), button = document.getElementById('cfResponsesMore');
  const from = more ? CF.responses.length : 0;
  status.textContent = 'Chargement des réponses…';
  button.disabled = true;
  try {
    const { data, error } = await sb.from('custom_form_responses')
      .select('id, player_name_snapshot, team_name_snapshot, form_title_snapshot, version_no, questions_snapshot, answers, submitted_at')
      .order('submitted_at', { ascending: false }).order('id', { ascending: false }).range(from, from + CF_PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    CF.responses = more ? CF.responses.concat(rows) : rows;
    button.classList.toggle('hidden', rows.length < CF_PAGE);
    cfRenderResponses();
    status.textContent = CF.responses.length ? `${CF.responses.length} réponse${CF.responses.length > 1 ? 's' : ''}` : 'Aucune réponse pour le moment.';
  } catch (e) {
    console.error('Réponses de formulaires illisibles', e);
    status.textContent = cfError(e);
    if (!more) document.getElementById('cfResponses').innerHTML = '';
  } finally { button.disabled = false; }
}

function cfRenderResponses() {
  const list = document.getElementById('cfResponses');
  const count = document.getElementById('cfResponsesCount');
  if (!list || !count) return;
  count.textContent = CF.responses.length ? `${CF.responses.length} réponse${CF.responses.length === 1 ? '' : 's'}` : '';
  list.innerHTML = CF.responses.length ? CF.responses.map(response => {
    const date = response.submitted_at ? new Date(response.submitted_at) : null;
    const when = date && !Number.isNaN(date.getTime()) ? date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : 'Date inconnue';
    return `<article class="cf-response-row"><div><strong>${escapeHtml(response.form_title_snapshot)}</strong>
      <small>${escapeHtml(response.player_name_snapshot)} | ${escapeHtml(response.team_name_snapshot)} | Version ${Number(response.version_no) || 1} | ${escapeHtml(when)}</small></div>
      <button class="btn btn-sm" type="button" data-cf-response="${Number(response.id)}">Voir les réponses</button></article>`;
  }).join('') : '<div class="empty">Aucune réponse visible dans le périmètre de tes équipes.</div>';
}

function cfOpenResponse(id) {
  const response = CF.responses.find(x => Number(x.id) === Number(id));
  if (!response) return;
  document.getElementById('cfResponseTitle').textContent = response.form_title_snapshot || 'Réponse au formulaire';
  const date = response.submitted_at ? new Date(response.submitted_at) : null;
  const when = date && !Number.isNaN(date.getTime()) ? date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : 'Date inconnue';
  document.getElementById('cfResponseMeta').textContent = `${response.player_name_snapshot} – ${response.team_name_snapshot} – Version ${response.version_no} – ${when}`;
  const answers = response.answers && typeof response.answers === 'object' ? response.answers : {};
  document.getElementById('cfResponseAnswers').innerHTML = (response.questions_snapshot || []).map(q =>
    `<div><dt>${escapeHtml(q.label || 'Question')}</dt><dd>${escapeHtml(cfAnswerText(answers[q.id]))}</dd></div>`).join('');
  openModal('cfResponseModal');
}

function cfAnswerText(value) {
  if (value == null || value === '') return 'Sans réponse';
  if (value === true) return 'Oui';
  if (value === false) return 'Non';
  return String(value);
}

function cfRender() {
  const list = document.getElementById('cfList');
  if (!CF.forms.length) {
    list.innerHTML = '<div class="empty">Créez un formulaire et sélectionnez les équipes qui le recevront.</div>';
    return;
  }
  list.innerHTML = CF.forms.map(form => {
    const teams = form.team_ids.map(id => CF.teams.find(t => Number(t.id) === Number(id))?.nom).filter(Boolean);
    const questions = form.version?.questions || [], source = cfSources[form.source];
    // Formulaire d'origine partagé par le club : la base le réserve à l'admin, un prépa le copie pour son équipe.
    const shared = form.source && !form.created_by && CF.profile.role !== 'admin';
    return `<article class="cf-card">
      <div class="cf-card-head"><h2>${escapeHtml(form.titre)}</h2><span class="cf-badge${form.actif ? ' is-active' : ''}">${form.actif ? 'Actif' : 'Désactivé'}</span></div>
      ${source ? `<p>${source.quand} | réponses dans <a href="${source.page}">${source.lieu}</a></p>` : ''}
      ${form.description ? `<p>${escapeHtml(form.description)}</p>` : ''}
      <div class="cf-meta"><span>Version ${form.version?.version_no || 0} | ${form.versions?.length || (form.version ? 1 : 0)} conservée${(form.versions?.length || 1) > 1 ? 's' : ''}</span><span>${questions.length} question${questions.length === 1 ? '' : 's'}</span>
        <span>${teams.length ? teams.map(escapeHtml).join(' | ') : 'Aucune équipe affectée'}</span></div>
      <div class="cf-card-actions">
        ${shared ? '' : `<button class="btn btn-sm" type="button" data-cf-edit="${form.id}">Modifier</button>
        <button class="btn btn-sm" type="button" data-cf-toggle="${form.id}">${form.actif ? 'Désactiver' : 'Réactiver'}</button>`}
        ${form.source ? `<button class="btn btn-sm" type="button" data-cf-copy="${form.id}">Copier pour une équipe</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

async function cfClick(e) {
  const response = e.target.closest('[data-cf-response]');
  if (response) return cfOpenResponse(response.dataset.cfResponse);
  if (e.target.closest('#cfResponsesMore')) return cfLoadResponses(true);
  const add = e.target.closest('[data-cf-new]');
  if (add) return cfOpen(null);
  const edit = e.target.closest('[data-cf-edit]');
  if (edit) return cfOpen(Number(edit.dataset.cfEdit));
  const copy = e.target.closest('[data-cf-copy]');
  if (copy) return cfOpen(Number(copy.dataset.cfCopy), true);
  const toggle = e.target.closest('[data-cf-toggle]');
  if (toggle) {
    const form = CF.forms.find(x => Number(x.id) === Number(toggle.dataset.cfToggle));
    if (!form) return;
    if (form.actif && !await confirmDialog(`Désactiver « ${form.titre} » ? ${form.source ? 'Il ne sera plus proposé aux joueurs. Leurs réponses restent conservées.' : 'Ses versions restent conservées.'}`)) return;
    return cfPersist({ ...form, title: form.titre, active: !form.actif,
      questions: form.version?.questions || [], team_ids: form.team_ids,
      expected_version: form.version?.version_no ?? null });
  }
  const remove = e.target.closest('[data-cf-remove-question]');
  if (remove) {
    const rows = document.querySelectorAll('.cf-question');
    if (rows.length <= 1) return toast('Un formulaire doit garder au moins une question.', 'error');
    remove.closest('.cf-question').remove();
    return cfCountQuestions();
  }
  if (e.target.closest('[data-cf-add-question]')) {
    document.getElementById('cfQuestions').insertAdjacentHTML('beforeend', cfQuestionHtml({ id: cfUid(), label: '', type: 'text', required: true }));
    cfCountQuestions();
    document.querySelector('#cfQuestions .cf-question:last-child [data-cf-label]').focus();
  }
}

async function cfPersist(form) {
  if (CF.busy) return;
  const editorOpen = document.getElementById('cfEditor').classList.contains('open');
  const message = document.getElementById(editorOpen ? 'cfEditorStatus' : 'cfStatus');
  if (form.active && !form.team_ids?.length) {
    message.textContent = 'Affectez un formulaire actif à au moins une équipe.';
    return;
  }
  CF.busy = true;
  if (editorOpen) document.getElementById('cfSave').disabled = true;
  message.textContent = 'Enregistrement…';
  try {
    if (CF.demo) {
      const old = CF.forms.find(x => Number(x.id) === Number(form.id));
      const changed = !old || old.titre !== form.title || old.description !== form.description
        || JSON.stringify(old.version?.questions || []) !== JSON.stringify(form.questions);
      const versionNo = old ? old.version.version_no + Number(changed) : 1;
      const nextVersion = { version_no: versionNo || 1, questions: form.questions };
      const versions = old?.versions || (old?.version ? [old.version] : []);
      const saved = { id: form.id ?? Date.now(), titre: form.title, description: form.description, actif: form.active, source: form.source,
        team_ids: form.team_ids, version: nextVersion, versions: changed ? [...versions, nextVersion] : versions };
      CF.forms = old ? CF.forms.map(x => x === old ? saved : x) : [saved, ...CF.forms];
      cfRender();
      document.getElementById('cfStatus').textContent = `${CF.forms.length} formulaires – aperçu local uniquement`;
      if (editorOpen) closeModal('cfEditor');
      toast(`Aperçu local : formulaire – version ${saved.version.version_no}.`, 'success');
      return;
    }
    if (form.copy_of) {
      const { data: copy, error: copyError } = await sb.rpc('custom_form_duplicate', { p_form: form.copy_of });
      if (copyError) throw copyError;
      // Un nouvel essai après un refus repart de cette copie.
      Object.assign(CF.editing, { id: copy.id, copy_of: null, version: { ...CF.editing.version, version_no: 1 } });
      Object.assign(form, { id: copy.id, expected_version: 1 });
    }
    const { data, error } = await sb.rpc('custom_form_save', {
      p_form_id: form.id, p_title: form.title, p_description: form.description, p_questions: form.questions,
      p_team_ids: form.team_ids, p_active: form.active, p_expected_version: form.expected_version,
    });
    if (error) throw error;
    await cfLoad();
    if (editorOpen) closeModal('cfEditor');
    toast(`Formulaire enregistré – version ${data.version_no}.`, 'success');
  } catch (e) {
    console.error('Formulaire non enregistré', e);
    message.textContent = cfError(e);
    if (editorOpen) document.getElementById('cfSave').disabled = false;
  } finally { CF.busy = false; }
}
