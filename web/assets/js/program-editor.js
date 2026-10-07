/* ============================================================
   LMFC Performance — program-editor.js (fiche joueur, staff)
   Carte « Programme » : liste des exercices, ouverture en grand,
   création / modification (image légendée, vidéo du joueur, schéma
   dessiné dans le tableau tactique). Écriture : admin, coach
   (can_manage_plans() côté base).
   ============================================================ */

const prog = { player: null, canEdit: false, exercises: [], videos: [], editing: null, removeImage: false, removeSchema: false };

async function initProgramEditor(player, profile) {
  prog.player = player;
  prog.canEdit = canManagePlans(profile.role);
  const box = document.getElementById('programBox');
  bindProgramCards(box, openExercise);
  if (prog.canEdit) {
    const add = document.getElementById('btnAddExercise');
    add.classList.remove('hidden');
    add.addEventListener('click', () => openExerciseModal(null));
    document.getElementById('btnProgSave').addEventListener('click', () => saveExercise());
    document.getElementById('btnProgDelete').addEventListener('click', deleteExercise);
    document.getElementById('btnProgSchema').addEventListener('click', drawSchema);
  }
  const [exercises, { data: videos }] = await Promise.all([
    loadProgram(player.id),
    sb.from('player_videos').select('id, titre, storage_path, created_at').eq('player_id', player.id).order('created_at', { ascending: false }),
  ]);
  prog.exercises = exercises;
  prog.videos = videos || [];
  renderProgramList(box, exercises, { staff: true });
}

async function reloadProgram() {
  prog.exercises = await loadProgram(prog.player.id);
  renderProgramList(document.getElementById('programBox'), prog.exercises, { staff: true });
  if (typeof renderNoteLists === 'function') renderNoteLists();   // titres des Exo dans les points
}

/* Point du programme (point fort, axe) qui contient l'exercice. */
const programPoints = () => (typeof noteStore === 'undefined' || !noteStore.links ? []
  : noteStore.notes.filter(n => n.kind === 'strength' || n.kind === 'improvement'));
const pointOfExercise = (id) => programPoints().find(n => (n.exercise_ids || []).map(Number).includes(id));

/* Change le point de l'exercice : retiré de l'ancien, ajouté à la fin des Exo
   du nouveau. Un exercice peut servir à plusieurs points : les autres ne
   bougent pas. */
async function linkExerciseToPoint(exId, noteId, oldNoteId) {
  const changes = programPoints().map(n => {
    const ids = (n.exercise_ids || []).map(Number);
    const has = ids.includes(exId);
    if (n.id === noteId && !has) return [n, [...ids, exId]];
    if (n.id === oldNoteId && n.id !== noteId && has) return [n, ids.filter(x => x !== exId)];
    return null;
  }).filter(Boolean);
  for (const [n, ids] of changes) {
    const keep = ids.filter(x => (prog.exercises || []).some(e => e.id === x) || x === exId);
    const { error } = await sb.from('player_performance_notes').update({ exercise_ids: keep }).eq('id', n.id);
    if (error) throw error;
    n.exercise_ids = keep;
  }
}

async function openExercise(id) {
  const e = (prog.exercises || []).find(x => x.id === id);
  if (!e) return;
  let src = null;
  const video = prog.videos.find(v => v.id === e.video_id);
  if (video) {
    try { src = await videoUrl(video.storage_path); }
    catch (err) { console.warn('Vidéo de l’exercice indisponible', err); }
  }
  const box = openLightbox({
    title: e.title,
    text: programText(e),
    items: programItems(e, src),
    footer: [
      e.done_at ? `<span class="badge badge-success">✓ Fait le ${progEsc(new Date(e.done_at).toLocaleDateString('fr-FR'))}</span>` : '<span class="badge">Pas encore fait</span>',
      prog.canEdit ? '<button class="btn btn-sm" type="button" data-lb-edit>Modifier l’exercice</button>' : '',
    ].join(''),
  });
  box.querySelector('[data-lb-edit]')?.addEventListener('click', () => { closeLightbox(); openExerciseModal(id); });
}

