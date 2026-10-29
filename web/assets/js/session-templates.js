/* ============================================================
   LMFC Performance — session-templates.js (session-edit.html)
   Schémas enregistrés (exercise_templates) : procédés gardés comme
   modèles (☆ sur un procédé, « Ajouter aux schémas » du tableau
   tactique), retrouvés puis insérés dans une séance (bouton « Schémas »).
     - recherche par nom (casse et accents ignorés), par type, par tags
       « tous » ou « au moins un » : les critères se combinent ;
     - tags = ceux de la bibliothèque vidéo (lmfc_v26.sql) : même
       vocabulaire, même gestion, jamais deux tags de même clé. Ils
       classent le schéma, ils ne changent ni son dessin ni les séances ;
     - sans lmfc_v26.sql, la fenêtre marche comme avant, sans tags.
   Dépend de session-edit-page.js (procedures, addProcedure, myProfile…),
   library.js et library-tags.js (libTags, attachTagCombo, filtre).
   ============================================================ */

const TPL_FIELDS = ['nom', 'duree_min', 'objectif', 'effectif', 'taille_terrain',
  'consignes', 'principes_jeu', 'comportements_individuels', 'temps_recup_min',
  'type_procede', 'nb_sequences', 'duree_sequence_min'];
const TPL = { rows: [], urls: new Map(), tagsOn: false, q: '', cat: '', tags: [], mode: 'all', bound: false, filter: false };

/* Schémas qui répondent à tous les critères : nom (sans casse ni accents),
   type, tags (tous, ou au moins un). */
function filterTemplates(rows, { q = '', cat = '', tags = [], mode = 'all' } = {}) {
  const key = libTextKey(q);
  const hasTags = (t) => (mode === 'any' ? tags.some(id => t.tag_ids.includes(id)) : tags.every(id => t.tag_ids.includes(id)));
  return rows.filter(t => (!key || libTextKey(t.nom).includes(key))
    && (!cat || (t.categorie || '') === cat)
    && (!tags.length || hasTags(t)));
}

window.saveAsTemplate = async (uid) => {
  syncFromDom();
  const p = procedures.find(x => x._uid === uid); if (!p) return;
  const nom = prompt('Nom du modèle :', p.nom || 'Exercice'); if (!nom) return;
  const data = {}; TPL_FIELDS.forEach(k => data[k] = p[k]);
  data.principes_jeu = procPrinciple(p, { principes_jeu: document.getElementById('f-principe').value });
  try {
    let image_path = null;
    if (p.image_path) {
      image_path = `${myProfile.club_id}/templates/${Date.now()}.png`;
      const { error: copyErr } = await sb.storage.from('schemas').copy(p.image_path, image_path);
      if (copyErr) image_path = null;   // pas bloquant : le modèle reste utile sans image
    }
    // Le dessin suit le modèle : inséré dans une autre séance, il reste modifiable.
    const { data: sch } = p.id && p.has_canvas
      ? await sb.from('tactical_schemas').select('canvas_json').eq('procedure_id', p.id).maybeSingle() : { data: null };
    const { error } = await sb.from('exercise_templates').insert({
      // La catégorie du modèle reprend le type du procédé (jeu / exercice / situation),
      // ce qui donne aux schémas un classement utile.
      club_id: myProfile.club_id, nom, categorie: p.type_procede || null, data, image_path, canvas_json: sch?.canvas_json || null,
    });
    if (error) throw error;
    toast('Modèle enregistré dans les schémas : ajoutez-lui des tags depuis « Schémas »', 'success');
  } catch (e) { toast(e.message, 'error'); }
};

