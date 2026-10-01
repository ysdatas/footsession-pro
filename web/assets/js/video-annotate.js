/* ============================================================
   FootSession Pro — video-annotate.js
   Habillage d'une séquence, directement sur la vidéo :
   pause → outil → dessin → « Enregistrer » → reprise.
   Interface minimale : les couleurs n'apparaissent que pour l'outil
   choisi ; toucher un élément déjà posé (outil « Choisir ») fait
   apparaître SES réglages (couleur, texte, suppression) et permet
   de le déplacer. Chaque annotation a un instant, une durée
   d'affichage et, au choix, un arrêt sur image.
   Utilisé par video-workspace.js : createAnnotator(ws).
   ============================================================ */

function createAnnotator(ws) {
  const box = ws.$w('[data-el="annot"]');
  box.innerHTML = `
    <div class="vw-drawbar hidden" role="toolbar" aria-label="Habiller la séquence">
      <div class="vw-draw-row vw-draw-head">
        <strong class="vw-draw-at" data-el="drawAt"></strong>
        <span class="vw-spacer"></span>
        <button class="vw-ctl" type="button" data-a="undo" aria-label="Défaire" title="Défaire" disabled>${vwIc('undo')}</button>
        <button class="vw-ctl" type="button" data-a="redo" aria-label="Refaire" title="Refaire" disabled>${vwIc('redo')}</button>
      </div>
      <div class="vw-draw-row vw-tools" role="radiogroup" aria-label="Outil">
        ${INK_TOOLS.map(([k, label]) => `<button type="button" data-tool="${k}" role="radio" aria-checked="false" title="${label}">${vwIc(k)}<span>${label}</span></button>`).join('')}
      </div>
      <div class="vw-draw-row vw-draw-ctx" data-el="ctx"></div>
      <div class="vw-draw-row">
        <span class="vw-draw-label">Visible</span>
        <div class="vw-seg" role="radiogroup" aria-label="Durée d’affichage">
          ${[2, 3, 5].map(d => `<button type="button" data-dur="${d}">${d} s</button>`).join('')}
        </div>
        <label class="vw-freeze"><input type="checkbox" data-el="freeze"> Arrêt sur image</label>
      </div>
      <div class="vw-draw-row vw-draw-foot">
        <button class="btn" type="button" data-a="cancel">${vwIc('x')}<span>Fermer</span></button>
        <button class="btn btn-primary" type="button" data-a="save">${vwIc('check')}<span>Enregistrer</span></button>
      </div>
    </div>`;
  const bar = box.firstElementChild;
  const $b = (s) => bar.querySelector(s);
  const st = { a: null, tool: 'arrow', color: INK_COLORS[0], size: 'body', selected: null, timingDirty: false, saving: false };
  let commitText = null;

  const colorsHtml = (current, attr) => `<div class="vw-inkcolors" role="radiogroup" aria-label="Couleur">${INK_COLORS.map((c, i) =>
    `<button type="button" ${attr}="${c}" class="${c === current ? 'on' : ''}" style="background:${c}" aria-label="Couleur ${i + 1}"></button>`).join('')}</div>`;
  function renderCtx() {
    const ctx = $b('[data-el="ctx"]'), s = st.selected;
    if (s) {
      ctx.innerHTML = `<span class="vw-ctx-label">${escapeHtml(INK_NAMES[s.type] || 'Élément')}</span>
        ${s.type !== 'spot' ? colorsHtml(s.color, 'data-recolor') : ''}
        ${s.type === 'text' || s.type === 'marker' ? `<button class="btn btn-sm" type="button" data-a="retext">${s.type === 'marker' ? 'N° / nom' : 'Texte'}</button>` : ''}
        <button class="btn btn-sm btn-danger" type="button" data-a="delete">${vwIc('trash')}Supprimer</button>`;
    } else if (st.tool === 'select') {
      ctx.innerHTML = `<span class="vw-muted">${ws.tu('Touche', 'Touchez')} un élément pour le modifier ou le déplacer.</span>`;
    } else {
      const hint = { spot: ws.tu('Entoure le joueur à mettre en lumière.', 'Entourez le joueur à mettre en lumière.'),
        marker: ws.tu('Touche les pieds du joueur.', 'Touchez les pieds du joueur.'),
        text: ws.tu('Touche l’image à l’endroit du texte.', 'Touchez l’image à l’endroit du texte.') }[st.tool];
      ctx.innerHTML = (st.tool === 'spot' ? '' : colorsHtml(st.color, 'data-color'))
        + (st.tool === 'text' ? `<div class="vw-seg" role="radiogroup" aria-label="Taille du texte">
            <button type="button" data-size="title" class="${st.size === 'title' ? 'on' : ''}">Titre</button>
            <button type="button" data-size="body" class="${st.size === 'body' ? 'on' : ''}">Texte</button></div>` : '')
        + (hint ? `<span class="vw-muted">${hint}</span>` : '');
    }
  }
  function setTool(t) {
    st.tool = t; st.selected = null;
    ws.ink.setTool(t);
    bar.querySelectorAll('[data-tool]').forEach(b => { const on = b.dataset.tool === t; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    renderCtx();
  }
  function sync() {
    if (!st.a) return;
    $b('[data-a="undo"]').disabled = !ws.ink.canUndo;
    $b('[data-a="redo"]').disabled = !ws.ink.canRedo;
    bar.querySelectorAll('[data-dur]').forEach(b => b.classList.toggle('on', Number(b.dataset.dur) === st.a.d));
    $b('[data-el="freeze"]').checked = st.a.freeze;
    const r = ws.range();
    $b('[data-el="drawAt"]').textContent = `Annotation à ${fmtT(st.a.t - (r?.start || 0))}`;
  }

  function start(frame = null) {
    const r = ws.range(); if (!r) return;
    const t = frame ? frame.t : Math.min(Math.max(round2(ws.vid.currentTime), r.start), r.end - .05);
    st.a = { t, d: frame ? frame.d : 3, freeze: frame ? frame.freeze : true, editing: frame ? frame.t : null };
    st.timingDirty = false; st.selected = null; st.saving = false;
    if (Math.abs(ws.vid.currentTime - t) > .01) ws.vid.currentTime = t;
    ws.ink.setShapes(frame ? frame.shapes : []); ws.ink.fit(); ws.ink.show(true); ws.ink.setEditable(true);
    ws.ink.setColor(st.color); ws.ink.setTextSize(st.size);
    setTool(frame && frame.shapes.length ? 'select' : 'arrow');
    bar.classList.remove('hidden');
    ws.root.firstElementChild.classList.add('is-annotating');
    sync();
    ws.$w('[data-el="stage"]').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function stop() {
    st.a = null; st.selected = null;
    if (commitText) { const ct = commitText; commitText = null; ct(true); }
    ws.ink.setEditable(false);
    bar.classList.add('hidden');
    ws.root.firstElementChild.classList.remove('is-annotating');
    ws.$w('[data-el="textin"]').classList.add('hidden');
  }
  async function save() {
    const s = ws.cur(), a = st.a; if (!s || !a || st.saving) return;
    commitText?.();
    st.saving = true;
    const btn = $b('[data-a="save"]'); btn.disabled = true;
    const shapes = ws.ink.shapes.map(x => ({ ...x }));
    const others = (s.drawings || []).filter(f => (a.editing === null ? Math.abs(f.t - a.t) >= .15 : f.t !== a.editing));
    const next = [...others, ...(shapes.length ? [{ t: a.t, d: a.d, freeze: a.freeze, shapes }] : [])].sort((x, y) => x.t - y.t);
    const ok = await ws.run(ws.opFrames(s, next, shapes.length ? 'annotation enregistrée' : 'annotation retirée'));
    st.saving = false; btn.disabled = false;
    if (!ok) return;   // l'erreur est affichée ; l'annotation reste ouverte, rien n'est perdu
    st.a = null;
    toast(shapes.length ? 'Annotation enregistrée : elle s’affichera pendant la lecture.' : 'Annotation retirée.', 'success');
    ws.leave();
  }
  function cancel() {
    if ((ws.ink.dirty || st.timingDirty) && !confirm('Quitter sans enregistrer cette annotation ?')) return;
    st.a = null;
    ws.leave();
  }

  /* Texte et étiquette de repère : un champ posé à l'endroit touché. Le
     focus est donné après le geste, sinon le navigateur le reprendrait. */
  function askText(p, kind, initial = '') {
    commitText?.();
    const input = ws.$w('[data-el="textin"]'), stage = ws.$w('[data-el="stage"]').getBoundingClientRect();
    const c = ws.ink.toClient(p);
    input.style.left = `${Math.min(Math.max(8, c.x - stage.left - 90), stage.width - 188)}px`;
    input.style.top = `${Math.min(Math.max(8, c.y - stage.top - 20), stage.height - 48)}px`;
    input.placeholder = kind === 'marker' ? 'N° ou nom (facultatif)' : ws.tu('Tape ton texte', 'Tapez le texte');
    input.value = initial;
    input.classList.remove('hidden');
    commitText = (discard = false) => {
      commitText = null;
      input.onblur = input.onkeydown = null;
      input.classList.add('hidden');
      const v = input.value.trim();
      if (discard) return;
      if (kind === 'retext') { if (v) ws.ink.retextSelected(v); }
      else if (kind === 'marker') ws.ink.labelLast(v);
      else ws.ink.addText(p, v);
    };
    setTimeout(() => { input.focus(); input.onblur = () => commitText?.(); }, 0);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitText?.(); }
      if (e.key === 'Escape') { e.preventDefault(); commitText?.(true); }
    };
  }

  bar.addEventListener('click', (e) => {
    const tool = e.target.closest('[data-tool]');
    if (tool) return setTool(tool.dataset.tool);
    const color = e.target.closest('[data-color]');
    if (color) { st.color = color.dataset.color; ws.ink.setColor(st.color); return renderCtx(); }
    const recolor = e.target.closest('[data-recolor]');
    if (recolor) return ws.ink.recolorSelected(recolor.dataset.recolor);
    const size = e.target.closest('[data-size]');
    if (size) { st.size = size.dataset.size; ws.ink.setTextSize(st.size); return renderCtx(); }
    const dur = e.target.closest('[data-dur]');
    if (dur && st.a) { st.a.d = Number(dur.dataset.dur); st.timingDirty = true; return sync(); }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'undo') return ws.ink.undo();
    if (a === 'redo') return ws.ink.redo();
    if (a === 'delete') return ws.ink.deleteSelected();
    if (a === 'retext' && st.selected) {
      const pt = ws.ink.selectedPoint();
      return askText(pt || { x: .5, y: .5 }, 'retext', st.selected.type === 'marker' ? st.selected.label || '' : st.selected.text || '');
    }
    if (a === 'save') return save();
    if (a === 'cancel') return cancel();
  });
  bar.addEventListener('change', (e) => {
    if (e.target.matches('[data-el="freeze"]') && st.a) { st.a.freeze = e.target.checked; st.timingDirty = true; }
  });
  // Rechargement ou fermeture de l'onglet avec une annotation en cours.
  window.addEventListener('beforeunload', (e) => { if (st.a && (ws.ink.dirty || st.timingDirty)) e.preventDefault(); });

  return {
    start, stop, save, cancel, askText, sync,
    onSelect(shape) { st.selected = shape; renderCtx(); },
    get dirty() { return !!st.a && (ws.ink.dirty || st.timingDirty); },
  };
}
