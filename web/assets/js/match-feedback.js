/* ============================================================
   LMFC Performance — match-feedback.js
   Avis du joueur après le match (lmfc_v36.sql), commun à l'accueil et au
   calendrier, sur le modèle du RPE (rpe.js) :
     - openMatchFeedbackSheet : les deux questions, en texte libre ; le
       joueur y revient quand il veut (même avis, complété ou modifié) ;
     - myMatchToReview : la carte de l'accueil (dernier match joué sans
       réponse depuis 30 jours, sinon le dernier joué).
   Écriture par match_feedback_set() seulement : la base vérifie que le
   match le concerne et qu'il a eu lieu. Les réponses vont au staff,
   jamais aux autres joueurs. Dépend de rpe.js (rpeDate, styles rpe.css).
   ============================================================ */

const MF_QUESTIONS = [
  ['individuel', 'Que penses-tu de ta performance individuelle lors de ce match ?', 'Ce que tu as bien fait, ce que tu aurais pu améliorer, ton ressenti.'],
  ['collectif', 'Que penses-tu de la performance collective de l’équipe lors de ce match ?', 'Le fonctionnement de l’équipe, le jeu collectif, les points positifs, ce qui est à améliorer.'],
];
const mfAnswered = (f) => !!(f?.individuel || f?.collectif);
/* Les questions réglées dans Formulaires (lmfc_v47.sql) : une peut être retirée. */
const mfShown = (match) => (match.form_questions ? MF_QUESTIONS.flatMap(([k]) => {
  const q = match.form_questions.find(x => x.id === k);
  return q ? [[k, q.label, q.hint || '']] : [];
}) : MF_QUESTIONS);

/* match : { id, titre (adversaire), date, form_titre, form_questions } ; value : { individuel, collectif } ; onSaved(valeur). */
function openMatchFeedbackSheet({ match, value = null, onSaved }) {
  if (!document.getElementById('mfSheet')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="mfSheet">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="mfTitle">
        <button type="button" class="modal-x" aria-label="Fermer"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        <h2 class="as-h3" id="mfTitle"></h2>
        <p class="rpe-session" id="mfMatch"></p>
        <div id="mfFields"></div>
        <p class="rpe-help">Tes réponses vont au staff, jamais aux autres joueurs. Tu peux y revenir quand tu veux.</p>
        <p class="rpe-status" id="mfStatus" role="status" aria-live="polite"></p>
        <div class="modal-actions"><button class="btn" type="button" data-close="mfSheet">Fermer</button>
          <button class="btn btn-primary" type="button" id="mfSave">Enregistrer</button></div>
      </div></div>`);
    document.getElementById('mfSave').addEventListener('click', mfSave);
  }
  document.getElementById('mfSheet').mf = { match, value, onSaved };
  document.getElementById('mfTitle').textContent = match.form_titre || 'Ton avis sur le match';
  document.getElementById('mfMatch').textContent = [match.titre && `Contre ${match.titre}`, match.date && rpeDate(match.date)].filter(Boolean).join(' · ');
  const shown = mfShown(match);
  document.getElementById('mfFields').innerHTML = shown.map(([k, q, hint]) => `<div class="field"><label for="mf-${k}">${escapeHtml(q)}</label>
    <textarea id="mf-${k}" rows="4" maxlength="2000" placeholder="${escapeHtml(hint)}"></textarea></div>`).join('');
  shown.forEach(([k]) => { document.getElementById(`mf-${k}`).value = value?.[k] || ''; });
  document.getElementById('mfStatus').textContent = '';
  openModal('mfSheet');
  document.querySelector('#mfFields textarea').focus();
}

async function mfSave() {
  const sheet = document.getElementById('mfSheet'), status = document.getElementById('mfStatus');
  const { match, value, onSaved } = sheet.mf;
  if (sheet.hasAttribute('data-busy')) return;   // un seul envoi à la fois
  // Une question retirée garde sa réponse : match_feedback_set remplace les deux.
  const v = Object.fromEntries(MF_QUESTIONS.map(([k]) => {
    const field = document.getElementById(`mf-${k}`);
    return [k, field ? field.value.trim() || null : value?.[k] ?? null];
  }));
  sheet.setAttribute('data-busy', '');
  status.textContent = 'Enregistrement…';
  const { error } = await sb.rpc('match_feedback_set', { p_match: match.id, p_individuel: v.individuel, p_collectif: v.collectif });
  sheet.removeAttribute('data-busy');
  if (error) {
    console.error('Avis de match non enregistré', error);
    status.innerHTML = `<span class="text-danger">${escapeHtml(error.code === 'PGRST202' ? 'L’avis de match n’est pas encore installé (lmfc_v36.sql).' : error.message)}</span>`;
    return;
  }
  status.textContent = 'Enregistré. Merci !';
  onSaved?.(v);
  if (formHasMore(match)) { status.innerHTML = `Enregistré. Merci ! ${FORM_MORE}`; return; }
  setTimeout(() => { if (sheet.mf?.match === match) closeModal('mfSheet'); }, 900);
}

/* Accueil : le dernier match joué depuis 30 jours sans réponse, sinon le dernier
   joué, avec son avis ; null s'il n'y en a pas (ou sans lmfc_v36.sql). */
async function myMatchToReview() {
  const [played, fb] = await Promise.all([
    sb.rpc('my_avis_matches'),   // du plus récent au plus ancien, si son équipe reçoit l'avis
    sb.from('match_feedback').select('match_id, individuel, collectif'),
  ]);
  const err = played.error || fb.error;
  if (err) { if (!['42P01', 'PGRST202', 'PGRST205'].includes(err.code)) console.warn('Avis de match indisponible', err.message); return null; }
  const withFb = (played.data || []).map(r => ({ match: { id: r.match_id, titre: r.titre, date: r.date_match, form_titre: r.form_titre, form_questions: r.form_questions },
    value: fb.data.find(f => f.match_id === r.match_id) || null }));
  return withFb.find(x => !mfAnswered(x.value)) || withFb[0] || null;
}
