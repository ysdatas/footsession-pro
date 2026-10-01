/* ============================================================
   LMFC Performance — notes.js
   Les « points » d'un joueur (table player_performance_notes) :
     - objectifs physiques      → page Performance ;
     - points forts, axes       → Programme terrain (fiche joueur
       d'amélioration              côté staff, « Mon programme
                                   terrain » côté joueur).
   Chaque point : titre, consignes, images légendées ; un clic
   l'ouvre en grand (lightbox.js). Le staff ajoute, modifie,
   supprime ; le joueur consulte (la RLS refuse le reste).
   ============================================================ */

const NOTE_KINDS = {
  strength:    { badge: 'Point fort',  cls: 'badge-success', empty: 'Aucun point fort.',          add: 'Ajouter un point fort' },
  improvement: { badge: 'Axe',         cls: 'badge-gold',    empty: 'Aucun axe d’amélioration.',  add: 'Ajouter un axe d’amélioration' },
  objective:   { badge: 'Objectif',    cls: 'badge-gold',    empty: 'Aucun objectif.',            add: 'Ajouter un objectif ou un exercice' },
};
const NOTES_BUCKET = 'player-performance-media';

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
      return `<article class="note-card is-openable" data-note-open="${n.id}" tabindex="0" role="button" aria-label="Ouvrir ${escapeHtml(n.title)}">
        <div class="note-card-head">
          <h3>${escapeHtml(n.title)}</h3>
          ${noteStore.canEdit ? `<div class="note-card-actions">
            <button class="btn btn-sm" type="button" data-note-edit="${n.id}">Modifier</button>
            <button class="btn btn-sm btn-danger" type="button" data-note-delete="${n.id}" aria-label="Supprimer">✕</button></div>` : ''}
        </div>
        ${n.body ? `<p>${escapeHtml(n.body).replace(/\n/g, '<br>')}</p>` : ''}
        ${imgs.length ? `<div class="media-grid">${imgs.map((m, i) => `<figure data-img-index="${i}"><img src="${escapeHtml(m.signed_url)}" alt="${escapeHtml(m.caption || n.title)}" loading="lazy">${m.caption ? `<figcaption>${escapeHtml(m.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : ''}
      </article>`;
    }).join('') : `<div class="empty">${k.empty}</div>`;
  }
}

/* Un point s'ouvre en grand au clic : titre, consignes et images légendées. */
function openNote(id, start = 0) {
  const n = noteStore.notes.find(x => x.id === id);
  if (!n) return;
  const box = openLightbox({
    title: n.title,
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
    const edit = e.target.closest('[data-note-edit]');
    if (edit) return openNoteModal(null, Number(edit.dataset.noteEdit));
    const del = e.target.closest('[data-note-delete]');
    if (del) return deleteNote(Number(del.dataset.noteDelete));
    const card = e.target.closest('[data-note-open]');
    if (!card) return;
    const fig = e.target.closest('[data-img-index]');
    openNote(Number(card.dataset.noteOpen), fig ? Number(fig.dataset.imgIndex) : 0);
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
      <div class="field"><label for="noteTitle">Titre</label><input id="noteTitle" autocomplete="off"></div>
      <div class="field"><label for="noteBody">Description / consignes</label><textarea id="noteBody" rows="5"></textarea></div>
      <div class="field">
        <label>Images / exercices</label>
        <div id="noteImages" class="note-images-edit"></div>
        <input id="noteFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple>
        <small class="field-hint">Chaque image peut avoir sa légende, affichée quand on l’ouvre en grand.</small>
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
  if (!title) return noteStore.onError('Le titre est obligatoire.');
  const btn = document.getElementById('btnSaveNote'); btn.disabled = true;
  try {
    let noteId = id;
    if (id) {
      const { error } = await sb.from('player_performance_notes').update({ title, body }).eq('id', id);
      if (error) throw error;
    } else {
      const { data: note, error } = await sb.from('player_performance_notes').insert({
        club_id: p.club_id, player_id: p.id, kind, title, body, created_by: noteStore.userId,
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
      const ext = (pend.file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `${p.club_id}/${p.id}/${noteId}/${Date.now()}-${index}.${ext}`;
      const up = await sb.storage.from(NOTES_BUCKET).upload(path, pend.file, { contentType: pend.file.type || 'image/jpeg' });
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

async function deleteNote(id) {
  if (!noteStore.canEdit || !confirm('Supprimer ce point et ses images ?')) return;
  const files = noteStore.media.filter(m => m.note_id === id).map(m => m.storage_path);
  const { error } = await sb.from('player_performance_notes').delete().eq('id', id);
  if (error) return noteStore.onError(error.message);
  if (files.length) await sb.storage.from(NOTES_BUCKET).remove(files);
  toast('Supprimé.', 'success');
  await loadNotes();
}
