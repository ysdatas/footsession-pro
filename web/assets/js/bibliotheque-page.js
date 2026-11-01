/* ============================================================
   LMFC Performance — bibliotheque-page.js (bibliotheque.html)
   Bibliothèque vidéo : explorateur (library.js), ajout d'un procédé,
   gestion des tags (library-tags.js), fiche (library-item.js).
   Un fichier déjà présent dans le club (même empreinte SHA-256) n'est
   jamais renvoyé : le procédé le réutilise (lmfc_v24.sql).
   Adresse ?item=<id> : la fiche de ce procédé s'ouvre.
   ============================================================ */

const libPage = { profile: null, browser: null, addTags: [], ctrl: null };

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  const p = libPage.profile = ctx.profile;
  document.getElementById('uName').textContent = p.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[p.role] || p.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (p.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  // Boutons du rôle tout de suite (rien ne bouge quand la liste arrive).
  const canAdd = canManageVideos(p.role);
  ['btnLibAdd', 'btnLibTags', 'btnLibFolders'].forEach(id => document.getElementById(id).classList.toggle('hidden', !canAdd));
  // Migration pas encore passée : on le dit au lieu d'une liste vide.
  try { await loadLibTags(); } catch (e) {
    console.error('Bibliothèque indisponible', e);
    ['btnLibAdd', 'btnLibTags', 'btnLibFolders'].forEach(id => document.getElementById(id).classList.add('hidden'));
    document.getElementById('libBrowser').innerHTML = `<div class="empty">${escapeHtml(libError(e))}</div>`;
    return;
  }
  libPage.browser = createLibBrowser(document.getElementById('libBrowser'), {
    onOpen: (r) => openLibItem(r.id), manage: canAdd, onDrop: canAdd ? (folder, id) => lfMoveTo(folder, [id]) : null,   // library-folders.js
  });
  const deep = Number(new URLSearchParams(location.search).get('item'));
  if (deep) openLibItem(deep);
})();

const libReload = () => libPage.browser?.reload();
document.getElementById('btnLibTags').addEventListener('click', () => openTagManager(libReload));

/* ---------- Fichier : empreinte, doublon, miniature, envoi ---------- */
async function libSha256(file) {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function libFileDuration(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video'), url = URL.createObjectURL(file);
    const done = (d) => { URL.revokeObjectURL(url); v.removeAttribute('src'); resolve(Number.isFinite(d) ? Math.round(d * 10) / 10 : null); };
    v.preload = 'metadata';
    v.addEventListener('loadedmetadata', () => done(v.duration), { once: true });
    v.addEventListener('error', () => done(null), { once: true });
    setTimeout(() => done(null), 8000);
    v.src = url;
  });
}
const libExt = (name) => (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] || 'mp4').toLowerCase();
let libStamp = 0;

/* → { fileId, sha, reused, item } ; reused : fichier déjà dans le club (pas
   renvoyé) ; item : procédé visible qui l'utilise déjà.
   Utilisé aussi pour remplacer la vidéo d'un procédé (library-item.js). */
async function libUploadFile(file, { onProgress, onStep, signal } = {}) {
  if (file.size > VIDEO_MAX_BYTES) throw new Error(`Fichier trop volumineux : ${Math.round(VIDEO_MAX_BYTES / 1048576)} Mo au maximum.`);
  onStep?.('Vérification du fichier…');
  const sha = await libSha256(file);
  const byHash = async () => {
    const { data, error } = await sb.rpc('library_file_by_hash', { p_sha256: sha });
    if (error) throw error;
    return data?.[0] && { fileId: data[0].file_id, sha, reused: true, item: data[0].item_id ? { id: data[0].item_id, titre: data[0].titre } : null };
  };
  const known = await byHash();
  if (known) return known;
  const [thumb, duree] = await Promise.all([fileThumb(file), libFileDuration(file)]);   // fileThumb : video-status.js
  libStamp = Math.max(Date.now(), libStamp + 1);
  const club = libPage.profile.club_id, path = `r2/${club}/lib/${libStamp}.${libExt(file.name)}`;
  onStep?.('Envoi de la vidéo…');
  await uploadVideoFile(path, file, { onProgress, signal });
  const { data, error } = await sb.from('library_files').insert({
    club_id: club, storage_path: path, sha256: sha, size_bytes: file.size, mime: file.type || null,
    duree_sec: duree, thumb: thumb && thumb.length <= 60000 ? thumb : null,
  }).select('id').single();
  if (error) {
    await removeVideoFile(path).catch(err => console.warn('Fichier orphelin', path, err));
    if (error.code === '23505') { const again = await byHash(); if (again) return again; }   // envoyé au même moment par un autre
    throw error;
  }
  return { fileId: data.id, sha, reused: false, item: null };
}

