/* ============================================================
   LMFC Performance — notes.js
   Les « points » d'un joueur (table player_performance_notes) :
     - objectifs, préventions   → fiche joueur, Performance,
                                  « Objectifs & préventions » du joueur ;
     - points forts, axes       → Programme terrain (fiche joueur
       d'amélioration              côté staff, « Mon programme
                                   terrain » côté joueur).
   Chaque point : titre, consignes, images légendées et PDF ; un clic
   l'ouvre en grand (lightbox.js). Le staff ajoute, modifie,
   supprime ; le joueur consulte (la RLS refuse le reste).
   Un objectif ou une prévention a en plus un statut (En cours,
   Atteint, Non atteint), modifiable d'un geste sur sa carte
   (lmfc_v3.sql). Le titre est facultatif (lmfc_v4.sql) : sans titre,
   la carte reprend le début de la description.
   Un point fort ou un axe d'amélioration porte aussi une vidéo du
   joueur et ses exercices (lmfc_v6.sql : video_id, exercise_ids) :
   vidéo à gauche, description à droite, Exo 1, Exo 2… dessous.
   ============================================================ */

const NOTE_KINDS = {
  strength:    { badge: 'Point fort',  cls: 'badge-success', empty: 'Aucun point fort.',          add: 'Ajouter un point fort' },
  improvement: { badge: 'Axe',         cls: 'badge-gold',    empty: 'Aucun axe d’amélioration.',  add: 'Ajouter un axe d’amélioration' },
  objective:   { badge: 'Objectif',    cls: 'badge-gold',    empty: 'Aucun objectif.',            add: 'Ajouter un objectif' },
  prevention:  { badge: 'Prévention',  cls: 'badge-red',     empty: 'Aucune prévention.',         add: 'Ajouter une prévention' },
};
/* Objectifs et préventions ont un statut ; points forts et axes, non. */
const hasStatus = (kind) => kind === 'objective' || kind === 'prevention';
/* Points du programme terrain : vidéo et exercices liés. */
const isPoint = (kind) => kind === 'strength' || kind === 'improvement';
/* Titre affiché : le titre, sinon le début de la description, sinon le type. */
function noteTitle(n) {
  const t = (n.title || '').trim();
  if (t) return t;
  const first = (n.body || '').trim().split('\n')[0];
  if (first) return first.length > 70 ? `${first.slice(0, 67)}…` : first;
  return NOTE_KINDS[n.kind]?.badge || 'Point';
}
const NOTES_BUCKET = 'player-performance-media';
/* Pièces jointes d'un point : images ou PDF, même table et même dossier ;
   un PDF se reconnaît à son extension (aucune migration). */
const NOTE_FILE_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf,.pdf';
const isPdfMedia = (x) => x?.type === 'application/pdf' || /\.pdf$/i.test(x?.storage_path || x?.path || x?.name || '');
function noteFileError(file) {
  if (!isPdfMedia(file) && !/^image\//.test(file.type)) return `« ${file.name} » n’est ni une image ni un PDF.`;
  if (file.size > 20 * 1024 * 1024) return `« ${file.name} » dépasse 20 Mo.`;
  return '';
}
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
  draft: { existing: [], pending: [], video: null, exos: [] },
  onError: (msg) => toast(msg, 'error'),
  // Programme terrain : { exercises: () => [...], open: (id) => … } fourni par la page.
  program: null,
  videos: [], videoUrls: new Map(),   // vidéos du joueur (points) et leurs liens de lecture
  links: false,                       // colonnes video_id / exercise_ids présentes (lmfc_v6.sql)
  canUploadVideo: false,
};
const noteExercises = () => noteStore.program?.exercises?.() || [];
/* Exercices d'un point, dans l'ordre choisi ; un exercice supprimé est ignoré. */
const pointExercises = (n) => (n.exercise_ids || []).map(id => noteExercises().find(e => e.id === Number(id))).filter(Boolean);
const pointVideo = (n) => (n.video_id ? noteStore.videos.find(v => v.id === Number(n.video_id)) : null);

