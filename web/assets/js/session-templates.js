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
     - sans lmfc_v26.sql, la fenêtre marche comme avant, sans tags ;
     - chaque schéma a son créateur et reste à lui (lmfc_v37.sql) : « Mes
       schémas » / « Club » (ceux des autres qu'on peut lire). Le créateur
       le partage avec le club ou le garde privé ; l'admin voit tout et
       attribue un schéma, dont les anciens, sans créateur enregistré. La
       base décide (RLS) ; sans la migration, tout reste mêlé, comme avant.
   Dépend de session-edit-page.js (procedures, addProcedure, myProfile…) ou
   schemas-page.js, library.js et library-tags.js (libTags, attachTagCombo, filtre).
   ============================================================ */

const TPL_FIELDS = ['nom', 'duree_min', 'objectif', 'effectif', 'taille_terrain',
  'consignes', 'principes_jeu', 'comportements_individuels', 'temps_recup_min',
  'type_procede', 'nb_sequences', 'duree_sequence_min'];
const TPL = { rows: [], urls: new Map(), tagsOn: false, q: '', cat: '', tags: [], mode: 'all', bound: false, filter: false,
  insertLabel: 'Insérer',   // page Bibliothèque de schémas (schemas-page.js) : « Nouvelle séance »
  ownerOn: false, scope: 'mine', staff: [], targetUid: null, pendingImport: null };   // créateur et partage (lmfc_v37.sql) ; staff : club_staff()
const tplMe = () => window.CURRENT_PROFILE || {};
const tplAdmin = () => tplMe().role === 'admin';
const tplMine = (t) => t.created_by === tplMe().id;
const tplCanManage = (t) => !TPL.ownerOn || tplMine(t) || tplAdmin();
const tplCanShare = (t) => tplMe().role !== 'analyste' && tplCanManage(t);

/* Schémas qui répondent à tous les critères : à soi ou aux autres (scope,
   me), nom (sans casse ni accents), type, tags (tous, ou au moins un). */
function filterTemplates(rows, { q = '', cat = '', tags = [], mode = 'all', scope = null, me = null } = {}) {
  const key = libTextKey(q);
  const hasTags = (t) => (mode === 'any' ? tags.some(id => t.tag_ids.includes(id)) : tags.every(id => t.tag_ids.includes(id)));
  return rows.filter(t => (!scope || (t.created_by === me) === (scope === 'mine'))
    && (!key || libTextKey(t.nom).includes(key))
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
      image_path = `${myProfile.club_id}/templates/${Date.now()}.${p.image_path.split('.').pop()}`;   // extension de la source
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
    toast('Schéma enregistré dans « Mes schémas », privé : partagez-le depuis « Schémas » si vous voulez.', 'success');
  } catch (e) { toast(e.message, 'error'); }
};

/* Schémas lisibles par ce compte (la base décide), avec créateur et partage si
   lmfc_v37.sql est passée, leurs tags si lmfc_v26.sql l'est ; images signées en un appel. */
async function loadTemplates() {
  const cols = 'id, nom, categorie, image_path';
  const read = (sel) => sb.from('exercise_templates').select(sel).order('created_at', { ascending: false });
  const [first, staff] = await Promise.all([read(`${cols}, created_by, partage, exercise_template_tags(tag_id)`), sb.rpc('club_staff')]);
  if (staff.error) console.warn('Schémas : noms du staff indisponibles', staff.error);
  TPL.staff = staff.data || [];
  TPL.ownerOn = !first.error;
  let { data, error } = first;
  if (error) {
    console.warn('Schémas : créateurs indisponibles (lmfc_v37.sql non passée ?)', error);
    ({ data, error } = await read(`${cols}, exercise_template_tags(tag_id)`));
  }
  TPL.tagsOn = !error;
  if (error) {
    console.warn('Schémas : tags indisponibles (lmfc_v26.sql non passée ?)', error);
    ({ data, error } = await read(cols));
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

async function openLibrary(targetUid = null) {
  // Le clic sur #btnLibrary passe l'événement DOM ; seul un uid est un import ciblé.
  TPL.targetUid = typeof targetUid === 'string' ? targetUid : null;
  TPL.pendingImport = null;
  if (TPL.targetUid) syncFromDom();
  openModal('libraryModal');
  const title = document.querySelector('#libraryModal h2');
  if (title) title.textContent = TPL.targetUid ? 'Importer un schéma dans le procédé' : 'Schémas enregistrés';
  const list = document.getElementById('libraryList');
  list.innerHTML = '<p class="text-muted">Chargement…</p>';
  document.getElementById('tplTagsManage')?.classList.toggle('hidden', tplMe().role === 'analyste');
  bindTemplateTools();
  try { await loadTemplates(); } catch (e) { list.innerHTML = `<p class="text-danger">${escapeHtml(e.message)}</p>`; return; }
  const cats = [...new Set(TPL.rows.map(t => t.categorie).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  if (TPL.cat && !cats.includes(TPL.cat)) TPL.cat = '';
  document.getElementById('tplCat').innerHTML = `<option value="">Tous les types</option>${cats.map(c =>
    `<option value="${escapeHtml(c)}"${c === TPL.cat ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}`;
  document.getElementById('tplTagRow').classList.toggle('hidden', !TPL.tagsOn);
  document.getElementById('tplScope').classList.toggle('hidden', !TPL.ownerOn);
  if (!TPL.rows.some(tplMine)) TPL.scope = 'club';   // rien à soi : pas de page vide
  TPL.tags = TPL.tags.filter(id => libTags.byId.has(id));
  if (TPL.tagsOn && !TPL.filter) {
    TPL.filter = true;
    mountTagFilter(document.getElementById('tplTagFilter'), (ids) => { TPL.tags = ids; renderTemplates(); });
  }
  renderTemplates();
}

/* À qui est ce schéma, et ce qu'on peut en faire ; l'admin l'attribue à quelqu'un qui crée des schémas. */
function templateOwnerHtml(t) {
  if (!TPL.ownerOn) return '';
  const who = tplMine(t) ? '' : t.created_by ? `Par ${TPL.staff.find(s => s.id === t.created_by)?.nom || 'un ancien membre'}` : 'Créateur inconnu';
  const state = tplCanManage(t) ? (t.partage ? 'Partagé avec le club' : 'Privé') : '';
  const owners = TPL.staff.filter(s => ['admin', 'coach'].includes(s.role));
  return `<div class="lib-owner">${escapeHtml([who, state].filter(Boolean).join(' · '))}${tplAdmin() ? `
    <select data-tpl-owner aria-label="Attribuer « ${escapeHtml(t.nom)} » à un membre du staff">
      <option value="">Attribuer à…</option>${owners.map(s => `<option value="${escapeHtml(s.id)}"${s.id === t.created_by ? ' selected' : ''}>${escapeHtml(s.nom || 'Sans nom')}</option>`).join('')}
    </select>` : ''}</div>`;
}

function templateCard(t) {
  const url = t.image_path && TPL.urls.get(t.image_path);
  const tags = t.tag_ids.map(id => libTags.byId.get(id)).filter(Boolean);
  return `<div class="library-card" data-tpl="${t.id}">
    ${url ? `<button class="tpl-preview" type="button" data-tpl-preview="${t.id}" aria-label="Aperçu du schéma ${escapeHtml(t.nom)}"><img src="${escapeHtml(url)}" alt="" loading="lazy"><span>Aperçu</span></button>` : '<div class="lib-noimg">Sans dessin</div>'}
    <div class="lib-body">
      <div class="lib-name">${escapeHtml(t.nom)}</div>
      <div class="lib-cat">${escapeHtml(t.categorie || '')}</div>
      ${templateOwnerHtml(t)}
      ${TPL.tagsOn ? `<div class="lib-tags tpl-tags">${tags.map(g => libTagChip(g, { remove: 'data-tpl-untag' })).join('')}
        <button type="button" class="lib-tag is-quick" data-tpl-tagadd aria-label="Ajouter un tag à ${escapeHtml(t.nom)}">+ tag</button></div>` : ''}
      <div class="lib-actions">
        <button class="btn btn-sm btn-primary" type="button" data-do="${TPL.targetUid ? 'chooseTemplateForProcedure' : 'insertTemplate'}" data-arg="${t.id}">${TPL.targetUid ? 'Choisir ce schéma' : TPL.insertLabel}</button>
        ${TPL.ownerOn && tplCanShare(t) ? `<button class="btn btn-sm" type="button" data-tpl-share aria-pressed="${!!t.partage}">${t.partage ? 'Rendre privé' : 'Partager'}</button>` : ''}
        ${tplCanManage(t) ? `<button class="btn btn-sm btn-danger" type="button" data-do="deleteTemplate" data-arg="${t.id}">Supprimer</button>` : ''}
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
  const me = tplMe().id, scope = TPL.ownerOn ? TPL.scope : null;
  const pool = filterTemplates(TPL.rows, { scope, me }), shown = filterTemplates(TPL.rows, { ...TPL, scope, me });
  const n = pool.length, mine = TPL.rows.filter(tplMine).length;
  document.querySelectorAll('[data-tpl-scope]').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.tplScope === TPL.scope));
    b.querySelector('span').textContent = b.dataset.tplScope === 'mine' ? mine : TPL.rows.length - mine;
  });
  status.textContent = shown.length === n ? `${n} schéma${n > 1 ? 's' : ''}` : `${shown.length} sur ${n} schéma${n > 1 ? 's' : ''}`;
  list.innerHTML = shown.length ? shown.map(templateCard).join('')
    : `<p class="text-muted">${n ? 'Aucun schéma ne correspond : retirez un critère.'
      : scope === 'mine' ? 'Aucun schéma à vous pour l’instant : ☆ sur un procédé, ou « Ajouter aux schémas » dans le tableau tactique. Il reste privé tant que vous ne le partagez pas.'
      : 'Aucun schéma partagé par les autres membres du club.'}</p>`;
}

/* Barre de recherche et tags : écoutes posées une fois. */
function bindTemplateTools() {
  if (TPL.bound) return;
  TPL.bound = true;
  const modal = document.getElementById('libraryModal');
  document.getElementById('tplQ').addEventListener('input', (e) => { TPL.q = e.target.value; renderTemplates(); });
  document.getElementById('tplCat').addEventListener('change', (e) => { TPL.cat = e.target.value; renderTemplates(); });
  document.getElementById('tplTagsManage').addEventListener('click', () => openTagManager(openLibrary));
  modal.addEventListener('change', (e) => {
    if (e.target.matches('[data-tpl-owner]') && e.target.value) ownTemplate(Number(e.target.closest('[data-tpl]').dataset.tpl), e.target.value);
  });
  modal.addEventListener('click', (e) => {
    const mode = e.target.closest('[data-tpl-mode]'), del = e.target.closest('[data-tpl-untag]'), add = e.target.closest('[data-tpl-tagadd]');
    const scope = e.target.closest('[data-tpl-scope]'), share = e.target.closest('[data-tpl-share]');
    const preview = e.target.closest('[data-tpl-preview]');
    if (preview) {
      const t = TPL.rows.find(x => x.id === Number(preview.dataset.tplPreview));
      const src = t?.image_path && TPL.urls.get(t.image_path);
      if (src) openLightbox({ title: t.nom, items: [{ type: 'image', src }] });
    } else if (scope) {
      TPL.scope = scope.dataset.tplScope;
      renderTemplates();
    } else if (share) {
      shareTemplate(Number(share.closest('[data-tpl]').dataset.tpl));
    } else if (mode) {
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
      attachTagCombo(box, { allowCreate: tplMe().role !== 'analyste', label: `Ajouter un tag à ${row?.nom || 'ce schéma'}`,
        exclude: () => new Set(row?.tag_ids), onChoose: (t) => tagTemplate(id, t) }).input.focus();
    }
  });
}

/* Partager avec le club, ou reprendre : son créateur ou l'admin (RLS). */
async function shareTemplate(id) {
  const row = TPL.rows.find(t => t.id === id);
  if (!row) return;
  const partage = !row.partage;
  const { data, error } = await sb.from('exercise_templates').update({ partage }).eq('id', id).select('id');
  if (error || !data?.length) {
    console.error('Partage du schéma refusé', error);
    return toast(error?.message || 'Modification refusée : ce schéma n’est pas à vous.', 'error');
  }
  row.partage = partage;
  renderTemplates();
  toast(partage ? 'Schéma partagé avec le club.' : 'Schéma redevenu privé.', 'success');
}
/* Attribuer un schéma (admin) : il devient celui de ce membre, privé ; à lui de le partager. */
async function ownTemplate(id, owner) {
  const row = TPL.rows.find(t => t.id === id);
  if (!row) return;
  const { data, error } = await sb.from('exercise_templates').update({ created_by: owner, partage: false }).eq('id', id).select('id');
  if (error || !data?.length) {
    console.error('Attribution du schéma refusée', error);
    toast(error?.message || 'Attribution réservée à l’administrateur.', 'error');
    return renderTemplates();
  }
  Object.assign(row, { created_by: owner, partage: false });
  renderTemplates();
  toast(`« ${row.nom} » attribué à ${TPL.staff.find(s => s.id === owner)?.nom || 'ce membre'}, en privé.`, 'success');
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

const TPL_FIELD_LABELS = {
  nom: 'Nom du procédé', duree_min: 'Durée', objectif: 'Objectif', effectif: 'Effectif',
  taille_terrain: 'Taille du terrain', consignes: 'Consignes', principes_jeu: 'Principe de jeu',
  comportements_individuels: 'Comportements individuels', temps_recup_min: 'Temps de récupération',
  type_procede: 'Type de procédé', nb_sequences: 'Nombre de séquences', duree_sequence_min: 'Durée des séquences',
};
function templateOverwrittenFields(data, procedure) {
  return TPL_FIELDS.filter(k => String(procedure?.[k] ?? '').trim() !== ''
    && String(procedure?.[k] ?? '').trim() !== String(data?.[k] ?? '').trim())
    .map(k => TPL_FIELD_LABELS[k] || k);
}

async function chooseTemplateForProcedure(id) {
  const procedure = procedures.find(p => p._uid === TPL.targetUid && p.id);
  if (!procedure) return toast('Enregistrez d’abord le procédé avant d’y importer un schéma.', 'error');
  try {
    const { data: tpl, error } = await sb.from('exercise_templates')
      .select('id, nom, data, image_path, canvas_json').eq('id', id).single();
    if (error) throw error;
    TPL.pendingImport = { tpl, uid: procedure._uid };
    document.getElementById('tplImportName').textContent = tpl.nom;
    document.getElementById('tplImportTarget').textContent = procedure.nom || 'Procédé sans nom';
    const fields = templateOverwrittenFields(tpl.data, procedure);
    document.getElementById('tplImportOverwrite').innerHTML = fields.length
      ? `Ces informations déjà renseignées seront remplacées : <strong>${fields.map(escapeHtml).join(', ')}</strong>. Les champs vides du modèle les videront.`
      : 'Aucune information déjà renseignée ne sera écrasée.';
    const hasDrawing = !!(tpl.image_path || tpl.canvas_json);
    const drawingBtn = document.getElementById('tplImportDrawing');
    drawingBtn.disabled = !hasDrawing;
    drawingBtn.textContent = hasDrawing ? 'Importer le dessin uniquement' : 'Ce modèle ne contient pas de dessin';
    document.getElementById('tplImportDrawingNote').textContent = hasDrawing
      ? 'Le dessin remplacera celui du procédé. L’enregistrement se fera automatiquement ; si une étape échoue, l’import reste en attente et sera réessayé.'
      : 'Ce modèle ne contient pas de dessin : l’import des informations conservera le schéma actuel du procédé.';
    document.getElementById('tplImportAll').textContent = hasDrawing
      ? 'Importer le dessin et les informations' : 'Importer les informations';
    openModal('tplImportModal');
  } catch (e) { toast(e.message, 'error'); }
}

function applyTemplateImport(mode) {
  const pending = TPL.pendingImport;
  if (!pending) return;
  syncFromDom();
  const p = procedures.find(x => x._uid === pending.uid && x.id);
  if (!p) return toast('Le procédé n’est plus disponible.', 'error');
  const tpl = pending.tpl;
  if (mode === 'all') {
    TPL_FIELDS.forEach(k => { p[k] = tpl.data?.[k] ?? ''; });
  }
  if (mode === 'drawing' || (mode === 'all' && (tpl.image_path || tpl.canvas_json))) {
    // Un brouillon tactique local antérieur ne doit pas écraser ce modèle au prochain autosave.
    // Ses données restent dans le navigateur ; seule la liaison avec ce procédé est retirée.
    p.draft_key = null;
    p.from_template = { image_path: tpl.image_path || null, canvas_json: tpl.canvas_json || null };
    p.has_canvas = !!tpl.canvas_json;
  }
  markDirty();
  renderProcedures();
  updateMeta();
  TPL.pendingImport = null;
  closeModal('tplImportModal');
  closeModal('libraryModal');
  toast(mode === 'drawing' ? 'Dessin importé. Enregistrement automatique en cours.' : 'Schéma importé. Enregistrement automatique en cours.', 'success');
}
window.deleteTemplate = async (id) => {
  if (!confirm(`Supprimer ce modèle ?${await trashNote()}`)) return;
  try {
    const { data, error } = await sb.from('exercise_templates').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Suppression refusée : ce schéma n’est pas à vous.');
    TPL.rows = TPL.rows.filter(t => t.id !== id);
    renderTemplates();
  } catch (e) { toast(e.message, 'error'); }
};

Object.assign(EDIT_DO, {
  insertTemplate: (b) => insertTemplate(Number(b.dataset.arg)),
  chooseTemplateForProcedure: (b) => chooseTemplateForProcedure(Number(b.dataset.arg)),
  applyTemplateDrawing: () => applyTemplateImport('drawing'),
  applyTemplateAll: () => applyTemplateImport('all'),
  deleteTemplate: (b) => deleteTemplate(Number(b.dataset.arg)),
  saveAsTemplate: (b) => saveAsTemplate(b.dataset.arg),
});
