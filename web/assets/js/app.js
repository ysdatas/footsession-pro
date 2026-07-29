/* ============================================================
   FootSession Pro — app.js
   Initialisation globale : helpers DOM, fetch API (+ CSRF),
   toasts, modales, bascule de la barre latérale.
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

/* ---------- CSRF ---------- */
const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || '';

/* ---------- Wrapper fetch JSON ---------- */
async function API(url, { method = 'GET', body = null, params = null } = {}) {
  if (params) {
    const q = new URLSearchParams(params).toString();
    url += (url.includes('?') ? '&' : '?') + q;
  }
  const opts = { method, headers: {} };
  if (body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.headers['X-CSRF-Token'] = CSRF;
    opts.body = JSON.stringify(body);
  } else if (method !== 'GET') {
    opts.headers['X-CSRF-Token'] = CSRF;
  }

  let res, data;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw new Error('Réseau indisponible.');
  }
  const text = await res.text();
  try { data = text ? JSON.parse(text) : {}; }
  catch { throw new Error('Réponse serveur invalide.'); }

  if (res.status === 401) { window.location.href = baseUrl('index.php'); throw new Error('Session expirée.'); }
  if (!res.ok) throw new Error(data.error || ('Erreur ' + res.status));
  return data;
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
