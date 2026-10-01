/* ============================================================
   FootSession Pro — video-timeline.js
   Timeline tactile, en trois modes qui ne se mélangent pas :
     view    vidéo source en lecture : barre fine, on touche pour se
             déplacer ; les séquences déjà créées apparaissent en filigrane.
     select  « Sélectionner » : la portion choisie est dorée, avec deux
             poignées (début, fin) et sa durée.
     clip    une séquence ouverte : barre fine de 0 à sa durée, comme
             une vidéo à part entière, avec ses annotations.
   Un geste = une fonction : tirer une poignée règle la sélection ;
   partout ailleurs, toucher ou glisser déplace la tête de lecture.
     createTimeline(el, { onSeek(t), onTrim(field, t, done), onGesture(on, kind) })
       .update({ mode, duration, range: { start, end }, seqs, frames, zoom })   .setTime(t)
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
      <div class="vt-fill" data-el="fill"></div>
      <div class="vt-segs" data-el="segs"></div>
      <div class="vt-range" data-el="range"><span class="vt-dur" data-el="dur"></span></div>
      <div class="vt-marks" data-el="marks"></div>
      <button type="button" class="vt-handle is-start" data-h="start" aria-label="Début de la sélection : tirer"><span></span></button>
      <button type="button" class="vt-handle is-end" data-h="end" aria-label="Fin de la sélection : tirer"><span></span></button>
      <div class="vt-head" data-el="head"><span class="vt-tip" data-el="tip"></span></div>
    </div>
    <div class="vt-scale"><span data-el="from"></span><span class="vt-zoomed" data-el="zoomed"></span><span data-el="to"></span></div>`;
  const $t = (s) => el.querySelector(s);
  const track = $t('[data-el="track"]');
  const st = { mode: 'view', duration: 0, time: 0, range: null, seqs: [], frames: [], zoom: false, drag: null, frozen: null };

  /* Fenêtre affichée (secondes de la vidéo source). */
  function win() {
    if (st.frozen) return st.frozen;
    const D = st.duration || 1;
    if (st.mode === 'clip' && st.range) return [st.range.start, st.range.end];
    if (st.mode !== 'select' || !st.range) return [0, D];
    // Sélection courte dans une longue vidéo (un match) : on zoome dessus.
    const { start: a, end: b } = st.range;
    if (!st.zoom && (b - a) / D >= .08) return [0, D];
    const pad = Math.max(1.5, (b - a) * .3);
    return [Math.max(0, a - pad), Math.min(D, Math.max(b + pad, a + 6))];
  }
  const pct = (t) => { const [a, b] = win(); return Math.min(100, Math.max(0, ((t - a) / (b - a || 1)) * 100)); };
  const timeAt = (clientX) => {
    const r = track.getBoundingClientRect(), [a, b] = win();
    return a + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (b - a);
  };
  const edge = (f) => (st.drag?.field === f ? st.drag.t : st.range?.[f]);
  /* En mode séquence, les temps affichés partent de 0 (début de la séquence). */
  const label = (t) => fmtT(st.mode === 'clip' ? t - st.range.start : t);

  function paint() {
    el.dataset.mode = st.mode;
    const [a, b] = win();
    const zoomed = st.mode === 'select' && (a > 0 || b < (st.duration || 0));
    $t('[data-el="from"]').textContent = zoomed ? fmtTP(a) : label(a);
    $t('[data-el="to"]').textContent = zoomed ? fmtTP(b) : label(b);
    $t('[data-el="zoomed"]').textContent = zoomed ? 'Zoom sur la sélection' : '';
    $t('[data-el="segs"]').innerHTML = st.mode === 'clip' ? '' : st.seqs.filter(s => s.end_sec > a && s.start_sec < b)
      .map(s => `<i style="left:${pct(s.start_sec)}%;width:${Math.max(.6, pct(s.end_sec) - pct(s.start_sec))}%"></i>`).join('');
    if (st.mode === 'select' && st.range) {
      const s = edge('start'), e = edge('end');
      $t('[data-el="range"]').style.left = `${pct(s)}%`;
      $t('[data-el="range"]').style.width = `${pct(e) - pct(s)}%`;
      $t('[data-el="dur"]').textContent = fmtDur(e - s);
      $t('.vt-handle.is-start').style.left = `${pct(s)}%`;
      $t('.vt-handle.is-end').style.left = `${pct(e)}%`;
    }
    $t('[data-el="marks"]').innerHTML = st.mode === 'clip' ? st.frames.map(f =>
      `<i style="left:${pct(f.t)}%;width:${Math.max(.8, pct(Math.min(f.t + f.d, st.range.end)) - pct(f.t))}%"></i>`).join('') : '';
    setTime(st.time);
  }
  function setTime(t) {
    st.time = t;
    $t('[data-el="head"]').style.left = `${pct(t)}%`;
    $t('[data-el="fill"]').style.width = `${pct(t)}%`;
  }

  /* ---------- Gestes ---------- */
  function move(e) {
    const d = st.drag; if (!d) return;
    let t = timeAt(e.clientX);
    const tip = $t('[data-el="tip"]');
    if (d.kind === 'trim') {
      t = d.field === 'start' ? Math.min(t, st.range.end - TL_MIN) : Math.max(t, st.range.start + TL_MIN);
      d.t = Math.round(Math.max(0, Math.min(st.duration, t)) * 100) / 100;
      tip.textContent = `${d.field === 'start' ? 'Début' : 'Fin'} ${fmtTP(d.t)}`;
      onTrim(d.field, d.t, false);
      setTime(d.t); paint();
    } else {
      if (st.mode === 'clip') t = Math.min(Math.max(t, st.range.start), st.range.end);
      tip.textContent = st.mode === 'clip' ? fmtTP(t - st.range.start) : fmtTP(t);
      onSeek(t); setTime(t);
    }
  }
  track.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !st.duration) return;
    e.preventDefault();
    const h = st.mode === 'select' ? e.target.closest('.vt-handle') : null;
    st.frozen = win();   // la fenêtre ne bouge pas pendant le geste
    st.drag = h ? { kind: 'trim', field: h.dataset.h, t: st.range[h.dataset.h] } : { kind: 'seek' };
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
    if (!h || st.mode !== 'select' || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const step = (e.shiftKey ? 1 : .1) * (e.key === 'ArrowLeft' ? -1 : 1);
    const f = h.dataset.h, r = st.range;
    const t = f === 'start' ? Math.min(r.start + step, r.end - TL_MIN) : Math.max(r.end + step, r.start + TL_MIN);
    onTrim(f, Math.round(Math.max(0, Math.min(st.duration, t)) * 100) / 100, true);
  });

  return {
    update(next) { Object.assign(st, next); paint(); },
    setTime,
    get busy() { return !!st.drag; },
  };
}