const noteMedia = (id) => noteStore.media.filter(m => m.note_id === id && m.signed_url)
  .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
const noteImages = (id) => noteMedia(id).filter(m => !isPdfMedia(m));
/* PDF d'un point : un lien chacun, ouvert dans un nouvel onglet (lecteur du navigateur). */
const noteDocsHtml = (id) => {
  const docs = noteMedia(id).filter(isPdfMedia);
  return docs.length ? `<div class="note-docs">${docs.map(m => `<a class="note-doc" href="${escapeHtml(m.signed_url)}" target="_blank" rel="noopener">${escapeHtml(m.caption || 'Document PDF')}</a>`).join('')}</div>` : '';
};
/* Ligne d'un fichier dans une fenêtre d'édition : aperçu (ou « PDF »), légende, retrait. */
const noteFileRow = (f, key, i) => `<div class="nie-row${f.removed ? ' is-removed' : ''}">
    ${f.pdf ? '<span class="nie-doc">PDF</span>' : `<img src="${escapeHtml(f.url)}" alt="">`}
    <input type="text" data-caption="${key}:${i}" value="${escapeHtml(f.caption)}" placeholder="${f.pdf ? 'Nom du document' : 'Légende / annotation (facultatif)'}" ${f.removed ? 'disabled' : ''}>
    <button class="btn btn-sm" type="button" data-img-toggle="${key}:${i}">${key === 'pending' ? 'Retirer' : (f.removed ? 'Garder' : 'Retirer')}</button>
  </div>`;

/* opts : { player, canEdit, userId, lists: { kind: elementId }, onError } */
async function initNotes(opts) {
  Object.assign(noteStore, opts);
  mountNoteModal();
  for (const [kind, listId] of Object.entries(noteStore.lists)) bindNoteList(kind, listId);
  await loadNotes();
}

