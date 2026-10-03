/* ============================================================
   LMFC Performance — notes.js
   Les « points » d'un joueur (table player_performance_notes) :
     - objectifs, préventions   → fiche joueur, Performance,
                                  « Objectifs & préventions » du joueur ;
     - points forts, axes       → Programme terrain (fiche joueur
       d'amélioration              côté staff, « Mon programme
                                   terrain » côté joueur).
   Chaque point : titre, consignes, images légendées ; un clic
   l'ouvre en grand (lightbox.js). Le staff ajoute, modifie,
   supprime ; le joueur consulte (la RLS refuse le reste).
   Un objectif ou une prévention a en plus un statut (En cours,
   Atteint, Non atteint), modifiable d'un geste sur sa carte
   (lmfc_v3.sql). Le titre est facultatif (lmfc_v4.sql) : sans titre,
   la carte reprend le début de la description.
   ============================================================ */

const NOTE_KINDS = {
  strength:    { badge: 'Point fort',  cls: 'badge-success', empty: 'Aucun point fort.',          add: 'Ajouter un point fort' },
  improvement: { badge: 'Axe',         cls: 'badge-gold',    empty: 'Aucun axe d’amélioration.',  add: 'Ajouter un axe d’amélioration' },
  objective:   { badge: 'Objectif',    cls: 'badge-gold',    empty: 'Aucun objectif.',            add: 'Ajouter un objectif' },
  prevention:  { badge: 'Prévention',  cls: 'badge-red',     empty: 'Aucune prévention.',         add: 'Ajouter une prévention' },
};
/* Objectifs et préventions ont un statut ; points forts et axes, non. */
const hasStatus = (kind) => kind === 'objective' || kind === 'prevention';
/* Titre affiché : le titre, sinon le début de la description, sinon le type. */
function noteTitle(n) {
  const t = (n.title || '').trim();
  if (t) return t;
  const first = (n.body || '').trim().split('\n')[0];
  if (first) return first.length > 70 ? `${first.slice(0, 67)}…` : first;
  return NOTE_KINDS[n.kind]?.badge || 'Point';
}
const NOTES_BUCKET = 'player-performance-media';
const OBJ_STATUS = {
  active:   { label: 'En cours',    cls: 'is-active' },
  achieved: { label: 'Atteint',     cls: 'is-done' },
  missed:   { label: 'Non atteint', cls: 'is-missed' },
};
const objStatusOf = (n) => OBJ_STATUS[n.status] ? n.status : 'active';
/* Statut d'un objectif : pastille pour le joueur, liste déroulante pour le staff. */
function objStatusControl(n, canEdit) {
  const k = objStatusOf(n);
  if (!canEdit) return `<span class="obj-status ${OBJ_STATUS[k].cls}">${OBJ_STATUS[k].label}</span>`;
  return `<select class="obj-status ${OBJ_STATUS[k].cls}" data-note-status="${n.id}" aria-label="Statut de « ${escapeHtml(noteTitle(n))} »">
    ${Object.entries(OBJ_STATUS).map(([v, s]) => `<option value="${v}"${v === k ? ' selected' : ''}>${s.label}</option>`).join('')}</select>`;
}

const noteStore = {
  player: null, canEdit: false, userId: null,
  lists: {},            // { kind: id de l'élément qui affiche la liste }
  notes: [], media: [],
  draft: { existing: [], pending: [] },
  onError: (msg) => toast(msg, 'error'),
};

const noteImages = (id) => noteStore.media.filter(m => m.note_id === id && m.signed_url)
  .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);

/* opts : { player, canEdit, userId, lists: { kind: elementId }, onError } */
async function initNotes(opts) {
  Object.assign(noteStore, opts);
  mountNoteModal();
  for (const [kind, listId] of Object.entries(noteStore.lists)) bindNoteList(kind, listId);
  await loadNotes();
}

async function loadNotes() {
  const p = noteStore.player;
  const [nRes, mRes] = await Promise.all([
    sb.from('player_performance_notes').select('*').eq('player_id', p.id).order('sort_order').order('id'),
    sb.from('player_performance_media').select('*').eq('player_id', p.id).order('sort_order').order('id'),
  ]);
  if (nRes.error) console.error('Points du joueur illisibles', nRes.error);
  if (mRes.error) console.error('Images des points illisibles', mRes.error);
  noteStore.notes = nRes.data || [];
  const media = mRes.data || [];
  const { data: signed } = media.length
    ? await sb.storage.from(NOTES_BUCKET).createSignedUrls(media.map(m => m.storage_path), 3600)
    : { data: [] };
  noteStore.media = media.map((m, i) => ({ ...m, signed_url: signed?.[i]?.signedUrl || '' }));
  renderNoteLists();
  return nRes.error || mRes.error || null;
}

