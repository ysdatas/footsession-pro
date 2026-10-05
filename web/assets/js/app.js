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
  // data-busy : une opération en cours (un envoi) garde la fenêtre ouverte.
  if (e.target.classList?.contains('modal-backdrop') && !e.target.hasAttribute('data-busy')) e.target.classList.remove('open');
  if (e.target.dataset?.close) closeModal(e.target.dataset.close);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $$('.modal-backdrop.open:not([data-busy])').forEach(m => m.classList.remove('open'));
});

/* ---------- Format ---------- */
const fmtDate = (d) => {
  if (!d) return '';
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};
/* Majuscule initiale (« juil. 2024 » → « Juil. 2024 »). */
const capFirst = (s) => { const t = String(s ?? ''); return t.charAt(0).toUpperCase() + t.slice(1); };
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
const CLUB_PALETTE = [['#E8B20E', 'Or LMFC'], ['#C8102E', 'Rouge LMFC'], ['#F76707', 'Orange'], ['#2F9E44', 'Vert'],
  ['#1098AD', 'Turquoise'], ['#1F6FEB', 'Bleu'], ['#7048E8', 'Violet'], ['#F1F3F5', 'Blanc']];

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
    // data-palette="compact" : les couleurs essentielles, pour les barres flottantes ;
    // data-palette="club" : l'or et le rouge du blason en tête (couleur du club).
    const club = input.dataset.palette === 'club';
    const colors = club ? CLUB_PALETTE.map(([c]) => c) : COLOR_PALETTE;
    const names = club ? CLUB_PALETTE.map(([, n]) => n) : COLOR_NAMES;
    const keep = input.dataset.palette === 'compact' ? [1, 3, 4, 6, 8, 9] : colors.map((_, i) => i);
    colors.forEach((c, i) => keep.includes(i) && wrap.append(el('button', {
      type: 'button', class: 'sw', role: 'radio', title: names[i], 'aria-label': names[i],
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

/* ---------- Mémoire de navigation ----------
   On revient là où on était. Chaque page retient sa dernière adresse
   (fiche, onglet : ?id=, ?tab=…), ses champs marqués data-remember
   (recherche, filtres) et sa position dans la page. Le menu ouvre la
   dernière page vue de chaque rubrique ; les liens data-back
   (« ← Joueurs ») la dernière adresse de leur page. Mémoire de
   l'onglet du navigateur (sessionStorage), vidée à la déconnexion. */
const NAV_MEM = 'lmfc-nav';
const memRead = () => { try { return JSON.parse(sessionStorage.getItem(NAV_MEM)) || {}; } catch { return {}; } };
const memWrite = (m) => { try { sessionStorage.setItem(NAV_MEM, JSON.stringify(m)); } catch { /* stockage bloqué : pas de mémoire */ } };
const pageOf = (href) => (String(href).split(/[?#]/)[0].split('/').pop() || 'index').replace(/\.html$/i, '') || 'index';
const PAGE = pageOf(location.pathname);
const hereUrl = () => `${location.pathname.split('/').pop() || 'index.html'}${location.search}${location.hash}`;

function pageState() { return memRead().state?.[PAGE] || {}; }
function savePageState(patch) {
  const m = memRead();
  m.state = { ...m.state, [PAGE]: { ...m.state?.[PAGE], ...patch } };
  memWrite(m);
}
function rememberUrl() {
  const m = memRead();
  m.url = { ...m.url, [PAGE]: { u: hereUrl(), t: Date.now() } };
  memWrite(m);
}
/* Dernière adresse connue d'une page (ou null), et la plus récente
   d'une liste de pages (une rubrique et ses pages filles). */
const lastUrl = (page) => memRead().url?.[page]?.u || null;
function latestUrl(pages) {
  const urls = memRead().url || {};
  const best = pages.map(p => urls[p]).filter(Boolean).sort((a, b) => b.t - a.t)[0];
  return best?.u || null;
}
function clearNavMemory() { try { sessionStorage.removeItem(NAV_MEM); } catch { /* rien à vider */ } }

['pushState', 'replaceState'].forEach(fn => {
  const orig = history[fn].bind(history);
  history[fn] = (...args) => { const r = orig(...args); rememberUrl(); return r; };
});
rememberUrl();

/* Champs data-remember : valeur reprise au retour. Une liste remplie
   plus tard (options chargées) se rappelle avec restoreRemembered(). */
function restoreRemembered(root = document) {
  const fields = pageState().fields || {};
  $$('[data-remember]', root).forEach(c => {
    if (!c.id || !(c.id in fields)) return;
    const v = fields[c.id];
    if (c.type === 'checkbox') c.checked = !!v;
    else if (c.tagName !== 'SELECT' || [...c.options].some(o => o.value === v)) c.value = v;
  });
}
const saveField = (e) => {
  const c = e.target.closest?.('[data-remember]');
  if (!c?.id) return;
  savePageState({ fields: { ...pageState().fields, [c.id]: c.type === 'checkbox' ? c.checked : c.value } });
};
document.addEventListener('input', saveField);
document.addEventListener('change', saveField);
/* Questions ouvertes d'une liste <details> (FAQ) : [data-remember-open]. */
document.addEventListener('toggle', (e) => {
  const box = e.target.closest?.('[data-remember-open]');
  if (!box || e.target.tagName !== 'DETAILS') return;
  savePageState({ open: $$('details', box).flatMap((d, i) => (d.open ? [i] : [])) });
}, true);
function restoreOpenDetails() {
  const open = pageState().open || [];
  $$('[data-remember-open]').forEach(box => $$('details', box).forEach((d, i) => { if (open.includes(i)) d.open = true; }));
}
restoreRemembered();
restoreOpenDetails();

/* Position dans la page : retenue en partant, reprise quand on revient
   par le menu ou un lien de retour (le contenu arrive en différé : on
   attend qu'il soit assez haut, 4 s au plus, sans lutter contre un
   défilement de l'utilisateur). */
addEventListener('pagehide', () => {
  const m = memRead();
  m.scroll = { ...m.scroll, [hereUrl()]: Math.round(scrollY) };
  const keys = Object.keys(m.scroll);
  if (keys.length > 40) keys.slice(0, keys.length - 40).forEach(k => delete m.scroll[k]);
  memWrite(m);
});
(() => {
  const m = memRead();
  if (m.restore !== hereUrl()) return;
  delete m.restore; memWrite(m);
  const y = m.scroll?.[hereUrl()];
  if (!y) return;
  const until = Date.now() + 4000;
  let stop = false;
  const cancel = () => { stop = true; };
  ['wheel', 'touchstart', 'keydown'].forEach(t => addEventListener(t, cancel, { once: true, passive: true }));
  const tick = () => {
    if (stop) return;
    if (document.documentElement.scrollHeight - innerHeight >= y) return scrollTo(0, y);
    if (Date.now() < until) setTimeout(tick, 60);
  };
  setTimeout(tick, 0);
})();

/* Liens à mémoire : data-mem="rubrique" (menu, résolu par
   window.resolveNavHref) ou data-back (dernière adresse de la page
   visée). Clic du milieu ou Cmd/Ctrl : lien normal. */
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[data-mem], a[data-back]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const url = a.dataset.mem ? window.resolveNavHref?.(a.dataset.mem) : lastUrl(pageOf(a.getAttribute('href')));
  if (!url) return;
  e.preventDefault();
  const m = memRead(); m.restore = url; memWrite(m);
  location.href = url;
});

/* ---------- Sélection multiple : Tout sélectionner / Tout désélectionner ----------
   selectAllHtml() se pose au-dessus de toute liste à cocher, dans un
   conteneur [data-select-scope] (ou data-select-scope="#autre" pour
   viser une liste ailleurs). Par défaut, les cases visibles et actives
   de la liste sont cochées une à une, avec leur événement change :
   le code de la page n'a rien à savoir. Une page qui tient sa sélection
   autrement écoute l'événement « select-all » (detail.on) sur le
   conteneur et appelle preventDefault(). */
const selectAllHtml = (extra = '') => `<div class="select-all" role="group" aria-label="Sélection">
  <button type="button" class="btn btn-sm" data-select-all="1">Tout sélectionner</button>
  <button type="button" class="btn btn-sm" data-select-all="0">Tout désélectionner</button>${extra}</div>`;
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-select-all]');
  if (!b) return;
  const host = b.closest('[data-select-scope]');
  if (!host) return;
  const on = b.dataset.selectAll === '1';
  const target = host.dataset.selectScope ? document.querySelector(host.dataset.selectScope) : host;
  const evt = new CustomEvent('select-all', { detail: { on }, cancelable: true });
  if (!host.dispatchEvent(evt) || !target) return;
  $$('input[type="checkbox"]', target)
    .filter(c => !c.disabled && c.checked !== on && !c.closest('.select-all, .hidden, [hidden]') && c.getClientRects().length)
    .forEach(c => { c.checked = on; c.dispatchEvent(new Event('change', { bubbles: true })); });
});

/* ---------- Mode sélection : cases, compteur, actions groupées ----------
   Une liste passe en mode sélection (« Sélectionner ») : chaque ligne
   porte une case (selCheckHtml), la barre ci-dessous donne le compteur,
   Tout sélectionner / Tout désélectionner et les actions groupées.
   La page garde sa sélection et écoute les clics [data-bulk] :
   « all », « none », « done » ou la clé d'une action. noun : [singulier,
   pluriel, féminin ?] — « 3 vidéos sélectionnées sur 12 ». */
function bulkBarHtml({ n, total, noun = ['élément', 'éléments', false], actions = [], extra = '' }) {
  const [one, many, fem] = noun;
  const picked = `sélectionné${fem ? 'e' : ''}${n > 1 ? 's' : ''}`;
  return `<div class="bulk-bar" role="toolbar" aria-label="Sélection multiple">
    <span class="bulk-count" role="status"><strong>${n}</strong> ${n > 1 ? many : one} ${picked} sur ${total}</span>
    <span class="select-all">
      <button type="button" class="btn btn-sm" data-bulk="all"${n >= total ? ' disabled' : ''}>Tout sélectionner</button>
      <button type="button" class="btn btn-sm" data-bulk="none"${n ? '' : ' disabled'}>Tout désélectionner</button>${extra}
    </span>
    <span class="bulk-actions">${actions.map(a => `<button type="button" class="btn btn-sm${a.danger ? ' btn-danger' : a.primary ? ' btn-primary' : ''}" data-bulk="${a.key}"${n ? '' : ' disabled'}>${escapeHtml(a.label)}</button>`).join('')}
      <button type="button" class="btn btn-sm" data-bulk="done">Terminer</button>
    </span>
  </div>`;
}
const selCheckHtml = (on) => `<span class="sel-check${on ? ' on' : ''}" aria-hidden="true"></span>`;
/* Confirmation d'une action sur plusieurs éléments : les premiers noms, puis « et N autres ». */
function namesList(names, max = 5) {
  const shown = names.slice(0, max).map(n => `• ${n}`).join('\n');
  return names.length > max ? `${shown}\n… et ${names.length - max} autre${names.length - max > 1 ? 's' : ''}` : shown;
}
