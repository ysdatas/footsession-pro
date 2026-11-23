/* ============================================================
   LMFC Performance — form-slider.js (mes-formulaires)
   Une question Échelle se répond au curseur (level-slider.js), sauf si le
   staff a choisi les pastilles (« curseur » : false). La valeur envoyée reste
   celle du niveau, un nombre, comme avec les pastilles. Tant qu'il n'a pas
   été touché, la question est sans réponse : le champ caché lu à l'envoi
   reste vide. « Ne pas répondre » (question facultative) l'y remet.
   ============================================================ */

function fsHtml(q, id, key, label) {
  return `<div class="field mf-field mf-slider" data-mf-q="${key}">
    <label for="${id}">${label}</label>
    ${lsHtml({ id, levels: fqLevels(q) })}
    <input type="hidden" data-mf-answer="${key}" data-mf-kind="number" value="">
    ${q.required ? '' : '<button type="button" class="btn btn-sm mf-slider-skip" data-fs-skip>Ne pas répondre</button>'}
  </div>`;
}

/* Choix ou remise à zéro : le champ caché suit, et le compteur de mfProgress aussi. */
function fsSet(box, value) {
  const hidden = box?.querySelector('[data-mf-answer]');
  if (!hidden) return;
  hidden.value = value;
  hidden.dispatchEvent(new Event('change', { bubbles: true }));
}

document.addEventListener('ls-change', (e) => fsSet(e.target.closest('.mf-slider'), String(e.detail.valeur)));
document.addEventListener('ls-reset', (e) => fsSet(e.target.closest('.mf-slider'), ''));
document.addEventListener('click', (e) => {
  const skip = e.target.closest?.('[data-fs-skip]');
  if (skip) lsReset(skip.closest('.mf-slider').querySelector('[data-ls]'));
});
