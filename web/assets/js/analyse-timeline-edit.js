/* ============================================================
   LMFC Performance — analyse-timeline-edit.js
   Gestes et opérations du panneau « Timeline / Codage vidéo »
   (le lecteur et le dessin sont dans analyse-timeline.js).
     - sélectionner : clic = ce clip (et le lire) ; ⌘ ou Ctrl + clic = ajouter
       ou retirer ; glisser dans le vide = rectangle (toutes les pistes = une
       plage de temps) ; ⌘A = tout ; Échap = rien. Double-clic = coder ;
     - rogner : tirer un bout de segment déplace le début ou la fin du clip,
       l'image suit le bord tiré, l'enregistrement se fait au lâcher ;
     - barre de la sélection : descripteurs (action et ses champs) posés sur
       plusieurs clips, tags ajoutés ou retirés ;
     - créer un clip (vue « Une vidéo ») : I, O, Entrée.
   Chaque écriture est une transaction (lmfc_v49.sql) et se défait (⌘Z) sans
   écraser ce qui a changé depuis.
   Raccourcis : seulement quand la timeline est au premier plan (dernier clic
   chez elle), sans fenêtre ouverte et sans champ de saisie sous le focus :
   taper dans une fenêtre de codage ne déclenche rien.
   ============================================================ */

/* Sélection : segments surlignés, barre d'actions (seulement s'il y a une sélection). */
function anTlSel() {
  const { sel } = AN.tl, bar = anDockEl('selbar');
  document.querySelectorAll('#anDock .an-tl-lane .an-seg').forEach(s => {
    const id = Number(s.dataset.seq), on = sel.has(id);
    s.classList.toggle('is-on', on); s.setAttribute('aria-pressed', on);
  });
  if (!bar) return;
  bar.hidden = !sel.size;
  bar.innerHTML = !sel.size ? '' : `<strong aria-live="polite">${anPlural(sel.size, 'séquence sélectionnée', 'séquences sélectionnées')}</strong>
    <button type="button" class="btn btn-sm btn-primary" data-tl="describe">Ajouter des descripteurs</button>
    <button type="button" class="btn btn-sm" data-tl="tag-add">Ajouter des tags</button>
    <button type="button" class="btn btn-sm" data-tl="tag-remove">Retirer des tags</button>
    <button type="button" class="btn btn-sm btn-ghost" data-tl="clear">Annuler la sélection</button>`;
}

/* ---------- Opérations : une transaction chacune, défaisable ---------- */

async function anTlBulk(ids, op, label) {
  try {
    const changes = await anBulk(ids, op);
    if (changes.length) AN.tl.undo.push({ label, changes });
    toast(changes.length ? `${label[0].toUpperCase()}${label.slice(1)} : ${anPlural(changes.length, 'séquence modifiée', 'séquences modifiées')} sur ${ids.length}.`
      : `Rien à changer : ${ids.length > 1 ? 'ces séquences avaient' : 'cette séquence avait'} déjà ces valeurs.`);
    await anReload();
    return true;
  } catch (err) {   // tout ou rien : aucune séquence n'a été modifiée
    toast(err.message.replace(/\([^)]*tags_check[^)]*\)/, '(20 tags au plus par clip)'), 'error');
    return false;
  }
}

/* Bord d'un clip lâché : le découpage est enregistré, le codage n'est pas touché. */
async function anTlSaveTrim(clip, next) {
  try {
    await anSaveTimes(clip, next);
    AN.tl.undo.push({ label: 'découpage', trim: { id: clip.id, before: { start_sec: clip.start_sec, end_sec: clip.end_sec }, after: next } });
    toast(`Clip rogné : ${fmtT(next.start_sec)} → ${fmtT(next.end_sec)} (${(next.end_sec - next.start_sec).toFixed(1).replace('.', ',')} s).`);
  } catch (err) {
    toast(err.message, 'error');
  }
  await anReload();   // en cas de refus, le segment reprend sa place
}