/* Schémas du club, avec leurs tags si lmfc_v26.sql est passée ; images signées en un appel. */
async function loadTemplates() {
  const cols = 'id, nom, categorie, image_path';
  let { data, error } = await sb.from('exercise_templates').select(`${cols}, exercise_template_tags(tag_id)`).order('created_at', { ascending: false });
  TPL.tagsOn = !error;
  if (error) {
    console.warn('Schémas : tags indisponibles (lmfc_v26.sql non passée ?)', error);
    ({ data, error } = await sb.from('exercise_templates').select(cols).order('created_at', { ascending: false }));
    if (error) throw error;
  }
  TPL.rows = data.map(t => ({ ...t, tag_ids: (t.exercise_template_tags || []).map(x => Number(x.tag_id)) }));
  if (TPL.tagsOn) {
    try { await loadLibTags(true); } catch (e) { console.warn('Schémas : tags illisibles', e); TPL.tagsOn = false; }
  }
  const paths = TPL.rows.map(t => t.image_path).filter(p => p && !TPL.urls.has(p));
  if (paths.length) {
    const { data: signed, error: signErr } = await sb.storage.from('schemas').createSignedUrls(paths, 3600);
    if (signErr) console.warn('Schémas : miniatures indisponibles', signErr);
    (signed || []).forEach(s => s.signedUrl && TPL.urls.set(s.path, s.signedUrl));
  }
}

