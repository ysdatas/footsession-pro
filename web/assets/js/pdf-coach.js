/* ============================================================
   LMFC Performance — pdf-coach.js
   « Fiche coach » : à distribuer au staff juste avant la séance.

   Un procédé par QUART de page A4 paysage, soit 4 procédés par
   feuille — au-delà, on passe en recto verso (8 procédés = 2 pages).
   Le schéma occupe l'essentiel du quart ; le texte se limite au
   nom, à la structure des séquences, aux équipes du procédé (couleur
   et joueurs), à son staff et à l'objectif. En page 1, sous le
   bandeau : le principe de jeu de la séance (et, pour une ancienne
   séance, ses chasubles en colonnes compactes). Le terrain d'effectif,
   s'il est demandé, prend le quart suivant le dernier procédé.

   Avant chaque export, une fenêtre propose ce qui figure sur la fiche
   (seulement ce que la séance contient) et le format des noms ;
   « Mémoriser » garde ces choix pour le compte (profiles.prefs.pdf_coach).

   Exposé : window.generateCoachPDF(sessionId)
   ============================================================ */

const COACH_PER_PAGE = 4;          // 2 colonnes × 2 rangées
const SCHEMA_SHARE = 0.65;         // part de la largeur du quart pour le schéma
const COACH_PARTS = [
  ['principe', 'Principe de jeu'], ['schemas', 'Schémas tactiques'], ['equipes', 'Équipes et joueurs'],
  ['staff', 'Staff'], ['meta', 'Type, terrain et effectif'], ['durees', 'Séquences et durées'],
  ['texte', 'Objectif et consignes'], ['filme', 'Mention « filmé »'], ['terrain', 'Terrain d’effectif'],
];

