/* Gestion des formulaires (lmfc_v44.sql, lmfc_v47.sql).
   Les formulaires sont versionnés et affectés aux équipes par RPC. Ceux d'origine
   (RPE, courbatures, avis de match) gardent leurs réponses dans leurs tables.
   L'éditeur est dans formulaires-editor.js, la liste dans formulaires-list.js.
   Les réponses des joueurs se lisent dans Suivi RPE (Réponses, Historique), plus ici. */
const CF = { profile: null, teams: [], forms: [], editing: null, busy: false, demo: false };
/* Les questionnaires d'origine : quand le joueur les reçoit, où lire leurs réponses. */
const cfSources = {
  rpe_seance: { quand: 'Après chaque séance', lieu: 'Suivi RPE', page: 'suivi-rpe' },
  rpe_match: { quand: 'Après chaque match', lieu: 'Suivi RPE', page: 'suivi-rpe' },
  courbatures: { quand: 'Les jours de séance, au réveil', lieu: 'Suivi RPE', page: 'suivi-rpe' },
  avis_match: { quand: 'Après chaque match', lieu: 'Matchs', page: 'matchs' },
};
const cfUid = () => `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const cfError = (e) => ['42P01', '42703', 'PGRST202', 'PGRST205'].includes(e?.code)
  ? 'Les migrations lmfc_v44.sql, lmfc_v45.sql et lmfc_v47.sql sont nécessaires pour gérer les formulaires.'
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
      { id: 9005, titre: 'Courbatures au réveil', actif: true, source: 'courbatures', team_ids: [1, 2, 3, 4], versions: [{ version_no: 1 }], version: { version_no: 1, questions: [
        { id: 'niveau', label: 'Ton niveau de courbature au réveil (0 = aucune, 10 = très fortes) :', type: 'scale', min: 0, max: 10, required: true, fixe: true }] } },
      { id: 9006, titre: 'Forme du jour', actif: true, planning: { mode: 'jour' }, team_ids: [3], versions: [{ version_no: 1 }], version: { version_no: 1, questions: [
        { id: 'sommeil', label: 'Comment as-tu dormi ?', type: 'scale', min: 0, max: 10, required: true }] } },
      { id: 9002, titre: 'Récupération', description: '', actif: false, team_ids: [4], versions: [{ version_no: 1 }], version: { version_no: 1, questions: [
        { id: 'sommeil', label: 'Comment as-tu dormi ?', type: 'choice', options: ['Bien', 'Moyen', 'Mal'], required: true },
      ] } },
    ];
    cfBind();
    fillUserBlock('Aperçu local', 'Administrateur');
    document.getElementById('logoutLink')?.remove();
    document.getElementById('cfPreviewNotice').classList.remove('hidden');
    cfRender();
    document.getElementById('cfStatus').textContent = `${CF.forms.length} exemples – mode aperçu local`;
    return;
  }
  const ctx = await requireAuth();
  if (!ctx) return;
  if (!['admin', 'prepa', 'coach', 'analyste'].includes(ctx.profile.role)) {
    toast('Cette page est réservée au staff autorisé.', 'error');
    location.replace('suivi-rpe');
    return;
  }
  // Coach, analyste : ils lisent les réponses, ne règlent pas les formulaires.
  if (['coach', 'analyste'].includes(ctx.profile.role)) { location.replace('suivi-rpe?vue=reponses'); return; }
  CF.profile = ctx.profile;
  fillUserBlock(ctx.profile.nom || 'Utilisateur', ROLE_LABELS[ctx.profile.role] || ctx.profile.role);
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });
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
  document.getElementById('cfQuestions').addEventListener('input', cfQuestionInput);
  document.getElementById('cfSettings').addEventListener('change', cfSettingsSum);
  // Champ à compléter dans une partie repliée : elle s'ouvre, le navigateur y mène.
  document.getElementById('cfEditorForm').addEventListener('invalid', (e) => { for (let d = e.target.closest('details'); d; d = d.parentElement.closest('details')) d.open = true; }, true);
  document.getElementById('cfMoment').addEventListener('change', cfMomentChange);
}

async function cfLoad() {
  const status = document.getElementById('cfStatus'), list = document.getElementById('cfList');
  status.textContent = 'Chargement des formulaires…';
  try {
    const [f, t] = await Promise.all([
      // « * » : archive_le n'existe qu'avec lmfc_v63.sql ; un formulaire supprimé (archivé) n'est plus listé.
      sb.from('custom_forms').select('*').order('updated_at', { ascending: false }),
      sb.from('teams').select('id, nom').eq('club_id', CF.profile.club_id).order('sort_order').order('nom'),
    ]);
    if (f.error || t.error) throw f.error || t.error;
    const live = (f.data || []).filter(x => !x.archive_le);
    const ids = live.map(x => x.id);
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
    CF.forms = live.map(row => {
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

async function cfClick(e) {
  cfMoreClose(e);                 // formulaires-list.js : menu « Plus » refermé hors de lui
  if (cfEditorClick(e)) return;   // formulaires-editor.js : déplacer, niveaux
  const del = e.target.closest('[data-cf-delete]');
  if (del) return cfDelete(Number(del.dataset.cfDelete));
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
  const addQ = e.target.closest('[data-cf-add-question]');
  if (addQ) {   // Curseur, Oui / non, Choix, Silhouette, Texte (formulaires-editor.js)
    document.getElementById('cfQuestions').insertAdjacentHTML('beforeend', cfQuestionHtml(cfNewQuestion(addQ.dataset.cfAddQuestion || 'text')));
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
        planning: form.planning === undefined ? old?.planning ?? null : form.planning,
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
    // Quand le poser (lmfc_v65.sql) : enregistré à part, seulement s'il a changé.
    const before = CF.forms.find(x => Number(x.id) === Number(data.id))?.planning ?? null;
    let planError = null;
    if (form.planning !== undefined && JSON.stringify(form.planning) !== JSON.stringify(before)) {
      const { error: e2 } = await sb.rpc('custom_form_plan', { p_form: data.id, p_planning: form.planning });
      if (e2) planError = ['PGRST202', '42883'].includes(e2.code) ? 'Le moment n’est pas enregistré : la migration lmfc_v65.sql est nécessaire.' : e2.message;
    }
    await cfLoad();
    if (planError) { message.textContent = planError; if (editorOpen) document.getElementById('cfSave').disabled = false; return; }
    if (editorOpen) closeModal('cfEditor');
    toast(`Formulaire enregistré – version ${data.version_no}.`, 'success');
  } catch (e) {
    console.error('Formulaire non enregistré', e);
    message.textContent = cfError(e);
    if (editorOpen) document.getElementById('cfSave').disabled = false;
  } finally { CF.busy = false; }
}

/* Supprimer : sans réponse, le formulaire est effacé ; avec des réponses, il est archivé
   (lmfc_v63.sql) : retiré des équipes, plus jamais proposé, ses réponses restent ci-dessous. */
async function cfDelete(id) {
  const form = CF.forms.find(x => Number(x.id) === Number(id));
  if (!form || CF.busy) return;
  const rpe = ['rpe_seance', 'rpe_match'].includes(form.source) ? ' Ses équipes ne recevront plus le RPE par ce formulaire : attribuez-leur un autre formulaire de la même sorte si besoin.' : '';
  if (!await confirmDialog(`Supprimer « ${form.titre} » ? Il ne sera plus proposé aux joueurs.${rpe} Les réponses déjà reçues ne sont jamais effacées : elles restent consultables.`)) return;
  const status = document.getElementById('cfStatus');
  CF.busy = true;
  try {
    if (CF.demo) {
      CF.forms = CF.forms.filter(x => x !== form);
      cfRender();
      toast('Aperçu local : formulaire retiré.', 'success');
      return;
    }
    const { data, error } = await sb.rpc('custom_form_delete', { p_form: form.id });
    if (error) throw error;
    toast(data === 'archive' ? 'Formulaire supprimé. Ses réponses restent consultables.' : 'Formulaire supprimé.', 'success');
    CF.busy = false;
    await cfLoad();
  } catch (e) {
    console.error('Formulaire non supprimé', e);
    status.textContent = ['PGRST202', '42883'].includes(e?.code) ? 'La suppression demande la migration lmfc_v63.sql.' : cfError(e);
  } finally { CF.busy = false; }
}
