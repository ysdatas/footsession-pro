/* ============================================================
   FootSession Pro — pdf-coach.js
   « Fiche coach » : tout le déroulé sur UNE SEULE feuille A4
   paysage, à distribuer au staff juste avant la séance.

   Priorité au texte (principe de jeu, consignes) ; les schémas
   sont réduits à des vignettes. Si le contenu ne tient pas, on
   resserre par paliers puis on tronque les consignes en dernier.

   Exposé : window.generateCoachPDF(sessionId)
   ============================================================ */

/* Paliers d'ajustement, du plus confortable au plus dense.
   On retient le premier qui permet de tenir sur une page. */
const COACH_STEPS = [
  { fs: 9,   lineH: 3.9, thumb: 34, gap: 3.4, pad: 2.6 },
  { fs: 8,   lineH: 3.4, thumb: 30, gap: 2.6, pad: 2.2 },
  { fs: 7,   lineH: 3.0, thumb: 26, gap: 2.0, pad: 1.8 },
  { fs: 6.5, lineH: 2.7, thumb: 22, gap: 1.6, pad: 1.5 },
];

window.generateCoachPDF = async function (sessionId) {
  const lib = window.jspdf;
  if (!lib || !lib.jsPDF) { toast('Module PDF non chargé.', 'error'); return; }
  toast('Génération de la fiche coach…');

  const loaded = await window.loadSessionForPdf(sessionId);
  if (!loaded) return;
  const { s, procedures } = loaded;

  const { NAVY, LIGHT, LINE, DARK, MUT } = window.PDF_THEME;
  const { jsPDF } = lib;
  const doc = new jsPDF('l', 'mm', 'a4');
  const W = 297, H = 210, M = 8;
  const { CW, fill, box, header, pageHeader, footer, infoTable } = window.pdfHelpers(doc, s, W, H, M);

  fill(0, 0, W, H, [255, 255, 255]);
  let top = pageHeader(s.titre || 'Séance', null);

  const travail = sessionWorkMin(procedures);
  const total = sessionTotalMin(procedures);
  top = infoTable(top,
    ['DATE', 'ÉQUIPE', 'NB PROCÉDÉS', 'TEMPS DE TRAVAIL', 'TEMPS TOTAL'],
    [s.date_seance || '-', s.equipe || '-', String(procedures.length),
     fmtMin(travail) + "'", fmtMin(total) + "'"],
    [1.2, 1, 1, 1.3, 1.1]);
  top += 4;

  if (!procedures.length) {
    fill(M, top, CW, 12, LIGHT); box(M, top, CW, 12);
    doc.setTextColor(...MUT); doc.setFontSize(9);
    doc.text('Aucun procédé enregistré.', M + CW / 2, top + 6, { align: 'center', baseline: 'middle' });
    footer(`FootSession Pro · ${s.titre || ''}`, 'Fiche coach');
    doc.save(fileName(s));
    toast('Fiche coach générée', 'success');
    return;
  }

  // Ratios des vignettes, résolus une seule fois.
  const ratios = await Promise.all(procedures.map(async p => {
    if (!p.canvas_image) return null;
    const sz = await window.PDF_THEME.imgSize(p.canvas_image);
    return sz ? sz.w / sz.h : 1040 / 680;
  }));

  const avail = H - top - 10;   // hauteur utile jusqu'au pied de page

  /* ---------- Mise en page mesurée : on essaie chaque palier ---------- */
  let layout = null;
  for (const st of COACH_STEPS) {
    const blocks = measure(st, false);
    if (blocks.height <= avail) { layout = { st, blocks }; break; }
  }
  // Aucun palier ne suffit : on reprend le plus dense en tronquant les consignes.
  if (!layout) {
    const st = COACH_STEPS[COACH_STEPS.length - 1];
    layout = { st, blocks: measure(st, true, avail) };
  }

  /* Calcule la hauteur de chaque bloc procédé pour un palier donné.
     `clamp` limite les consignes pour rentrer dans `budget`. */
  function measure(st, clamp, budget) {
    doc.setFontSize(st.fs);
    const titleH = st.fs * 0.5 + 2.2;         // nom du procédé
    const metaH = st.lineH + 1;               // ligne type · séquences · espace
    const textW = CW - st.thumb - st.gap - 2 * st.pad - 2;

    const items = procedures.map((p, i) => {
      const principe = p.principes_jeu ? doc.splitTextToSize('Principe : ' + p.principes_jeu, textW) : [];
      let consignes = p.consignes ? doc.splitTextToSize('Consignes : ' + p.consignes, textW) : [];
      const thumbH = ratios[i] ? st.thumb / ratios[i] : 0;
      return { p, i, principe, consignes, thumbH };
    });

    const bodyH = (it) => (it.principe.length + it.consignes.length) * st.lineH;
    const blockH = (it) => Math.max(
      titleH + metaH + bodyH(it) + 2 * st.pad,
      it.thumbH ? it.thumbH + 2 * st.pad : 0,
    );

    if (clamp) {
      // On rogne les consignes (jamais le principe de jeu) jusqu'à tenir.
      let guard = 400;
      while (guard-- > 0) {
        const h = items.reduce((sum, it) => sum + blockH(it) + st.gap, 0) - st.gap;
        if (h <= budget) break;
        // Cible le bloc dont les consignes sont les plus longues.
        const victim = items.filter(it => it.consignes.length > 1)
          .sort((a, b) => b.consignes.length - a.consignes.length)[0];
        if (!victim) break;
        victim.consignes = victim.consignes.slice(0, -1);
        victim.truncated = true;
      }
    }

    const height = items.reduce((sum, it) => sum + blockH(it) + st.gap, 0) - st.gap;
    return { items, height, titleH, metaH, textW, blockH };
  }

  /* ---------- Tracé ---------- */
  const { st, blocks } = layout;
  const { items, titleH, metaH, blockH } = blocks;
  let y = top;

  items.forEach((it) => {
    const p = it.p;
    const h = blockH(it);
    fill(M, y, CW, h, LIGHT); box(M, y, CW, h);

    // Bandeau numéroté sur la tranche gauche, pour repérer l'ordre d'un coup d'œil.
    fill(M, y, 1.6, h, NAVY);

    let tx = M + st.pad + 2;
    // Vignette du schéma, calée à droite du bloc.
    if (it.thumbH) {
      const ix = M + CW - st.pad - st.thumb;
      try { doc.addImage(p.canvas_image, 'PNG', ix, y + st.pad, st.thumb, it.thumbH); } catch (e) {}
      doc.setDrawColor(...LINE); doc.setLineWidth(0.25);
      doc.rect(ix, y + st.pad, st.thumb, it.thumbH);
    }

    let ty = y + st.pad;
    doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(st.fs + 0.8);
    doc.text(`${it.i + 1}. ${(p.nom || 'Procédé').toUpperCase()}`, tx, ty, { baseline: 'top' });
    ty += titleH;

    const meta = [
      p.type_procede, sequenceLabel(p),
      [p.taille_terrain, p.effectif].filter(Boolean).join(' · '),
    ].filter(Boolean).join('   ·   ');
    doc.setTextColor(...MUT); doc.setFont('helvetica', 'normal'); doc.setFontSize(st.fs - 0.7);
    doc.text(meta || '—', tx, ty, { baseline: 'top' });
    ty += metaH;

    doc.setTextColor(...DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(st.fs);
    if (it.principe.length) { doc.text(it.principe, tx, ty, { baseline: 'top' }); ty += it.principe.length * st.lineH; }
    if (it.consignes.length) {
      const lines = it.truncated ? it.consignes.slice(0, -1).concat(it.consignes.slice(-1)[0] + ' […]') : it.consignes;
      doc.text(lines, tx, ty, { baseline: 'top' });
    }

    y += h + st.gap;
  });

  footer(`FootSession Pro · ${s.titre || ''}`, 'Fiche coach — avant séance');
  doc.save(fileName(s));
  toast('Fiche coach générée', 'success');
};

function fileName(s) {
  return `seance-${(s.titre || 'footsession').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-fiche-coach.pdf`;
}
