/* ============================================================
   LMFC Performance — calendar-player.js (calendrier, joueur)
   Vue « Jour » du joueur, comme une appli de suivi : la semaine en bandeau
   (lun. à dim., un point par séance ou match), puis les cartes du jour choisi,
   avec son bouton « Répondre » (PRE ou POST : calendar-forms.js), doré quand un
   questionnaire l'attend (player-todo.js). Toucher la carte ouvre la fiche (openCalItem).
   Dépend de calendar-utils.js et de calendrier-page.js (CAL, calTitleOf, calSub).
   ============================================================ */

function calStripHtml(items) {
  const { from } = calRange('day', CAL.anchor), days = calByDay(items), today = calToday(), sel = CAL.day || today;
  return `<div class="cal-strip" role="group" aria-label="Jours de la semaine">${Array.from({ length: 7 }, (_, k) => {
    const d = calAddDays(from, k), list = (days.get(d) || []).filter(i => i.kind !== 'evenement'), n = list.length, todo = list.some(i => i.todo?.length);
    return `<button type="button" class="cal-strip-d${d === today ? ' is-today' : ''}" data-cal-cell="${d}" aria-pressed="${d === sel}"
      aria-label="${escapeHtml(calDayLabel(d))}${n ? `, ${n} séance${n > 1 ? 's' : ''} ou match${n > 1 ? 's' : ''}` : ''}${todo ? ', à remplir' : ''}"${d === today ? ' aria-current="date"' : ''}>
      <span class="cal-strip-w">${CAL_DOW[k].toLowerCase()}.</span><span class="cal-strip-n">${Number(d.slice(8))}</span>
      <span class="cal-strip-dots" aria-hidden="true">${list.slice(0, 3).map(i => `<i class="k-${i.kind}${i.todo?.length ? ' is-todo' : ''}"></i>`).join('')}</span></button>`;
  }).join('')}</div>`;
}

/* Une carte : heure, type, titre ; « Répondre » (PRE ou POST), doré s'il y a quelque chose à remplir. */
function calCardHtml(i) {
  const idx = CAL.items.indexOf(i), sub = calSub(i), todo = i.todo?.length;
  return `<article class="cal-card k-${i.kind}${todo ? ' is-todo' : ''}">
    <button type="button" class="cal-card-open" data-cal-open="${idx}">
      <span class="cal-card-time">${i.heure || 'Horaire à venir'}</span>
      <span class="cal-card-title">${escapeHtml(`${CAL_KINDS[i.kind]} – ${calTitleOf(i)}`)}</span>
      ${sub ? `<span class="cal-card-sub">${escapeHtml(sub)}</span>` : ''}
    </button>
    ${i.kind !== 'evenement' ? `<button type="button" class="btn cal-card-reply" data-cal-reply="${idx}">Répondre</button>` : ''}
  </article>`;
}

function calDayHtml(items) {
  const sel = CAL.day || calToday(), list = calByDay(items).get(sel) || [];
  return `${calStripHtml(items)}
    <h2 class="cal-day-h">${escapeHtml(calCap(calDayLabel(sel)))}</h2>
    <div class="cal-cards">${list.length ? list.map(calCardHtml).join('')
      : CAL.loading ? '' : '<p class="cal-empty">Rien de prévu ce jour-là.</p>'}</div>`;
}
