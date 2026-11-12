/* ============================================================
   LMFC Performance — analyse-timeline-move.js
   Timeline / Codage vidéo : changer un clip de piste, le dupliquer.
     - glisser un segment vers le haut ou le bas le pose sur la piste d'une
       autre action (ou « À coder ») ; le minutage ne bouge pas. Rien n'est
       converti (anMoveCode) : le « Gagné » d'un duel ne devient pas le
       « Réussi » d'un centre.
         · le déplacement retire une information : rien n'est écrit, le
           panneau de codage s'ouvre à droite et dit ce qui partira ;
           « Enregistrer » déplace, « Annuler » laisse le clip où il était ;
         · sinon le clip change de piste tout de suite, et le panneau s'ouvre
           pour compléter le résultat de sa nouvelle action.
       ⌘Z défait le déplacement, sauf si le clip a été recodé depuis. Au
       clavier : le champ « Action » du panneau de codage ;
     - « Dupliquer » : une nouvelle séquence sur la même vidéo, même
       découpage, avec ou sans le codage, indépendante de l'original.
   ============================================================ */

const anLaneName = (k) => AN_LANES.find(([x]) => x === k)?.[1] ?? k;

/* « Résultat « Gagné » », « Type de duel « Interception » »… : ce qu'un déplacement retire. */
function anFieldText(clip, k) {
  const A = AN_ACTIONS[clip.action], d = [...(A ? [...A.filters, ...(A.more || [])] : []), ...AN_GENERAL].find(x => x.key === k);
  if (k === 'x2' || k === 'y2') return 'point d’arrivée';
  if (k === 'resultat' && A) return `résultat « ${anLabel(A.res, clip[k])} »`;
  return d ? `${d.label.toLowerCase()} « ${anLabel(d.values, clip[k])} »` : k;
}

async function anTlMove(clip, lane) {
  const to = lane === 'todo' ? null : lane, from = anLane(clip), where = anLaneName(lane);
  if (lane === from) return;
  const { code, lost } = anMoveCode(clip, to), before = anCodePayload(clip);
  if (lost.length) {   // rien n'est écrit : le panneau annonce ce qui partira, « Enregistrer » déplace
    AN.tl.pending = { id: clip.id, lane };
    anTlRender();
    return anOpenCoding({ ...clip, ...code }, { move: { before }, note: `Vers ${where} : ${[...new Set(lost.map(k => anFieldText(clip, k)))].join(', ')} ${
      lost.length > 1 ? 'seront retirés' : 'sera retiré'} (propre${lost.length > 1 ? 's' : ''} à ${anLaneName(from)}). Enregistrez pour confirmer ; « Annuler » laisse le clip dans ${anLaneName(from)}.` });
  }
  try {
    await anSaveCode(clip, { ...code, start_sec: clip.start_sec, end_sec: clip.end_sec });
    AN.tl.undo.push({ label: `déplacement vers ${where}`, move: { id: clip.id, before, after: anCodePayload(code) } });
    toast(`Clip déplacé vers ${where}.`);
  } catch (err) {
    toast(err.message, 'error');
  }
  await anReload();   // refus : le segment reprend sa piste
  const moved = AN.clips.find(c => c.id === clip.id);
  if (moved?.action === to && AN_ACTIONS[to]?.res.length) {
    anOpenCoding(moved, { note: `Déplacé vers ${where} et enregistré (⌘Z pour défaire). Complétez son résultat et ses champs si besoin.` });
  }
}

/* Défait un déplacement : seulement si le codage est toujours celui qu'il avait donné. Les tags posés depuis restent. */
async function anTlUndoMove({ id, before, after }) {
  await anReload();
  const c = AN.clips.find(x => x.id === id);
  if (!c || !anSameCode(c, after)) return toast('Déplacement laissé tel quel : le clip a été recodé depuis.', 'error');
  await anSaveCode(c, { ...before, tags: c.tags, start_sec: c.start_sec, end_sec: c.end_sec });
  toast(`Déplacement annulé : le clip revient dans ${anLaneName(before.action || 'todo')}.`);
}

/* Segment saisi (bouton gauche, sans touche) : un glissé vertical le dépose sur une autre piste.
   Un simple clic reste un clic (sélection, lecture). */
function anTlDrag(e, seg) {
  const tl = AN.tl, clip = AN.clips.find(c => c.id === Number(seg.dataset.seq)), y0 = e.clientY;
  const lanes = [...anDockEl('track').querySelectorAll('.an-tl-lane')];
  const laneAt = (y) => lanes.find(l => { const r = l.getBoundingClientRect(); return y >= r.top && y < r.bottom; }) || null;
  let started = false, target = null;
  const move = (ev) => {
    if (!started && Math.abs(ev.clientY - y0) < 8) return;
    started = true;
    seg.classList.add('is-drag');
    seg.style.transform = `translateY(${ev.clientY - y0}px)`;
    const l = laneAt(ev.clientY);
    if (l !== target) { target?.classList.remove('is-drop'); target = l; target?.classList.add('is-drop'); }
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    if (!started) return;
    tl.dragged = true;
    setTimeout(() => { tl.dragged = false; }, 0);   // le clic qui suit le lâcher n'est pas un clic
    target?.classList.remove('is-drop');
    seg.classList.remove('is-drag');
    seg.style.transform = '';
    if (clip && target) anTlMove(clip, target.dataset.lane);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up, { once: true });
}

/* Une copie par clip sélectionné ; les copies deviennent la sélection. */
async function anTlDuplicate(withCode) {
  const picked = AN.clips.filter(c => AN.tl.sel.has(c.id));
  if (!picked.length) return;
  const res = await Promise.allSettled(picked.map(c => anDuplicate(c, withCode)));
  const ids = res.filter(r => r.status === 'fulfilled').map(r => Number(r.value)), ko = res.find(r => r.status === 'rejected');
  if (ids.length) Object.assign(AN.tl, { sel: new Set(ids), cur: ids[0] });
  toast(ko ? `${ids.length} copie${ids.length > 1 ? 's' : ''} sur ${picked.length} : ${ko.reason.message}`
    : `${anPlural(ids.length, 'copie créée', 'copies créées')} (même vidéo, même découpage, ${withCode ? 'même codage' : 'à coder'}) : ${ids.length > 1 ? 'elles sont sélectionnées' : 'elle est sélectionnée'}.`,
  ko ? 'error' : 'success');
  await anReload();
}
