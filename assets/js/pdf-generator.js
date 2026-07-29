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

/* MATÉRIEL = matériel réellement posé sur le schéma (cônes, coupelles, échelles…). */
function materialFromSchema(json) {
  if (!json) return '—';
  let data; try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return '—'; }
  const names = { cone: 'cône', disc: 'coupelle', ladder: 'échelle', pole: 'piquet', hurdle: 'haie', goal: 'cage', ball: 'ballon' };
  const counts = {};
  (data.items || []).forEach(it => { if (it.type === 'equip' && names[it.kind]) counts[it.kind] = (counts[it.kind] || 0) + 1; });
  const parts = Object.entries(counts).map(([k, n]) => n + ' ' + names[k] + (n > 1 ? 's' : ''));
  return parts.length ? parts.join(' · ') : '—';
}

window.generateSessionPDF = async function (sessionId) {
  const lib = window.jspdf;
  if (!lib || !lib.jsPDF) { toast('Module PDF non chargé.', 'error'); return; }
  toast('Génération du PDF…');
  let data;
  try { data = await API(`php/api/sessions.php?action=get&id=${sessionId}`); }
  catch (e) { toast(e.message, 'error'); return; }

  const { jsPDF } = lib;
  const doc = new jsPDF('l', 'mm', 'a4');   // PAYSAGE
  const W = 297, H = 210, M = 8, CW = W - 2 * M;
  const s = data.session;
  const procedures = data.procedures || [];
  const attendance = data.attendance || [];
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

  /* ---------- Une page paysage par procédé ---------- */
  for (let idx = 0; idx < Math.max(procedures.length, 1); idx++) {
    const p = procedures[idx] || {};
    if (idx > 0) doc.addPage();
    fill(0, 0, W, H, [255, 255, 255]);

    /* Bandeau titre : nom de la séance (grand) + principe de jeu (petit) au centre */
    let ty = 7;
    if (s.club_logo) {
      try { doc.addImage(s.club_logo, M, ty, 16, 15); } catch (e) { fill(M, ty, 16, 14, NAVY); }
    } else {
      fill(M, ty, 16, 14, NAVY);
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.text(initials(s.coach_club), M + 8, ty + 7, { align: 'center', baseline: 'middle' });
    }
    doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text((s.titre || 'Séance').toUpperCase(), W / 2, ty + (p.principes_jeu ? 5 : 7), { align: 'center', baseline: 'middle' });
    if (p.principes_jeu) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUT);
      doc.text('Principe de jeu : ' + p.principes_jeu, W / 2, ty + 11.5, { align: 'center', baseline: 'middle' });
    }
    doc.setTextColor(...MUT); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text([s.categorie ? 'Phase : ' + s.categorie : '', `Coach : ${s.coach_nom || '—'}`].filter(Boolean), W - M, ty + 3, { align: 'right' });
    doc.setDrawColor(...gold); doc.setLineWidth(0.8); doc.line(M, ty + 16, W - M, ty + 16);

    /* Tableau d'informations */
    // Champs courts regroupés dans le bandeau d'infos (peu d'espace nécessaire).
    const labels = ['DATE', 'DURÉE SÉANCE', 'SÉQUENCE', 'DURÉE SÉQ.', 'INTENSITÉ', 'RÉCUP', 'TEMPS TOTAL', 'ESPACE DE JEU', 'EFFECTIF', 'ÉQUIPES'];
    const values = [
      s.date_seance || '-', (s.duree_min || 0) + "'", `${idx + 1} / ${procedures.length || 1}`,
      (p.duree_min || 0) + "'", p.intensite ? p.intensite + '/10' : '-', p.temps_recup_min ? p.temps_recup_min + "'" : '-', (s.duree_min || 0) + "'",
      short(p.zones_jeu || p.taille_terrain, 20), p.effectif || '-', s.equipe || 'LIBRE',
    ];
    const weights = [1.05, 1.1, 0.85, 0.95, 1.0, 0.9, 0.95, 1.6, 1.15, 1.05];
    const sw = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map(w => w / sw * CW);
    const tY = ty + 20, hH = 8, vH = 10;
    let cx = M;
    widths.forEach((w, i) => { header(cx, tY, w, hH, labels[i], 5.6); cx += w; });
    cx = M;
    widths.forEach((w, i) => { cell(cx, tY + hH, w, vH, values[i], { fs: 8.5 }); cx += w; });

    /* Bandeau MOMENT DE JEU / MATÉRIEL + valeurs */
    const bY = tY + hH + vH + 2, bH = 7;
    const mW = CW * 0.66, matW = CW - mW;
    header(M, bY, mW, bH, 'Vidéo — Moment de jeu · Principe de jeu · Sous-principe', 5.6);
    header(M + mW, bY, matW, bH, 'Matériel', 6.5);
    const bvY = bY + bH, bvH = 12;
    fill(M, bvY, mW, bvH, LIGHT); box(M, bvY, mW, bvH);
    doc.setTextColor(...DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(p.nom || 'Procédé', M + 3, bvY + (p.principes_jeu ? 4.5 : bvH / 2), { baseline: 'middle' });
    if (p.principes_jeu) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUT);
      doc.text(doc.splitTextToSize('Principe de jeu : ' + p.principes_jeu, mW - 6), M + 3, bvY + 8.6, { baseline: 'middle' });
    }
    cell(M + mW, bvY, matW, bvH, materialFromSchema(p.canvas_json), { fs: 8 });

    /* Zone principale : schéma (gauche) + panneau détaillé (droite) */
    const mainY = bvY + bvH + 3;
    const mainH = H - mainY - 10;
    const leftW = CW * 0.58, gap = 4, rightX = M + leftW + gap, rightW = CW - leftW - gap;

    // Schéma tactique — sur fond blanc, aucun cadre noir, aligné en haut.
    if (p.canvas_image) {
      const sz = await imgSize(p.canvas_image);
      const ar = sz ? sz.w / sz.h : 1040 / 680;
      let iw = leftW, ih = iw / ar;
      if (ih > mainH) { ih = mainH; iw = ih * ar; }
      const ix = M + (leftW - iw) / 2, iy = mainY;
      try { doc.addImage(p.canvas_image, 'PNG', ix, iy, iw, ih); } catch (e) {}
      doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.rect(ix, iy, iw, ih);
    } else {
      fill(M, mainY, leftW, mainH, LIGHT); box(M, mainY, leftW, mainH);
      doc.setTextColor(...MUT); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      doc.text('Aucun schéma tactique', M + leftW / 2, mainY + mainH / 2, { align: 'center', baseline: 'middle' });
    }

    // Panneau détaillé : une rubrique distincte par champ.
    const bandH = 6, avail = mainH - 4 * bandH;
    let ry = mainY;
    const section = (title, text, frac) => {
      const vH = avail * frac;
      header(rightX, ry, rightW, bandH, title, 6.2);
      cell(rightX, ry + bandH, rightW, vH, text || '—', { top: true, fs: 9 });
      ry += bandH + vH;
    };
    section('Objectif', p.objectif, 0.20);
    section('Consignes', p.consignes, 0.40);
    section('Postes ciblés', p.postes_cibles, 0.14);
    section('Comportements attendus', p.comportements_individuels, 0.26);

    // Pied de page
    doc.setFontSize(7.5); doc.setTextColor(...MUT); doc.setFont('helvetica', 'normal');
    doc.text(`FootSession Pro · ${s.titre || ''}`, M, H - 4);
    doc.text(`${idx + 1} / ${procedures.length || 1}`, W - M, H - 4, { align: 'right' });
  }

  /* ---------- Page présences (paysage) ---------- */
  doc.addPage();
  fill(0, 0, W, H, [255, 255, 255]);
  header(M, 10, CW, 9, 'Présence des joueurs — ' + (s.titre || ''), 8);
  const present = attendance.filter(a => Number(a.present) === 1).length;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...MUT);
  doc.text(`${present} présent(s) sur ${attendance.length} joueur(s) · ${s.date_seance || ''}`, M, 26);

  if (!attendance.length) {
    doc.setTextColor(...MUT); doc.text('Aucun joueur enregistré.', M, 40);
  } else {
    const cols = 3, colW = CW / cols, rowH = 8;
    let x = M, y = 32, col = 0;
    attendance.forEach((a) => {
      if (y > H - 14) { y = 32; col++; x = M + col * colW; }
      if (col >= cols) return;
      const name = `${a.prenom || ''} ${a.nom}`.trim() + (a.numero != null ? ` (#${a.numero})` : '');
      const ok = Number(a.present) === 1;
      doc.setFillColor(ok ? 76 : 244, ok ? 175 : 67, ok ? 80 : 54);
      doc.circle(x + 3, y - 1, 1.6, 'F');
      doc.setTextColor(...DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
      doc.text(short(name, 30), x + 7, y);
      doc.setTextColor(ok ? 46 : 192, ok ? 139 : 57, ok ? 53 : 43);
      doc.text(ok ? 'Présent' : 'Absent', x + colW - 6, y, { align: 'right' });
      y += rowH;
    });
  }
  doc.setFontSize(7.5); doc.setTextColor(...MUT);
  doc.text('FootSession Pro · Généré le ' + new Date().toLocaleDateString('fr-FR'), M, H - 4);

  doc.save(`seance-${(s.titre || 'footsession').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
  toast('PDF généré', 'success');
};
