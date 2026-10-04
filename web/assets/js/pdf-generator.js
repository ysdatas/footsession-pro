/* ============================================================
   LMFC Performance — pdf-generator.js
   Export PDF PAYSAGE inspiré d'une fiche de séance pro.

   Page 1 : récapitulatif complet (infos, déroulé, présences).
            Les procédés SANS schéma tactique y sont détaillés en
            sous-ligne, pour ne pas gaspiller une page presque vide.
   Puis    : une page par procédé QUI POSSÈDE un schéma tactique.

   Exposé : window.generateSessionPDF(sessionId)
            window.loadSessionForPdf(sessionId)   (réutilisé par pdf-coach.js)
            window.PDF_THEME, window.imgSize      (idem)
   ============================================================ */

/* Identité LMFC (pdf-kit.js) : panneaux clairs, filets fins, texte sombre,
   accent du club ; ni bandeau noir ni filet sous le logo. */
const INK = [20, 22, 27];
const LIGHT = [255, 255, 255];
const LINE = [226, 229, 234];
const PANEL = [245, 246, 248];
const DARK = [44, 49, 57];
const MUT = [108, 115, 126];
const ACCENT = [200, 16, 46];

function imgSize(src) {
  return new Promise(res => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res(null); im.src = src; });
}
const short = (t, n = 26) => { t = (t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : (t || '-'); };
const initials = (s) => (s || 'FS').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
const hexRgb = (h) => { if (!/^#[0-9a-f]{6}$/i.test(h || '')) return null; const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/* Blason LMFC du site : logo par défaut quand le club n'en a pas déposé. */
async function brandLogoDataUrl() {
  try {
    const r = await fetch(baseUrl('assets/img/lmfc-logo.png'));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    return await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(blob); });
  } catch (e) { console.warn('Blason LMFC indisponible pour le PDF', e); return null; }
}

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
    s.club_logo = await storageToDataUrl('logos', club.logo_path) || await brandLogoDataUrl();
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

/* Équipes de la séance (chasubles) avec le nom de leurs joueurs.
   `players` : la liste des joueurs du club (id, nom, prenom, numero). */
function sessionTeams(s, players) {
  const nameOf = (a) => `${a.prenom || ''} ${a.nom || ''}`.trim() + (a.numero != null ? ` #${a.numero}` : '');
  return (Array.isArray(s.equipes) ? s.equipes : [])
    .map(t => ({
      nom: (t.nom || 'Équipe').trim(), couleur: t.couleur,
      names: (t.player_ids || []).map(id => players.find(a => a.id === id)).filter(Boolean).map(nameOf),
    }))
    .filter(t => t.names.length);
}

/* Équipes en colonnes compactes : une colonne par couleur, son nom sur
   fond de la chasuble, puis les joueurs l'un sous l'autre. Renvoie la
   hauteur utilisée ; `dry` mesure sans dessiner. Partagé par les deux PDF. */
function drawTeamColumns(doc, { x, y, w, teams, fs = 8, dry = false, maxCols = 6 }) {
  if (!teams.length) return 0;
  const cols = Math.min(maxCols, teams.length), gap = 1.6;
  const colW = (w - gap * (cols - 1)) / cols, headH = fs * .62 + 2.4, lineH = fs * .43, pad = 1.6;
  let total = 0;
  for (let start = 0; start < teams.length; start += cols) {
    const row = teams.slice(start, start + cols);
    const rowH = headH + pad * 2 + Math.max(...row.map(t => t.names.length)) * lineH;
    if (!dry) row.forEach((t, i) => {
      const cx = x + i * (colW + gap), cy = y + total;
      const rgb = hexRgb(t.couleur) || [120, 120, 120];
      const light = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 160;
      doc.setFillColor(248, 249, 250); doc.rect(cx, cy, colW, rowH, 'F');
      doc.setDrawColor(...LINE); doc.setLineWidth(.25); doc.rect(cx, cy, colW, rowH);
      doc.setFillColor(...rgb); doc.rect(cx, cy, colW, headH, 'F');
      doc.setTextColor(...(light ? DARK : [255, 255, 255])); doc.setFont('helvetica', 'bold'); doc.setFontSize(fs);
      doc.text(short(`${t.nom} (${t.names.length})`, Math.floor(colW / (fs * .19))), cx + colW / 2, cy + headH / 2, { align: 'center', baseline: 'middle' });
      doc.setTextColor(...DARK); doc.setFont('helvetica', 'normal');
      t.names.forEach((n, k) => doc.text(short(n, Math.floor(colW / (fs * .17))), cx + pad + .6, cy + headH + pad + lineH * (k + .78)));
    });
    total += rowH + (start + cols < teams.length ? gap : 0);
  }
  return total;
}
window.sessionTeams = sessionTeams;
window.drawTeamColumns = drawTeamColumns;

/* Fabrique les helpers de dessin pour un document donné : partagés
   entre la fiche complète et la fiche coach. */
window.PDF_THEME = { INK, LIGHT, LINE, PANEL, DARK, MUT, ACCENT, imgSize, short, initials, hexRgb };

/* Numéro de page en bas à droite, rien d'autre (appelé avant doc.save). */
function numberPages(doc, W, H, M) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.4); doc.setTextColor(158, 164, 173);
    doc.text(`${i} / ${n}`, W - M, H - 4.5, { align: 'right' });
  }
}
window.numberPages = numberPages;

