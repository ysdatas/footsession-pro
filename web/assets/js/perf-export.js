/* ============================================================
   LMFC Performance — perf-export.js
   Export de la fiche joueur en fichier PDF, généré directement dans le
   navigateur (jsPDF, mise en page commune : pdf-kit.js), sans passer
   par la fenêtre d'impression. Réservé au staff.

   Le document est construit à partir des données déjà chargées par
   player-performance-page.js : rien n'est recalculé ni complété, une
   donnée absente reste « — ».
   ============================================================ */

/* Correspondance session de tests → mois de mesures, pour les raccourcis.
   ponytail: découpage fixe de la saison ; à rendre réglable par club si
   les calendriers de tests diffèrent. */
const EXPORT_PRESETS = {
  all: { stages: ['pre', 'mid', 'end'], from: 'Août',     to: 'Juin' },
  pre: { stages: ['pre'],               from: 'Août',     to: 'Octobre' },
  mid: { stages: ['mid'],               from: 'Novembre', to: 'Février' },
  end: { stages: ['end'],               from: 'Mars',     to: 'Juin' },
};

function exportChecked(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);
}

function applyExportPreset(key) {
  const preset = EXPORT_PRESETS[key];
  if (!preset) return;
  document.querySelectorAll('input[name="exp-stage"]').forEach(i => { i.checked = preset.stages.includes(i.value); });
  document.getElementById('exp-from').value = preset.from;
  document.getElementById('exp-to').value = preset.to;
  document.querySelectorAll('#exportPresets .chip').forEach(c => c.classList.toggle('active', c.dataset.preset === key));
}

function openExportModal() {
  if (!isStaff() || !player) return;
  openPerfModal('exportModal');
}

/* ------------------------------------------------------------
   Construction du document (pdf-kit.js : texte vectoriel, sauts de
   page maîtrisés). Rien n'est recalculé ni complété : une donnée
   absente reste « — ».
   ------------------------------------------------------------ */
const longDate = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

/* Test retenu pour une session : la ligne la plus récente du joueur. */
function exportTestFor(stageKey) {
  const rows = tests.filter(t => t.stage === stageKey).sort((a, b) => (a.id || 0) - (b.id || 0));
  return rows.length ? rows[rows.length - 1] : null;
}

/* Moyennes du club pour une session, calculées comme à l'écran. */
function exportAveragesFor(stageKey) {
  const squad = latestPerPlayer(clubTestsAll.filter(t => t.stage === stageKey));
  if (!squad.length) return null;
  const keys = [...PERF_METRICS.map(m => m.key), ...SCORE_LABELS.map(([k]) => k)];
  const out = { n_players: squad.length };
  for (const k of keys) out[k] = perfAverage(squad, k).value;
  return out;
}

async function exportProfile(k, fromIdx, toIdx) {
  const age = ageFrom(player.date_naissance);
  const facts = [
    ['Poste', player.poste],
    ['Équipe', typeof teamName === 'function' ? teamName(player.team_id) : null],
    ['Naissance', player.date_naissance ? `${longDate(player.date_naissance)}${age !== null ? ` (${age} ans)` : ''}` : null],
    ['Pied fort', player.pied_fort],
    ['Nationalité', player.nationalite],
    ['Statut', player.statut],
    ['Fin de contrat', player.contrat_fin ? longDate(player.contrat_fin) : null],
  ].filter(([, v]) => v);
  const photo = document.getElementById('playerPhoto');
  const photoImg = photo && !photo.classList.contains('hidden') ? await pdfImage(photo.src, 600, { square: true }) : null;

  k.section('Profil', { keep: 30 });
  const y0 = k.y, ph = 30, fx = k.M + (photoImg ? ph + 7 : 0), colW = (k.CW - (fx - k.M)) / 2;
  if (photoImg) {
    try { k.doc.addImage(photoImg.data, photoImg.fmt, k.M, y0, ph, ph); } catch (e) { console.warn('Photo non ajoutée', e); }
  }
  facts.forEach(([label, value], i) => {
    const x = fx + (i % 2) * colW, y = y0 + Math.floor(i / 2) * 9.2;
    k.font(6.4, 'bold', PDF_SOFT); k.write(label.toUpperCase(), x, y, { charSpace: 0.25 });
    k.font(9.4, 'normal', PDF_TEXT); k.write(k.lines(value, colW - 4, 9.4)[0], x, y + 3.3);
  });
  k.y = Math.max(y0 + (photoImg ? ph : 0), y0 + Math.ceil(facts.length / 2) * 9.2) + 6;

  // Chiffres clés : dernière mesure de la période, dernier test des sessions choisies.
  const inRange = [...measurements].sort(measurementOrder)
    .filter(m => { const i = MONTHS.indexOf(m.month_label); return i >= fromIdx && i <= toIdx; });
  const last = (key) => inRange.filter(m => num(m[key]) !== null).at(-1);
  const lastTest = STAGES.map(s => exportTestFor(s.key)).filter(t => t && num(t.vift_kmh) !== null).at(-1);
  const kpis = [
    ['Taille', last('height_cm'), (m) => `${fmt(m.height_cm / 100, 2)} m`],
    ['Poids', last('weight_kg'), (m) => `${fmt(m.weight_kg, 1)} kg`],
    ['Masse grasse', last('body_fat_pct'), (m) => `${fmt(m.body_fat_pct, 1)} %`],
  ].map(([label, m, f]) => ({ label, value: m ? f(m) : '—', sub: m ? m.month_label : 'Pas de mesure' }));
  kpis.push({ label: '30-15 VIFT', value: lastTest ? `${fmt(lastTest.vift_kmh, 1)} km/h` : '—',
    sub: lastTest ? STAGES.find(s => s.key === lastTest.stage)?.label : 'Pas de test' });
  k.kpis(kpis);
}

