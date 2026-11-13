/* ============================================================
   LMFC Performance — analyse-timeline-move.js
   Timeline / Codage vidéo : changer un clip de piste, le copier.
     - glisser un segment vers une autre piste change son action, tout de
       suite ; le minutage ne bouge pas. Rien n'est converti (anMoveCode) :
       ce que la nouvelle action ne porte pas part (le « Gagné » d'un duel ne
       devient pas le « Réussi » d'un centre), un avis court le dit, ⌘Z rend tout ;
     - ⌥ (Alt sous Windows) + glisser : une copie, posée où on la lâche.
       Autre piste : son action suit la piste (mêmes règles). Vue « Une
       vidéo » : elle peut aussi glisser dans le temps, même durée. Bouton
       « Dupliquer » : même chose, sur place. L'original n'est jamais touché ;
       ⌘Z retire la copie (corbeille), sauf si elle a été recodée depuis.
   Une copie est une nouvelle séquence sur la même vidéo (le fichier n'est
   pas copié), réservée au staff, avec son propre identifiant.
   ============================================================ */

const anLaneName = (k) => AN_LANES.find(([x]) => x === k)?.[1] ?? k;
const anRound = (t) => Math.round(t * 100) / 100;
const AN_UNSAVED = 'Séquence ouverte non enregistrée : réessayez ou annulez ses modifications.';

async function anTlMove(clip, lane) {
  const to = lane === 'todo' ? null : lane, where = anLaneName(lane);
  if (lane === anLane(clip)) return;
  if (!await anCodeFlush()) return toast(AN_UNSAVED, 'error');
  clip = AN.clips.find(c => c.id === clip.id);   // avec ce qui vient d'être enregistré
  const { code, lost } = anMoveCode(clip, to), before = anCodePayload(clip), n = lost.filter(k => k !== 'y2').length;
  try {
    await anSaveCode(clip, { ...code, start_sec: clip.start_sec, end_sec: clip.end_sec });
    AN.tl.undo.push({ label: `déplacement vers ${where}`, move: { id: clip.id, before, after: anCodePayload(code) } });
    toast(`Déplacé vers ${where}${n ? ` · ${anPlural(n, 'champ retiré', 'champs retirés')}` : ''} · ⌘Z pour annuler`);
  } catch (err) {
    toast(err.message, 'error');
  }
  await anReload();   // refus : le segment reprend sa piste
  anTlPick(clip.id, true);
}

/* Défait un déplacement (ou un changement d'action) : seulement si le codage est toujours celui qu'il avait donné. */
async function anTlUndoMove({ id, before, after }) {
  await anReload();
  const c = AN.clips.find(x => x.id === id);
  if (!c || !anSameCode(c, after)) return toast('Laissé tel quel : la séquence a été recodée depuis.', 'error');
  await anSaveCode(c, { ...before, tags: c.tags, start_sec: c.start_sec, end_sec: c.end_sec });
  toast(`Annulé : la séquence revient dans ${anLaneName(before.action || 'todo')}.`);
}

/* Séquences créées ici (copie, clip marqué I / O) : ⌘Z les retire, sauf celles recodées depuis. */
function anTlCreatedUndo(label, items) { AN.tl.undo.push({ label, created: items }); }
async function anTlUndoCreated(items) {
  await anReload();
  const ids = items.filter(x => { const c = AN.clips.find(y => y.id === x.id); return c && anSameCode(c, x.code); }).map(x => x.id);
  const n = ids.length ? await anDeleteClips(ids) : 0;
  toast(n === items.length ? `Annulé : ${anPlural(n, 'séquence retirée', 'séquences retirées')}.`
    : `${anPlural(n, 'séquence retirée', 'séquences retirées')} ; ${items.length - n} laissée${items.length - n > 1 ? 's' : ''} car recodée${items.length - n > 1 ? 's' : ''} depuis.`, n ? '' : 'error');
}

