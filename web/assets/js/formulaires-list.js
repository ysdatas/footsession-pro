/* ============================================================
   LMFC Performance — formulaires-list.js (formulaires)
   Les formulaires en cartes, côte à côte, rangés comme le joueur les reçoit :
   avant la séance ou le match (or), après (rouge), à remplir une fois (gris).
   Une carte se lit d'un coup d'œil : le moment en pastille, le nom, quand il
   est posé, ses premières questions avec leur type de réponse, ses équipes ;
   « Modifier » en vue, le reste (désactiver, copier, supprimer) dans « Plus ».
   Les réponses des joueurs : Suivi RPE (Réponses, Historique).
   ============================================================ */

const CF_MOMENTS = { avant: 'Avant', apres: 'Après', une_fois: 'Une fois' };
const cfGroup = (f) => (f.source === 'courbatures' || ['jour', 'semaine', 'seance', 'avant_match'].includes(f.planning?.mode) ? 'avant'
  : f.source || ['apres_seance', 'apres_match'].includes(f.planning?.mode) ? 'apres' : 'une_fois');
const CF_SHOWN = 3;   // questions montrées sur la carte

function cfRender() {
  const list = document.getElementById('cfList');
  if (!CF.forms.length) {
    list.innerHTML = '<div class="empty">Créez un formulaire et choisissez les équipes qui le recevront.</div>';
    return;
  }
  const order = Object.keys(CF_MOMENTS);
  list.innerHTML = [...CF.forms].sort((a, b) => order.indexOf(cfGroup(a)) - order.indexOf(cfGroup(b))).map(cfCardHtml).join('');
}

/* Type de réponse d'une question, en clair (CF_KINDS, formulaires-editor.js). */
const cfKindLabel = (q) => CF_KINDS.find(k => k[0] === cfKindOf(q))?.[1] || 'Texte';

function cfCardHtml(form) {
  const teams = form.team_ids.map(id => CF.teams.find(t => Number(t.id) === Number(id))?.nom).filter(Boolean);
  const qs = form.version?.questions || [], g = cfGroup(form);
  // Formulaire d'origine partagé par le club : la base le réserve à l'admin, un prépa le copie pour son équipe.
  const shared = form.source && !form.created_by && CF.profile.role !== 'admin';
  const copy = form.source ? `<button type="button" data-cf-copy="${form.id}">Copier pour une équipe</button>` : '';
  const more = qs.length - CF_SHOWN;
  return `<article class="cf-card is-${g}${form.actif ? '' : ' is-off'}">
    <div class="cf-card-top"><span class="cf-moment is-${g}">${CF_MOMENTS[g]}</span>
      <span class="cf-state${form.actif ? ' is-on' : ''}">${form.actif ? 'Actif' : 'Désactivé'}</span></div>
    <h3 class="cf-card-title">${escapeHtml(form.titre)}</h3>
    <p class="cf-card-when">${escapeHtml(cfPlanText(form))}</p>
    <ol class="cf-card-qs" aria-label="${qs.length} question${qs.length === 1 ? '' : 's'}">${qs.slice(0, CF_SHOWN).map(q =>
      `<li><span>${escapeHtml(q.label || 'Question')}</span><em>${escapeHtml(cfKindLabel(q))}</em></li>`).join('')}
      ${more > 0 ? `<li class="cf-card-more">+ ${more} autre${more > 1 ? 's' : ''} question${more > 1 ? 's' : ''}</li>` : ''}</ol>
    <p class="cf-card-teams">${teams.length ? teams.map(t => `<span>${escapeHtml(t)}</span>`).join('') : '<span class="is-none">Aucune équipe</span>'}</p>
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
      : plan.mode === 'seance' ? 'Les jours de séance, au réveil'
      : plan.mode === 'apres_seance' ? 'Après chaque séance'
      : plan.mode === 'apres_match' ? 'Après chaque match'
      : plan.mode === 'semaine' ? `Chaque ${(plan.jours || []).map(d => days[d - 1]).join(', ')}`
        : plan.mode === 'avant_match' ? (plan.quand === 'jour' ? 'Le jour de chaque match' : 'La veille de chaque match')
          : 'Une fois';
  const period = plan.du && plan.au ? (plan.du === plan.au ? `le ${fr(plan.du)}` : `du ${fr(plan.du)} au ${fr(plan.au)}`)
    : plan.du ? `à partir du ${fr(plan.du)}` : plan.au ? `jusqu’au ${fr(plan.au)}` : '';
  return [when, period].filter(Boolean).join(' | ');
}
