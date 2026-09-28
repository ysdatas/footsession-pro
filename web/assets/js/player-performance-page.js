/* FootSession Pro — player-performance-page.js
   Dossier individuel performance + radar + import Excel + médias. */

let ctxProfile = null;
let player = null;
let measurements = [];
let tests = [];
let notes = [];
let media = [];
let stage = 'pre';
let canEditPerformance = false;
let importState = { entries: [], fileName: '', mode: 'single' };
let clubAverages = null;   // agrégats renvoyés par la RPC club_test_averages

const MONTHS = ['Août','Septembre','Octobre','Novembre','Décembre','Janvier','Février','Mars','Avril','Mai','Juin'];
const STAGES = [
  { key: 'pre', label: 'Pré-saison' },
  { key: 'mid', label: 'Mi-saison' },
  { key: 'end', label: 'Fin de saison' },
];
const SCORE_LABELS = [
  ['profile_start', 'Démarrage'],
  ['profile_agility', 'Agilité'],
  ['profile_speed', 'Vitesse'],
  ['profile_endurance', 'Endurance'],
  ['profile_core', 'Core'],
];

function esc(s) {
  return String(s ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function fmt(n, digits = 1) {
  return n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(digits).replace('.', ',');
}
function initials(p) {
  return (((p?.prenom || p?.nom || '')[0] || '') + ((p?.nom || '')[0] || '') || '?').toUpperCase();
}
function normalizeName(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function notify(message, type = 'info') {
  const el = document.getElementById('pageToast');
  if (!el) return;
  el.textContent = message;
  el.className = `perf-toast show ${type}`;
  clearTimeout(notify._timer);
  notify._timer = setTimeout(() => { el.className = 'perf-toast'; }, 3200);
}
function openPerfModal(id) {
  document.getElementById(id)?.classList.add('open');
}
function closePerfModal(id) {
  document.getElementById(id)?.classList.remove('open');
}
function latestMeasurement() {
  if (!measurements.length) return null;
  // measured_at fait foi (multi-saisons) ; l'ordre des mois de la saison
  // sert de repli quand la date n'est pas renseignée.
  const key = m => [m.measured_at || '', MONTHS.indexOf(m.month_label), m.id || 0];
  return [...measurements].sort((a,b) => {
    const ka = key(a), kb = key(b);
    return String(ka[0]).localeCompare(String(kb[0])) || (ka[1]-kb[1]) || (ka[2]-kb[2]);
  }).at(-1);
}
function scoreValue(t, key) {
  const v = t?.[key];
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
}
function stageRows() {
  return tests.filter(t => t.stage === stage).sort((a,b) => (a.id||0) - (b.id||0));
}
function currentTest() {
  const rows = stageRows();
  return rows.length ? rows[rows.length - 1] : null;
}

/* ------------------------------------------------------------
   Radar athlétique
   Deux séries : le joueur, et la moyenne de son club quand elle
   est disponible. Un axe sans valeur n'est jamais tracé au centre.
   ------------------------------------------------------------ */
const RADAR = { W: 430, H: 326, cx: 215, cy: 159, R: 102 };

function radarAngle(i) { return -Math.PI / 2 + i * 2 * Math.PI / 5; }

function radarPoint(value, i) {
  const rr = RADAR.R * Math.max(0, Math.min(10, value)) / 10;
  return [RADAR.cx + Math.cos(radarAngle(i)) * rr, RADAR.cy + Math.sin(radarAngle(i)) * rr];
}

/* Trace une série : polygone à 3 valeurs et plus, simple trait à 2,
   rien du tout en dessous. Les axes non renseignés sont ignorés, pas
   ramenés à zéro. */
function radarSeries(values, cls) {
  const pts = values.map((v, i) => (v === null ? null : radarPoint(v, i)));
  const valid = pts.filter(Boolean);
  let svg = '';
  if (valid.length >= 3) {
    svg += `<polygon points="${valid.map(p => p.join(',')).join(' ')}" class="${cls}"/>`;
  } else if (valid.length === 2) {
    svg += `<polyline points="${valid.map(p => p.join(',')).join(' ')}" class="${cls} radar-partial"/>`;
  }
  pts.forEach(p => { if (p) svg += `<circle cx="${p[0]}" cy="${p[1]}" r="4" class="${cls}-dot"/>`; });
  return svg;
}

function radarSvg(test) {
  const { W, H, cx, cy, R } = RADAR;
  const values = SCORE_LABELS.map(([key]) => scoreValue(test, key));
  const refs = SCORE_LABELS.map(([key]) => scoreValue(clubAverages, key));

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Radar du profil athlétique">`;

  // Grille : anneaux tous les 2 points, plus les rayons.
  [2, 4, 6, 8, 10].forEach(level => {
    const ring = [];
    for (let i = 0; i < 5; i++) {
      const a = radarAngle(i), rr = R * level / 10;
      ring.push(`${cx + Math.cos(a) * rr},${cy + Math.sin(a) * rr}`);
    }
    svg += `<polygon points="${ring.join(' ')}" class="radar-ring"/>`;
    svg += `<text x="${cx + 5}" y="${cy - R * level / 10 + 4}" class="radar-scale">${level}</text>`;
  });
  for (let i = 0; i < 5; i++) {
    const a = radarAngle(i);
    svg += `<line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(a) * R}" y2="${cy + Math.sin(a) * R}" class="radar-axis"/>`;
  }

  // Étiquettes des axes, ancrées selon leur côté pour ne pas déborder.
  SCORE_LABELS.forEach(([, label], i) => {
    const a = radarAngle(i);
    const x = cx + Math.cos(a) * (R + 30);
    const y = cy + Math.sin(a) * (R + 26);
    const anchor = Math.abs(Math.cos(a)) < 0.2 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end');
    svg += `<text x="${x}" y="${y}" class="radar-label" text-anchor="${anchor}" dominant-baseline="middle">${esc(label)}</text>`;
  });

  // La moyenne du club passe sous le joueur pour rester lisible.
  if (refs.some(v => v !== null)) svg += radarSeries(refs, 'radar-ref');
  svg += radarSeries(values, 'radar-area');
  svg += `<circle cx="${cx}" cy="${cy}" r="2.5" class="radar-center"/>`;
  return svg + '</svg>';
}

/* Palette des scores /10, identique aux cartes et au radar. */
function scoreTone(v) {
  if (v === null) return 'none';
  if (v >= 8) return 'high';
  if (v >= 6.5) return 'good';
  if (v >= 4.5) return 'mid';
  return 'low';
}

function renderRadar() {
  const test = currentTest();
  const wrap = document.getElementById('radarWrap');
  const hasRef = SCORE_LABELS.some(([key]) => scoreValue(clubAverages, key) !== null);

  document.getElementById('radarLegend').innerHTML = `
    <span class="legend-item"><i class="legend-dot legend-player"></i>${esc(playerShortName())}</span>
    ${hasRef
      ? `<span class="legend-item"><i class="legend-dot legend-ref"></i>Moyenne du club${
          clubAverages?.n_players ? ` (${clubAverages.n_players})` : ''}</span>`
      : ''}`;

  wrap.innerHTML = test
    ? radarSvg(test)
    : `<div class="empty">Aucun test pour cette session.</div>`;

  document.getElementById('scoreCards').innerHTML = SCORE_LABELS.map(([key, label]) => {
    const v = scoreValue(test, key);
    return `<div class="score-card tone-${scoreTone(v)}">
      <span>${esc(label)}</span>
      <strong>${v === null ? '—' : fmt(v, 1)}<small>/10</small></strong>
    </div>`;
  }).join('');

  renderTestSummary(test);
}

function playerShortName() {
  return `${player?.prenom || ''} ${player?.nom || ''}`.trim() || 'Joueur';
}

/* ------------------------------------------------------------
   Tableau des tests : valeur, référence club, écart.
   `better` dit dans quel sens l'écart est favorable ; null quand
   la métrique n'a pas de sens directionnel (ratio, asymétrie).
   ------------------------------------------------------------ */
const TEST_ROWS = [
  { label: 'Sprint 10 m',  key: 'sprint10_sec',         unit: 's',    digits: 2, better: 'lower' },
  { label: 'Sprint 40 m',  key: 'sprint40_sec',         unit: 's',    digits: 2, better: 'lower' },
  { label: '505 gauche',   key: 'five05_left_sec',      unit: 's',    digits: 2, better: 'lower' },
  { label: '505 droit',    key: 'five05_right_sec',     unit: 's',    digits: 2, better: 'lower' },
  { label: '505 moyenne',  key: 'five05_avg_sec',       unit: 's',    digits: 2, better: 'lower' },
  { label: 'Asymétrie 505',key: 'five05_asymmetry_pct', unit: '%',    digits: 1, better: null },
  { label: '30-15 VIFT',   key: 'vift_kmh',             unit: 'km/h', digits: 1, better: 'higher' },
  { label: 'Shirado',      key: 'shirado_sec',          unit: 's',    digits: 0, better: 'higher' },
  { label: 'Sorensen',     key: 'sorensen_sec',         unit: 's',    digits: 0, better: 'higher' },
  { label: 'Ratio Shirado / Sorensen', key: 'core_ratio', unit: '', digits: 2, better: null },
];

function renderTestSummary(test) {
  const box = document.getElementById('testSummary');
  if (!test) {
    box.innerHTML = `<div class="empty">Aucun test pour cette session.</div>`;
    return;
  }
  const hasRef = TEST_ROWS.some(r => num(clubAverages?.[r.key]) !== null);

  const body = TEST_ROWS.map(r => {
    const value = num(test[r.key]);
    const ref = num(clubAverages?.[r.key]);
    let gap = '<span class="gap-none">—</span>';
    if (value !== null && ref !== null && r.better) {
      const delta = r.better === 'lower' ? ref - value : value - ref;
      const good = delta >= 0;
      gap = `<span class="gap ${good ? 'gap-up' : 'gap-down'}">${good ? '↗' : '↘'} ${
        good ? '+' : '−'}${fmt(Math.abs(delta), r.digits)}</span>`;
    }
    return `<tr>
      <td class="t-name">${esc(r.label)}</td>
      <td class="t-value ${value === null ? 'is-empty' : ''}">${fmt(value, r.digits)}</td>
      <td class="t-unit">${esc(r.unit || '—')}</td>
      ${hasRef ? `<td class="t-ref">${fmt(ref, r.digits)}</td><td class="t-gap">${gap}</td>` : ''}
    </tr>`;
  }).join('');

  box.innerHTML = `<div class="test-table-wrap"><table class="test-table">
    <thead><tr>
      <th>Test</th><th>Valeur</th><th>Unité</th>
      ${hasRef ? '<th>Réf. club</th><th>Écart</th>' : ''}
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>
  ${hasRef ? '' : '<p class="text-muted table-note">Référence club indisponible : il faut au moins 3 joueurs testés sur la session.</p>'}`;
}

/* ------------------------------------------------------------
   Suivi physique : courbe des mesures mois par mois.
   Un mois sans mesure n'est pas interpolé — le trait s'interrompt.
   ------------------------------------------------------------ */
const TREND_SERIES = [
  { key: 'weight_kg',   label: 'Poids (kg)',       cls: 'weight', axis: 'left',  digits: 1 },
  { key: 'body_fat_pct',label: 'Masse grasse (%)', cls: 'fat',    axis: 'left',  digits: 1 },
];

function trendChartSvg(rows) {
  const W = 620, H = 210, padL = 38, padR = 34, padT = 14, padB = 30;
  const innerW = W - padL - padR, innerH = H - padT - padB;

  const leftValues = rows.flatMap(r => TREND_SERIES.map(s => num(r[s.key]))).filter(v => v !== null);
  const endurance = rows.map(r => num(r.endurance));
  const hasLeft = leftValues.length > 0;
  const hasRight = endurance.some(v => v !== null);
  if (!hasLeft && !hasRight) return '';

  const lo = hasLeft ? Math.min(...leftValues) : 0;
  const hi = hasLeft ? Math.max(...leftValues) : 1;
  const pad = (hi - lo) < 4 ? 2 : (hi - lo) * 0.15;
  const yMin = Math.max(0, lo - pad), yMax = hi + pad;

  const x = i => padL + (rows.length === 1 ? innerW / 2 : (i * innerW) / (rows.length - 1));
  const yLeft = v => padT + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;
  const yRight = v => padT + innerH - (Math.max(0, Math.min(10, v)) / 10) * innerH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution des mesures physiques">`;

  // Lignes de niveau + graduations de l'axe gauche.
  for (let g = 0; g <= 3; g++) {
    const v = yMin + (yMax - yMin) * g / 3;
    const yy = yLeft(v);
    svg += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" class="trend-grid"/>`;
    svg += `<text x="${padL - 7}" y="${yy + 3.5}" class="trend-tick" text-anchor="end">${fmt(v, 0)}</text>`;
  }
  if (hasRight) {
    [0, 5, 10].forEach(v => {
      svg += `<text x="${W - padR + 7}" y="${yRight(v) + 3.5}" class="trend-tick trend-tick-right">${v}</text>`;
    });
  }

  // Une série = des segments entre points consécutifs renseignés.
  const drawSeries = (getter, yScale, cls) => {
    let out = '', prev = null;
    rows.forEach((r, i) => {
      const v = getter(r);
      if (v === null) { prev = null; return; }
      const px = x(i), py = yScale(v);
      if (prev) out += `<line x1="${prev[0]}" y1="${prev[1]}" x2="${px}" y2="${py}" class="trend-line ${cls}"/>`;
      out += `<circle cx="${px}" cy="${py}" r="3.4" class="trend-dot ${cls}"/>`;
      prev = [px, py];
    });
    return out;
  };

  TREND_SERIES.forEach(s => { svg += drawSeries(r => num(r[s.key]), yLeft, s.cls); });
  if (hasRight) svg += drawSeries(r => num(r.endurance), yRight, 'endurance');

  rows.forEach((r, i) => {
    svg += `<text x="${x(i)}" y="${H - 9}" class="trend-tick" text-anchor="middle">${esc((r.month_label || '').slice(0, 4))}</text>`;
  });

  return svg + '</svg>';
}

function renderMeasurements() {
  const wrap = document.getElementById('measurementHistory');
  const chart = document.getElementById('trendChart');

  const latest = latestMeasurement();
  document.getElementById('metricHeight').textContent = latest?.height_cm != null ? `${fmt(latest.height_cm,0)} cm` : '—';
  document.getElementById('metricWeight').textContent = latest?.weight_kg != null ? `${fmt(latest.weight_kg,1)} kg` : '—';
  document.getElementById('metricBodyFat').textContent = latest?.body_fat_pct != null ? `${fmt(latest.body_fat_pct,1)} %` : '—';

  if (!measurements.length) {
    if (chart) chart.innerHTML = '';
    wrap.innerHTML = `<div class="empty">Aucune mesure enregistrée.</div>`;
    return;
  }

  const ordered = [...measurements].sort((a,b) => {
    const da = MONTHS.indexOf(a.month_label), db = MONTHS.indexOf(b.month_label);
    return da - db || ((a.id||0) - (b.id||0));
  });

  // L'endurance de la session affichée complète la courbe ; elle n'a pas
  // de valeur mensuelle propre, on la porte sur le dernier mois mesuré.
  const test = currentTest();
  const enduranceAt = ordered.length - 1;
  const rows = ordered.map((m, i) => ({
    ...m,
    endurance: i === enduranceAt ? scoreValue(test, 'profile_endurance') : null,
  }));

  if (chart) {
    const svg = trendChartSvg(rows);
    chart.innerHTML = svg
      ? `<div class="trend-legend">
           <span class="legend-item"><i class="legend-dot legend-weight"></i>Poids (kg)</span>
           <span class="legend-item"><i class="legend-dot legend-fat"></i>Masse grasse (%)</span>
           ${rows.some(r => r.endurance !== null) ? '<span class="legend-item"><i class="legend-dot legend-endurance"></i>Endurance (/10)</span>' : ''}
         </div>${svg}`
      : '';
  }

  wrap.innerHTML = `<div class="measurement-table">
    <div class="measurement-row header"><span>Mois</span><span>Taille</span><span>Poids</span><span>MG</span></div>
    ${ordered.map(m => `<div class="measurement-row">
      <span>${esc(m.month_label || '—')}</span>
      <span>${m.height_cm != null ? `${fmt(m.height_cm,0)} cm` : '—'}</span>
      <span>${m.weight_kg != null ? `${fmt(m.weight_kg,1)} kg` : '—'}</span>
      <span>${m.body_fat_pct != null ? `${fmt(m.body_fat_pct,1)} %` : '—'}</span>
    </div>`).join('')}
  </div>`;
}

/* ------------------------------------------------------------
   Panneau latéral : poste sur le terrain et informations de fiche.
   Uniquement des champs réellement présents en base.
   ------------------------------------------------------------ */
const PITCH_SPOTS = [
  { test: /gardien|goal|gk/,                     x: 50, y: 90, label: 'Gardien' },
  { test: /lateral|laterale|arriere|piston/,     x: 18, y: 72, label: 'Latéral' },
  { test: /defenseur|defense|central|stoppeur/,  x: 50, y: 74, label: 'Défenseur' },
  { test: /recuperateur|sentinelle|6/,           x: 50, y: 60, label: 'Milieu défensif' },
  { test: /milieu offensif|meneur|10/,           x: 50, y: 40, label: 'Milieu offensif' },
  { test: /milieu|relayeur|box to box/,          x: 50, y: 52, label: 'Milieu' },
  { test: /ailier|extreme|winger/,               x: 20, y: 32, label: 'Ailier' },
  { test: /attaquant|buteur|avant|pointe/,       x: 50, y: 18, label: 'Attaquant' },
];

function renderSidebar() {
  const poste = player?.poste || '';
  const normalized = normalizeName(poste);
  const spot = PITCH_SPOTS.find(s => s.test.test(normalized));

  const pitch = document.getElementById('miniPitch');
  if (pitch) {
    pitch.innerHTML = spot
      ? `<span class="fp-mini-pitch-dot" style="left:${spot.x}%;top:${spot.y}%"></span>`
      : '';
  }
  const pitchLabel = document.getElementById('miniPitchLabel');
  if (pitchLabel) pitchLabel.textContent = poste || 'Poste non renseigné';

  const rows = [
    ['Numéro', player?.numero != null ? `#${player.numero}` : '—'],
    ['Poste', poste || '—'],
    // typeof : ROLE_LABELS vient d'auth.js ; `?.` ne protège pas d'un identifiant non déclaré.
    ['Accès', ctxProfile?.role === 'joueur' ? 'Espace joueur'
      : ((typeof ROLE_LABELS !== 'undefined' && ROLE_LABELS[ctxProfile?.role]) || 'Staff')],
    ['Vidéos reçues', String(fpFmVideos.length)],
  ];
  const info = document.getElementById('sidebarInfo');
  if (info) {
    info.innerHTML = rows.map(([k, v]) =>
      `<div class="fp-fm-info-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
  }

  const quick = document.getElementById('sidebarQuick');
  const videoLink = document.getElementById('videoPlayerLink');
  if (quick) {
    quick.innerHTML = `
      <a href="#radarWrap"><span>Profil athlétique</span><strong>→</strong></a>
      <a href="#trendChart"><span>Suivi physique</span><strong>→</strong></a>
      ${videoLink ? `<a href="${esc(videoLink.getAttribute('href') || '#')}"><span>Bibliothèque vidéos</span><strong>→</strong></a>` : ''}`;
  }
}

/* Moyennes du club pour la session affichée. La RPC ne renvoie que des
   agrégats : elle est donc utilisable aussi par un compte joueur. */
async function loadClubAverages() {
  const { data, error } = await sb.rpc('club_test_averages', { p_stage: stage });
  if (error) {
    console.warn('club_test_averages indisponible :', error.message);
    clubAverages = null;
    return;
  }
  clubAverages = Array.isArray(data) ? (data[0] || null) : data;
}

function renderNotes() {
  const renderList = (kind, id) => {
    const list = notes.filter(n => n.kind === kind).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0) || (a.id-b.id));
    document.getElementById(id).innerHTML = list.length
      ? list.map(n => {
          const imgs = media.filter(m => m.note_id === n.id);
          return `<article class="note-card">
            <div class="note-card-head">
              <span class="badge ${kind === 'strength' ? 'badge-success' : (kind === 'objective' ? 'badge-gold' : 'badge-gold')}">${kind === 'strength' ? 'Point fort' : (kind === 'objective' ? 'Objectif' : 'Amélioration')}</span>
              ${canEditPerformance ? `<button class="btn btn-sm btn-danger note-delete" type="button" data-note="${n.id}">Suppr.</button>` : ''}
            </div>
            <h3>${esc(n.title)}</h3>
            ${n.body ? `<p>${esc(n.body).replace(/\n/g,'<br>')}</p>` : ''}
            ${imgs.length ? `<div class="media-grid">${imgs.map(m => `<figure><img src="${esc(m.signed_url || '')}" alt="${esc(m.caption || '')}"><figcaption>${esc(m.caption || '')}</figcaption></figure>`).join('')}</div>` : ''}
          </article>`;
        }).join('')
      : `<div class="empty">Aucun ${kind === 'strength' ? 'point fort' : (kind === 'objective' ? 'objectif' : 'point d’amélioration')}.</div>`;
  };
  renderList('strength', 'strengthList');
  renderList('improvement', 'improvementList');
  renderList('objective', 'objectiveList');

  document.querySelectorAll('.note-delete').forEach(btn => btn.addEventListener('click', () => deleteNote(Number(btn.dataset.note))));
}

async function signMedia() {
  const signed = await Promise.all(media.map(async m => {
    const { data } = await sb.storage.from('player-performance-media').createSignedUrl(m.storage_path, 3600);
    return { ...m, signed_url: data?.signedUrl || '' };
  }));
  media = signed;
  renderNotes();
}

/* Affiche à l'écran la raison d'un échec de chargement.
   Une page vide ou un renvoi silencieux vers une autre rubrique rendaient
   impossible de distinguer « pas de données » de « accès refusé ». */
function showLoadError(step, error) {
  const msg = error?.message || 'erreur inconnue';
  console.error(`player-performance: ${step} —`, error);
  const name = document.getElementById('playerName');
  if (name) name.textContent = 'Chargement impossible';
  const meta = document.getElementById('playerMeta');
  if (meta) meta.textContent = `Échec à l’étape : ${step} — ${msg}`;
  notify(`${step} : ${msg}`, 'error');
}

function showDataWarning(entries) {
  entries.forEach(([label, error]) => console.error(`player-performance: ${label} —`, error));
  const meta = document.getElementById('playerMeta');
  const detail = entries.map(([label, error]) => `${label} : ${error.message}`).join(' · ');
  if (meta) meta.textContent = `Données inaccessibles — ${detail}`;
  notify(`Accès refusé sur : ${entries.map(([l]) => l).join(', ')}`, 'error');
}

async function loadPage() {
  const ctx = await requireAuth();
  if (!ctx) return;
  ctxProfile = ctx.profile;

  const params = new URLSearchParams(location.search);
  let playerId = Number(params.get('id') || 0) || null;

  if (ctxProfile.role === 'joueur') {
    const { data: linked, error: linkErr } = await sb.from('players')
      .select('id').eq('auth_user_id', ctx.user.id).maybeSingle();
    // Une erreur de lecture ne doit pas être confondue avec « compte non lié » :
    // renvoyer silencieusement sur player-join.html masquait la vraie cause.
    if (linkErr) return showLoadError('lecture de ta fiche joueur', linkErr);
    if (!linked) {
      window.location.href = 'player-join.html';
      return;
    }
    playerId = linked.id;
  }
  if (!playerId) {
    return showLoadError('identification du joueur',
      { message: 'Aucun joueur ciblé (paramètre ?id= absent et compte non lié à une fiche).' });
  }

  canEditPerformance = ['admin','prepa'].includes(ctxProfile.role);
  document.getElementById('perfRoleLabel').textContent =
    ctxProfile.role === 'joueur' ? 'Espace joueur' : 'Staff · dossier individuel';
  document.querySelectorAll('.perf-editor-only').forEach(el => el.classList.toggle('hidden', !canEditPerformance));

  if (ctxProfile.role === 'joueur') {
    document.getElementById('backPlayers').classList.add('hidden');
    document.getElementById('videoPlayerLink').href = 'mes-videos.html';
    document.getElementById('videoPlayerLink').textContent = 'Mes vidéos';
  } else {
    document.getElementById('videoPlayerLink').href = `videos.html?player=${playerId}`;
  }

  const { data: p, error } = await sb.from('players')
    .select('id, nom, prenom, numero, poste, club_id, auth_user_id, photo_path')
    .eq('id', playerId).maybeSingle();
  if (error) return showLoadError('lecture de la fiche joueur', error);
  if (!p) {
    return showLoadError('lecture de la fiche joueur',
      { message: `Aucune fiche lisible pour l'id ${playerId}. Si tu es joueur, vérifie que ton compte est bien associé à une fiche (policy players_read_self).` });
  }
  player = p;

  const [mRes, tRes, nRes, mediaRes] = await Promise.all([
    sb.from('player_physical_measurements').select('*').eq('player_id', player.id).order('id', {ascending:true}),
    sb.from('player_physical_tests').select('*').eq('player_id', player.id).order('id', {ascending:true}),
    sb.from('player_performance_notes').select('*').eq('player_id', player.id).order('sort_order').order('id'),
    sb.from('player_performance_media').select('*').eq('player_id', player.id).order('sort_order').order('id'),
  ]);
  // Chaque erreur est affichée : des données absentes et un accès refusé
  // produisaient tous les deux une page vide, sans moyen de les distinguer.
  const dataErrors = [
    ['mesures physiques', mRes.error],
    ['tests physiques', tRes.error],
    ['notes', nRes.error],
    ['médias', mediaRes.error],
  ].filter(([, e]) => e);
  if (dataErrors.length) {
    showDataWarning(dataErrors);
  }
  measurements = mRes.data || [];
  tests = tRes.data || [];
  notes = nRes.data || [];
  media = mediaRes.data || [];

  const fullName = `${player.prenom || ''} ${player.nom || ''}`.trim();
  document.getElementById('playerName').textContent = fullName || 'Joueur';
  document.getElementById('playerMeta').textContent =
    `${player.poste || 'Poste non renseigné'}${player.numero != null ? ` · #${player.numero}` : ''}`;
  document.getElementById('playerInitials').textContent = initials(player);

  if (player.photo_path) {
    const { data } = await sb.storage.from('player-photos').createSignedUrl(player.photo_path, 3600);
    if (data?.signedUrl) {
      document.getElementById('playerPhoto').src = data.signedUrl;
      document.getElementById('playerPhoto').classList.remove('hidden');
      document.getElementById('playerInitials').classList.add('hidden');
    }
  }

  const availableStages = STAGES.filter(s => tests.some(t => t.stage === s.key)).map(s=>s.key);
  stage = availableStages.includes('pre') ? 'pre' : (availableStages[0] || 'pre');
  document.getElementById('stageSelect').value = stage;

  await loadClubAverages();
  renderSidebar();
  renderRadar();
  renderMeasurements();
  await signMedia();
  renderNotes();
}

async function saveMeasurement() {
  if (!canEditPerformance) return;
  const body = {
    club_id: player.club_id,
    player_id: player.id,
    measured_at: document.getElementById('m-date').value || null,
    month_label: document.getElementById('m-month').value,
    height_cm: num(document.getElementById('m-height').value),
    weight_kg: num(document.getElementById('m-weight').value),
    body_fat_pct: num(document.getElementById('m-fat').value),
    source: 'manual',
    // '' et non null : les index d'unicité portent sur source_file_name et
    // en SQL NULL <> NULL, donc un null dupliquerait la ligne à chaque envoi.
    source_file_name: '',
    created_by: ctxProfile.id,
  };
  if ([body.height_cm,body.weight_kg,body.body_fat_pct].every(v=>v===null)) return notify('Renseigne au moins une donnée physique.','error');
  const { error } = await sb.from('player_physical_measurements')
    .upsert(body, { onConflict:'club_id,player_id,month_label,source_file_name' });
  if (error) return notify(error.message,'error');
  notify('Mesure enregistrée.','success');
  document.getElementById('manualMeasurementBox').classList.add('hidden');
  await reloadData();
}

async function saveTest() {
  if (!canEditPerformance) return;
  const body = {
    club_id: player.club_id,
    player_id: player.id,
    stage: document.getElementById('manualStage').value,
    tested_at: document.getElementById('manualTestDate').value || null,
    sprint10_sec: num(document.getElementById('t-sprint10').value),
    five05_left_sec: num(document.getElementById('t-505g').value),
    five05_right_sec: num(document.getElementById('t-505d').value),
    sprint40_sec: num(document.getElementById('t-sprint40').value),
    vift_kmh: num(document.getElementById('t-vift').value),
    shirado_sec: num(document.getElementById('t-shirado').value),
    sorensen_sec: num(document.getElementById('t-sorensen').value),
    source: 'manual',
    source_file_name: '',
    created_by: ctxProfile.id,
  };
  const TEST_FIELDS = ['sprint10_sec','five05_left_sec','five05_right_sec','sprint40_sec','vift_kmh','shirado_sec','sorensen_sec'];
  if (TEST_FIELDS.every(k => body[k] === null)) return notify('Renseigne au moins un test.','error');
  const { error } = await sb.from('player_physical_tests')
    .upsert(body, { onConflict:'club_id,player_id,stage,source_file_name' });
  if (error) return notify(error.message,'error');
  notify('Session de tests enregistrée.','success');
  await reloadData();
}

async function reloadData() {
  const [mRes, tRes, nRes, mediaRes, pRes] = await Promise.all([
    sb.from('player_physical_measurements').select('*').eq('player_id', player.id).order('id'),
    sb.from('player_physical_tests').select('*').eq('player_id', player.id).order('id'),
    sb.from('player_performance_notes').select('*').eq('player_id', player.id).order('sort_order').order('id'),
    sb.from('player_performance_media').select('*').eq('player_id', player.id).order('sort_order').order('id'),
    sb.from('players').select('photo_path').eq('id',player.id).single(),
  ]);
  measurements=mRes.data||[];
  tests=tRes.data||[];
  notes=nRes.data||[];
  media=mediaRes.data||[];
  if (pRes.data) player.photo_path=pRes.data.photo_path;
  const availableStages=STAGES.filter(s=>tests.some(t=>t.stage===s.key)).map(s=>s.key);
  if (!availableStages.includes(stage)) stage=availableStages[0]||'pre';
  document.getElementById('stageSelect').value=stage;
  await loadClubAverages();
  renderSidebar();
  renderRadar();
  renderMeasurements();
  await signMedia(); renderNotes();
}

async function uploadPhoto(file) {
  if (!file || !canEditPerformance) return;
  if (file.size > 5 * 1024 * 1024) return notify('Photo trop volumineuse (max 5 Mo).','error');
  const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
  const path=`${player.club_id}/${player.id}/${Date.now()}.${ext}`;
  const { error: upErr } = await sb.storage.from('player-photos').upload(path,file,{contentType:file.type||'image/jpeg'});
  if (upErr) return notify(upErr.message,'error');
  const old=player.photo_path;
  const { error } = await sb.from('players').update({photo_path:path}).eq('id',player.id);
  if (error) {
    await sb.storage.from('player-photos').remove([path]);
    return notify(error.message,'error');
  }
  player.photo_path=path;
  const { data } = await sb.storage.from('player-photos').createSignedUrl(path,3600);
  if (data?.signedUrl) {
    document.getElementById('playerPhoto').src=data.signedUrl;
    document.getElementById('playerPhoto').classList.remove('hidden');
    document.getElementById('playerInitials').classList.add('hidden');
  }
  if (old) await sb.storage.from('player-photos').remove([old]);
  notify('Photo du joueur mise à jour.','success');
}

async function saveNote() {
  const kind=document.getElementById('noteKind').value;
  const title=document.getElementById('noteTitle').value.trim();
  const body=document.getElementById('noteBody').value.trim()||null;
  const files=[...document.getElementById('noteFiles').files];
  if (!title) return notify('Le titre est obligatoire.','error');
  if (files.some(f=>f.size>5*1024*1024)) return notify('Chaque image doit faire 5 Mo maximum.','error');

  const { data: note, error } = await sb.from('player_performance_notes').insert({
    club_id:player.club_id, player_id:player.id, kind, title, body, created_by:ctxProfile.id
  }).select().single();
  if (error) return notify(error.message,'error');

  for (const [index,file] of files.entries()) {
    const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
    const path=`${player.club_id}/${player.id}/${note.id}/${Date.now()}-${index}.${ext}`;
    const up=await sb.storage.from('player-performance-media').upload(path,file,{contentType:file.type||'image/jpeg'});
    if (up.error) {
      notify(`Note créée mais une image n’a pas été envoyée : ${up.error.message}`,'error');
      continue;
    }
    await sb.from('player_performance_media').insert({
      club_id:player.club_id, player_id:player.id, note_id:note.id,
      storage_path:path, caption:file.name, sort_order:index, created_by:ctxProfile.id
    });
  }
  closePerfModal('noteModal');
  document.getElementById('noteTitle').value='';
  document.getElementById('noteBody').value='';
  document.getElementById('noteFiles').value='';
  notify('Point enregistré.','success');
  await reloadData();
}

async function deleteNote(id) {
  if (!canEditPerformance || !confirm('Supprimer ce point et ses images ?')) return;
  const files=media.filter(m=>m.note_id===id).map(m=>m.storage_path);
  if (files.length) await sb.storage.from('player-performance-media').remove(files);
  const { error }=await sb.from('player_performance_notes').delete().eq('id',id);
  if (error) return notify(error.message,'error');
  notify('Point supprimé.','success');
  await reloadData();
}

function workbookRows(name) {
  const ws = importState.workbook?.Sheets?.[name];
  return ws ? XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: null
  }) : [];
}

function isAggregateName(name) {
  const k = normalizeName(name);
  return [
    'moyenne',
    'ecart type',
    'n joueurs testes'
  ].includes(k);
}

function findPlayerRow(rows, target = player) {
  if (!target) return null;

  const firstName = normalizeName(target.prenom || '');
  const lastName = normalizeName(target.nom || '');

  if (!lastName) return null;

  let surnameOnlyMatch = null;

  for (let r = 4; r < rows.length; r++) {
    const row = rows[r] || [];

    let hasLastName = false;
    let hasFirstName = false;
    let matchedText = '';

    for (const value of row) {
      if (value === null || value === undefined) continue;

      const text = String(value).trim();
      if (!text) continue;

      if (/^[+-]?\d+(?:[.,]\d+)?$/.test(text)) continue;
      if (isAggregateName(text)) continue;

      const normalized = normalizeName(text);
      const parts = normalized.split(' ').filter(Boolean);

      if (parts.includes(lastName)) {
        hasLastName = true;
        if (!matchedText) matchedText = text;
      }

      if (firstName && parts.includes(firstName)) {
        hasFirstName = true;
      }
    }

    if (!hasLastName) continue;

    if (hasFirstName) {
      return {
        index: r,
        name: matchedText || `${target.prenom || ''} ${target.nom || ''}`.trim()
      };
    }

    if (!surnameOnlyMatch) {
      surnameOnlyMatch = {
        index: r,
        name: matchedText || String(target.nom || '').trim()
      };
    }
  }

  return surnameOnlyMatch;
}

function findPlayerSheet(workbook, target = player) {
  if (!target) return null;

  const wantedLastName = normalizeName(target.nom || '')
    .replace(/[^a-z0-9]/g, '');

  if (!wantedLastName) return null;

  const sheetNames = workbook?.SheetNames || [];

  return sheetNames.find(sheetName => {
    const normalized = normalizeName(sheetName)
      .replace(/[^a-z0-9]/g, '');

    return normalized === wantedLastName;
  }) || null;
}

function parsePlayerSheet(workbook, target = player) {
  const sheetName = findPlayerSheet(workbook, target);

  if (!sheetName) return null;

  const rows = workbookRows(sheetName);

  const result = {
    sheetName,
    ratioByStage: {}
  };

  // Onglet individuel :
  // ligne 17 = Ratio Shirado / Sorensen
  // colonnes C/D/E = Pré-saison / Mi-saison / Fin de saison
  const ratioRow = rows[16] || [];

  STAGES.forEach((s, index) => {
    result.ratioByStage[s.key] = num(ratioRow[2 + index]);
  });

  return result;
}

/* Lit le classeur du préparateur pour UN joueur.
   Décalages du modèle Tests_Physiques_N2-5 (vérifiés contre le fichier réel) :
     Anthropométrie  en-tête ligne 4 ; taille col C.., poids col N.., MG col Y..
     Plis cutanés    âge col C, puis 6 colonnes par mois à partir de D
     Tests bruts     9 colonnes par session à partir de C
     Profil sur 10   5 colonnes par session à partir de C
   Voir tests/perf-logic.test.mjs. */
function parseExcel(file, workbook, target = player) {
  const anth = workbookRows('Anthropométrie');
  const folds = workbookRows('Plis cutanés');
  const raw = workbookRows('Tests bruts');
  const profile = workbookRows('Profil sur 10');

  const anthMatch = findPlayerRow(anth, target);
  const foldsMatch = findPlayerRow(folds, target);
  const rawMatch = findPlayerRow(raw, target);
  const profileMatch = findPlayerRow(profile, target);

  const playerSheet = parsePlayerSheet(workbook, target);

  if (!anthMatch && !foldsMatch && !rawMatch && !profileMatch) {
    throw new Error(
      `Le joueur « ${`${target.prenom || ''} ${target.nom || ''}`.trim()} » n’a pas été trouvé dans cet Excel.`
    );
  }

  const measurementsRows = [];
  const testRows = [];

  /*
   * ============================================================
   * ANTHROPOMÉTRIE + PLIS CUTANÉS
   * ============================================================
   *
   * On lit UNIQUEMENT la ligne correspondant au joueur courant.
   *
   * Important :
   * - aucune masse grasse n'est recalculée ;
   * - si Excel contient une valeur => on l'importe ;
   * - si Excel est vide => on conserve null.
   */

  const anthRow = anthMatch ? (anth[anthMatch.index] || []) : [];
  const foldRow = foldsMatch ? (folds[foldsMatch.index] || []) : [];

  const age = num(foldRow[2]);

  MONTHS.forEach((month, mi) => {
    const height = num(anthRow[2 + mi]);
    const weight = num(anthRow[13 + mi]);
    const mgFromAnth = num(anthRow[24 + mi]);

    // Plis cutanés :
    // Août commence colonne D (index 3)
    // puis 6 colonnes par mois.
    const fs = 3 + mi * 6;

    const biceps = num(foldRow[fs]);
    const triceps = num(foldRow[fs + 1]);
    const subscapular = num(foldRow[fs + 2]);
    const suprailiac = num(foldRow[fs + 3]);
    const skinfoldSum = num(foldRow[fs + 4]);
    const mgFromFolds = num(foldRow[fs + 5]);

    // PRIORITÉ À LA VALEUR DÉJÀ PRÉSENTE DANS EXCEL.
    const bodyFat = mgFromAnth ?? mgFromFolds;

    if ([
      height,
      weight,
      bodyFat,
      biceps,
      triceps,
      subscapular,
      suprailiac,
      skinfoldSum
    ].some(v => v !== null)) {
      measurementsRows.push({
        name: anthMatch?.name || foldsMatch?.name || `${target.prenom || ''} ${target.nom || ''}`.trim(),
        month_label: month,
        age_at_measurement: age,
        height_cm: height,
        weight_kg: weight,
        body_fat_pct: bodyFat,
        biceps_mm: biceps,
        triceps_mm: triceps,
        subscapular_mm: subscapular,
        suprailiac_mm: suprailiac,
        skinfold_sum_4_mm: skinfoldSum
      });
    }
  });

  /*
   * ============================================================
   * TESTS BRUTS
   * ============================================================
   *
   * Les colonnes "505 moyenne" et "Asymétrie" sont déjà calculées
   * dans Excel : on les reprend directement.
   */

  const rawRow = rawMatch ? (raw[rawMatch.index] || []) : [];

  STAGES.forEach((s, si) => {
    const c = 2 + si * 9;

    const sprint10 = num(rawRow[c]);
    const five05Left = num(rawRow[c + 1]);
    const five05Right = num(rawRow[c + 2]);
    const five05Avg = num(rawRow[c + 3]);
    const five05Asym = num(rawRow[c + 4]);
    const sprint40 = num(rawRow[c + 5]);
    const vift = num(rawRow[c + 6]);
    const shirado = num(rawRow[c + 7]);
    const sorensen = num(rawRow[c + 8]);

    const ratio = playerSheet?.ratioByStage?.[s.key] ?? null;

    if ([
      sprint10,
      five05Left,
      five05Right,
      five05Avg,
      five05Asym,
      sprint40,
      vift,
      shirado,
      sorensen,
      ratio
    ].some(v => v !== null)) {
      testRows.push({
        name: rawMatch?.name || `${target.prenom || ''} ${target.nom || ''}`.trim(),
        stage: s.key,

        sprint10_sec: sprint10,
        five05_left_sec: five05Left,
        five05_right_sec: five05Right,
        five05_avg_sec: five05Avg,
        five05_asymmetry_pct: five05Asym,
        sprint40_sec: sprint40,
        vift_kmh: vift,
        shirado_sec: shirado,
        sorensen_sec: sorensen,
        core_ratio: ratio
      });
    }
  });

  /*
   * ============================================================
   * PROFIL /10
   * ============================================================
   *
   * Ces scores existent déjà dans "Profil sur 10".
   * On les importe tels quels pour alimenter le radar.
   */

  const profileRow = profileMatch ? (profile[profileMatch.index] || []) : [];

  STAGES.forEach((s, si) => {
    const c = 2 + si * 5;

    const profileStart = num(profileRow[c]);
    const profileAgility = num(profileRow[c + 1]);
    const profileSpeed = num(profileRow[c + 2]);
    const profileEndurance = num(profileRow[c + 3]);
    const profileCore = num(profileRow[c + 4]);

    const test = testRows.find(t => t.stage === s.key);

    const hasProfile = [
      profileStart,
      profileAgility,
      profileSpeed,
      profileEndurance,
      profileCore
    ].some(v => v !== null);

    if (hasProfile) {
      if (test) {
        test.profile_start = profileStart;
        test.profile_agility = profileAgility;
        test.profile_speed = profileSpeed;
        test.profile_endurance = profileEndurance;
        test.profile_core = profileCore;
      } else {
        testRows.push({
          name: profileMatch?.name || `${target.prenom || ''} ${target.nom || ''}`.trim(),
          stage: s.key,

          sprint10_sec: null,
          five05_left_sec: null,
          five05_right_sec: null,
          five05_avg_sec: null,
          five05_asymmetry_pct: null,
          sprint40_sec: null,
          vift_kmh: null,
          shirado_sec: null,
          sorensen_sec: null,
          core_ratio: null,

          profile_start: profileStart,
          profile_agility: profileAgility,
          profile_speed: profileSpeed,
          profile_endurance: profileEndurance,
          profile_core: profileCore
        });
      }
    }
  });

  return {
    fileName: file.name,
    sourceFile: file.name,

    targetPlayerId: target.id,

    targetName: `${target.prenom || ''} ${target.nom || ''}`.trim(),

    excelNames: [
      anthMatch?.name,
      foldsMatch?.name,
      rawMatch?.name,
      profileMatch?.name
    ].filter(Boolean),

    measurements: measurementsRows,
    tests: testRows,

    individualSheet: playerSheet?.sheetName || null
  };
}

/* ============================================================
   IMPORT EXCEL
   Deux modes, un seul parseur :
     - ciblé  : la fiche ouverte uniquement ;
     - club   : tous les joueurs du club présents dans le fichier.
   Dans les deux cas, chaque ligne est lue pour UN joueur précis,
   ce qui interdit structurellement le mélange de données.
   ============================================================ */

/* Construit les lignes Supabase pour un joueur à partir du résultat
   de parseExcel(). Utilisé par les deux modes : les clés d'unicité et
   la traçabilité de la source sont donc forcément identiques. */
function buildImportPayloads(data, target, fileName) {
  const common = { club_id: target.club_id, player_id: target.id };

  const measurements = data.measurements.map(r => ({
    ...common,
    month_label: r.month_label,
    // season_key attend une saison, pas un nom de fichier : la provenance
    // est déjà tracée par source_file_name.
    season_key: null,
    age_at_measurement: r.age_at_measurement,
    height_cm: r.height_cm,
    weight_kg: r.weight_kg,
    body_fat_pct: r.body_fat_pct,
    biceps_mm: r.biceps_mm,
    triceps_mm: r.triceps_mm,
    subscapular_mm: r.subscapular_mm,
    suprailiac_mm: r.suprailiac_mm,
    skinfold_sum_4_mm: r.skinfold_sum_4_mm,
    source: 'import_excel',
    source_file_name: fileName,
    source_sheet: 'Anthropométrie + Plis cutanés',
    created_by: ctxProfile.id,
  }));

  const tests = data.tests.map(r => ({
    ...common,
    stage: r.stage,
    sprint10_sec: r.sprint10_sec,
    five05_left_sec: r.five05_left_sec,
    five05_right_sec: r.five05_right_sec,
    five05_avg_sec: r.five05_avg_sec,
    five05_asymmetry_pct: r.five05_asymmetry_pct,
    sprint40_sec: r.sprint40_sec,
    vift_kmh: r.vift_kmh,
    shirado_sec: r.shirado_sec,
    sorensen_sec: r.sorensen_sec,
    core_ratio: r.core_ratio,
    profile_start: r.profile_start ?? null,
    profile_agility: r.profile_agility ?? null,
    profile_speed: r.profile_speed ?? null,
    profile_endurance: r.profile_endurance ?? null,
    profile_core: r.profile_core ?? null,
    source: 'import_excel',
    source_file_name: fileName,
    source_sheet: 'Tests bruts + Profil sur 10',
    created_by: ctxProfile.id,
  }));

  return { measurements, tests };
}

function countFilledTests(rows) {
  const FIELDS = ['sprint10_sec','five05_left_sec','five05_right_sec','five05_avg_sec',
    'five05_asymmetry_pct','sprint40_sec','vift_kmh','shirado_sec','sorensen_sec',
    'profile_start','profile_agility','profile_speed','profile_endurance','profile_core'];
  return rows.filter(t => FIELDS.some(k => t[k] !== null && t[k] !== undefined)).length;
}

function renderImportSummary() {
  const { entries, fileName, mode } = importState;
  const matched = entries.filter(e => e.data);
  const missing = entries.filter(e => !e.data);

  const totalMeasurements = matched.reduce((n, e) => n + e.data.measurements.length, 0);
  const totalTests = matched.reduce((n, e) => n + countFilledTests(e.data.tests), 0);

  document.getElementById('importSummary').innerHTML = `
    <div><strong>${matched.length}</strong> joueur${matched.length > 1 ? 's' : ''} reconnu${matched.length > 1 ? 's' : ''}</div>
    <div><strong>${totalMeasurements}</strong> mesures physiques détectées</div>
    <div><strong>${totalTests}</strong> sessions de tests détectées</div>
  `;

  const rowsHtml = entries.map(e => {
    const nbM = e.data ? e.data.measurements.length : 0;
    const nbT = e.data ? countFilledTests(e.data.tests) : 0;
    const excelNames = e.data ? [...new Set(e.data.excelNames)].join(' · ') : '';
    return `<div class="import-row ${e.data ? '' : 'import-row-missing'}">
      <span class="import-row-name">${esc(e.label)}</span>
      <span class="import-row-src">${e.data ? esc(excelNames || '—') : 'absent du fichier'}</span>
      <span class="import-row-count">${e.data ? `${nbM} mes. · ${nbT} tests` : '—'}</span>
      <span class="import-row-sheet">${e.data?.individualSheet ? esc(e.data.individualSheet) : ''}</span>
    </div>`;
  }).join('');

  document.getElementById('mappingBox').innerHTML = `
    <div class="mapping-ok">
      <strong>${mode === 'bulk' ? 'Import de tout le club' : `Import ciblé sur ${esc(entries[0]?.label || '')}`}</strong><br>
      Fichier : ${esc(fileName)}.
      Chaque joueur est lu sur sa propre ligne : aucune donnée n'est partagée entre deux fiches.
      Les cellules vides de l'Excel restent vides (aucune valeur n'est inventée).
      ${missing.length ? `<br><span class="text-muted">${missing.length} fiche(s) sans correspondance : elles ne seront pas modifiées.</span>` : ''}
    </div>
    <div class="import-row import-row-head">
      <span>Fiche FootSession</span><span>Nom trouvé dans l'Excel</span><span>Données</span><span>Onglet individuel</span>
    </div>
    ${rowsHtml}
  `;

  document.getElementById('btnConfirmImport').disabled = !(totalMeasurements || totalTests);
}

async function startExcelImport(file) {
  if (!file || !canEditPerformance) return;

  const bulk = document.getElementById('importAllPlayers')?.checked === true;
  document.getElementById('btnConfirmImport').disabled = true;
  document.getElementById('importSummary').textContent = 'Lecture du fichier…';
  document.getElementById('mappingBox').innerHTML = '';

  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    importState = { entries: [], fileName: file.name, mode: bulk ? 'bulk' : 'single', workbook };

    let targets = [player];
    if (bulk) {
      const { data, error } = await sb.from('players')
        .select('id, nom, prenom, numero, club_id')
        .eq('club_id', player.club_id).order('nom');
      if (error) throw error;
      targets = data || [];
      if (!targets.length) throw new Error('Aucune fiche joueur dans ce club.');
    }

    importState.entries = targets.map(target => {
      const label = `${target.prenom || ''} ${target.nom || ''}`.trim() || `Fiche #${target.id}`;
      try {
        return { target, label, data: parseExcel(file, workbook, target) };
      } catch {
        // Joueur absent du classeur : on l'affiche comme non résolu plutôt
        // que de faire échouer tout l'import.
        return { target, label, data: null };
      }
    });

    if (!importState.entries.some(e => e.data)) {
      throw new Error(bulk
        ? 'Aucun joueur du club n’a été retrouvé dans ce fichier.'
        : `Le joueur « ${`${player.prenom || ''} ${player.nom || ''}`.trim()} » n’a pas été trouvé dans cet Excel.`);
    }

    renderImportSummary();
  } catch (e) {
    document.getElementById('btnConfirmImport').disabled = true;
    document.getElementById('importSummary').textContent = '';
    notify(`Lecture Excel impossible : ${e.message}`, 'error');
  }
}

async function confirmExcelImport() {
  if (!importState.entries?.length || !canEditPerformance) return;

  const btn = document.getElementById('btnConfirmImport');
  btn.disabled = true;

  const matched = importState.entries.filter(e => e.data);
  const mPayload = [];
  const tPayload = [];
  for (const e of matched) {
    const { measurements: m, tests: t } = buildImportPayloads(e.data, e.target, importState.fileName);
    mPayload.push(...m);
    tPayload.push(...t);
  }

  try {
    if (mPayload.length) {
      const { error } = await sb.from('player_physical_measurements')
        .upsert(mPayload, { onConflict: 'club_id,player_id,month_label,source_file_name' });
      if (error) throw error;
    }
    if (tPayload.length) {
      const { error } = await sb.from('player_physical_tests')
        .upsert(tPayload, { onConflict: 'club_id,player_id,stage,source_file_name' });
      if (error) throw error;
    }

    closePerfModal('importModal');
    notify(
      `Import terminé : ${matched.length} joueur${matched.length > 1 ? 's' : ''}, ` +
      `${mPayload.length} mesures et ${tPayload.length} sessions de tests.`,
      'success'
    );

    importState = { entries: [], fileName: '', mode: 'single' };
    document.getElementById('excelFile').value = '';
    await reloadData();
  } catch (e) {
    notify(`Import non effectué : ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

document.querySelectorAll('[data-close]').forEach(btn=>{
  btn.addEventListener('click',()=>closePerfModal(btn.dataset.close));
});
document.getElementById('stageSelect').addEventListener('change', async e => {
  stage = e.target.value;
  await loadClubAverages();
  renderRadar();
  renderMeasurements();
});
document.getElementById('btnAddMeasurement').addEventListener('click',()=>{
  document.getElementById('manualMeasurementBox').classList.toggle('hidden');
});
document.getElementById('btnSaveMeasurement').addEventListener('click',saveMeasurement);
document.getElementById('btnSaveTest').addEventListener('click',saveTest);
document.getElementById('btnAddStrength').addEventListener('click',()=>{
  document.getElementById('noteKind').value='strength';
  document.getElementById('noteModalTitle').textContent='Ajouter un point fort';
  openPerfModal('noteModal');
});
document.getElementById('btnAddImprovement').addEventListener('click',()=>{
  document.getElementById('noteKind').value='improvement';
  document.getElementById('noteModalTitle').textContent='Ajouter un point d’amélioration';
  openPerfModal('noteModal');
});
document.getElementById('btnAddObjective').addEventListener('click',()=>{
  document.getElementById('noteKind').value='objective';
  document.getElementById('noteModalTitle').textContent='Ajouter un objectif';
  openPerfModal('noteModal');
});
document.getElementById('btnSaveNote').addEventListener('click',saveNote);
document.getElementById('btnAddPhoto').addEventListener('click',()=>document.getElementById('photoFile').click());
document.getElementById('photoFile').addEventListener('change',e=>uploadPhoto(e.target.files[0]));
document.getElementById('btnImportExcel').addEventListener('click',()=>openPerfModal('importModal'));
document.getElementById('excelFile').addEventListener('change',e=>startExcelImport(e.target.files[0]));
document.getElementById('btnConfirmImport').addEventListener('click',confirmExcelImport);

loadPage()
  .then(() => initFmPerformanceUpgrade())
  .catch(e => console.error('FM performance upgrade:', e));

/* ============================================================
   FootSession Pro — upgrade visuel FM + sélection vidéos joueur
   ============================================================ */

let fpFmVideos = [];
let fpFmSelections = new Map();
let fpFmFilter = 'all';


function fpFmCategory(video) {
  const text = normalizeName(`${video?.titre || ''} ${video?.description || ''}`);

  if (/(but|buts|goal|goals|finition|frappe|tir)/.test(text)) return 'buts';
  if (/(pass|passe|passes|assist|assistance)/.test(text)) return 'passes';
  if (/(defens|defense|tacle|intercept|duel|pressing)/.test(text)) return 'defense';
  return 'travail';
}

function fpFmCategoryLabel(key) {
  return {
    all: 'Toutes',
    buts: 'Buts',
    passes: 'Passes',
    defense: 'Actions défensives',
    travail: 'Séquences à travailler',
    selection: 'Ma sélection'
  }[key] || 'Toutes';
}

function fpFmDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('fr-FR');
  } catch {
    return '—';
  }
}

function fpFmDuration(sec) {
  const n = Number(sec || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return m ? `${m}:${String(s).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`;
}

function fpFmSelected(videoId) {
  return fpFmSelections.get(Number(videoId))?.selected === true;
}

function fpFmValidated(videoId) {
  return !!fpFmSelections.get(Number(videoId))?.validated_at &&
    fpFmSelections.get(Number(videoId))?.selected === true;
}

function fpFmCounts() {
  const counts = {
    all: fpFmVideos.length,
    buts: 0,
    passes: 0,
    defense: 0,
    travail: 0,
    selection: 0
  };

  fpFmVideos.forEach(video => {
    const cat = fpFmCategory(video);
    counts[cat] += 1;

    const isSelectedForPlayer =
      ctxProfile?.role === 'joueur'
        ? fpFmSelected(video.id)
        : fpFmValidated(video.id);

    if (isSelectedForPlayer) counts.selection += 1;
  });

  return counts;
}

/* La sidebar « FM » (photo, mini-terrain, accès rapide) a été retirée :
   elle déplaçait .perf-grid-main dans une grille 2 colonnes écrite pour une
   autre structure de page, ce qui écrasait le radar et le suivi physique.
   Elle n'avait de fait jamais fonctionné (elle cherchait .dash-grid, absent
   d'ici). À refaire, si besoin, avec un CSS conçu pour cette page. */

function fpFmEnhanceCards() {
  const radarCard = document.getElementById('radarWrap')?.closest('.card');
  const testCard = document.getElementById('testSummary')?.closest('.card');
  const measurementCard = document.getElementById('measurementHistory')?.closest('.card');

  radarCard?.classList.add('fp-fm-radar-card');
  testCard?.classList.add('fp-fm-tests-card');
  measurementCard?.classList.add('fp-fm-history-card');
}

async function fpFmLoadVideos() {
  if (!player?.id) return;

  const panel = document.getElementById('fpVideoSelectionPanel');
  if (panel) {
    panel.innerHTML = `<div class="fp-video-empty">Chargement des séquences…</div>`;
  }

  const [videoRes, selectionRes] = await Promise.all([
    sb.from('player_videos')
      .select('id,titre,description,storage_path,duree_sec,created_at')
      .eq('player_id', player.id)
      .order('created_at', { ascending: true }),

    sb.from('player_video_selections')
      .select('video_id,selected,validated_at,updated_at')
      .eq('player_id', player.id)
  ]);

  if (videoRes.error) {
    throw videoRes.error;
  }

  if (selectionRes.error) {
    if (panel) {
      panel.innerHTML = `
        <div class="fp-video-migration">
          Le système de sélection vidéo n'est pas encore activé côté Supabase.<br>
          Exécute <strong>supabase/player_video_selections.sql</strong> dans le SQL Editor Supabase.
        </div>
      `;
    }
    fpFmVideos = [];
    fpFmSelections = new Map();
    return;
  }

  const signedVideos = await Promise.all(
    (videoRes.data || []).map(async video => {
      const { data, error } =
        await sb.storage.from('player-videos').createSignedUrl(video.storage_path, 3600);

      return {
        ...video,
        category: fpFmCategory(video),
        signed_url: error ? '' : (data?.signedUrl || '')
      };
    })
  );

  fpFmVideos = signedVideos;
  fpFmSelections = new Map(
    (selectionRes.data || []).map(row => [Number(row.video_id), row])
  );

  fpFmRenderVideoPanel();
}

function fpFmMatchesFilter(video) {
  if (fpFmFilter === 'all') return true;

  if (fpFmFilter === 'selection') {
    return ctxProfile?.role === 'joueur'
      ? fpFmSelected(video.id)
      : fpFmValidated(video.id);
  }

  return fpFmCategory(video) === fpFmFilter;
}

function fpFmRenderVideoPanel() {
  const panel = document.getElementById('fpVideoSelectionPanel');
  if (!panel) return;

  const counts = fpFmCounts();
  const isPlayer = ctxProfile?.role === 'joueur';

  const selectedCount = fpFmVideos.filter(video =>
    isPlayer ? fpFmSelected(video.id) : fpFmValidated(video.id)
  ).length;

  const validatedCount = fpFmVideos.filter(video => fpFmValidated(video.id)).length;

  const buttons = [
    ['all', `Toutes (${counts.all})`],
    ['buts', `Buts (${counts.buts})`],
    ['passes', `Passes (${counts.passes})`],
    ['defense', `Actions défensives (${counts.defense})`],
    ['travail', `Séquences à travailler (${counts.travail})`],
    ['selection', `${isPlayer ? 'Ma sélection' : 'Sélection joueur'} (${counts.selection})`]
  ];

  const filtered = fpFmVideos.filter(fpFmMatchesFilter);

  panel.innerHTML = `
    <div class="fp-video-head">
      <div class="fp-video-title">
        <h2>Vidéos du joueur</h2>
        <p>
          ${
            isPlayer
              ? 'Sélectionne les séquences que tu souhaites travailler avec ton staff.'
              : 'Séquences mises à disposition et choix validés par le joueur.'
          }
        </p>
      </div>

      <div class="fp-video-actions">
        <div class="fp-video-status">
          ${isPlayer
            ? `${selectedCount} sélectionnée${selectedCount > 1 ? 's' : ''}`
            : `${validatedCount} validée${validatedCount > 1 ? 's' : ''} par le joueur`}
        </div>

        ${
          isPlayer
            ? `<button
                 id="fpValidateVideoSelection"
                 class="fp-video-validate"
                 type="button"
                 ${selectedCount ? '' : 'disabled'}>
                 Valider ma sélection (${selectedCount})
               </button>`
            : ''
        }
      </div>
    </div>

    <div class="fp-video-filters">
      ${buttons.map(([key, label]) => `
        <button
          type="button"
          class="fp-filter-btn ${fpFmFilter === key ? 'active' : ''}"
          data-fp-video-filter="${key}">
          ${esc(label)}
        </button>
      `).join('')}
    </div>

    ${
      filtered.length
        ? `<div class="fp-video-grid">
            ${filtered.map((video, index) => {
              const selected = fpFmSelected(video.id);
              const validated = fpFmValidated(video.id);
              const catLabel = fpFmCategoryLabel(fpFmCategory(video));

              return `
                <article class="fp-video-card ${selected && isPlayer ? 'selected' : ''} ${validated ? 'validated' : ''}">
                  ${
                    isPlayer
                      ? `<label class="fp-video-check" title="Sélectionner cette vidéo">
                           <input
                             type="checkbox"
                             class="fp-video-checkbox"
                             data-video-id="${video.id}"
                             ${selected ? 'checked' : ''}>
                         </label>`
                      : validated
                        ? `<div class="fp-video-selected-badge">✓ SÉLECTIONNÉE</div>`
                        : ''
                  }

                  <div class="fp-video-media">
                    ${
                      video.signed_url
                        ? `<video
                             preload="metadata"
                             muted
                             playsinline
                             src="${esc(video.signed_url)}">
                           </video>`
                        : `<div class="fp-video-empty" style="height:100%;display:grid;place-items:center;">
                             Vidéo indisponible
                           </div>`
                    }

                    ${
                      video.signed_url
                        ? `<button
                             type="button"
                             class="fp-video-play"
                             data-video-play="${video.id}"
                             aria-label="Lire la vidéo">▶</button>`
                        : ''
                    }

                    ${
                      video.duree_sec
                        ? `<span class="fp-video-duration">${fpFmDuration(video.duree_sec)}</span>`
                        : ''
                    }
                  </div>

                  <div class="fp-video-body">
                    <h3>#${index + 1} · ${esc(video.titre || 'Séquence')}</h3>
                    <div class="fp-video-meta">
                      <span>${esc(catLabel)}</span>
                      <span>${esc(fpFmDate(video.created_at))}</span>
                    </div>

                    ${
                      !isPlayer && validated
                        ? `<div class="fp-video-staff-selected">
                             À travailler en séance
                           </div>`
                        : ''
                    }
                  </div>
                </article>
              `;
            }).join('')}
          </div>`
        : `<div class="fp-video-empty">
             Aucune vidéo dans cette catégorie.
           </div>`
    }
  `;

  panel.querySelectorAll('[data-fp-video-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      fpFmFilter = btn.dataset.fpVideoFilter || 'all';
      fpFmRenderVideoPanel();
    });
  });

  panel.querySelectorAll('.fp-video-checkbox').forEach(input => {
    input.addEventListener('change', async event => {
      event.stopPropagation();
      await fpFmSetSelection(
        Number(input.dataset.videoId),
        input.checked
      );
    });
  });

  panel.querySelectorAll('[data-video-play]').forEach(button => {
    button.addEventListener('click', () => {
      const card = button.closest('.fp-video-card');
      const video = card?.querySelector('video');
      if (!video) return;

      if (video.paused) {
        panel.querySelectorAll('video').forEach(v => {
          if (v !== video) v.pause();
        });
        video.play().catch(() => {});
        button.textContent = '❚❚';
      } else {
        video.pause();
        button.textContent = '▶';
      }
    });
  });

  const validate = document.getElementById('fpValidateVideoSelection');
  if (validate) {
    validate.addEventListener('click', fpFmValidateSelection);
  }
}

async function fpFmSetSelection(videoId, selected) {
  const video = fpFmVideos.find(v => Number(v.id) === Number(videoId));
  if (!video || !player?.id || ctxProfile?.role !== 'joueur') return;

  const previous = fpFmSelections.get(Number(videoId));

  fpFmSelections.set(Number(videoId), {
    ...(previous || {}),
    video_id: videoId,
    selected,
    validated_at: null
  });

  fpFmRenderVideoPanel();

  const payload = {
    club_id: player.club_id,
    player_id: player.id,
    video_id: videoId,
    selected,
    validated_at: null,
    updated_at: new Date().toISOString()
  };

  const { data, error } =
    await sb.from('player_video_selections')
      .upsert(payload, { onConflict: 'player_id,video_id' })
      .select('video_id,selected,validated_at,updated_at')
      .single();

  if (error) {
    if (previous) {
      fpFmSelections.set(Number(videoId), previous);
    } else {
      fpFmSelections.delete(Number(videoId));
    }

    fpFmRenderVideoPanel();
    notify(error.message, 'error');
    return;
  }

  if (data) {
    fpFmSelections.set(Number(videoId), data);
    fpFmRenderVideoPanel();
  }
}

async function fpFmValidateSelection() {
  if (ctxProfile?.role !== 'joueur' || !player?.id) return;

  const selectedVideos = fpFmVideos.filter(video => fpFmSelected(video.id));

  if (!selectedVideos.length) {
    notify('Sélectionne au moins une vidéo.', 'error');
    return;
  }

  const validatedAt = new Date().toISOString();

  const payload = fpFmVideos.map(video => ({
    club_id: player.club_id,
    player_id: player.id,
    video_id: video.id,
    selected: fpFmSelected(video.id),
    validated_at: fpFmSelected(video.id) ? validatedAt : null,
    updated_at: validatedAt
  }));

  const { error } =
    await sb.from('player_video_selections')
      .upsert(payload, { onConflict: 'player_id,video_id' });

  if (error) {
    notify(error.message, 'error');
    return;
  }

  payload.forEach(row => {
    fpFmSelections.set(Number(row.video_id), row);
  });

  notify(
    `${selectedVideos.length} séquence${selectedVideos.length > 1 ? 's' : ''} envoyée${selectedVideos.length > 1 ? 's' : ''} au staff.`,
    'success'
  );

  fpFmRenderVideoPanel();
}

function fpFmMountVideoPanel() {
  if (document.getElementById('fpVideoSelectionPanel')) return;

  const panel = document.createElement('section');
  panel.id = 'fpVideoSelectionPanel';
  panel.className = 'card fp-video-panel';

  const slot = document.getElementById('videoPanelSlot')
    || document.querySelector('.main') || document.body;
  slot.appendChild(panel);

  panel.innerHTML = `<div class="fp-video-empty">Chargement des vidéos…</div>`;
}

async function initFmPerformanceUpgrade() {
  fpFmEnhanceCards();
  fpFmMountVideoPanel();

  try {
    await fpFmLoadVideos();
    renderSidebar();   // le compteur de vidéos n'est connu qu'ici
  } catch (error) {
    const panel = document.getElementById('fpVideoSelectionPanel');

    if (panel) {
      panel.innerHTML = `
        <div class="fp-video-empty">
          Impossible de charger les vidéos pour le moment.
          <br><span style="font-size:.72rem;">${esc(error?.message || 'Erreur inconnue')}</span>
        </div>
      `;
    }

    console.error('fpFmLoadVideos:', error);
  }
}
