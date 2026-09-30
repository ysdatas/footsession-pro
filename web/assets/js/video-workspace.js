/* ============================================================
   FootSession Pro — video-workspace.js
   Poste de travail d'une vidéo, commun au joueur et au staff :
     vidéo → séquence → habillage → analyse → envoi → retour du staff.
   Pensé d'abord pour le téléphone :
   - une timeline tactile (video-timeline.js) : on touche pour se
     déplacer, on tire les poignées pour couper ; mode précision
     (image par image, timeline zoomée) pour affiner ;
   - « Nouvelle séquence » crée tout de suite une séquence autour de
     l'image affichée : on l'ajuste ensuite aux poignées ;
   - « Annoter » met en pause et dessine directement sur la vidéo
     (video-ink.js). Chaque annotation a un instant, une durée et, au
     choix, un arrêt sur image : elle s'affiche pendant la lecture ;
   - l'envoi au staff passe par un aperçu (contenu, durée,
     annotations, analyse, destinataire) ;
   - tout le montage se défait (↶) et se rétablit (↷).
   La vidéo source n'est jamais modifiée : une séquence n'est qu'un
   début et une fin. RLS + trigger guard_video_sequence (platform_v2.sql,
   video_status.sql) : chacun n'écrit que sa part.

   mountVideoWorkspace(root, { video, src, player, mode: 'player'|'staff',
                               userId, focusSeq, onChange })
   ============================================================ */

