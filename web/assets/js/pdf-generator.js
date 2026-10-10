/* ============================================================
   LMFC Performance — pdf-generator.js
   Export PDF PAYSAGE inspiré d'une fiche de séance pro.

   Page 1 : récapitulatif complet (infos, séance filmée, déroulé,
            présences par statut, invités signalés). Les procédés SANS
            schéma tactique y sont détaillés en sous-ligne, avec leurs
            équipes et leur staff.
   Puis    : une page par procédé QUI POSSÈDE un schéma tactique :
            schéma, rubriques, puis ses équipes (pastille de couleur,
            NOM, joueurs) et son staff. Un procédé tient toujours sur
            sa page (la police des rubriques se réduit au besoin).
   Enfin   : bilan individuel (+ / = / −) et commentaire général.

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

    const [{ data: procs }, { data: clubRow }, { data: players }, { data: att }, bl, { data: staff }] = await Promise.all([
      sb.from('procedures').select('*, tactical_schemas(image_path, canvas_json)').eq('session_id', sessionId).order('ordre'),
      sb.from('clubs').select('nom, color, logo_path').eq('id', s.club_id).single(),
      sb.from('players').select('id, nom, prenom, numero, team_id'),
      sb.from('attendance').select('*').eq('session_id', sessionId),
      sb.from('session_bilans').select('player_id, note, commentaire').eq('session_id', sessionId),
      s.created_by ? sb.rpc('club_staff') : { data: [] },   // auteur de la séance (lmfc_v14.sql)
    ]);
    if (bl.error) console.warn('Bilans indisponibles pour le PDF (lmfc_v9.sql ?)', bl.error);
    const club = clubRow || {};

    // Résout les images (Storage → data URL) en parallèle.
    const procedures = await Promise.all((procs || []).map(async p => ({
      ...p,
      canvas_json: p.tactical_schemas?.canvas_json || null,
      canvas_image: await storageToDataUrl('schemas', p.tactical_schemas?.image_path),
    })));

    // Joueurs de la séance : ceux qui ont une ligne de présence (invités
    // compris). Une très ancienne séance sans aucune ligne : tout l'effectif.
    const attMap = new Map((att || []).map(a => [a.player_id, a]));
    const roster = attMap.size ? (players || []).filter(p => attMap.has(p.id)) : (players || []);
    const attendance = roster.map(p => {
      const row = attMap.get(p.id), statut = statutOf(row);
      return { ...p, statut, statut_libre: row?.statut_libre || '', invite: !!row?.invite, present: participe({ statut, present: row?.present }) };
    });
    const bilans = (bl.data || []).map(b => ({ ...b, player: (players || []).find(p => p.id === b.player_id) })).filter(b => b.player);

    s.coach_club = club.nom || '';
    s.club_color = club.color || '';
    s.club_logo = await storageToDataUrl('logos', club.logo_path) || await brandLogoDataUrl();
    s.coach_nom = (staff || []).find(m => m.id === s.created_by)?.nom || '';
    return { s, procedures, attendance, bilans };
  } catch (e) {
    toast(e.message || 'Erreur de chargement.', 'error');
    return null;
  }
};

/* Équipes (chasubles) avec le nom de leurs joueurs : celles d'un procédé
   (procTeamsOf) ou, pour une ancienne séance, de toute la séance.
   `players` : les joueurs de la séance (id, nom, prenom, numero). */