function pdfHelpers(doc, s, W, H, M) {
  const CW = W - 2 * M;
  const gold = typeof pdfAccent === 'function' ? pdfAccent(s.club_color) : (hexRgb(s.club_color) || ACCENT);
  const str = (t) => (typeof pdfStr === 'function' ? pdfStr(t) : String(t ?? ''));

  const fill = (x, y, w, h, rgb) => { doc.setFillColor(rgb[0], rgb[1], rgb[2]); doc.rect(x, y, w, h, 'F'); };
  const box = (x, y, w, h) => { doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.2); doc.rect(x, y, w, h); };
  /* Titre de colonne : petites capitales grises sur panneau clair. Sur toute
     la largeur, c'est un titre de rubrique : texte sombre, aligné à gauche. */
  const header = (x, y, w, h, text, fs = 6.4) => {
    if (Math.abs(w - CW) < 0.5) {
      doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
      doc.text(str(text), x, y + h - 1.6);
      return;
    }
    fill(x, y, w, h, PANEL);
    doc.setTextColor(...MUT); doc.setFont('helvetica', 'bold'); doc.setFontSize(fs);
    const lines = doc.splitTextToSize(str(String(text).toUpperCase()), w - 2);
    doc.text(lines, x + w / 2, y + h / 2, { align: 'center', baseline: 'middle', charSpace: 0.15 });
  };
  const cell = (x, y, w, h, text, o = {}) => {
    fill(x, y, w, h, o.fill || LIGHT); box(x, y, w, h);
    if (text == null || text === '') return;
    doc.setTextColor(...(o.color || DARK)); doc.setFont('helvetica', o.bold ? 'bold' : 'normal'); doc.setFontSize(o.fs || 9);
    const lines = doc.splitTextToSize(str(text), w - 4);
    if (o.top && lines.length > 1) doc.text(lines, x + 2.5, y + 4, { align: 'left', baseline: 'top' });
    else if (o.top) doc.text(lines, x + 2.5, y + h / 2, { align: 'left', baseline: 'middle' });
    else doc.text(lines, x + w / 2, y + h / 2, { align: 'center', baseline: 'middle' });
  };

  /* En-tête de page : panneau clair, blason, rubrique du club, titre,
     sous-titre (principe de jeu…) ; le coach à droite. Sans filet : la
     hauteur suit le texte, rien ne chevauche. */
  const pageHeader = (title, subtitle, kicker = 'Séance') => {
    const ty = M, pad = 4.5, crestS = 13;
    const textX = M + pad + (s.club_logo ? crestS + 5 : 0);
    const coach = s.coach_nom ? 'Coach : ' + s.coach_nom : '';
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    const coachW = coach ? doc.getTextWidth(str(coach)) + 6 : 0;
    const textW = CW - (textX - M) - pad - coachW;
    let ts = 15, titleLines;
    do { doc.setFont('helvetica', 'bold'); doc.setFontSize(ts); titleLines = doc.splitTextToSize(str(title), textW); ts -= 1.5; } while (titleLines.length > 2 && ts > 10);
    ts += 1.5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    const subLines = subtitle ? doc.splitTextToSize(str(subtitle), textW) : [];
    const lh = (fs) => fs * 0.3528 * 1.3;
    const textH = 3.8 + titleLines.length * lh(ts) + (subLines.length ? 1 + subLines.length * lh(8.5) : 0);
    const h = Math.max(crestS, textH) + 2 * pad;
    doc.setFillColor(...PANEL); doc.roundedRect(M, ty, CW, h, 2.5, 2.5, 'F');
    if (s.club_logo) { try { doc.addImage(s.club_logo, M + pad, ty + (h - crestS) / 2, crestS, crestS); } catch (e) { console.warn('Logo du club non ajouté', e); } }
    let cy = ty + (h - textH) / 2;
    doc.setTextColor(...gold); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8);
    doc.text(str(`${s.coach_club || 'Le Mans FC'} · ${kicker}`.toUpperCase()), textX, cy, { baseline: 'top', charSpace: 0.3 });
    cy += 3.8;
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(ts);
    doc.text(titleLines, textX, cy, { baseline: 'top' });
    cy += titleLines.length * lh(ts);
    if (subLines.length) {
      cy += 1;
      doc.setTextColor(...MUT); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      doc.text(subLines, textX, cy, { baseline: 'top' });
    }
    if (coach) {
      doc.setTextColor(...MUT); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text(str(coach), W - M - pad, ty + h / 2, { align: 'right', baseline: 'middle' });
    }
    return ty + h + 4;
  };

  /* Pied de page : le numéro de page seulement, posé à la fin (numberPages). */
  const footer = () => {};

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

  return { CW, gold, fill, box, header, cell, pageHeader, footer, infoTable, str };
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
  const { CW, fill, box, header, cell, pageHeader, footer, infoTable, str } = pdfHelpers(doc, s, W, H, M);

  /* ============================================================
     PAGE 1 — RÉCAPITULATIF DE LA SÉANCE
     ============================================================ */
  fill(0, 0, W, H, [255, 255, 255]);
  const principe = sessionPrinciple(s, procedures);
  const principeLine = principe ? 'Principe de jeu : ' + principe : null;
  let y = pageHeader(s.titre || 'Séance', principeLine);

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
    footer(`LMFC Performance · ${s.titre || ''}`, 'Récapitulatif');
    doc.addPage();
    fill(0, 0, W, H, [255, 255, 255]);
    return pageHeader(s.titre || 'Séance', subtitle || principeLine);
  };

  /* Déroulé de la séance */
  y += 4;
  header(M, y, CW, 7, 'Déroulé de la séance', 6.5);
  y += 7;

  const cols = [CW * 0.04, CW * 0.20, CW * 0.09, CW * 0.13, CW * 0.07, CW * 0.16, CW * 0.31];
  const heads = ['#', 'PROCÉDÉ', 'TYPE', 'SÉQUENCES', 'DURÉE', 'ESPACE / EFFECTIF', 'OBJECTIF'];
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
      const objectif = doc.splitTextToSize(p.objectif || '—', cols[6] - 4);
      const nom = doc.splitTextToSize(p.nom || 'Procédé', cols[1] - 4);
      const rowH = Math.max(9, Math.max(objectif.length, nom.length) * 4 + 4);

      /* Un procédé sans schéma n'aura pas de page dédiée : on détaille
         donc ici son objectif, ses consignes et les comportements
         attendus, pour que rien ne soit perdu à l'export. */
      const detailFs = 7.5, detailLineH = 3.4;
      let detailLines = [];
      if (!p.canvas_image) {
        const ownPrinciple = (p.principes_jeu || '').trim();
        const bits = [
          ownPrinciple && ownPrinciple !== principe && 'Principe de jeu : ' + ownPrinciple,
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
        p.objectif || '—',
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
      // Le nom entier tant qu'il tient dans sa colonne, sinon raccourci à sa largeur.
      let name = str(nameOf(a));
      while (name.length > 4 && doc.getTextWidth(name) > colW - 8) name = `${name.slice(0, -2).trimEnd()}…`;
      doc.text(name, x + 5, ty2);
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

    /* Équipes de travail (chasubles) : une colonne par couleur. */
    const equipes = sessionTeams(s, attendance);
    if (equipes.length) {
      const blockH = drawTeamColumns(doc, { x: M, y: 0, w: CW, teams: equipes, fs: 8.5, dry: true });
      if (y + 3 + 7 + blockH > BOTTOM) y = newPage('Suite');
      y += 3;
      header(M, y, CW, 7, 'Équipes de travail (chasubles)', 6.5); y += 7;
      y += drawTeamColumns(doc, { x: M, y, w: CW, teams: equipes, fs: 8.5 });
    }
  }
  footer(`LMFC Performance · ${s.titre || ''}`, 'Récapitulatif');

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
    const pp = procPrinciple(p, s, procedures);
    let py = pageHeader(p.nom || 'Procédé', pp ? 'Principe de jeu : ' + pp : null, `${s.titre || 'Séance'} · procédé ${idx + 1} sur ${withSchema.length}`);

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
    const rest = [];
    secs.forEach(sec => {
      header(rightX, ry, rightW, bandH, sec.title, 6.2);
      fill(rightX, ry + bandH, rightW, sec.h, LIGHT); box(rightX, ry + bandH, rightW, sec.h);
      doc.setTextColor(...DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(fs);
      // Ce qui ne tient pas dans le bloc n'est pas perdu : suite page suivante.
      const maxLines = Math.max(1, Math.floor((sec.h - 3) / lineH));
      const shown = sec.lines.slice(0, maxLines);
      if (sec.lines.length > maxLines) { shown[shown.length - 1] += ' (suite page suivante)'; rest.push(sec); }
      doc.text(shown, rightX + 2.5, ry + bandH + 4, { align: 'left', baseline: 'top' });
      ry += bandH + sec.h;
    });
    if (rest.length) {
      doc.addPage();
      fill(0, 0, W, H, [255, 255, 255]);
      let cy = pageHeader(p.nom || 'Procédé', 'Suite du texte', 'Procédé');
      rest.forEach(sec => {
        doc.setFontSize(fs);
        const lines = doc.splitTextToSize(str(sec.text || ''), CW);
        header(M, cy, CW, 8, sec.title); cy += 9;
        lines.forEach(line => {
          if (cy + lineH > H - 12) { doc.addPage(); fill(0, 0, W, H, [255, 255, 255]); cy = pageHeader(p.nom || 'Procédé', 'Suite du texte', 'Procédé'); }
          doc.setTextColor(...DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(fs);
          doc.text(line, M, cy, { baseline: 'top' }); cy += lineH;
        });
        cy += 4;
      });
    }
  }

  numberPages(doc, W, H, M);
  doc.save(`seance-${(s.titre || 'lmfc-performance').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')}.pdf`);
  toast('PDF généré', 'success');
};
