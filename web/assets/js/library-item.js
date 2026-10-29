/* ============================================================
   LMFC Performance — library-item.js
   Fiche d'un procédé de la bibliothèque (fenêtre #libItemModal) :
   lecture (chargée au clic seulement), titre et consignes, tags,
   versions (remplacer la vidéo : les séances gardent la leur ;
   supprimer une ancienne version inutilisée), séances qui l'utilisent,
   accès (library-access.js), archivage, retrait, suppression
   définitive. Les droits viennent de la base (library_level) : la page
   ne montre que ce que la base accepterait.
   ============================================================ */

const libItem = { it: null, level: 'aucun', tagIds: [], versions: [], uses: [], count: null, staff: new Map() };
const libCanEdit = () => ['modification', 'gestion'].includes(libItem.level);
let libStaffReady = null;
const libStaff = () => (libStaffReady ??= sb.rpc('club_staff').then(({ data, error }) => {
  if (error) console.warn('Staff du club', error);
  return new Map((data || []).map(s => [s.id, s]));
}));

async function openLibItem(id) {
  const body = document.getElementById('libItemBody');
  body.innerHTML = '<p class="text-muted">Chargement…</p>';
  openModal('libItemModal');
  try {
    const [it, lvl, tags, versions, uses, count, staff] = await Promise.all([
      sb.from('library_items').select('id, titre, description, statut, created_by, created_at, updated_at, current_version_id, acces_roles, acces_teams, acces_niveau').eq('id', id).maybeSingle(),
      sb.rpc('library_level', { p_item: id }),
      sb.from('library_item_tags').select('tag_id').eq('item_id', id),
      sb.from('library_versions').select('id, version_no, note, created_at, created_by, library_files(id, storage_path, duree_sec)').eq('item_id', id).order('version_no', { ascending: false }),
      sb.rpc('library_usages', { p_item: id }),
      sb.rpc('library_usage_count', { p_item: id }),
      libStaff(),
      loadLibTags(),
    ]);
    const err = it.error || lvl.error || tags.error || versions.error || uses.error || count.error;
    if (err) throw err;
    if (!it.data) { body.innerHTML = '<p>Procédé introuvable, ou vous n’y avez plus accès.</p>'; return; }
    Object.assign(libItem, {
      it: it.data, level: lvl.data, tagIds: (tags.data || []).map(t => t.tag_id), versions: versions.data || [],
      uses: uses.data || [], count: (count.data || [])[0] || { seances: 0, corbeille: 0 }, staff,
    });
    renderLibItem();
  } catch (e) {
    console.error('Fiche du procédé', e);
    body.innerHTML = `<p class="text-danger">${escapeHtml(libError(e))}</p>`;
  }
}
const libCurrent = () => libItem.versions.find(v => v.id === libItem.it.current_version_id) || libItem.versions[0];
const libWho = (uid) => libItem.staff.get(uid)?.nom || 'un membre du staff';