/* ---------- Ajouter un procédé ---------- */
const $la = (id) => document.getElementById(`la-${id}`);
const renderAddTags = () => {
  $la('tags').innerHTML = libPage.addTags.map(t => libTagChip(t, { remove: 'data-la-untag' })).join('');
};
document.getElementById('btnLibAdd').addEventListener('click', () => {
  ['file', 'titre', 'desc'].forEach(k => { $la(k).value = ''; });
  libPage.addTags = [];
  renderAddTags();
  // Dossier : celui qu'on regarde, sinon aucun (lmfc_v31.sql ; champ caché tant qu'il n'y a pas de dossier).
  const open = libPage.browser.folder();
  $la('folder').innerHTML = '<option value="">Sans dossier</option>' + libFolderOptions(open > 0 ? open : null, { all: false });
  $la('folder-field').classList.toggle('hidden', libFolders.list.length < 2);
  $la('progress').classList.add('hidden');
  $la('submit').disabled = false;
  if (!$la('tagcombo').firstChild) {
    attachTagCombo($la('tagcombo'), {
      allowCreate: true, exclude: () => new Set(libPage.addTags.map(t => t.id)),
      onChoose: (t) => { libPage.addTags.push(t); renderAddTags(); },
    });
  }
  openModal('libAddModal');
  $la('file').focus();
});
$la('tags').addEventListener('click', (e) => {
  const x = e.target.closest('[data-la-untag]');
  if (x) { libPage.addTags = libPage.addTags.filter(t => t.id !== Number(x.dataset.laUntag)); renderAddTags(); }
});
$la('file').addEventListener('change', () => {
  const f = $la('file').files[0];
  if (f && !$la('titre').value.trim()) $la('titre').value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 200);
});
$la('cancel').addEventListener('click', () => {
  if (!libPage.ctrl) return closeModal('libAddModal');
  if (confirm('Arrêter l’envoi ?')) libPage.ctrl.abort();
});
window.addEventListener('beforeunload', (e) => { if (libPage.ctrl) e.preventDefault(); });

$la('submit').addEventListener('click', async () => {
  const file = $la('file').files[0], titre = $la('titre').value.trim();
  if (!file) return toast('Choisissez la vidéo.', 'error');
  if (!titre) return toast('Donnez un titre au procédé.', 'error');
  const modal = document.getElementById('libAddModal');
  const step = (t) => { $la('step').textContent = t; };
  libPage.ctrl = new AbortController();
  modal.setAttribute('data-busy', '');
  $la('submit').disabled = true;
  $la('progress').classList.remove('hidden');
  $la('bar').style.width = '0%';
  try {
    const up = await libUploadFile(file, {
      signal: libPage.ctrl.signal, onStep: step,
      onProgress: (x) => { $la('bar').style.width = `${Math.round(x * 100)}%`; step(`Envoi de la vidéo… ${Math.round(x * 100)} %`); },
    });
    if (up.item && confirm(`Cette vidéo est déjà dans la bibliothèque : « ${up.item.titre} ».\n\nOK : ouvrir ce procédé.\nAnnuler : créer un nouveau procédé avec la même vidéo (sans la renvoyer).`)) {
      closeModal('libAddModal');
      return openLibItem(up.item.id);
    }
    step('Enregistrement…');
    const { data: id, error } = await sb.rpc('library_create_item', {
      p_titre: titre, p_file: up.fileId, p_sha256: up.sha, p_description: $la('desc').value.trim() || null,
      p_tags: libPage.addTags.map(t => t.id), ...($la('folder').value ? { p_folder: Number($la('folder').value) } : {}),
    });
    if (error) throw error;
    closeModal('libAddModal');
    toast(up.reused ? 'Vidéo ajoutée : fichier déjà présent, rien n’a été renvoyé.' : 'Vidéo ajoutée à la bibliothèque.', 'success');
    libPage.browser.refreshFolders();
    await loadLibTags(true);
    libReload();
    openLibItem(id);
  } catch (e) {
    if (e.name === 'AbortError') { toast('Envoi arrêté.', 'info'); return; }
    console.error('Bibliothèque : ajout', e);
    toast(libError(e), 'error');
  } finally {
    libPage.ctrl = null;
    modal.removeAttribute('data-busy');
    $la('submit').disabled = false;
  }
});

/* ---------- Ajouter à une séance (séances modifiables, ou une nouvelle) ---------- */
async function openToSession(item) {
  document.getElementById('lts-what').textContent = `« ${item.titre} » devient un procédé de la séance choisie (version en cours).`;
  document.getElementById('lts-new').href = `session-edit.html?lib=${item.id}`;
  const list = document.getElementById('lts-list');
  list.innerHTML = '<li class="text-muted">Chargement…</li>';
  openModal('libToSessionModal');
  const { data, error } = await sb.rpc('my_editable_sessions', { p_limit: 40 });
  if (error) { list.innerHTML = `<li class="text-danger">${escapeHtml(libError(error))}</li>`; return; }
  list.innerHTML = (data || []).map(s => `<li><a class="lib-session-link" href="session-edit.html?id=${s.id}&lib=${item.id}">
    <strong>${escapeHtml(s.titre)}</strong><span>${escapeHtml(fmtDate(s.date_seance))}</span></a></li>`).join('')
    || '<li class="text-muted">Aucune séance que vous pouvez modifier : créez-en une.</li>';
}
