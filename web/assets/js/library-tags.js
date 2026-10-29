/* ============================================================
   LMFC Performance — library-tags.js
   Tags de la bibliothèque vidéo (lmfc_v25.sql) :
     - saisie avec suggestions (attachTagCombo) : un tag dont la clé
       existe déjà (casse, accents, espaces, « # ») est repris tel quel,
       jamais créé en double ; la base le garantit aussi ;
     - filtre par tags de l'explorateur (mountTagFilter, library.js) ;
     - gestion (openTagManager) : renommer, fusionner, supprimer ; un tag
       utilisé n'est supprimé qu'en confirmant le nombre de procédés.
   ============================================================ */

let tagComboSeq = 0;
/* box : conteneur ; onChoose(tag) ; allowCreate : proposer « Créer #… » ;
   exclude() : ids déjà choisis (à ne plus proposer). */
function attachTagCombo(box, { onChoose, allowCreate = false, exclude = () => new Set(), label = 'Ajouter un tag' }) {
  const uid = `tagc${++tagComboSeq}`;
  box.innerHTML = `<div class="lib-combo">
    <input type="text" id="${uid}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${uid}-l"
      aria-label="${escapeHtml(label)}" placeholder="#tag" autocomplete="off" maxlength="41">
    <ul class="lib-combo-list" id="${uid}-l" role="listbox" hidden></ul></div>`;
  const input = box.querySelector('input'), list = box.querySelector('ul');
  let items = [], active = -1;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const render = () => {
    const key = libTagKey(input.value), ex = exclude();
    const exact = key && libTags.list.find(t => t.key === key);
    items = libTags.list.filter(t => !ex.has(t.id) && (!key || t.key.includes(key)))
      .sort((a, b) => (b.key.startsWith(key) - a.key.startsWith(key)) || b.uses - a.uses).slice(0, 8).map(t => ({ t }));
    if (allowCreate && key && !exact) items.push({ create: libTagClean(input.value) });
    if (!items.length) return close();
    list.innerHTML = items.map((it, i) => `<li id="${uid}-${i}" role="option" aria-selected="${i === active}" data-i="${i}">${it.t
      ? `#${escapeHtml(it.t.label)} <span class="lib-combo-n">${it.t.uses}</span>` : `<span>Créer <strong>#${escapeHtml(it.create)}</strong></span>`}</li>`).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `${uid}-${active}`);
  };
  async function choose(it) {
    if (!it) return;
    let tag = it.t;
    if (it.create) {
      const { data, error } = await sb.rpc('library_tag_ensure', { p_label: it.create });
      if (error) return toast(libError(error), 'error');
      if (!data.created) toast(`#${data.label} existe déjà : il est repris tel quel.`, 'info');
      await loadLibTags(true);
      tag = libTags.byId.get(data.id) || { id: data.id, label: data.label, uses: 0 };
    }
    input.value = '';
    close();
    onChoose(tag);
  }
  input.addEventListener('input', () => { active = -1; render(); });
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) render();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(items.length, 1);
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const key = libTagKey(input.value);
      choose(items[active] || items.find(it => it.t?.key === key) || items.find(it => it.create));
    } else if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); close(); }
  });
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) { e.preventDefault(); choose(items[Number(li.dataset.i)]); }
  });
  return { input };
}

/* Filtre de l'explorateur : tags choisis, tags fréquents, saisie. */
function mountTagFilter(el, onChange) {
  const chosen = [];
  const render = () => {
    const quick = libTags.list.filter(t => t.uses && !chosen.includes(t.id)).slice(0, 10);
    el.querySelector('.lib-tf-chosen').innerHTML = chosen.map(id => libTags.byId.get(id)).filter(Boolean)
      .map(t => libTagChip(t, { remove: 'data-tf-del' })).join('');
    el.querySelector('.lib-tf-quick').innerHTML = quick.map(t =>
      `<button type="button" class="lib-tag is-quick" data-tf-add="${t.id}" aria-label="Filtrer par #${escapeHtml(t.label)}">#${escapeHtml(t.label)}</button>`).join('');
  };
  el.innerHTML = '<span class="lib-tf-chosen"></span><span class="lib-tf-combo"></span><span class="lib-tf-quick"></span>';
  const set = (fn) => { fn(); render(); onChange([...chosen]); };
  attachTagCombo(el.querySelector('.lib-tf-combo'), {
    label: 'Filtrer par tag', exclude: () => new Set(chosen), onChoose: (t) => set(() => chosen.push(t.id)),
  });
  el.addEventListener('click', (e) => {
    const add = e.target.closest('[data-tf-add]'), del = e.target.closest('[data-tf-del]');
    if (add) set(() => chosen.push(Number(add.dataset.tfAdd)));
    if (del) set(() => chosen.splice(chosen.indexOf(Number(del.dataset.tfDel)), 1));
  });
  render();
}

