/* ============================================================
   LMFC Performance — form-slider.js (mes-formulaires)
   Une question Échelle marquée « curseur » se répond en glissant un curseur
   au lieu de toucher une pastille. Le curseur parcourt les niveaux de la
   question (form-levels.js) dans l'ordre, même s'ils ne se suivent pas ; la
   valeur envoyée reste celle du niveau, un nombre, comme avec les pastilles.
   Tant qu'il n'a pas été touché, la question est sans réponse : le champ
   caché lu à l'envoi reste vide. « Ne pas répondre » (question facultative)
   le remet dans cet état.
   ============================================================ */

/* Dégradé du rail : les couleurs des niveaux, sinon du vert au rouge. */
function fsTrack(q, levels) {
  const colors = levels.map(n => fqColor(q, n.valeur));
  if (colors.every(Boolean)) return colors.length > 1 ? colors.join(', ') : `${colors[0]}, ${colors[0]}`;
  return '#2e7d32, #ef6c00, #c62828';
}

function fsHtml(q, id, key, label) {
  const levels = fqLevels(q);
  return `<div class="field mf-field mf-slider" data-mf-q="${key}">
    <label for="${id}">${label}</label>
    <p class="mf-slider-out" data-fs-out aria-hidden="true">Glisse pour répondre</p>
    <input type="range" id="${id}" class="mf-range" min="0" max="${Math.max(0, levels.length - 1)}" step="1" value="${Math.floor((levels.length - 1) / 2)}"
      data-fs-range aria-valuetext="Sans réponse" style="--fs-track: linear-gradient(90deg, ${fsTrack(q, levels)})">
    <div class="mf-slider-ends" aria-hidden="true"><span>${escapeHtml(fsEnd(levels[0]))}</span><span>${escapeHtml(fsEnd(levels.at(-1)))}</span></div>
    <input type="hidden" data-mf-answer="${key}" data-mf-kind="number" value="">
    ${q.required ? '' : '<button type="button" class="btn btn-sm mf-slider-skip" data-fs-skip>Ne pas répondre</button>'}
  </div>`;
}
const fsEnd = (n) => (n ? [n.valeur, n.libelle].filter(x => x !== '' && x != null).join(' – ') : '');

/* Le curseur bouge : niveau choisi, affiché et rangé dans le champ caché (lu par mfAnswers). */
function fsInput(e) {
  const range = e.target.closest?.('[data-fs-range]');
  if (!range) return;
  const box = range.closest('[data-mf-q]'), q = fsQuestion(box);
  if (!q) return;
  const level = fqLevels(q)[Number(range.value)];
  const text = fqAnswerText(q, level.valeur);
  box.querySelector('[data-mf-answer]').value = String(level.valeur);
  box.querySelector('[data-fs-out]').textContent = text;
  box.classList.add('is-set');
  box.style.setProperty('--fs-thumb', fqColor(q, level.valeur) || 'var(--gold)');
  range.setAttribute('aria-valuetext', text);
  box.querySelector('[data-mf-answer]').dispatchEvent(new Event('change', { bubbles: true }));   // compteur de mfProgress
}

/* « Ne pas répondre » : retour à l'état sans réponse. */
function fsSkip(e) {
  const btn = e.target.closest?.('[data-fs-skip]');
  if (!btn) return;
  const box = btn.closest('[data-mf-q]');
  box.querySelector('[data-mf-answer]').value = '';
  box.querySelector('[data-fs-out]').textContent = 'Glisse pour répondre';
  box.classList.remove('is-set');
  box.style.removeProperty('--fs-thumb');
  box.querySelector('[data-fs-range]').setAttribute('aria-valuetext', 'Sans réponse');
  box.querySelector('[data-fs-range]').dispatchEvent(new Event('change', { bubbles: true }));   // compteur de mfProgress
}

/* La question d'un bloc, parmi les questionnaires affichés (MF, mes-formulaires-page.js). */
function fsQuestion(box) {
  const form = box.closest('[data-mf-form]');
  return MF.pending[Number(form?.dataset.mfIndex)]?.questions?.find(x => x.id === box.dataset.mfQ) || null;
}

document.addEventListener('input', fsInput);
document.addEventListener('click', (e) => (e.target.matches?.('[data-fs-range]') ? fsInput(e) : fsSkip(e)));   // toucher sans glisser choisit aussi
