/* ============================================================
   LMFC Performance — app.js
   Initialisation globale : helpers DOM, toasts, modales,
   bascule de la barre latérale.
   ============================================================ */

/* ---------- Helpers DOM ---------- */
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/* Construit une URL relative à la racine de l'app (pages à la racine). */
function baseUrl(path) {
  const parts = window.location.pathname.split('/');
  parts[parts.length - 1] = path;
  return parts.join('/');
}

/* ---------- Toasts ---------- */
function toast(message, type = '') {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = el('div', { id: 'toast-stack' });
    document.body.append(stack);
  }
  const t = el('div', { class: 'toast ' + type }, message);
  stack.append(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 3200);
}

/* ---------- Modales ---------- */
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

document.addEventListener('click', (e) => {
  if (e.target.classList?.contains('modal-backdrop')) e.target.classList.remove('open');
  if (e.target.dataset?.close) closeModal(e.target.dataset.close);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $$('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
});

/* ---------- Format ---------- */
const fmtDate = (d) => {
  if (!d) return '';
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Glisser-déposer pour réordonner une liste ----------
   Les enfants directs de `list` se réordonnent au doigt comme à la
   souris (Pointer Events) : on attrape la poignée [data-drag] (ou,
   à la souris, la ligne entière hors boutons et champs), on glisse,
   on lâche. Au clavier : flèches haut / bas sur la poignée.
   onChange() est appelé une fois le déplacement terminé ; le clic
   qui suit un glissement est ignoré (pas de case cochée par erreur). */
function makeSortable(list, { onChange } = {}) {
  let row = null, pid = null, startY = 0, active = false, justDragged = false;
  const rowOf = (t) => [...list.children].find(c => c.contains(t));
  list.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const handle = e.target.closest('[data-drag]');
    const mouseRow = e.pointerType === 'mouse' && !e.target.closest('input, button, select, textarea, a, [contenteditable]');
    if (!handle && !mouseRow) return;
    row = rowOf(e.target); pid = e.pointerId; startY = e.clientY; active = false;
    if (handle) e.preventDefault();
  });
  list.addEventListener('pointermove', (e) => {
    if (!row || e.pointerId !== pid) return;
    if (!active) {
      if (Math.abs(e.clientY - startY) < 5) return;
      active = true;
      row.classList.add('is-dragging'); list.classList.add('is-sorting');
      try { list.setPointerCapture(pid); } catch (err) { console.warn('Capture du pointeur impossible', err); }
    }
    e.preventDefault();
    const y = e.clientY;
    const before = [...list.children].find(c => c !== row && y < c.getBoundingClientRect().top + c.offsetHeight / 2);
    if (before) { if (row.nextElementSibling !== before) list.insertBefore(row, before); }
    else if (list.lastElementChild !== row) list.append(row);
    if (y < 70) window.scrollBy(0, -12); else if (y > window.innerHeight - 70) window.scrollBy(0, 12);
  });
  const end = (e) => {
    if (!row || e.pointerId !== pid) return;
    const moved = active;
    row.classList.remove('is-dragging'); list.classList.remove('is-sorting');
    row = null; active = false;
    if (!moved) return;
    justDragged = true; setTimeout(() => { justDragged = false; }, 0);
    onChange?.();
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
  list.addEventListener('click', (e) => { if (justDragged) { e.preventDefault(); e.stopPropagation(); } }, true);
  list.addEventListener('keydown', (e) => {
    const handle = e.target.closest('[data-drag]');
    if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const r = rowOf(handle), sib = e.key === 'ArrowUp' ? r.previousElementSibling : r.nextElementSibling;
    if (!sib) return;
    if (e.key === 'ArrowUp') sib.before(r); else sib.after(r);
    handle.focus();
    onChange?.();
  });
}
const dragHandle = (label) => `<span class="drag-handle" data-drag tabindex="0" role="button" aria-label="Déplacer ${escapeHtml(label)} (flèches haut et bas)" title="Glisser pour déplacer"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="5.5" cy="3.5" r="1.4"/><circle cx="10.5" cy="3.5" r="1.4"/><circle cx="5.5" cy="8" r="1.4"/><circle cx="10.5" cy="8" r="1.4"/><circle cx="5.5" cy="12.5" r="1.4"/><circle cx="10.5" cy="12.5" r="1.4"/></svg></span>`;

/* ---------- Barre latérale mobile ----------
   Appelée au chargement, et par la coque joueur quand elle insère son
   menu plus tard (player-nav.js). Ne lie qu'une fois. */
function bindSidebarToggle() {
  const toggle   = document.getElementById('sidebarToggle');
  const sidebar  = document.getElementById('sidebar');
  if (!toggle || !sidebar || toggle.dataset.bound) return;
  toggle.dataset.bound = '1';
  // Voile derrière le menu ouvert : un tap à côté le referme.
  let backdrop = document.getElementById('sidebarBackdrop');
  if (!backdrop) {
    backdrop = el('div', { class: 'sidebar-backdrop', id: 'sidebarBackdrop' });
    sidebar.after(backdrop);
  }
  const setOpen  = (open) => {
    sidebar.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.setAttribute('aria-controls', 'sidebar');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => setOpen(!sidebar.classList.contains('open')));
  backdrop.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sidebar.classList.contains('open')) setOpen(false); });
}
document.addEventListener('DOMContentLoaded', bindSidebarToggle);