async function loadNotes() {
  const p = noteStore.player;
  const withPoints = Object.keys(noteStore.lists).some(isPoint);
  const [nRes, mRes, vRes, linkRes] = await Promise.all([
    sb.from('player_performance_notes').select('*').eq('player_id', p.id).order('sort_order').order('id'),
    sb.from('player_performance_media').select('*').eq('player_id', p.id).order('sort_order').order('id'),
    withPoints ? sb.from('player_videos').select('id, titre, storage_path, created_at').eq('player_id', p.id).order('created_at', { ascending: false }) : { data: [] },
    withPoints ? sb.from('player_performance_notes').select('video_id, exercise_ids').limit(1) : { error: true },
  ]);
  if (vRes.error) console.warn('Vidéos du joueur illisibles', vRes.error);
  noteStore.videos = vRes.data || [];
  noteStore.links = !linkRes.error;   // sans lmfc_v6.sql : pas de vidéo ni d'exercices liés
  await signPointVideos(nRes.data || []);
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

/* Liens de lecture des vidéos montrées dans les points. */
async function signPointVideos(notes) {
  const paths = [...new Set(notes.map(pointVideo).filter(Boolean).map(v => v.storage_path))]
    .filter(path => !noteStore.videoUrls.has(path));
  if (!paths.length) return;
  try {
    const urls = await videoUrls(paths);
    urls.forEach((u, path) => noteStore.videoUrls.set(path, u));
  } catch (e) { console.warn('Vidéos des points illisibles', e); }
}

/* Carte d'un point : vidéo | description, puis ses exercices. */
function pointCard(n) {
  const title = noteTitle(n), imgs = noteImages(n.id), v = pointVideo(n);
  const body = n.title?.trim() ? n.body : (n.body || '').trim().split('\n').slice(1).join('\n');
  const url = v && noteStore.videoUrls.get(v.storage_path);
  const exos = pointExercises(n);
  const addExo = noteStore.canEdit && noteStore.links && noteStore.program?.add;
  return `<article class="note-card point-card" data-note-open="${n.id}" tabindex="0" aria-label="${escapeHtml(title)}">
    <div class="note-card-head">
      <h3>${escapeHtml(title)}</h3>
      ${noteStore.canEdit ? `<div class="note-card-actions">
        <button class="btn btn-sm" type="button" data-note-edit="${n.id}">Modifier</button>
        <button class="btn btn-sm btn-danger" type="button" data-note-delete="${n.id}" aria-label="Supprimer « ${escapeHtml(title)} »" title="Supprimer">✕</button></div>` : ''}
    </div>
    <div class="point-main${v ? '' : ' no-video'}">
      ${v ? `<div class="point-video">${url
        ? `<video controls playsinline preload="metadata" src="${escapeHtml(url)}#t=0.1" title="${escapeHtml(v.titre || 'Vidéo')}"></video>`
        : '<span class="point-video-off">Vidéo indisponible</span>'}
        <span class="point-video-title">${escapeHtml(v.titre || 'Vidéo')}</span></div>` : ''}
      <div class="point-desc">
        ${body ? `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>` : (v || exos.length ? '' : '<p class="text-muted">Pas de description.</p>')}
        ${imgs.length ? `<div class="media-grid">${imgs.map((m, i) => `<figure data-img-index="${i}"><img src="${escapeHtml(m.signed_url)}" alt="${escapeHtml(m.caption || title)}" loading="lazy">${m.caption ? `<figcaption>${escapeHtml(m.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : ''}
        ${noteDocsHtml(n.id)}
      </div>
    </div>
    ${exos.length || addExo ? `<div class="point-exos">${exos.map((e, i) => `
      <button class="point-exo${e.done_at ? ' is-done' : ''}" type="button" data-exo-open="${e.id}">
        <span class="point-exo-n">Exo ${i + 1}</span><span class="point-exo-t">${escapeHtml(e.title)}</span>${e.done_at ? '<span class="point-exo-done" aria-label="fait">✓</span>' : ''}
      </button>`).join('')}${addExo ? `<button class="point-exo point-exo-add" type="button" data-exo-add="${n.id}">+ Exo</button>` : ''}</div>` : ''}
  </article>`;
}

function renderNoteLists() {
  for (const [kind, listId] of Object.entries(noteStore.lists)) {
    const box = document.getElementById(listId);
    if (!box) continue;
    const k = NOTE_KINDS[kind];
    const list = noteStore.notes.filter(n => n.kind === kind);
    if (isPoint(kind)) {
      box.innerHTML = list.length ? list.map(pointCard).join('') : `<div class="empty">${k.empty}</div>`;
      continue;
    }
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
        ${noteDocsHtml(n.id)}
      </article>`;
    }).join('') : `<div class="empty">${k.empty}</div>`;
  }
}

/* Un point s'ouvre en grand au clic : titre, consignes et images légendées. */
function openNote(id, start = 0) {
  const n = noteStore.notes.find(x => x.id === id);
  if (!n) return;
  const v = pointVideo(n), url = v && noteStore.videoUrls.get(v.storage_path);
  const box = openLightbox({
    title: noteTitle(n),
    text: [n.body || '', ...pointExercises(n).map((e, i) => `Exo ${i + 1} : ${e.title}${e.dosage ? ` (${e.dosage})` : ''}`)].filter(Boolean).join('\n'),
    items: [
      ...noteImages(id).map(m => ({ type: 'image', src: m.signed_url, caption: m.caption || '' })),
      ...(url ? [{ type: 'video', src: url, caption: v.titre || 'Vidéo' }] : []),
    ],
    start,
    footer: noteDocsHtml(id) + (noteStore.canEdit ? '<button class="btn btn-sm" type="button" data-lb-edit>Modifier</button>' : ''),
  });
  box.querySelector('[data-lb-edit]')?.addEventListener('click', () => { closeLightbox(); openNoteModal(null, id); });
}

function bindNoteList(kind, listId) {
  const list = document.getElementById(listId);
  if (!list || list.dataset.notesBound) return;
  list.dataset.notesBound = '1';
  list.addEventListener('click', e => {
    if (e.target.closest('[data-note-status]')) return;   // la liste du statut ne doit pas ouvrir la carte
    if (e.target.closest('a[href]')) return;               // un PDF s'ouvre dans son onglet
    const addExo = e.target.closest('[data-exo-add]');
    if (addExo) return noteStore.program?.add?.(Number(addExo.dataset.exoAdd));
    const exo = e.target.closest('[data-exo-open]');
    if (exo) return noteStore.program?.open?.(Number(exo.dataset.exoOpen));
    if (e.target.closest('.point-video')) return;           // la vidéo se lit sur place
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
      <div class="field"><label for="noteTitle">Titre <span class="label-opt">(facultatif)</span></label><input id="noteTitle" autocomplete="off" placeholder="Ex. Gainage : 3 séances par semaine"></div>
      <div class="field"><label for="noteBody">Description / consignes</label><textarea id="noteBody" rows="5"></textarea></div>
      <div class="field" id="noteStatusField"><label for="noteStatus">Statut</label>
        <select id="noteStatus">${Object.entries(OBJ_STATUS).map(([v, s]) => `<option value="${v}">${s.label}</option>`).join('')}</select></div>
      <div class="field point-only" id="noteVideoField">
        <label for="noteVideo">Vidéo <span class="label-opt">(facultatif)</span></label>
        <div class="note-video-row">
          <select id="noteVideo"></select>
          <label class="file-pick hidden" id="noteVideoPick"><input id="noteVideoFile" type="file" accept="video/*">
            <span class="btn btn-sm">+ Importer une vidéo</span></label>
        </div>
        <div class="hidden" id="noteVideoBar"><span style="width:0%"></span></div>
        <small class="field-hint" id="noteVideoHint">Une vidéo du joueur (Vidéos joueurs), ou une nouvelle : elle rejoint aussi ses vidéos.</small>
      </div>
      <div class="field point-only" id="noteExoField">
        <label>Exercices <span class="label-opt">(dans l’ordre : Exo 1, Exo 2…)</span></label>
        <div id="noteExos" class="note-exos-pick"></div>
        <small class="field-hint">Touchez les exercices dans l’ordre voulu. Pour en créer un : « + Exercice » dans le Programme terrain.</small>
      </div>
      <p class="field-hint point-only hidden" id="noteLinksMissing">Vidéo et exercices liés : pas encore disponibles (prévenez l’administrateur du club).</p>
      <div class="field">
        <label>Images et PDF</label>
        <div id="noteImages" class="note-images-edit"></div>
        <label class="file-pick"><input id="noteFiles" type="file" accept="${NOTE_FILE_ACCEPT}" multiple>
          <span class="btn btn-sm">+ Ajouter des images ou un PDF</span></label>
        <small class="field-hint">Ils s’affichent tout de suite ici ; chaque image a sa légende, chaque PDF son nom.</small>
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
      const err = noteFileError(file);
      if (err) { noteStore.onError(err); continue; }
      const pdf = isPdfMedia(file);
      noteStore.draft.pending.push({ file, pdf, url: URL.createObjectURL(file), caption: pdf ? file.name.replace(/\.pdf$/i, '') : '' });
    }
    e.target.value = '';
    renderNoteImages();
  });
  document.getElementById('btnSaveNote').addEventListener('click', saveNote);
  document.getElementById('noteVideo').addEventListener('change', e => { noteStore.draft.video = Number(e.target.value) || null; });
  document.getElementById('noteExos').addEventListener('click', e => {
    const b = e.target.closest('[data-exo-pick]'); if (!b) return;
    const id = Number(b.dataset.exoPick), d = noteStore.draft;
    d.exos = d.exos.includes(id) ? d.exos.filter(x => x !== id) : [...d.exos, id];
    renderNoteExos();
  });
  document.getElementById('noteVideoFile').addEventListener('change', e => {
    const file = e.target.files[0]; e.target.value = '';
    if (file) uploadPointVideo(file);
  });
}

