/* ============================================================
   LMFC Performance — analyse-autosave.js
   Sauvegarde automatique de la séquence ouverte dans le panneau de codage,
   sur le modèle des séances (session-autosave.js) :
     - 0,8 s après la dernière modification, pas de bouton « Enregistrer » ;
     - une seule écriture à la fois : un changement pendant l'envoi repart
       juste après ;
     - indicateur discret : Modifié, Enregistrement…, Enregistré, Erreur ;
     - rien ne se perd : changer de séquence attend la fin de l'envoi ; s'il
       échoue, on reste sur la séquence (Réessayer, ou Annuler les
       modifications pour revenir à ce qui est enregistré).
   Le codage part en entier (save_sequence_code, une transaction) ; le clip
   de la timeline, les compteurs et les tableaux suivent ce qui est enregistré.
     anDraftDirty()   anCodeFlush() → vrai si tout est enregistré
   ============================================================ */

const AN_SAVE_DELAY = 800;
const AN_SAVE_TEXT = { pending: 'Modifié', saving: 'Enregistrement…', saved: 'Enregistré', error: 'Erreur · Réessayer' };
const anSave = { timer: null, running: null, dirty: false, again: false, state: 'saved' };

function anDraftDirty() {
  if (!AN.draftClip) return;
  anSave.dirty = true;
  anSaveStatus('pending');
  clearTimeout(anSave.timer);
  anSave.timer = setTimeout(anCodeFlush, AN_SAVE_DELAY);
}

/* Ce qui empêche d'enregistrer, en quelques mots ; null si rien. */
function anDraftInvalid(d) {
  if ((d.x1 == null) !== (d.y1 == null) || (d.x2 == null) !== (d.y2 == null)) return 'x et y vont ensemble';
  if (!(d.start_sec >= 0) || !(d.end_sec - d.start_sec >= 0.5)) return 'Fin trop proche du début';
  return null;
}

function anCodeFlush() {
  clearTimeout(anSave.timer);
  if (anSave.running) { if (anSave.dirty) anSave.again = true; return anSave.running; }
  if (!anSave.dirty || !AN.draftClip) return Promise.resolve(true);
  anSave.running = (async () => {
    let ok = true;
    do {
      anSave.again = false;
      const clip = AN.draftClip, d = { ...AN.draft, tags: [...AN.draft.tags] }, bad = anDraftInvalid(d);
      if (bad) { ok = false; anSaveStatus('invalid', bad); break; }
      anSave.dirty = false;   // ce qui changera pendant l'envoi repartira au tour suivant
      anSaveStatus('saving');
      try {
        await anSaveCode(clip, d);
        anSaved(clip.id, d);
      } catch (err) {
        anSave.dirty = true; ok = false;
        anSaveStatus('error', err.message);
        break;
      }
    } while (anSave.again && anSave.dirty);
    anSave.running = null;
    if (ok) anSaveStatus(anSave.dirty ? 'pending' : 'saved');
    return ok && !anSave.dirty;
  })();
  return anSave.running;
}

/* Enregistré : le clip affiché prend ces valeurs (pas de relecture, la base a tout reçu). */
function anSaved(id, d) {
  const c = AN.clips.find(x => x.id === id);
  if (!c) return;
  Object.assign(c, anCodePayload(d), { start_sec: d.start_sec, end_sec: d.end_sec, coded: !!d.action });
  if (!AN.tl.trim) anRender();   // pendant un rognage, son lâcher redessine
}

function anSaveStatus(state, detail = '') {
  anSave.state = state;
  const b = document.getElementById('anSaveState'), drop = document.getElementById('anSaveDrop');
  if (!b) return;
  b.dataset.state = state;
  b.textContent = state === 'invalid' ? detail : AN_SAVE_TEXT[state];
  b.title = state === 'error' ? `${detail} Cliquez pour réessayer.` : '';
  b.disabled = state !== 'error';
  drop.hidden = !['error', 'invalid'].includes(state);
}

/* Quitter la page avec un envoi en attente : le navigateur prévient. */
window.addEventListener('beforeunload', (e) => { if (anSave.dirty || anSave.running) e.preventDefault(); });
