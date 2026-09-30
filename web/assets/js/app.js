/* ============================================================
   FootSession Pro — app.js
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

/* ---------- Barre latérale mobile ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const toggle   = document.getElementById('sidebarToggle');
  const sidebar  = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const setOpen  = (open) => {
    sidebar?.classList.toggle('open', open);
    backdrop?.classList.toggle('open', open);
  };
  toggle?.addEventListener('click', () => setOpen(!sidebar.classList.contains('open')));
  backdrop?.addEventListener('click', () => setOpen(false));
});

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
    COLOR_PALETTE.forEach((c, i) => wrap.append(el('button', {
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