function renderLibItem() {
  const { it, level } = libItem, cur = libCurrent(), edit = libCanEdit(), gestion = level === 'gestion';
  const seen = new Set(libItem.uses.map(u => u.session_id)).size;
  const hidden = Math.max(0, (libItem.count.seances || 0) - seen);
  document.getElementById('libItemBody').innerHTML = `
    <h2 class="as-h3">${escapeHtml(it.titre)}</h2>
    <p class="lib-item-meta">${LIB_STATUT[it.statut] ? `<span class="badge">${LIB_STATUT[it.statut]}</span> ` : ''}v${cur?.version_no || 1}
      · ajouté par ${escapeHtml(libWho(it.created_by))} le ${escapeHtml(libDate(it.created_at))}</p>
    <div class="lib-player" id="li-player">${libThumbHtml(cur?.library_files?.id, cur?.library_files?.duree_sec)}
      <button class="lib-play-big" type="button" data-li="play" aria-label="Lire la vidéo">▶</button></div>
    <section class="lib-sec" aria-labelledby="li-h1"><h3 class="as-h4" id="li-h1">Description et consignes</h3>
      ${edit ? `<div class="field"><label for="li-titre">Titre</label><input id="li-titre" maxlength="200" value="${escapeHtml(it.titre)}"></div>
        <div class="field"><label for="li-desc">Description ou consignes</label><textarea id="li-desc" maxlength="5000">${escapeHtml(it.description || '')}</textarea></div>
        <button class="btn btn-sm" type="button" data-li="save">Enregistrer</button>`
        : `<p class="lib-desc">${escapeHtml(it.description || 'Aucune consigne.')}</p>`}
    </section>
    <section class="lib-sec" aria-labelledby="li-h2"><h3 class="as-h4" id="li-h2">Tags</h3>
      <p class="lib-tags" id="li-tags">${libItem.tagIds.map(id => libTags.byId.get(id)).filter(Boolean)
        .map(t => libTagChip(t, edit ? { remove: 'data-li-untag' } : {})).join('') || '<span class="text-muted">Aucun tag.</span>'}</p>
      ${edit ? '<div id="li-tagcombo"></div>' : ''}
    </section>
    <section class="lib-sec" aria-labelledby="li-h3"><h3 class="as-h4" id="li-h3">Versions de la vidéo</h3>
      <ul class="lib-versions">${libItem.versions.map(v => `<li>
        <span>v${v.version_no} · ${escapeHtml(libDate(v.created_at))} · ${escapeHtml(libWho(v.created_by))}${v.note ? ` · ${escapeHtml(v.note)}` : ''}</span>
        ${v.id === it.current_version_id ? '<span class="badge badge-gold">En cours</span>' : ''}
        <button class="btn btn-sm" type="button" data-li-vplay="${v.id}">Lire</button>
        ${gestion && v.id !== it.current_version_id ? `<button class="btn btn-sm btn-danger" type="button" data-li-vdel="${v.id}">Supprimer</button>` : ''}</li>`).join('')}</ul>
      ${edit ? `<button class="btn btn-sm" type="button" data-li="replace">Remplacer la vidéo…</button>
        <input type="file" id="li-replace" accept="video/*" hidden>
        <p class="field-hint">Les séances déjà préparées gardent la version qu’elles utilisent.</p>` : ''}
    </section>
    <section class="lib-sec" aria-labelledby="li-h4"><h3 class="as-h4" id="li-h4">Séances qui l’utilisent</h3>
      ${libItem.uses.length ? `<ul class="lib-sessions">${libItem.uses.map(u => `<li><a class="lib-session-link" href="session-edit.html?id=${u.session_id}">
        <strong>${escapeHtml(u.titre)}</strong><span>${escapeHtml(fmtDate(u.date_seance))} · ${escapeHtml(u.procedure_nom)} · v${u.version_no}</span></a></li>`).join('')}</ul>`
        : '<p class="text-muted">Aucune séance visible.</p>'}
      ${hidden ? `<p class="field-hint">${hidden > 1 ? `Et ${hidden} autres séances auxquelles` : 'Et 1 autre séance à laquelle'} vous n’avez pas accès.</p>` : ''}
      ${libItem.count.corbeille ? `<p class="field-hint">${libItem.count.corbeille} procédé${libItem.count.corbeille > 1 ? 's' : ''} de séance dans la corbeille.</p>` : ''}
    </section>
    ${gestion ? '<section class="lib-sec" aria-labelledby="li-h5"><h3 class="as-h4" id="li-h5">Qui y a accès</h3><div id="li-access"></div></section>' : ''}
    <div class="modal-actions lib-item-actions">
      ${gestion ? `<button class="btn btn-danger" type="button" data-li="purge">Supprimer définitivement</button>
        ${it.statut === 'actif' ? '<button class="btn" type="button" data-li="archive">Archiver</button><button class="btn" type="button" data-li="retire">Retirer de la bibliothèque</button>'
          : it.statut === 'archive' ? '<button class="btn" type="button" data-li="actif">Désarchiver</button><button class="btn" type="button" data-li="retire">Retirer de la bibliothèque</button>'
          : '<button class="btn" type="button" data-li="actif">Remettre dans la bibliothèque</button>'}` : ''}
      ${canManageVideos(libPage.profile.role) && it.statut === 'actif' ? '<button class="btn btn-primary" type="button" data-li="to-session">Ajouter à une séance</button>' : ''}
    </div>`;
  observeLibThumbs(document.getElementById('libItemBody'));
  if (edit) {
    attachTagCombo(document.getElementById('li-tagcombo'), {
      allowCreate: canManageVideos(libPage.profile.role), exclude: () => new Set(libItem.tagIds),
      onChoose: (t) => libChange(sb.from('library_item_tags').insert({ item_id: it.id, tag_id: t.id }), null, true),
    });
  }
  if (gestion) renderLibAccess(document.getElementById('li-access'), it, () => libChange(Promise.resolve({}), 'Accès enregistré.'));
}

/* Écriture puis relecture de la fiche et de la liste. */
async function libChange(promise, ok, tagsToo = false) {
  const { error, count } = await promise;
  if (error) { toast(libError(error), 'error'); return false; }
  if (count === 0) { toast('Modification refusée : vos droits sur ce procédé ne le permettent pas.', 'error'); return false; }
  if (ok) toast(ok, 'success');
  if (tagsToo) await loadLibTags(true);
  await openLibItem(libItem.it.id);
  libReload();
  return true;
}
const setStatut = (statut, ok) => libChange(sb.from('library_items').update({ statut }, { count: 'exact' }).eq('id', libItem.it.id), ok);