function renderNoteVideos() {
  const sel = document.getElementById('noteVideo');
  sel.innerHTML = '<option value="">Aucune vidéo</option>' + noteStore.videos.map(v =>
    `<option value="${v.id}">${escapeHtml(v.titre || 'Vidéo')} · ${new Date(v.created_at).toLocaleDateString('fr-FR')}</option>`).join('');
  sel.value = noteStore.draft.video ? String(noteStore.draft.video) : '';
}
function renderNoteExos() {
  const d = noteStore.draft, list = noteExercises();
  document.getElementById('noteExos').innerHTML = list.length ? list.map(e => {
    const rank = d.exos.indexOf(e.id) + 1;
    return `<button type="button" class="nep-item${rank ? ' is-on' : ''}" data-exo-pick="${e.id}" aria-pressed="${!!rank}">
      <span class="nep-rank" aria-hidden="true">${rank ? `Exo ${rank}` : '+'}</span>
      <span class="nep-title">${escapeHtml(e.title)}</span>
      ${e.seance ? `<span class="nep-meta">${escapeHtml(e.seance)}</span>` : ''}
    </button>`;
  }).join('') : '<p class="text-muted">Aucun exercice pour ce joueur pour l’instant.</p>';
}

/* Vidéo importée depuis la fenêtre d'un point : envoyée comme toute vidéo
   du joueur (R2, avec son pourcentage), puis choisie pour ce point. */
