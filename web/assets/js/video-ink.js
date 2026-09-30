/* ============================================================
   FootSession Pro — video-ink.js
   Calque d'habillage posé sur une vidéo. Les formes sont stockées en
   coordonnées relatives (0 à 1) à l'image de la vidéo : elles se
   redessinent à l'identique sur téléphone comme sur grand écran.
     arrow | line | circle | zone     { x1, y1, x2, y2 }
     path   trajectoire (pointillés + flèche)   { pts: [[x, y], …] }
     spot   projecteur : tout s'assombrit sauf l'ellipse   { x1, y1, x2, y2 }
     marker repère joueur : anneau au sol + n° ou nom      { x, y, r, label }
     text   titre ou texte sur fond sombre                 { x, y, text, size }
   ============================================================ */

const INK_COLORS = ['#FAB005', '#E03131', '#1F6FEB', '#F1F3F5'];
const INK_TOOLS = [
  ['arrow', 'Flèche'], ['path', 'Trajectoire'], ['marker', 'Repère joueur'],
  ['circle', 'Cercle'], ['zone', 'Zone'], ['spot', 'Projecteur'], ['text', 'Texte'],
];

function createInk(video, canvas, { onText = null, onChange = null } = {}) {
  const ctx = canvas.getContext('2d');
  const ink = { shapes: [], tool: 'arrow', color: INK_COLORS[0], textSize: 'body', editable: false, box: { x: 0, y: 0, w: 1, h: 1 } };
  let past = [], future = [], draft = null;

  /* Zone réellement occupée par l'image dans <video> (bandes noires
     exclues, object-fit: contain). */
  function fit() {
    const W = video.clientWidth, H = video.clientHeight;
    const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
    const k = Math.min(W / vw, H / vh);
    const w = vw * k, h = vh * k;
    ink.box = { x: (W - w) / 2, y: (H - h) / 2, w, h };
    const dpr = window.devicePixelRatio || 1;
    Object.assign(canvas.style, { left: `${video.offsetLeft + ink.box.x}px`, top: `${video.offsetTop + ink.box.y}px`, width: `${w}px`, height: `${h}px` });
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    draw();
  }

  const lwOf = () => Math.max(3, ink.box.w / 220);
  function arrowHead(x, y, a, lw) {
    const head = lw * 4.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - head * Math.cos(a - .45), y - head * Math.sin(a - .45));
    ctx.lineTo(x - head * Math.cos(a + .45), y - head * Math.sin(a + .45));
    ctx.closePath(); ctx.fill();
  }
  function label(text, x, y, color, px, weight = 700) {
    ctx.font = `${weight} ${px}px Inter, Arial, sans-serif`;
    const tw = ctx.measureText(text).width, pad = px * .45, bh = px * 1.5;
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(10,10,10,.72)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - tw / 2 - pad, y - bh / 2, tw + pad * 2, bh, bh / 3);
    else ctx.rect(x - tw / 2 - pad, y - bh / 2, tw + pad * 2, bh);
    ctx.fill();
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + px * .04);
    ctx.restore();
  }

  function drawShape(s) {
    const { w, h } = ink.box, lw = lwOf();
    const x1 = s.x1 * w, y1 = s.y1 * h, x2 = s.x2 * w, y2 = s.y2 * h;
    ctx.save();
    ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = lw;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 4;
    if (s.type === 'circle') {
      ctx.beginPath();
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.type === 'zone') {
      ctx.globalAlpha = .22; ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      ctx.globalAlpha = 1; ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (s.type === 'path') {
      const pts = (s.pts || []).map(([x, y]) => [x * w, y * h]);
      if (pts.length < 2) { ctx.restore(); return; }
      ctx.setLineDash([lw * 2.6, lw * 2]);
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
      }
      const [lx, ly] = pts[pts.length - 1];
      ctx.lineTo(lx, ly); ctx.stroke(); ctx.setLineDash([]);
      const [px, py] = pts[Math.max(0, pts.length - 4)];
      arrowHead(lx, ly, Math.atan2(ly - py, lx - px), lw);
    } else if (s.type === 'marker') {
      const cx = s.x * w, cy = s.y * h, rx = Math.max(8, s.r * w), ry = rx * .38;
      ctx.globalAlpha = .28; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.lineWidth = lw * 1.1; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
      if (s.label) {
        const px = Math.max(12, w / 36), top = cy - ry - px * 2.6;
        ctx.lineWidth = Math.max(2, lw * .6);
        ctx.beginPath(); ctx.moveTo(cx, cy - ry); ctx.lineTo(cx, top + px * .75); ctx.stroke();
        label(s.label, cx, top, s.color, px);
      }
    } else if (s.type === 'text') {
      const px = Math.max(12, s.size === 'title' ? w / 20 : w / 34);
      label(s.text || '', s.x * w, s.y * h, s.color, px, s.size === 'title' ? 800 : 600);
    } else {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (s.type === 'arrow') arrowHead(x2, y2, Math.atan2(y2 - y1, x2 - x1), lw);
    }
    ctx.restore();
  }

  /* Projecteur : on assombrit l'image, sauf dans les ellipses. */
  function drawSpots(spots) {
    if (!spots.length) return;
    const { w, h } = ink.box;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath(); ctx.rect(0, 0, w, h);
    spots.forEach(s => ctx.ellipse((s.x1 + s.x2) / 2 * w, (s.y1 + s.y2) / 2 * h, Math.abs(s.x2 - s.x1) / 2 * w, Math.abs(s.y2 - s.y1) / 2 * h, 0, 0, Math.PI * 2));
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5;
    spots.forEach(s => {
      ctx.beginPath();
      ctx.ellipse((s.x1 + s.x2) / 2 * w, (s.y1 + s.y2) / 2 * h, Math.abs(s.x2 - s.x1) / 2 * w, Math.abs(s.y2 - s.y1) / 2 * h, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, ink.box.w, ink.box.h);
    const all = draft ? [...ink.shapes, draft] : ink.shapes;
    drawSpots(all.filter(s => s.type === 'spot'));
    all.filter(s => s.type !== 'spot').forEach(drawShape);
  }

  /* Historique propre au calque : chaque ajout ou effacement se défait. */
  const changed = () => { draw(); onChange?.(); };
  function commit(next) { past.push(ink.shapes); future = []; ink.shapes = next; changed(); }

  const rel = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!ink.editable) return;
    e.preventDefault();
    const p = rel(e);
    if (ink.tool === 'text') { onText?.(p, 'text'); return; }
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    if (ink.tool === 'marker') draft = { type: 'marker', color: ink.color, x: p.x, y: p.y, r: .035, label: '' };
    else if (ink.tool === 'path') draft = { type: 'path', color: ink.color, pts: [[p.x, p.y]] };
    else if (ink.tool === 'spot') draft = { type: 'spot', x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    else draft = { type: ink.tool, color: ink.color, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!draft) return;
    const p = rel(e);
    if (draft.type === 'marker') draft.r = Math.max(.02, Math.hypot(p.x - draft.x, (p.y - draft.y) * ink.box.h / ink.box.w));
    else if (draft.type === 'path') {
      const [lx, ly] = draft.pts[draft.pts.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) > .006) draft.pts.push([Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]);
    } else { draft.x2 = p.x; draft.y2 = p.y; }
    draw();
  });
  const finish = () => {
    if (!draft) return;
    const d = draft; draft = null;
    const big = d.type === 'marker' ? true
      : d.type === 'path' ? d.pts.length > 2
      : Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > .015;   // un simple toucher ne crée rien
    if (!big) { draw(); return; }
    commit([...ink.shapes, d]);
    if (d.type === 'marker') onText?.({ x: d.x, y: d.y }, 'marker');
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', () => { draft = null; draw(); });

  new ResizeObserver(fit).observe(video);
  video.addEventListener('loadedmetadata', fit);

  return {
    fit,
    get shapes() { return ink.shapes; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    setShapes(shapes) { ink.shapes = (shapes || []).map(s => ({ ...s })); past = []; future = []; draw(); },
    setTool(t) { ink.tool = t; },
    setColor(c) { ink.color = c; },
    setTextSize(s) { ink.textSize = s; },
    setEditable(on) { ink.editable = on; canvas.classList.toggle('is-drawing', on); },
    addText(p, text) { if (text) commit([...ink.shapes, { type: 'text', color: ink.color, x: p.x, y: p.y, text, size: ink.textSize }]); },
    /* Étiquette du dernier repère posé (n° ou nom, facultatif). */
    labelLast(text) {
      const last = ink.shapes[ink.shapes.length - 1];
      if (last?.type !== 'marker' || !text) return;
      ink.shapes = [...ink.shapes.slice(0, -1), { ...last, label: text }];
      changed();
    },
    toClient(p) { const r = canvas.getBoundingClientRect(); return { x: r.left + p.x * r.width, y: r.top + p.y * r.height }; },
    undo() { if (!past.length) return; future.push(ink.shapes); ink.shapes = past.pop(); changed(); },
    redo() { if (!future.length) return; past.push(ink.shapes); ink.shapes = future.pop(); changed(); },
    clear() { if (ink.shapes.length) commit([]); },
    show(on) { canvas.classList.toggle('is-off', !on); },
  };
}
