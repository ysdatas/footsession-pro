/* ============================================================
   FootSession Pro — video-workspace.js
   Poste de travail d'une vidéo, commun au joueur et au staff :
     vidéo → séquences → analyse du joueur → retour du staff.
   - Staff et joueur découpent la vidéo en séquences
     (« Séquence 1 – Jean », « Séquence 2 – Jean »…).
   - Le joueur choisit celles qu'il veut travailler, dessine sur
     l'image (video-ink.js), écrit ce qu'il voit, puis envoie.
   - Le staff consulte et répond.
   La RLS et le trigger guard_video_sequence (platform_v2.sql)
   garantissent que chacun n'écrit que sa part.

   mountVideoWorkspace(root, { video, src, player, mode: 'player'|'staff',
                               userId, focusSeq, onChange })
   ============================================================ */

const fmtT = (sec) => {
  sec = Math.max(0, Number(sec) || 0);
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
};
const hasWork = (s) => (s.drawings || []).length > 0 || !!(s.player_note || '').trim();

async function mountVideoWorkspace(root, { video, src, player, mode, userId, focusSeq = null, onChange = null }) {
  const staff = mode === 'staff';
  const w = { seqs: [], cur: null, cutStart: null, annotating: false, stopAt: null };
  const firstName = player?.prenom || player?.nom || 'Joueur';

  root.innerHTML = `
    <div class="vw">
      <div class="vw-main">
        <div class="vw-stage">
          <video id="playerVideo" controls playsinline preload="metadata" src="${escapeHtml(src)}"></video>
          <canvas class="vw-ink hidden"></canvas>
        </div>
        <div class="vw-bar" data-el="cutbar">
          <button class="btn btn-sm" type="button" data-act="cut">✂ Début de séquence</button>
          <button class="btn btn-sm hidden" type="button" data-act="cut-cancel">Annuler</button>
          <span class="vw-bar-hint" data-el="cutHint">Mettez la vidéo au début d’une action, puis cliquez.</span>
          <span class="vw-spacer"></span>
          <button class="btn btn-sm" type="button" data-act="undo" title="Annuler la dernière opération" aria-label="Annuler" disabled>↶</button>
          <button class="btn btn-sm" type="button" data-act="redo" title="Rétablir" aria-label="Rétablir" disabled>↷</button>
        </div>
        <div class="vw-bar vw-drawbar hidden" data-el="drawbar">
          <div class="vw-seg" role="group" aria-label="Outil">
            ${INK_TOOLS.map(([k, ico, label], i) => `<button type="button" data-tool="${k}" class="${i ? '' : 'on'}" title="${label}" aria-label="${label}">${ico}</button>`).join('')}
          </div>
          <div class="vw-inkcolors" role="group" aria-label="Couleur">
            ${INK_COLORS.map((c, i) => `<button type="button" data-ink-color="${c}" class="${i ? '' : 'on'}" style="background:${c}" aria-label="Couleur ${i + 1}"></button>`).join('')}
          </div>
          <button class="btn btn-sm" type="button" data-act="ink-undo" title="Retirer le dernier tracé">↶</button>
          <button class="btn btn-sm" type="button" data-act="ink-clear">Effacer</button>
          <span class="vw-spacer"></span>
          <button class="btn btn-sm" type="button" data-act="ink-cancel">Annuler</button>
          <button class="btn btn-sm btn-primary" type="button" data-act="ink-save">Enregistrer l’image</button>
        </div>
      </div>
      <aside class="vw-side">
        <h3 class="vw-title">Séquences <span data-el="count"></span></h3>
        <p class="vw-hint">${staff
          ? 'Découpez la vidéo en séquences. Le joueur choisit celles à travailler, les annote et vous les envoie.'
          : 'Choisis les séquences à travailler, dessine sur l’image, écris ce que tu vois, puis envoie à ton staff.'}</p>
        <div class="vw-seqs" data-el="list"></div>
        <div class="vw-detail" data-el="detail"></div>
      </aside>
    </div>`;

  const $w = (sel) => root.querySelector(sel);
  const vid = $w('video');
  const ink = createInk(vid, $w('.vw-ink'));
  const cur = () => w.seqs.find(s => s.id === w.cur) || null;
  const canDelete = (s) => staff || s.created_by === userId;

  const { data, error } = await sb.from('video_sequences').select('*').eq('video_id', video.id).order('start_sec');
  if (error) {
    console.error('Séquences illisibles', error);
    $w('[data-el="list"]').innerHTML = `<p class="text-danger vw-hint">${/video_sequences/.test(error.message)
      ? 'Base à mettre à jour : exécutez supabase/platform_v2.sql.' : escapeHtml(error.message)}</p>`;
    $w('[data-el="cutbar"]').classList.add('hidden');
    return;
  }
  w.seqs = data || [];

  /* ---------- Rendu ---------- */
  function render() {
    w.seqs.sort((a, b) => a.start_sec - b.start_sec || a.id - b.id);
    $w('[data-el="count"]').textContent = w.seqs.length ? `(${w.seqs.length})` : '';
    $w('[data-el="list"]').innerHTML = w.seqs.length ? w.seqs.map(s => `
      <button type="button" class="vw-seq${s.id === w.cur ? ' is-current' : ''}" data-seq="${s.id}">
        <span class="vw-seq-name">${escapeHtml(s.label || 'Séquence')}</span>
        <span class="vw-seq-time">${fmtT(s.start_sec)} – ${fmtT(s.end_sec)}</span>
        <span class="vw-flags">
          ${s.selected ? '<span class="vw-flag is-gold">À travailler</span>' : ''}
          ${hasWork(s) ? '<span class="vw-flag">Annotée</span>' : ''}
          ${s.submitted_at ? '<span class="vw-flag is-ok">Envoyée</span>' : ''}
          ${s.staff_feedback ? '<span class="vw-flag is-ok">Retour</span>' : ''}
        </span>
      </button>`).join('')
      : `<p class="vw-empty">Aucune séquence pour l’instant. Utilisez « ✂ Début de séquence » sous la vidéo.</p>`;
    renderDetail();
  }

  function renderDetail() {
    const s = cur(), box = $w('[data-el="detail"]');
    if (!s) { box.innerHTML = ''; return; }
    const frames = s.drawings || [];
    box.innerHTML = `
      <div class="vw-detail-head">
        <input type="text" data-el="label" value="${escapeHtml(s.label || '')}" aria-label="Nom de la séquence">
        <button class="btn btn-sm" type="button" data-act="replay">▶ Revoir</button>
        ${canDelete(s) ? '<button class="btn btn-sm btn-danger" type="button" data-act="del" aria-label="Supprimer la séquence">✕</button>' : ''}
      </div>
      <div class="vw-edit" role="toolbar" aria-label="Montage de la séquence">
        <button class="btn btn-sm" type="button" data-act="trim-start" title="La séquence commence à l’image affichée">⇤ Début ici</button>
        <button class="btn btn-sm" type="button" data-act="trim-end" title="La séquence finit à l’image affichée">Fin ici ⇥</button>
        <button class="btn btn-sm" type="button" data-act="split" title="Couper en deux séquences à l’image affichée">✂ Couper ici</button>
        <button class="btn btn-sm" type="button" data-act="dup" title="Créer une copie à modifier">⧉ Dupliquer</button>
      </div>
      ${staff ? '' : `<label class="vw-check"><input type="checkbox" data-act="select" ${s.selected ? 'checked' : ''}> Je veux travailler cette séquence</label>`}
      <div class="vw-block">
        <div class="vw-block-title">Images annotées</div>
        <div class="vw-frames">${frames.length ? frames.map((f, i) => `
          <span class="vw-frame"><button type="button" data-frame="${i}">Image à ${fmtT(f.t)}</button>${staff ? '' : `<button type="button" class="vw-frame-x" data-frame-del="${i}" aria-label="Retirer cette image">✕</button>`}</span>`).join('')
          : `<span class="vw-muted">${staff ? 'Aucune image annotée par le joueur.' : 'Aucune pour l’instant.'}</span>`}</div>
        ${staff ? '' : '<button class="btn btn-sm" type="button" data-act="annotate">✎ Dessiner sur l’image affichée</button>'}
      </div>
      <div class="vw-block">
        <div class="vw-block-title">${staff ? 'Analyse du joueur' : 'Mon analyse'}</div>
        ${staff
          ? `<p class="vw-note">${s.player_note ? escapeHtml(s.player_note).replace(/\n/g, '<br>') : '<span class="vw-muted">Pas encore de commentaire.</span>'}</p>`
          : `<textarea rows="3" data-el="note" placeholder="Ce que tu vois, ce que tu aurais pu faire…">${escapeHtml(s.player_note || '')}</textarea>`}
        ${s.submitted_at ? `<p class="vw-muted">Envoyée au staff le ${escapeHtml(new Date(s.submitted_at).toLocaleString('fr-FR'))}</p>` : ''}
        ${staff ? '' : `<button class="btn btn-sm btn-primary" type="button" data-act="send">${s.submitted_at ? 'Renvoyer au staff' : 'Envoyer au staff'}</button>`}
      </div>
      <div class="vw-block">
        <div class="vw-block-title">Retour du staff</div>
        ${staff
          ? `<textarea rows="3" data-el="feedback" placeholder="Votre retour au joueur…">${escapeHtml(s.staff_feedback || '')}</textarea>
             <button class="btn btn-sm btn-primary" type="button" data-act="feedback">Envoyer mon retour</button>`
          : `<p class="vw-note">${s.staff_feedback ? escapeHtml(s.staff_feedback).replace(/\n/g, '<br>') : '<span class="vw-muted">Pas encore de retour.</span>'}</p>`}
      </div>`;
  }

  /* ---------- Lecture ---------- */
  function play(s) {
    ink.show(false);
    vid.currentTime = Number(s.start_sec);
    w.stopAt = Number(s.end_sec);
    vid.play().catch(() => {});
  }
  vid.addEventListener('timeupdate', () => {
    if (w.stopAt !== null && vid.currentTime >= w.stopAt) { vid.pause(); w.stopAt = null; }
  });
  vid.addEventListener('play', () => {
    if (w.annotating) stopAnnotating();
    ink.show(false);
  });
  function showFrame(f) {
    w.stopAt = null;
    vid.pause();
    vid.currentTime = Number(f.t);
    ink.setShapes(f.shapes);
    ink.fit();
    ink.show(true);
  }

  /* ---------- Historique : chaque opération de montage se défait ---------- */
  const hist = { undo: [], redo: [] };
  const syncHist = () => {
    $w('[data-act="undo"]').disabled = !hist.undo.length;
    $w('[data-act="redo"]').disabled = !hist.redo.length;
  };
  async function run(op) {
    if (!(await op.do())) return;
    hist.undo.push(op); hist.redo = []; syncHist();
  }
  async function undoOp() {
    const op = hist.undo.pop(); if (!op) return;
    if (await op.undo()) { hist.redo.push(op); toast(`Annulé : ${op.label}`, 'success'); } else hist.undo.push(op);
    syncHist();
  }
  async function redoOp() {
    const op = hist.redo.pop(); if (!op) return;
    if (await op.do()) { hist.undo.push(op); toast(`Rétabli : ${op.label}`, 'success'); } else hist.redo.push(op);
    syncHist();
  }
  const COPY_FIELDS = ['label', 'start_sec', 'end_sec', 'selected', 'player_note', 'drawings'];
  const copyOf = (s) => Object.fromEntries(COPY_FIELDS.map(k => [k, s[k]]));
  async function insertSeq(fields) {
    const { data: row, error: err } = await sb.from('video_sequences')
      .insert({ club_id: video.club_id, player_id: video.player_id, video_id: video.id, ...fields }).select('*').single();
    if (err) { console.error('Séquence non créée', err); toast(err.message, 'error'); return null; }
    w.seqs.push(row); w.cur = row.id; render(); onChange?.();
    return row;
  }
  async function removeSeq(s) {
    const { error: err } = await sb.from('video_sequences').delete().eq('id', s.id);
    if (err) { toast(err.message, 'error'); return false; }
    w.seqs = w.seqs.filter(x => x.id !== s.id);
    if (w.cur === s.id) { w.cur = null; ink.show(false); }
    render(); onChange?.();
    return true;
  }
  const now = () => Math.round(vid.currentTime * 10) / 10;
  const opTrim = (s, field, value) => {
    const old = s[field];
    return { label: field === 'start_sec' ? 'début déplacé' : 'fin déplacée',
      do: () => patch(s, { [field]: value }), undo: () => patch(s, { [field]: old }) };
  };
  const opSplit = (s, t) => {
    const oldEnd = s.end_sec; let part = null;
    return { label: 'séquence coupée',
      do: async () => {
        if (!(await patch(s, { end_sec: t }))) return false;
        part = await insertSeq({ ...copyOf(s), label: `${s.label || 'Séquence'} (suite)`, start_sec: t, end_sec: oldEnd, drawings: (s.drawings || []).filter(f => f.t >= t) });
        return !!part;
      },
      undo: async () => (await removeSeq(part)) && patch(s, { end_sec: oldEnd }) };
  };
  const opDup = (s) => {
    let copy = null;
    return { label: 'séquence dupliquée',
      do: async () => !!(copy = await insertSeq({ ...copyOf(s), label: `${s.label || 'Séquence'} (copie)` })),
      undo: () => removeSeq(copy) };
  };
  const opDelete = (s) => {
    let row = s;
    return { label: 'séquence supprimée',
      do: () => removeSeq(row),
      undo: async () => !!(row = await insertSeq(copyOf(row))) };
  };

  /* ---------- Écriture ---------- */
  async function patch(s, body, okMsg) {
    const { data: row, error: err } = await sb.from('video_sequences').update(body).eq('id', s.id).select('*').single();
    if (err) { console.error('Séquence non enregistrée', err); toast(err.message, 'error'); return false; }
    Object.assign(s, row);
    render();
    if (okMsg) toast(okMsg, 'success');
    onChange?.();
    return true;
  }

  async function cut() {
    const t = Math.round(vid.currentTime * 10) / 10;
    if (w.cutStart === null) {
      w.cutStart = t;
      syncCut();
      return;
    }
    if (t - w.cutStart < 0.5) return toast('Avancez la vidéo jusqu’à la fin de l’action, puis cliquez.', 'error');
    const fields = { label: `Séquence ${w.seqs.length + 1} – ${firstName}`, start_sec: w.cutStart, end_sec: t, selected: !staff };
    w.cutStart = null; syncCut();
    let row = null;
    await run({ label: 'séquence créée', do: async () => !!(row = await insertSeq(fields)), undo: () => removeSeq(row) });
    if (row) toast(`${row.label} créée.`, 'success');
  }
  function syncCut() {
    const on = w.cutStart !== null;
    $w('[data-act="cut"]').textContent = on ? '■ Fin de séquence' : '✂ Début de séquence';
    $w('[data-act="cut"]').classList.toggle('btn-primary', on);
    $w('[data-act="cut-cancel"]').classList.toggle('hidden', !on);
    $w('[data-el="cutHint"]').textContent = on
      ? `Début à ${fmtT(w.cutStart)}. Avancez jusqu’à la fin de l’action, puis cliquez « Fin ».`
      : 'Mettez la vidéo au début d’une action, puis cliquez.';
  }

  function startAnnotating() {
    const s = cur(); if (!s) return;
    w.stopAt = null;
    vid.pause();
    const near = (s.drawings || []).find(f => Math.abs(f.t - vid.currentTime) < 0.15);
    ink.setShapes(near ? near.shapes : []);
    ink.fit(); ink.show(true); ink.setEditable(true);
    w.annotating = true;
    $w('[data-el="drawbar"]').classList.remove('hidden');
    $w('[data-el="cutbar"]').classList.add('hidden');
  }
  function stopAnnotating() {
    w.annotating = false;
    ink.setEditable(false);
    $w('[data-el="drawbar"]').classList.add('hidden');
    $w('[data-el="cutbar"]').classList.remove('hidden');
  }
  async function saveFrame() {
    const s = cur(); if (!s) return;
    const t = Math.round(vid.currentTime * 10) / 10;
    const frames = (s.drawings || []).filter(f => Math.abs(f.t - t) >= 0.15);
    if (ink.shapes.length) frames.push({ t, shapes: ink.shapes.map(x => ({ ...x })) });
    frames.sort((a, b) => a.t - b.t);
    stopAnnotating();
    if (await patch(s, { drawings: frames }, ink.shapes.length ? 'Image enregistrée.' : 'Image retirée.')) ink.show(ink.shapes.length > 0);
  }

  /* ---------- Événements ---------- */
  root.addEventListener('click', async (e) => {
    const seqBtn = e.target.closest('[data-seq]');
    if (seqBtn) {
      if (w.annotating) stopAnnotating();
      w.cur = Number(seqBtn.dataset.seq);
      render();
      return play(cur());
    }
    const frameBtn = e.target.closest('[data-frame]');
    if (frameBtn) return showFrame(cur().drawings[Number(frameBtn.dataset.frame)]);
    const frameDel = e.target.closest('[data-frame-del]');
    if (frameDel) {
      const s = cur();
      ink.show(false);
      return patch(s, { drawings: s.drawings.filter((_, i) => i !== Number(frameDel.dataset.frameDel)) }, 'Image retirée.');
    }
    const tool = e.target.closest('[data-tool]');
    if (tool) {
      ink.setTool(tool.dataset.tool);
      root.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b === tool));
      return;
    }
    const color = e.target.closest('[data-ink-color]');
    if (color) {
      ink.setColor(color.dataset.inkColor);
      root.querySelectorAll('[data-ink-color]').forEach(b => b.classList.toggle('on', b === color));
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    const s = cur();
    if (act === 'cut') return cut();
    if (act === 'cut-cancel') { w.cutStart = null; return syncCut(); }
    if (act === 'replay' && s) return play(s);
    if (act === 'annotate') return startAnnotating();
    if (act === 'ink-undo') return ink.undo();
    if (act === 'ink-clear') return ink.clear();
    if (act === 'ink-cancel') { stopAnnotating(); return ink.show(false); }
    if (act === 'ink-save') return saveFrame();
    if (act === 'undo') return undoOp();
    if (act === 'redo') return redoOp();
    // Suppression sans confirmation : ↶ la rétablit.
    if (act === 'del' && s) { await run(opDelete(s)); return toast('Séquence supprimée. ↶ pour annuler.', 'success'); }
    if (act === 'trim-start' && s) {
      if (now() >= s.end_sec - 0.3) return toast('Placez la vidéo avant la fin de la séquence.', 'error');
      return run(opTrim(s, 'start_sec', now()));
    }
    if (act === 'trim-end' && s) {
      if (now() <= Number(s.start_sec) + 0.3) return toast('Placez la vidéo après le début de la séquence.', 'error');
      return run(opTrim(s, 'end_sec', now()));
    }
    if (act === 'split' && s) {
      const t = now();
      if (t <= Number(s.start_sec) + 0.3 || t >= s.end_sec - 0.3) return toast('Placez la vidéo à l’intérieur de la séquence pour la couper.', 'error');
      return run(opSplit(s, t));
    }
    if (act === 'dup' && s) return run(opDup(s));
    if (act === 'send' && s) {
      const note = $w('[data-el="note"]').value.trim() || null;
      return patch(s, { player_note: note, selected: true, submitted_at: new Date().toISOString() }, 'Envoyé à ton staff.');
    }
    if (act === 'feedback' && s) {
      return patch(s, { staff_feedback: $w('[data-el="feedback"]').value.trim() || null }, 'Retour envoyé au joueur.');
    }
  });
  root.addEventListener('change', (e) => {
    const s = cur(); if (!s) return;
    if (e.target.matches('[data-act="select"]')) patch(s, { selected: e.target.checked });
    if (e.target.matches('[data-el="label"]')) {
      const label = e.target.value.trim();
      if (label && label !== s.label) patch(s, { label });
    }
    if (e.target.matches('[data-el="note"]')) patch(s, { player_note: e.target.value.trim() || null });
  });

  render();
  if (focusSeq && w.seqs.some(s => s.id === focusSeq)) {
    w.cur = focusSeq;
    render();
    const s = cur();
    const openFirst = () => (s.drawings || []).length ? showFrame(s.drawings[0]) : (vid.currentTime = Number(s.start_sec));
    if (vid.readyState >= 1) openFirst(); else vid.addEventListener('loadedmetadata', openFirst, { once: true });
  }
  return { video: vid };
}