/* ---------- Couleurs : pastilles au lieu du sélecteur système ----------
   Chaque <input type="color"> devient une rangée de pastilles (palette
   commune à toute l'app) + une pastille « autre couleur » qui ouvre le
   sélecteur du système. L'input reste la source de vérité : les pages
   continuent d'écouter ses événements input/change et de lire .value. */
const COLOR_PALETTE = ['#C9A84C', '#E03131', '#F76707', '#FAB005', '#2F9E44', '#1098AD', '#1F6FEB', '#7048E8', '#F1F3F5', '#212529'];
const COLOR_NAMES = ['Or', 'Rouge', 'Orange', 'Jaune', 'Vert', 'Turquoise', 'Bleu', 'Violet', 'Blanc', 'Noir'];

function enhanceColorInputs(root = document) {
  $$('input[type="color"]:not([data-enhanced])', root).forEach(input => {
    input.dataset.enhanced = '1';
    const wrap = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': input.getAttribute('aria-label') || input.title || 'Couleur' });
    input.replaceWith(wrap);
    const set = (c) => {
      input.value = c;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    // data-palette="compact" : les couleurs essentielles, pour les barres flottantes.
    const keep = input.dataset.palette === 'compact' ? [1, 3, 4, 6, 8, 9] : COLOR_PALETTE.map((_, i) => i);
    COLOR_PALETTE.forEach((c, i) => keep.includes(i) && wrap.append(el('button', {
      type: 'button', class: 'sw', role: 'radio', title: COLOR_NAMES[i], 'aria-label': COLOR_NAMES[i],
      style: `background:${c}`, dataset: { color: c.toLowerCase() }, onclick: () => set(c),
    })));
    const custom = el('button', { type: 'button', class: 'sw sw-custom', title: 'Autre couleur', 'aria-label': 'Autre couleur',
      onclick: () => (input.showPicker ? input.showPicker() : input.click()) });
    wrap.append(custom, input);

    const sync = () => {
      const v = String(input.value || '').toLowerCase();
      let known = false;
      wrap.querySelectorAll('.sw[data-color]').forEach(b => {
        const on = b.dataset.color === v; known ||= on;
        b.setAttribute('aria-checked', String(on));
      });
      custom.setAttribute('aria-checked', String(!known));
      custom.style.setProperty('--custom', known ? 'transparent' : v);
      wrap.querySelectorAll('button').forEach(b => { b.disabled = input.disabled; });
    };
    // Une valeur posée par le code (input.value = …) met aussi les pastilles à jour.
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(input, 'value', { get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); sync(); } });
    new MutationObserver(sync).observe(input, { attributes: true, attributeFilter: ['disabled'] });
    input.addEventListener('input', sync);
    sync();
  });
}
enhanceColorInputs();