function renderNoteLists() {
  for (const [kind, listId] of Object.entries(noteStore.lists)) {
    const box = document.getElementById(listId);
    if (!box) continue;
    const k = NOTE_KINDS[kind];
    const list = noteStore.notes.filter(n => n.kind === kind);
    box.innerHTML = list.length ? list.map(n => {
      const imgs = noteImages(n.id);
      const title = noteTitle(n);
      // Sans titre, la description sert de titre : on ne la répète pas dessous.
      const body = n.title?.trim() ? n.body : (n.body || '').trim().split('\n').slice(1).join('\n');
      return `<article class="note-card is-openable${hasStatus(kind) ? ` obj-${objStatusOf(n)}` : ''}" data-note-open="${n.id}" tabindex="0" role="button" aria-label="Ouvrir ${escapeHtml(title)}">
        <div class="note-card-head">
          <h3>${escapeHtml(title)}</h3>
          ${hasStatus(kind) ? objStatusControl(n, noteStore.canEdit) : ''}
          ${noteStore.canEdit ? `<div class="note-card-actions">
            <button class="btn btn-sm" type="button" data-note-edit="${n.id}">Modifier</button>
            <button class="btn btn-sm btn-danger" type="button" data-note-delete="${n.id}" aria-label="Supprimer « ${escapeHtml(title)} »" title="Supprimer">✕</button></div>` : ''}
        </div>
        ${body ? `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>` : ''}
        ${imgs.length ? `<div class="media-grid">${imgs.map((m, i) => `<figure data-img-index="${i}"><img src="${escapeHtml(m.signed_url)}" alt="${escapeHtml(m.caption || title)}" loading="lazy">${m.caption ? `<figcaption>${escapeHtml(m.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : ''}
      </article>`;
    }).join('') : `<div class="empty">${k.empty}</div>`;
  }
}

/* Un point s'ouvre en grand au clic : titre, consignes et images légendées. */
function openNote(id, start = 0) {
  const n = noteStore.notes.find(x => x.id === id);
  if (!n) return;
  const box = openLightbox({
    title: noteTitle(n),
    text: n.body || '',
    items: noteImages(id).map(m => ({ type: 'image', src: m.signed_url, caption: m.caption || '' })),
    start,
    footer: noteStore.canEdit ? '<button class="btn btn-sm" type="button" data-lb-edit>Modifier</button>' : '',
  });
  box.querySelector('[data-lb-edit]')?.addEventListener('click', () => { closeLightbox(); openNoteModal(null, id); });
}

function bindNoteList(kind, listId) {
  const list = document.getElementById(listId);
  if (!list || list.dataset.notesBound) return;
  list.dataset.notesBound = '1';
  list.addEventListener('click', e => {
    if (e.target.closest('[data-note-status]')) return;   // la liste du statut ne doit pas ouvrir la carte
    const edit = e.target.closest('[data-note-edit]');
    if (edit) return openNoteModal(null, Number(edit.dataset.noteEdit));
    const del = e.target.closest('[data-note-delete]');
    if (del) return deleteNote(Number(del.dataset.noteDelete));
    const card = e.target.closest('[data-note-open]');
    if (!card) return;
    const fig = e.target.closest('[data-img-index]');
    openNote(Number(card.dataset.noteOpen), fig ? Number(fig.dataset.imgIndex) : 0);
  });
  list.addEventListener('change', e => {
    const sel = e.target.closest('[data-note-status]');
    if (sel) setNoteStatus(Number(sel.dataset.noteStatus), sel.value);
  });
  list.addEventListener('keydown', e => {
    const card = e.target.closest('[data-note-open]');
    if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openNote(Number(card.dataset.noteOpen)); }
  });
}

/* ---------- Fenêtre d'ajout / de modification ---------- */
function mountNoteModal() {
  if (document.getElementById('noteModal') || !noteStore.canEdit) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-backdrop" id="noteModal">
    <div class="modal">
      <h3 id="noteModalTitle">Ajouter un point</h3>
      <input id="noteKind" type="hidden"><input id="noteId" type="hidden">
      <div class="field"><label for="noteTitle">Titre <span class="label-opt">facultatif</span></label><input id="noteTitle" autocomplete="off" placeholder="Ex. Gainage : 3 séances par semaine"></div>
      <div class="field"><label for="noteBody">Description / consignes</label><textarea id="noteBody" rows="5"></textarea></div>
      <div class="field" id="noteStatusField"><label for="noteStatus">Statut</label>
        <select id="noteStatus">${Object.entries(OBJ_STATUS).map(([v, s]) => `<option value="${v}">${s.label}</option>`).join('')}</select></div>
      <div class="field">
        <label>Images / exercices</label>
        <div id="noteImages" class="note-images-edit"></div>
        <label class="file-pick"><input id="noteFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple>
          <span class="btn btn-sm">+ Ajouter des images (PNG, JPG)</span></label>
        <small class="field-hint">Elles s’affichent tout de suite ici ; chaque image peut avoir sa légende.</small>
      </div>
      <div class="modal-actions">
        <button class="btn" data-close="noteModal" type="button">Annuler</button>
        <button class="btn btn-primary" id="btnSaveNote" type="button">Enregistrer</button>
      </div>
    </div>
  </div>`);
  const box = document.getElementById('noteImages');
  box.addEventListener('input', e => {
    const [key, i] = (e.target.dataset.caption || '').split(':');
    if (key) noteStore.draft[key][Number(i)].caption = e.target.value;
  });
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-img-toggle]'); if (!b) return;
    const [key, i] = b.dataset.imgToggle.split(':');
    const d = noteStore.draft;
    if (key === 'pending') { URL.revokeObjectURL(d.pending[i].url); d.pending.splice(Number(i), 1); }
    else d.existing[Number(i)].removed = !d.existing[Number(i)].removed;
    renderNoteImages();
  });
  document.getElementById('noteFiles').addEventListener('change', e => {
    for (const file of e.target.files) {
      if (file.size > 5 * 1024 * 1024) { noteStore.onError(`« ${file.name} » dépasse 5 Mo.`); continue; }
      noteStore.draft.pending.push({ file, url: URL.createObjectURL(file), caption: '' });
    }
    e.target.value = '';
    renderNoteImages();
  });
  document.getElementById('btnSaveNote').addEventListener('click', saveNote);
}

function openNoteModal(kind, id = null) {
  if (!noteStore.canEdit) return;
  const n = id ? noteStore.notes.find(x => x.id === id) : null;
  kind = n?.kind || kind;
  document.getElementById('noteKind').value = kind;
  document.getElementById('noteId').value = n?.id || '';
  document.getElementById('noteModalTitle').textContent = n ? 'Modifier' : NOTE_KINDS[kind].add;
  document.getElementById('noteTitle').value = n?.title || '';
  document.getElementById('noteBody').value = n?.body || '';
  document.getElementById('noteStatusField').classList.toggle('hidden', !hasStatus(kind));
  document.getElementById('noteStatus').value = n ? objStatusOf(n) : 'active';
  noteStore.draft.pending.forEach(p => URL.revokeObjectURL(p.url));
  noteStore.draft = {
    existing: n ? noteImages(n.id).map(m => ({ id: m.id, path: m.storage_path, url: m.signed_url, caption: m.caption || '', removed: false })) : [],
    pending: [],
  };
  renderNoteImages();
  openModal('noteModal');
  setTimeout(() => document.getElementById('noteTitle').focus(), 50);
}

function renderNoteImages() {
  const row = (img, key, i) => `<div class="nie-row${img.removed ? ' is-removed' : ''}">
      <img src="${escapeHtml(img.url)}" alt="">
      <input type="text" data-caption="${key}:${i}" value="${escapeHtml(img.caption)}" placeholder="Légende / annotation (facultatif)" ${img.removed ? 'disabled' : ''}>
      <button class="btn btn-sm" type="button" data-img-toggle="${key}:${i}">${key === 'pending' ? 'Retirer' : (img.removed ? 'Garder' : 'Retirer')}</button>
    </div>`;
  const d = noteStore.draft;
  document.getElementById('noteImages').innerHTML = d.existing.map((img, i) => row(img, 'existing', i)).join('')
    + d.pending.map((img, i) => row(img, 'pending', i)).join('');
}

async function saveNote() {
  const p = noteStore.player, d = noteStore.draft;
  const kind = document.getElementById('noteKind').value;
  const id = Number(document.getElementById('noteId').value) || null;
  const title = document.getElementById('noteTitle').value.trim();
  const body = document.getElementById('noteBody').value.trim() || null;
  const extra = hasStatus(kind) ? { status: document.getElementById('noteStatus').value } : {};
  const keptImages = d.existing.filter(m => !m.removed).length + d.pending.length;
  if (!title && !body && !keptImages) return noteStore.onError('Écrivez un titre ou une description, ou ajoutez une image.');
  const btn = document.getElementById('btnSaveNote'); btn.disabled = true;
  try {
    let noteId = id;
    if (id) {
      const { error } = await sb.from('player_performance_notes').update({ title: title || null, body, ...extra }).eq('id', id);
      if (error) throw error;
    } else {
      const { data: note, error } = await sb.from('player_performance_notes').insert({
        club_id: p.club_id, player_id: p.id, kind, title: title || null, body, ...extra, created_by: noteStore.userId,
      }).select().single();
      if (error) throw error;
      noteId = note.id;
    }
    // Images retirées : fichier et ligne supprimés. Légendes modifiées : mises à jour.
    const removed = d.existing.filter(m => m.removed);
    if (removed.length) {
      await sb.storage.from(NOTES_BUCKET).remove(removed.map(m => m.path));
      const { error } = await sb.from('player_performance_media').delete().in('id', removed.map(m => m.id));
      if (error) throw error;
    }
    for (const m of d.existing.filter(x => !x.removed)) {
      const before = noteStore.media.find(x => x.id === m.id)?.caption || '';
      if (m.caption.trim() !== before) {
        const { error } = await sb.from('player_performance_media').update({ caption: m.caption.trim() || null }).eq('id', m.id);
        if (error) throw error;
      }
    }
    let order = Math.max(-1, ...noteStore.media.filter(m => m.note_id === noteId).map(m => m.sort_order || 0));
    for (const [index, pend] of d.pending.entries()) {
      const file = await shrinkImage(pend.file);
      const ext = file.type === 'image/png' ? 'png' : 'jpg';
      const path = `${p.club_id}/${p.id}/${noteId}/${Date.now()}-${index}.${ext}`;
      const up = await sb.storage.from(NOTES_BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg' });
      if (up.error) { noteStore.onError(`Une image n’a pas été envoyée : ${up.error.message}`); continue; }
      const { error } = await sb.from('player_performance_media').insert({
        club_id: p.club_id, player_id: p.id, note_id: noteId,
        storage_path: path, caption: pend.caption.trim() || null, sort_order: ++order, created_by: noteStore.userId,
      });
      if (error) throw error;
    }
    closeModal('noteModal');
    toast(id ? 'Mis à jour.' : 'Enregistré.', 'success');
    await loadNotes();
  } catch (e) {
    console.error('Enregistrement du point impossible', e);
    noteStore.onError(e.message);
  } finally { btn.disabled = false; }
}

/* Statut d'un objectif, changé directement sur sa carte. */
async function setNoteStatus(id, status) {
  const n = noteStore.notes.find(x => x.id === id);
  if (!n || !noteStore.canEdit || !OBJ_STATUS[status]) return;
  const { error } = await sb.from('player_performance_notes').update({ status }).eq('id', id);
  if (error) { console.error('Statut non enregistré', error); noteStore.onError(error.message); return renderNoteLists(); }
  n.status = status;
  renderNoteLists();
  toast(`${NOTE_KINDS[n.kind]?.badge || 'Objectif'} : ${OBJ_STATUS[status].label.toLowerCase()}.`, 'success');
}

async function deleteNote(id) {
  const n = noteStore.notes.find(x => x.id === id);
  if (!noteStore.canEdit || !n || !confirm(`Supprimer « ${noteTitle(n)} »${noteImages(id).length ? ' et ses images' : ''} ? C’est définitif.`)) return;
  const files = noteStore.media.filter(m => m.note_id === id).map(m => m.storage_path);
  const { error } = await sb.from('player_performance_notes').delete().eq('id', id);
  if (error) return noteStore.onError(error.message);
  if (files.length) await sb.storage.from(NOTES_BUCKET).remove(files);
  toast('Supprimé.', 'success');
  await loadNotes();
}

/* Image envoyée : réduite à 1600 px de côté (une photo de téléphone
   passe de 4 Mo à ~300 Ko). PNG gardé pour la transparence ; le reste
   en JPEG. En cas d'échec (format exotique), le fichier part tel quel. */
async function shrinkImage(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 600 * 1024) { bmp.close?.(); return file; }
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise(res => c.toBlob(res, type, 0.86));
    return blob && blob.size < file.size ? new File([blob], file.name, { type }) : file;
  } catch (e) {
    console.warn('Image envoyée sans réduction', e);
    return file;
  }
}
