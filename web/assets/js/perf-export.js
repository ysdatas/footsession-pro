/* ============================================================
   LMFC Performance — perf-export.js
   Export de la fiche joueur en fichier PDF, généré directement dans le
   navigateur (html2pdf.js : html2canvas + jsPDF), sans passer par la
   fenêtre d'impression. Réservé au staff.

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
   Construction du document
   ------------------------------------------------------------ */
function exportIdentity() {
  const age = ageFrom(player.date_naissance);
  const rows = [
    ['Poste', player.poste],
    ['Équipe', typeof teamName === 'function' ? teamName(player.team_id) : null],
    ['Date de naissance', player.date_naissance ? `${frDate(player.date_naissance)}${age !== null ? ` (${age} ans)` : ''}` : null],
    ['Pied fort', player.pied_fort],
    ['Statut', player.statut],
  ];
  const photo = document.getElementById('playerPhoto');
  const photoSrc = photo && !photo.classList.contains('hidden') ? photo.src : '';

  const careerHtml = career.length
    ? `<table class="ps-table"><thead><tr><th>Club</th><th>Catégorie</th><th>Période</th><th>Durée</th></tr></thead><tbody>
        ${career.map(c => `<tr>
          <td><strong>${esc(c.club_name)}</strong></td>
          <td>${esc(c.categorie || '—')}</td>
          <td>${c.date_debut ? esc(monthYear(c.date_debut)) : '—'} – ${c.date_fin ? esc(monthYear(c.date_fin)) : 'aujourd’hui'}</td>
          <td>${esc(careerDuration(c.date_debut, c.date_fin) || '—')}</td>
        </tr>`).join('')}
      </tbody></table>`
    : '<p class="ps-empty">Aucun club renseigné.</p>';

  return `<section class="ps-section ps-identity">
    ${photoSrc ? `<img class="ps-photo" src="${esc(photoSrc)}" alt="">` : ''}
    <div>
      <h2>Identité</h2>
      <dl class="ps-dl">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v ? esc(v) : '—'}</dd>`).join('')}</dl>
    </div>
  </section>
  <section class="ps-section"><h2>Parcours</h2>${careerHtml}</section>`;
}

function exportMeasures(fromIdx, toIdx) {
  const rows = [...measurements]
    .sort(measurementOrder)
    .filter(m => { const i = MONTHS.indexOf(m.month_label); return i >= fromIdx && i <= toIdx; });
  const range = `${MONTHS[fromIdx]} – ${MONTHS[toIdx]}`;
  if (!rows.length) {
    return `<section class="ps-section"><h2>Mesures physiques <small>${esc(range)}</small></h2>
      <p class="ps-empty">Aucune mesure sur cette période.</p></section>`;
  }
  return `<section class="ps-section"><h2>Mesures physiques <small>${esc(range)}</small></h2>
    <table class="ps-table"><thead><tr><th>Mois</th><th>Taille</th><th>Poids</th><th>Masse grasse</th><th>Σ 4 plis</th></tr></thead>
    <tbody>${rows.map(m => `<tr>
      <td>${esc(m.month_label)}</td>
      <td>${m.height_cm != null ? `${fmt(m.height_cm, 0)} cm` : '—'}</td>
      <td>${m.weight_kg != null ? `${fmt(m.weight_kg, 1)} kg` : '—'}</td>
      <td>${m.body_fat_pct != null ? `${fmt(m.body_fat_pct, 1)} %` : '—'}</td>
      <td>${m.skinfold_sum_4_mm != null ? `${fmt(m.skinfold_sum_4_mm, 1)} mm` : '—'}</td>
    </tr>`).join('')}</tbody></table></section>`;
}

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

function exportTests(stageKeys, withCompare, withRadar) {
  const stagesWithData = STAGES.filter(s => stageKeys.includes(s.key) && exportTestFor(s.key));
  if (!stagesWithData.length) {
    return `<section class="ps-section"><h2>Tests physiques</h2>
      <p class="ps-empty">Aucun test sur les sessions choisies.</p></section>`;
  }
  return stagesWithData.map(s => {
    const test = exportTestFor(s.key);
    const ref = withCompare ? exportAveragesFor(s.key) : null;
    const hasRef = !!ref && PERF_METRICS.some(m => num(ref[m.key]) !== null);

    const table = `<table class="ps-table"><thead><tr>
        <th>Test</th><th>Valeur</th>${hasRef ? `<th>${refLabel()}</th><th>Écart</th>` : ''}
      </tr></thead><tbody>
      ${PERF_METRICS.map(m => {
        const v = num(test[m.key]);
        const r = hasRef ? num(ref[m.key]) : null;
        const flagged = isImplausible(m.key, v);
        const d = flagged ? null : perfDelta(m.key, v, r);
        const unit = m.unit ? ` ${m.unit}` : '';
        return `<tr>
          <td>${esc(m.label)}</td>
          <td class="ps-num">${v === null ? '—' : `${fmt(v, m.digits)}${esc(unit)}`}${flagged ? ' ⚠' : ''}</td>
          ${hasRef ? `<td class="ps-num">${r === null ? '—' : `${fmt(r, m.digits)}${esc(unit)}`}</td>
            <td class="ps-num ${d === null ? '' : (d >= 0 ? 'ps-up' : 'ps-down')}">${d === null ? '—' : `${d >= 0 ? '+' : '−'}${fmt(Math.abs(d), m.digits)}`}</td>` : ''}
        </tr>`;
      }).join('')}
      </tbody></table>`;

    const radar = withRadar
      ? `<div class="ps-radar">${pdfSafeSvg(radarSvg(test, hasRef ? ref : null))}
          <div class="ps-scores">${SCORE_LABELS.map(([k, l]) => {
            const v = scoreValue(test, k);
            return `<div><span>${esc(l)}</span><strong>${v === null ? '—' : fmt(v, 1)}</strong></div>`;
          }).join('')}</div></div>`
      : '';

    return `<section class="ps-section ps-stage">
      <h2>Tests physiques — ${esc(s.label)}${test.tested_at ? ` <small>${esc(frDate(test.tested_at))}</small>` : ''}</h2>
      <div class="ps-stage-grid${withRadar ? '' : ' no-radar'}">${table}${radar}</div>
      ${hasRef ? `<p class="ps-note">${refLabel()} : joueurs du groupe ayant passé chaque test lors de cette session (à partir de 3), valeurs aberrantes exclues. Écart positif = meilleur que la moyenne.</p>` : ''}
    </section>`;
  }).join('');
}

function exportNotes(kind, title, withImages) {
  const list = noteStore.notes.filter(n => n.kind === kind)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id - b.id));
  if (!list.length) return `<section class="ps-section"><h2>${esc(title)}</h2><p class="ps-empty">Aucun élément.</p></section>`;
  return `<section class="ps-section"><h2>${esc(title)}</h2>
    ${list.map(n => {
      const imgs = withImages ? noteStore.media.filter(m => m.note_id === n.id && m.signed_url) : [];
      return `<article class="ps-note-card">
        <h3>${esc(n.title)}</h3>
        ${n.body ? `<p>${esc(n.body).replace(/\n/g, '<br>')}</p>` : ''}
        ${imgs.length ? `<div class="ps-images">${imgs.map(m => `<figure><img src="${esc(m.signed_url)}" alt=""><figcaption>${esc(m.caption || '')}</figcaption></figure>`).join('')}</div>` : ''}
      </article>`;
    }).join('')}
  </section>`;
}

function buildExportDocument() {
  const sections = new Set(exportChecked('exp-sec'));
  const stageKeys = exportChecked('exp-stage');
  let fromIdx = MONTHS.indexOf(document.getElementById('exp-from').value);
  let toIdx = MONTHS.indexOf(document.getElementById('exp-to').value);
  if (fromIdx > toIdx) [fromIdx, toIdx] = [toIdx, fromIdx];

  const fullName = `${player.prenom || ''} ${player.nom || ''}`.trim();
  const club = ctxProfile?.clubs?.nom || '';
  const period = [
    stageKeys.length === 3 ? 'toutes les sessions' : STAGES.filter(s => stageKeys.includes(s.key)).map(s => s.label).join(', ') || 'aucune session',
    `mesures ${MONTHS[fromIdx]} – ${MONTHS[toIdx]}`,
  ].join(' · ');

  const parts = [];
  if (sections.has('identity')) parts.push(exportIdentity());
  if (sections.has('measures')) parts.push(exportMeasures(fromIdx, toIdx));
  if (sections.has('tests') || sections.has('radar')) {
    parts.push(exportTests(stageKeys, sections.has('compare') && sections.has('tests'), sections.has('radar')));
  }
  const withImages = sections.has('images');
  if (sections.has('strength')) parts.push(exportNotes('strength', 'Points forts', withImages));
  if (sections.has('improvement')) parts.push(exportNotes('improvement', 'Axes d’amélioration', withImages));
  if (sections.has('objective')) parts.push(exportNotes('objective', 'Objectifs', withImages));

  return `<header class="ps-header">
      <div>
        <div class="ps-eyebrow">${esc(club || 'LMFC Performance')} · Dossier joueur</div>
        <h1>${esc(fullName || 'Joueur')}</h1>
        <div class="ps-sub">${esc([player.poste,
          typeof teamName === 'function' ? teamName(player.team_id) : null].filter(Boolean).join(' · '))}</div>
      </div>
      <div class="ps-meta">
        <div>Exporté le ${esc(new Date().toLocaleDateString('fr-FR'))}</div>
        <div>${esc(period)}</div>
      </div>
    </header>
    ${parts.join('') || '<p class="ps-empty">Aucune rubrique sélectionnée.</p>'}
    <footer class="ps-footer">Données issues de LMFC Performance. Une valeur absente de la source est notée « — » ; rien n’est estimé.</footer>`;
}

/* html2canvas dessine mal les <svg> (taille et styles perdus : radar
   tronqué, tout noir). Chaque radar est donc converti en image PNG avant
   la génération, avec ses styles embarqués dans le SVG. */
const PDF_RADAR_STYLE = `
  .radar-ring{fill:none;stroke:#999;stroke-opacity:.5}
  .radar-axis{stroke:#999;stroke-opacity:.5}
  .radar-label{fill:#222;font:650 12px Inter,Arial,sans-serif}
  .radar-scale{fill:#999;font:9px Inter,Arial,sans-serif}
  .radar-area{fill:rgba(201,168,76,.28);stroke:#b08a2a;stroke-width:2}
  .radar-area-dot,.radar-center{fill:#b08a2a}
  .radar-ref{fill:rgba(120,130,140,.1);stroke:#8a939c;stroke-width:1.4;stroke-dasharray:5 4}
  .radar-ref-dot{fill:#8a939c}
  .radar-compare{fill:rgba(74,157,224,.14);stroke:#2f7fc1;stroke-width:1.8}
  .radar-compare-dot{fill:#2f7fc1}
  .radar-partial{fill:none}`;
function pdfSafeSvg(svg) {
  return svg.replace(/<svg([^>]*)>/,
    `<svg$1 xmlns="http://www.w3.org/2000/svg" width="${RADAR.W}" height="${RADAR.H}"><style>${PDF_RADAR_STYLE}</style>`);
}

function svgToImage(svg) {
  return new Promise((resolve, reject) => {
    const src = new Image();
    src.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = RADAR.W * 2; canvas.height = RADAR.H * 2;
      const g = canvas.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(src, 0, 0, canvas.width, canvas.height);
      resolve(el('img', { src: canvas.toDataURL('image/png'), alt: 'Radar du profil athlétique', style: 'width:100%;display:block' }));
    };
    src.onerror = () => reject(new Error('conversion du radar impossible'));
    src.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  });
}

async function rasterizeRadars(root) {
  for (const svg of root.querySelectorAll('.ps-radar svg')) svg.replaceWith(await svgToImage(svg));
}

/* html2pdf n'est chargé qu'au premier export : inutile pour un joueur. */
const HTML2PDF_URL = 'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js';
function loadHtml2pdf() {
  if (window.html2pdf) return Promise.resolve(window.html2pdf);
  return loadHtml2pdf.promise ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = HTML2PDF_URL;
    script.onload = () => resolve(window.html2pdf);
    script.onerror = () => { loadHtml2pdf.promise = null; reject(new Error('Générateur PDF indisponible (connexion ?)')); };
    document.head.append(script);
  });
}

/* Attend le chargement des images (photo, notes) avant de générer, sinon
   elles sortent vides dans le PDF. */
function waitForImages(root) {
  const imgs = [...root.querySelectorAll('img')];
  return Promise.all(imgs.map(img => img.complete ? null
    : new Promise(res => { img.onload = img.onerror = res; setTimeout(res, 4000); })));
}

function exportFileName() {
  const name = normalizeName(`${player.prenom || ''} ${player.nom || ''}`).replace(/ /g, '-') || 'joueur';
  return `fiche-${name}-${localToday()}.pdf`;
}

async function runExport() {
  if (!isStaff() || !player) return;
  if (!exportChecked('exp-sec').length) return notify('Choisissez au moins une rubrique.', 'error');

  const btn = document.getElementById('btnRunExport');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Génération…';
  // Feuille hors écran : html2pdf la clone dans sa propre zone de rendu.
  const sheet = el('div', { class: 'pdf-sheet', html: buildExportDocument() });
  const holder = el('div', { style: 'position:fixed;left:-10000px;top:0;', 'aria-hidden': 'true' }, sheet);
  document.body.append(holder);
  try {
    const html2pdf = await loadHtml2pdf();
    await rasterizeRadars(sheet);
    await waitForImages(sheet);
    await html2pdf().set({
      margin: [12, 12, 12, 12],
      filename: exportFileName(),
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['.ps-identity', '.ps-stage', '.ps-note-card', 'tr'] },
    }).from(sheet).save();
    closePerfModal('exportModal');
    notify('PDF généré.', 'success');
  } catch (e) {
    console.error('Export PDF impossible', e);
    notify(`Export PDF impossible : ${e.message}`, 'error');
  } finally {
    holder.remove();
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
