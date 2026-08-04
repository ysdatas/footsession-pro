/* ============================================================
   FootSession Pro — pdf-generator.js
   Export PDF PAYSAGE inspiré d'une fiche de séance pro.

   Page 1 : récapitulatif complet (infos, déroulé, présences).
            Les procédés SANS schéma tactique y sont détaillés en
            sous-ligne, pour ne pas gaspiller une page presque vide.
   Puis    : une page par procédé QUI POSSÈDE un schéma tactique.

   Exposé : window.generateSessionPDF(sessionId)
            window.loadSessionForPdf(sessionId)   (réutilisé par pdf-coach.js)
            window.PDF_THEME, window.imgSize      (idem)
   ============================================================ */

const NAVY = [26, 54, 90];
const LIGHT = [241, 244, 247];
const LINE = [206, 213, 221];
const DARK = [34, 40, 48];
const MUT = [110, 118, 128];
const GOLD = [201, 168, 76];

function imgSize(src) {
  return new Promise(res => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res(null); im.src = src; });
}
const short = (t, n = 26) => { t = (t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : (t || '-'); };
const initials = (s) => (s || 'FS').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
const hexRgb = (h) => { if (!/^#[0-9a-f]{6}$/i.test(h || '')) return null; const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/* Convertit un fichier du Storage en data URL (jsPDF n'accepte pas d'URL distante). */
async function storageToDataUrl(bucket, path) {
  if (!path) return null;
  try {
    const { data, error } = await sb.storage.from(bucket).download(path);
    if (error || !data) return null;
    return await new Promise(res => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => res(null);
      fr.readAsDataURL(data);
    });
  } catch (e) { return null; }
}

/* ============================================================
   Chargement des données — commun aux deux exports.
   Renvoie null et signale l'erreur en cas d'échec.
   ============================================================ */
window.loadSessionForPdf = async function (sessionId) {
  try {
    const { data: sess, error: e1 } = await sb.from('sessions').select('*').eq('id', sessionId).single();
    if (e1 || !sess) throw e1 || new Error('Séance introuvable.');
    const s = sess;

    const [{ data: procs }, { data: clubRow }, { data: players }, { data: att }] = await Promise.all([
      sb.from('procedures').select('*, tactical_schemas(image_path, canvas_json)').eq('session_id', sessionId).order('ordre'),
      sb.from('clubs').select('nom, color, logo_path').eq('id', s.club_id).single(),
      sb.from('players').select('id, nom, prenom, numero'),
      sb.from('attendance').select('player_id, present').eq('session_id', sessionId),
    ]);
    const club = clubRow || {};

    // Résout les images (Storage → data URL) en parallèle.
    const procedures = await Promise.all((procs || []).map(async p => ({
      ...p,
      canvas_json: p.tactical_schemas?.canvas_json || null,
      canvas_image: await storageToDataUrl('schemas', p.tactical_schemas?.image_path),
    })));

    const attMap = {};
    (att || []).forEach(a => attMap[a.player_id] = !!a.present);
    const attendance = (players || []).map(p => ({ ...p, present: !!attMap[p.id] }));

    s.coach_club = club.nom || '';
    s.club_color = club.color || '';
    s.club_logo = await storageToDataUrl('logos', club.logo_path);
    // Nom du créateur de la séance (si le profil est visible dans le club).
    if (s.created_by) {
      const { data: author } = await sb.from('profiles').select('nom').eq('id', s.created_by).maybeSingle();
      s.coach_nom = author?.nom || '';
    }
    return { s, procedures, attendance };
  } catch (e) {
    toast(e.message || 'Erreur de chargement.', 'error');
    return null;
  }
};

/* Fabrique les helpers de dessin pour un document donné : partagés
   entre la fiche complète et la fiche coach. */
window.PDF_THEME = { NAVY, LIGHT, LINE, DARK, MUT, GOLD, imgSize, short, initials, hexRgb };

function pdfHelpers(doc, s, W, H, M) {
  const CW = W - 2 * M;
  const gold = hexRgb(s.club_color) || GOLD;

  const fill = (x, y, w, h, rgb) => { doc.setFillColor(rgb[0], rgb[1], rgb[2]); doc.rect(x, y, w, h, 'F'); };
  const box = (x, y, w, h) => { doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3); doc.rect(x, y, w, h); };
  const header = (x, y, w, h, text, fs = 6.4) => {
    fill(x, y, w, h, NAVY);
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(fs);
    const lines = doc.splitTextToSize(String(text).toUpperCase(), w - 2);
    doc.text(lines, x + w / 2, y + h / 2, { align: 'center', baseline: 'middle' });
  };
  const cell = (x, y, w, h, text, o = {}) => {
    fill(x, y, w, h, o.fill || LIGHT); box(x, y, w, h);
    if (text == null || text === '') return;
    doc.setTextColor(...(o.color || DARK)); doc.setFont('helvetica', o.bold ? 'bold' : 'normal'); doc.setFontSize(o.fs || 9);
    const lines = doc.splitTextToSize(String(text), w - 4);
    if (o.top) doc.text(lines, x + 2.5, y + 4, { align: 'left', baseline: 'top' });
    else doc.text(lines, x + w / 2, y + h / 2, { align: 'center', baseline: 'middle' });
  };

  /* En-tête commun (logo club + titre + sous-titre). La hauteur s'adapte
     au nombre de lignes du sous-titre pour que la ligne dorée ne
     chevauche jamais le texte. */
  const pageHeader = (title, subtitle) => {
    const ty = 7, subFs = 8.5, subLineH = 4.4;
    let subLines = [];
    if (subtitle) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(subFs);
      subLines = doc.splitTextToSize(subtitle, CW * 0.66).slice(0, 3);
    }
    const titleY = ty + 6;
    const subStartY = titleY + 6.5;
    const textBottom = subLines.length ? subStartY + (subLines.length - 1) * subLineH + 2 : titleY + 4;
    const ruleY = Math.max(ty + 16, textBottom + 4);

    if (s.club_logo) {
      try { doc.addImage(s.club_logo, M, ty, 16, 15); } catch (e) { fill(M, ty, 16, 14, NAVY); }
    } else {
      fill(M, ty, 16, 14, NAVY);
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.text(initials(s.coach_club), M + 8, ty + 7, { align: 'center', baseline: 'middle' });
    }
    doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(String(title).toUpperCase(), W / 2, titleY, { align: 'center', baseline: 'middle' });
    if (subLines.length) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(subFs); doc.setTextColor(...MUT);
      subLines.forEach((ln, i) => doc.text(ln, W / 2, subStartY + i * subLineH, { align: 'center', baseline: 'middle' }));
    }
    if (s.coach_nom) {
      doc.setTextColor(...MUT); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text('Coach : ' + s.coach_nom, W - M, ty + 3, { align: 'right' });
    }
    doc.setDrawColor(...gold); doc.setLineWidth(0.8); doc.line(M, ruleY, W - M, ruleY);
    return ruleY + 4;
  };

  const footer = (left, right) => {
    doc.setFontSize(7.5); doc.setTextColor(...MUT); doc.setFont('helvetica', 'normal');
    doc.text(left, M, H - 4);
    if (right) doc.text(right, W - M, H - 4, { align: 'right' });
  };

  /* Tableau générique : libellés + valeurs, largeurs proportionnelles. */
  const infoTable = (y, labels, values, weights) => {
    const sw = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map(w => w / sw * CW);
    const hH = 8, vH = 10;
    let cx = M;
    widths.forEach((w, i) => { header(cx, y, w, hH, labels[i], 5.8); cx += w; });
    cx = M;
    widths.forEach((w, i) => { cell(cx, y + hH, w, vH, values[i], { fs: 8.5 }); cx += w; });
    return y + hH + vH;
  };

  return { CW, gold, fill, box, header, cell, pageHeader, footer, infoTable };
}
window.pdfHelpers = pdfHelpers;

