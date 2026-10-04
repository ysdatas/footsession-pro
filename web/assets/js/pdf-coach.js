/* ============================================================
   LMFC Performance — pdf-coach.js
   « Fiche coach » : à distribuer au staff juste avant la séance.

   Un procédé par QUART de page A4 paysage, soit 4 procédés par
   feuille — au-delà, on passe en recto verso (8 procédés = 2 pages).
   Le schéma occupe l'essentiel du quart ; le texte se limite au
   nom, à la structure des séquences et à l'objectif. En page 1,
   sous le bandeau : le principe de jeu de la séance et les équipes
   (chasubles) en colonnes compactes.

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
  const { s, procedures, attendance } = loaded;
  const principe = sessionPrinciple(s, procedures);
  const teams = sessionTeams(s, attendance);

  const { INK, LIGHT, LINE, PANEL, DARK, MUT, imgSize, hexRgb, ACCENT } = window.PDF_THEME;
  const str = (t) => (typeof pdfStr === 'function' ? pdfStr(t) : String(t ?? ''));
  const { jsPDF } = lib;
  const doc = new jsPDF('l', 'mm', 'a4');
  const W = 297, H = 210, M = 7;
  const gold = typeof pdfAccent === 'function' ? pdfAccent(s.club_color) : (hexRgb(s.club_color) || ACCENT);

  const fill = (x, y, w, h, rgb) => { doc.setFillColor(rgb[0], rgb[1], rgb[2]); doc.rect(x, y, w, h, 'F'); };
  const box = (x, y, w, h) => { doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3); doc.rect(x, y, w, h); };

  /* Bandeau haut de page, volontairement bas : chaque millimètre gagné
     ici profite aux schémas. */
  const banner = () => {
    const h = 12;
    fill(0, 0, W, H, [255, 255, 255]);
    doc.setFillColor(...PANEL); doc.roundedRect(M, M, W - 2 * M, h, 2, 2, 'F');
    if (s.club_logo) {
      try { doc.addImage(s.club_logo, M + 2, M + 1.5, h - 3, h - 3); } catch (e) { console.warn('Logo du club non ajouté', e); }
    }
    const tx = M + (s.club_logo ? h + 1.5 : 3);
    doc.setTextColor(...gold); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.8);
    doc.text(str(`${s.coach_club || 'Le Mans FC'} · Fiche coach`.toUpperCase()), tx, M + 3.2, { baseline: 'top', charSpace: 0.25 });
    doc.setTextColor(...INK); doc.setFontSize(10.5);
    doc.text(str(s.titre || 'Séance'), tx, M + 6.1, { baseline: 'top' });

    const infos = [
      fmtDateFr(s.date_seance),
      s.equipe || null,
      `${procedures.length} procédé${procedures.length > 1 ? 's' : ''}`,
      `travail ${fmtMin(sessionWorkMin(procedures))}'`,
      `total ${fmtMin(sessionTotalMin(procedures))}'`,
    ].filter(Boolean).join('   ·   ');
    doc.setTextColor(...MUT); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
    doc.text(str(infos), W - M - 3, M + h / 2, { align: 'right', baseline: 'middle' });
    return M + h + 3;
  };

  /* Page 1, sous le bandeau : principe de jeu puis équipes. Renvoie la
     hauteur prise (0 si rien à afficher) ; `dry` mesure sans dessiner. */
  const sessionStrip = (top, dry) => {
    const w = W - 2 * M;
    let hUsed = 0;
    if (principe) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      const lines = doc.splitTextToSize('Principe de jeu : ' + principe, w - 4).slice(0, 2);
      const ph = lines.length * 3.5 + 2.4;
      if (!dry) {
        fill(M, top, w, ph, LIGHT); fill(M, top, 1.6, ph, gold);
        doc.setTextColor(...DARK); doc.setFont('helvetica', 'bold');
        doc.text(lines, M + 3.4, top + 1.4, { baseline: 'top' });
      }
      hUsed += ph + 1.8;
    }
    if (teams.length) hUsed += drawTeamColumns(doc, { x: M, y: top + hUsed, w, teams, fs: 6.8, dry, maxCols: 8 }) + 2;
    return hUsed;
  };

  if (!procedures.length) {
    const below = banner();
    const top = below + sessionStrip(below, false);
    fill(M, top, W - 2 * M, 14, LIGHT); box(M, top, W - 2 * M, 14);
    doc.setTextColor(...MUT); doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text('Aucun procédé enregistré.', W / 2, top + 7, { align: 'center', baseline: 'middle' });
    numberPages(doc, W, H, M);
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
    let top = banner();
    if (page === 0) top += sessionStrip(top, false);

    // Géométrie des quatre quarts.
    const gap = 3;
    const cellW = (W - 2 * M - gap) / 2;
    const cellH = (H - top - 9 - gap) / 2;   // le bas de page garde son numéro

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

    // Titre du procédé sur panneau clair, numéro dans la couleur du club.
    const tH = 6.4;
    fill(x, y, w, tH, PANEL);
    doc.setTextColor(...gold); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.4);
    doc.text(`${index + 1}`, x + 2.2, y + tH / 2, { baseline: 'middle' });
    // Séquences alignées à droite du bandeau : l'information la plus utile sur le terrain.
    doc.setTextColor(...MUT); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
    const seq = str(sequenceLabel(p));
    doc.text(seq, x + w - 2, y + tH / 2, { align: 'right', baseline: 'middle' });
    // Nom du procédé : raccourci s'il touche les séquences, jamais par-dessus.
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.4);
    const room = w - 6.5 - doc.getTextWidth(seq) - 6;
    let title = str((p.nom || 'Procédé').toUpperCase());
    while (title.length > 4 && doc.getTextWidth(title) > room) title = `${title.slice(0, -2).trimEnd()}…`;
    doc.text(title, x + 6.5, y + tH / 2, { baseline: 'middle' });

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
        doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8);
        const ml = doc.splitTextToSize(meta.toUpperCase(), tw);
        doc.text(ml, tx, cy, { baseline: 'top' });
        cy += ml.length * 2.9 + 1.6;
      }
      // Ancien procédé avec son propre principe : il le garde. Sinon l'objectif.
      const own = (p.principes_jeu || '').trim();
      const body = own && own !== principe ? 'Principe : ' + own : (p.objectif ? 'Objectif : ' + p.objectif : (p.consignes || ''));
      if (!body) return;

      doc.setTextColor(...DARK); doc.setFont('helvetica', 'normal');
      // On essaie plusieurs corps jusqu'à ce que le texte tienne entièrement.
      const budget = th - (cy - ty);
      for (const fs of [8, 7.4, 6.8, 6.2, 5.6]) {
        doc.setFontSize(fs);
        const lineH = fs * 0.42;
        const lines = doc.splitTextToSize(body, tw);
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

  numberPages(doc, W, H, M);
  doc.save(fileName(s));
  toast('Fiche coach générée', 'success');
};

function fileName(s) {
  return `seance-${(s.titre || 'lmfc-performance').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')}-fiche-coach.pdf`;
}
