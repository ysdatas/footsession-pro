/* LMFC Performance — mon-programme-page.js
   Mon programme (mon-programme.html), espace joueur.
   Script sorti de la page pour la politique de contenu (CSP : aucun script en ligne). */
/* Espace joueur, en lecture : objectifs et préventions (avec leur
   statut et leurs images), points forts, axes d'amélioration et
   exercices terrain préparés par le staff. Le joueur peut seulement
   marquer un exercice « fait » et laisser un ressenti
   (RPC mark_program_exercise). */
let exercises = [];

(async () => {
  const player = await requirePlayer();
  if (!player) return;
  const box = document.getElementById('programBox');
  bindProgramCards(box, openExercise);
  [exercises] = await Promise.all([
    loadProgram(player.id),
    // Points forts et axes : leur vidéo et leurs exercices (Exo 1, Exo 2…), qui s'ouvrent ici.
    initNotes({ player, canEdit: false, lists: { objective: 'objectiveList', prevention: 'preventionList', strength: 'strengthList', improvement: 'improvementList' },
      program: { exercises: () => exercises || [], open: openExercise } }),
  ]);
  render();
})();

function render() {
  renderProgramList(document.getElementById('programBox'), exercises);
  renderNoteLists();   // les Exo des points (fait / pas fait)
  const n = (exercises || []).length, done = (exercises || []).filter(e => e.done_at).length;
  document.getElementById('progSub').textContent = n
    ? `· ${done} fait${done > 1 ? 's' : ''} sur ${n} · touche un exercice pour l’ouvrir en grand` : '';
}

function openExercise(id) {
  const e = exercises.find(x => x.id === id);
  if (!e) return;
  const box = openLightbox({
    title: e.title,
    text: [e.dosage ? `Dosage : ${e.dosage}` : '', e.instructions || ''].filter(Boolean).join('\n\n'),
    items: programItems(e),
    footer: `
      ${e.video_id ? `<a class="btn btn-sm" href="voir-video.html?id=${e.video_id}">▶ Voir la vidéo</a>` : ''}
      <label class="lb-feedback">Mon ressenti
        <textarea rows="2" id="lbFeedback" placeholder="Facile, difficile, douleur…">${progEsc(e.player_feedback || '')}</textarea>
      </label>
      <button class="btn btn-primary" type="button" id="lbDone">${e.done_at ? 'Enregistrer' : '✓ C’est fait'}</button>
      ${e.done_at ? '<button class="btn" type="button" id="lbUndo">Pas encore fait</button>' : ''}`,
  });
  const save = async (done) => {
    const feedback = box.querySelector('#lbFeedback').value;
    const { error } = await sb.rpc('mark_program_exercise', { p_id: id, p_done: done, p_feedback: feedback });
    if (error) { console.error('Exercice non enregistré', error); return toast(error.message, 'error'); }
    e.done_at = done ? (e.done_at || new Date().toISOString()) : null;
    e.player_feedback = feedback.trim() || null;
    closeLightbox();
    render();
    toast(done ? 'Bien joué, c’est noté !' : 'Exercice remis à faire', 'success');
  };
  box.querySelector('#lbDone').addEventListener('click', () => save(true));
  box.querySelector('#lbUndo')?.addEventListener('click', () => save(false));
}
