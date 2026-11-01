/* ============================================================
   LMFC Performance — library.js
   Bibliothèque vidéo (supabase/lmfc_v24.sql, lmfc_v25.sql), commun à la
   page Bibliothèque (bibliotheque-page.js) et à l'éditeur de séance
   (session-library.js) : clés de tags, appels à la base, cartes,
   vignettes lues à la demande, explorateur (dossiers en tuiles, recherche
   + tags « tous » / « au moins un », par pages de 48) et lecture d'une
   vidéo. Aucune vidéo
   n'est chargée tant qu'on ne clique pas « Lire ».
   Saisie des tags et gestion : library-tags.js.
   ============================================================ */

/* Même règle que library_text_key / library_tag_key (lmfc_v24.sql) ;
   tests/library-logic.test.mjs vérifie qu'elles répondent pareil. */
const LIB_FROM = 'àâäáãåāçćčéèêëēęěíìîïīñńňóòôöõøōúùûüūůýÿžźżšśř';
const LIB_TO   = 'aaaaaaaccceeeeeeeiiiiinnnooooooouuuuuuyyzzzssr';
const libTextKey = (s) => [...String(s ?? '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss')]
  .map(c => { const i = LIB_FROM.indexOf(c); return i >= 0 ? LIB_TO[i] : c; }).join('')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const libTagKey = (s) => libTextKey(s).replace(/ /g, '');