const fullNameNum = (a) => `${a.prenom || ''} ${a.nom || ''}`.trim() + (a.numero != null ? ` #${a.numero}` : '');
function sessionTeams(list, players, nameOf = fullNameNum) {
  return (Array.isArray(list) ? list : [])
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

/* Lien vers la fiche d'un joueur, à poser sur son nom dans un PDF. */
const playerUrl = (id) => new URL(`player-performance.html?id=${id}`, location.href).href;
window.playerUrl = playerUrl;

/* Terrain d'effectif (sessions.terrain, lmfc_v15.sql) en paysage : le terrain
   vertical de l'écran pivote, son haut (but adverse) passe à droite.
   Pastille numérotée et prénom sous chaque joueur placé. Partagé par les
   deux PDF ; `nameOf` : prénom seul ou prénom et nom. */
function drawPitchPdf(doc, { x, y, w, h, terrain, players, accent, nameOf = (a) => a.prenom || a.nom || '' }) {
  const L = (m) => m / 105 * w, Wd = (m) => m / 68 * h;
  doc.setFillColor(236, 244, 238); doc.rect(x, y, w, h, 'F');
  doc.setDrawColor(150, 184, 160); doc.setLineWidth(0.3);
  doc.rect(x, y, w, h);
  doc.line(x + w / 2, y, x + w / 2, y + h);
  doc.circle(x + w / 2, y + h / 2, L(9.15), 'S');
  [[x, 1], [x + w, -1]].forEach(([gx, dir]) => {
    doc.rect(dir > 0 ? gx : gx - L(16.5), y + h / 2 - Wd(20.15), L(16.5), Wd(40.3));
    doc.rect(dir > 0 ? gx : gx - L(5.5), y + h / 2 - Wd(9.15), L(5.5), Wd(18.3));
  });
  const str = (t) => (typeof pdfStr === 'function' ? pdfStr(t) : String(t ?? ''));
  Object.entries(terrain || {}).forEach(([id, [ux, uy]]) => {
    const a = players.find(p => String(p.id) === String(id));
    if (!a) return;
    const px = x + (1 - uy / 100) * w, py = y + (ux / 100) * h;
    doc.setFillColor(...accent); doc.circle(px, py, 2.3, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.6);
    doc.text(str(a.numero != null ? String(a.numero) : `${(a.prenom || '')[0] || ''}${(a.nom || '')[0] || ''}`.toUpperCase()), px, py + 0.1, { align: 'center', baseline: 'middle' });
    doc.setTextColor(30, 34, 40); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.6);
    const name = str(nameOf(a));
    doc.text(name, px, py + 4.6, { align: 'center' });
    doc.link(px - doc.getTextWidth(name) / 2, py - 2.4, doc.getTextWidth(name), 7.4, { url: playerUrl(a.id) });
  });
}
window.drawPitchPdf = drawPitchPdf;
const hasTerrain = (s, players) => Object.keys(s?.terrain || {}).some(id => players.some(p => String(p.id) === id));
window.hasTerrain = hasTerrain;
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
  const { s, procedures, attendance, bilans } = loaded;

  const { jsPDF } = lib;
  const doc = new jsPDF('l', 'mm', 'a4');   // PAYSAGE
  const W = 297, H = 210, M = 8;
  const { CW, fill, box, header, cell, pageHeader, footer, infoTable, str } = pdfHelpers(doc, s, W, H, M);

  /* Nouveautés (lmfc_v9.sql) : équipes et staff de chaque procédé, séance filmée.
     Ancienne séance : ses chasubles valaient pour toute la séance (bloc en page 1). */
  const perProc = procedures.some(p => Array.isArray(p.equipes) && p.equipes.length);
  const staffOf = (p) => (Array.isArray(p.staff) ? p.staff : []).filter(m => (m.nom || '').trim());
  const staffText = (p) => staffOf(p).map(m => `${m.nom.trim()}${(m.role || '').trim() ? ` — ${m.role.trim()}` : ''}`).join('   ·   ');
  /* Équipes d'un procédé en lignes compactes : pastille de sa couleur, NOM (n), joueurs « • ». */
  const teamRowsFor = (p, w, fs) => {
    const teams = perProc ? sessionTeams(procTeamsOf(p, s, procedures), attendance) : [];
    if (!teams.length) return { rows: [], h: 0 };
    doc.setFont('helvetica', 'bold'); doc.setFontSize(fs);
    const nameW = Math.min(40, Math.max(...teams.map(t => doc.getTextWidth(str(`${t.nom.toUpperCase()} (${t.names.length})`)))) + 3);
    doc.setFont('helvetica', 'normal');
    const lh = fs * 0.3528 * 1.15;
    const rows = teams.map(t => ({ ...t, nameW, lines: doc.splitTextToSize(str(t.names.join('  •  ') || '—'), w - 4.4 - nameW) }));
    return { rows, lh, fs, h: rows.reduce((h, r) => h + r.lines.length * lh + 1.4, 0) };
  };
  const drawTeamRows = (tr, x, y) => {
    tr.rows.forEach(r => {
      const rgb = hexRgb(r.couleur) || [120, 120, 120];
      doc.setFillColor(...rgb); doc.circle(x + 1.3, y + tr.lh * 0.5, 1.25, 'F');
      if (rgb[0] + rgb[1] + rgb[2] > 690) { doc.setDrawColor(150, 155, 165); doc.setLineWidth(0.2); doc.circle(x + 1.3, y + tr.lh * 0.5, 1.25, 'S'); }
      doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(tr.fs);
      doc.text(str(`${r.nom.toUpperCase()} (${r.names.length})`), x + 4.2, y, { baseline: 'top' });
      doc.setTextColor(...DARK); doc.setFont('helvetica', 'normal');
      doc.text(r.lines, x + 4.2 + r.nameW, y, { baseline: 'top' });
      y += r.lines.length * tr.lh + 1.4;
    });
    return y;
  };

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
    ['DATE', 'ÉQUIPE', 'DURÉE SÉANCE', 'NB PROCÉDÉS', 'TEMPS DE TRAVAIL', 'TEMPS TOTAL', 'SÉANCE FILMÉE'],
    [fmtDateFr(s.date_seance), s.equipe || '-', fmtMin(s.duree_min) + "'",
     String(procedures.length), fmtMin(travail) + "'", fmtMin(total) + "'", s.filmee ? 'Oui' : 'Non'],
    [1.1, 1, 1.15, 1, 1.25, 1.1, 1.1]);

  /* Séance filmée : qui gère la vidéo, et les procédés filmés sans responsable. */
  if (s.filmee) {
    const who = new Map();
    procedures.forEach((p, i) => { if (procIsFilmed(p, s)) staffOf(p).filter(m => isVideoRole(m.role)).forEach(m => who.set(m.nom.trim(), [...(who.get(m.nom.trim()) || []), `P${i + 1}`])); });
    const orphan = procedures.map((p, i) => (procIsFilmed(p, s) && !staffOf(p).some(m => isVideoRole(m.role)) ? `P${i + 1}` : null)).filter(Boolean);
    const filmedN = procedures.filter(p => procIsFilmed(p, s)).length;
    const txt = [`Séance filmée : ${filmedN} procédé${filmedN > 1 ? 's' : ''} sur ${procedures.length}`,
      who.size && `Gestion vidéo : ${[...who].map(([n, ps]) => `${n} (${ps.join(', ')})`).join(' · ')}`,
      orphan.length && `Sans responsable vidéo : ${orphan.join(', ')}`].filter(Boolean).join('   ·   ');
    doc.setFontSize(8.2);
    const vl = doc.splitTextToSize(str(txt), CW - 7);
    const vh = vl.length * 3.6 + 3.4;
    y += 2;
    fill(M, y, CW, vh, PANEL); fill(M, y, 1.2, vh, ACCENT);
    doc.setTextColor(...DARK); doc.setFont('helvetica', 'normal');
    doc.text(vl, M + 4, y + 1.9, { baseline: 'top' });
    y += vh;
  }

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
      const filmed = procIsFilmed(p, s);
      const rowH = Math.max(9, Math.max(objectif.length, nom.length + (filmed ? 1 : 0)) * 4 + 4);

      /* Un procédé sans schéma n'aura pas de page dédiée : on détaille
         donc ici son objectif, ses consignes et les comportements
         attendus, pour que rien ne soit perdu à l'export. */
      const detailFs = 7.5, detailLineH = 3.4;
      let detailLines = [];
      // Sans schéma, pas de page dédiée : équipes et staff du procédé sont ici aussi.
      const subTeams = p.canvas_image ? { rows: [], h: 0 } : teamRowsFor(p, CW - 7, detailFs);
      if (!p.canvas_image) {
        const ownPrinciple = (p.principes_jeu || '').trim();
        const bits = [
          ownPrinciple && ownPrinciple !== principe && 'Principe de jeu : ' + ownPrinciple,
          p.consignes && 'Consignes : ' + p.consignes,
          p.comportements_individuels && 'Comportements attendus : ' + p.comportements_individuels,
          staffText(p) && 'Staff : ' + staffText(p),
        ].filter(Boolean);
        if (bits.length) {
          doc.setFontSize(detailFs);
          bits.forEach(b => { detailLines = detailLines.concat(doc.splitTextToSize(str(b), CW - 7)); });
        }
      }
      const detailH = detailLines.length || subTeams.rows.length
        ? detailLines.length * detailLineH + (subTeams.rows.length ? subTeams.h + 1 : 0) + 3.5 : 0;

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
      if (filmed) {   // procédé filmé : pastille rouge sous son nom
        const fx = M + cols[0] + 2.5, fy = y + rowH - 3.2;
        doc.setFillColor(...ACCENT); doc.circle(fx + 0.9, fy - 0.7, 0.9, 'F');
        doc.setTextColor(...ACCENT); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.4);
        doc.text('FILMÉ', fx + 2.6, fy, { charSpace: 0.2 });
      }
      y += rowH;

      if (detailH) {
        fill(M, y, CW, detailH, [249, 250, 252]); box(M, y, CW, detailH);
        let dy = y + 3;
        if (detailLines.length) {
          doc.setTextColor(...MUT); doc.setFont('helvetica', 'normal'); doc.setFontSize(detailFs);
          doc.text(detailLines, M + 3.5, dy, { align: 'left', baseline: 'top' });
          dy += detailLines.length * detailLineH;
        }
        if (subTeams.rows.length) drawTeamRows(subTeams, M + 3.5, dy + (detailLines.length ? 1 : 0));
        y += detailH;
      }
    });
  }

  /* Présences : présents regroupés d'abord, absents et indisponibles à part,
     chacun avec la couleur de son statut ; motif et invités signalés. */
  const presents = attendance.filter(a => a.present);
  const absents = attendance.filter(a => !a.present);

  const perCol = 4, colW = CW / perCol, rowH = 6;
  const listH = (n) => n ? Math.ceil(n / perCol) * rowH + 4 : 10;
  const STATUT_RGB = { present: [76, 175, 80], reprise: [38, 166, 154], retard: [255, 152, 0], absent: [190, 190, 196],
    excuse: [120, 144, 156], blesse: [229, 57, 53], malade: [171, 71, 188], selection: [212, 160, 10],
    groupe_pro: [92, 124, 250], autre: [144, 164, 174] };
  const nameOf = (a) => {
    const tags = [a.statut && !['present', 'absent'].includes(a.statut) ? statutLabel(a).toLowerCase() : '',
      a.invite ? `invité${typeof teamName === 'function' && teamName(a.team_id) ? ' · ' + teamName(a.team_id) : ''}` : ''].filter(Boolean);
    return `${a.prenom || ''} ${a.nom}`.trim() + (a.numero != null ? ` #${a.numero}` : '') + (tags.length ? ` (${tags.join(', ')})` : '');
  };

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
      doc.setFillColor(...(STATUT_RGB[a.statut] || (dim ? [200, 200, 205] : [76, 175, 80])));
      doc.circle(x + 1.5, ty2 - 0.8, 1.4, 'F');
      doc.setTextColor(...(dim ? MUT : DARK)); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      // Le nom entier tant qu'il tient dans sa colonne, sinon raccourci à sa largeur.
      let name = str(nameOf(a));
      while (name.length > 4 && doc.getTextWidth(name) > colW - 8) name = `${name.slice(0, -2).trimEnd()}…`;
      doc.text(name, x + 5, ty2);
      doc.link(x + 5, ty2 - 3, doc.getTextWidth(name), 4, { url: playerUrl(a.id) });   // le nom ouvre sa fiche
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
      header(M, y, CW, 7, `Absents et indisponibles — ${absents.length}`, 6.5); y += 7;
      y += nameBlock(y, absents, true);
    }

    /* Terrain d'effectif : la disposition posée dans la séance, compacte. */
    if (hasTerrain(s, attendance)) {
      const ph = 58, pw = ph * 105 / 68;
      if (y + 3 + 7 + ph + 2 > BOTTOM) y = newPage('Suite');
      y += 3;
      header(M, y, CW, 7, 'Terrain d’effectif', 6.5); y += 7;
      drawPitchPdf(doc, { x: M + (CW - pw) / 2, y: y + 1, w: pw, h: ph, terrain: s.terrain, players: attendance,
        accent: typeof pdfAccent === 'function' ? pdfAccent(s.club_color) : (hexRgb(s.club_color) || ACCENT) });
      y += ph + 2;
    }

    /* Ancienne séance : chasubles de toute la séance, une colonne par couleur.
       (Sinon, les équipes sont avec chaque procédé.) */
    const equipes = perProc ? [] : sessionTeams(s.equipes, attendance);
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
      ['TYPE', 'SÉQUENCES', 'TEMPS DE TRAVAIL', 'TEMPS TOTAL', 'ESPACE DE JEU', 'EFFECTIF', ...(s.filmee ? ['FILMÉ'] : [])],
      [p.type_procede || '-', sequenceLabel(p),
       fmtMin(workMin(p)) + "'", fmtMin(totalMin(p)) + "'",
       p.taille_terrain || '-', p.effectif || '-', ...(s.filmee ? [procIsFilmed(p, s) ? 'Oui' : 'Non'] : [])],
      [1, 1.4, 1.2, 1.1, 1.5, 1.2, ...(s.filmee ? [0.8] : [])]);

    /* Zone principale : schéma (gauche) + rubriques auto-extensibles (droite) ;
       sous le schéma ses équipes, sous les rubriques son staff. Tout tient sur la page. */
    const leftW = CW * 0.56, gap = 4, rightX = M + leftW + gap, rightW = CW - leftW - gap;
    const pTeams = teamRowsFor(p, leftW - 5, 7.8);
    doc.setFontSize(7.8);
    const pStaff = staffOf(p).length ? doc.splitTextToSize(str(staffOf(p).map(m => `${m.nom.trim()}${(m.role || '').trim() ? ` — ${m.role.trim()}` : ''}`).join('\n')), rightW - 5) : [];
    const stripBodyH = Math.max(pTeams.h, pStaff.length * 7.8 * 0.3528 * 1.15) + 4;
    const stripH = pTeams.rows.length || pStaff.length ? 6 + stripBodyH : 0;
    const mainY = py + 4;
    const mainH = H - mainY - 10 - (stripH ? stripH + 4 : 0);

    const sz = await imgSize(p.canvas_image);
    const ar = sz ? sz.w / sz.h : 1040 / 680;
    let iw = leftW, ih = iw / ar;
    if (ih > mainH) { ih = mainH; iw = ih * ar; }
    try { doc.addImage(p.canvas_image, 'PNG', M + (leftW - iw) / 2, mainY, iw, ih); } catch (e) {}
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.rect(M + (leftW - iw) / 2, mainY, iw, ih);

    /* Rubriques : hauteur proportionnelle au contenu réel, puis ajustée
       pour remplir la page. Texte long : la police se réduit pour que le
       procédé tienne sur sa page (jamais de page de suite). */
    const bandH = 6;
    const secs = [
      { title: 'Objectif', text: p.objectif },
      { title: 'Consignes', text: p.consignes },
      { title: 'Comportements attendus', text: p.comportements_individuels },
    ];
    const avail = mainH - secs.length * bandH;
    let fs = 9, lineH = 4.1;
    for (const size of [9, 8.5, 8, 7.5, 7, 6.5, 6]) {
      fs = size; lineH = size * 0.4556;
      doc.setFontSize(fs);
      secs.forEach(sec => {
        sec.lines = doc.splitTextToSize(str(sec.text || '—'), rightW - 5);
        sec.need = Math.max(10, sec.lines.length * lineH + 5);   // hauteur minimale lisible
      });
      if (secs.reduce((sum, sec) => sum + sec.need, 0) <= avail) break;
    }
    const totalNeed = secs.reduce((sum, sec) => sum + sec.need, 0);
    // Si ça dépasse, on comprime proportionnellement ; sinon on distribue le surplus.
    const ratio = totalNeed > 0 ? avail / totalNeed : 1;
    secs.forEach(sec => sec.h = sec.need * ratio);

    let ry = mainY;
    secs.forEach(sec => {
      header(rightX, ry, rightW, bandH, sec.title, 6.2);
      fill(rightX, ry + bandH, rightW, sec.h, LIGHT); box(rightX, ry + bandH, rightW, sec.h);
      doc.setTextColor(...DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(fs);
      const maxLines = Math.max(1, Math.floor((sec.h - 3) / lineH));
      const shown = sec.lines.slice(0, maxLines);
      if (sec.lines.length > maxLines) shown[shown.length - 1] = `${shown[shown.length - 1].replace(/\s*\S*$/, '')} …`;
      doc.text(shown, rightX + 2.5, ry + bandH + 4, { align: 'left', baseline: 'top', lineHeightFactor: lineH / (fs * 0.3528) });
      ry += bandH + sec.h;
    });

    // Équipes (sous le schéma) et staff (sous les rubriques), mêmes bandeaux que les rubriques.
    if (stripH) {
      const sy = mainY + mainH + 4;
      header(M, sy, leftW, bandH, 'Équipes', 6.2);
      fill(M, sy + bandH, leftW, stripBodyH, LIGHT); box(M, sy + bandH, leftW, stripBodyH);
      if (pTeams.rows.length) drawTeamRows(pTeams, M + 2.5, sy + bandH + 2.2);
      else { doc.setTextColor(...MUT); doc.setFont('helvetica', 'italic'); doc.setFontSize(7.8); doc.text('—', M + 2.5, sy + bandH + 2.2, { baseline: 'top' }); }
      header(rightX, sy, rightW, bandH, 'Staff', 6.2);
      fill(rightX, sy + bandH, rightW, stripBodyH, LIGHT); box(rightX, sy + bandH, rightW, stripBodyH);
      doc.setTextColor(...DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8);
      doc.text(pStaff.length ? pStaff : ['—'], rightX + 2.5, sy + bandH + 2.2, { baseline: 'top' });
    }
  }

  /* Fin du document : bilan individuel et commentaire général (même en-tête). */
  if (bilans.length || (s.notes || '').trim()) {
    doc.addPage();
    fill(0, 0, W, H, [255, 255, 255]);
    const by = pageHeader(s.titre || 'Séance', 'Bilan de la séance', 'Bilan');
    doc.setLineHeightFactor(1.35);
    const font = (size, style = 'normal', color = DARK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); };
    const lines = (text, width, size) => { doc.setFontSize(size); return doc.splitTextToSize(str(text), width); };
    const contPage = () => { doc.addPage(); fill(0, 0, W, H, [255, 255, 255]); return pageHeader(s.titre || 'Séance', 'Bilan de la séance (suite)', 'Bilan'); };
    drawBilan(doc, { s, attendance, bilans, y: by, M, CW, BOTTOM: H - 12, contPage, font, lines, LH: (size) => size * 0.3528 * 1.35, fill, str });
  }

  numberPages(doc, W, H, M);
  doc.save(`seance-${(s.titre || 'lmfc-performance').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')}.pdf`);
  toast('PDF généré', 'success');
};