/* Segment saisi (bouton gauche, sans ⌘ ni Maj). Vertical : autre piste. ⌥ : une copie, qui suit la souris. */
function anTlDrag(e, seg) {
  const tl = AN.tl, clip = AN.clips.find(c => c.id === Number(seg.dataset.seq)), x0 = e.clientX, y0 = e.clientY, copy = e.altKey;
  const lanes = [...anDockEl('track').querySelectorAll('.an-tl-lane')];
  const laneAt = (y) => lanes.find(l => { const r = l.getBoundingClientRect(); return y >= r.top && y < r.bottom; }) || null;
  const pps = anDockEl('track').getBoundingClientRect().width / anTlDur(), free = copy && tl.mode === 'video';
  const max = tl.loaded === clip?.video_id && tl.dur ? tl.dur : Infinity, len = clip ? clip.end_sec - clip.start_sec : 0;
  let started = false, target = null, ghost = null, dt = 0;
  if (copy) e.preventDefault();   // ⌥ : pas de sélection de texte
  const move = (ev) => {
    const dx = ev.clientX - x0, dy = ev.clientY - y0;
    if (!started && Math.abs(dy) < 8 && !(free && Math.abs(dx) >= 8)) return;
    if (!started) {
      started = true;
      ghost = copy ? seg.parentNode.appendChild(seg.cloneNode(true)) : seg;
      ghost.classList.add('is-drag');
      if (copy) ghost.classList.add('is-copy');
    }
    if (free) dt = anRound(Math.min(Math.max(0, clip.start_sec + dx / pps), Math.max(0, max - len))) - clip.start_sec;
    ghost.style.transform = `translate(${dt * pps}px, ${dy}px)`;
    if (free) ghost.querySelector('.an-seg-t').textContent = `${fmtT(clip.start_sec + dt)} → ${fmtT(clip.end_sec + dt)}`;
    const l = laneAt(ev.clientY);
    if (l !== target) { target?.classList.remove('is-drop'); target = l; target?.classList.add('is-drop'); }
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    if (!started || !clip) return;
    tl.dragged = true;
    setTimeout(() => { tl.dragged = false; }, 0);   // le clic qui suit le lâcher n'est pas un clic
    target?.classList.remove('is-drop');
    if (copy) ghost.remove(); else { seg.classList.remove('is-drag'); seg.style.transform = ''; }
    const lane = target?.dataset.lane ?? anLane(clip);
    if (copy) anTlCopy(clip, lane, dt); else if (target) anTlMove(clip, lane);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up, { once: true });
}

/* Copie posée sur une piste (celle de l'original ou une autre), décalée de dt secondes dans sa vidéo. */
async function anTlCopy(clip, lane, dt = 0) {
  if (!await anCodeFlush()) return toast(AN_UNSAVED, 'error');
  clip = AN.clips.find(c => c.id === clip.id);
  const code = anCodePayload(lane === anLane(clip) ? clip : anMoveCode(clip, lane === 'todo' ? null : lane).code);
  try {
    const id = Number(await anDuplicate(clip, true, { start_sec: anRound(clip.start_sec + dt), end_sec: anRound(clip.end_sec + dt), code }));
    anTlCreatedUndo('copie', [{ id, code }]);
    toast(`Copie créée${lane === anLane(clip) ? '' : ` dans ${anLaneName(lane)}`} · ⌘Z pour annuler`);
    await anReload();
    anTlPick(id, true);
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* Bouton « Dupliquer » : une copie de chaque clip sélectionné, sur place ; les copies deviennent la sélection. */
async function anTlDuplicate(withCode) {
  if (!await anCodeFlush()) return toast(AN_UNSAVED, 'error');
  const picked = AN.clips.filter(c => AN.tl.sel.has(c.id));
  if (!picked.length) return;
  const res = await Promise.allSettled(picked.map(c => anDuplicate(c, withCode)));
  const made = res.map((r, i) => r.status === 'fulfilled' && { id: Number(r.value), code: anCodePayload(withCode ? picked[i] : { tags: [] }) }).filter(Boolean);
  const ko = res.find(r => r.status === 'rejected');
  if (made.length) anTlCreatedUndo(anPlural(made.length, 'copie'), made);
  toast(ko ? `${made.length} copie${made.length > 1 ? 's' : ''} sur ${picked.length} : ${ko.reason.message}` : `${anPlural(made.length, 'copie créée', 'copies créées')} · ⌘Z pour annuler`,
    ko ? 'error' : 'success');
  await anReload();
  if (made.length === 1) return anTlPick(made[0].id, true);
  AN.tl.sel = new Set(made.map(x => x.id));
  anTlSel();
  anTlFollowSel();
}
