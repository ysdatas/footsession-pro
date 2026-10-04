/* ============================================================
   LMFC Performance — pdf-kit.js
   Mise en page commune des documents PDF (jsPDF, texte vectoriel :
   net à l'impression, sélectionnable, jamais rogné).

   Composition LMFC :
     - en-tête du document : blason, rubrique du club, titre, faits
       clés à droite, sur un panneau clair, sans filet ;
     - pages suivantes : rappel discret (nom du document, club) ;
     - rubriques numérotées (01, 02…) ;
     - tableaux légers : en-tête gris, filets fins, chiffres alignés à
       droite ; une ligne n'est jamais coupée par un saut de page et
       l'en-tête se répète en haut de la page suivante ;
     - pied de page : le numéro de page, rien d'autre.
   Couleur d'accent : celle du club (Mon club), rendue lisible sur
   fond blanc ; à défaut, le rouge du Mans FC.

   const kit = await openPdf({ orientation, accent, runTitle, runRight });
   kit.cover({...}) · kit.section(t) · kit.text(t) · kit.table({...})
   kit.kpis([...]) · kit.radar({...}) · kit.images([...]) · kit.save(nom)
   ============================================================ */

const PDF_INK = [20, 22, 27], PDF_TEXT = [44, 49, 57], PDF_MUTE = [108, 115, 126], PDF_SOFT = [158, 164, 173];
const PDF_LINE = [226, 229, 234], PDF_PANEL = [245, 246, 248], PDF_RED = [200, 16, 46];
const PDF_GOOD = [36, 130, 70], PDF_BAD = [190, 45, 45];

async function loadJsPdf() {
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  await (loadJsPdf.p ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = resolve;
    s.onerror = () => { loadJsPdf.p = null; reject(new Error('Générateur PDF indisponible (connexion ?)')); };
    document.head.append(s);
  }));
  return window.jspdf.jsPDF;
}

/* Image distante (Storage, page) → data URL pour jsPDF ; null si illisible. */
async function urlToDataUrl(url) {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(blob); });
  } catch (e) { console.warn('Image indisponible pour le PDF', url.slice(0, 80), e); return null; }
}
let pdfCrestPromise = null;
const pdfCrest = () => (pdfCrestPromise ||= urlToDataUrl(baseUrl('assets/img/lmfc-logo.png')));
function pdfImageSize(src) {
  return new Promise(res => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res(null); im.src = src; });
}
/* Image prête pour jsPDF : redessinée en JPEG (ou PNG si elle a de la
   transparence), 1600 px au plus. Tout format lisible par le navigateur
   passe (WebP, SVG, photo de téléphone) ; { data, w, h, fmt } ou null. */
async function pdfImage(url, maxSide = 1600, { square = false } = {}) {
  const src = await urlToDataUrl(url);
  if (!src) return null;
  const im = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  if (!im || !im.naturalWidth) return null;
  // square : recadrage au centre (photo d'identité).
  const sw = square ? Math.min(im.naturalWidth, im.naturalHeight) : im.naturalWidth;
  const sh = square ? sw : im.naturalHeight;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  const g = c.getContext('2d');
  // PNG seulement si l'image a vraiment de la transparence (maillot détouré) :
  // un schéma ou une photo pèse dix fois moins en JPEG.
  let alpha = false;
  if (!square && /^data:image\/(png|webp|svg)/.test(src)) {
    const t = document.createElement('canvas'); t.width = t.height = 32;
    const tg = t.getContext('2d'); tg.drawImage(im, 0, 0, 32, 32);
    const px = tg.getImageData(0, 0, 32, 32).data;
    for (let i = 3; i < px.length && !alpha; i += 4) alpha = px[i] < 250;
  }
  if (!alpha) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, 0, 0, c.width, c.height);
  return { data: alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.88), fmt: alpha ? 'PNG' : 'JPEG', w: c.width, h: c.height };
}

/* Couleur du club, assez foncée pour du texte sur blanc. */
function pdfAccent(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  let c = m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : PDF_RED;
  const lum = (v) => v.map(x => x / 255).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
  for (let i = 0; i < 12 && lum(c) > 0.42; i++) c = c.map(x => Math.round(x * 0.86));
  return c;
}

/* Caractères hors des polices PDF standard : remplacés par leur équivalent. */
const pdfStr = (s) => String(s ?? '').replace(/−/g, '-').replace(/[  ]/g, ' ').replace(/[  ]/g, ' ')
  .replace(/[^\u0000-ÿ‘’“”…–—Œœ€•]/g, '');