async function uploadPointVideo(file) {
  const p = noteStore.player;
  if (file.size > VIDEO_MAX_BYTES) return noteStore.onError(`Vidéo trop volumineuse : ${Math.round(VIDEO_MAX_BYTES / 1048576)} Mo au maximum.`);
  const bar = document.getElementById('noteVideoBar'), hint = document.getElementById('noteVideoHint');
  const save = document.getElementById('btnSaveNote');
  const ext = (/\.([a-z0-9]{1,8})$/i.exec(file.name)?.[1] || 'mp4').toLowerCase();
  const path = `r2/${p.club_id}/${p.id}/${Date.now()}.${ext}`;
  const titre = (file.name.replace(/\.[^.]+$/, '').replace(/[_\s]+/g, ' ').trim() || 'Vidéo');
  save.disabled = true; bar.classList.remove('hidden');
  const show = (pct) => {
    bar.firstElementChild.style.width = `${Math.round(pct * 100)}%`;
    hint.textContent = pct >= 1 ? 'Finalisation…' : `Envoi de « ${file.name} » : ${Math.floor(pct * 100)} %`;
  };
  show(0);
  try {
    await uploadVideoFile(path, file, { onProgress: show });
    const { data: v, error } = await sb.from('player_videos').insert({
      club_id: p.club_id, player_id: p.id, storage_path: path, titre: titre.charAt(0).toUpperCase() + titre.slice(1),
    }).select('id, titre, storage_path, created_at').single();
    if (error) {
      await removeVideoFile(path).catch(err => console.warn('Fichier orphelin', path, err));
      throw error;
    }
    noteStore.videos.unshift(v);
    noteStore.draft.video = v.id;
    renderNoteVideos();
    hint.textContent = `« ${v.titre} » envoyée et choisie pour ce point.`;
  } catch (e) {
    console.error('Vidéo du point non envoyée', e);
    hint.textContent = 'Une vidéo du joueur (Vidéos joueurs), ou une nouvelle : elle rejoint aussi ses vidéos.';
    noteStore.onError(e.message || 'Envoi de la vidéo impossible.');
  } finally {
    save.disabled = false;
    bar.classList.add('hidden');
  }
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
    existing: n ? noteMedia(n.id).map(m => ({ id: m.id, path: m.storage_path, url: m.signed_url, pdf: isPdfMedia(m), caption: m.caption || '', removed: false })) : [],
    pending: [],
    video: n && pointVideo(n) ? Number(n.video_id) : null,
    exos: n ? pointExercises(n).map(e => e.id) : [],
  };
  const point = isPoint(kind);
  document.querySelectorAll('#noteModal .point-only').forEach(el => el.classList.toggle('hidden', !point
    || (el.id === 'noteLinksMissing') === noteStore.links));
  document.getElementById('noteVideoPick').classList.toggle('hidden', !noteStore.canUploadVideo);
  if (point && noteStore.links) { renderNoteVideos(); renderNoteExos(); }
  renderNoteImages();
  openModal('noteModal');
  setTimeout(() => document.getElementById('noteTitle').focus(), 50);
}

