/* ============================================================
   LMFC Performance — formulaires-list.js (formulaires)
   La liste des formulaires, rangée comme le joueur les reçoit :
     - Avant la séance ou le match : courbatures, questionnaires du jour, de
       certains jours, d'avant match (lmfc_v65.sql) ;
     - Après la séance ou le match : effort (RPE), avis, et leurs questions ;
     - À remplir une fois.
   Une carte : nom, quand, combien de questions, quelles équipes, actif ou non ;
   « Modifier » en vue, le reste (désactiver, copier, supprimer) dans « Plus ».
   ============================================================ */

const CF_GROUPS = [
  ['avant', 'Avant la séance ou le match', 'Courbatures du matin, questionnaires du jour ou d’avant match.'],
  ['apres', 'Après la séance ou le match', 'Effort (RPE), avis sur le match et les questions qui les suivent.'],
  ['une_fois', 'À remplir une fois', 'Proposés une seule fois dans « Mes formulaires ».'],
];
const cfGroup = (f) => (f.source === 'courbatures' || ['jour', 'semaine', 'avant_match'].includes(f.planning?.mode) ? 'avant'
  : f.source ? 'apres' : 'une_fois');

function cfRender() {
  const list = document.getElementById('cfList');
  if (!CF.forms.length) {
    list.innerHTML = '<div class="empty">Créez un formulaire et choisissez les équipes qui le recevront.</div>';
    return;
  }
  list.innerHTML = CF_GROUPS.map(([g, title, hint]) => {
    const forms = CF.forms.filter(f => cfGroup(f) === g);
    return forms.length ? `<section class="cf-group" aria-labelledby="cf-g-${g}">
      <div class="cf-group-head"><h2 id="cf-g-${g}">${title}</h2><p>${hint}</p></div>
      <div class="cf-group-list">${forms.map(cfCardHtml).join('')}</div></section>` : '';
  }).join('');
}

function cfCardHtml(form) {
  const teams = form.team_ids.map(id => CF.teams.find(t => Number(t.id) === Number(id))?.nom).filter(Boolean);
  const n = (form.version?.questions || []).length, source = cfSources[form.source];
  // Formulaire d'origine partagé par le club : la base le réserve à l'admin, un prépa le copie pour son équipe.
  const shared = form.source && !form.created_by && CF.profile.role !== 'admin';
  const meta = [cfPlanText(form), `${n} question${n === 1 ? '' : 's'}`, teams.length ? teams.join(', ') : 'Aucune équipe'];
  const copy = form.source ? `<button type="button" data-cf-copy="${form.id}">Copier pour une équipe</button>` : '';
  return `<article class="cf-card${form.actif ? '' : ' is-off'}">
    <div class="cf-card-main">
      <h3 class="cf-card-title">${escapeHtml(form.titre)}</h3>
      <p class="cf-card-meta">${meta.map(escapeHtml).join(' <span aria-hidden="true">·</span> ')}</p>
      ${source ? `<p class="cf-card-link">Réponses dans <a href="${source.page}">${source.lieu}</a></p>` : ''}
    </div>
    <span class="cf-state${form.actif ? ' is-on' : ''}">${form.actif ? 'Actif' : 'Désactivé'}</span>
    <div class="cf-card-actions">
      ${shared ? (copy ? `<button class="btn btn-sm" type="button" data-cf-copy="${form.id}">Copier pour une équipe</button>` : '')
        : `<button class="btn btn-sm" type="button" data-cf-edit="${form.id}">Modifier</button>
      <details class="cf-more"><summary class="btn btn-sm" aria-label="Autres actions pour « ${escapeHtml(form.titre)} »">Plus</summary>
        <div class="cf-more-menu">
          <button type="button" data-cf-toggle="${form.id}">${form.actif ? 'Désactiver' : 'Réactiver'}</button>
          ${copy}
          <button type="button" class="is-danger" data-cf-delete="${form.id}">Supprimer</button>
        </div></details>`}
    </div>
  </article>`;
}

/* Le menu « Plus » se referme quand on clique ailleurs, ou après une action. */
function cfMoreClose(e) {
  document.querySelectorAll('.cf-more[open]').forEach(d => {
    if (!d.contains(e.target) || e.target.closest('.cf-more-menu button')) d.open = false;
  });
}

/* Quand le formulaire est posé, en clair : « Chaque jour | du 01/12/2026 au 15/12/2026 ». */
function cfPlanText(form) {
  const plan = form.planning || {}, fr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const days = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const when = form.source ? cfSources[form.source]?.quand || 'Après chaque séance'
    : plan.mode === 'jour' ? 'Chaque jour'
      : plan.mode === 'semaine' ? `Chaque ${(plan.jours || []).map(d => days[d - 1]).join(', ')}`
        : plan.mode === 'avant_match' ? (plan.quand === 'jour' ? 'Le jour de chaque match' : 'La veille de chaque match')
          : 'Une fois';
  const period = plan.du && plan.au ? (plan.du === plan.au ? `le ${fr(plan.du)}` : `du ${fr(plan.du)} au ${fr(plan.au)}`)
    : plan.du ? `à partir du ${fr(plan.du)}` : plan.au ? `jusqu’au ${fr(plan.au)}` : '';
  return [when, period].filter(Boolean).join(' | ');
}