/* Défait la dernière opération. Groupée : la base ne remet que ce qui n'a pas changé depuis.
   Découpage : seulement si le clip a toujours celui que l'opération lui avait donné. */
async function anTlUndo() {
  const op = AN.tl.undo.pop();
  if (!op) return;
  try {
    if (op.trim) {
      await anReload();
      const { id, before, after } = op.trim, c = AN.clips.find(x => x.id === id);
      if (!c || c.start_sec !== after.start_sec || c.end_sec !== after.end_sec) return toast('Découpage laissé tel quel : le clip a été modifié depuis.', 'error');
      await anSaveTimes(c, before);
      toast('Découpage rétabli.');
    } else {
      const { restored, kept } = await anUndo(op.changes);
      toast(`Annulé (${op.label}) : ${anPlural(restored, 'séquence rétablie', 'séquences rétablies')}${kept
        ? `, ${kept} laissée${kept > 1 ? 's' : ''} telle${kept > 1 ? 's' : ''} quelle${kept > 1 ? 's' : ''} car modifiée${kept > 1 ? 's' : ''} depuis` : ''}.`);
    }
    await anReload();
  } catch (err) {
    AN.tl.undo.push(op);
    toast(err.message, 'error');
    anTlRender();
  }
}

function anTlCreate() {
  const tl = AN.tl, v = AN.videos.find(x => x.id === tl.video);
  if (tl.mode !== 'video') return;
  if (!v || tl.in == null || tl.out == null || tl.out - tl.in < 0.5) return toast('Marquez le début (I) puis la fin (O) du clip, à une demi-seconde au moins.', 'error');
  anVid().pause();
  anOpenCoding({ id: null, video_id: v.id, label: nextSeqLabel(AN.clips.filter(c => c.video_id === v.id)), video_title: v.titre, start_sec: tl.in, end_sec: tl.out, tags: [] });
}
/* Le clip vient d'être créé : les marques repartent de zéro, il est sélectionné et devient le clip en cours. */
function anTlCreated(id) { Object.assign(AN.tl, { in: null, out: null, sel: new Set([id]), cur: id }); }

function anTlMark(which) {
  const tl = AN.tl, t = anTlTime(tl.video);
  if (tl.mode !== 'video') return;
  if (t == null) return toast('La vidéo n’est pas chargée.', 'error');
  tl[which] = Math.round(t * 10) / 10;
  if (tl.in != null && tl.out != null && tl.out <= tl.in) tl[which === 'in' ? 'out' : 'in'] = null;   // marques croisées : on garde la dernière posée
  anTlMarks();
}

/* Clip précédent ou suivant de la timeline affichée. */
function anTlStep(d) {
  const items = anTlPlaced(), m = items[items.findIndex(x => x.c.id === AN.tl.cur) + d];
  if (m) { anTlGo(m.c); anTlSel(); }
}

/* ---------- Gestes ---------- */