async function libPurge(rpc, args, what) {
  const { data: paths, error } = await sb.rpc(rpc, args);
  if (error) { toast(libError(error), 'error'); return false; }
  // Fichiers que plus rien n'utilise : le Worker les efface (il redemande à la base).
  const failed = (await Promise.allSettled((paths || []).map(p => removeVideoFile(p)))).filter(r => r.status === 'rejected');
  if (failed.length) console.warn('Fichiers non effacés de R2', failed);
  toast(`${what} supprimé${what.endsWith('e') ? 'e' : ''} définitivement.`, 'success');
  return true;
}

document.getElementById('libItemBody').addEventListener('click', async (e) => {
  const it = libItem.it;
  const act = e.target.closest('[data-li]')?.dataset.li;
  const vplay = e.target.closest('[data-li-vplay]'), vdel = e.target.closest('[data-li-vdel]'), untag = e.target.closest('[data-li-untag]');
  if (vplay) {
    const v = libItem.versions.find(x => x.id === Number(vplay.dataset.liVplay));
    return libPlay(v?.library_files?.storage_path, `${it.titre} · v${v?.version_no}`);
  }
  if (vdel && confirm('Supprimer définitivement cette ancienne version ?\n\nRefusé si une séance (ou la corbeille) l’utilise encore.')) {
    if (await libPurge('library_purge_version', { p_version: Number(vdel.dataset.liVdel) }, 'Version')) await openLibItem(it.id);
    return;
  }
  if (untag) return libChange(sb.from('library_item_tags').delete({ count: 'exact' }).eq('item_id', it.id).eq('tag_id', Number(untag.dataset.liUntag)), null, true);
  if (act === 'play') {
    const path = libCurrent()?.library_files?.storage_path;
    let src = null;
    try { src = path && await videoUrl(path); } catch (err) { console.warn('Lien de lecture', err); }
    if (!src) return toast('Vidéo indisponible ou accès refusé.', 'error');
    document.getElementById('li-player').innerHTML = `<video src="${escapeHtml(src)}" controls autoplay playsinline></video>`;
  } else if (act === 'save') {
    const titre = document.getElementById('li-titre').value.trim();
    if (!titre) return toast('Le titre ne peut pas être vide.', 'error');
    libChange(sb.from('library_items').update({ titre, description: document.getElementById('li-desc').value.trim() || null }, { count: 'exact' }).eq('id', it.id), 'Enregistré.');
  } else if (act === 'replace') {
    document.getElementById('li-replace').click();
  } else if (act === 'archive') {
    setStatut('archive', 'Archivé : il n’est plus proposé pour les séances, celles qui l’utilisent le gardent.');
  } else if (act === 'retire' && confirm('Retirer ce procédé de la bibliothèque ?\n\nIl n’y apparaît plus ; les séances qui l’utilisent gardent leur vidéo. Vous pourrez le remettre.')) {
    setStatut('retire', 'Retiré de la bibliothèque.');
  } else if (act === 'actif') {
    setStatut('actif', 'De nouveau dans la bibliothèque.');
  } else if (act === 'to-session') {
    closeModal('libItemModal');
    openToSession(it);
  } else if (act === 'purge') {
    const used = (libItem.count.seances || 0) + (libItem.count.corbeille || 0);
    if (used) return toast(`Utilisé par ${used} procédé${used > 1 ? 's' : ''} de séance (corbeille comprise) : archivez-le ou retirez-le plutôt.`, 'error');
    if (!confirm(`Supprimer définitivement « ${it.titre} » ?\n\nLa vidéo et toutes ses versions sont effacées. C’est irréversible.`)) return;
    if (await libPurge('library_purge_item', { p_item: it.id }, 'Procédé')) { closeModal('libItemModal'); libReload(); }
  }
});

document.getElementById('libItemBody').addEventListener('change', async (e) => {
  if (e.target.id !== 'li-replace' || !e.target.files[0]) return;
  const file = e.target.files[0], it = libItem.it, modal = document.getElementById('libItemModal');
  modal.setAttribute('data-busy', '');
  toast('Envoi de la nouvelle version…', 'info');
  try {
    const up = await libUploadFile(file, {});
    if (libItem.versions.some(v => v.library_files?.id === up.fileId)) return toast('C’est déjà une version de ce procédé.', 'info');
    const { error } = await sb.rpc('library_add_version', { p_item: it.id, p_file: up.fileId, p_sha256: up.sha });
    if (error) throw error;
    toast('Nouvelle version en cours. Les séances gardent la leur.', 'success');
    await openLibItem(it.id);
    libReload();
  } catch (err) {
    console.error('Remplacement de la vidéo', err);
    toast(libError(err), 'error');
  } finally {
    modal.removeAttribute('data-busy');
  }
});