function exportCareer(k) {
  k.section('Parcours');
  k.table({
    cols: [{ label: 'Club', w: 1.5, strong: true }, { label: 'Catégorie', w: 1.2 }, { label: 'Période', w: 1.6 }, { label: 'Durée', w: 0.9, align: 'right' }],
    rows: career.map(c => [c.club_name, c.categorie || '—',
      `${c.date_debut ? monthYear(c.date_debut) : '—'} – ${c.date_fin ? monthYear(c.date_fin) : 'aujourd’hui'}`,
      careerDuration(c.date_debut, c.date_fin) || '—']),
    empty: 'Aucun club renseigné.',
  });
}

function exportMeasures(k, fromIdx, toIdx) {
  const rows = [...measurements].sort(measurementOrder)
    .filter(m => { const i = MONTHS.indexOf(m.month_label); return i >= fromIdx && i <= toIdx; });
  k.section('Mesures physiques', { note: `${MONTHS[fromIdx]} – ${MONTHS[toIdx]}` });
  const v = (x, d, unit) => (x != null ? `${fmt(x, d)} ${unit}` : '—');
  k.table({
    cols: [{ label: 'Mois', w: 1.3, strong: true }, { label: 'Taille', align: 'right' }, { label: 'Poids', align: 'right' },
      { label: 'Masse grasse', w: 1.2, align: 'right' }, { label: 'Somme 4 plis', w: 1.2, align: 'right' }],
    rows: rows.map(m => [m.month_label, v(m.height_cm, 0, 'cm'), v(m.weight_kg, 1, 'kg'), v(m.body_fat_pct, 1, '%'), v(m.skinfold_sum_4_mm, 1, 'mm')]),
    empty: 'Aucune mesure sur cette période.',
  });
}

function exportTests(k, stageKeys, withTable, withCompare, withRadar) {
  const stagesWithData = STAGES.filter(s => stageKeys.includes(s.key) && exportTestFor(s.key));
  if (!stagesWithData.length) {
    k.section('Tests physiques');
    k.text('Aucun test sur les sessions choisies.', { color: PDF_MUTE, style: 'italic' });
    return;
  }
  stagesWithData.forEach(s => {
    const test = exportTestFor(s.key);
    const ref = withCompare ? exportAveragesFor(s.key) : null;
    const hasRef = !!ref && PERF_METRICS.some(m => num(ref[m.key]) !== null);
    const radarSize = 70, side = withTable && withRadar;
    k.section(`Tests physiques — ${s.label}`, { note: test.tested_at ? longDate(test.tested_at) : '', keep: side ? 88 : withRadar ? radarSize + 4 : 40 });
    const y0 = k.y;
    let flagged = false;
    if (withTable) {
      const rows = PERF_METRICS.map(m => {
        const val = num(test[m.key]), r = hasRef ? num(ref[m.key]) : null;
        const bad = isImplausible(m.key, val); flagged ||= bad;
        const d = bad ? null : perfDelta(m.key, val, r);
        const unit = m.unit ? ` ${m.unit}` : '';
        return [m.label, val === null ? '—' : `${fmt(val, m.digits)}${unit}${bad ? ' *' : ''}`,
          ...(hasRef ? [r === null ? '—' : `${fmt(r, m.digits)}${unit}`,
            d === null ? '—' : { text: `${d >= 0 ? '+' : '-'}${fmt(Math.abs(d), m.digits)}`, color: d > 0 ? PDF_GOOD : d < 0 ? PDF_BAD : PDF_TEXT, bold: true }] : [])];
      });
      k.table({
        width: side ? k.CW - radarSize - 6 : k.CW,
        cols: [{ label: 'Test', w: 1.7 }, { label: 'Valeur', align: 'right' }, ...(hasRef ? [{ label: refLabel(), w: 1.1, align: 'right' }, { label: 'Écart', w: 0.8, align: 'right' }] : [])],
        rows,
      });
    }
    if (withRadar) {
      const ry = side ? y0 : k.y;
      if (!side) k.ensure(radarSize);
      k.radar({
        x: side ? k.M + k.CW - radarSize : k.M + (k.CW - radarSize) / 2, y: side ? ry : k.y, size: radarSize,
        axes: SCORE_LABELS.map(([key, label]) => ({ label, value: scoreValue(test, key) })),
        ref: hasRef ? SCORE_LABELS.map(([key]) => num(ref[key])) : null,
      });
      k.y = Math.max(k.y, (side ? ry : k.y) + radarSize + 3);
    }
    const notes = [
      flagged && '* Valeur hors des bornes habituelles : à vérifier.',
      hasRef && `${refLabel()} : joueurs du groupe ayant passé chaque test lors de cette session (à partir de 3), valeurs aberrantes exclues. Écart positif = meilleur que la moyenne. Profil athlétique sur 10${withRadar ? ' (pointillés : la moyenne)' : ''}.`,
    ].filter(Boolean);
    notes.forEach(n => k.text(n, { size: 7.2, color: PDF_MUTE, after: 1 }));
    k.y += 3;
  });
}