function anTlClick(e) {
  const tl = AN.tl, b = e.target.closest('[data-tl]'), seg = e.target.closest('.an-tl-lane .an-seg');
  if (tl.dragged) { tl.dragged = false; return; }   // fin d'un rognage : ce n'est pas un clic
  if (seg) {   // clic : ce clip seul, et on le lit ; ⌘ ou Ctrl : l'ajouter ou le retirer
    const id = Number(seg.dataset.seq);
    if (e.metaKey || e.ctrlKey) { if (tl.sel.has(id)) tl.sel.delete(id); else tl.sel.add(id); }
    else { tl.sel = new Set([id]); anTlGo(AN.clips.find(c => c.id === id)); }
    return anTlSel();
  }
  if (!b || b.disabled) return;
  const act = b.dataset.tl, ids = [...tl.sel], picked = AN.clips.filter(c => tl.sel.has(c.id));
  if (act === 'toggle') tl.open = !tl.open;
  else if (act === 'mode') Object.assign(tl, { mode: b.dataset.value, in: null, out: null });
  else if (act === 'size') tl.big = !tl.big;
  else if (act === 'full') tl.full = !tl.full;
  else if (act === 'zoom') tl.zoom = AN_TL_ZOOMS[AN_TL_ZOOMS.indexOf(tl.zoom) + Number(b.dataset.value)] ?? tl.zoom;
  else if (act === 'step') return anTlStep(Number(b.dataset.value));
  else if (act === 'in' || act === 'out') return anTlMark(act);
  else if (act === 'create') return anTlCreate();
  else if (act === 'undo') return anTlUndo();
  else if (act === 'clear') { tl.sel.clear(); return anTlSel(); }
  else if (act === 'describe') return anOpenBulk(ids);
  else if (act === 'tag-add') return anLibOpen('add', { n: ids.length,
    onApply: (names) => anTlBulk(ids, { add: names }, anPlural(names.length, 'tag ajouté', 'tags ajoutés')) });
  else if (act === 'tag-remove') return anLibOpen('remove', { n: ids.length, only: [...new Set(picked.flatMap(c => c.tags))],
    onApply: (names) => anTlBulk(ids, { remove: names }, anPlural(names.length, 'tag retiré', 'tags retirés')) });
  anTlRender();
  if (act === 'full') document.getElementById('anDock').focus({ preventScroll: true });
}

async function anTlChange(e) {
  const t = e.target;
  if ('tlVideo' in t.dataset) { Object.assign(AN.tl, { video: Number(t.value), in: null, out: null }); return anTlRender(); }
  if (!t.dataset.anVideo) return;
  try { await anSaveVideo(Number(t.dataset.id), { [t.dataset.anVideo]: t.value || null }); } catch (err) { toast(err.message, 'error'); }
  await anReload();   // en cas de refus, le menu reprend la valeur enregistrée
}

/* Un bout de segment tiré : le clip est rogné. L'image suit le bord, le découpage part au lâcher. */
function anTlTrim(e, handle) {
  const tl = AN.tl, seg = handle.closest('.an-seg'), edge = handle.dataset.trim, clip = AN.clips.find(c => c.id === Number(seg.dataset.seq));
  const pps = anDockEl('track').getBoundingClientRect().width / anTlDur(), x0 = e.clientX, left = seg.offsetLeft;
  let next = null;
  e.preventDefault();
  tl.trim = true;
  anTlGo(clip, edge === 'start' ? 0 : clip.end_sec - clip.start_sec);
  const move = (ev) => {
    const max = tl.loaded === clip.video_id && tl.dur ? tl.dur : Infinity;
    next = anTrim(clip, edge, (edge === 'start' ? clip.start_sec : clip.end_sec) + (ev.clientX - x0) / pps, max);
    seg.style.left = `${left + (next.start_sec - clip.start_sec) * pps}px`;
    seg.style.width = `${(next.end_sec - next.start_sec) * pps}px`;
    seg.querySelector('.an-seg-t').textContent = `${fmtT(next.start_sec)} → ${fmtT(next.end_sec)}`;
    if (anTlTime(clip.video_id) != null) anVid().currentTime = next[edge === 'start' ? 'start_sec' : 'end_sec'];
  };
  const up = () => {
    seg.removeEventListener('pointermove', move);
    tl.trim = false; tl.dragged = true;
    setTimeout(() => { tl.dragged = false; }, 0);   // le clic qui suit le lâcher est ignoré, pas le suivant
    if (!next || (next.start_sec === clip.start_sec && next.end_sec === clip.end_sec)) return anTlRender();
    anTlSaveTrim(clip, next);
  };
  seg.setPointerCapture(e.pointerId);
  seg.addEventListener('pointermove', move);
  seg.addEventListener('pointerup', up, { once: true });
}