window.generateSessionPDF = async function (sessionId) {
  const lib = window.jspdf;
  if (!lib || !lib.jsPDF) { toast('Module PDF non chargé.', 'error'); return; }
  toast('Génération du PDF…');

  const loaded = await window.loadSessionForPdf(sessionId);
  if (!loaded) return;
  const { s, procedures, attendance } = loaded;

  const { jsPDF } = lib;
  const doc = new jsPDF('l', 'mm', 'a4');   // PAYSAGE
  const W = 297, H = 210, M = 8;
  const { CW, fill, box, header, cell, pageHeader, footer, infoTable } = pdfHelpers(doc, s, W, H, M);

  /* ============================================================
     PAGE 1 — RÉCAPITULATIF DE LA SÉANCE
     ============================================================ */
  fill(0, 0, W, H, [255, 255, 255]);
  let y = pageHeader(s.titre || 'Séance', null);

  const travail = sessionWorkMin(procedures);
  const total = sessionTotalMin(procedures);
  y = infoTable(y,
    ['DATE', 'ÉQUIPE', 'DURÉE SÉANCE', 'NB PROCÉDÉS', 'TEMPS DE TRAVAIL', 'TEMPS TOTAL'],
    [fmtDateFr(s.date_seance), s.equipe || '-', (s.duree_min || 0) + "'",
     String(procedures.length), fmtMin(travail) + "'", fmtMin(total) + "'"],
    [1.1, 1, 1.15, 1, 1.25, 1.1]);

  /* Le récap peut désormais dépasser une page (sous-lignes de détail) :
     ce garde-fou ouvre une page de suite au lieu de déborder hors cadre. */
  const BOTTOM = H - 12;
  const newPage = (subtitle) => {
    footer(`FootSession Pro · ${s.titre || ''}`, 'Récapitulatif');
    doc.addPage();
    fill(0, 0, W, H, [255, 255, 255]);
    return pageHeader(s.titre || 'Séance', subtitle);
  };

  /* Déroulé de la séance */
  y += 4;
  header(M, y, CW, 7, 'Déroulé de la séance', 6.5);
  y += 7;

  const cols = [CW * 0.04, CW * 0.20, CW * 0.09, CW * 0.13, CW * 0.07, CW * 0.16, CW * 0.31];
  const heads = ['#', 'PROCÉDÉ', 'TYPE', 'SÉQUENCES', 'DURÉE', 'ESPACE / EFFECTIF', 'PRINCIPE DE JEU'];
  const drawDerouleHead = (yy) => {
    let cx = M;
    cols.forEach((w, i) => { header(cx, yy, w, 6, heads[i], 5.6); cx += w; });
    return yy + 6;
  };

  if (!procedures.length) {
    cell(M, y, CW, 12, 'Aucun procédé enregistré.', { fs: 9 });
    y += 12;
  } else {
    y = drawDerouleHead(y);
    procedures.forEach((p, i) => {
      // Hauteur de ligne adaptée au texte le plus long.
      doc.setFontSize(8.5);
      const principe = doc.splitTextToSize(p.principes_jeu || '—', cols[6] - 4);
      const nom = doc.splitTextToSize(p.nom || 'Procédé', cols[1] - 4);
      const rowH = Math.max(9, Math.max(principe.length, nom.length) * 4 + 4);

      /* Un procédé sans schéma n'aura pas de page dédiée : on détaille
         donc ici son objectif, ses consignes et les comportements
         attendus, pour que rien ne soit perdu à l'export. */
      const detailFs = 7.5, detailLineH = 3.4;
      let detailLines = [];
      if (!p.canvas_image) {
        const bits = [
          p.objectif && 'Objectif : ' + p.objectif,
          p.consignes && 'Consignes : ' + p.consignes,
          p.comportements_individuels && 'Comportements attendus : ' + p.comportements_individuels,
        ].filter(Boolean);
        if (bits.length) {
          doc.setFontSize(detailFs);
          bits.forEach(b => { detailLines = detailLines.concat(doc.splitTextToSize(b, CW - 7)); });
        }
      }
      const detailH = detailLines.length ? detailLines.length * detailLineH + 3.5 : 0;

      // La ligne et son détail ne doivent jamais être séparés par un saut de page.
      if (y + rowH + detailH > BOTTOM) y = drawDerouleHead(newPage('Suite du déroulé'));

      const vals = [
        String(i + 1), p.nom || 'Procédé', p.type_procede || '—', sequenceLabel(p),
        fmtMin(totalMin(p)) + "'",
        [p.taille_terrain, p.effectif].filter(Boolean).join(' · ') || '—',
        p.principes_jeu || '—',
      ];
      let cx = M;
      cols.forEach((w, ci) => {
        cell(cx, y, w, rowH, vals[ci], { fs: 8.5, top: ci === 1 || ci === 6, bold: ci === 1 });
        cx += w;
      });
      y += rowH;

      if (detailLines.length) {
        fill(M, y, CW, detailH, [249, 250, 252]); box(M, y, CW, detailH);
        doc.setTextColor(...MUT); doc.setFont('helvetica', 'normal'); doc.setFontSize(detailFs);
        doc.text(detailLines, M + 3.5, y + 3, { align: 'left', baseline: 'top' });
        y += detailH;
      }
    });
  }

  /* Présences : présents regroupés d'abord, absents à part.
     Éparpiller les deux dans une même grille obligeait à chercher les
     pastilles vertes une par une. */
  const presents = attendance.filter(a => a.present);
  const absents = attendance.filter(a => !a.present);

  const perCol = 4, colW = CW / perCol, rowH = 6;
  const listH = (n) => n ? Math.ceil(n / perCol) * rowH + 4 : 10;
  const nameOf = (a) => `${a.prenom || ''} ${a.nom}`.trim() + (a.numero != null ? ` #${a.numero}` : '');

  /* Bloc de noms en 4 colonnes. `dim` grise les absents. */
  const nameBlock = (yy, list, dim) => {
    const h = listH(list.length);
    fill(M, yy, CW, h, dim ? [248, 249, 250] : LIGHT); box(M, yy, CW, h);
    if (!list.length) {
      doc.setTextColor(...MUT); doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5);
      doc.text('Aucun', M + 4, yy + 6);
      doc.setFont('helvetica', 'normal');
      return h;
    }
    list.forEach((a, i) => {
      const col = i % perCol, row = Math.floor(i / perCol);
      const x = M + col * colW + 3, ty2 = yy + 4 + row * rowH;
      doc.setFillColor(dim ? 200 : 76, dim ? 200 : 175, dim ? 205 : 80);
      doc.circle(x + 1.5, ty2 - 0.8, 1.4, 'F');
      doc.setTextColor(...(dim ? MUT : DARK)); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      doc.text(short(nameOf(a), 28), x + 5, ty2);
    });
    return h;
  };

  if (!attendance.length) {
    if (y + 4 + 7 + 12 > BOTTOM) y = newPage('Suite');
    y += 4;
    header(M, y, CW, 7, 'Présence des joueurs', 6.5); y += 7;
    cell(M, y, CW, 12, 'Aucun joueur enregistré.', { fs: 9 });
  } else {
    // Bloc « Présents »
    if (y + 4 + 7 + listH(presents.length) > BOTTOM) y = newPage('Suite');
    y += 4;
    header(M, y, CW, 7, `Présents — ${presents.length} / ${attendance.length}`, 6.5); y += 7;
    y += nameBlock(y, presents, false);

    // Bloc « Absents », uniquement s'il y en a
    if (absents.length) {
      if (y + 3 + 7 + listH(absents.length) > BOTTOM) y = newPage('Suite');
      y += 3;
      header(M, y, CW, 7, `Absents — ${absents.length}`, 6.5); y += 7;
      y += nameBlock(y, absents, true);
    }

    /* Équipes de travail (chasubles) : une ligne par équipe, avec sa
       couleur et les noms de ses joueurs. */
    const equipes = (Array.isArray(s.equipes) ? s.equipes : []).filter(t => (t.player_ids || []).length);
    if (equipes.length) {
      const rowFs = 8.5, rowLineH = 4;
      const rows = equipes.map(t => {
        const noms = (t.player_ids || [])
          .map(id => presents.find(a => a.player_id === id))
          .filter(Boolean).map(nameOf).join(', ');
        doc.setFontSize(rowFs);
        return { t, lines: doc.splitTextToSize(noms || '—', CW - 46) };
      });
      const blockH = rows.reduce((sum, r) => sum + Math.max(8, r.lines.length * rowLineH + 3), 0);
      if (y + 3 + 7 + blockH > BOTTOM) y = newPage('Suite');
      y += 3;
      header(M, y, CW, 7, 'Équipes de travail', 6.5); y += 7;
      rows.forEach(r => {
        const h = Math.max(8, r.lines.length * rowLineH + 3);
        fill(M, y, CW, h, LIGHT); box(M, y, CW, h);
        // Pastille de couleur + nom de l'équipe, puis les joueurs.
        const rgb = hexRgb(r.t.couleur) || [120, 120, 120];
        fill(M, y, 2.2, h, rgb);
        doc.setTextColor(...DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(rowFs);
        doc.text(short(r.t.nom || 'Équipe', 16), M + 4.5, y + 5);
        doc.setFont('helvetica', 'normal');
        doc.text(r.lines, M + 42, y + 5);
        y += h;
      });
    }
  }
  footer(`FootSession Pro · ${s.titre || ''}`, 'Récapitulatif');

  /* ============================================================
     UNE PAGE PAR PROCÉDÉ — uniquement ceux qui ont un schéma.
     Les autres sont déjà détaillés dans le récap ci-dessus.
     ============================================================ */
  const withSchema = procedures.filter(p => p.canvas_image);
  for (let idx = 0; idx < withSchema.length; idx++) {
    const p = withSchema[idx];
    doc.addPage();
    fill(0, 0, W, H, [255, 255, 255]);

    // Titre = nom du procédé, sous-titre = principe de jeu (extensible).
    let py = pageHeader(p.nom || 'Procédé', p.principes_jeu ? 'Principe de jeu : ' + p.principes_jeu : null);

    py = infoTable(py,
      ['TYPE', 'SÉQUENCES', 'TEMPS DE TRAVAIL', 'TEMPS TOTAL', 'ESPACE DE JEU', 'EFFECTIF'],
      [p.type_procede || '-', sequenceLabel(p),
       fmtMin(workMin(p)) + "'", fmtMin(totalMin(p)) + "'",
       p.taille_terrain || '-', p.effectif || '-'],
      [1, 1.4, 1.2, 1.1, 1.5, 1.2]);

    /* Zone principale : schéma (gauche) + rubriques auto-extensibles (droite) */
    const mainY = py + 4;
    const mainH = H - mainY - 10;
    const leftW = CW * 0.56, gap = 4, rightX = M + leftW + gap, rightW = CW - leftW - gap;

    const sz = await imgSize(p.canvas_image);
    const ar = sz ? sz.w / sz.h : 1040 / 680;
    let iw = leftW, ih = iw / ar;
    if (ih > mainH) { ih = mainH; iw = ih * ar; }
    try { doc.addImage(p.canvas_image, 'PNG', M + (leftW - iw) / 2, mainY, iw, ih); } catch (e) {}
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.rect(M + (leftW - iw) / 2, mainY, iw, ih);

    /* Rubriques : hauteur proportionnelle au contenu réel, puis ajustée
       pour remplir la page sans jamais déborder. */
    const bandH = 6, fs = 9, lineH = 4.1;
    const secs = [
      { title: 'Objectif', text: p.objectif },
      { title: 'Consignes', text: p.consignes },
      { title: 'Comportements attendus', text: p.comportements_individuels },
    ];
    doc.setFontSize(fs);
    secs.forEach(sec => {
      sec.lines = doc.splitTextToSize(sec.text || '—', rightW - 5);
      sec.need = Math.max(10, sec.lines.length * lineH + 5);   // hauteur minimale lisible
    });
    const avail = mainH - secs.length * bandH;
    const totalNeed = secs.reduce((sum, sec) => sum + sec.need, 0);
    // Si ça dépasse, on comprime proportionnellement ; sinon on distribue le surplus.
    const ratio = totalNeed > 0 ? avail / totalNeed : 1;
    secs.forEach(sec => sec.h = sec.need * ratio);

    let ry = mainY;
    secs.forEach(sec => {
      header(rightX, ry, rightW, bandH, sec.title, 6.2);
      fill(rightX, ry + bandH, rightW, sec.h, LIGHT); box(rightX, ry + bandH, rightW, sec.h);
      doc.setTextColor(...DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(fs);
      // On n'affiche que les lignes qui tiennent dans le bloc (évite tout débordement).
      const maxLines = Math.max(1, Math.floor((sec.h - 3) / lineH));
      doc.text(sec.lines.slice(0, maxLines), rightX + 2.5, ry + bandH + 4, { align: 'left', baseline: 'top' });
      ry += bandH + sec.h;
    });

    footer(`FootSession Pro · ${s.titre || ''}`, `Procédé ${idx + 1} / ${withSchema.length}`);
  }

  doc.save(`seance-${(s.titre || 'footsession').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
  toast('PDF généré', 'success');
};
