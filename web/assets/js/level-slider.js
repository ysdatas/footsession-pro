/* ============================================================
   LMFC Performance — level-slider.js
   Curseur de niveaux, partagé par les questionnaires (form-slider.js), le RPE
   (rpe.js, todo-parts.js) et les courbatures (soreness.js, todo-parts.js) : on
   glisse le long d'un rail coloré, le niveau choisi s'affiche au-dessus
   (« 7 – Difficile »).
   Fluide au doigt : le rond suit le doigt sans à-coup, partout sur le rail (un
   appui suffit, même loin du rond), puis se cale sur le niveau le plus proche
   quand on lâche. Un geste vertical fait défiler la page sans rien répondre.
   Le vrai curseur (input range, invisible, un cran par niveau) reste dessous pour
   le clavier et les lecteurs d'écran ; le rail et le rond ne sont qu'un dessin.
   Tant qu'il n'a pas été touché : sans réponse.
   À chaque choix, le bloc [data-ls] émet « ls-change » (detail.valeur), qui
   remonte le DOM ; « ls-reset » le remet sans réponse.
   ============================================================ */

/* Couleur sûre pour un attribut style : #rrggbb, hsl() ou var(--nom), rien d'autre. */
const lsSafe = (c) => (/^#[0-9a-f]{6}$|^hsl\([\d., %]+\)$|^var\(--[a-z0-9-]+\)$/i.test(String(c || '')) ? c : null);
const LS_PAD = 15;   // demi-largeur du rond (px) : le rail commence et finit sous son centre (main.css, .ls-rail)
const lsText = (n) => (n ? [n.valeur, n.libelle].filter(x => x !== '' && x != null).join(' – ') : '');

/* levels : [{ valeur, libelle, couleur }] ; value : valeur déjà choisie ou null. */
function lsHtml({ id, levels, value = null, label = '', hint = 'Glisse pour répondre' }) {
  const colors = levels.map(n => lsSafe(n.couleur));
  const track = colors.every(Boolean) && colors.length > 1 ? colors.join(', ') : '#2e7d32, #ef6c00, #c62828';
  const at = levels.findIndex(n => n.valeur === Number(value)), set = value != null && at >= 0;
  const last = Math.max(1, levels.length - 1), start = set ? at : Math.floor((levels.length - 1) / 2);
  const text = set ? lsText(levels[at]) : hint;
  return `<div class="ls${set ? ' is-set' : ''}" data-ls data-ls-hint="${escapeHtml(hint)}" data-ls-levels="${escapeHtml(JSON.stringify(levels))}"${
    set && colors[at] ? ` style="--ls-thumb:${colors[at]}"` : ''}>
    <p class="ls-out" data-ls-out aria-hidden="true">${escapeHtml(text)}</p>
    <div class="ls-zone" data-ls-zone style="--ls-track: linear-gradient(90deg, ${track}); --ls-pos: ${start / last}">
      <input type="range" id="${id}" class="ls-range" min="0" max="${Math.max(0, levels.length - 1)}" step="1"
        value="${start}" data-ls-range${label ? ` aria-label="${escapeHtml(label)}"` : ''} aria-valuetext="${escapeHtml(set ? text : 'Sans réponse')}">
      <span class="ls-rail" aria-hidden="true">${levels.map((_, k) => `<i style="left:${(k / last) * 100}%"></i>`).join('')}</span>
      <span class="ls-thumb" aria-hidden="true"></span>
    </div>
    <div class="ls-ends" aria-hidden="true"><span>${escapeHtml(lsText(levels[0]))}</span><span>${escapeHtml(lsText(levels.at(-1)))}</span></div>
  </div>`;
}

/* Le niveau du curseur est choisi. free : le rond suit le doigt (sinon il se cale sur le niveau). */
function lsPick(range, free = false) {
  const box = range.closest('[data-ls]');
  const levels = JSON.parse(box.dataset.lsLevels || '[]'), level = levels[Number(range.value)];
  if (!level) return;
  const text = lsText(level);
  box.querySelector('[data-ls-out]').textContent = text;
  box.classList.add('is-set');
  box.style.setProperty('--ls-thumb', lsSafe(level.couleur) || 'var(--gold)');
  if (!free) range.closest('[data-ls-zone]').style.setProperty('--ls-pos', Number(range.value) / Math.max(1, Number(range.max)));
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

/* ---------- Au doigt et à la souris ----------
   Souris : le niveau suit dès l'appui. Doigt : on attend le sens du geste ; horizontal,
   le rond suit ; vertical, la page défile (pointercancel) et rien n'est répondu ; un
   simple appui choisit le niveau touché. */
let lsDrag = null;   // { zone, range, id, x0, y0, live }
function lsMove(x) {
  const { zone, range } = lsDrag, r = zone.getBoundingClientRect();
  const t = Math.min(1, Math.max(0, (x - r.left - LS_PAD) / Math.max(1, r.width - 2 * LS_PAD)));
  zone.style.setProperty('--ls-pos', t);
  const v = Math.round(t * Number(range.max));
  if (Number(range.value) !== v || !zone.closest('[data-ls]').classList.contains('is-set')) {
    range.value = v;
    lsPick(range, true);
  }
}
function lsStart(e) {
  lsDrag.live = true;
  lsDrag.zone.classList.add('is-drag');
  try { lsDrag.zone.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
  lsMove(e.clientX);
}
function lsEnd(e, tap) {
  if (!lsDrag || e.pointerId !== lsDrag.id) return;
  if (tap && !lsDrag.live) lsMove(e.clientX);
  const { zone, range } = lsDrag;
  zone.classList.remove('is-drag');
  lsDrag = null;
  if (zone.closest('[data-ls]').classList.contains('is-set')) zone.style.setProperty('--ls-pos', Number(range.value) / Math.max(1, Number(range.max)));
}
document.addEventListener('pointerdown', (e) => {
  const zone = e.target.closest?.('[data-ls-zone]');
  const range = zone?.querySelector('[data-ls-range]');
  if (!range || range.disabled || e.button > 0) return;
  lsDrag = { zone, range, id: e.pointerId, x0: e.clientX, y0: e.clientY, live: false };
  if (e.pointerType !== 'mouse') return;
  e.preventDefault();   // pas de sélection de texte en glissant
  range.focus({ preventScroll: true, focusVisible: false });   // le cadre reste pour le clavier
  lsStart(e);
});
document.addEventListener('pointermove', (e) => {
  if (!lsDrag || e.pointerId !== lsDrag.id) return;
  if (lsDrag.live) return lsMove(e.clientX);
  const dx = Math.abs(e.clientX - lsDrag.x0), dy = Math.abs(e.clientY - lsDrag.y0);
  if (dx > 6 && dx > dy) lsStart(e);
  else if (dy > 10) lsDrag = null;   // geste vertical : la page défile
});
document.addEventListener('pointerup', (e) => lsEnd(e, true));
document.addEventListener('pointercancel', (e) => lsEnd(e, false));
document.addEventListener('input', (e) => { if (e.target.matches?.('[data-ls-range]')) lsPick(e.target); });   // clavier, lecteur d'écran
