/* ============================================================
   LMFC Performance — video-workspace.js
   Poste de travail vidéo, commun au joueur et au staff. Deux écrans
   qui ne se mélangent jamais :

   VIDÉO SOURCE  la vidéo importée, jamais modifiée. On la regarde ;
                 « Sélectionner une portion » ouvre le mode sélection
                 (poignées début / fin), « Créer la séquence » crée une
                 nouvelle vidéo et l'ouvre.
   SÉQUENCE      une nouvelle vidéo à part entière : son titre, sa
                 durée (timeline de 0 à sa fin), sa miniature, son
                 habillage (video-annotate.js), son statut, son envoi
                 au staff (video-send.js).

   Une séquence n'est pas un fichier recopié : c'est une ligne de
   video_sequences (début, fin, habillage, statut) qui ne lit que sa
   portion de la source. Création immédiate, rien n'est dupliqué.
   Le retour du téléphone passe d'un écran à l'autre (history), une
   annotation non enregistrée est protégée, tout le montage se défait
   (↶) et se rétablit (↷).

   mountVideoWorkspace(root, { video, src, player, mode: 'player'|'staff',
     userId, focusSeq, onChange, backHref, history })
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
  prev: '<path d="m15 18-6-6 6-6"/>', next: '<path d="m9 18 6-6-6-6"/>', back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  select: '<path d="M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.43 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>', path: '<path d="M4 19c4 0 3-8 8-8s4-6 8-6" stroke-dasharray="3 3"/><path d="M16 5h4v4"/>',
  marker: '<ellipse cx="12" cy="18" rx="8" ry="3"/><path d="M12 15V5"/><circle cx="12" cy="4" r="1.5"/>',
  circle: '<circle cx="12" cy="12" r="8"/>', zone: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  spot: '<circle cx="12" cy="12" r="5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  text: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
};
const vwIc = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${VW_ICON[k]}</svg>`;
const vwDate = (d) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function mountVideoWorkspace(root, { video, src, player, mode, userId, focusSeq = null, onChange = null, backHref = null, history: useHistory = false }) {
  const staff = mode === 'staff';
  const tu = (toi, vous) => (staff ? vous : toi);   // le joueur est tutoyé, le staff vouvoyé
  const w = { seqs: [], cur: null, ui: 'view', sel: null, stopAt: null, holding: null, holdTimer: 0,
    rate: 0, shownKey: null, precise: false, busy: false, save: '', fresh: null };

  root.innerHTML = `
    <div class="vw${staff ? ' is-staff' : ''}">
      <header class="vw-head" data-el="head"></header>
      <div class="vw-main">
        <div class="vw-stage" data-el="stage">
          <video id="playerVideo" playsinline preload="metadata" src="${escapeHtml(src)}"></video>
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
            <button class="vw-ctl" type="button" data-act="fullscreen" aria-label="Plein écran" title="Plein écran">${vwIc('full')}</button>
            <button class="vw-ctl" type="button" data-act="more" data-el="more" aria-label="Options de la séquence" title="Options">${vwIc('more')}</button>
          </div>
          <div class="vw-precise hidden" data-el="precise">
            <button class="vw-ctl" type="button" data-act="frame-back" aria-label="Image précédente">${vwIc('prev')}</button>
            <span class="vw-ptime" data-el="ptime">0:00,0</span>
            <button class="vw-ctl" type="button" data-act="frame-fwd" aria-label="Image suivante">${vwIc('next')}</button>
            <span class="vw-spacer"></span>
            <button class="btn btn-sm vw-sel-only" type="button" data-act="set-start">⇤ Début ici</button>
            <button class="btn btn-sm vw-sel-only" type="button" data-act="set-end">Fin ici ⇥</button>
          </div>
          <div data-el="timeline"></div>
          <div class="vw-actions" data-el="actions"></div>
        </div>
        <div data-el="annot"></div>
      </div>
      <aside class="vw-side" data-el="side"></aside>
      <div class="vw-sheet-backdrop hidden" data-el="sheet"></div>
    </div>`;

  const $w = (sel) => root.querySelector(sel);
  const shell = root.firstElementChild;
  const vid = $w('video');
  let annot = null, sender = null;
  const ink = createInk(vid, $w('.vw-ink'), {
    onText: (p, kind) => annot?.askText(p, kind),
    onChange: () => annot?.sync(),
    onSelect: (shape) => annot?.onSelect(shape),
  });
  const cur = () => w.seqs.find(s => s.id === w.cur) || null;
  const range = (s = cur()) => (s ? { start: Number(s.start_sec), end: Number(s.end_sec) } : null);
  /* Habillage de la séquence ouverte (seulement ce qui tombe dans sa portion). */
  const frames = () => {
    const r = range(); if (!r) return [];
    return (cur().drawings || []).map(normFrame).filter(f => f.t >= r.start - .05 && f.t <= r.end + .05);
  };
  const canDelete = (s) => staff || s.created_by === userId;
  const viewer = staff ? 'staff' : 'player';
  const selecting = () => w.ui === 'select' || w.ui === 'trim';
  const tl = createTimeline($w('[data-el="timeline"]'), {
    onSeek: (t) => { endHold(); if (!vid.paused) vid.pause(); w.stopAt = null; seekTo(t); },
    onTrim: (field, t, done) => {
      if (!w.sel) return;
      endHold(); if (!vid.paused) vid.pause(); w.stopAt = null;
      w.sel[field] = t;
      seekTo(t); syncSelText();
      if (done) syncTimeline();
    },
    onGesture: (on, kind) => shell.classList.toggle('is-trimming', on && kind === 'trim'),
  });

  const { data, error } = await sb.from('video_sequences').select('*').eq('video_id', video.id).order('start_sec');
  if (error) {
    console.error('Séquences illisibles', error);
    $w('[data-el="side"]').innerHTML = `<p class="text-danger vw-hint">${/video_sequences/.test(error.message)
      ? 'Base à mettre à jour : exécutez supabase/platform_v2.sql.' : escapeHtml(error.message)}</p>`;
    return { video: vid };
  }
  w.seqs = data || [];

  /* ---------- Rendu ---------- */
  const saveLabel = () => ({ saving: 'Enregistrement…', saved: `${vwIc('check')}Enregistré`, error: 'Non enregistré' }[w.save] || '');
  const kindHtml = (s) => `<span class="vw-chip is-clip">Séquence</span>${statusPill(s, viewer)}<span class="vw-save${w.save === 'error' ? ' is-error' : ''}" data-el="save">${saveLabel()}</span>`;
  function render() {
    w.seqs.sort((a, b) => a.start_sec - b.start_sec || a.id - b.id);
    const s = cur();
    shell.dataset.view = s ? 'clip' : 'source';
    shell.dataset.ui = w.ui;
    renderHead(); renderActions(); renderSide();
    $w('[data-el="more"]').classList.toggle('hidden', !s || selecting());
    $w('[data-el="precise"]').classList.toggle('hidden', !w.precise);
    syncTimeline(); syncHist(); syncTime();
    w.shownKey = null;
    if (vid.paused) paintAt(vid.currentTime, false);
  }
  function renderHead() {
    const s = cur(), D = vid.duration || 0, head = $w('[data-el="head"]');
    if (!s) {
      head.innerHTML = `
        ${backHref ? `<a class="back-inline" href="${escapeHtml(backHref)}">${vwIc('back')}Mes vidéos</a>` : ''}
        <div class="vw-kind"><span class="vw-chip">Vidéo source</span><span class="vw-muted">${D ? `${fmtDur(D)} · ` : ''}jamais modifiée</span></div>
        <h1 class="vw-h1">${escapeHtml(video.titre || 'Vidéo')}</h1>
        ${video.description ? `<p class="vw-sub">${escapeHtml(video.description)}</p>` : ''}`;
      return;
    }
    const r = range(s);
    head.innerHTML = `
      <button type="button" class="back-inline" data-act="to-source">${vwIc('back')}${escapeHtml(video.titre || 'Vidéo source')}</button>
      <div class="vw-kind">${kindHtml(s)}</div>
      ${w.fresh === s.id ? `<div class="vw-created" role="status">${vwIc('check')}<span><strong>Séquence créée.</strong> C’est une nouvelle vidéo : la vidéo source reste intacte.</span></div>` : ''}
      <label class="vw-titlefield">${vwIc('pen')}<input type="text" data-el="label" value="${escapeHtml(s.label || '')}" maxlength="80" enterkeyhint="done" aria-label="Titre de la séquence"></label>
      <p class="vw-sub">${fmtDur(r.end - r.start)} · de ${fmtT(r.start)} à ${fmtT(r.end)} dans la vidéo source${s.created_at ? ` · créée le ${escapeHtml(vwDate(s.created_at))}` : ''}</p>`;
  }
  function renderActions() {
    const box = $w('[data-el="actions"]'), s = cur();
    if (selecting()) {
      const trim = w.ui === 'trim';
      box.innerHTML = `
        <div class="vw-select" role="group" aria-label="Sélection d’une portion">
          <div class="vw-select-head">
            <span class="vw-select-title"><strong>${trim ? 'Ajuster le début et la fin' : 'Sélection en cours'}</strong>
              <span class="vw-select-range" data-el="selRange"></span></span>
            <span class="vw-select-tools">
              <button class="vw-ctl" type="button" data-act="sel-play" aria-label="Lire la sélection" title="Lire la sélection">${vwIc('play')}</button>
              <button class="vw-ctl" type="button" data-act="sel-precise" aria-pressed="${w.precise}" aria-label="Précision : image par image" title="Précision : image par image">${vwIc('zoom')}</button>
            </span>
          </div>
          <p class="vw-select-hint">${tu('Tire', 'Tirez')} les poignées dorées : début et fin. Ailleurs, la barre déplace la lecture.</p>
          <div class="vw-select-foot">
            <button class="btn" type="button" data-act="sel-cancel">Annuler</button>
            <button class="btn btn-primary" type="button" data-act="sel-confirm">${vwIc(trim ? 'check' : 'scissors')}<span>${trim ? 'Enregistrer le découpage' : 'Créer la séquence'}</span></button>
          </div>
        </div>`;
      syncSelText();
      return;
    }
    if (!s) {
      box.innerHTML = `<button class="btn btn-primary vw-cta" type="button" data-act="select">${vwIc('scissors')}<span>Sélectionner une portion</span></button>
        <p class="vw-cta-hint">La portion choisie devient une nouvelle séquence. La vidéo source ne change pas.</p>`;
      return;
    }
    if (staff) { box.innerHTML = ''; return; }
    const st = seqStatus(s);
    box.innerHTML = `<button class="btn" type="button" data-act="annotate">${vwIc('pen')}<span>Annoter</span></button>
      ${['draft', 'modified'].includes(st)
        ? `<button class="btn btn-primary" type="button" data-act="send">${vwIc('send')}<span>${st === 'modified' ? 'Renvoyer au staff' : 'Envoyer au staff'}</span></button>`
        : `<span class="vw-sent-line">${vwIc('check')}<span>Envoyée le ${escapeHtml(vwDate(s.submitted_at))} · ${SEQ_STATUS[st].label}</span></span>`}`;
  }
  const clipCard = (s) => {
    const r = range(s), n = (s.drawings || []).length;
    return `<button type="button" class="vw-clip${s.id === w.cur ? ' is-current' : ''}" data-open="${s.id}">
      ${thumbHtml(src, r.start, fmtDur(r.end - r.start))}
      <span class="vw-clip-body">
        <strong>${escapeHtml(s.label || 'Séquence')}</strong>
        <span class="vw-clip-meta">${fmtT(r.start)} → ${fmtT(r.end)}${n ? ` · ${n} annotation${n > 1 ? 's' : ''}` : ''}</span>
        ${statusPill(s, viewer)}
      </span>
    </button>`;
  };
  function renderSide() {
    const side = $w('[data-el="side"]'), s = cur();
    if (!s) {
      side.innerHTML = `
        <h3 class="vw-title">Séquences de cette vidéo ${w.seqs.length ? `<span>(${w.seqs.length})</span>` : ''}</h3>
        ${w.seqs.length ? `<div class="vw-clips">${w.seqs.map(clipCard).join('')}</div>`
          : staff ? '<p class="vw-empty">Aucune séquence. « Sélectionner une portion » pour en créer une.</p>'
          : '<ol class="vw-steps"><li>Sélectionne une portion</li><li>Annote ta séquence</li><li>Envoie-la au staff</li></ol>'}`;
      loadThumbs(side);
      return;
    }
    const r = range(s), fr = frames(), rel = (t) => fmtT(t - r.start);
    side.innerHTML = `
      <section class="vw-block">
        <div class="vw-block-title">Habillage${fr.length ? ` (${fr.length})` : ''}</div>
        ${fr.length ? `<div class="vw-anns">${fr.map((f, i) => `
          <div class="vw-ann">
            <button type="button" class="vw-ann-main" data-frame="${i}"><strong>${rel(f.t)} → ${rel(Math.min(f.t + f.d, r.end))}</strong>
              <span>${escapeHtml([...new Set(f.shapes.map(x => INK_NAMES[x.type] || 'Élément'))].join(', ') || 'Vide')}${f.freeze ? ' · arrêt sur image' : ''}</span></button>
            ${staff ? '' : `<button type="button" data-frame-edit="${i}" aria-label="Modifier l’annotation">${vwIc('pen')}</button>
            <button type="button" data-frame-del="${i}" aria-label="Supprimer l’annotation">${vwIc('x')}</button>`}
          </div>`).join('')}</div>`
          : `<p class="vw-muted">${staff ? 'Aucune annotation du joueur.' : 'Mets pause sur un moment, puis « Annoter » : flèche, repère joueur, projecteur, texte…'}</p>`}
      </section>
      <section class="vw-block">
        <div class="vw-block-title">${staff ? 'Analyse du joueur' : 'Mon analyse'}</div>
        ${staff
          ? `<p class="vw-note">${s.player_note ? escapeHtml(s.player_note).replace(/\n/g, '<br>') : '<span class="vw-muted">Pas encore de commentaire.</span>'}</p>`
          : `<textarea rows="3" data-el="note" placeholder="Ce que tu vois, ce que tu aurais pu faire…">${escapeHtml(s.player_note || '')}</textarea>
             <span class="vw-muted">Enregistrée automatiquement.</span>`}
      </section>
      <section class="vw-block">
        <div class="vw-block-title">Retour du staff</div>
        ${staff
          ? `<textarea rows="3" data-el="feedback" placeholder="Votre retour au joueur…">${escapeHtml(s.staff_feedback || '')}</textarea>
             <button class="btn btn-sm btn-primary" type="button" data-act="feedback">Envoyer mon retour</button>`
          : `<p class="vw-note">${s.staff_feedback ? escapeHtml(s.staff_feedback).replace(/\n/g, '<br>') : '<span class="vw-muted">Pas encore de retour.</span>'}</p>`}
      </section>`;
  }
  /* Après un enregistrement discret (analyse) : statut et boutons, sans
     toucher au champ en cours de saisie. */
  function refreshMeta() {
    const s = cur(), kind = $w('.vw-kind');
    if (s && kind) kind.innerHTML = kindHtml(s);
    renderActions();
  }
  function syncSelText() {
    const el = $w('[data-el="selRange"]'); if (!el || !w.sel) return;
    el.textContent = `${fmtT(w.sel.start)} → ${fmtT(w.sel.end)} · ${fmtDur(w.sel.end - w.sel.start)}`;
  }
  function syncTimeline() {
    const s = cur();
    const tmode = selecting() ? 'select' : s ? 'clip' : 'view';
    tl.update({
      mode: tmode, duration: vid.duration || 0, zoom: w.precise,
      range: tmode === 'select' ? w.sel : range(s),
      seqs: w.seqs.filter(x => !(w.ui === 'trim' && x.id === w.cur)), frames: frames(),
    });
  }
  function setSave(state) {
    w.save = state;
    const el = $w('[data-el="save"]');
    if (el) { el.innerHTML = saveLabel(); el.classList.toggle('is-error', state === 'error'); }
  }

  /* ---------- Lecture, arrêts sur image, habillage dans le temps ---------- */
  let seekRaf = 0, seekTarget = 0, lastT = 0;
  function seekTo(t) {
    seekTarget = Math.max(0, Math.min(vid.duration || t, t));
    if (!seekRaf) seekRaf = requestAnimationFrame(() => { seekRaf = 0; vid.currentTime = seekTarget; });
  }
  const playRange = () => (selecting() ? null : range());
  /* À l'arrêt : l'annotation de l'instant affiché. En lecture : celles dont
     la durée couvre l'instant (les arrêts sur image se jouent à part). */
  function paintAt(t, playing) {
    if (w.ui === 'annotate' || w.holding) return;
    const on = selecting() ? [] : frames().filter(f => (!playing && Math.abs(t - f.t) < .12) || (!f.freeze && t >= f.t - .05 && t < f.t + f.d));
    const key = on.map(f => f.t).join();
    if (key !== w.shownKey) { w.shownKey = key; ink.setShapes(on.flatMap(f => f.shapes)); }
    ink.show(on.length > 0);
  }
  function tick() {
    if (vid.paused || vid.ended) return;
    const t = vid.currentTime;
    const f = selecting() ? null : frames().find(x => x.freeze && lastT < x.t && x.t <= t + .04);
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
  function play(r) {
    endHold();
    if (r) {
      vid.currentTime = r.start; w.stopAt = r.end; lastT = r.start - .01;
      const first = selecting() ? null : frames().find(f => f.freeze && Math.abs(f.t - r.start) < .05);
      if (first) return hold(first);   // arrêt sur image dès la première image
    }
    vid.play().catch(() => {});
  }
  /* Une séquence se lit de son début à sa fin, comme une vidéo à part. */
  function togglePlay() {
    if (w.ui === 'annotate') return;
    if (!vid.paused) { endHold(); return vid.pause(); }
    if (w.holding) { endHold(); return vid.play().catch(() => {}); }
    const r = playRange();
    if (r && (vid.currentTime < r.start - .05 || vid.currentTime >= r.end - .05)) return play(r);
    w.stopAt = r ? r.end : null;
    vid.play().catch(() => {});
  }
  function syncPlay() {
    const b = $w('[data-act="toggle"]'), playing = !vid.paused || !!w.holding;
    b.innerHTML = vwIc(playing ? 'pause' : 'play');
    b.setAttribute('aria-label', playing ? 'Pause' : 'Lecture');
  }
  function syncTime() {
    const t = vid.currentTime || 0, r = playRange();
    $w('[data-el="time"]').textContent = fmtT(r ? t - r.start : t);
    $w('[data-el="total"]').textContent = ` / ${fmtT(r ? r.end - r.start : vid.duration || 0)}`;
    $w('[data-el="ptime"]').textContent = fmtTP(r ? t - r.start : t);
  }
  vid.addEventListener('play', () => { lastT = vid.currentTime; syncPlay(); requestAnimationFrame(tick); });
  vid.addEventListener('pause', syncPlay);
  vid.addEventListener('seeked', () => {
    lastT = vid.currentTime; tl.setTime(vid.currentTime); syncTime();
    if (vid.paused) paintAt(vid.currentTime, false);
  });
  vid.addEventListener('loadedmetadata', () => { render(); const r = range(); if (r && vid.currentTime < r.start) vid.currentTime = r.start; });
  // Toucher la vidéo : lecture / pause (pendant l'annotation, on dessine).
  vid.addEventListener('click', togglePlay);

  function step(dir) {
    endHold(); vid.pause(); w.stopAt = null;
    const r = playRange();
    let t = round2((vid.currentTime || 0) + dir / VW_FPS);
    if (r) t = Math.min(Math.max(t, r.start), r.end);
    seekTo(t);
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
  /* Une opération à la fois : un double toucher ne crée jamais deux séquences. */
  async function run(op) {
    if (w.busy) return false;
    w.busy = true; shell.classList.add('is-busy');
    try {
      if (!(await op.do())) return false;
      hist.undo.push(op); hist.redo = []; syncHist();
      return true;
    } finally { w.busy = false; shell.classList.remove('is-busy'); }
  }
  async function undoOp() {
    if (w.busy) return;
    const op = hist.undo.pop(); if (!op) return;
    if (await op.undo()) { hist.redo.push(op); toast(`Annulé : ${op.label}`, 'success'); } else hist.undo.push(op);
    syncHist();
  }
  async function redoOp() {
    if (w.busy) return;
    const op = hist.redo.pop(); if (!op) return;
    if (await op.do()) { hist.undo.push(op); toast(`Rétabli : ${op.label}`, 'success'); } else hist.redo.push(op);
    syncHist();
  }
  const COPY_FIELDS = ['label', 'start_sec', 'end_sec', 'selected', 'player_note', 'drawings'];
  const copyOf = (s) => Object.fromEntries(COPY_FIELDS.map(k => [k, s[k]]));
  async function insertSeq(fields) {
    setSave('saving');
    const { data: row, error: err } = await sb.from('video_sequences')
      .insert({ club_id: video.club_id, player_id: video.player_id, video_id: video.id, ...fields }).select('*').single();
    if (err) { console.error('Séquence non créée', err); setSave('error'); toast(`Séquence non créée : ${err.message}`, 'error'); return null; }
    setSave('saved');
    w.seqs.push(row); render(); onChange?.();
    return row;
  }
  async function removeSeq(s) {
    const { error: err } = await sb.from('video_sequences').delete().eq('id', s.id);
    if (err) { toast(err.message, 'error'); return false; }
    w.seqs = w.seqs.filter(x => x.id !== s.id);
    if (w.cur === s.id) swap(null, 'view'); else render();
    onChange?.();
    return true;
  }
  async function patch(s, body, { quiet = false, okMsg = '' } = {}) {
    setSave('saving');
    const { data: row, error: err } = await sb.from('video_sequences').update(body).eq('id', s.id).select('*').single();
    if (err) { console.error('Séquence non enregistrée', err); setSave('error'); toast(`Non enregistré : ${err.message}`, 'error'); return false; }
    Object.assign(s, row);
    setSave('saved');
    if (quiet) refreshMeta(); else render();
    if (okMsg) toast(okMsg, 'success');
    onChange?.();
    return true;
  }
  const opRange = (s, start, end) => {
    const old = [s.start_sec, s.end_sec];
    return { label: 'découpage modifié',
      do: () => patch(s, { start_sec: start, end_sec: end }), undo: () => patch(s, { start_sec: old[0], end_sec: old[1] }) };
  };
  const opDup = (s) => {
    let copy = null;
    return { label: 'séquence dupliquée',
      do: async () => !!(copy = await insertSeq({ ...copyOf(s), label: `${s.label || 'Séquence'} (copie)` })),
      undo: () => removeSeq(copy), get row() { return copy; } };
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

  /* ---------- Sélection d'une portion → nouvelle séquence ---------- */
  function initialSelection() {
    const D = vid.duration || 0, t = round2(vid.currentTime || 0);
    const start = D ? Math.max(0, Math.min(t, D - 3)) : t;
    return { start, end: round2(D ? Math.min(D, start + 6) : start + 6) };
  }
  async function confirmSelection() {
    const { start, end } = w.sel;
    if (end - start < TL_MIN) return toast('Sélection trop courte.', 'error');
    if (w.ui === 'trim') {
      const s = cur();
      if (await run(opRange(s, round2(start), round2(end)))) { toast('Découpage enregistré.', 'success'); back(s.id, 'view'); }
      return;
    }
    let row = null;
    const ok = await run({ label: 'séquence créée',
      do: async () => !!(row = await insertSeq({ label: nextSeqLabel(w.seqs), start_sec: round2(start), end_sec: round2(end), selected: !staff })),
      undo: () => removeSeq(row) });
    if (!ok || !row) return;
    w.fresh = row.id;
    setTimeout(() => { if (w.fresh === row.id) { w.fresh = null; if (w.cur === row.id) renderHead(); } }, 5000);
    swap(row.id, 'view');   // la nouvelle vidéo s'ouvre ; « retour » ramène à la source
  }
  function setEdge(field) {
    const t = round2(vid.currentTime || 0);
    if (field === 'start') w.sel.start = Math.min(t, w.sel.end - TL_MIN);
    else w.sel.end = Math.max(t, w.sel.start + TL_MIN);
    syncSelText(); syncTimeline();
  }

  /* ---------- Navigation : source ⇄ séquence ⇄ sélection ⇄ annotation ----------
     Chaque écran a son entrée d'historique : le retour du téléphone
     ramène à l'écran précédent, jamais hors de la page par surprise. */
  let depth = 0;
  const viewState = () => ({ vw: 1, seq: w.cur, ui: w.ui });
  const urlFor = () => {
    const u = new URL(location.href);
    if (w.cur) u.searchParams.set('seq', w.cur); else u.searchParams.delete('seq');
    return u.toString();
  };
  function enter(seq, ui = 'view', annotFrame = null) {
    if (w.ui === 'annotate' && ui !== 'annotate') annot?.stop();
    closeSheet();
    endHold(); if (!vid.paused) vid.pause(); w.stopAt = null;
    const prev = w.cur;
    w.cur = seq && w.seqs.some(s => s.id === seq) ? seq : null;
    w.ui = ui;
    if (!w.cur && (ui === 'annotate' || ui === 'trim')) w.ui = 'view';
    if (staff && w.ui === 'annotate') w.ui = 'view';
    w.sel = w.ui === 'select' ? initialSelection() : w.ui === 'trim' ? range() : null;
    if (!w.sel) w.precise = false;
    if (w.save !== 'error') w.save = '';
    render();
    const s = cur();
    if (w.cur !== prev) {
      if (s) { vid.currentTime = Number(s.start_sec); if (staff) markSeen(s); }
      shell.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    if (w.ui === 'trim') vid.currentTime = w.sel.start;
    if (selecting()) requestAnimationFrame(() => $w('.vw-select')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    if (w.ui === 'annotate') annot?.start(annotFrame);
  }
  function go(seq, ui, annotFrame) {
    enter(seq, ui, annotFrame);
    if (useHistory) { depth++; history.pushState(viewState(), '', urlFor()); }
  }
  function swap(seq, ui) {
    enter(seq, ui);
    if (useHistory) history.replaceState(viewState(), '', urlFor());
  }
  function back(seq, ui) {
    if (useHistory && depth > 0) history.back();
    else swap(seq, ui);
  }
  const onPop = (e) => {
    if (!vid.isConnected) return window.removeEventListener('popstate', onPop);
    if (!e.state?.vw) return;
    depth = Math.max(0, depth - 1);
    if (w.ui === 'annotate' && e.state.ui !== 'annotate' && annot?.dirty
        && !confirm('Ton annotation n’est pas enregistrée. La quitter quand même ?')) {
      depth++; history.pushState(viewState(), '', urlFor());
      return;
    }
    enter(e.state.seq, e.state.ui);
  };
  if (useHistory) window.addEventListener('popstate', onPop);

  /* Le staff ouvre une séquence envoyée : elle passe « Vu » pour le joueur. */
  async function markSeen(s) {
    if (!('seen_at' in s) || !s.submitted_at || (s.seen_at && !isAfter(s.submitted_at, s.seen_at))) return;
    const { data: row, error: err } = await sb.from('video_sequences').update({ seen_at: new Date().toISOString() }).eq('id', s.id).select('*').single();
    if (err) { console.warn('Statut « vu » non enregistré', err.message); return; }
    Object.assign(s, row); refreshMeta(); onChange?.();
  }

  /* ---------- Feuilles (options, envoi) ---------- */
  const sheetEl = $w('[data-el="sheet"]');
  function showSheet(html) { sheetEl.innerHTML = html; sheetEl.classList.remove('hidden'); loadThumbs(sheetEl); }
  function closeSheet() { sheetEl.classList.add('hidden'); sheetEl.innerHTML = ''; }
  function openMore() {
    const s = cur(); if (!s) return;
    showSheet(`<div class="vw-sheet vw-menu" role="dialog" aria-modal="true" aria-label="Options de la séquence">
      <div class="vw-sheet-grip" aria-hidden="true"></div>
      <strong class="vw-menu-title">${escapeHtml(s.label || 'Séquence')}</strong>
      <button type="button" data-act="m-rename">${vwIc('pen')}Renommer</button>
      <button type="button" data-act="m-trim">${vwIc('scissors')}Ajuster le début et la fin</button>
      <button type="button" data-act="m-precise">${vwIc('zoom')}${w.precise ? 'Masquer l’image par image' : 'Image par image'}</button>
      <button type="button" data-act="m-dup">${vwIc('copy')}Dupliquer la séquence</button>
      ${canDelete(s) ? `<button type="button" class="is-danger" data-act="m-del">${vwIc('trash')}Supprimer la séquence</button>` : ''}
      <button type="button" class="vw-menu-close" data-act="sheet-close">Fermer</button>
    </div>`);
  }

  /* ---------- Analyse : enregistrée au fil de la frappe ---------- */
  let noteTimer = 0;
  function saveNote() {
    clearTimeout(noteTimer);
    const s = cur(), el = $w('[data-el="note"]');
    if (!s || !el) return;
    const note = el.value.trim() || null;
    if (note !== (s.player_note || null)) patch(s, { player_note: note }, { quiet: true });
  }
  const flushNote = () => { if (noteTimer) saveNote(); };
  window.addEventListener('pagehide', flushNote);

  /* ---------- Modules : habillage et envoi ---------- */
  const ws = { root, $w, vid, ink, staff, tu, video, src, player, cur, range, frames, run, opFrames,
    patch, showSheet, closeSheet, leave: () => back(w.cur, 'view') };
  if (!staff) {
    annot = createAnnotator(ws);
    sender = createSender(ws);
  }

  /* ---------- Événements ---------- */
  root.addEventListener('click', async (e) => {
    if (e.target === sheetEl) return closeSheet();
    const open = e.target.closest('[data-open]');
    if (open) return go(Number(open.dataset.open), 'view');
    const frameBtn = e.target.closest('[data-frame]');
    if (frameBtn) {
      const f = frames()[Number(frameBtn.dataset.frame)]; if (!f) return;
      endHold(); vid.pause(); w.stopAt = null; vid.currentTime = f.t;
      w.shownKey = null; ink.setShapes(f.shapes); ink.show(true);
      return;
    }
    const frameEdit = e.target.closest('[data-frame-edit]');
    if (frameEdit) return go(w.cur, 'annotate', frames()[Number(frameEdit.dataset.frameEdit)]);
    const frameDel = e.target.closest('[data-frame-del]');
    if (frameDel) {
      const s = cur(), f = frames()[Number(frameDel.dataset.frameDel)]; if (!f) return;
      return run(opFrames(s, (s.drawings || []).filter(x => x.t !== f.t), 'annotation supprimée'));
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const s = cur();
    if (act === 'toggle') return togglePlay();
    if (act === 'rate') return cycleRate();
    if (act === 'fullscreen') return toggleFullscreen();
    if (act === 'frame-back') return step(-1);
    if (act === 'frame-fwd') return step(1);
    if (act === 'undo') return undoOp();
    if (act === 'redo') return redoOp();
    if (act === 'to-source') return back(null, 'view');
    if (act === 'select') return go(null, 'select');
    if (act === 'sel-cancel') return back(w.cur, 'view');
    if (act === 'sel-play') return play(w.sel);
    if (act === 'sel-confirm') return confirmSelection();
    if (act === 'sel-precise') { w.precise = !w.precise; return render(); }
    if (act === 'set-start') return setEdge('start');
    if (act === 'set-end') return setEdge('end');
    if (act === 'more') return openMore();
    if (act === 'sheet-close') return closeSheet();
    if (act === 'send-confirm') return sender?.confirm();
    if (act === 'annotate') return go(w.cur, 'annotate');
    if (act === 'send' && s) { saveNote(); return sender?.open(s); }
    if (act === 'feedback' && s) return patch(s, { staff_feedback: $w('[data-el="feedback"]').value.trim() || null }, { okMsg: 'Retour envoyé au joueur.' });
    // Options de la séquence
    if (act === 'm-rename') { closeSheet(); const i = $w('[data-el="label"]'); i?.focus(); return i?.select(); }
    if (act === 'm-trim') return go(w.cur, 'trim');
    if (act === 'm-precise') { closeSheet(); w.precise = !w.precise; return render(); }
    if (act === 'm-dup' && s) {
      closeSheet();
      const op = opDup(s);
      if (await run(op)) { go(op.row.id, 'view'); toast('Copie créée : l’original reste intact.', 'success'); }
      return;
    }
    if (act === 'm-del' && s) {
      closeSheet();
      if (await run(opDelete(s))) toast('Séquence supprimée. ↶ pour annuler.', 'success');
    }
  });
  root.addEventListener('input', (e) => {
    if (e.target.matches('[data-el="note"]')) { clearTimeout(noteTimer); noteTimer = setTimeout(saveNote, 900); }
  });
  root.addEventListener('change', (e) => {
    const s = cur(); if (!s) return;
    if (e.target.matches('[data-el="note"]')) return saveNote();
    if (e.target.matches('[data-el="label"]')) {
      const label = e.target.value.trim();
      if (!label) { e.target.value = s.label || ''; return; }
      if (label !== s.label) patch(s, { label }, { quiet: true });
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-el="label"]')) { e.preventDefault(); e.target.blur(); }
  });
  // Clavier (ordinateur) : Espace lecture/pause, virgule et point image par image, Échap.
  const onKey = (e) => {
    if (!vid.isConnected) return document.removeEventListener('keydown', onKey);
    if (!root.offsetParent) return;
    if (e.key === 'Escape' && !sheetEl.classList.contains('hidden')) { e.preventDefault(); return closeSheet(); }
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'Escape' && w.ui === 'annotate') { e.preventDefault(); return annot?.cancel(); }
    if (e.key === 'Escape' && selecting()) { e.preventDefault(); return back(w.cur, 'view'); }
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === ',') step(-1);
    else if (e.key === '.') step(1);
  };
  document.addEventListener('keydown', onKey);

  w.cur = focusSeq && w.seqs.some(s => s.id === focusSeq) ? focusSeq : null;
  if (useHistory) history.replaceState(viewState(), '', urlFor());
  render(); syncPlay();
  const s0 = cur();
  if (s0) {
    const open = () => {
      const f = frames()[0];
      vid.currentTime = f ? f.t : Number(s0.start_sec);
      if (staff) markSeen(s0);
    };
    if (vid.readyState >= 1) open(); else vid.addEventListener('loadedmetadata', open, { once: true });
  }
  return { video: vid };
}