window.generateCoachPDF = async function (sessionId) {
  const lib = window.jspdf;
  if (!lib || !lib.jsPDF) { toast('Module PDF non chargé.', 'error'); return; }

  const loaded = await window.loadSessionForPdf(sessionId);
  if (!loaded) return;
  const { s, procedures, attendance } = loaded;
  const principe = sessionPrinciple(s, procedures);
  // Ancienne séance : chasubles de toute la séance, en tête. Sinon, dans chaque procédé.
  const perProc = procedures.some(p => Array.isArray(p.equipes) && p.equipes.length);
  const staffOf = (p) => (Array.isArray(p.staff) ? p.staff : []).filter(m => (m.nom || '').trim());

  // Ce que la séance contient : seules ces options sont proposées.
  const avail = {
    principe: !!principe,
    schemas: procedures.some(p => p.canvas_image),
    equipes: perProc || sessionTeams(s.equipes, attendance).length > 0,
    staff: procedures.some(p => staffOf(p).length),
    meta: procedures.some(p => p.type_procede || p.taille_terrain || p.effectif),
    durees: procedures.length > 0,
    texte: procedures.some(p => p.objectif || p.consignes || (p.principes_jeu || '').trim()),
    filme: !!s.filmee,
    terrain: hasTerrain(s, attendance),
  };
  const opts = await askCoachOptions(avail);
  if (!opts) return;   // annulé
  const show = (k) => avail[k] && !opts.hide.includes(k);
  toast('Génération de la fiche coach…');

  // Noms des joueurs : prénom seul ou prénom et nom (jamais le numéro, qui encombre).
  const nameOf = opts.noms === 'prenom' ? (a) => a.prenom || a.nom || '' : (a) => `${a.prenom || ''} ${a.nom || ''}`.trim();
  const teams = perProc || !show('equipes') ? [] : sessionTeams(s.equipes, attendance, nameOf);

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
      show('durees') ? `travail ${fmtMin(sessionWorkMin(procedures))}'` : null,
      show('durees') ? `total ${fmtMin(sessionTotalMin(procedures))}'` : null,
      show('filme') ? 'séance filmée' : null,
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
    if (show('principe')) {
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

  // Quarts de page : les procédés, puis le terrain d'effectif s'il est demandé.
  const cells = [...procedures.map((p, i) => ({ p, i })), ...(show('terrain') ? [{ terrain: true }] : [])];
  if (!cells.length) {
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
    if (!p.canvas_image || !show('schemas')) return null;
    const sz = await imgSize(p.canvas_image);
    return sz ? sz.w / sz.h : 1040 / 680;
  }));

  const nbPages = Math.ceil(cells.length / COACH_PER_PAGE);
  for (let page = 0; page < nbPages; page++) {
    if (page > 0) doc.addPage();
    let top = banner();
    if (page === 0) top += sessionStrip(top, false);

    // Géométrie des quatre quarts.
    const gap = 3;
    const cellW = (W - 2 * M - gap) / 2;
    const cellH = (H - top - 9 - gap) / 2;   // le bas de page garde son numéro

    cells.slice(page * COACH_PER_PAGE, (page + 1) * COACH_PER_PAGE).forEach((c, k) => {
      const x = M + (k % 2) * (cellW + gap);
      const y = top + Math.floor(k / 2) * (cellH + gap);
      if (c.terrain) drawTerrainQuarter(x, y, cellW, cellH);
      else drawQuarter(c.p, c.i, x, y, cellW, cellH, ratios[c.i]);
    });
  }

  /* Bandeau de titre d'un quart : numéro, nom, et à droite les séquences. */
  function quarterTitle(x, y, w, num, name, right) {
    const tH = 6.4;
    fill(x, y, w, tH, PANEL);
    doc.setTextColor(...gold); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.4);
    if (num) doc.text(num, x + 2.2, y + tH / 2, { baseline: 'middle' });
    doc.setTextColor(...MUT); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
    if (right) doc.text(right, x + w - 2, y + tH / 2, { align: 'right', baseline: 'middle' });
    // Nom : raccourci s'il touche les séquences, jamais par-dessus.
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.4);
    const room = w - 6.5 - (right ? doc.getTextWidth(right) : 0) - 6;
    let title = str(name.toUpperCase());
    while (title.length > 4 && doc.getTextWidth(title) > room) title = `${title.slice(0, -2).trimEnd()}…`;
    doc.text(title, x + (num ? 6.5 : 2.2), y + tH / 2, { baseline: 'middle' });
    return tH;
  }

  /* ---------- Le terrain d'effectif, dans un quart ---------- */
  function drawTerrainQuarter(x, y, w, h) {
    box(x, y, w, h);
    const tH = quarterTitle(x, y, w, '', 'Terrain d’effectif', '');
    const pad = 3, availW = w - 2 * pad, availH = h - tH - 2 * pad - 3;
    let pw = availW, ph = pw * 68 / 105;
    if (ph > availH) { ph = availH; pw = ph * 105 / 68; }
    drawPitchPdf(doc, { x: x + (w - pw) / 2, y: y + tH + pad, w: pw, h: ph, terrain: s.terrain, players: attendance, accent: gold, nameOf });
  }

  /* ---------- Un quart de page ---------- */
  function drawQuarter(p, index, x, y, w, h, ratio) {
    const pad = 2.2;
    box(x, y, w, h);
    const tH = quarterTitle(x, y, w, `${index + 1}`, p.nom || 'Procédé', show('durees') ? str(sequenceLabel(p)) : '');

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
      try { doc.addImage(p.canvas_image, 'PNG', ix, iy, iw, ih); } catch (e) { console.warn('Schéma non ajouté', e); }
      doc.setDrawColor(...LINE); doc.setLineWidth(0.25); doc.rect(ix, iy, iw, ih);
    } else {
      // Pas de schéma (ou masqué) : le texte récupère toute la largeur du quart.
      drawText(x + pad, innerY, w - 2 * pad, innerH);
      return;
    }
    drawText(textX, innerY, textW, innerH);

    /* Colonne de texte : type et espace en tête, puis le principe de jeu.
       La police se réduit si nécessaire pour ne jamais déborder du quart. */
    function drawText(tx, ty, tw, th) {
      let cy = ty;
      const meta = show('meta') ? [p.type_procede, [p.taille_terrain, p.effectif].filter(Boolean).join(' · ')]
        .filter(Boolean).join('   ·   ') : '';
      if (meta) {
        doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8);
        const ml = doc.splitTextToSize(meta.toUpperCase(), tw);
        doc.text(ml, tx, cy, { baseline: 'top' });
        cy += ml.length * 2.9 + 1.6;
      }
      // Équipes du procédé : carré de couleur, nom, joueurs.
      if (perProc && show('equipes')) {
        doc.setFontSize(6.2);
        sessionTeams(procTeamsOf(p, s, procedures), attendance, nameOf).forEach(t => {
          const tl = doc.splitTextToSize(str(`${t.nom} : ${t.names.join(' • ')}`), tw - 3.2);
          if (cy + tl.length * 2.6 > ty + th - 3) return;
          doc.setFillColor(...(hexRgb(t.couleur) || [120, 120, 120])); doc.rect(tx, cy + 0.4, 2, 2, 'F');
          doc.setTextColor(...DARK); doc.setFont('helvetica', 'normal');
          doc.text(tl, tx + 3.2, cy, { baseline: 'top' });
          cy += tl.length * 2.6 + 0.8;
        });
      }
      // Staff du procédé (et « filmé »).
      const staff = show('staff') ? staffOf(p).map(m => `${m.nom.trim()}${(m.role || '').trim() ? ` (${m.role.trim()})` : ''}`).join(' · ') : '';
      const filmed = show('filme') && procIsFilmed(p, s);
      const staffTxt = staff ? `Staff : ${staff}${filmed ? ' · filmé' : ''}` : (filmed ? 'Procédé filmé' : '');
      if (staffTxt) {
        doc.setTextColor(...MUT); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.2);
        const sl = doc.splitTextToSize(str(staffTxt), tw);
        doc.text(sl, tx, cy, { baseline: 'top' });
        cy += sl.length * 2.6 + 1.2;
      }
      if (!show('texte')) return;
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
  return `seance-${(s.titre || 'lmfc-performance').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}-fiche-coach.pdf`;
}

