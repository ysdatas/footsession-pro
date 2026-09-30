/* ============================================================
   FootSession Pro — video-timeline.js
   Timeline tactile d'une vidéo : la vidéo entière, ses séquences, la
   séquence choisie avec deux poignées (début, fin), ses annotations
   et la tête de lecture. On touche pour se déplacer, on tire une
   poignée pour couper. En mode précision, elle zoome sur la séquence.
     createTimeline(el, { onSeek(t), onTrim(field, t, done), onGesture(on) })
       .update({ duration, seqs, cur, frames, zoom })   .setTime(t)
   ============================================================ */

const TL_MIN = 0.5;   // durée minimale d'une séquence (s)
const fmtTP = (sec) => {
  sec = Math.max(0, Number(sec) || 0);
  return `${fmtT(sec)},${Math.floor((sec % 1) * 10 + 1e-6)}`;
};

function createTimeline(el, { onSeek, onTrim, onGesture }) {
  el.classList.add('vt');
  el.innerHTML = `
    <div class="vt-track" data-el="track">
      <div class="vt-segs" data-el="segs"></div>
      <div class="vt-range hidden" data-el="range"><span class="vt-dur" data-el="dur"></span></div>
      <div class="vt-marks" data-el="marks"></div>
      <button type="button" class="vt-handle is-start hidden" data-h="start_sec" aria-label="Début de la séquence : tirer pour couper"><span></span></button>
      <button type="button" class="vt-handle is-end hidden" data-h="end_sec" aria-label="Fin de la séquence : tirer pour couper"><span></span></button>
      <div class="vt-head" data-el="head"><span class="vt-tip" data-el="tip"></span></div>
    </div>
    <div class="vt-scale"><span data-el="from"></span><span class="vt-zoomed" data-el="zoomed"></span><span data-el="to"></span></div>`;
  const $t = (s) => el.querySelector(s);
  const track = $t('[data-el="track"]');
  const st = { duration: 0, time: 0, seqs: [], cur: null, frames: [], zoom: false, drag: null, frozen: null };

  /* Fenêtre affichée : toute la vidéo, ou la séquence et ses abords (précision). */
  function win() {
    if (st.frozen) return st.frozen;
    const D = st.duration || 1;
    if (!st.zoom) return [0, D];
    const a = st.cur ? Number(st.cur.start_sec) : st.time, b = st.cur ? Number(st.cur.end_sec) : st.time;
    const pad = Math.max(1.5, (b - a) * .25);
    return [Math.max(0, a - pad), Math.min(D, Math.max(b + pad, a + 6))];
  }
  const pct = (t) => { const [a, b] = win(); return Math.min(100, Math.max(0, ((t - a) / (b - a || 1)) * 100)); };
  const timeAt = (clientX) => {
    const r = track.getBoundingClientRect(), [a, b] = win();
    return a + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (b - a);
  };
  const edge = (field) => (st.drag?.field === field ? st.drag.t : Number(st.cur?.[field]));

  function paint() {
    const [a, b] = win();
    $t('[data-el="from"]').textContent = st.zoom ? fmtTP(a) : fmtT(a);
    $t('[data-el="to"]').textContent = st.zoom ? fmtTP(b) : fmtT(b);
    $t('[data-el="zoomed"]').textContent = st.zoom ? (st.cur ? 'Zoom sur la séquence' : 'Zoom') : '';
    $t('[data-el="segs"]').innerHTML = st.seqs.filter(s => s !== st.cur && s.end_sec > a && s.start_sec < b)
      .map(s => `<i style="left:${pct(s.start_sec)}%;width:${pct(s.end_sec) - pct(s.start_sec)}%"></i>`).join('');
    const range = $t('[data-el="range"]');
    const on = !!st.cur;
    range.classList.toggle('hidden', !on);
    el.querySelectorAll('.vt-handle').forEach(h => h.classList.toggle('hidden', !on));
    if (on) {
      const s = edge('start_sec'), e = edge('end_sec');
      range.style.left = `${pct(s)}%`; range.style.width = `${pct(e) - pct(s)}%`;
      $t('[data-el="dur"]').textContent = fmtDur(e - s);
      $t('.vt-handle.is-start').style.left = `${pct(s)}%`;
      $t('.vt-handle.is-end').style.left = `${pct(e)}%`;
    }
    $t('[data-el="marks"]').innerHTML = (on ? st.frames : []).map(f =>
      `<i style="left:${pct(f.t)}%;width:${Math.max(.8, pct(Math.min(f.t + (f.d || 3), edge('end_sec'))) - pct(f.t))}%" title="Annotation à ${fmtT(f.t)}"></i>`).join('');
    setTime(st.time);
  }
  function setTime(t) {
    st.time = t;
    $t('[data-el="head"]').style.left = `${pct(t)}%`;
  }

  /* ---------- Gestes ---------- */
  function move(e) {
    const d = st.drag; if (!d) return;
    let t = timeAt(e.clientX);
    const tip = $t('[data-el="tip"]');
    if (d.kind === 'trim') {
      t = d.field === 'start_sec'
        ? Math.min(t, Number(st.cur.end_sec) - TL_MIN)
        : Math.max(t, Number(st.cur.start_sec) + TL_MIN);
      d.t = Math.round(Math.max(0, Math.min(st.duration, t)) * 100) / 100;
      tip.textContent = `${d.field === 'start_sec' ? 'Début' : 'Fin'} ${fmtTP(d.t)}`;
      onTrim(d.field, d.t, false);
      setTime(d.t); paint();
    } else {
      tip.textContent = fmtTP(t);
      onSeek(t); setTime(t);
    }
  }
  track.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !st.duration) return;
    e.preventDefault();
    const h = e.target.closest('.vt-handle');
    st.frozen = win();   // la fenêtre ne bouge pas pendant le geste
    st.drag = h ? { kind: 'trim', field: h.dataset.h, t: Number(st.cur[h.dataset.h]) } : { kind: 'seek' };
    try { track.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    el.classList.add('is-active', h ? 'is-trimming' : 'is-seeking');
    onGesture?.(true, st.drag.kind);
    move(e);
  });
  track.addEventListener('pointermove', move);
  const end = () => {
    const d = st.drag; if (!d) return;
    st.drag = null; st.frozen = null;
    el.classList.remove('is-active', 'is-trimming', 'is-seeking');
    if (d.kind === 'trim') onTrim(d.field, d.t, true);
    onGesture?.(false, d.kind);
    paint();
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  /* Clavier : ← → déplacent une poignée de 0,1 s (Maj : 1 s). */
  el.addEventListener('keydown', (e) => {
    const h = e.target.closest('.vt-handle');
    if (!h || !st.cur || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const step = (e.shiftKey ? 1 : .1) * (e.key === 'ArrowLeft' ? -1 : 1);
    const f = h.dataset.h, other = Number(st.cur[f === 'start_sec' ? 'end_sec' : 'start_sec']);
    const t = f === 'start_sec' ? Math.min(Number(st.cur[f]) + step, other - TL_MIN) : Math.max(Number(st.cur[f]) + step, other + TL_MIN);
    onTrim(f, Math.round(Math.max(0, Math.min(st.duration, t)) * 100) / 100, true);
  });

  return {
    update(next) { Object.assign(st, next); paint(); },
    setTime,
    get busy() { return !!st.drag; },
  };
}