/* ---------- Fenêtre d'édition ---------- */
function openExerciseModal(id, noteId = null) {
  const e = id ? prog.exercises.find(x => x.id === id) : null;
  prog.editing = e;
  prog.removeImage = false;
  prog.removeSchema = false;
  const form = document.getElementById('programForm');
  form.reset();
  for (const k of ['seance', 'title', 'instructions', 'dosage', 'image_caption']) form[k].value = e?.[k] || '';
  form.video_id.innerHTML = '<option value="">Aucune</option>' + prog.videos.map(v =>
    `<option value="${v.id}">${progEsc(v.titre || 'Vidéo')} — ${progEsc(new Date(v.created_at).toLocaleDateString('fr-FR'))}</option>`).join('');
  form.video_id.value = e?.video_id || '';
  // Point du programme : visible dès qu'il y a des points (lmfc_v6.sql passée).
  const points = programPoints();
  form.note_id.closest('label').classList.toggle('hidden', !points.length);
  form.note_id.innerHTML = '<option value="">Aucun</option>' + [['strength', 'Point fort'], ['improvement', 'Axe']].map(([k, label]) =>
    points.filter(n => n.kind === k).map(n => `<option value="${n.id}">${label} · ${progEsc(noteTitle(n))}</option>`).join('')).join('');
  form.note_id.value = String(noteId || (e && pointOfExercise(e.id)?.id) || '');
  form.note_id.dataset.initial = e ? String((pointOfExercise(e.id)?.id) || '') : '';
  // Séances déjà utilisées pour ce joueur, proposées à la saisie.
  document.getElementById('seanceList').innerHTML = [...new Set((prog.exercises || []).map(x => x.seance).filter(Boolean))]
    .map(sv => `<option value="${progEsc(sv)}">`).join('');
  document.getElementById('programModalTitle').textContent = e ? 'Modifier l’exercice' : 'Nouvel exercice';
  document.getElementById('btnProgDelete').classList.toggle('hidden', !e);
  renderEditPreviews();
  openModal('programModal');
  setTimeout(() => form.title.focus(), 50);
}

function renderEditPreviews() {
  const e = prog.editing;
  const img = document.getElementById('progImagePreview');
  img.innerHTML = e?.image_url && !prog.removeImage
    ? `<img src="${progEsc(e.image_url)}" alt=""><button class="btn btn-sm" type="button" id="btnProgRemoveImage">Retirer l’image</button>`
    : '';
  document.getElementById('btnProgRemoveImage')?.addEventListener('click', () => { prog.removeImage = true; renderEditPreviews(); });
  const sch = document.getElementById('progSchemaPreview');
  const hasSchema = e?.schema_url && !prog.removeSchema;
  sch.innerHTML = hasSchema
    ? `<img src="${progEsc(e.schema_url)}" alt=""><button class="btn btn-sm" type="button" id="btnProgRemoveSchema">Retirer le schéma</button>`
    : '';
  document.getElementById('btnProgRemoveSchema')?.addEventListener('click', () => { prog.removeSchema = true; renderEditPreviews(); });
  document.getElementById('btnProgSchema').textContent = hasSchema ? 'Modifier le schéma' : 'Dessiner le schéma';
}

