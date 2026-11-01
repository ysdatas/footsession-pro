/* ============================================================
   LMFC Performance — library-folders.js (bibliotheque.html)
   « Gérer les dossiers » (lmfc_v31.sql), admin et coachs :
     - créer, renommer, archiver / réactiver, supprimer (ses vidéos
       restent, sans dossier ; les séances gardent leurs liens) ;
     - « Ranger des vidéos » : cocher plusieurs vidéos et les déplacer
       dans le dossier d'un coup (la base n'accepte que celles qu'on
       peut modifier, et le dit) ;
     - depuis les tuiles de l'explorateur (library.js) : « Nouveau dossier »,
       menu « ⋯ » (renommer, archiver, supprimer), vidéo glissée sur un dossier.
   Pas de doublon : « Rondo » et « rondo » sont le même dossier (la base
   refuse, la page l'explique). Dépend de library.js (libFolders,
   loadLibFolders, libSearch), bibliotheque-page.js (libPage, libReload).
   ============================================================ */

const LF = { target: null, picks: new Set(), rows: [] };
const lfEl = (id) => document.getElementById(id);
const lfError = (e) => (e?.code === '23505' ? 'Ce dossier existe déjà (même nom, majuscules et accents comptent pour rien).'
  : ['42P01', 'PGRST202', 'PGRST205'].includes(e?.code) ? 'Les dossiers ne sont pas encore installés : passez lmfc_v31.sql dans Supabase.' : e?.message || String(e));