async function exportNotes(k, kind, title, withImages) {
  const list = noteStore.notes.filter(n => n.kind === kind)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id - b.id));
  k.section(title, { keep: 18 });
  if (!list.length) { k.text(NOTE_KINDS[kind]?.empty || 'Aucun élément.', { color: PDF_MUTE, style: 'italic' }); return; }
  for (const [i, n] of list.entries()) {
    const head = (n.title || '').trim();
    const titleLines = head ? k.lines(head, k.CW - 30, 9.6) : [];
    k.ensure(titleLines.length * k.lh(9.6) + 10);
    const y0 = k.y;
    if (titleLines.length) { k.font(9.6, 'bold', PDF_INK); k.write(titleLines, k.M, k.y); k.y += titleLines.length * k.lh(9.6) + 1.2; }
    if (hasStatus(kind)) {
      const st = OBJ_STATUS[objStatusOf(n)];
      const rgb = objStatusOf(n) === 'achieved' ? PDF_GOOD : objStatusOf(n) === 'missed' ? PDF_BAD : k.ACC;
      k.pill(st.label, k.M + k.CW, y0 - 0.2, rgb, { right: true });
    }
    k.text(n.body, { size: 9, width: k.CW - (head ? 0 : 30), after: 2 });
    const docs = noteMedia(n.id).filter(isPdfMedia);
    if (docs.length) k.text(`PDF joint : ${docs.map(m => m.caption || 'document').join(', ')} (à ouvrir sur la plateforme)`, { size: 8.4, color: PDF_MUTE, style: 'italic', after: 2 });
    if (withImages) {
      const imgs = noteImages(n.id);
      if (imgs.length) await k.images(imgs.map(m => ({ src: m.signed_url, caption: m.caption })));
    }
    // Programme terrain : la vidéo (son titre : elle se regarde sur la plateforme) et les exercices du point.
    if (isPoint(kind)) {
      const v = pointVideo(n);
      if (v) k.text(`Vidéo : ${v.titre || 'Vidéo'} (à regarder sur la plateforme)`, { size: 8.4, color: PDF_MUTE, style: 'italic', after: 2 });
      for (const [j, e] of pointExercises(n).entries()) await exportExercise(k, e, `Exo ${j + 1}`, withImages);
    }
    if (i < list.length - 1) { k.y += 1; k.hline(k.M, k.M + k.CW, k.y); k.y += 4; }
  }
  k.y += 3;
}

/* Un exercice : titre (et son rang dans le point), dosage, consignes,
   image et schéma si les images sont demandées. */
async function exportExercise(k, e, label, withImages) {
  const head = `${label ? `${label} — ` : ''}${e.title}${e.done_at ? ' (fait)' : ''}`;
  const lines = k.lines(head, k.CW - 6, 9.2);
  k.ensure(lines.length * k.lh(9.2) + 8);
  k.font(9.2, 'bold', PDF_INK); k.write(lines, k.M + 4, k.y); k.y += lines.length * k.lh(9.2) + 1;
  if (e.dosage) k.text(`Dosage : ${e.dosage}`, { size: 8.6, color: PDF_MUTE, width: k.CW - 4, after: 1 });
  if (e.instructions) k.text(e.instructions, { size: 8.8, width: k.CW - 4, after: 1.5 });
  if (withImages) {
    const imgs = [e.image_url && { src: e.image_url, caption: e.image_caption || '' }, e.schema_url && { src: e.schema_url, caption: 'Schéma' }].filter(Boolean);
    if (imgs.length) await k.images(imgs);
  }
  k.y += 2;
}