/* Enregistre l'exercice ; renvoie son id (null en cas d'échec). */
async function saveExercise({ keepOpen = false } = {}) {
  const form = document.getElementById('programForm');
  if (!form.title.value.trim()) { form.reportValidity(); toast('Le titre est obligatoire.', 'error'); return null; }
  const p = prog.player;
  const e = prog.editing;
  const body = {
    seance: form.seance.value.trim() || null,
    title: form.title.value.trim(),
    instructions: form.instructions.value.trim() || null,
    dosage: form.dosage.value.trim() || null,
    image_caption: form.image_caption.value.trim() || null,
    video_id: Number(form.video_id.value) || null,
  };
  const file = form.image.files[0];
  if (file && file.size > 5 * 1024 * 1024) { toast('Image trop volumineuse (5 Mo maximum).', 'error'); return null; }
  const btn = document.getElementById('btnProgSave'); btn.disabled = true;
  try {
    let id = e?.id;
    if (!id) {
      const order = Math.max(-1, ...(prog.exercises || []).map(x => x.sort_order || 0)) + 1;
      const { data, error } = await sb.from('program_exercises').insert({
        ...body, club_id: p.club_id, player_id: p.id, sort_order: order, created_by: window.CURRENT_PROFILE?.id,
      }).select('*').single();
      if (error) throw error;
      id = data.id;
      prog.editing = { ...data };
    }
    const toRemove = [];
    if (file) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `${p.club_id}/${p.id}/program/ex-${id}-${Date.now()}.${ext}`;
      const up = await sb.storage.from(PROGRAM_BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg' });
      if (up.error) throw up.error;
      if (e?.image_path) toRemove.push(e.image_path);
      body.image_path = path;
    } else if (prog.removeImage && e?.image_path) {
      toRemove.push(e.image_path);
      body.image_path = null;
      body.image_caption = null;
    }
    if (prog.removeSchema && e?.schema_path) {
      toRemove.push(e.schema_path);
      body.schema_path = null;
      body.schema_json = null;
    }
    const { error } = await sb.from('program_exercises').update(body).eq('id', id);
    if (error) throw error;
    if (toRemove.length) await sb.storage.from(PROGRAM_BUCKET).remove(toRemove);
    if (programPoints().length && form.note_id.value !== form.note_id.dataset.initial) {
      await linkExerciseToPoint(id, Number(form.note_id.value) || null, Number(form.note_id.dataset.initial) || null);
    }
    if (!keepOpen) { closeModal('programModal'); toast('Exercice enregistré', 'success'); }
    await reloadProgram();
    prog.editing = prog.exercises.find(x => x.id === id) || prog.editing;
    return id;
  } catch (err) {
    console.error('Enregistrement de l’exercice impossible', err);
    toast(/program_exercises/.test(err.message || '')
      ? 'Base à mettre à jour : exécutez supabase/player_program.sql.' : err.message, 'error');
    return null;
  } finally { btn.disabled = false; }
}

/* Le schéma se dessine dans le tableau tactique, dans un nouvel onglet ;
   « Valider » y enregistre le schéma sur l'exercice et le signale ici
   (localStorage) : liste et fenêtre ouverte se mettent à jour. */
window.addEventListener('storage', async (ev) => {
  if (ev.key !== 'tb_exo_saved' || !prog.player) return;
  const id = Number(JSON.parse(ev.newValue || '{}').id);
  if (!prog.exercises?.some(x => x.id === id)) return;
  await reloadProgram();
  if (prog.editing?.id === id) {
    prog.editing = prog.exercises.find(x => x.id === id) || prog.editing;
    prog.removeSchema = false;
    renderEditPreviews();
  }
  toast('Schéma ajouté à l’exercice.', 'success');
});
async function drawSchema() {
  const id = await saveExercise({ keepOpen: true });
  if (!id) return;
  const url = `tactical-board.html?exercise=${id}`;
  const win = window.open(url, '_blank');
  if (!win) window.location.href = url;
}

async function deleteExercise() {
  const e = prog.editing;
  if (!e || !confirm(`Supprimer l’exercice « ${e.title} » ?${await trashNote()}`)) return;
  const { error } = await sb.from('program_exercises').delete().eq('id', e.id);
  if (error) return toast(error.message, 'error');
  const files = [e.image_path, e.schema_path].filter(Boolean);
  if (files.length && !(await trashReady())) await sb.storage.from(PROGRAM_BUCKET).remove(files);   // corbeille : gardés
  closeModal('programModal');
  toast('Exercice supprimé', 'success');
  await reloadProgram();
}
