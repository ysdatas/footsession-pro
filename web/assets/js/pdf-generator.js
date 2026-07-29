/* ============================================================
   FootSession Pro — pdf-generator.js
   Export PDF PAYSAGE inspiré d'une fiche de séance pro :
   bandeau titre + tableau d'infos + schéma tactique à gauche +
   ORGANISATION/CONSIGNES · ÉQUIPES · COMPORTEMENTS ATTENDUS à droite.
   Une page paysage par procédé, puis une page présences.
   Exposé : window.generateSessionPDF(sessionId)
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

window.generateSessionPDF = async function (sessionId) {
  const lib = window.jspdf;
  if (!lib || !lib.jsPDF) { toast('Module PDF non chargé.', 'error'); return; }
  toast('Génération du PDF…');

  let s, procedures = [], attendance = [], club = {};
  try {
    const { data: sess, error: e1 } = await sb.from('sessions').select('*').eq('id', sessionId).single();
    if (e1 || !sess) throw e1 || new Error('Séance introuvable.');
    s = sess;

    const [{ data: procs }, { data: clubRow }, { data: players }, { data: att }] = await Promise.all([
      sb.from('procedures').select('*, tactical_schemas(image_path, canvas_json)').eq('session_id', sessionId).order('ordre'),
      sb.from('clubs').select('nom, color, logo_path').eq('id', s.club_id).single(),
      sb.from('players').select('id, nom, prenom, numero'),
      sb.from('attendance').select('player_id, present').eq('session_id', sessionId),
    ]);
    club = clubRow || {};

    // Résout les images (Storage → data URL) en parallèle.
    procedures = await Promise.all((procs || []).map(async p => ({
      ...p,
      canvas_json: p.tactical_schemas?.canvas_json || null,
      canvas_image: await storageToDataUrl('schemas', p.tactical_schemas?.image_path),
    })));

    const attMap = {};
    (att || []).forEach(a => attMap[a.player_id] = !!a.present);
    attendance = (players || []).map(p => ({ ...p, present: !!attMap[p.id] }));

    s.coach_club = club.nom || '';
    s.club_color = club.color || '';
    s.club_logo = await storageToDataUrl('logos', club.logo_path);
    // Nom du créateur de la séance (si le profil est visible dans le club).
    if (s.created_by) {
      const { data: author } = await sb.from('profiles').select('nom').eq('id', s.created_by).maybeSingle();
      s.coach_nom = author?.nom || '';
    }
  } catch (e) { toast(e.message || 'Erreur de chargement.', 'error'); return; }

  const { jsPDF } = lib;
  const doc = new jsPDF('l', 'mm', 'a4');   // PAYSAGE
  const W = 297, H = 210, M = 8, CW = W - 2 * M;
  const clubName = (s.coach_club || 'FOOTSESSION PRO').toUpperCase();
  const hexRgb = (h) => { if (!/^#[0-9a-f]{6}$/i.test(h || '')) return null; const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const gold = hexRgb(s.club_color) || GOLD;   // couleur d'accent du club

  /* ---------- Helpers de dessin ---------- */
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

  /* En-tête commun (logo club + titre) réutilisé sur chaque page. */
  const pageHeader = (title, subtitle) => {
    const ty = 7;
    if (s.club_logo) {
      try { doc.addImage(s.club_logo, M, ty, 16, 15); } catch (e) { fill(M, ty, 16, 14, NAVY); }
    } else {
      fill(M, ty, 16, 14, NAVY);
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.text(initials(s.coach_club), M + 8, ty + 7, { align: 'center', baseline: 'middle' });
    }
    doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(String(title).toUpperCase(), W / 2, ty + (subtitle ? 5 : 7), { align: 'center', baseline: 'middle' });
    if (subtitle) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUT);
      const lines = doc.splitTextToSize(subtitle, CW * 0.62);
      doc.text(lines.slice(0, 2), W / 2, ty + 11, { align: 'center', baseline: 'middle' });
    }
    doc.setTextColor(...MUT); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text([s.categorie ? 'Phase : ' + s.categorie : '', s.coach_nom ? 'Coach : ' + s.coach_nom : ''].filter(Boolean), W - M, ty + 3, { align: 'right' });
    doc.setDrawColor(...gold); doc.setLineWidth(0.8); doc.line(M, ty + 16, W - M, ty + 16);
    return ty + 20;
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

  /* ============================================================
     PAGE 1 — RÉCAPITULATIF DE LA SÉANCE
     ============================================================ */
  fill(0, 0, W, H, [255, 255, 255]);
  let y = pageHeader(s.titre || 'Séance', null);

  const totalProcMin = procedures.reduce((sum, p) => sum + (p.duree_min || 0), 0);
  y = infoTable(y,
    ['DATE', 'ÉQUIPE', 'PHASE DE JEU', 'DURÉE SÉANCE', 'NB PROCÉDÉS', 'TEMPS DE TRAVAIL'],
    [s.date_seance || '-', s.equipe || '-', s.categorie || '-', (s.duree_min || 0) + "'", String(procedures.length), totalProcMin + "'"],
    [1.1, 1, 1.4, 1.1, 1, 1.2]);

  /* Déroulé de la séance */
  y += 4;
  header(M, y, CW, 7, 'Déroulé de la séance', 6.5);
  y += 7;
  if (!procedures.length) {
    cell(M, y, CW, 12, 'Aucun procédé enregistré.', { fs: 9 });
    y += 12;
  } else {
    const cols = [CW * 0.06, CW * 0.30, CW * 0.10, CW * 0.16, CW * 0.38];
    const heads = ['#', 'PROCÉDÉ', 'DURÉE', 'ESPACE / EFFECTIF', 'PRINCIPE DE JEU'];
    let cx = M;
    cols.forEach((w, i) => { header(cx, y, w, 6, heads[i], 5.6); cx += w; });
    y += 6;
    procedures.forEach((p, i) => {
      // Hauteur de ligne adaptée au texte le plus long.
      doc.setFontSize(8.5);
      const principe = doc.splitTextToSize(p.principes_jeu || '—', cols[4] - 4);
      const nom = doc.splitTextToSize(p.nom || 'Procédé', cols[1] - 4);
      const rowH = Math.max(9, Math.max(principe.length, nom.length) * 4 + 4);
      const vals = [
        String(i + 1), p.nom || 'Procédé', (p.duree_min || 0) + "'",
        [p.taille_terrain, p.effectif].filter(Boolean).join(' · ') || '—',
        p.principes_jeu || '—',
      ];
      cx = M;
      cols.forEach((w, ci) => {
        cell(cx, y, w, rowH, vals[ci], { fs: 8.5, top: ci === 1 || ci === 4, bold: ci === 1 });
        cx += w;
      });
      y += rowH;
    });
  }

  /* Présences sur la même page récap */
  const present = attendance.filter(a => a.present).length;
  y += 4;
  header(M, y, CW, 7, `Présence des joueurs — ${present} / ${attendance.length}`, 6.5);
  y += 7;
  if (!attendance.length) {
    cell(M, y, CW, 12, 'Aucun joueur enregistré.', { fs: 9 });
  } else {
    const perCol = 4, colW = CW / perCol, rowH = 6;
    const rows = Math.ceil(attendance.length / perCol);
    const blockH = rows * rowH + 4;
    fill(M, y, CW, blockH, LIGHT); box(M, y, CW, blockH);
    attendance.forEach((a, i) => {
      const col = i % perCol, row = Math.floor(i / perCol);
      const x = M + col * colW + 3, ty2 = y + 4 + row * rowH;
      const ok = !!a.present;
      doc.setFillColor(ok ? 76 : 200, ok ? 175 : 200, ok ? 80 : 205);
      doc.circle(x + 1.5, ty2 - 0.8, 1.4, 'F');
      doc.setTextColor(...(ok ? DARK : MUT)); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      const name = `${a.prenom || ''} ${a.nom}`.trim() + (a.numero != null ? ` #${a.numero}` : '');
      doc.text(short(name, 28), x + 5, ty2);
    });
  }
  footer(`FootSession Pro · ${s.titre || ''}`, 'Récapitulatif');

  /* ============================================================
     UNE PAGE PAR PROCÉDÉ (infos du procédé uniquement)
     ============================================================ */
  for (let idx = 0; idx < procedures.length; idx++) {
    const p = procedures[idx];
    doc.addPage();
    fill(0, 0, W, H, [255, 255, 255]);

    // Titre = nom du procédé, sous-titre = principe de jeu (extensible sur 2 lignes).
    let py = pageHeader(p.nom || 'Procédé', p.principes_jeu ? 'Principe de jeu : ' + p.principes_jeu : null);

    // Infos propres au procédé seulement.
    py = infoTable(py,
      ['SÉQUENCE', 'DURÉE', 'RÉCUP', 'ESPACE DE JEU', 'EFFECTIF'],
      [`${idx + 1} / ${procedures.length}`, (p.duree_min || 0) + "'",
       p.temps_recup_min ? p.temps_recup_min + "'" : '-', p.taille_terrain || '-', p.effectif || '-'],
      [1, 1, 1, 1.7, 1.3]);

    /* Zone principale : schéma (gauche) + rubriques auto-extensibles (droite) */
    const mainY = py + 4;
    const mainH = H - mainY - 10;
    const leftW = CW * 0.56, gap = 4, rightX = M + leftW + gap, rightW = CW - leftW - gap;

    if (p.canvas_image) {
      const sz = await imgSize(p.canvas_image);
      const ar = sz ? sz.w / sz.h : 1040 / 680;
      let iw = leftW, ih = iw / ar;
      if (ih > mainH) { ih = mainH; iw = ih * ar; }
      try { doc.addImage(p.canvas_image, 'PNG', M + (leftW - iw) / 2, mainY, iw, ih); } catch (e) {}
      doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.rect(M + (leftW - iw) / 2, mainY, iw, ih);
    } else {
      fill(M, mainY, leftW, mainH, LIGHT); box(M, mainY, leftW, mainH);
      doc.setTextColor(...MUT); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      doc.text('Aucun schéma tactique', M + leftW / 2, mainY + mainH / 2, { align: 'center', baseline: 'middle' });
    }

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

    footer(`FootSession Pro · ${s.titre || ''}`, `Procédé ${idx + 1} / ${procedures.length}`);
  }

  doc.save(`seance-${(s.titre || 'footsession').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
  toast('PDF généré', 'success');
};