async function openPdf({ orientation = 'p', accent = null, runTitle = '', runRight = '' } = {}) {
  const jsPDF = await loadJsPdf();
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = orientation === 'l' ? 11 : 14, CW = W - 2 * M;
  const TOP = orientation === 'l' ? 19 : 22, BOTTOM = H - 15;
  const ACC = pdfAccent(accent);
  const crest = await pdfCrest();
  let sectionNo = 0;

  const k = {
    doc, W, H, M, CW, ACC, y: M, bottom: BOTTOM,
    font(size, style = 'normal', color = PDF_TEXT) { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); },
    fill(x, y, w, h, rgb, r = 0) { doc.setFillColor(...rgb); if (r) doc.roundedRect(x, y, w, h, r, r, 'F'); else doc.rect(x, y, w, h, 'F'); },
    hline(x1, x2, y, rgb = PDF_LINE, lw = 0.2) { doc.setDrawColor(...rgb); doc.setLineWidth(lw); doc.line(x1, y, x2, y); },
    lines(text, width, size) { doc.setFontSize(size); return doc.splitTextToSize(pdfStr(text), width); },
    lh: (size) => size * 0.3528 * 1.32,   // hauteur de ligne (mm) pour une taille en points
    write(text, x, y, opts = {}) { doc.text(Array.isArray(text) ? text.map(pdfStr) : pdfStr(text), x, y, { baseline: 'top', ...opts }); },

    /* Page suivante : rappel du document en haut, à gauche le titre, à droite le club. */
    newPage() {
      doc.addPage();
      if (crest) { try { doc.addImage(crest, 'PNG', M, 8.2, 6.2, 6.2); } catch (e) { console.warn('Blason non ajouté', e); } }
      k.font(7.8, 'normal', PDF_MUTE); k.write(runRight, W - M, 9.8, { align: 'right' });
      const room = CW - (crest ? 8.6 : 0) - doc.getTextWidth(pdfStr(runRight)) - 8;
      k.font(8.2, 'bold', PDF_INK);
      let run = pdfStr(runTitle);
      while (run.length > 4 && doc.getTextWidth(run) > room) run = `${run.slice(0, -2).trimEnd()}…`;
      k.write(run, M + (crest ? 8.6 : 0), 9.6);
      k.y = TOP;
      return k.y;
    },
    /* Garde h mm d'un seul tenant : sinon, page suivante. */
    ensure(h) { if (k.y + h > BOTTOM) k.newPage(); return k.y; },

    /* En-tête du document (première page). facts : [[libellé, valeur]]. */
    cover({ kicker = '', title = '', subtitle = '', facts = [] }) {
      const pad = 7, crestS = orientation === 'l' ? 17 : 20;
      const textX = M + pad + (crest ? crestS + 6 : 0);
      const factsW = facts.length ? Math.min(62, CW * 0.3) : 0;
      const textW = CW - (textX - M) - pad - (factsW ? factsW + 6 : 0);
      // Titre long (nom composé) : la taille baisse au lieu de couper le texte.
      let ts = orientation === 'l' ? 18 : 19, titleLines = k.lines(title, textW, ts);
      while (titleLines.length > 2 && ts > 12) { ts -= 1.5; titleLines = k.lines(title, textW, ts); }
      const subLines = subtitle ? k.lines(subtitle, textW, 9.2) : [];
      const textH = 4.2 + titleLines.length * k.lh(ts) + (subLines.length ? 1.6 + subLines.length * k.lh(9.2) : 0);
      const factsH = facts.length * 8.6;
      const h = Math.max(crestS, textH, factsH) + 2 * pad;
      k.fill(M, M, CW, h, PDF_PANEL, 3);
      if (crest) { try { doc.addImage(crest, 'PNG', M + pad, M + (h - crestS) / 2, crestS, crestS); } catch (e) { console.warn('Blason non ajouté', e); } }
      let ty = M + (h - textH) / 2;
      k.font(7.2, 'bold', ACC); k.write(kicker.toUpperCase(), textX, ty, { charSpace: 0.35 });
      ty += 4.2;
      k.font(ts, 'bold', PDF_INK); k.write(titleLines, textX, ty);
      ty += titleLines.length * k.lh(ts);
      if (subLines.length) { ty += 1.6; k.font(9.2, 'normal', PDF_MUTE); k.write(subLines, textX, ty); }
      let fy = M + (h - factsH) / 2;
      facts.forEach(([label, value]) => {
        k.font(6.4, 'bold', PDF_SOFT); k.write(String(label).toUpperCase(), W - M - pad, fy, { align: 'right', charSpace: 0.25 });
        k.font(8.6, 'normal', PDF_TEXT); k.write(k.lines(value, factsW, 8.6)[0] || '—', W - M - pad, fy + 3.2, { align: 'right' });
        fy += 8.6;
      });
      k.y = M + h + 9;
      return k.y;
    },

    /* Rubrique numérotée. keep : hauteur minimale à garder avec le titre. */
    section(title, { keep = 26, note = '' } = {}) {
      k.ensure(10 + keep);
      sectionNo += 1;
      k.font(8.5, 'bold', ACC); k.write(String(sectionNo).padStart(2, '0'), M, k.y + 0.8);
      k.font(12.5, 'bold', PDF_INK); k.write(title, M + 8.5, k.y);
      if (note) {
        const tw = doc.getTextWidth(pdfStr(title));
        k.font(8.4, 'normal', PDF_MUTE); k.write(note, M + 8.5 + tw + 3, k.y + 1.3);
      }
      k.y += 8.6;
      return k.y;
    },

    /* Paragraphe, coupé proprement d'une page à l'autre. */
    text(str, { size = 9, color = PDF_TEXT, style = 'normal', x = M, width = CW, after = 2.5 } = {}) {
      if (!str) return k.y;
      const lines = k.lines(str, width, size), lh = k.lh(size);
      lines.forEach(line => { k.ensure(lh); k.font(size, style, color); k.write(line, x, k.y); k.y += lh; });
      k.y += after;
      return k.y;
    },

    /* Tableau. cols : [{ label, w (part de la largeur), align }].
       rows : tableaux de cellules (texte, ou { text, color, bold }). */
    table({ cols, rows, x = M, width = CW, size = 8.6, empty = 'Aucune donnée.' }) {
      const sum = cols.reduce((s, c) => s + (c.w || 1), 0);
      const widths = cols.map(c => (c.w || 1) / sum * width);
      const headH = 7.2, padX = 2.2, lh = k.lh(size);
      const head = () => {
        k.fill(x, k.y, width, headH, PDF_PANEL, 1.2);
        let cx = x;
        cols.forEach((c, i) => {
          k.font(6.6, 'bold', PDF_MUTE);
          const tx = c.align === 'right' ? cx + widths[i] - padX : cx + padX;
          k.write(k.lines(String(c.label).toUpperCase(), widths[i] - 2 * padX, 6.6)[0] || '', tx, k.y + 2.4, { align: c.align === 'right' ? 'right' : 'left', charSpace: 0.2 });
          cx += widths[i];
        });
        k.y += headH;
      };
      if (!rows.length) { k.text(empty, { color: PDF_MUTE, style: 'italic' }); return k.y; }
      k.ensure(headH + lh + 4.4);
      head();
      rows.forEach((row) => {
        const cells = row.map((c, i) => {
          const o = c && typeof c === 'object' ? c : { text: c };
          return { ...o, lines: k.lines(o.text == null || o.text === '' ? '—' : o.text, widths[i] - 2 * padX, size) };
        });
        const rowH = Math.max(...cells.map(c => c.lines.length)) * lh + 4.2;
        if (k.y + rowH > BOTTOM) { k.newPage(); head(); }
        let cx = x;
        cells.forEach((c, i) => {
          k.font(size, c.bold || (i === 0 && cols[0].strong) ? 'bold' : 'normal', c.color || PDF_TEXT);
          const right = cols[i].align === 'right';
          k.write(c.lines, right ? cx + widths[i] - padX : cx + padX, k.y + 2.2, { align: right ? 'right' : 'left' });
          cx += widths[i];
        });
        k.y += rowH;
        k.hline(x, x + width, k.y);
      });
      k.y += 5;
      return k.y;
    },

    /* Chiffres clés : [{ label, value, sub }], sur une rangée. */
    kpis(items, { h = 19 } = {}) {
      if (!items.length) return k.y;
      k.ensure(h + 4);
      const gap = 3.5, w = (CW - gap * (items.length - 1)) / items.length;
      items.forEach((it, i) => {
        const x = M + i * (w + gap);
        k.fill(x, k.y, w, h, PDF_PANEL, 2.2);
        k.font(6.4, 'bold', PDF_MUTE); k.write(String(it.label).toUpperCase(), x + 3.6, k.y + 3.4, { charSpace: 0.2 });
        k.font(14.5, 'bold', PDF_INK); k.write(it.value ?? '—', x + 3.6, k.y + 7.4);
        if (it.sub) { k.font(6.8, 'normal', PDF_MUTE); k.write(k.lines(it.sub, w - 7, 6.8)[0], x + 3.6, k.y + 14.1); }
      });
      k.y += h + 6;
      return k.y;
    },

    /* Petite pastille (statut) ; right : x est son bord droit. Renvoie sa largeur. */
    pill(text, x, y, rgb = PDF_MUTE, { right = false } = {}) {
      k.font(6.6, 'bold', rgb);
      const w = doc.getTextWidth(pdfStr(text)) + 4.4;
      if (right) x -= w;
      doc.setDrawColor(...rgb); doc.setLineWidth(0.25); doc.roundedRect(x, y, w, 4.6, 2.3, 2.3, 'S');
      k.write(text, x + 2.2, y + 1.15);
      return w;
    },

    /* Radar sur 10 (profil athlétique). axes : [{ label, value }], ref : valeurs du groupe. */
    radar({ x, y, size, axes, ref = null }) {
      const cx = x + size / 2, cy = y + size / 2 + 1, R = size / 2 - 9;
      const pt = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / axes.length; return [cx + Math.cos(a) * R * v / 10, cy + Math.sin(a) * R * v / 10]; };
      const poly = (pts, style) => doc.lines(pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]), pts[0][0], pts[0][1], [1, 1], style, true);
      doc.setLineWidth(0.18); doc.setDrawColor(...PDF_LINE);
      [2, 4, 6, 8, 10].forEach(v => poly(axes.map((_, i) => pt(i, v)), 'S'));
      axes.forEach((_, i) => { const [px, py] = pt(i, 10); doc.line(cx, cy, px, py); });
      const full = (vals) => vals.every(v => v !== null && v !== undefined);
      if (ref && full(ref)) {
        doc.setLineDashPattern([1.2, 1], 0); doc.setDrawColor(...PDF_SOFT); doc.setLineWidth(0.35);
        poly(ref.map((v, i) => pt(i, v)), 'S');
        doc.setLineDashPattern([], 0);
      }
      const vals = axes.map(a => a.value);
      if (full(vals)) {
        const pts = vals.map((v, i) => pt(i, v));
        doc.setGState(new doc.GState({ opacity: 0.16 })); doc.setFillColor(...ACC); poly(pts, 'F');
        doc.setGState(new doc.GState({ opacity: 1 }));
        doc.setDrawColor(...ACC); doc.setLineWidth(0.55); poly(pts, 'S');
      }
      vals.forEach((v, i) => { if (v === null || v === undefined) return; const [px, py] = pt(i, v); doc.setFillColor(...ACC); doc.circle(px, py, 0.75, 'F'); });
      axes.forEach((a, i) => {
        const [px, py] = pt(i, 12.4);
        const align = Math.abs(px - cx) < 2 ? 'center' : px < cx ? 'right' : 'left';
        k.font(6.8, 'normal', PDF_MUTE); k.write(a.label, px, py - 2.2, { align });
        k.font(8, 'bold', PDF_INK); k.write(a.value === null || a.value === undefined ? '—' : fmtPdf(a.value, 1), px, py + 0.9, { align });
      });
    },

    /* Images en grille (2 par rangée), légendes dessous ; une rangée ne se coupe pas. */
    async images(list, { perRow = 2, maxH = 62 } = {}) {
      const ready = (await Promise.all(list.map(async (im) => {
        const img = await pdfImage(im.src);
        return img ? { ...im, data: img.data, fmt: img.fmt, ratio: img.w / img.h } : null;
      }))).filter(Boolean);
      const gap = 4, w = (CW - gap * (perRow - 1)) / perRow;
      for (let i = 0; i < ready.length; i += perRow) {
        const row = ready.slice(i, i + perRow).map(im => {
          let iw = w, ih = w / im.ratio;
          if (ih > maxH) { ih = maxH; iw = ih * im.ratio; }
          return { ...im, iw, ih, cap: im.caption ? k.lines(im.caption, w, 7.2).slice(0, 2) : [] };
        });
        const rowH = Math.max(...row.map(r => r.ih + (r.cap.length ? 1.6 + r.cap.length * k.lh(7.2) : 0)));
        k.ensure(rowH + 2);
        row.forEach((r, j) => {
          const x = M + j * (w + gap);
          try { doc.addImage(r.data, r.fmt, x, k.y, r.iw, r.ih); } catch (e) { console.warn('Image non ajoutée au PDF', e); }
          if (r.cap.length) { k.font(7.2, 'normal', PDF_MUTE); k.write(r.cap, x, k.y + r.ih + 1.6); }
        });
        k.y += rowH + 4;
      }
      return k.y;
    },

    /* Numéros de page, puis téléchargement. */
    save(fileName) {
      const n = doc.getNumberOfPages();
      for (let i = 1; i <= n; i++) {
        doc.setPage(i);
        k.font(7.4, 'normal', PDF_SOFT);
        k.write(`${i} / ${n}`, W - M, H - 9.4, { align: 'right' });
      }
      doc.save(fileName);
    },
  };
  return k;
}

const fmtPdf = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d).replace('.', ','));
const pdfFileName = (...parts) => `${parts.filter(Boolean).join('-').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document'}.pdf`;