/* Dans le vide de la timeline : un clic déplace la lecture, un glissé trace un rectangle de sélection. */
function anTlDown(e) {
  if (!e.target.closest('button, select, input, video, a')) e.currentTarget.focus({ preventScroll: true });   // raccourcis actifs
  const handle = e.target.closest('[data-trim]'), track = e.target.closest('[data-el="track"]');
  if (handle && !e.button) return anTlTrim(e, handle);
  if (!track || e.button || e.target.closest('.an-seg')) return;
  const tl = AN.tl, items = anTlPlaced(), r = track.getBoundingClientRect(), band = anDockEl('band'), add = e.metaKey || e.ctrlKey, x0 = e.clientX, y0 = e.clientY;
  const tAt = (x) => Math.min(1, Math.max(0, (x - r.left) / r.width)) * anTlDur();
  const moved = (ev) => Math.abs(ev.clientX - x0) > 4 || Math.abs(ev.clientY - y0) > 4;
  const move = (ev) => {
    band.hidden = !moved(ev);
    Object.assign(band.style, { left: `${Math.min(x0, ev.clientX) - r.left}px`, top: `${Math.min(y0, ev.clientY) - r.top}px`,
      width: `${Math.abs(ev.clientX - x0)}px`, height: `${Math.abs(ev.clientY - y0)}px` });
  };
  const up = (ev) => {
    track.removeEventListener('pointermove', move);
    band.hidden = true;
    if (moved(ev)) {
      const top = Math.min(y0, ev.clientY), bottom = Math.max(y0, ev.clientY);
      const lanes = [...track.querySelectorAll('.an-tl-lane')].filter(l => { const b = l.getBoundingClientRect(); return b.bottom > top && b.top < bottom; }).map(l => l.dataset.lane);
      const ids = anInRect(items.map(m => ({ id: m.c.id, action: m.c.action, start_sec: m.at, end_sec: m.at + m.dur })), tAt(x0), tAt(ev.clientX), lanes);
      tl.sel = new Set(add ? [...tl.sel, ...ids] : ids);
    } else {
      const t = tAt(x0), m = items.find(x => t >= x.at && t < x.at + x.dur);
      if (tl.mode === 'all') { if (m) anTlGo(m.c, t - m.at); } else if (anTlTime() != null) anVid().currentTime = t;
      if (!add) tl.sel.clear();
    }
    anTlSel();
  };
  track.setPointerCapture(e.pointerId);
  track.addEventListener('pointermove', move);
  track.addEventListener('pointerup', up, { once: true });
}

function anTlKey(e) {
  const tl = AN.tl, vid = anVid(), mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase(), onButton = !!e.target.closest?.('button');
  const dock = document.getElementById('anDock'), focus = document.activeElement;
  if (!tl.open || !tl.front || e.altKey || document.querySelector('.modal-backdrop.open')) return;
  if (e.target.closest?.('input, select, textarea, [contenteditable]') || (focus && focus !== document.body && !dock.contains(focus))) return;
  if (mod && k === 'a') { tl.sel = new Set(anTlPlaced().map(m => m.c.id)); anTlSel(); }
  else if (mod && k === 'z') anTlUndo();
  else if (mod) return;
  else if (k === 'escape') { if (tl.sel.size) { tl.sel.clear(); anTlSel(); } else if (tl.full) { tl.full = false; anTlRender(); } else return; }
  else if (k === 'i' && tl.mode === 'video') anTlMark('in');
  else if (k === 'o' && tl.mode === 'video') anTlMark('out');
  else if (k === 'enter' && !onButton && tl.mode === 'video') anTlCreate();
  else if (e.target === vid || anTlTime() == null) return;   // le lecteur gère lui-même Espace et les flèches
  else if (k === ' ' && !onButton) { if (vid.paused) vid.play(); else vid.pause(); }
  else if (k === 'arrowleft' || k === 'arrowright') vid.currentTime += (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 10 : 2);
  else return;
  e.preventDefault();
}