function renderNoteImages() {
  const d = noteStore.draft;
  document.getElementById('noteImages').innerHTML = d.existing.map((f, i) => noteFileRow(f, 'existing', i)).join('')
    + d.pending.map((f, i) => noteFileRow(f, 'pending', i)).join('');
}

async function saveNote() {
  const p = noteStore.player, d = noteStore.draft;
  const kind = document.getElementById('noteKind').value;
  const id = Number(document.getElementById('noteId').value) || null;
  const title = document.getElementById('noteTitle').value.trim();
  const body = document.getElementById('noteBody').value.trim() || null;
  const extra = hasStatus(kind) ? { status: document.getElementById('noteStatus').value } : {};
  if (isPoint(kind) && noteStore.links) {
    // Seuls les exercices encore présents sont gardés (un exercice supprimé disparaît du point).
    Object.assign(extra, { video_id: d.video || null, exercise_ids: d.exos.filter(x => noteExercises().some(e => e.id === x)) });
  }
  const keptImages = d.existing.filter(m => !m.removed).length + d.pending.length;
  if (!title && !body && !keptImages && !extra.video_id && !extra.exercise_ids?.length) {
    return noteStore.onError('Écrivez un titre ou une description, ou ajoutez une image ou un PDF.');
  }
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
      const { file, ext, type } = await prepareNoteFile(pend.file);
      const path = `${p.club_id}/${p.id}/${noteId}/${Date.now()}-${index}.${ext}`;
      const up = await sb.storage.from(NOTES_BUCKET).upload(path, file, { contentType: type });
      if (up.error) { noteStore.onError(`« ${pend.file.name} » n’a pas été envoyé : ${up.error.message}`); continue; }
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
  if (!noteStore.canEdit || !n || !confirm(`Supprimer « ${noteTitle(n)} »${noteImages(id).length ? ' et ses images' : ''} ?${await trashNote()}`)) return;
  const files = noteStore.media.filter(m => m.note_id === id).map(m => m.storage_path);
  const { error } = await sb.from('player_performance_notes').delete().eq('id', id);
  if (error) return noteStore.onError(error.message);
  // Corbeille : les images restent jusqu'à la suppression définitive.
  if (files.length && !(await trashReady())) await sb.storage.from(NOTES_BUCKET).remove(files);
  toast('Supprimé.', 'success');
  await loadNotes();
}

/* Fichier prêt à l'envoi : un PDF part tel quel, une image est réduite. */
async function prepareNoteFile(file) {
  if (isPdfMedia(file)) return { file, ext: 'pdf', type: 'application/pdf' };
  const img = await shrinkImage(file);
  return { file: img, ext: img.type === 'image/png' ? 'png' : 'jpg', type: img.type || 'image/jpeg' };
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