const VW_FPS = 25;                 // pas « image par image »
const VW_RATES = [1, .5, .25];     // ralenti
const round2 = (t) => Math.round(Number(t) * 100) / 100;
const normFrame = (f) => ({ ...f, d: Number(f.d) > 0 ? Number(f.d) : 3, freeze: f.freeze !== false, shapes: f.shapes || [] });
const VW_ICON = {
  play: '<path d="M6 3l14 9-14 9z"/>', pause: '<path d="M7 4h3v16H7zM14 4h3v16h-3z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>',
  full: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  pen: '<path d="M21.17 6.81a1 1 0 0 0-3.98-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
  send: '<path d="M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.64l-19 6.5a.5.5 0 0 0-.03.94l7.93 3.18a2 2 0 0 1 1.11 1.11z"/><path d="m21.85 2.15-10.94 10.94"/>',
  prev: '<path d="m15 18-6-6 6-6"/>', next: '<path d="m9 18 6-6-6-6"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>', path: '<path d="M4 19c4 0 3-8 8-8s4-6 8-6" stroke-dasharray="3 3"/><path d="M16 5h4v4"/>',
  marker: '<ellipse cx="12" cy="18" rx="8" ry="3"/><path d="M12 15V5"/><circle cx="12" cy="4" r="1.5"/>',
  circle: '<circle cx="12" cy="12" r="8"/>', zone: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  spot: '<circle cx="12" cy="12" r="5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  text: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
};
const vwIc = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${VW_ICON[k]}</svg>`;

async function mountVideoWorkspace(root, { video, src, player, mode, userId, focusSeq = null, onChange = null }) {
  const staff = mode === 'staff';
  const tu = (toi, vous) => (staff ? vous : toi);   // le joueur est tutoyé, le staff vouvoyé
  const w = { seqs: [], cur: null, stopAt: null, annotating: null, holding: null, holdTimer: 0, zoom: false, rate: 0, shownKey: null };
  const firstName = player?.prenom || player?.nom || 'Joueur';

  root.innerHTML = `
    <div class="vw${staff ? ' is-staff' : ''}">
      <div class="vw-main">
        <div class="vw-stage" data-el="stage">
          <video playsinline preload="metadata" src="${escapeHtml(src)}"></video>
          <canvas class="vw-ink is-off"></canvas>
          <span class="vw-hold hidden" data-el="hold">Arrêt sur image</span>
          <input class="vw-textin hidden" data-el="textin" type="text" maxlength="60" autocomplete="off" enterkeyhint="done">
        </div>
        <div class="vw-panel" data-el="panel">
          <div class="vw-controls">
            <button class="vw-ctl vw-play" type="button" data-act="toggle" aria-label="Lecture">${vwIc('play')}</button>
            <span class="vw-time"><span data-el="time">0:00</span><span class="vw-time-total" data-el="total"> / 0:00</span></span>
            <span class="vw-spacer"></span>
            <button class="vw-ctl" type="button" data-act="undo" aria-label="Annuler la dernière opération" title="Annuler" disabled>${vwIc('undo')}</button>
            <button class="vw-ctl" type="button" data-act="redo" aria-label="Rétablir" title="Rétablir" disabled>${vwIc('redo')}</button>
            <button class="vw-ctl vw-rate" type="button" data-act="rate" title="Ralenti">1×</button>
            <button class="vw-ctl" type="button" data-act="zoom" aria-pressed="false" aria-label="Précision" title="Précision : image par image, timeline zoomée">${vwIc('zoom')}</button>
            <button class="vw-ctl" type="button" data-act="fullscreen" aria-label="Plein écran" title="Plein écran">${vwIc('full')}</button>
          </div>
          <div class="vw-precise hidden" data-el="precise">
            <button class="vw-ctl" type="button" data-act="frame-back" aria-label="Image précédente">${vwIc('prev')}</button>
            <span class="vw-ptime" data-el="ptime">0:00,0</span>
            <button class="vw-ctl" type="button" data-act="frame-fwd" aria-label="Image suivante">${vwIc('next')}</button>
            <span class="vw-precise-hint">Image par image · ${tu('tire', 'tirez')} les poignées pour affiner</span>
          </div>
          <div data-el="timeline"></div>
          <div class="vw-actions">
            <button class="btn btn-primary" type="button" data-act="new">${vwIc('scissors')}<span>Nouvelle séquence</span></button>
            ${staff ? '' : `<button class="btn" type="button" data-act="annotate">${vwIc('pen')}<span>Annoter</span></button>
            <span class="vw-spacer"></span>
            <button class="btn vw-sendall hidden" type="button" data-act="send-all">${vwIc('send')}<span data-el="sendAll">Envoyer</span></button>`}
          </div>
        </div>
        ${staff ? '' : `<div class="vw-drawbar hidden" data-el="drawbar" role="toolbar" aria-label="Annoter l’image">
          <div class="vw-draw-row vw-draw-head">
            <strong class="vw-draw-at" data-el="drawAt"></strong>
            <span class="vw-spacer"></span>
            <button class="vw-ctl" type="button" data-act="ink-undo" aria-label="Retirer le dernier tracé" title="Retirer le dernier tracé" disabled>${vwIc('undo')}</button>
            <button class="vw-ctl" type="button" data-act="ink-redo" aria-label="Remettre le tracé" title="Remettre le tracé" disabled>${vwIc('redo')}</button>
            <button class="vw-ctl" type="button" data-act="ink-clear" aria-label="Tout effacer" title="Tout effacer">${vwIc('trash')}</button>
          </div>
          <div class="vw-draw-row vw-tools" role="radiogroup" aria-label="Outil">
            ${INK_TOOLS.map(([k, label], i) => `<button type="button" data-tool="${k}" class="${i ? '' : 'on'}" role="radio" aria-checked="${!i}" title="${label}">${vwIc(k)}<span>${label}</span></button>`).join('')}
          </div>
          <div class="vw-draw-row">
            <div class="vw-inkcolors" role="radiogroup" aria-label="Couleur">
              ${INK_COLORS.map((c, i) => `<button type="button" data-ink-color="${c}" class="${i ? '' : 'on'}" style="background:${c}" aria-label="Couleur ${i + 1}"></button>`).join('')}
            </div>
            <div class="vw-seg hidden" data-el="textSize" role="radiogroup" aria-label="Taille du texte">
              <button type="button" data-text-size="title">Titre</button><button type="button" data-text-size="body" class="on">Texte</button>
            </div>
          </div>
          <div class="vw-draw-row">
            <span class="vw-draw-label">Visible</span>
            <div class="vw-seg" role="radiogroup" aria-label="Durée d’affichage">
              ${[2, 3, 5].map(d => `<button type="button" data-dur="${d}">${d} s</button>`).join('')}
            </div>
            <label class="vw-freeze"><input type="checkbox" data-el="freeze"> Arrêt sur image</label>
          </div>
          <div class="vw-draw-row vw-draw-foot">
            <button class="btn" type="button" data-act="ink-cancel">${vwIc('x')}<span>Fermer</span></button>
            <button class="btn btn-primary" type="button" data-act="ink-save">${vwIc('check')}<span>Enregistrer</span></button>
          </div>
        </div>`}
      </div>
      <aside class="vw-side">
        <h3 class="vw-title">Séquences <span data-el="count"></span></h3>
        ${staff
          ? '<p class="vw-hint">Découpez la vidéo en séquences. Le joueur choisit celles à travailler, les annote et vous les envoie.</p>'
          : '<ol class="vw-steps"><li>Choisis ou crée une séquence</li><li>Annote, écris ce que tu vois</li><li>Envoie au staff</li></ol>'}
        <div class="vw-seqs" data-el="list"></div>
        <div class="vw-detail" data-el="detail"></div>
      </aside>
      ${staff ? '' : '<div class="vw-sheet-backdrop hidden" data-el="sheet"></div>'}
    </div>`;

  const $w = (sel) => root.querySelector(sel);
  const vid = $w('video');
  const ink = createInk(vid, $w('.vw-ink'), { onText: askText, onChange: syncInkButtons });
  const cur = () => w.seqs.find(s => s.id === w.cur) || null;
  const frames = () => (cur()?.drawings || []).map(normFrame);
  const canDelete = (s) => staff || s.created_by === userId;
  const tl = createTimeline($w('[data-el="timeline"]'), {
    onSeek: (t) => { endHold(); if (!vid.paused) vid.pause(); seekTo(t); },
    onTrim: (field, t, done) => {
      const s = cur(); if (!s) return;
      endHold(); if (!vid.paused) vid.pause(); w.stopAt = null;
      seekTo(t);
      if (done && Math.abs(Number(s[field]) - t) > .005) run(opTrim(s, field, t));
    },
    onGesture: (on, kind) => root.firstElementChild.classList.toggle('is-trimming', on && kind === 'trim'),
  });

  const { data, error } = await sb.from('video_sequences').select('*').eq('video_id', video.id).order('start_sec');
  if (error) {
    console.error('Séquences illisibles', error);
    $w('[data-el="list"]').innerHTML = `<p class="text-danger vw-hint">${/video_sequences/.test(error.message)
      ? 'Base à mettre à jour : exécutez supabase/platform_v2.sql.' : escapeHtml(error.message)}</p>`;
    $w('.vw-actions').classList.add('hidden');
    return { video: vid };
  }
  w.seqs = data || [];

  /* ---------- Rendu ---------- */
  function render() {
    w.seqs.sort((a, b) => a.start_sec - b.start_sec || a.id - b.id);
    $w('[data-el="count"]').textContent = w.seqs.length ? `(${w.seqs.length})` : '';
    const D = vid.duration || 0;
    $w('[data-el="list"]').innerHTML = `
      <button type="button" class="vw-seq vw-seq-all${w.cur ? '' : ' is-current'}" data-seq="0">
        <span class="vw-seq-name">Vidéo entière</span>
        <span class="vw-seq-time">${fmtT(0)} – ${fmtT(D)}</span>
        <span class="vw-seq-foot"><span class="vw-muted">Source, jamais modifiée</span></span>
      </button>${w.seqs.map(s => {
        const n = (s.drawings || []).length;
        return `<button type="button" class="vw-seq${s.id === w.cur ? ' is-current' : ''}" data-seq="${s.id}">
          <span class="vw-seq-name">${escapeHtml(s.label || 'Séquence')}</span>
          <span class="vw-seq-time">${fmtT(s.start_sec)} – ${fmtT(s.end_sec)}</span>
          <span class="vw-seq-foot">${statusPill(s)}${n ? `<span class="vw-seq-ann" title="${n} annotation${n > 1 ? 's' : ''}">${vwIc('pen')}${n}</span>` : ''}${!staff && s.selected ? '<span class="vw-star" title="À travailler">★</span>' : ''}</span>
        </button>`;
      }).join('')}`;
    renderDetail();
    tl.update({ duration: D, seqs: w.seqs, cur: cur(), frames: frames(), zoom: zoomOn() });
    syncSendAll(); syncHist();
    w.shownKey = null;
    if (vid.paused) paintAt(vid.currentTime, false);
  }

  function renderDetail() {
    const s = cur(), box = $w('[data-el="detail"]');
    if (!s) {
      box.innerHTML = w.seqs.length ? '' : `<p class="vw-empty">Aucune séquence pour l’instant. ${tu('Mets', 'Mettez')} la vidéo sur une action, puis « Nouvelle séquence ».</p>`;
      return;
    }
    const fr = frames(), st = seqStatus(s);
    box.innerHTML = `
      <div class="vw-detail-head">
        <input type="text" data-el="label" value="${escapeHtml(s.label || '')}" aria-label="Nom de la séquence">
        ${statusPill(s)}
      </div>
      <div class="vw-meta">
        <span>${fmtT(s.start_sec)} → ${fmtT(s.end_sec)} · ${fmtDur(s.end_sec - s.start_sec)}</span>
        <button class="btn btn-sm" type="button" data-act="replay">${vwIc('play')}Lire</button>
      </div>
      <div class="vw-edit" role="toolbar" aria-label="Montage de la séquence">
        <button class="btn btn-sm" type="button" data-act="split" title="Couper en deux à l’image affichée">✂ Couper ici</button>
        <button class="btn btn-sm" type="button" data-act="dup" title="Créer une copie à modifier : l’original reste intact">⧉ Dupliquer</button>
        ${canDelete(s) ? '<button class="btn btn-sm btn-danger" type="button" data-act="del">Supprimer</button>' : ''}
        ${staff ? '' : `<button class="btn btn-sm vw-star-btn${s.selected ? ' is-on' : ''}" type="button" data-act="select" aria-pressed="${!!s.selected}">${s.selected ? '★' : '☆'} À travailler</button>`}
      </div>
      <section class="vw-block">
        <div class="vw-block-title">Annotations${fr.length ? ` (${fr.length})` : ''}</div>
        ${fr.length ? `<div class="vw-anns">${fr.map((f, i) => `
          <div class="vw-ann">
            <button type="button" class="vw-ann-main" data-frame="${i}"><strong>${fmtT(f.t)}</strong>
              <span>${f.freeze ? `arrêt ${f.d} s` : `visible ${f.d} s`} · ${f.shapes.length} élément${f.shapes.length > 1 ? 's' : ''}</span></button>
            ${staff ? '' : `<button type="button" data-frame-edit="${i}" aria-label="Modifier l’annotation">${vwIc('pen')}</button>
            <button type="button" data-frame-del="${i}" aria-label="Supprimer l’annotation">${vwIc('x')}</button>`}
          </div>`).join('')}</div>`
          : `<p class="vw-muted">${staff ? 'Aucune annotation du joueur.' : 'Mets pause sur une action, puis « Annoter ».'}</p>`}
      </section>
      <section class="vw-block">
        <div class="vw-block-title">${staff ? 'Analyse du joueur' : 'Mon analyse'}</div>
        ${staff
          ? `<p class="vw-note">${s.player_note ? escapeHtml(s.player_note).replace(/\n/g, '<br>') : '<span class="vw-muted">Pas encore de commentaire.</span>'}</p>`
          : `<textarea rows="3" data-el="note" placeholder="Ce que tu vois, ce que tu aurais pu faire…">${escapeHtml(s.player_note || '')}</textarea>`}
      </section>
      <section class="vw-block">
        <div class="vw-block-title">Retour du staff</div>
        ${staff
          ? `<textarea rows="3" data-el="feedback" placeholder="Votre retour au joueur…">${escapeHtml(s.staff_feedback || '')}</textarea>
             <button class="btn btn-sm btn-primary" type="button" data-act="feedback">Envoyer mon retour</button>`
          : `<p class="vw-note">${s.staff_feedback ? escapeHtml(s.staff_feedback).replace(/\n/g, '<br>') : '<span class="vw-muted">Pas encore de retour.</span>'}</p>`}
      </section>
      ${staff ? '' : `<div class="vw-send-row">
        ${s.submitted_at ? `<span class="vw-muted">Envoyée le ${escapeHtml(new Date(s.submitted_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))}</span>` : ''}
        ${['draft', 'ready', 'modified'].includes(st)
          ? `<button class="btn btn-primary" type="button" data-act="send">${vwIc('send')}${st === 'modified' ? 'Renvoyer au staff' : 'Envoyer au staff'}</button>` : ''}
      </div>`}`;
  }

  /* ---------- Lecture, arrêts sur image, annotations dans le temps ---------- */
  let seekRaf = 0, seekTarget = 0, lastT = 0;
  function seekTo(t) {
    seekTarget = Math.max(0, Math.min(vid.duration || t, t));
    if (!seekRaf) seekRaf = requestAnimationFrame(() => { seekRaf = 0; vid.currentTime = seekTarget; });
  }
  /* À l'arrêt : l'annotation de l'instant affiché. En lecture : celles dont
     la durée couvre l'instant (les arrêts sur image se jouent à part). */
  function paintAt(t, playing) {
    if (w.annotating || w.holding) return;
    const on = frames().filter(f => (!playing && Math.abs(t - f.t) < .12) || (!f.freeze && t >= f.t - .05 && t < f.t + f.d));
    const key = on.map(f => f.t).join();
    if (key !== w.shownKey) { w.shownKey = key; ink.setShapes(on.flatMap(f => f.shapes)); }
    ink.show(on.length > 0);
  }
  function tick() {
    if (vid.paused || vid.ended) return;
    const t = vid.currentTime;
    const f = frames().find(x => x.freeze && lastT < x.t && x.t <= t + .04);
    if (f) return hold(f);
    lastT = t;
    if (w.stopAt !== null && t >= w.stopAt) { vid.pause(); w.stopAt = null; }
    paintAt(t, true); tl.setTime(t); syncTime();
    requestAnimationFrame(tick);
  }
  function hold(f) {
    vid.pause();
    vid.currentTime = f.t; lastT = f.t;
    w.holding = f; w.shownKey = null;
    ink.setShapes(f.shapes); ink.show(true);
    $w('[data-el="hold"]').classList.remove('hidden');
    w.holdTimer = setTimeout(() => { endHold(); vid.play().catch(() => {}); }, f.d * 1000);
  }
  function endHold() {
    if (!w.holding) return;
    clearTimeout(w.holdTimer); w.holding = null;
    $w('[data-el="hold"]').classList.add('hidden');
    syncPlay();
  }
  function play(s) {
    endHold();
    if (s) {
      vid.currentTime = Number(s.start_sec); w.stopAt = Number(s.end_sec);
      const first = frames().find(f => f.freeze && Math.abs(f.t - s.start_sec) < .05);
      if (first) return hold(first);   // arrêt sur image dès la première image
    }
    vid.play().catch(() => {});
  }
  /* Une séquence choisie se lit jusqu'à sa fin ; « Vidéo entière » se lit librement. */
  function togglePlay() {
    if (w.annotating) return;
    if (!vid.paused) { endHold(); return vid.pause(); }
    if (w.holding) { endHold(); return vid.play().catch(() => {}); }
    const s = cur();
    if (s && (vid.currentTime < s.start_sec - .05 || vid.currentTime >= s.end_sec - .05)) return play(s);
    if (s) w.stopAt = Number(s.end_sec);
    vid.play().catch(() => {});
  }
  function syncPlay() {
    const b = $w('[data-act="toggle"]'), playing = !vid.paused || !!w.holding;
    b.innerHTML = vwIc(playing ? 'pause' : 'play');
    b.setAttribute('aria-label', playing ? 'Pause' : 'Lecture');
  }
  function syncTime() {
    const t = vid.currentTime || 0;
    $w('[data-el="time"]').textContent = fmtT(t);
    $w('[data-el="total"]').textContent = ` / ${fmtT(vid.duration || 0)}`;
    $w('[data-el="ptime"]').textContent = fmtTP(t);
  }
  vid.addEventListener('play', () => { lastT = vid.currentTime; syncPlay(); requestAnimationFrame(tick); });
  vid.addEventListener('pause', syncPlay);
  vid.addEventListener('seeked', () => {
    lastT = vid.currentTime; tl.setTime(vid.currentTime); syncTime();
    if (vid.paused) paintAt(vid.currentTime, false);
  });
  vid.addEventListener('loadedmetadata', () => { render(); syncTime(); });
  // Toucher la vidéo : lecture / pause (sauf pendant l'annotation).
  vid.addEventListener('click', togglePlay);

  function step(dir) {
    endHold(); vid.pause(); w.stopAt = null;
    seekTo(round2((vid.currentTime || 0) + dir / VW_FPS));
  }
  /* Une séquence courte dans une longue vidéo (un match) serait
     minuscule : la timeline zoome d'elle-même sur la séquence. */
  function zoomOn() {
    const s = cur(), D = vid.duration || 0;
    return w.zoom || !!(s && D && (s.end_sec - s.start_sec) / D < .08);
  }
  function toggleZoom() {
    w.zoom = !w.zoom;
    $w('[data-act="zoom"]').setAttribute('aria-pressed', String(w.zoom));
    $w('[data-el="precise"]').classList.toggle('hidden', !w.zoom);
    tl.update({ zoom: zoomOn() });
  }
  function cycleRate() {
    w.rate = (w.rate + 1) % VW_RATES.length;
    vid.playbackRate = VW_RATES[w.rate];
    $w('[data-act="rate"]').textContent = `${String(VW_RATES[w.rate]).replace('.', ',')}×`;
  }
  function toggleFullscreen() {
    const stage = $w('[data-el="stage"]');
    if (document.fullscreenElement) return document.exitFullscreen();
    if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
    else if (vid.webkitEnterFullscreen) vid.webkitEnterFullscreen();   // iPhone : vidéo seule
  }

  /* ---------- Historique : chaque opération se défait ---------- */
  const hist = { undo: [], redo: [] };
  function syncHist() {
    $w('[data-act="undo"]').disabled = !hist.undo.length;
    $w('[data-act="redo"]').disabled = !hist.redo.length;
  }
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
    if (w.cur === s.id) w.cur = null;
    render(); onChange?.();
    return true;
  }
  async function patch(s, body, okMsg) {
    const { data: row, error: err } = await sb.from('video_sequences').update(body).eq('id', s.id).select('*').single();
    if (err) { console.error('Séquence non enregistrée', err); toast(err.message, 'error'); return false; }
    Object.assign(s, row);
    render();
    if (okMsg) toast(okMsg, 'success');
    onChange?.();
    return true;
  }
  const opTrim = (s, field, value) => {
    const old = s[field];
    return { label: field === 'start_sec' ? 'début déplacé' : 'fin déplacée',
      do: () => patch(s, { [field]: value }), undo: () => patch(s, { [field]: old }) };
  };
  /* Couper : chaque partie garde les annotations de son côté. */
  const opSplit = (s, t) => {
    const oldEnd = s.end_sec, oldFrames = s.drawings || []; let part = null;
    return { label: 'séquence coupée',
      do: async () => {
        if (!(await patch(s, { end_sec: t, drawings: oldFrames.filter(f => f.t < t) }))) return false;
        part = await insertSeq({ ...copyOf(s), label: `${s.label || 'Séquence'} (suite)`, start_sec: t, end_sec: oldEnd, drawings: oldFrames.filter(f => f.t >= t) });
        return !!part;
      },
      undo: async () => (await removeSeq(part)) && patch(s, { end_sec: oldEnd, drawings: oldFrames }) };
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
  const opFrames = (s, next, label) => {
    const old = s.drawings || [];
    return { label, do: () => patch(s, { drawings: next }), undo: () => patch(s, { drawings: old }) };
  };

  /* « Nouvelle séquence » : créée tout de suite autour de l'image affichée,
     on l'ajuste ensuite en tirant les poignées. */
  async function createAround(t) {
    const D = vid.duration || t + 4;
    const a = round2(Math.max(0, Math.min(t - 2, D - 3))), b = round2(Math.min(D, a + 6));
    const fields = { label: `Séquence ${w.seqs.length + 1} – ${firstName}`, start_sec: a, end_sec: b, selected: !staff };
    let row = null;
    await run({ label: 'séquence créée', do: async () => !!(row = await insertSeq(fields)), undo: () => removeSeq(row) });
    if (row) toast(`${row.label} créée : ${tu('tire', 'tirez')} les poignées dorées pour l’ajuster.`, 'success');
    return row;
  }

  function selectSeq(id, andPlay) {
    if (w.annotating) stopAnnotating();
    endHold();
    w.cur = id || null;
    w.stopAt = null;
    render();
    const s = cur();
    if (staff && s) markSeen(s);
    if (s && andPlay) play(s);
    else if (s) { vid.pause(); vid.currentTime = Number(s.start_sec); }
  }
  /* Le staff ouvre une séquence envoyée : elle passe « Vu » pour le joueur. */
  async function markSeen(s) {
    if (!('seen_at' in s) || !s.submitted_at || (s.seen_at && !isAfter(s.submitted_at, s.seen_at))) return;
    const { data: row, error: err } = await sb.from('video_sequences').update({ seen_at: new Date().toISOString() }).eq('id', s.id).select('*').single();
    if (err) { console.warn('Statut « vu » non enregistré', err.message); return; }
    Object.assign(s, row); render(); onChange?.();
  }

  /* ---------- Annoter : pause → dessin → enregistrer → reprise ---------- */
  async function startAnnotating(atFrame = null) {
    endHold(); vid.pause(); w.stopAt = null;
    const t = atFrame ? atFrame.t : round2(vid.currentTime);
    let s = cur();
    if (!s || t < s.start_sec - .05 || t > Number(s.end_sec) + .05) {
      // La tête de lecture est dans une autre séquence : on la prend ; sinon on en crée une.
      const inside = w.seqs.find(x => t >= x.start_sec && t <= x.end_sec);
      if (inside) { w.cur = inside.id; render(); } else if (!(await createAround(t))) return;
      s = cur();
    }
    const near = atFrame || frames().find(f => Math.abs(f.t - t) < .15);
    w.annotating = { t: near ? near.t : t, d: near ? near.d : 3, freeze: near ? near.freeze : true, editing: near ? near.t : null };
    if (Math.abs(vid.currentTime - w.annotating.t) > .01) vid.currentTime = w.annotating.t;
    ink.setShapes(near ? near.shapes : []); ink.fit(); ink.show(true); ink.setEditable(true);
    root.firstElementChild.classList.add('is-annotating');
    $w('[data-el="drawbar"]').classList.remove('hidden');
    $w('[data-el="panel"]').classList.add('hidden');
    syncDrawbar(); syncInkButtons();
    $w('[data-el="stage"]').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function stopAnnotating() {
    w.annotating = null;
    ink.setEditable(false);
    root.firstElementChild.classList.remove('is-annotating');
    $w('[data-el="textin"]').classList.add('hidden');
    $w('[data-el="drawbar"]')?.classList.add('hidden');
    $w('[data-el="panel"]').classList.remove('hidden');
    w.shownKey = null; paintAt(vid.currentTime, false);
  }
  function syncDrawbar() {
    const a = w.annotating; if (!a) return;
    root.querySelectorAll('[data-dur]').forEach(b => b.classList.toggle('on', Number(b.dataset.dur) === a.d));
    $w('[data-el="freeze"]').checked = a.freeze;
    $w('[data-el="drawAt"]').textContent = `Annotation à ${fmtT(a.t)}`;
  }
  function syncInkButtons() {
    const u = $w('[data-act="ink-undo"]'), r = $w('[data-act="ink-redo"]');
    if (u) u.disabled = !ink.canUndo;
    if (r) r.disabled = !ink.canRedo;
  }
  async function saveAnnotation() {
    const s = cur(), a = w.annotating; if (!s || !a) return;
    commitText?.();
    const shapes = ink.shapes.map(x => ({ ...x }));
    const others = (s.drawings || []).filter(f => (a.editing === null ? Math.abs(f.t - a.t) >= .15 : f.t !== a.editing));
    const next = [...others, ...(shapes.length ? [{ t: a.t, d: a.d, freeze: a.freeze, shapes }] : [])].sort((x, y) => x.t - y.t);
    stopAnnotating();
    await run(opFrames(s, next, shapes.length ? 'annotation enregistrée' : 'annotation retirée'));
    toast(shapes.length ? 'Annotation enregistrée : elle s’affichera pendant la lecture.' : 'Annotation retirée.', 'success');
  }
  /* Texte et étiquette de repère : un champ posé à l'endroit touché. Le
     focus est donné après le geste, sinon le navigateur le reprendrait. */
  let commitText = null;
  function askText(p, kind) {
    commitText?.();
    const input = $w('[data-el="textin"]'), stage = $w('[data-el="stage"]').getBoundingClientRect();
    const c = ink.toClient(p);
    input.style.left = `${Math.min(Math.max(8, c.x - stage.left - 90), stage.width - 188)}px`;
    input.style.top = `${Math.min(Math.max(8, c.y - stage.top - 20), stage.height - 48)}px`;
    input.placeholder = kind === 'marker' ? 'N° ou nom (facultatif)' : 'Tape ton texte';
    input.value = '';
    input.classList.remove('hidden');
    commitText = () => {
      commitText = null;
      input.onblur = input.onkeydown = null;
      input.classList.add('hidden');
      const v = input.value.trim();
      if (kind === 'marker') ink.labelLast(v); else ink.addText(p, v);
    };
    setTimeout(() => {
      input.focus();
      input.onblur = () => commitText?.();
    }, 0);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitText?.(); }
      if (e.key === 'Escape') { input.value = ''; commitText?.(); }
    };
  }

  /* ---------- Envoi au staff : aperçu, puis envoi explicite ---------- */
  const sendable = () => w.seqs.filter(s => ['ready', 'modified'].includes(seqStatus(s)));
  function syncSendAll() {
    const b = $w('[data-act="send-all"]'); if (!b) return;
    const n = sendable().length;
    b.classList.toggle('hidden', !n);
    $w('[data-el="sendAll"]').textContent = `Envoyer (${n})`;
  }
  function openSheet(only = null) {
    const sheet = $w('[data-el="sheet"]');
    const noteNow = $w('[data-el="note"]')?.value.trim();
    const list = w.seqs.filter(s => ['draft', 'ready', 'modified'].includes(seqStatus(s)) || s.id === only?.id);
    const checked = (s) => (only ? s.id === only.id : ['ready', 'modified'].includes(seqStatus(s)));
    sheet.innerHTML = `
      <div class="vw-sheet" role="dialog" aria-modal="true" aria-labelledby="vwSheetTitle">
        <div class="vw-sheet-grip" aria-hidden="true"></div>
        <h3 id="vwSheetTitle">Envoyer au staff</h3>
        <p class="vw-sheet-to">À : <strong>ton staff</strong> — les entraîneurs de ton club verront la séquence, tes annotations et ton analyse.</p>
        <div class="vw-sheet-list">${list.map(s => {
          const note = (s.id === w.cur && noteNow !== undefined ? noteNow : s.player_note || '').trim();
          const n = (s.drawings || []).length;
          return `<label class="vw-sheet-row">
            <input type="checkbox" value="${s.id}" ${checked(s) ? 'checked' : ''}>
            <span class="vw-sheet-main">
              <strong>${escapeHtml(s.label || 'Séquence')}</strong>
              <span>${fmtT(s.start_sec)} → ${fmtT(s.end_sec)} · ${fmtDur(s.end_sec - s.start_sec)} · ${n ? `${n} annotation${n > 1 ? 's' : ''}` : 'sans annotation'}</span>
              ${note ? `<em>« ${escapeHtml(note.length > 120 ? `${note.slice(0, 117)}…` : note)} »</em>` : '<em class="is-empty">Pas encore d’analyse écrite</em>'}
            </span>
            ${statusPill(s)}
          </label>`;
        }).join('')}</div>
        <div class="vw-sheet-actions">
          <button class="btn" type="button" data-act="sheet-close">Plus tard</button>
          <button class="btn btn-primary" type="button" data-act="sheet-send">${vwIc('send')}<span data-el="sheetCount"></span></button>
        </div>
      </div>`;
    sheet.classList.remove('hidden');
    syncSheet();
    sheet.querySelector('[data-act="sheet-send"]').focus();
  }
  function syncSheet() {
    const n = root.querySelectorAll('.vw-sheet-row input:checked').length;
    $w('[data-el="sheetCount"]').textContent = n > 1 ? `Envoyer au staff (${n})` : 'Envoyer au staff';
    $w('[data-act="sheet-send"]').disabled = !n;
  }
  const closeSheet = () => $w('[data-el="sheet"]')?.classList.add('hidden');
  async function sendChecked() {
    const ids = [...root.querySelectorAll('.vw-sheet-row input:checked')].map(i => Number(i.value));
    const noteEl = $w('[data-el="note"]');
    $w('[data-act="sheet-send"]').disabled = true;
    const now = new Date().toISOString();
    const results = await Promise.all(w.seqs.filter(s => ids.includes(s.id)).map(s => patch(s, {
      selected: true, submitted_at: now,
      ...(s.id === w.cur && noteEl ? { player_note: noteEl.value.trim() || null } : {}),
    })));
    closeSheet();
    const ok = results.filter(Boolean).length;
    if (ok) toast(ok > 1 ? `${ok} séquences envoyées à ton staff.` : 'Envoyé à ton staff.', 'success');
  }

  /* ---------- Événements ---------- */
  root.addEventListener('click', async (e) => {
    const seqBtn = e.target.closest('[data-seq]');
    if (seqBtn) return selectSeq(Number(seqBtn.dataset.seq), false);
    const frameBtn = e.target.closest('[data-frame]');
    if (frameBtn) {
      const f = frames()[Number(frameBtn.dataset.frame)]; if (!f) return;
      endHold(); vid.pause(); w.stopAt = null; vid.currentTime = f.t;
      w.shownKey = null; ink.setShapes(f.shapes); ink.show(true);
      return;
    }
    const frameEdit = e.target.closest('[data-frame-edit]');
    if (frameEdit) return startAnnotating(frames()[Number(frameEdit.dataset.frameEdit)]);
    const frameDel = e.target.closest('[data-frame-del]');
    if (frameDel) {
      const s = cur();
      return run(opFrames(s, s.drawings.filter((_, i) => i !== Number(frameDel.dataset.frameDel)), 'annotation supprimée'));
    }
    const tool = e.target.closest('[data-tool]');
    if (tool) {
      ink.setTool(tool.dataset.tool);
      root.querySelectorAll('[data-tool]').forEach(b => { b.classList.toggle('on', b === tool); b.setAttribute('aria-checked', String(b === tool)); });
      $w('[data-el="textSize"]').classList.toggle('hidden', tool.dataset.tool !== 'text');
      return;
    }
    const color = e.target.closest('[data-ink-color]');
    if (color) {
      ink.setColor(color.dataset.inkColor);
      root.querySelectorAll('[data-ink-color]').forEach(b => b.classList.toggle('on', b === color));
      return;
    }
    const size = e.target.closest('[data-text-size]');
    if (size) {
      ink.setTextSize(size.dataset.textSize);
      root.querySelectorAll('[data-text-size]').forEach(b => b.classList.toggle('on', b === size));
      return;
    }
    const dur = e.target.closest('[data-dur]');
    if (dur && w.annotating) { w.annotating.d = Number(dur.dataset.dur); return syncDrawbar(); }
    if (e.target.matches('.vw-sheet-backdrop')) return closeSheet();

    const act = e.target.closest('[data-act]')?.dataset.act;
    const s = cur();
    if (act === 'toggle') return togglePlay();
    if (act === 'rate') return cycleRate();
    if (act === 'zoom') return toggleZoom();
    if (act === 'fullscreen') return toggleFullscreen();
    if (act === 'frame-back') return step(-1);
    if (act === 'frame-fwd') return step(1);
    if (act === 'new') { endHold(); vid.pause(); return createAround(round2(vid.currentTime)); }
    if (act === 'annotate') return startAnnotating();
    if (act === 'replay' && s) return play(s);
    if (act === 'ink-undo') return ink.undo();
    if (act === 'ink-redo') return ink.redo();
    if (act === 'ink-clear') return ink.clear();
    if (act === 'ink-cancel') return stopAnnotating();
    if (act === 'ink-save') return saveAnnotation();
    if (act === 'undo') return undoOp();
    if (act === 'redo') return redoOp();
    if (act === 'send-all') return openSheet();
    if (act === 'send' && s) return openSheet(s);
    if (act === 'sheet-close') return closeSheet();
    if (act === 'sheet-send') return sendChecked();
    // Suppression sans confirmation : ↶ la rétablit.
    if (act === 'del' && s) { await run(opDelete(s)); return toast('Séquence supprimée. ↶ pour annuler.', 'success'); }
    if (act === 'select' && s) return patch(s, { selected: !s.selected });
    if (act === 'split' && s) {
      const t = round2(vid.currentTime);
      if (t <= Number(s.start_sec) + .3 || t >= s.end_sec - .3) return toast(`${tu('Place', 'Placez')} la vidéo à l’intérieur de la séquence pour la couper.`, 'error');
      return run(opSplit(s, t));
    }
    if (act === 'dup' && s) return run(opDup(s));
    if (act === 'feedback' && s) {
      return patch(s, { staff_feedback: $w('[data-el="feedback"]').value.trim() || null }, 'Retour envoyé au joueur.');
    }
  });
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-el="freeze"]') && w.annotating) { w.annotating.freeze = e.target.checked; return; }
    if (e.target.closest('.vw-sheet-row')) return syncSheet();
    const s = cur(); if (!s) return;
    if (e.target.matches('[data-el="label"]')) {
      const label = e.target.value.trim();
      if (label && label !== s.label) patch(s, { label });
    }
    if (e.target.matches('[data-el="note"]')) {
      const note = e.target.value.trim() || null;
      if (note !== (s.player_note || null)) patch(s, { player_note: note });
    }
  });
  // Clavier (ordinateur) : Espace lecture/pause, virgule et point image par image.
  const onKey = (e) => {
    if (!vid.isConnected) return document.removeEventListener('keydown', onKey);
    if (!root.offsetParent || e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'Escape' && w.annotating) { e.preventDefault(); return stopAnnotating(); }
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === ',') step(-1);
    else if (e.key === '.') step(1);
  };
  document.addEventListener('keydown', onKey);

  render(); syncTime(); syncPlay();
  if (focusSeq && w.seqs.some(s => s.id === focusSeq)) {
    const open = () => {
      selectSeq(focusSeq, false);
      const f = frames()[0];
      if (f) vid.currentTime = f.t;
    };
    if (vid.readyState >= 1) open(); else vid.addEventListener('loadedmetadata', open, { once: true });
  }
  return { video: vid };
}