/* ============================================================
   RÉCAPITULATIF DES JOUEURS puis COMMENTAIRE GÉNÉRAL
   Lecture rapide : barre + / = / − en tête, puis une ligne par
   joueur (signe coloré, nom, commentaire), les positifs d'abord.
   Noms et commentaires vont à la ligne au lieu de se chevaucher ;
   un long commentaire continue sur la page suivante.
   ============================================================ */
function drawBilan(doc, ctx) {
  const { s, attendance, bilans, M, CW, BOTTOM, font, lines, LH, fill, str } = ctx;
  let y = ctx.y;
  const ensure = (h) => { if (y + h > BOTTOM) y = ctx.contPage(); };
  const section = (title, keep) => { ensure(9 + keep); font(10.5, 'bold', INK); doc.text(str(title), M, y + 5); y += 8; };
  const notes = (s.notes || '').trim();
  const COLORS = { plus: [76, 175, 80], egal: [158, 158, 158], moins: [229, 57, 53] };
  const nameOf = (p) => `${p.prenom || ''} ${p.nom || ''}`.trim();

  if (bilans.length) {
    section('Récapitulatif des joueurs', 22);
    const order = { plus: 0, egal: 1, moins: 2 };
    const rows = [...bilans].sort((a, b) => (order[a.note] ?? 3) - (order[b.note] ?? 3) || nameOf(a.player).localeCompare(nameOf(b.player), 'fr'));
    const count = (k) => bilans.filter(b => b.note === k).length;
    const noted = new Set(bilans.filter(b => b.note).map(b => b.player_id));
    const missing = attendance.filter(a => a.present && !noted.has(a.id));
    // Barre fine de lecture rapide (une part par note), légende dessous.
    const segs = [['plus', count('plus')], ['egal', count('egal')], ['moins', count('moins')], ['none', missing.length]].filter(([, n]) => n);
    const tot = segs.reduce((a, [, n]) => a + n, 0) || 1;
    let bx = M;
    segs.forEach(([k, n]) => { const w = CW * n / tot; fill(bx, y, w, 2.6, COLORS[k] || [226, 229, 234]); bx += w; });
    y += 6;
    const LEG = { plus: 'positif', egal: 'normal', moins: 'en difficulté', none: 'non noté' };
    let lx = M;
    segs.forEach(([k, n]) => {
      doc.setFillColor(...(COLORS[k] || [200, 204, 210])); doc.circle(lx + 1.1, y - 0.9, 1.1, 'F');
      const t = str(`${n} ${LEG[k]}${n > 1 && k !== 'moins' ? 's' : ''}`);
      font(8, 'normal', DARK); doc.text(t, lx + 3.2, y);
      lx += doc.getTextWidth(t) + 9;
    });
    y += 4;
    // Une ligne par joueur : signe | nom (à la ligne s'il est long) | commentaire (à la ligne, puis page suivante).
    const signW = 9, nameW = 64, comX = M + signW + nameW + 3, comW = CW - signW - nameW - 5;
    rows.forEach(b => {
      const nl = lines(nameOf(b.player), nameW - 4, 9);
      let rest = (b.commentaire || '').trim() ? lines(b.commentaire.trim(), comW, 8.6) : [];
      let first = true;
      do {
        const need = first ? Math.max(nl.length * LH(9), Math.min(rest.length, 2) * LH(8.6)) + 3 : LH(8.6) + 3;
        ensure(need);
        const part = rest.slice(0, Math.max(1, Math.floor((BOTTOM - y - 3) / LH(8.6))));
        rest = rest.slice(part.length);
        const h = Math.max(first ? nl.length * LH(9) : 0, part.length * LH(8.6)) + 3;
        doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(M, y + h, M + CW, y + h);
        if (first) {
          // Pastille de la note : signe blanc sur sa couleur.
          doc.setFillColor(...(COLORS[b.note] || [200, 204, 210])); doc.circle(M + 3, y + 3.6, 2.5, 'F');
          font(8.6, 'bold', [255, 255, 255]);
          doc.text(str(b.note ? BILAN_NOTES.find(x => x.key === b.note).sign : '·'), M + 3, y + 3.75, { align: 'center', baseline: 'middle' });
          font(9, 'bold', INK); doc.text(nl, M + signW + 3, y + 4.4);
          doc.link(M + signW + 3, y + 1, nameW - 4, nl.length * LH(9) + 1, { url: playerUrl(b.player.id) });
        }
        if (part.length) { font(8.6, 'normal', DARK); doc.text(part, comX, y + 4.4); }
        y += h;
        first = false;
      } while (rest.length);
    });
    if (missing.length) {
      const ml = lines('Non notés : ' + missing.map(nameOf).join(', '), CW, 8);
      ensure(ml.length * LH(8) + 3);
      font(8, 'italic', MUT); doc.text(ml, M, y + 3.5);
      y += ml.length * LH(8) + 3;
    }
    y += 5;
  }

  if (notes) {
    section('Commentaire général', 12);
    const nl = lines(notes, CW - 8, 9.2);   // les retours à la ligne saisis sont gardés
    let i = 0;
    while (i < nl.length) {
      ensure(LH(9.2) + 5);
      const part = nl.slice(i, i + Math.max(1, Math.floor((BOTTOM - y - 5) / LH(9.2))));
      const h = part.length * LH(9.2) + 4.5;
      fill(M, y, CW, h, [249, 250, 252]);
      doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.rect(M, y, CW, h);
      font(9.2, 'normal', DARK); doc.text(part, M + 4, y + 5.1);
      i += part.length; y += h;
    }
    y += 4;
  }
  return y;
}