async function openLibrary() {
  openModal('libraryModal');
  const list = document.getElementById('libraryList');
  list.innerHTML = '<p class="text-muted">Chargement…</p>';
  bindTemplateTools();
  try { await loadTemplates(); } catch (e) { list.innerHTML = `<p class="text-danger">${escapeHtml(e.message)}</p>`; return; }
  const cats = [...new Set(TPL.rows.map(t => t.categorie).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  if (TPL.cat && !cats.includes(TPL.cat)) TPL.cat = '';
  document.getElementById('tplCat').innerHTML = `<option value="">Tous les types</option>${cats.map(c =>
    `<option value="${escapeHtml(c)}"${c === TPL.cat ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}`;
  document.getElementById('tplTagRow').classList.toggle('hidden', !TPL.tagsOn);
  TPL.tags = TPL.tags.filter(id => libTags.byId.has(id));
  if (TPL.tagsOn && !TPL.filter) {
    TPL.filter = true;
    mountTagFilter(document.getElementById('tplTagFilter'), (ids) => { TPL.tags = ids; renderTemplates(); });
  }
  renderTemplates();
}

function templateCard(t) {
  const url = t.image_path && TPL.urls.get(t.image_path);
  const tags = t.tag_ids.map(id => libTags.byId.get(id)).filter(Boolean);
  return `<div class="library-card" data-tpl="${t.id}">
    ${url ? `<img src="${escapeHtml(url)}" alt="" loading="lazy">` : '<div class="lib-noimg">Sans schéma</div>'}
    <div class="lib-body">
      <div class="lib-name">${escapeHtml(t.nom)}</div>
      <div class="lib-cat">${escapeHtml(t.categorie || '')}</div>
      ${TPL.tagsOn ? `<div class="lib-tags tpl-tags">${tags.map(g => libTagChip(g, { remove: 'data-tpl-untag' })).join('')}
        <button type="button" class="lib-tag is-quick" data-tpl-tagadd aria-label="Ajouter un tag à ${escapeHtml(t.nom)}">+ tag</button></div>` : ''}
      <div class="lib-actions">
        <button class="btn btn-sm btn-primary" type="button" data-do="insertTemplate" data-arg="${t.id}">Insérer</button>
        <button class="btn btn-sm btn-danger" type="button" data-do="deleteTemplate" data-arg="${t.id}">Supprimer</button>
      </div>
    </div>
  </div>`;
}

function renderTemplates() {
  const list = document.getElementById('libraryList'), status = document.getElementById('tplStatus');
  if (!TPL.rows.length) {
    status.textContent = '';
    list.innerHTML = '<p class="text-muted">Aucun schéma enregistré. Cliquez sur ☆ sur un procédé, ou sur « Ajouter aux schémas » dans le tableau tactique (Exporter).</p>';
    return;
  }
  const shown = filterTemplates(TPL.rows, TPL);
  const n = TPL.rows.length;
  status.textContent = shown.length === n ? `${n} schéma${n > 1 ? 's' : ''}` : `${shown.length} sur ${n} schéma${n > 1 ? 's' : ''}`;
  list.innerHTML = shown.length ? shown.map(templateCard).join('')
    : '<p class="text-muted">Aucun schéma ne correspond : retirez un critère.</p>';
}

/* Barre de recherche et tags : écoutes posées une fois. */
function bindTemplateTools() {
  if (TPL.bound) return;
  TPL.bound = true;
  const modal = document.getElementById('libraryModal');
  document.getElementById('tplQ').addEventListener('input', (e) => { TPL.q = e.target.value; renderTemplates(); });
  document.getElementById('tplCat').addEventListener('change', (e) => { TPL.cat = e.target.value; renderTemplates(); });
  document.getElementById('tplTagsManage').addEventListener('click', () => openTagManager(openLibrary));
  modal.addEventListener('click', (e) => {
    const mode = e.target.closest('[data-tpl-mode]'), del = e.target.closest('[data-tpl-untag]'), add = e.target.closest('[data-tpl-tagadd]');
    if (mode) {
      TPL.mode = mode.dataset.tplMode;
      modal.querySelectorAll('[data-tpl-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === mode)));
      renderTemplates();
    } else if (del) {
      untagTemplate(Number(del.closest('[data-tpl]').dataset.tpl), Number(del.dataset.tplUntag));
    } else if (add) {
      const id = Number(add.closest('[data-tpl]').dataset.tpl), row = TPL.rows.find(t => t.id === id);
      const box = document.createElement('span');
      box.className = 'tpl-tag-combo';
      add.replaceWith(box);
      attachTagCombo(box, { allowCreate: true, label: `Ajouter un tag à ${row?.nom || 'ce schéma'}`,
        exclude: () => new Set(row?.tag_ids), onChoose: (t) => tagTemplate(id, t) }).input.focus();
    }
  });
}

async function tagTemplate(id, tag) {
  const row = TPL.rows.find(t => t.id === id);
  if (!row) return;
  const { error } = await sb.from('exercise_template_tags').insert({ template_id: id, tag_id: tag.id });
  if (error && error.code !== '23505') return toast(libError(error), 'error');   // 23505 : déjà là
  if (!row.tag_ids.includes(tag.id)) row.tag_ids.push(tag.id);
  await loadLibTags(true).catch(() => {});
  renderTemplates();
}
async function untagTemplate(id, tagId) {
  const row = TPL.rows.find(t => t.id === id);
  const { error } = await sb.from('exercise_template_tags').delete().eq('template_id', id).eq('tag_id', tagId);
  if (error) return toast(libError(error), 'error');
  if (row) row.tag_ids = row.tag_ids.filter(x => x !== tagId);
  await loadLibTags(true).catch(() => {});
  renderTemplates();
}

window.insertTemplate = async (id) => {
  try {
    const { data: tpl, error } = await sb.from('exercise_templates').select('nom, data, image_path, canvas_json').eq('id', id).single();
    if (error) throw error;
    addProcedure({ nom: tpl.nom, ...tpl.data }, tpl);
    closeModal('libraryModal');
    toast('Procédé ajouté depuis les schémas', 'success');
  } catch (e) { toast(e.message, 'error'); }
};
window.deleteTemplate = async (id) => {
  if (!confirm(`Supprimer ce modèle ?${await trashNote()}`)) return;
  try {
    const { error } = await sb.from('exercise_templates').delete().eq('id', id);
    if (error) throw error;
    TPL.rows = TPL.rows.filter(t => t.id !== id);
    renderTemplates();
  } catch (e) { toast(e.message, 'error'); }
};

Object.assign(EDIT_DO, {
  insertTemplate: (b) => insertTemplate(Number(b.dataset.arg)),
  deleteTemplate: (b) => deleteTemplate(Number(b.dataset.arg)),
  saveAsTemplate: (b) => saveAsTemplate(b.dataset.arg),
});
