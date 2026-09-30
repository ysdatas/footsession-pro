/* ============================================================
   FootSession Pro — video-ink.js
   Calque de dessin posé sur une vidéo : flèche, cercle, zone,
   trait. Volontairement simple : on met une image en pause, on
   dessine, on enregistre. Les formes sont stockées en coordonnées
   relatives (0 à 1) à l'image de la vidéo, pour se redessiner
   à l'identique quelle que soit la taille de l'écran.
     shape = { type: 'arrow'|'circle'|'zone'|'line', color, x1, y1, x2, y2 }
   ============================================================ */

const INK_COLORS = ['#FAB005', '#E03131', '#1F6FEB', '#F1F3F5'];
const INK_TOOLS = [['arrow', '➚', 'Flèche'], ['circle', '◯', 'Cercle'], ['zone', '▭', 'Zone'], ['line', '╱', 'Trait']];

function createInk(video, canvas) {
  const ctx = canvas.getContext('2d');
  const ink = { shapes: [], tool: 'arrow', color: INK_COLORS[0], editable: false, box: { x: 0, y: 0, w: 1, h: 1 } };
  let draft = null;

  /* Zone réellement occupée par l'image dans l'élément <video>
     (bandes noires exclues, object-fit: contain). */
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

  function drawShape(s) {
    const { w, h } = ink.box;
    const x1 = s.x1 * w, y1 = s.y1 * h, x2 = s.x2 * w, y2 = s.y2 * h;
    const lw = Math.max(3, w / 220);
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
    } else {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (s.type === 'arrow') {
        const a = Math.atan2(y2 - y1, x2 - x1), head = lw * 4.2;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(a - .45), y2 - head * Math.sin(a - .45));
        ctx.lineTo(x2 - head * Math.cos(a + .45), y2 - head * Math.sin(a + .45));
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, ink.box.w, ink.box.h);
    ink.shapes.forEach(drawShape);
    if (draft) drawShape(draft);
  }

  const rel = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!ink.editable) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    const p = rel(e);
    draft = { type: ink.tool, color: ink.color, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!draft) return;
    const p = rel(e); draft.x2 = p.x; draft.y2 = p.y; draw();
  });
  canvas.addEventListener('pointerup', () => {
    if (!draft) return;
    // Un simple clic ne crée rien.
    if (Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 0.015) ink.shapes.push(draft);
    draft = null; draw();
  });

  new ResizeObserver(fit).observe(video);
  video.addEventListener('loadedmetadata', fit);

  return {
    fit,
    get shapes() { return ink.shapes; },
    setShapes(shapes) { ink.shapes = (shapes || []).map(s => ({ ...s })); draw(); },
    setTool(t) { ink.tool = t; },
    setColor(c) { ink.color = c; },
    setEditable(on) { ink.editable = on; canvas.classList.toggle('is-drawing', on); },
    undo() { ink.shapes.pop(); draw(); },
    clear() { ink.shapes = []; draw(); },
    show(on) { canvas.classList.toggle('hidden', !on); },
  };
}
