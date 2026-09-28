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
let clubAverages = null;   // moyennes du club pour la session affichée
let squadTests = [];       // tests du club retenus pour la session affichée (staff)
let clubTestsAll = [];     // tous les tests du club, toutes sessions (staff)
let clubPlayers = [];      // effectif du club (staff)
let squadLoadFailed = false;
let career = [];           // parcours en club du joueur
let careerMissing = false; // table player_career absente : migration non passée
let identityMissing = false; // colonnes d'identité absentes : migration non passée
let canEditPlayer = false; // identité + parcours : mêmes droits que la fiche joueur
let expandedTests = new Set();
let clubLogoUrl = null;
let currentSeason = null;  // saison affichée : la plus récente du joueur

/* Rôles du staff ayant accès à la performance (can_view_performance()
   côté base). Ce sont aussi ceux qui modifient la fiche (can_edit()). */
const STAFF_ROLES = ['admin', 'coach', 'analyste', 'prepa'];
const isStaff = () => STAFF_ROLES.includes(ctxProfile?.role);

/* Colonnes d'identité ajoutées par supabase/player_profile_career.sql. */
const PLAYER_BASE_COLS = 'id, nom, prenom, numero, poste, club_id, auth_user_id, photo_path';
const PLAYER_IDENTITY_COLS = 'date_naissance, nationalite, pied_fort, statut, contrat_fin';

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
function fmt(n, digits = 1) {
  return n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(digits).replace('.', ',');
}
function initials(p) {
  return (((p?.prenom || p?.nom || '')[0] || '') + ((p?.nom || '')[0] || '') || '?').toUpperCase();
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
/* Ordre chronologique d'une mesure dans la saison.
   Le mois fait foi : c'est ce que portent aussi bien l'Excel que la saisie
   manuelle. La date départage deux mesures du même mois, puis l'ordre
   d'enregistrement. Le tableau, la courbe et l'en-tête utilisent tous ce
   même ordre — ils ne peuvent donc plus se contredire. */
function measurementOrder(a, b) {
  return (MONTHS.indexOf(a.month_label) - MONTHS.indexOf(b.month_label))
    || String(a.measured_at || '').localeCompare(String(b.measured_at || ''))
    || ((a.id || 0) - (b.id || 0));
}
function orderedMeasurements() {
  return [...measurements].sort(measurementOrder);
}
/* Dernière valeur connue d'un champ, avec son mois.
   Une mesure récente qui ne porte que le poids ne doit pas faire
   disparaître la taille mesurée le mois précédent. */
function latestValue(field) {
  const row = orderedMeasurements().filter(m => num(m[field]) !== null).at(-1);
  return row ? { value: num(row[field]), month: row.month_label } : null;
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

function radarSvg(test, reference = clubAverages) {
  const { W, H, cx, cy, R } = RADAR;
  const values = SCORE_LABELS.map(([key]) => scoreValue(test, key));
  const refs = SCORE_LABELS.map(([key]) => scoreValue(reference, key));

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
   Tableau des tests : valeur, moyenne du club, écart.
   Les métriques, leurs unités, leur sens de progression et leurs
   bornes de vraisemblance viennent de assets/js/perf-metrics.js,
   partagé avec la page Comparaison.
   ------------------------------------------------------------ */
const TEST_ROWS = PERF_METRICS;

/* Rang du joueur et liste de l'effectif pour une métrique, sur la
   session affichée. Les valeurs hors bornes sont listées à part : elles
   sont exclues de la moyenne et du classement, jamais corrigées. */
function squadForMetric(m) {
  const nameOf = id => {
    const pl = clubPlayers.find(x => x.id === id);
    return pl ? (`${pl.prenom || ''} ${pl.nom || ''}`.trim() || `Fiche #${id}`) : `Fiche #${id}`;
  };
  const entries = squadTests
    .map(t => ({ id: t.player_id, name: nameOf(t.player_id), value: num(t[m.key]) }))
    .filter(e => e.value !== null);
  const ranked = entries.filter(e => !isImplausible(m.key, e.value))
    .sort((a, b) => m.better === 'lower' ? a.value - b.value : b.value - a.value);
  const flagged = entries.filter(e => isImplausible(m.key, e.value));
  const tested = new Set(entries.map(e => e.id));
  const untested = clubPlayers
    .filter(pl => !tested.has(pl.id))
    .map(pl => `${pl.prenom || ''} ${pl.nom || ''}`.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return { ranked, flagged, untested };
}

function squadPanel(m, colspan) {
  const { ranked, flagged, untested } = squadForMetric(m);
  const avg = perfAverage(squadTests, m.key);
  const stageLabel = STAGES.find(x => x.key === stage)?.label || '';
  const values = ranked.map(e => e.value);
  const lo = Math.min(...values), hi = Math.max(...values);
  // Barre : position dans l'amplitude du groupe, le meilleur à 100 %.
  const width = v => {
    if (!values.length || hi === lo) return 100;
    const t = m.better === 'lower' ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo);
    return Math.round(12 + t * 88);
  };
  const unit = m.unit ? ` ${m.unit}` : '';

  return `<tr class="t-squad"><td colspan="${colspan}">
    <div class="squad-panel">
      <div class="squad-head">
        <strong>${esc(m.label)}</strong> — ${esc(stageLabel)} ·
        ${avg.value !== null
          ? `moyenne <strong>${fmt(avg.value, m.digits)}${esc(unit)}</strong> sur ${avg.n} joueur${avg.n > 1 ? 's' : ''}`
          : `${avg.n} joueur${avg.n > 1 ? 's' : ''} testé${avg.n > 1 ? 's' : ''} : moyenne affichée à partir de 3`}
        ${flagged.length ? ` · ${flagged.length} valeur${flagged.length > 1 ? 's' : ''} écartée${flagged.length > 1 ? 's' : ''}` : ''}
      </div>
      <ol class="squad-list">
        ${ranked.map((e, i) => `<li class="${e.id === player.id ? 'is-me' : ''}">
          <span class="sq-rank">${i + 1}</span>
          <a class="sq-name" href="player-performance.html?id=${e.id}">${esc(e.name)}</a>
          <span class="sq-bar"><i style="width:${width(e.value)}%"></i></span>
          <span class="sq-val">${fmt(e.value, m.digits)}${esc(unit)}</span>
        </li>`).join('')}
        ${flagged.map(e => `<li class="is-flagged${e.id === player.id ? ' is-me' : ''}"
            title="Hors des bornes attendues (${m.min}–${m.max}${esc(unit)}) : exclue de la moyenne et du classement.">
          <span class="sq-rank">⚠</span>
          <a class="sq-name" href="player-performance.html?id=${e.id}">${esc(e.name)}</a>
          <span class="sq-bar sq-bar-flag">valeur à vérifier</span>
          <span class="sq-val">${fmt(e.value, m.digits)}${esc(unit)}</span>
        </li>`).join('')}
      </ol>
      ${untested.length ? `<p class="squad-untested">Non testés : ${untested.map(esc).join(', ')}</p>` : ''}
    </div>
  </td></tr>`;
}

function renderTestSummary(test) {
  const box = document.getElementById('testSummary');
  if (!test) {
    box.innerHTML = `<div class="empty">Aucun test pour cette session.</div>`;
    return;
  }
  const staff = isStaff() && squadTests.length > 0;
  const hasRef = TEST_ROWS.some(r => num(clubAverages?.[r.key]) !== null);
  const cols = 3 + (hasRef ? 2 : 0) + (staff ? 1 : 0);

  const body = TEST_ROWS.map(r => {
    const value = num(test[r.key]);
    const ref = num(clubAverages?.[r.key]);
    const flagged = isImplausible(r.key, value);
    let gap = '<span class="gap-none">—</span>';
    const delta = flagged ? null : perfDelta(r.key, value, ref);
    if (delta !== null) {
      const good = delta >= 0;
      gap = `<span class="gap ${good ? 'gap-up' : 'gap-down'}">${good ? '↗' : '↘'} ${
        good ? '+' : '−'}${fmt(Math.abs(delta), r.digits)}</span>`;
    }
    let rankCell = '';
    if (staff) {
      const { ranked } = squadForMetric(r);
      const pos = ranked.findIndex(e => e.id === player.id);
      rankCell = `<td class="t-rank">${r.better && pos >= 0 ? `${pos + 1}<small>/${ranked.length}</small>` : '—'}</td>`;
    }
    const open = staff && expandedTests.has(r.key);
    const row = `<tr class="${staff ? 't-clickable' : ''}${open ? ' is-open' : ''}"
        ${staff ? `data-metric="${r.key}" tabindex="0" aria-expanded="${open}"` : ''}>
      <td class="t-name">${staff ? '<span class="t-caret" aria-hidden="true">›</span>' : ''}${esc(r.label)}</td>
      <td class="t-value ${value === null ? 'is-empty' : ''}${flagged ? ' v-flagged' : ''}"
        ${flagged ? 'title="Hors des bornes attendues : à vérifier"' : ''}>${fmt(value, r.digits)}${flagged ? ' ⚠' : ''}</td>
      <td class="t-unit">${esc(r.unit || '—')}</td>
      ${hasRef ? `<td class="t-ref">${fmt(ref, r.digits)}</td><td class="t-gap">${gap}</td>` : ''}
      ${rankCell}
    </tr>`;
    return row + (open ? squadPanel(r, cols) : '');
  }).join('');

  const stageLabel = STAGES.find(x => x.key === stage)?.label || '';
  const allOpen = staff && TEST_ROWS.every(r => expandedTests.has(r.key));

  box.innerHTML = `
    ${staff ? `<div class="test-toolbar">
      <span>Cliquez sur un test pour voir tout l’effectif.</span>
      <button type="button" class="btn btn-sm btn-ghost" id="btnToggleSquad">${allOpen ? 'Tout replier' : 'Tout déplier'}</button>
    </div>` : ''}
    <div class="test-table-wrap"><table class="test-table">
    <thead><tr>
      <th>Test</th><th>Valeur</th><th>Unité</th>
      ${hasRef ? `<th title="Moyenne des joueurs du club ayant passé ce test sur cette session">Moyenne club</th>
                  <th title="Différence entre le joueur et la moyenne du club">Écart</th>` : ''}
      ${staff ? '<th title="Place du joueur dans le club sur ce test">Rang</th>' : ''}
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>
  ${hasRef
    ? `<p class="text-muted table-note">
         <strong>Moyenne club</strong> : pour chaque test, moyenne des joueurs de ${staff ? 'votre' : 'ton'} club
         qui l’ont passé en <strong>${esc(stageLabel)}</strong> — le nombre varie donc d’un test à l’autre,
         et une moyenne n’est affichée qu’à partir de 3 joueurs. Les valeurs manifestement erronées en sont exclues.
         <strong>Écart</strong> : <span class="gap-up">vert = meilleur que la moyenne</span>,
         <span class="gap-down">rouge = moins bon</span> ; un sprint plus court et un VIFT plus élevé comptent tous deux comme un gain.
       </p>`
    : `<p class="text-muted table-note">Pas de moyenne club pour cette session : il faut au moins 3 joueurs testés.</p>`}`;

  if (!staff) return;
  const toggle = key => {
    expandedTests.has(key) ? expandedTests.delete(key) : expandedTests.add(key);
    renderTestSummary(currentTest());
  };
  box.querySelectorAll('tr[data-metric]').forEach(tr => {
    tr.addEventListener('click', e => { if (!e.target.closest('a')) toggle(tr.dataset.metric); });
    tr.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(tr.dataset.metric); }
    });
  });
  document.getElementById('btnToggleSquad')?.addEventListener('click', () => {
    expandedTests = allOpen ? new Set() : new Set(TEST_ROWS.map(r => r.key));
    renderTestSummary(currentTest());
  });
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

  renderHeroMetrics();

  if (!measurements.length) {
    if (chart) chart.innerHTML = '';
    wrap.innerHTML = `<div class="empty">Aucune mesure enregistrée.</div>`;
    return;
  }

  const ordered = orderedMeasurements();

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

function renderHeroMetrics() {
  const set = (id, field, digits, unit) => {
    const v = latestValue(field);
    document.getElementById(id).textContent = v ? `${fmt(v.value, digits)} ${unit}` : '—';
    const when = document.getElementById(`${id}When`);
    if (when) when.textContent = v ? v.month : '';
  };
  set('metricHeight', 'height_cm', 0, 'cm');
  set('metricWeight', 'weight_kg', 1, 'kg');
  set('metricBodyFat', 'body_fat_pct', 1, '%');
}

/* ------------------------------------------------------------
   Identité : à droite du nom, uniquement les champs renseignés.
   L'âge est calculé à partir de la date de naissance, jamais saisi.
   ------------------------------------------------------------ */
function frDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && y ? `${d}.${m}.${y}` : '';
}
function ageFrom(iso) {
  if (!iso) return null;
  const birth = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age >= 0 && age < 100 ? age : null;
}