/* Tous les exercices du programme, par séance. */
async function exportProgram(k, withImages) {
  const list = (typeof prog !== 'undefined' && prog.exercises) || [];
  k.section('Exercices du programme', { keep: 18 });
  if (!list.length) { k.text('Aucun exercice.', { color: PDF_MUTE, style: 'italic' }); return; }
  const groups = new Map();
  list.forEach(e => { const g = (e.seance || '').trim() || 'Exercices'; groups.set(g, [...(groups.get(g) || []), e]); });
  for (const [name, exs] of groups) {
    if (groups.size > 1 || name !== 'Exercices') k.text(name, { size: 9.6, style: 'bold', color: k.ACC, after: 1.5 });
    for (const e of exs) await exportExercise(k, e, '', withImages);
  }
  k.y += 3;
}

function exportFileName() {
  return pdfFileName('fiche', player.prenom, player.nom, localToday());
}

async function runExport() {
  if (!isStaff() || !player) return;
  const sections = new Set(exportChecked('exp-sec'));
  if (!sections.size) return notify('Choisissez au moins une rubrique.', 'error');
  const stageKeys = exportChecked('exp-stage');
  let fromIdx = MONTHS.indexOf(document.getElementById('exp-from').value);
  let toIdx = MONTHS.indexOf(document.getElementById('exp-to').value);
  if (fromIdx > toIdx) [fromIdx, toIdx] = [toIdx, fromIdx];

  const btn = document.getElementById('btnRunExport');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Génération…';
  try {
    const fullName = `${player.prenom || ''} ${player.nom || ''}`.trim() || 'Joueur';
    const club = ctxProfile?.clubs?.nom || 'Le Mans FC';
    const team = typeof teamName === 'function' ? teamName(player.team_id) : '';
    const age = ageFrom(player.date_naissance);
    const season = latestSeasonOf([...measurements, ...tests]);
    const k = await openPdf({ accent: ctxProfile?.clubs?.color, runTitle: `${fullName} · Dossier performance`, runRight: club });
    k.cover({
      kicker: `${club} · Dossier performance`,
      title: fullName,
      subtitle: [player.poste, team, age !== null ? `${age} ans` : null].filter(Boolean).join(' · '),
      facts: [
        season && ['Saison', season.replace('-', ' – ')],
        ['Sessions', stageKeys.length === 3 ? 'Toute la saison' : STAGES.filter(s => stageKeys.includes(s.key)).map(s => s.label).join(', ') || 'Aucune'],
        ['Édité le', new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })],
      ].filter(Boolean),
    });
    if (sections.has('identity')) { await exportProfile(k, fromIdx, toIdx); exportCareer(k); }
    if (sections.has('measures')) exportMeasures(k, fromIdx, toIdx);
    if (sections.has('tests') || sections.has('radar')) {
      exportTests(k, stageKeys, sections.has('tests'), sections.has('compare') && sections.has('tests'), sections.has('radar'));
    }
    const withImages = sections.has('images');
    if (sections.has('strength')) await exportNotes(k, 'strength', 'Points forts', withImages);
    if (sections.has('improvement')) await exportNotes(k, 'improvement', 'Axes d’amélioration', withImages);
    if (sections.has('prevention')) await exportNotes(k, 'prevention', 'Préventions', withImages);
    if (sections.has('exercises')) await exportProgram(k, withImages);
    k.save(exportFileName());
    closePerfModal('exportModal');
    notify('PDF généré.', 'success');
  } catch (e) {
    console.error('Export PDF impossible', e);
    notify(`Export PDF impossible : ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

(function initExport() {
  const from = document.getElementById('exp-from');
  const to = document.getElementById('exp-to');
  if (!from || !to) return;
  const options = MONTHS.map(m => `<option>${m}</option>`).join('');
  from.innerHTML = options;
  to.innerHTML = options;
  applyExportPreset('all');

  document.getElementById('btnExport')?.addEventListener('click', openExportModal);
  document.getElementById('btnRunExport')?.addEventListener('click', runExport);
  document.querySelectorAll('#exportPresets .chip').forEach(c =>
    c.addEventListener('click', () => applyExportPreset(c.dataset.preset)));
  // Une modification manuelle de la période désactive le raccourci actif.
  document.querySelectorAll('input[name="exp-stage"], #exp-from, #exp-to').forEach(el =>
    el.addEventListener('change', () =>
      document.querySelectorAll('#exportPresets .chip').forEach(c => c.classList.remove('active'))));
})();