const libTagClean = (s) => String(s ?? '').replace(/^\s*#+/, '').replace(/\s+/g, ' ').trim();

const LIB_PAGE = 48;
const LIB_MISSING = 'La bibliothèque vidéo n’est pas encore installée : passez lmfc_v24.sql et lmfc_v25.sql dans Supabase.';
/* Message d'une erreur de la base, lisible par le staff. */
function libError(e) {
  if (e?.code === 'PGRST202' || e?.code === '42P01' || e?.code === 'PGRST205') return LIB_MISSING;
  return e?.message || String(e);
}

/* ---------- Tags du club (avec le nombre de procédés visibles) ---------- */
const libTags = { list: [], byId: new Map(), ready: null };
function loadLibTags(force = false) {
  if (libTags.ready && !force) return libTags.ready;
  libTags.ready = sb.rpc('library_tags_list').then(({ data, error }) => {
    if (error) { libTags.ready = null; throw error; }
    libTags.list = data || [];
    libTags.byId = new Map(libTags.list.map(t => [t.id, t]));
    return libTags.list;
  });
  return libTags.ready;
}
const libTagChip = (t, { remove = '' } = {}) => `<span class="lib-tag">#${escapeHtml(t.label)}${remove
  ? `<button type="button" class="lib-tag-x" ${remove}="${t.id}" aria-label="Retirer #${escapeHtml(t.label)}">×</button>` : ''}</span>`;

/* ---------- Dossiers (lmfc_v31.sql) : liste partagée, nombre de vidéos visibles ; id 0 = sans dossier ---------- */
const libFolders = { list: [], ready: null };
function loadLibFolders(force = false) {
  if (!libFolders.ready || force) {
    libFolders.ready = sb.rpc('library_folders_list').then(({ data, error }) => {
      if (error && error.code !== 'PGRST202') console.warn('Dossiers de la bibliothèque', error.message);
      libFolders.list = data || [];
    });
  }
  return libFolders.ready;
}
const libFolderName = (id) => libFolders.list.find(f => f.id === (id || 0))?.nom || 'Sans dossier';
const LIB_FOLDER_IC = '<svg class="lib-folder-ic" viewBox="0 0 48 40" aria-hidden="true"><path d="M3 7a3 3 0 0 1 3-3h12l4 5h20a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"/><path d="M3 14h42"/></svg>';
const libFolderOptions = (current, { all = true } = {}) => (all ? '<option value="">Tous les dossiers</option>' : '')
  + libFolders.list.filter(f => (all || f.id !== 0) && (!f.archived || f.id === current)).map(f => `<option value="${f.id}"${f.id === current ? ' selected' : ''}>${escapeHtml(f.nom)}${all ? ` (${f.n})` : ''}</option>`).join('');

/* ---------- Recherche ---------- */
async function libSearch({ q = '', tags = [], mode = 'all', statut = 'actif', offset = 0, limit = LIB_PAGE, folder = null } = {}) {
  const { data, error } = await sb.rpc('library_search', {
    p_q: q, p_tags: tags, p_mode: mode, p_statut: statut, p_limit: limit, p_offset: offset,
    ...(folder === null ? {} : { p_folder: folder }),   // sans dossier choisi : l'appel d'avant lmfc_v31.sql
  });
  if (error) throw error;
  return data || [];
}

/* ---------- Vignettes : lues par lots, pour les seules cartes affichées ---------- */
const libThumbs = { cache: new Map(), wait: new Set(), timer: 0, obs: null };
function fillLibThumb(box, src) {
  const img = box.querySelector('img');
  if (src) { img.src = src; img.hidden = false; }
  box.classList.add('is-ready');
}
async function flushLibThumbs() {
  const ids = [...libThumbs.wait];
  libThumbs.wait.clear();
  if (!ids.length) return;
  const { data, error } = await sb.from('library_files').select('id, thumb').in('id', ids);
  if (error) console.warn('Vignettes de la bibliothèque', error);
  ids.forEach(id => libThumbs.cache.set(id, (data || []).find(f => f.id === id)?.thumb || ''));
  ids.forEach(id => document.querySelectorAll(`[data-lib-thumb="${id}"]`).forEach(b => fillLibThumb(b, libThumbs.cache.get(id))));
}
function observeLibThumbs(root) {
  libThumbs.obs ||= new IntersectionObserver((entries) => {
    entries.forEach(({ isIntersecting, target }) => {
      if (!isIntersecting) return;
      libThumbs.obs.unobserve(target);
      const id = Number(target.dataset.libThumb);
      if (libThumbs.cache.has(id)) return fillLibThumb(target, libThumbs.cache.get(id));
      libThumbs.wait.add(id);
      clearTimeout(libThumbs.timer);
      libThumbs.timer = setTimeout(flushLibThumbs, 60);
    });
  }, { rootMargin: '300px' });
  root.querySelectorAll('[data-lib-thumb]:not(.is-ready)').forEach(b => libThumbs.obs.observe(b));
}
/* Horodatage de la base (« 2026-10-28T10:… ») → « 28 oct. 2026 ». */
const libDate = (ts) => fmtDate(String(ts || '').slice(0, 10));
const libDuration = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
const libThumbHtml = (fileId, duree) => `<span class="lib-thumb" data-lib-thumb="${Number(fileId) || 0}">
  <img alt="" hidden>${duree ? `<span class="lib-thumb-badge">${libDuration(duree)}</span>` : ''}</span>`;

/* ---------- Lecture (lien signé par le Worker : la base décide) ---------- */
async function libPlay(path, title) {
  let src = null;
  try { src = path && await videoUrl(path); } catch (e) { console.warn('Lien de lecture', path, e); }
  if (!src) return toast('Vidéo indisponible ou accès refusé.', 'error');
  openLightbox({ title, items: [{ type: 'video', src }] });
}

/* ---------- Carte d'un procédé ---------- */
const LIB_STATUT = { archive: 'Archivé', retire: 'Retiré' };
function libCardHtml(r, { pick = false, hl = 2, drag = false, folder = false } = {}) {
  const tags = (r.tag_ids || []).map(id => libTags.byId.get(id)).filter(Boolean);
  const meta = [folder && r.folder_id ? libFolderName(r.folder_id) : '', `v${r.version_no || 1}`, libDate(r.updated_at)].filter(Boolean).join(' · ');
  return `<article class="lib-card" data-lib-id="${r.id}" role="listitem"${drag ? ' draggable="true"' : ''}>
    <button class="lib-card-thumb" type="button" data-lib-open="${r.id}" aria-label="Ouvrir « ${escapeHtml(r.titre)} »">
      ${libThumbHtml(r.file_id, r.duree_sec)}</button>
    <div class="lib-card-body">
      <h${hl} class="lib-card-title as-h4"><button type="button" data-lib-open="${r.id}">${escapeHtml(r.titre)}</button></h${hl}>
      <p class="lib-card-meta">${LIB_STATUT[r.statut] ? `<span class="badge">${LIB_STATUT[r.statut]}</span> ` : ''}${escapeHtml(meta)}</p>
      ${tags.length ? `<p class="lib-tags">${tags.map(t => libTagChip(t)).join('')}</p>` : ''}
      <div class="lib-card-actions">
        <button class="btn btn-sm" type="button" data-lib-play="${r.id}">▶ Lire</button>
        ${pick ? `<button class="btn btn-sm btn-primary" type="button" data-lib-pick="${r.id}">Choisir</button>` : ''}
      </div>
    </div>
  </article>`;
}

/* ---------- Explorateur : dossiers, recherche, filtres, grille ou liste ----------
   root : conteneur ; opts.pick (sélecteur de l'éditeur : actifs seulement,
   bouton « Choisir »), opts.onOpen(row), opts.onPick(row), opts.hl ;
   opts.manage (tuile « Nouveau dossier » et menu « ⋯ » : boutons data-lf,
   library-folders.js), opts.onDrop(folderId, itemId) (glisser une vidéo
   sur un dossier ; 0 = sans dossier).
   Avec des dossiers : la racine montre leurs tuiles puis les vidéos sans
   dossier ; un clic ouvre le dossier (fil « Bibliothèque › Rondo »). Une
   recherche, un tag ou « Archivés » cherche dans toute la bibliothèque. */
const LIB_VIEW = 'lmfc-lib-view';
function createLibBrowser(root, opts = {}) {
  const id = root.id || 'lib';
  let view = 'grid';
  try { view = localStorage.getItem(LIB_VIEW) === 'list' ? 'list' : 'grid'; } catch { /* stockage indisponible */ }
  const st = { q: '', tags: [], mode: 'all', statut: 'actif', folder: null, rows: [], total: 0, seq: 0, busy: false };
  root.innerHTML = `
    <div class="lib-toolbar">
      <input type="search" id="${id}-q" class="lib-search" placeholder="Rechercher : titre, consignes, tag…" aria-label="Rechercher une vidéo" autocomplete="off">
      ${opts.pick ? '' : `<select id="${id}-statut" aria-label="Procédés affichés">
        <option value="actif">Actifs</option><option value="archive">Archivés</option>
        ${canManageVideos(window.CURRENT_PROFILE?.role) ? '<option value="retire">Retirés</option>' : ''}</select>`}
      <div class="segmented" role="group" aria-label="Affichage">
        <button type="button" data-lib-view="grid" aria-pressed="${view === 'grid'}">Grille</button>
        <button type="button" data-lib-view="list" aria-pressed="${view === 'list'}">Liste</button></div>
    </div>
    <div class="lib-filters">
      <div class="lib-tagfilter" id="${id}-tagfilter"></div>
      <div class="segmented" role="group" aria-label="Plusieurs tags">
        <button type="button" data-lib-mode="all" aria-pressed="true">Tous les tags</button>
        <button type="button" data-lib-mode="any" aria-pressed="false">Au moins un</button></div>
    </div>
    <nav class="lib-crumbs hidden" id="${id}-crumbs" aria-label="Emplacement"></nav>
    <div class="lib-folders hidden" id="${id}-folders" role="list" aria-label="Dossiers"></div>
    <p class="lib-status" id="${id}-status" role="status" aria-live="polite">Chargement…</p>
    <div class="lib-results is-${view}" id="${id}-results" role="list"></div>
    <div class="lib-more"><button class="btn hidden" type="button" id="${id}-more">Afficher plus</button></div>`;
  const $id = (s) => document.getElementById(`${id}-${s}`);
  const results = $id('results'), more = $id('more');
  // Rangement par dossiers : seulement sans recherche, sans tag, sur les actifs.
  const browse = () => st.statut === 'actif' && !st.q && !st.tags.length && libFolders.list.some(f => f.id !== 0);
  const folderArg = () => (browse() ? st.folder ?? 0 : null);

  const status = () => {
    const n = st.total, top = browse() && st.folder === null;
    $id('status').textContent = st.busy && !st.rows.length ? 'Recherche…'
      : n ? `${st.rows.length < n ? `${st.rows.length} sur ` : ''}${n} vidéo${n > 1 ? 's' : ''}${top ? ' sans dossier' : ''}`
      : top ? '' : browse() ? 'Ce dossier est vide.' : 'Aucune vidéo ne correspond.';
    more.classList.toggle('hidden', st.rows.length >= n);
  };
  function drawFolders() {
    if (st.folder !== null && !libFolders.list.some(f => f.id === st.folder)) st.folder = null;   // dossier supprimé
    const on = browse(), top = on && st.folder === null;
    const tiles = libFolders.list.filter(f => f.id !== 0 && (opts.manage || !f.archived)).map(f => `
      <div class="lib-folder${f.archived ? ' is-off' : ''}" role="listitem" data-lib-drop="${f.id}">
        <button type="button" class="lib-folder-open" data-lib-folder="${f.id}">${LIB_FOLDER_IC}
          <span class="lib-folder-name">${escapeHtml(f.nom)}</span>
          <span class="lib-folder-n">${f.archived ? 'Archivé · ' : ''}${f.n} vidéo${f.n > 1 ? 's' : ''}</span></button>
        ${opts.manage ? `<details class="lib-folder-menu"><summary aria-label="Actions du dossier ${escapeHtml(f.nom)}">⋯</summary>
          <div class="lib-folder-pop"><button type="button" data-lf="rename" data-id="${f.id}">Renommer</button>
            <button type="button" data-lf="${f.archived ? 'unarchive' : 'archive'}" data-id="${f.id}">${f.archived ? 'Réactiver' : 'Archiver'}</button>
            <button type="button" class="is-danger" data-lf="delete" data-id="${f.id}" data-n="${f.n}">Supprimer</button></div></details>` : ''}
      </div>`).join('');
    const add = opts.manage ? `<div class="lib-folder is-new" role="listitem"><button type="button" class="lib-folder-open" data-lf="new">
      <span class="lib-folder-ic" aria-hidden="true">+</span><span class="lib-folder-name">Nouveau dossier</span></button></div>` : '';
    $id('folders').innerHTML = top ? tiles + add : '';
    $id('folders').classList.toggle('hidden', !top);
    $id('crumbs').innerHTML = on && !top ? `<button type="button" data-lib-folder="" data-lib-drop="0">Bibliothèque</button>
      <span aria-hidden="true">›</span><strong aria-current="location">${escapeHtml(libFolderName(st.folder))}</strong>` : '';
    $id('crumbs').classList.toggle('hidden', !on || top);
  }
  async function load(reset) {
    const seq = reset ? ++st.seq : st.seq;
    if (!reset && (st.busy || st.rows.length >= st.total)) return;
    st.busy = true; status();
    try {
      const rows = await libSearch({ q: st.q, tags: st.tags, mode: st.mode, statut: st.statut, folder: folderArg(), offset: reset ? 0 : st.rows.length });
      if (seq !== st.seq) return;   // une recherche plus récente est partie
      if (reset) { st.rows = []; results.innerHTML = ''; drawFolders(); }
      st.rows.push(...rows);
      st.total = rows.length ? Number(rows[0].total) : st.rows.length;
      const card = { ...opts, drag: !!opts.onDrop, folder: !browse() };
      results.insertAdjacentHTML('beforeend', rows.map(r => libCardHtml(r, card)).join(''));
      observeLibThumbs(results);
    } catch (e) {
      console.error('Bibliothèque : recherche', e);
      if (seq === st.seq) results.innerHTML = `<p class="empty">${escapeHtml(libError(e))}</p>`;
    } finally {
      if (seq === st.seq) { st.busy = false; status(); }
    }
  }
  let typing = 0;
  $id('q').addEventListener('input', (e) => { clearTimeout(typing); typing = setTimeout(() => { st.q = e.target.value; load(true); }, 220); });
  $id('statut')?.addEventListener('change', (e) => { st.statut = e.target.value; load(true); });
  more.addEventListener('click', () => load(false));
  new IntersectionObserver(([en]) => { if (en.isIntersecting) load(false); }, { rootMargin: '400px' }).observe(more.parentElement);
  root.addEventListener('click', (e) => {
    const v = e.target.closest('[data-lib-view]'), m = e.target.closest('[data-lib-mode]'), f = e.target.closest('[data-lib-folder]');
    if (f) { st.folder = f.dataset.libFolder === '' ? null : Number(f.dataset.libFolder); drawFolders(); load(true); return; }
    if (v) {
      view = v.dataset.libView;
      try { localStorage.setItem(LIB_VIEW, view); } catch { /* idem */ }
      results.className = `lib-results is-${view}`;
      root.querySelectorAll('[data-lib-view]').forEach(b => b.setAttribute('aria-pressed', String(b === v)));
      return;
    }
    if (m) {
      st.mode = m.dataset.libMode;
      root.querySelectorAll('[data-lib-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === m)));
      if (st.tags.length > 1) load(true);
      return;
    }
    const row = (attr) => { const b = e.target.closest(`[${attr}]`); return b && st.rows.find(r => r.id === Number(b.getAttribute(attr))); };
    const play = row('data-lib-play'), open = row('data-lib-open'), pick = row('data-lib-pick');
    if (play) libPlay(play.storage_path, play.titre);
    else if (pick) opts.onPick?.(pick);
    else if (open) (opts.onOpen || opts.onPick)?.(open);
  });
  if (opts.onDrop) libDropZones(root, opts.onDrop);
  // Menu « ⋯ » d'un dossier : un clic ailleurs le ferme.
  document.addEventListener('click', (e) => root.querySelectorAll('.lib-folder-menu[open]').forEach(d => d.contains(e.target) || d.removeAttribute('open')));
  const api = {
    reload: () => load(true),
    setTags(ids) { st.tags = ids; load(true); },
    folder: () => st.folder,
    async refreshFolders() { await loadLibFolders(true); drawFolders(); },
    focus: () => $id('q').focus(),
  };
  Promise.all([loadLibFolders(), loadLibTags().catch(e => console.warn('Tags de la bibliothèque', e))]).finally(() => {
    if (typeof mountTagFilter === 'function') mountTagFilter($id('tagfilter'), (ids) => api.setTags(ids));   // library-tags.js
    load(true);
  });
  return api;
}

/* Glisser une carte sur une tuile de dossier (ou sur « Bibliothèque » : sans dossier). */
function libDropZones(root, onDrop) {
  const zone = (e) => root.classList.contains('is-dragging') && e.target.closest?.('[data-lib-drop]');
  const clear = () => root.querySelectorAll('.is-drop').forEach(z => z.classList.remove('is-drop'));
  root.addEventListener('dragstart', (e) => {
    const card = e.target.closest?.('[data-lib-id]');
    if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.libId);
    e.dataTransfer.effectAllowed = 'move';
    root.classList.add('is-dragging');
  });
  root.addEventListener('dragend', () => { root.classList.remove('is-dragging'); clear(); });
  root.addEventListener('dragover', (e) => {
    const z = zone(e);
    if (!z) return;
    e.preventDefault();
    if (!z.classList.contains('is-drop')) { clear(); z.classList.add('is-drop'); }
  });
  root.addEventListener('drop', (e) => {
    const z = zone(e), id = Number(e.dataTransfer.getData('text/plain'));
    if (!z) return;
    e.preventDefault();
    root.classList.remove('is-dragging'); clear();
    if (id) onDrop(Number(z.dataset.libDrop), id);
  });
}
