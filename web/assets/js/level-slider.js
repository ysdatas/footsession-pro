/* ============================================================
   LMFC Performance — level-slider.js
   Curseur de niveaux, partagé par Mes formulaires (form-slider.js), le RPE
   (rpe.js) et les courbatures (soreness.js) : on glisse le long d'un rail
   coloré, le niveau choisi s'affiche au-dessus (« 7 – Difficile »).
   Le curseur parcourt les niveaux dans l'ordre (index), la valeur rendue est
   celle du niveau. Tant qu'il n'a pas été touché : sans réponse.
   À chaque choix, le bloc [data-ls] émet « ls-change » (detail.valeur), qui
   remonte le DOM ; « ls-reset » le remet sans réponse.
   ============================================================ */

/* Couleur sûre pour un attribut style : #rrggbb, hsl() ou var(--nom), rien d'autre. */
const lsSafe = (c) => (/^#[0-9a-f]{6}$|^hsl\([\d., %]+\)$|^var\(--[a-z0-9-]+\)$/i.test(String(c || '')) ? c : null);

/* levels : [{ valeur, libelle, couleur }] ; value : valeur déjà choisie ou null. */
function lsHtml({ id, levels, value = null, label = '', hint = 'Glisse pour répondre' }) {
  const colors = levels.map(n => lsSafe(n.couleur));
  const track = colors.every(Boolean) && colors.length > 1 ? colors.join(', ') : '#2e7d32, #ef6c00, #c62828';
  const at = levels.findIndex(n => n.valeur === Number(value)), set = value != null && at >= 0;
  const end = (n) => (n ? [n.valeur, n.libelle].filter(x => x !== '' && x != null).join(' – ') : '');
  const text = set ? end(levels[at]) : hint;
  return `<div class="ls${set ? ' is-set' : ''}" data-ls data-ls-hint="${escapeHtml(hint)}" data-ls-levels="${escapeHtml(JSON.stringify(levels))}"${
    set && colors[at] ? ` style="--ls-thumb:${colors[at]}"` : ''}>
    <p class="ls-out" data-ls-out aria-hidden="true">${escapeHtml(text)}</p>
    <input type="range" id="${id}" class="ls-range" min="0" max="${Math.max(0, levels.length - 1)}" step="1"
      value="${set ? at : Math.floor((levels.length - 1) / 2)}" data-ls-range${label ? ` aria-label="${escapeHtml(label)}"` : ''}
      aria-valuetext="${escapeHtml(set ? text : 'Sans réponse')}" style="--ls-track: linear-gradient(90deg, ${track})">
    <div class="ls-ends" aria-hidden="true"><span>${escapeHtml(end(levels[0]))}</span><span>${escapeHtml(end(levels.at(-1)))}</span></div>
  </div>`;
}

/* Le curseur bouge, ou est touché sans glisser : le niveau est choisi. */
function lsPick(range) {
  const box = range.closest('[data-ls]');
  const levels = JSON.parse(box.dataset.lsLevels || '[]'), level = levels[Number(range.value)];
  if (!level) return;
  const text = [level.valeur, level.libelle].filter(x => x !== '' && x != null).join(' – ');
  box.querySelector('[data-ls-out]').textContent = text;
  box.classList.add('is-set');
  box.style.setProperty('--ls-thumb', lsSafe(level.couleur) || 'var(--gold)');
  range.setAttribute('aria-valuetext', text);
  box.dispatchEvent(new CustomEvent('ls-change', { bubbles: true, detail: { valeur: level.valeur } }));
}

/* Retour à « sans réponse » (« Ne pas répondre »). */
function lsReset(box) {
  box.querySelector('[data-ls-out]').textContent = box.dataset.lsHint || '';
  box.classList.remove('is-set');
  box.style.removeProperty('--ls-thumb');
  box.querySelector('[data-ls-range]').setAttribute('aria-valuetext', 'Sans réponse');
  box.dispatchEvent(new CustomEvent('ls-reset', { bubbles: true }));
}

document.addEventListener('input', (e) => { if (e.target.matches?.('[data-ls-range]')) lsPick(e.target); });
document.addEventListener('click', (e) => { if (e.target.matches?.('[data-ls-range]')) lsPick(e.target); });   // toucher sans glisser
