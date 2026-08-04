/* ============================================================
   FootSession Pro — pdf-coach.js
   « Fiche coach » : à distribuer au staff juste avant la séance.

   Un procédé par QUART de page A4 paysage, soit 4 procédés par
   feuille — au-delà, on passe en recto verso (8 procédés = 2 pages).
   Le schéma occupe l'essentiel du quart ; le texte se limite au
   nom, à la structure des séquences et au principe de jeu.

   Exposé : window.generateCoachPDF(sessionId)
   ============================================================ */

const COACH_PER_PAGE = 4;          // 2 colonnes × 2 rangées
const SCHEMA_SHARE = 0.65;         // part de la largeur du quart pour le schéma

window.generateCoachPDF = async function (sessionId) {
  const lib = window.jspdf;
  if (!lib || !lib.jsPDF) { toast('Module PDF non chargé.', 'error'); return; }
  toast('Génération de la fiche coach…');

  const loaded = await window.loadSessionForPdf(sessionId);
  if (!loaded) return;
  const { s, procedures } = loaded;

  const { NAVY, LIGHT, LINE, DARK, MUT, imgSize, hexRgb, GOLD } = window.PDF_THEME;
  const { jsPDF } = lib;
  const doc = new jsPDF('l', 'mm', 'a4');
  const W = 297, H = 210, M = 7;
  const gold = hexRgb(s.club_color) || GOLD;

  const fill = (x, y, w, h, rgb) => { doc.setFillColor(rgb[0], rgb[1], rgb[2]); doc.rect(x, y, w, h, 'F'); };
  const box = (x, y, w, h) => { doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3); doc.rect(x, y, w, h); };

  /* Bandeau haut de page, volontairement bas : chaque millimètre gagné
     ici profite aux schémas. */
  const banner = (pageNo, nbPages) => {
    const h = 11;
    fill(0, 0, W, H, [255, 255, 255]);
    fill(M, M, W - 2 * M, h, NAVY);
    if (s.club_logo) {
      try { doc.addImage(s.club_logo, M + 1.2, M + 1, h - 2, h - 2); } catch (e) {}
    }
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text((s.titre || 'Séance').toUpperCase(), M + h + 2, M + h / 2, { baseline: 'middle' });

    const infos = [
      fmtDateFr(s.date_seance),
      s.equipe || null,
      `${procedures.length} procédé${procedures.length > 1 ? 's' : ''}`,
      `travail ${fmtMin(sessionWorkMin(procedures))}'`,
      `total ${fmtMin(sessionTotalMin(procedures))}'`,
    ].filter(Boolean).join('   ·   ');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
    doc.text(infos, W - M - 2, M + h / 2, { align: 'right', baseline: 'middle' });

    doc.setDrawColor(...gold); doc.setLineWidth(0.7);
    doc.line(M, M + h + 0.9, W - M, M + h + 0.9);

    doc.setFontSize(7); doc.setTextColor(...MUT); doc.setFont('helvetica', 'normal');
    doc.text(`FootSession Pro · fiche coach`, M, H - 3);
    doc.text(`Page ${pageNo} / ${nbPages}`, W - M, H - 3, { align: 'right' });
    return M + h + 3;
  };

  if (!procedures.length) {
    const top = banner(1, 1);
    fill(M, top, W - 2 * M, 14, LIGHT); box(M, top, W - 2 * M, 14);
    doc.setTextColor(...MUT); doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text('Aucun procédé enregistré.', W / 2, top + 7, { align: 'center', baseline: 'middle' });
    doc.save(fileName(s));
    toast('Fiche coach générée', 'success');
    return;
  }

  // Ratio de chaque schéma, résolu une seule fois.
  const ratios = await Promise.all(procedures.map(async p => {
    if (!p.canvas_image) return null;
    const sz = await imgSize(p.canvas_image);
    return sz ? sz.w / sz.h : 1040 / 680;
  }));

  const nbPages = Math.ceil(procedures.length / COACH_PER_PAGE);

  for (let page = 0; page < nbPages; page++) {
    if (page > 0) doc.addPage();
    const top = banner(page + 1, nbPages);

    // Géométrie des quatre quarts.
    const gap = 3;
    const cellW = (W - 2 * M - gap) / 2;
    const cellH = (H - top - 6 - gap) / 2;

    const slice = procedures.slice(page * COACH_PER_PAGE, (page + 1) * COACH_PER_PAGE);
    slice.forEach((p, k) => {
      const gi = page * COACH_PER_PAGE + k;
      const col = k % 2, row = Math.floor(k / 2);
      const x = M + col * (cellW + gap);
      const y = top + row * (cellH + gap);
      drawQuarter(p, gi, x, y, cellW, cellH, ratios[gi]);
    });
  }

  /* ---------- Un quart de page ---------- */
  function drawQuarter(p, index, x, y, w, h, ratio) {
    const pad = 2.2;
    box(x, y, w, h);

    // Bandeau de titre du procédé.
    const tH = 6.4;
    fill(x, y, w, tH, NAVY);
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.4);
    doc.text(`${index + 1}. ${(p.nom || 'Procédé').toUpperCase()}`, x + 2, y + tH / 2, { baseline: 'middle' });
    // Séquences alignées à droite du bandeau : l'information la plus utile sur le terrain.
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
    doc.text(sequenceLabel(p), x + w - 2, y + tH / 2, { align: 'right', baseline: 'middle' });

    const innerY = y + tH + pad;
    const innerH = h - tH - 2 * pad;
    const schemaW = w * SCHEMA_SHARE - pad;
    const textX = x + w * SCHEMA_SHARE + pad * 0.5;
    const textW = w * (1 - SCHEMA_SHARE) - pad * 1.5;

    // --- Schéma, au plus grand possible dans sa zone ---
    if (p.canvas_image && ratio) {
      let iw = schemaW, ih = iw / ratio;
      if (ih > innerH) { ih = innerH; iw = ih * ratio; }
      const ix = x + pad + (schemaW - iw) / 2, iy = innerY + (innerH - ih) / 2;
      try { doc.addImage(p.canvas_image, 'PNG', ix, iy, iw, ih); } catch (e) {}
      doc.setDrawColor(...LINE); doc.setLineWidth(0.25); doc.rect(ix, iy, iw, ih);
    } else {
      // Pas de schéma : le texte récupère toute la largeur du quart.
      drawText(x + pad, innerY, w - 2 * pad, innerH, true);
      return;
    }

    drawText(textX, innerY, textW, innerH, false);

    /* Colonne de texte : type et espace en tête, puis le principe de jeu.
       La police se réduit si nécessaire pour ne jamais déborder du quart. */
    function drawText(tx, ty, tw, th, wide) {
      let cy = ty;
      const meta = [p.type_procede, [p.taille_terrain, p.effectif].filter(Boolean).join(' · ')]
        .filter(Boolean).join('   ·   ');
      if (meta) {
        doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8);
        const ml = doc.splitTextToSize(meta.toUpperCase(), tw);
        doc.text(ml, tx, cy, { baseline: 'top' });
        cy += ml.length * 2.9 + 1.6;
      }
      if (!p.principes_jeu) return;

      doc.setTextColor(...DARK); doc.setFont('helvetica', 'normal');
      // On essaie plusieurs corps jusqu'à ce que le principe tienne entièrement.
      const budget = th - (cy - ty);
      for (const fs of [8, 7.4, 6.8, 6.2, 5.6]) {
        doc.setFontSize(fs);
        const lineH = fs * 0.42;
        const lines = doc.splitTextToSize(p.principes_jeu, tw);
        if (lines.length * lineH <= budget || fs === 5.6) {
          const maxLines = Math.max(1, Math.floor(budget / lineH));
          const shown = lines.slice(0, maxLines);
          if (lines.length > maxLines) shown[shown.length - 1] += ' […]';
          doc.text(shown, tx, cy, { baseline: 'top' });
          return;
        }
      }
    }
  }

  doc.save(fileName(s));
  toast('Fiche coach générée', 'success');
};

function fileName(s) {
  return `seance-${(s.titre || 'footsession').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-fiche-coach.pdf`;
}
