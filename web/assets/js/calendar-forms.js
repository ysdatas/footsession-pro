/* ============================================================
   LMFC Performance — calendar-forms.js (calendrier, joueur)
   Ce qu'il reste à remplir pour une séance ou un match (player-todo.js), en deux
   accès bien distincts : PRE SÉANCE (courbatures, questions du jour) et POST
   SÉANCE (effort et questions d'après) ; PRE MATCH et POST MATCH pour un match.
   Chacun se remplit d'un seul écran dans Mes formulaires (?u=clé).
     - calQuest : dans la fiche de la séance ou du match ;
     - calReply : « Répondre » sur une carte du jour (calendar-player.js) :
       « Sélectionner une phase », les deux boutons, celui sans rien à remplir grisé.
   Dépend de app.js (escapeHtml, openModal), calendrier-page.js (CAL_KINDS, calTitleOf).
   ============================================================ */

const cqHref = (t) => `mes-formulaires?u=${encodeURIComponent(t.key)}`;
const cqLabel = (i, phase) => `${phase === 'pre' ? 'PRE' : 'POST'} ${i.kind === 'match' ? 'MATCH' : 'SÉANCE'}`;

/* Un bouton de phase : lien s'il y a quelque chose à remplir, sinon grisé avec la raison. */
function cqPhaseBtn(i, phase) {
  const t = (i.todo || []).find(x => x.phase === phase), label = cqLabel(i, phase);
  if (t) return `<a class="cal-phase-btn is-${phase}" href="${cqHref(t)}">${label}<small>À remplir</small></a>`;
  const later = phase === 'post' && (i.date > calToday() || (i.date === calToday() && (i.heure || '') > new Date().toTimeString().slice(0, 5)));
  return `<span class="cal-phase-btn is-${phase} is-off" aria-disabled="true">${label}<small>${later ? `Après ${i.kind === 'match' ? 'le match' : 'la séance'}` : 'Rien à remplir'}</small></span>`;
}

function calQuest(i) {
  const box = document.getElementById('calQuest'), list = i.todo || [];
  if (!box) return;
  box.classList.toggle('hidden', !list.length);
  box.innerHTML = list.length ? `<p class="cal-quest-h">À remplir</p>
    <div class="cal-quest-btns">${list.map(t => `<a class="cal-phase-btn is-${t.phase}" href="${cqHref(t)}">${cqLabel(i, t.phase)}</a>`).join('')}</div>` : '';
}

function calReply(i) {
  if (!i) return;
  if (!document.getElementById('calPhase')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="calPhase">
      <div class="modal cal-phase" role="dialog" aria-modal="true" aria-labelledby="calPhaseTitle">
        <h2 class="as-h3" id="calPhaseTitle"></h2>
        <p class="cal-phase-sub" id="calPhaseSub"></p>
        <p class="cal-phase-q">Sélectionner une phase</p>
        <div class="cal-phase-btns" id="calPhaseList"></div>
        <button type="button" class="btn cal-phase-cancel" data-close="calPhase">Annuler</button>
      </div></div>`);
  }
  document.getElementById('calPhaseTitle').textContent = `${CAL_KINDS[i.kind]} – ${calTitleOf(i)}`;
  document.getElementById('calPhaseSub').textContent = [calCap(calDayLabel(i.date)), i.heure].filter(Boolean).join(' à ');
  document.getElementById('calPhaseList').innerHTML = cqPhaseBtn(i, 'pre') + cqPhaseBtn(i, 'post');
  openModal('calPhase');
}