async function openFolderManager() {
  if (!lfEl('libFoldersModal')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="libFoldersModal"><div class="modal lib-modal" role="dialog" aria-modal="true" aria-labelledby="lfTitle">
      <h2 class="as-h3" id="lfTitle">Dossiers</h2>
      <p class="lib-help">Un dossier range les vidéos ; les tags servent à chercher autrement. Supprimer un dossier ne supprime aucune vidéo.</p>
      <div class="lf-new"><label class="sr-only" for="lfNew">Nouveau dossier</label><input id="lfNew" maxlength="60" placeholder="Nouveau dossier : Rondo, Transitions…">
        <button class="btn btn-primary btn-sm" type="button" data-lf="create">Créer</button></div>
      <div id="lfList" class="lf-list"></div>
      <div id="lfPick" class="lf-pick hidden"></div>
      <div class="modal-actions"><button class="btn" type="button" data-close="libFoldersModal">Fermer</button></div>
    </div></div>`);
    const box = lfEl('libFoldersModal');
    box.addEventListener('click', lfClick);
    box.addEventListener('change', (e) => {
      if (e.target.dataset.lfRename) lfRename(Number(e.target.dataset.lfRename), e.target.value);
      if (e.target.dataset.lfPick) { LF.picks[e.target.checked ? 'add' : 'delete'](Number(e.target.dataset.lfPick)); lfPickCount(); }
    });
    lfEl('lfNew').addEventListener('keydown', (e) => { if (e.key === 'Enter') lfCreate(); });
  }
  lfEl('lfPick').classList.add('hidden');
  openModal('libFoldersModal');
  await loadLibFolders(true);
  lfRender();
}

function lfRender() {
  if (!lfEl('lfList')) return;   // fenêtre jamais ouverte : action venue d'une tuile
  const all = libFolders.list.filter(f => f.id !== 0), active = all.filter(f => !f.archived), archived = all.filter(f => f.archived);
  const row = (f) => `<li class="${f.archived ? 'is-off' : ''}">
    <label class="sr-only" for="lf-${f.id}">Nom du dossier</label><input id="lf-${f.id}" value="${escapeHtml(f.nom)}" maxlength="60" data-lf-rename="${f.id}">
    <span class="lf-n">${f.n} vidéo${f.n > 1 ? 's' : ''}</span>
    ${f.archived ? '' : `<button class="btn btn-sm" type="button" data-lf="pick" data-id="${f.id}">Ranger des vidéos</button>`}
    <button class="btn btn-sm" type="button" data-lf="${f.archived ? 'unarchive' : 'archive'}" data-id="${f.id}">${f.archived ? 'Réactiver' : 'Archiver'}</button>
    <button class="btn btn-sm btn-danger" type="button" data-lf="delete" data-id="${f.id}" data-n="${f.n}">Supprimer</button></li>`;
  lfEl('lfList').innerHTML = (active.length ? `<ul>${active.map(row).join('')}</ul>` : '<p class="text-muted">Aucun dossier pour l’instant.</p>')
    + (archived.length ? `<details class="lf-archived"><summary>Dossiers archivés · ${archived.length}</summary><ul>${archived.map(row).join('')}</ul></details>` : '');
}

async function lfDone(promise, ok) {
  const { data, error } = await promise;
  if (error) { console.error('Dossiers', error); toast(lfError(error), 'error'); return false; }
  if (Array.isArray(data) && !data.length) { toast('Modification refusée : droits insuffisants.', 'error'); return false; }
  if (ok) toast(ok, 'success');
  await libPage.browser.refreshFolders();
  lfRender();
  libReload();
  return true;
}
function lfCreate(nom = lfEl('lfNew').value.trim()) {
  if (!nom) return Promise.resolve(false);
  return lfDone(sb.from('library_folders').insert({ club_id: window.CURRENT_PROFILE.club_id, nom }).select('id'), `Dossier « ${nom} » créé`)
    .then(ok => { if (ok && lfEl('lfNew')) lfEl('lfNew').value = ''; return ok; });
}
const lfRename = (id, nom) => (nom.trim() ? lfDone(sb.from('library_folders').update({ nom: nom.trim() }).eq('id', id).select('id'), 'Dossier renommé') : lfRender());

async function lfClick(e) {
  const b = e.target.closest('[data-lf]');
  if (!b) return;
  const id = Number(b.dataset.id), act = b.dataset.lf;
  b.closest('details')?.removeAttribute('open');
  if (act === 'create') lfCreate();
  if (act === 'new' || act === 'rename') lfEditTile(b.closest('.lib-folder'), libFolders.list.find(x => x.id === id));
  if (act === 'archive' || act === 'unarchive') {
    lfDone(sb.from('library_folders').update({ archived_at: act === 'archive' ? new Date().toISOString() : null }).eq('id', id).select('id'),
      act === 'archive' ? 'Dossier archivé : il ne s’affiche plus dans les choix, ses vidéos restent.' : 'Dossier réactivé');
  }
  if (act === 'delete') {
    const n = Number(b.dataset.n);
    if (!confirm(`Supprimer ce dossier ?\n\n${n ? `Ses ${n} vidéo${n > 1 ? 's' : ''} restent dans la bibliothèque, « Sans dossier ».` : 'Il est vide.'} Les séances ne changent pas.`)) return;
    lfDone(sb.from('library_folders').delete().eq('id', id).select('id'), 'Dossier supprimé');
  }
  if (act === 'pick') lfOpenPick(id);
  if (act === 'move') lfMove();
}

/* Nom saisi dans la tuile, comme dans le Finder : Entrée ou clic ailleurs enregistre, Échap annule. */
function lfEditTile(tile, f) {
  tile.innerHTML = `<div class="lib-folder-open lib-folder-edit">${f ? LIB_FOLDER_IC : '<span class="lib-folder-ic" aria-hidden="true">+</span>'}
    <input class="lib-folder-input" maxlength="60" value="${escapeHtml(f?.nom || '')}" placeholder="Nom du dossier" aria-label="${f ? 'Nouveau nom du dossier' : 'Nom du nouveau dossier'}"></div>`;
  const input = tile.querySelector('input');
  let done = false;
  const end = async (save) => {
    if (done) return;
    done = true;
    const nom = input.value.trim();
    const ok = save && nom && nom !== f?.nom ? await (f ? lfRename(f.id, nom) : lfCreate(nom)) : false;
    if (!ok) libPage.browser.redraw();   // annulé, inchangé ou refusé : la tuile revient
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); end(true); }
    if (e.key === 'Escape') { e.stopPropagation(); end(false); }
  });
  input.addEventListener('blur', () => end(true));
  input.focus();
  input.select();
}

/* Ranger plusieurs vidéos : celles qui ne sont pas déjà dans ce dossier (200 au plus, les plus récentes). */
async function lfOpenPick(id) {
  LF.target = id; LF.picks.clear();
  const box = lfEl('lfPick');
  box.classList.remove('hidden');
  box.innerHTML = '<p class="lib-status">Chargement…</p>';
  try { LF.rows = (await libSearch({ limit: 200 })).filter(r => r.folder_id !== id); } catch (e) { box.innerHTML = `<p class="text-danger">${escapeHtml(lfError(e))}</p>`; return; }
  const f = libFolders.list.find(x => x.id === id), name = (fid) => libFolders.list.find(x => x.id === fid)?.nom || 'Sans dossier';
  box.innerHTML = `<h3 class="as-h4">Ranger dans « ${escapeHtml(f?.nom || '')} »</h3>
    ${LF.rows.length ? `<ul class="lf-videos">${LF.rows.map(r => `<li><label><input type="checkbox" data-lf-pick="${r.id}"> ${escapeHtml(r.titre)}
      <small>${escapeHtml(name(r.folder_id || 0))}</small></label></li>`).join('')}</ul>` : '<p class="text-muted">Toutes les vidéos sont déjà dans ce dossier.</p>'}
    <button class="btn btn-primary btn-sm" type="button" data-lf="move" id="lfMoveBtn" disabled>Déplacer ici</button>`;
}
function lfPickCount() {
  const n = LF.picks.size, b = lfEl('lfMoveBtn');
  b.disabled = !n;
  b.textContent = n ? `Déplacer ici (${n})` : 'Déplacer ici';
}
const lfMove = () => lfMoveTo(LF.target, [...LF.picks]);
/* Déplacer des vidéos (0 = sans dossier) : « Ranger des vidéos », ou une carte glissée sur un dossier. */
async function lfMoveTo(folder, ids) {
  const { data, error } = await sb.from('library_items').update({ folder_id: folder || null }).in('id', ids).select('id');
  if (error) return toast(lfError(error), 'error');
  const moved = data.length, refused = ids.length - moved;
  toast(`${moved} vidéo${moved > 1 ? 's' : ''} rangée${moved > 1 ? 's' : ''} dans « ${libFolderName(folder)} »${refused ? ` · ${refused} refusée${refused > 1 ? 's' : ''} (droits : vidéos d’un collègue)` : ''}`, refused ? 'error' : 'success');
  lfEl('lfPick')?.classList.add('hidden');
  await libPage.browser.refreshFolders();
  lfRender();
  libReload();
}

document.getElementById('btnLibFolders').addEventListener('click', openFolderManager);
document.getElementById('libBrowser').addEventListener('click', lfClick);   // tuiles : nouveau, renommer, archiver, supprimer