/* ---------- Fenêtre d'options (avant chaque export) ----------
   Choix par défaut : ceux mémorisés par le compte (prefs.pdf_coach :
   { noms, hide }), sinon tout affiché et les noms complets. Renvoie
   { noms, hide } ou null si l'on ferme la fenêtre. */
function askCoachOptions(avail) {
  let modal = document.getElementById('coachPdfModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'coachPdfModal';
    modal.innerHTML = `<div class="modal cp-modal" role="dialog" aria-modal="true" aria-labelledby="cpTitle">
      <h3 id="cpTitle">Fiche coach</h3>
      <div class="field" id="cpNames"><span class="field-label">Noms des joueurs</span>
        <div class="cp-seg" role="radiogroup" aria-label="Noms des joueurs">
          <label><input type="radio" name="cpNoms" value="complet"> Prénom et nom</label>
          <label><input type="radio" name="cpNoms" value="prenom"> Prénom seulement</label>
        </div></div>
      <div class="field"><span class="field-label">Sur la fiche</span><div class="cp-parts" id="cpParts"></div></div>
      <label class="cp-check"><input type="checkbox" id="cpRemember"> Mémoriser ces choix pour mes prochains exports</label>
      <div class="modal-actions">
        <button class="btn" type="button" data-cp="cancel">Annuler</button>
        <button class="btn btn-primary" type="button" data-cp="go">Générer la fiche</button>
      </div></div>`;
    document.body.appendChild(modal);
  }
  const saved = window.CURRENT_PROFILE?.prefs?.pdf_coach || {};
  const hidden = new Set(saved.hide || []);
  modal.querySelector(`[name="cpNoms"][value="${saved.noms === 'prenom' ? 'prenom' : 'complet'}"]`).checked = true;
  modal.querySelector('#cpNames').classList.toggle('hidden', !avail.equipes && !avail.terrain);
  modal.querySelector('#cpParts').innerHTML = COACH_PARTS.filter(([k]) => avail[k])
    .map(([k, label]) => `<label class="cp-check"><input type="checkbox" value="${k}"${hidden.has(k) ? '' : ' checked'}> ${label}</label>`).join('');
  modal.querySelector('#cpRemember').checked = false;
  openModal('coachPdfModal');
  modal.querySelector('[data-cp="go"]').focus();

  return new Promise(resolve => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      observer.disconnect();
      modal.removeEventListener('click', onClick);
      closeModal('coachPdfModal');
      resolve(value);
    };
    // Fermée autrement (Échap, clic à côté : app.js) : annulé.
    const observer = new MutationObserver(() => { if (!modal.classList.contains('open')) finish(null); });
    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
    const onClick = async (e) => {
      const b = e.target.closest('[data-cp]');
      if (!b) return;
      if (b.dataset.cp === 'cancel') return finish(null);
      // Les options non proposées (absentes de cette séance) gardent leur réglage mémorisé.
      const shownHide = [...modal.querySelectorAll('#cpParts input')].filter(c => !c.checked).map(c => c.value);
      const keep = [...hidden].filter(k => !avail[k]);
      const opts = { noms: modal.querySelector('[name="cpNoms"]:checked')?.value || 'complet', hide: [...keep, ...shownHide] };
      if (modal.querySelector('#cpRemember').checked) {
        try { await savePrefsPatch({ pdf_coach: opts }); toast('Choix mémorisés pour les prochaines fiches', 'success'); }
        catch (err) { console.error('Préférences de la fiche coach non enregistrées', err); toast(err.message, 'error'); }
      }
      finish(opts);
    };
    modal.addEventListener('click', onClick);
  });
}
