/* ============================================================
   FootSession Pro — program.js
   Programme individuel du joueur (table program_exercises) :
   exercices regroupés par séance, avec image, schéma du tableau
   tactique et vidéo du joueur.
     - staff (fiche joueur) : création, modification, schéma ;
     - joueur (Mon programme) : consultation, « fait », ressenti.
   Un exercice s'ouvre en grand dans la visionneuse (lightbox.js).
   ============================================================ */

const PROGRAM_BUCKET = 'player-performance-media';
const progEsc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const progDate = (iso) => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '';

/* Exercices du joueur, avec les URL signées de leurs images et schémas.
   Renvoie null si la table n'existe pas encore (migration non passée). */
async function loadProgram(playerId) {
  const { data, error } = await sb.from('program_exercises').select('*')
    .eq('player_id', playerId).order('sort_order').order('id');
  if (error) {
    console.warn('Programme indisponible (migration player_program.sql ?) :', error.message);
    return null;
  }
  const paths = [...new Set(data.flatMap(e => [e.image_path, e.schema_path]).filter(Boolean))];
  const urls = {};
  if (paths.length) {
    const { data: signed } = await sb.storage.from(PROGRAM_BUCKET).createSignedUrls(paths, 3600);
    (signed || []).forEach(s => { if (s.signedUrl) urls[s.path] = s.signedUrl; });
  }
  return data.map(e => ({ ...e, image_url: urls[e.image_path] || null, schema_url: urls[e.schema_path] || null }));
}

/* Cartes regroupées par séance, dans l'ordre de création des séances. */
function renderProgramList(container, exercises, { staff = false } = {}) {
  if (exercises === null) {
    container.innerHTML = '<p class="text-muted">Programme indisponible pour l’instant.</p>';
    return;
  }
  if (!exercises.length) {
    container.innerHTML = `<p class="text-muted">${staff
      ? 'Aucun exercice. Ajoutez-en avec « + Exercice » : image, schéma du tableau tactique, vidéo.'
      : 'Ton staff n’a pas encore ajouté d’exercice.'}</p>`;
    return;
  }
  const groups = new Map();
  exercises.forEach(e => {
    const key = (e.seance || '').trim() || 'Exercices';
    groups.set(key, [...(groups.get(key) || []), e]);
  });
  container.innerHTML = [...groups].map(([name, list]) => `
    <div class="prog-group">
      <h4 class="prog-group-title">${progEsc(name)}<span>${list.filter(e => e.done_at).length} / ${list.length} fait${list.length > 1 ? 's' : ''}</span></h4>
      <div class="prog-grid">${list.map(e => {
        const thumb = e.image_url || e.schema_url;
        return `<article class="prog-card${e.done_at ? ' is-done' : ''}" data-exercise="${e.id}" tabindex="0" role="button" aria-label="Ouvrir ${progEsc(e.title)}">
          <div class="prog-thumb">${thumb ? `<img src="${progEsc(thumb)}" alt="" loading="lazy">` : '<span>Pas d’image</span>'}
            ${e.done_at ? `<span class="prog-done">✓ Fait ${progDate(e.done_at)}</span>` : ''}</div>
          <div class="prog-body">
            <strong>${progEsc(e.title)}</strong>
            ${e.dosage ? `<span class="prog-dosage">${progEsc(e.dosage)}</span>` : ''}
            <span class="prog-tags">${[e.image_url && 'Image', e.schema_url && 'Schéma', e.video_id && 'Vidéo'].filter(Boolean).join(' · ')}</span>
            ${staff && e.player_feedback ? `<span class="prog-feedback">« ${progEsc(e.player_feedback)} »</span>` : ''}
          </div>
        </article>`;
      }).join('')}</div>
    </div>`).join('');
}

/* Contenu de la visionneuse : image, puis schéma, puis vidéo (staff). */
function programItems(e, videoUrl = null) {
  return [
    e.image_url && { type: 'image', src: e.image_url, caption: e.image_caption || '' },
    e.schema_url && { type: 'image', src: e.schema_url, caption: 'Schéma' },
    videoUrl && { type: 'video', src: videoUrl, caption: 'Vidéo' },
  ].filter(Boolean);
}
function programText(e) {
  return [e.dosage ? `Dosage : ${e.dosage}` : '', e.instructions || '',
    e.player_feedback ? `Ressenti du joueur : ${e.player_feedback}` : ''].filter(Boolean).join('\n\n');
}

/* Ouvre un exercice au clic ou à la touche Entrée. */
function bindProgramCards(container, onOpen) {
  container.addEventListener('click', e => {
    const card = e.target.closest('[data-exercise]');
    if (card) onOpen(Number(card.dataset.exercise));
  });
  container.addEventListener('keydown', e => {
    const card = e.target.closest('[data-exercise]');
    if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(Number(card.dataset.exercise)); }
  });
}