/* ---------- Gestion des tags (fenêtre #libTagsModal) ---------- */
let tagManagerDone = null;   // à appeler après un changement (la page relance sa recherche)
async function openTagManager(onDone) {
  tagManagerDone = onDone;
  openModal('libTagsModal');
  await renderTagManager();
}
async function renderTagManager(mergeId = null) {
  const body = document.getElementById('libTagsBody');
  try { await loadLibTags(true); } catch (e) { body.innerHTML = `<p class="text-danger">${escapeHtml(libError(e))}</p>`; return; }
  if (!libTags.list.length) { body.innerHTML = '<p class="text-muted">Aucun tag pour l’instant : ajoutez-en depuis la fiche d’un procédé.</p>'; return; }
  body.innerHTML = `<ul class="lib-tm">${libTags.list.map(t => `<li class="lib-tm-row">
    <span class="lib-tm-label">#${escapeHtml(t.label)}</span>
    <span class="lib-tm-n">${t.uses} procédé${t.uses > 1 ? 's' : ''}</span>
    ${!t.manageable ? '<span class="lib-tm-ro" title="Réservé à l’administrateur ou au créateur du tag">—</span>' : mergeId === t.id ? `
      <label class="sr-only" for="tm-into">Fusionner #${escapeHtml(t.label)} dans</label>
      <select id="tm-into">${libTags.list.filter(x => x.id !== t.id).map(x => `<option value="${x.id}">#${escapeHtml(x.label)}</option>`).join('')}</select>
      <button class="btn btn-sm btn-primary" type="button" data-tm-merge-go="${t.id}">Fusionner</button>
      <button class="btn btn-sm" type="button" data-tm-cancel>Annuler</button>` : `
      <span class="lib-tm-actions">
        <button class="btn btn-sm" type="button" data-tm-rename="${t.id}">Renommer</button>
        ${libTags.list.length > 1 ? `<button class="btn btn-sm" type="button" data-tm-merge="${t.id}">Fusionner…</button>` : ''}
        <button class="btn btn-sm btn-danger" type="button" data-tm-del="${t.id}">Supprimer</button></span>`}
  </li>`).join('')}</ul>`;
}
async function tagAction(promise, ok) {
  const { error } = await promise;
  if (error) return toast(libError(error), 'error');
  if (ok) toast(ok, 'success');
  await renderTagManager();
  tagManagerDone?.();
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-tm-rename], [data-tm-merge], [data-tm-merge-go], [data-tm-del], [data-tm-cancel]');
  if (!b) return;
  if (b.hasAttribute('data-tm-cancel')) return renderTagManager();
  const t = libTags.byId.get(Number(b.dataset.tmRename || b.dataset.tmMerge || b.dataset.tmMergeGo || b.dataset.tmDel));
  if (!t) return;
  if (b.dataset.tmRename) {
    const label = prompt('Nouveau nom du tag :', t.label);
    if (label && libTagClean(label) !== t.label) tagAction(sb.rpc('library_tag_rename', { p_tag: t.id, p_label: label }), 'Tag renommé.');
  } else if (b.dataset.tmMerge) {
    renderTagManager(t.id);
  } else if (b.dataset.tmMergeGo) {
    const into = libTags.byId.get(Number(document.getElementById('tm-into').value));
    if (into && confirm(`Fusionner #${t.label} dans #${into.label} ?\n\nLes procédés de #${t.label} reçoivent #${into.label}, puis #${t.label} disparaît.`)) {
      tagAction(sb.rpc('library_tag_merge', { p_from: t.id, p_into: into.id }), `#${t.label} fusionné dans #${into.label}.`);
    }
  } else if (t.uses === 0 ? confirm(`Supprimer #${t.label} ?`)
    : confirm(`#${t.label} est utilisé par ${t.uses} procédé${t.uses > 1 ? 's' : ''}.\n\nLe retirer de ${t.uses > 1 ? 'ces procédés' : 'ce procédé'} et le supprimer ?\nPour le garder sous un autre nom, choisissez plutôt « Fusionner ».`)) {
    tagAction(sb.rpc('library_tag_delete', { p_tag: t.id, p_expected: t.uses }), `#${t.label} supprimé.`);
  }
});