function renderIdentity() {
  if (!player) return;
  const fullName = `${player.prenom || ''} ${player.nom || ''}`.trim();
  document.getElementById('playerName').textContent = fullName || 'Joueur';
  document.getElementById('playerInitials').textContent = initials(player);

  document.getElementById('playerMeta').textContent =
    [player.poste || 'Poste non renseigné', player.numero != null ? `#${player.numero}` : null]
      .filter(Boolean).join(' · ');

  const age = ageFrom(player.date_naissance);
  const facts = [
    player.nationalite || null,
    age !== null ? `${age} ans (${frDate(player.date_naissance)})` : null,
    player.pied_fort ? `Pied ${player.pied_fort === 'Les deux' ? 'droit et gauche' : player.pied_fort.toLowerCase()}` : null,
  ].filter(Boolean);
  document.getElementById('playerFacts').innerHTML = facts.map(f => `<span>${esc(f)}</span>`).join('');

  const club = ctxProfile?.clubs || null;
  const clubBox = document.getElementById('playerClub');
  const contract = player.contrat_fin ? `Contrat jusqu’au ${frDate(player.contrat_fin)}` : null;
  if (!club?.nom && !contract && !player.statut) {
    clubBox.innerHTML = '';
    clubBox.classList.add('hidden');
    return;
  }
  clubBox.classList.remove('hidden');
  const clubInitials = (club?.nom || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  clubBox.innerHTML = `
    ${clubLogoUrl
      ? `<img class="perf-club-logo" src="${esc(clubLogoUrl)}" alt="">`
      : `<div class="perf-club-logo perf-club-initials" style="${club?.color ? `border-color:${esc(club.color)}` : ''}">${esc(clubInitials)}</div>`}
    <div class="perf-club-text">
      <strong>${esc(club?.nom || 'Club')}</strong>
      ${contract ? `<span>${esc(contract)}</span>` : ''}
      ${player.statut ? `<span>${esc(player.statut)}</span>` : ''}
    </div>`;
}

async function loadClubLogo() {
  const path = ctxProfile?.clubs?.logo_path;
  if (!path) return;
  const { data } = await sb.storage.from('logos').createSignedUrl(path, 3600);
  clubLogoUrl = data?.signedUrl || null;
}

/* ------------------------------------------------------------
   Parcours : clubs précédents, du plus récent au plus ancien.
   ------------------------------------------------------------ */
function monthYear(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
}
function careerDuration(from, to) {
  if (!from) return '';
  const a = new Date(`${String(from).slice(0, 10)}T00:00:00`);
  const b = to ? new Date(`${String(to).slice(0, 10)}T00:00:00`) : new Date();
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
  if (!Number.isFinite(months) || months <= 0) return '';
  const y = Math.floor(months / 12), m = months % 12;
  return [y ? `${y} an${y > 1 ? 's' : ''}` : '', m ? `${m} mois` : ''].filter(Boolean).join(' ');
}

async function loadCareer() {
  const { data, error } = await sb.from('player_career').select('*').eq('player_id', player.id);
  if (error) {
    careerMissing = true;
    career = [];
    console.warn('Parcours indisponible :', error.message);
    return;
  }
  careerMissing = false;
  // En cours d'abord, puis du plus récent au plus ancien.
  career = (data || []).sort((a, b) =>
    (a.date_fin ? 1 : 0) - (b.date_fin ? 1 : 0)
    || String(b.date_debut || '').localeCompare(String(a.date_debut || ''))
    || (b.id - a.id));
}

function renderCareer() {
  const box = document.getElementById('careerList');
  if (!box) return;
  if (careerMissing) {
    box.innerHTML = `<div class="career-empty">Parcours indisponible.${isStaff()
      ? '<br>Exécutez <code>supabase/player_profile_career.sql</code> dans Supabase.' : ''}</div>`;
    return;
  }
  if (!career.length) {
    box.innerHTML = `<div class="career-empty">Aucun club renseigné.${canEditPlayer
      ? '<br>Ajoutez les clubs précédents avec « + Ajouter ».' : ''}</div>`;
    return;
  }
  box.innerHTML = `<ol class="career-list">${career.map(c => {
    const range = c.date_debut
      ? `${monthYear(c.date_debut)} – ${c.date_fin ? monthYear(c.date_fin) : 'aujourd’hui'}`
      : (c.date_fin ? `jusqu’à ${monthYear(c.date_fin)}` : 'Dates non renseignées');
    const duration = careerDuration(c.date_debut, c.date_fin);
    return `<li class="career-item${c.date_fin ? '' : ' is-current'}${canEditPlayer ? ' is-editable' : ''}"
        ${canEditPlayer ? `data-career="${c.id}" tabindex="0" role="button" aria-label="Modifier ${esc(c.club_name)}"` : ''}>
      <span class="career-dot" aria-hidden="true"></span>
      <div class="career-body">
        <strong>${esc(c.club_name)}</strong>
        ${c.categorie ? `<span class="career-cat">${esc(c.categorie)}</span>` : ''}
        <span class="career-range">${esc(range)}${duration ? ` · ${esc(duration)}` : ''}</span>
        ${c.notes ? `<p class="career-notes">${esc(c.notes)}</p>` : ''}
      </div>
    </li>`;
  }).join('')}</ol>`;

  box.querySelectorAll('[data-career]').forEach(el => {
    const open = () => openCareerModal(Number(el.dataset.career));
    el.addEventListener('click', open);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

/* <input type="month"> renvoie « AAAA-MM » ; on stocke le 1er du mois. */
function monthToDate(v) {
  if (!v) return null;
  if (/^\d{4}-\d{2}$/.test(v)) return `${v}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return null;
}

function openCareerModal(id = null) {
  if (!canEditPlayer) return;
  const c = id ? career.find(x => x.id === id) : null;
  document.getElementById('careerModalTitle').textContent = c ? 'Modifier le club' : 'Ajouter un club';
  document.getElementById('c-id').value = c?.id || '';
  document.getElementById('c-club').value = c?.club_name || '';
  document.getElementById('c-cat').value = c?.categorie || '';
  document.getElementById('c-debut').value = c?.date_debut ? String(c.date_debut).slice(0, 7) : '';
  document.getElementById('c-fin').value = c?.date_fin ? String(c.date_fin).slice(0, 7) : '';
  document.getElementById('c-notes').value = c?.notes || '';
  document.getElementById('btnDeleteCareer').classList.toggle('hidden', !c);
  openPerfModal('careerModal');
  setTimeout(() => document.getElementById('c-club').focus(), 50);
}

async function saveCareer() {
  if (!canEditPlayer) return;
  const id = Number(document.getElementById('c-id').value) || null;
  const club_name = document.getElementById('c-club').value.trim();
  if (!club_name) return notify('Le nom du club est obligatoire.', 'error');
  const date_debut = monthToDate(document.getElementById('c-debut').value);
  const date_fin = monthToDate(document.getElementById('c-fin').value);
  if (date_debut && date_fin && date_fin < date_debut) {
    return notify('La date de fin précède la date de début.', 'error');
  }
  const body = {
    club_name,
    categorie: document.getElementById('c-cat').value.trim() || null,
    date_debut, date_fin,
    notes: document.getElementById('c-notes').value.trim() || null,
  };
  const { error } = id
    ? await sb.from('player_career').update(body).eq('id', id)
    : await sb.from('player_career').insert({ ...body, club_id: player.club_id, player_id: player.id, created_by: ctxProfile.id });
  if (error) return notify(error.message, 'error');
  closePerfModal('careerModal');
  notify(id ? 'Club mis à jour.' : 'Club ajouté au parcours.', 'success');
  await loadCareer();
  renderCareer();
}

async function deleteCareer() {
  const id = Number(document.getElementById('c-id').value) || null;
  if (!id || !canEditPlayer || !confirm('Retirer ce club du parcours ?')) return;
  const { error } = await sb.from('player_career').delete().eq('id', id);
  if (error) return notify(error.message, 'error');
  closePerfModal('careerModal');
  notify('Club retiré du parcours.', 'success');
  await loadCareer();
  renderCareer();
}

/* Moyennes du club pour la session affichée. La RPC ne renvoie que des
   agrégats : elle est donc utilisable aussi par un compte joueur. */
/* Une seule ligne de tests par joueur et par session : la plus récente.
   Sans ça, un joueur saisi deux fois pèserait double dans la moyenne. */
function latestPerPlayer(rows) {
  const byPlayer = new Map();
  for (const r of rows) {
    const prev = byPlayer.get(r.player_id);
    if (!prev || (r.id || 0) > (prev.id || 0)) byPlayer.set(r.player_id, r);
  }
  return [...byPlayer.values()];
}

/* Références du club pour la session affichée.
   Le staff lit les lignes de son club et calcule côté client, avec les
   mêmes bornes que la page Comparaison : une valeur hors bornes est
   exclue de la moyenne au lieu de la tirer.
   Un compte joueur n'a pas le droit de lire les lignes des autres : il
   passe par la RPC club_test_averages(), qui ne renvoie que des
   agrégats et applique les mêmes bornes côté base. */
async function loadClubAverages() {
  const metricKeys = [...PERF_METRICS.map(m => m.key), ...SCORE_LABELS.map(([k]) => k)];

  if (isStaff() && !squadLoadFailed) {
    squadTests = latestPerPlayer(clubTestsAll.filter(t => t.stage === stage));
    if (!squadTests.length) { clubAverages = null; return; }
    clubAverages = { n_players: squadTests.length };
    for (const key of metricKeys) clubAverages[key] = perfAverage(squadTests, key).value;
    return;
  }

  squadTests = [];
  const { data, error } = await sb.rpc('club_test_averages', { p_stage: stage });
  if (error) {
    console.warn('club_test_averages indisponible :', error.message);
    clubAverages = null;
    return;
  }
  clubAverages = Array.isArray(data) ? (data[0] || null) : data;
}

/* Effectif et tests du club, chargés une fois pour toutes les sessions.
   Réservé au staff : un compte joueur n'a pas le droit de lire les
   lignes des autres et passe par la RPC d'agrégats. */
async function loadSquad() {
  clubPlayers = []; clubTestsAll = []; squadLoadFailed = false;
  if (!isStaff() || !player) return;
  const keys = [...PERF_METRICS.map(m => m.key), ...SCORE_LABELS.map(([k]) => k)];
  const [pr, tr] = await Promise.all([
    sb.from('players').select('id, nom, prenom, numero').eq('club_id', player.club_id),
    sb.from('player_physical_tests').select('*').eq('club_id', player.club_id),
  ]);
  if (pr.error || tr.error) {
    squadLoadFailed = true;
    console.warn('Effectif du club indisponible :', (pr.error || tr.error).message);
    return;
  }
  clubPlayers = pr.data || [];
  // Moyennes du club : même saison que celle affichée pour le joueur.
  clubTestsAll = (tr.data || []).filter(t => !currentSeason || t.season_key === currentSeason);
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
  canEditPlayer = isStaff();
  document.getElementById('perfRoleLabel').textContent =
    ctxProfile.role === 'joueur' ? 'Espace joueur' : 'Staff · dossier individuel';
  document.querySelectorAll('.perf-editor-only').forEach(el => el.classList.toggle('hidden', !canEditPerformance));
  document.querySelectorAll('.perf-staff-only').forEach(el => el.classList.toggle('hidden', !isStaff()));

  if (ctxProfile.role === 'joueur') {
    document.getElementById('backPlayers').classList.add('hidden');
    document.getElementById('videoPlayerLink').href = 'mes-videos.html';
    document.getElementById('videoPlayerLink').textContent = 'Mes vidéos';
  } else {
    document.getElementById('videoPlayerLink').href = `videos.html?player=${playerId}`;
  }

  // Les colonnes d'identité n'existent qu'après player_profile_career.sql :
  // leur absence ne doit pas empêcher d'ouvrir la fiche.
  let { data: p, error } = await sb.from('players')
    .select(`${PLAYER_BASE_COLS}, ${PLAYER_IDENTITY_COLS}`)
    .eq('id', playerId).maybeSingle();
  identityMissing = false;
  if (error) {
    identityMissing = true;
    ({ data: p, error } = await sb.from('players').select(PLAYER_BASE_COLS).eq('id', playerId).maybeSingle());
  }
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
  setSeasonData(mRes.data || [], tRes.data || []);
  notes = nRes.data || [];
  media = mediaRes.data || [];

  await Promise.all([loadClubLogo(), loadCareer(), loadSquad()]);
  renderIdentity();
  renderCareer();

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
  renderRadar();
  renderMeasurements();
  await signMedia();
  renderNotes();
}

/* Édition de la fiche joueur depuis le dossier Performance.
   Les mêmes champs que la page Joueurs, pour ne pas avoir à en sortir. */
function openPlayerEdit() {
  if (!canEditPlayer || !player) return;
  const set = (id, v) => { document.getElementById(id).value = v ?? ''; };
  set('pe-prenom', player.prenom);
  set('pe-nom', player.nom);
  set('pe-numero', player.numero);
  set('pe-poste', player.poste);
  set('pe-naissance', player.date_naissance ? String(player.date_naissance).slice(0, 10) : '');
  set('pe-nationalite', player.nationalite);
  set('pe-pied', player.pied_fort);
  set('pe-statut', player.statut);
  set('pe-contrat', player.contrat_fin ? String(player.contrat_fin).slice(0, 10) : '');
  // Sans la migration, ces champs ne peuvent pas être enregistrés.
  ['pe-naissance','pe-nationalite','pe-pied','pe-statut','pe-contrat']
    .forEach(id => { document.getElementById(id).disabled = identityMissing; });
  openPerfModal('playerEditModal');
}

async function savePlayerEdit() {
  if (!canEditPlayer || !player) return;
  const val = id => document.getElementById(id).value.trim();
  const nom = val('pe-nom');
  if (!nom) return notify('Le nom est obligatoire.', 'error');

  const numeroRaw = val('pe-numero');
  const body = {
    nom,
    prenom: val('pe-prenom') || null,
    numero: numeroRaw !== '' ? Number(numeroRaw) : null,
    poste: val('pe-poste') || null,
  };
  if (!identityMissing) {
    Object.assign(body, {
      date_naissance: val('pe-naissance') || null,
      nationalite: val('pe-nationalite') || null,
      pied_fort: val('pe-pied') || null,
      statut: val('pe-statut') || null,
      contrat_fin: val('pe-contrat') || null,
    });
  }

  const { error } = await sb.from('players').update(body).eq('id', player.id);
  if (error) return notify(error.message, 'error');

  Object.assign(player, body);
  closePerfModal('playerEditModal');
  notify(identityMissing
    ? 'Fiche mise à jour. Naissance, nationalité et contrat nécessitent la migration player_profile_career.sql.'
    : 'Fiche joueur mise à jour.', identityMissing ? 'info' : 'success');
  renderIdentity();
}

/* Date du jour en heure locale. toISOString() passe en UTC : à Paris, entre
   minuit et 2 h, il renverrait la veille — et le 1er du mois, le mois d'avant. */
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* Mois de la saison correspondant à une date (juillet n'en fait pas partie). */
function seasonMonthOf(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return ({ 7:'Août', 8:'Septembre', 9:'Octobre', 10:'Novembre', 11:'Décembre',
            0:'Janvier', 1:'Février', 2:'Mars', 3:'Avril', 4:'Mai', 5:'Juin' })[d.getMonth()] || null;
}

/* La fenêtre s'ouvre sur la date du jour : c'était « Août » par défaut, si
   bien qu'une saisie non corrigée se rangeait avant les mesures de
   l'Excel et n'apparaissait jamais dans l'en-tête. */
function openMeasureModal() {
  if (!canEditPerformance) return;
  const today = localToday();
  document.getElementById('m-date').value = today;
  const month = seasonMonthOf(today);
  if (month) document.getElementById('m-month').value = month;
  ['m-height','m-weight','m-fat'].forEach(id => { document.getElementById(id).value = ''; });
  openPerfModal('measureModal');
}

function openTestModal() {
  if (!canEditPerformance) return;
  document.getElementById('manualStage').value = stage;
  document.getElementById('manualTestDate').value = localToday();
  ['t-sprint10','t-505g','t-505d','t-sprint40','t-vift','t-shirado','t-sorensen']
    .forEach(id => { document.getElementById(id).value = ''; });
  openPerfModal('testModal');
}

/* Une saison à la fois : mois et sessions se répètent d'une saison à
   l'autre, les mélanger ferait réapparaître des doublons apparents.
   ponytail: la saison la plus récente seulement ; ajouter un sélecteur
   de saison quand l'historique en contiendra plusieurs. */
function setSeasonData(allMeasures, allTests) {
  currentSeason = latestSeasonOf([...allMeasures, ...allTests]);
  const inSeason = r => !currentSeason || r.season_key === currentSeason;
  measurements = allMeasures.filter(inSeason);
  tests = allTests.filter(inSeason);
  const sub = document.querySelector('.fp-fm-history-card .section-head p');
  if (sub) sub.textContent = currentSeason
    ? `Historique des mesures — saison ${currentSeason}.`
    : 'Historique des mesures du préparateur.';
}

/* La clé d'unicité (joueur, saison, période) n'existe qu'après la
   migration : sans elle, l'écriture échouerait avec un message SQL
   incompréhensible, ou recréerait des doublons. */
function periodKeyError(error) {
  return /no unique or exclusion constraint|season_key/i.test(error?.message || '')
    ? 'Base à mettre à jour : exécutez supabase/performance_one_row_per_period.sql dans Supabase.'
    : error?.message;
}

/* Seules les valeurs saisies sont envoyées : un champ laissé vide ne doit
   pas effacer la valeur que l'Excel a déjà fournie pour ce mois. */
function withoutEmpty(body) {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null && v !== undefined && v !== ''));
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
    created_by: ctxProfile.id,
  };
  if ([body.height_cm,body.weight_kg,body.body_fat_pct].every(v=>v===null)) return notify('Renseigne au moins une donnée physique.','error');
  body.season_key = seasonKeyFor(body.measured_at, clubSeasonStartMonth(ctxProfile?.clubs));
  const { error } = await sb.from('player_physical_measurements')
    .upsert(withoutEmpty(body), { onConflict:'club_id,player_id,season_key,month_label' });
  if (error) return notify(periodKeyError(error),'error');
  notify('Mesure enregistrée.','success');
  closePerfModal('measureModal');
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
    created_by: ctxProfile.id,
  };
  const TEST_FIELDS = ['sprint10_sec','five05_left_sec','five05_right_sec','sprint40_sec','vift_kmh','shirado_sec','sorensen_sec'];
  if (TEST_FIELDS.every(k => body[k] === null)) return notify('Renseigne au moins un test.','error');
  body.season_key = seasonKeyFor(body.tested_at, clubSeasonStartMonth(ctxProfile?.clubs));
  const { error } = await sb.from('player_physical_tests')
    .upsert(withoutEmpty(body), { onConflict:'club_id,player_id,season_key,stage' });
  if (error) return notify(periodKeyError(error),'error');
  notify('Session de tests enregistrée.','success');
  closePerfModal('testModal');
  stage = body.stage;
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
  setSeasonData(mRes.data||[], tRes.data||[]);
  notes=nRes.data||[];
  media=mediaRes.data||[];
  if (pRes.data) player.photo_path=pRes.data.photo_path;
  await loadSquad();
  const availableStages=STAGES.filter(s=>tests.some(t=>t.stage===s.key)).map(s=>s.key);
  if (!availableStages.includes(stage)) stage=availableStages[0]||'pre';
  document.getElementById('stageSelect').value=stage;
  await loadClubAverages();
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

document.querySelectorAll('[data-close]').forEach(btn=>{
  btn.addEventListener('click',()=>closePerfModal(btn.dataset.close));
});
document.getElementById('stageSelect').addEventListener('change', async e => {
  stage = e.target.value;
  await loadClubAverages();
  renderRadar();
  renderMeasurements();
});
document.getElementById('btnAddMeasurement').addEventListener('click',openMeasureModal);
document.getElementById('btnAddTests').addEventListener('click',openTestModal);
document.getElementById('m-date').addEventListener('change',e=>{
  const month = seasonMonthOf(e.target.value);
  if (month) document.getElementById('m-month').value = month;
});
document.getElementById('btnAddCareer').addEventListener('click',()=>openCareerModal());
document.getElementById('btnSaveCareer').addEventListener('click',saveCareer);
document.getElementById('btnDeleteCareer').addEventListener('click',deleteCareer);
document.getElementById('btnEditPlayer').addEventListener('click',openPlayerEdit);
document.getElementById('btnSavePlayer').addEventListener('click',savePlayerEdit);
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
document.getElementById('btnImportExcel').addEventListener('click',()=>ExcelImport.open({
  clubId: player.club_id,
  seasonStartMonth: clubSeasonStartMonth(ctxProfile?.clubs),
  userId: ctxProfile.id,
  focusPlayerId: player.id,
  onDone: reloadData,
}));

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
