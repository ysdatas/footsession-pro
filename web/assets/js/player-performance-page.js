/* LMFC Performance — player-performance-page.js
   La page d'un joueur.
   - Staff : la fiche unique, en trois onglets sans changer de page
     (?tab=fiche|performance|videos) :
       Fiche        parcours (modifiable sur place), objectifs et
                    préventions, programme terrain (points : vidéo,
                    description, exercices) ;
       Performance  radar, tests, suivi physique ;
       Vidéos       les vidéos du joueur et leurs séquences
                    (player-videos.js, admin et coach).
     player.html renvoie ici.
   - Joueur (« Ma performance ») : performance, parcours, objectifs,
     sans onglets. */

let ctxProfile = null;
let player = null;
let measurements = [];
let tests = [];
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
let canEditPlayer = false; // identité : mêmes droits que la fiche joueur
let canEditPlans = false;  // objectifs, préventions, points : admin, coach, prépa
let compareId = null;      // joueur superposé sur le radar (staff)
let expandedTests = new Set();
let clubLogoUrl = null;
let currentSeason = null;  // saison affichée : la plus récente du joueur

/* Rôles du staff ayant accès à la performance (can_view_performance()
   côté base) : admin, coach, préparateur physique. Les données physiques
   ne sont modifiées que par l'admin et le préparateur (is_performance_editor()). */
const PERF_STAFF_ROLES = ['admin', 'coach', 'prepa'];
const isStaff = () => PERF_STAFF_ROLES.includes(ctxProfile?.role);

/* Indicateurs internes au staff : jamais montrés au joueur (et jamais
   renvoyés par my_physical_tests() côté base). */
/* Ce que voit le joueur (players.hidden_sections, lmfc_v7/v8) : un bloc
   entier ('radar', 'tests', 'suivi') ou un élément précis
   ('test:sprint10_sec', 'mesure:weight_kg'). Le staff voit tout. */
const MEASURE_ITEMS = [['height_cm', 'Taille'], ['weight_kg', 'Poids'], ['body_fat_pct', 'Masse grasse']];
const hiddenForPlayer = (key) => ctxProfile?.role === 'joueur' && (player?.hidden_sections || []).includes(key);
const measureShown = (k) => !hiddenForPlayer('suivi') && !hiddenForPlayer(`mesure:${k}`);
const visibleTestRows = () => isStaff() ? PERF_METRICS : PLAYER_METRICS.filter(m => !hiddenForPlayer(`test:${m.key}`));

/* Référence : l'équipe du joueur quand il en a une, sinon le club. */
const refLabel = () => (player?.team_id ? 'Moyenne équipe' : 'Moyenne club');


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

function radarSvg(test, reference = clubAverages, compare = null) {
  const { W, H, cx, cy, R } = RADAR;
  const values = SCORE_LABELS.map(([key]) => scoreValue(test, key));
  const refs = SCORE_LABELS.map(([key]) => scoreValue(reference, key));
  const others = compare ? SCORE_LABELS.map(([key]) => scoreValue(compare, key)) : null;

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
  if (others?.some(v => v !== null)) svg += radarSeries(others, 'radar-compare');
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

/* Ligne de tests du joueur comparé, pour la session affichée. */
function compareTest() {
  if (!compareId || !isStaff()) return null;
  return latestPerPlayer(clubTestsAll.filter(t => t.player_id === compareId && t.stage === stage))[0] || null;
}
function compareName() {
  const p = clubPlayers.find(x => x.id === compareId);
  return p ? `${p.prenom || ''} ${p.nom || ''}`.trim() : '';
}

/* Liste « Comparer avec » : les joueurs du même groupe, ceux sans test
   sur la session affichée restent visibles mais inactifs. */
function renderCompareSelect() {
  const select = document.getElementById('compareSelect');
  if (!select) return;
  if (!isStaff() || squadLoadFailed || clubPlayers.length < 2) { select.classList.add('hidden'); return; }
  const tested = new Set(clubTestsAll.filter(t => t.stage === stage
    && SCORE_LABELS.some(([k]) => scoreValue(t, k) !== null)).map(t => t.player_id));
  if (compareId && !tested.has(compareId)) compareId = null;
  const others = clubPlayers.filter(p => p.id !== player.id)
    .sort((a, b) => `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, 'fr'));
  select.innerHTML = '<option value="">Comparer avec…</option>' + others.map(p =>
    `<option value="${p.id}" ${tested.has(p.id) ? '' : 'disabled'} ${p.id === compareId ? 'selected' : ''}>${
      esc(`${p.prenom || ''} ${p.nom || ''}`.trim())}${tested.has(p.id) ? '' : ' (pas de test)'}</option>`).join('');
  select.classList.remove('hidden');
}

function renderRadar() {
  const test = currentTest();
  const other = compareTest();
  const wrap = document.getElementById('radarWrap');
  const hasRef = SCORE_LABELS.some(([key]) => scoreValue(clubAverages, key) !== null);

  renderCompareSelect();
  document.getElementById('radarLegend').innerHTML = `
    <span class="legend-item"><i class="legend-dot legend-player"></i>${esc(playerShortName())}</span>
    ${other ? `<span class="legend-item"><i class="legend-dot legend-compare"></i>${esc(compareName())}</span>` : ''}
    ${hasRef
      ? `<span class="legend-item"><i class="legend-dot legend-ref"></i>${refLabel()}${
          clubAverages?.n_players ? ` (${clubAverages.n_players})` : ''}</span>`
      : ''}`;

  wrap.innerHTML = test
    ? radarSvg(test, clubAverages, other)
    : `<div class="empty">Aucun test pour cette session.</div>`;

  document.getElementById('scoreCards').innerHTML = SCORE_LABELS.map(([key, label]) => {
    const v = scoreValue(test, key);
    const cv = other ? scoreValue(other, key) : null;
    return `<div class="score-card tone-${scoreTone(v)}">
      <span>${esc(label)}</span>
      <strong>${v === null ? '—' : fmt(v, 1)}<small>/10</small></strong>
      ${other ? `<em class="score-vs" title="${esc(compareName())}">${cv === null ? '—' : fmt(cv, 1)}</em>` : ''}
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
    .map(e => ({ ...e, rank: perfRankKey(m.key, e.value) }))
    .sort((a, b) => a.rank - b.rank || a.value - b.value);
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
  const keys = ranked.map(e => e.rank);
  const lo = Math.min(...keys), hi = Math.max(...keys);
  // Barre : position dans l'amplitude du groupe, le meilleur à 100 %.
  const width = v => {
    const k = perfRankKey(m.key, v);
    if (!keys.length || hi === lo || k === null) return 100;
    return Math.round(12 + ((hi - k) / (hi - lo)) * 88);
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
        ${m.key === 'core_ratio' ? '<div class="squad-hint">Classement : du plus proche au plus éloigné de la zone idéale 0,7 – 0,8.</div>' : ''}
        ${m.key === 'five05_asymmetry_pct' ? '<div class="squad-hint">Classement : de la plus faible à la plus forte asymétrie.</div>' : ''}
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
          <span class="sq-bar sq-bar-flag">Valeur à vérifier</span>
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
  const TEST_ROWS = visibleTestRows();
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
      rankCell = `<td class="t-rank">${pos >= 0 ? `${pos + 1}<small>/${ranked.length}</small>` : '—'}</td>`;
    }
    const open = staff && expandedTests.has(r.key);
    const row = `<tr class="${staff ? 't-clickable' : ''}${open ? ' is-open' : ''}"
        ${staff ? `data-metric="${r.key}" tabindex="0" aria-expanded="${open}"` : ''}>
      <td class="t-name">${staff ? '<span class="t-caret" aria-hidden="true">›</span>' : ''}${esc(r.label)}</td>
      <td class="t-value ${value === null ? 'is-empty' : ''}${flagged ? ' v-flagged' : ''}"
        ${flagged ? 'title="Hors des bornes attendues : à vérifier"' : ''}>${fmt(value, r.digits)}${value !== null && r.unit ? `<small class="t-u-inline">${esc(r.unit)}</small>` : ''}${flagged ? ' ⚠' : ''}</td>
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
      ${hasRef ? `<th title="Moyenne des joueurs du groupe ayant passé ce test sur cette session">${refLabel()}</th>
                  <th title="Différence entre le joueur et la moyenne du groupe">Écart</th>` : ''}
      ${staff ? '<th title="Place du joueur dans le groupe sur ce test">Rang</th>' : ''}
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>
  ${hasRef
    ? `<details class="table-note">
         <summary><span><strong>Écart</strong> : <span class="gap-up">vert = mieux que la moyenne</span>, <span class="gap-down">rouge = moins bien</span>.</span>
           <span class="tn-more">Voir le détail</span></summary>
         <p><strong>${refLabel()}</strong> : pour chaque test, moyenne des joueurs de ${staff ? 'votre' : 'ton'} ${player?.team_id ? 'équipe' : 'club'}
         qui l’ont passé en <strong>${esc(stageLabel)}</strong> — le nombre varie donc d’un test à l’autre,
         et une moyenne n’est affichée qu’à partir de 3 joueurs. Les valeurs manifestement erronées en sont exclues.
         Un sprint plus court et un VIFT plus élevé comptent tous deux comme un gain.</p>
       </details>`
    : `<p class="text-muted table-note">Pas de moyenne pour cette session : il faut au moins 3 joueurs testés.</p>`}`;

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
   Poids et masse grasse n'ont pas du tout le même ordre de grandeur :
   sur une échelle commune, l'un était plat en haut et l'autre écrasé
   en bas. Chaque série a donc sa propre bande et sa propre échelle, et
   chaque point porte sa valeur. Un mois sans mesure n'est pas
   interpolé — le trait s'interrompt.
   ------------------------------------------------------------ */
const TREND_SERIES = [
  { key: 'weight_kg',    label: 'Poids',        unit: 'kg', cls: 'weight', digits: 1 },
  { key: 'body_fat_pct', label: 'Masse grasse', unit: '%',  cls: 'fat',    digits: 1 },
];

/* W = largeur réelle du bloc, en pixels : le graphique est dessiné à
   l'échelle 1, les textes gardent leur taille quelle que soit la largeur
   (une largeur fixe agrandie à l'écran les faisait énormes). */
const SHORT_MONTHS = { Janvier: 'Janv.', Février: 'Févr.', Juillet: 'Juil.', Septembre: 'Sept.', Octobre: 'Oct.', Novembre: 'Nov.', Décembre: 'Déc.' };
const shortMonth = (m) => SHORT_MONTHS[m] || m || '';

function trendChartSvg(rows, W) {
  const series = TREND_SERIES.filter(s => measureShown(s.key) && rows.some(r => num(r[s.key]) !== null));
  if (!series.length || !W) return '';
  const padL = 124, padR = 28, bandH = 78, gap = 18, padT = 16, axisH = 24;
  const H = padT + series.length * bandH + (series.length - 1) * gap + axisH;
  const innerW = W - padL - padR;
  const x = i => padL + (rows.length === 1 ? innerW / 2 : (i * innerW) / (rows.length - 1));

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution du poids et de la masse grasse">`;
  series.forEach((s, k) => {
    const top = padT + k * (bandH + gap), bottom = top + bandH - 14;
    const values = rows.map(r => num(r[s.key]));
    const known = values.filter(v => v !== null);
    const lo = Math.min(...known), hi = Math.max(...known);
    const span = Math.max(hi - lo, s.key === 'weight_kg' ? 2 : 1);
    const mid = (hi + lo) / 2;
    const y = v => bottom - ((v - (mid - span / 2)) / span) * (bottom - top - 10);

    svg += `<line x1="${padL}" y1="${bottom + 8}" x2="${W - padR}" y2="${bottom + 8}" class="trend-grid"/>`;
    svg += `<text x="12" y="${top + bandH / 2 - 2}" class="trend-name ${s.cls}">${esc(s.label)}</text>`;
    svg += `<text x="12" y="${top + bandH / 2 + 13}" class="trend-tick">${esc(s.unit)}</text>`;
    let prev = null;
    values.forEach((v, i) => {
      if (v === null) { prev = null; return; }
      const px = x(i), py = y(v);
      if (prev) svg += `<line x1="${prev[0]}" y1="${prev[1]}" x2="${px}" y2="${py}" class="trend-line ${s.cls}"/>`;
      svg += `<circle cx="${px}" cy="${py}" r="4" class="trend-dot ${s.cls}"/>`;
      svg += `<text x="${px}" y="${py - 9}" class="trend-value" text-anchor="middle">${fmt(v, s.digits)}</text>`;
      prev = [px, py];
    });
  });
  rows.forEach((r, i) => {
    svg += `<text x="${x(i)}" y="${H - 6}" class="trend-tick" text-anchor="middle">${esc(shortMonth(r.month_label))}</text>`;
  });
  return svg + '</svg>';
}

let trendWidth = 0, trendObserver = null;
function drawTrend() {
  const chart = document.getElementById('trendChart');
  if (!chart) return;
  // Redessiné quand sa largeur change (fenêtre, onglet Performance ouvert).
  if (!trendObserver && typeof ResizeObserver === 'function') {
    trendObserver = new ResizeObserver(() => { if (Math.round(chart.clientWidth) !== trendWidth) drawTrend(); });
    trendObserver.observe(chart);
  }
  trendWidth = Math.round(chart.clientWidth);
  chart.innerHTML = measurements.length ? trendChartSvg(orderedMeasurements(), trendWidth) : '';
}

function renderMeasurements() {
  const wrap = document.getElementById('measurementHistory');
  renderHeroMetrics();

  drawTrend();
  if (!measurements.length) {
    wrap.innerHTML = `<div class="empty">Aucune mesure enregistrée.</div>`;
    return;
  }

  const ordered = orderedMeasurements();
  // La taille n'est dans le tableau que pour le staff (le joueur la voit en tête de page).
  const cols = [['height_cm', 'Taille', 0, 'cm'], ['weight_kg', 'Poids', 1, 'kg'], ['body_fat_pct', 'MG', 1, '%']]
    .filter(([k]) => (k !== 'height_cm' || isStaff()) && measureShown(k));
  const grid = `style="grid-template-columns:1.2fr repeat(${cols.length}, 1fr)"`;

  wrap.innerHTML = `<div class="measurement-table">
    <div class="measurement-row header" ${grid}><span>Mois</span>${cols.map(([, label]) => `<span>${label}</span>`).join('')}</div>
    ${ordered.map(m => `<div class="measurement-row" ${grid}>
      <span>${esc(m.month_label || '—')}</span>
      ${cols.map(([k, , d, u]) => `<span>${m[k] != null ? `${fmt(m[k], d)} ${u}` : '—'}</span>`).join('')}
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
  document.title = `LMFC Performance — ${ctxProfile?.role === 'joueur' ? 'Ma performance' : fullName || 'Joueur'}`;
  document.getElementById('playerInitials').textContent = initials(player);

  const teams = typeof teamName === 'function'
    ? [player.team_id, ...(player.other_team_ids || [])].map(teamName).filter(Boolean).join(' / ') : null;
  document.getElementById('playerMeta').textContent = [player.poste, teams].filter(Boolean).join(' · ');

  const age = ageFrom(player.date_naissance);
  const facts = [
    age !== null ? `${age} ans (${frDate(player.date_naissance)})` : null,
    player.pied_fort ? `Pied ${player.pied_fort === 'Les deux' ? 'droit et gauche' : player.pied_fort.toLowerCase()}` : null,
    player.statut || null,
  ].filter(Boolean);
  document.getElementById('playerFacts').innerHTML = facts.map(f => `<span>${esc(f)}</span>`).join('');

  const club = ctxProfile?.clubs || null;
  const clubBox = document.getElementById('playerClub');
  if (!club?.nom) {
    clubBox.innerHTML = '';
    clubBox.classList.add('hidden');
    return;
  }
  clubBox.classList.remove('hidden');
  // Même structure que Taille / Poids / Masse grasse (libellé, valeur,
  // ligne du bas) : les valeurs des quatre tuiles tombent à la même hauteur.
  clubBox.innerHTML = `<span>Club</span>
    <strong class="perf-club-row">
      ${clubLogoUrl ? `<img class="perf-club-logo" src="${esc(clubLogoUrl)}" alt="">` : ''}
      <em class="perf-club-name" title="${esc(club.nom)}">${esc(club.nom)}</em>
    </strong>
    <small></small>`;
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
        <span class="career-range">${esc(capFirst(range))}${duration ? ` · ${esc(duration)}` : ''}</span>
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
  if (!id || !canEditPlayer || !confirm(`Retirer ce club du parcours ?${await trashNote()}`)) return;
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
  // Groupe de référence : l'équipe du joueur (comme le calcul des notes /10).
  let playersQuery = sb.from('players').select('id, nom, prenom, numero').eq('club_id', player.club_id);
  if (player.team_id) playersQuery = playersQuery.eq('team_id', player.team_id);
  const [pr, tr] = await Promise.all([
    playersQuery,
    sb.from('player_physical_tests').select('*').eq('club_id', player.club_id),
  ]);
  if (pr.error || tr.error) {
    squadLoadFailed = true;
    console.warn('Effectif du club indisponible :', (pr.error || tr.error).message);
    return;
  }
  clubPlayers = pr.data || [];
  const inGroup = new Set(clubPlayers.map(p => p.id));
  // Moyennes du groupe : même saison que celle affichée pour le joueur.
  clubTestsAll = (tr.data || []).filter(t => inGroup.has(t.player_id)
    && (!currentSeason || t.season_key === currentSeason));
}

/* Mesures et tests du joueur affiché.
   Un compte joueur ne lit plus les tables : il passe par des RPC qui ne
   renvoient que les colonnes qui lui sont destinées (pas d'asymétrie,
   de plis cutanés ni de ratio). Tant que la migration n'est pas passée,
   la RPC n'existe pas et l'ancienne lecture directe prend le relais. */
async function fetchPhysical() {
  if (isStaff()) {
    return Promise.all([
      sb.from('player_physical_measurements').select('*').eq('player_id', player.id).order('id'),
      sb.from('player_physical_tests').select('*').eq('player_id', player.id).order('id'),
    ]);
  }
  const viaRpc = async (fn, table) => {
    const res = await sb.rpc(fn);
    if (!res.error) return res;
    console.warn(`${fn} indisponible, lecture directe :`, res.error.message);
    return sb.from(table).select('*').eq('player_id', player.id).order('id');
  };
  return Promise.all([
    viaRpc('my_physical_measurements', 'player_physical_measurements'),
    viaRpc('my_physical_tests', 'player_physical_tests'),
  ]);
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
    // renvoyer silencieusement sur index.html masquait la vraie cause.
    if (linkErr) return showLoadError('lecture de ta fiche joueur', linkErr);
    if (!linked) {
      window.location.href = 'index.html';
      return;
    }
    playerId = linked.id;
  }
  if (!playerId) {
    return showLoadError('identification du joueur',
      { message: 'Aucun joueur ciblé (paramètre ?id= absent et compte non lié à une fiche).' });
  }

  canEditPerformance = canEditPerformanceData(ctxProfile.role);
  canEditPlans = canManagePlans(ctxProfile.role);
  canEditPlayer = canEdit(ctxProfile.role);
  document.getElementById('perfRoleLabel').textContent = ctxProfile.role === 'joueur' ? 'Espace joueur'
    : canEditPerformance ? 'Dossier individuel' : 'Dossier individuel · consultation (données physiques : préparateur)';
  document.getElementById('perfKicker').textContent = ctxProfile.role === 'joueur'
    ? 'Ma performance' : 'Fiche joueur';
  document.querySelectorAll('.perf-editor-only').forEach(el => el.classList.toggle('hidden', !canEditPerformance));
  document.querySelectorAll('.perf-plans-only').forEach(el => el.classList.toggle('hidden', !canEditPlans));
  document.querySelectorAll('.perf-staff-only').forEach(el => el.classList.toggle('hidden', !isStaff()));

  const back = document.getElementById('backPlayers');
  if (ctxProfile.role === 'joueur') {
    // Même coque que sur toutes les pages du joueur (barre latérale, onglets).
    document.querySelector('.perf-topbar').classList.add('hidden');   // ni retour ni actions staff
    document.getElementById('pfPanel-videos').hidden = true;           // ses vidéos : page « Mes vidéos »
    document.querySelector('.pf-career').classList.add('hidden');      // le parcours est une information du staff
    renderPlayerShell();
  } else {
    document.getElementById('logoutLink')?.addEventListener('click', (e) => { e.preventDefault(); logout(); });
    back.href = 'players.html';
    back.dataset.back = '';   // retour à la liste telle qu'on l'a laissée (app.js)
    back.textContent = '← Joueurs';
    setupTabs();
  }
  const canPhoto = canChangePlayerPhoto(ctxProfile.role);
  const avatar = document.getElementById('playerAvatar');
  avatar.disabled = !canPhoto;
  avatar.classList.toggle('is-editable', canPhoto);

  // Les colonnes d'identité n'existent qu'après player_profile_career.sql :
  // leur absence ne doit pas empêcher d'ouvrir la fiche.
  // select('*') : les colonnes d'identité, de ligne et d'équipe n'existent
  // qu'après leurs migrations ; une liste explicite ferait échouer la page.
  let { data: p, error } = await sb.from('players').select('*').eq('id', playerId).maybeSingle();
  identityMissing = !!p && !('date_naissance' in p);
  if (error) return showLoadError('lecture de la fiche joueur', error);
  if (!p) {
    return showLoadError('lecture de la fiche joueur',
      { message: `Aucune fiche lisible pour l'id ${playerId}. Si tu es joueur, vérifie que ton compte est bien associé à une fiche (policy players_read_self).` });
  }
  player = p;
  if (ctxProfile.role === 'joueur') { setPlayerShellUser(player); applyPlayerVisibility(); }
  else setupVisibilityToggles();

  // Staff : programme terrain (points forts, axes, exercices) dans l'onglet Fiche.
  // Le joueur a sa page « Objectifs & préventions » pour ça.
  const staffProgram = isStaff();
  document.getElementById('programCard').classList.toggle('hidden', !staffProgram);
  const lists = { objective: 'objectiveList', prevention: 'preventionList',
    ...(staffProgram ? { strength: 'strengthList', improvement: 'improvementList' } : {}) };
  const [[mRes, tRes], notesError] = await Promise.all([
    fetchPhysical(),
    initNotes({ player, canEdit: canEditPlans, userId: ctxProfile.id, lists, onError: (m) => notify(m, 'error'),
      canUploadVideo: canManageVideos(ctxProfile.role),
      program: staffProgram ? {
        exercises: () => prog.exercises || [],
        open: openExercise,
        add: (noteId) => openExerciseModal(null, noteId),
      } : null }),
    staffProgram ? initProgramEditor(player, ctxProfile) : null,
  ]);
  if (staffProgram) renderNoteLists();   // les Exo des points, une fois les exercices chargés
  // Chaque erreur est affichée : des données absentes et un accès refusé
  // produisaient tous les deux une page vide, sans moyen de les distinguer.
  const dataErrors = [
    ['mesures physiques', mRes.error],
    ['tests physiques', tRes.error],
    ['objectifs', notesError],
  ].filter(([, e]) => e);
  if (dataErrors.length) {
    showDataWarning(dataErrors);
  }
  setSeasonData(mRes.data || [], tRes.data || []);

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
}

/* Édition de la fiche joueur depuis le dossier Performance.
   Les mêmes champs que la page Joueurs, pour ne pas avoir à en sortir. */
function openPlayerEdit() {
  if (!canEditPlayer || !player) return;
  const set = (id, v) => { document.getElementById(id).value = v ?? ''; };
  set('pe-prenom', player.prenom);
  set('pe-nom', player.nom);
  set('pe-poste', player.poste);
  set('pe-naissance', player.date_naissance ? String(player.date_naissance).slice(0, 10) : '');
  set('pe-pied', player.pied_fort);
  set('pe-statut', player.statut);
  const teams = window.CLUB_TEAMS || [];
  const hasTeam = 'team_id' in player && teams.length > 0;
  document.getElementById('pe-team-field').classList.toggle('hidden', !hasTeam);
  if (hasTeam) {
    document.getElementById('pe-team').innerHTML = '<option value="">Sans équipe</option>'
      + teams.map(t => `<option value="${t.id}">${esc(t.nom)}</option>`).join('');
    set('pe-team', player.team_id);
  }
  // Plusieurs équipes (lmfc_v7.sql) : l'équipe principale compte pour les
  // moyennes « équipe » ; les autres le font apparaître dans leurs listes.
  const hasOther = hasTeam && 'other_team_ids' in player && teams.length > 1;
  document.getElementById('pe-other-field').classList.toggle('hidden', !hasOther);
  if (hasOther) {
    document.getElementById('pe-other-teams').innerHTML = teams.map(t => `<label class="check"><input type="checkbox" value="${t.id}"${
      (player.other_team_ids || []).includes(t.id) ? ' checked' : ''}> ${esc(t.nom)}</label>`).join('');
    syncOtherTeams();
  }
  // Supprimer un joueur : administrateur seulement (RLS players_delete).
  document.getElementById('btnDeletePlayer').classList.toggle('hidden', ctxProfile?.role !== 'admin');
  // Sans la migration, ces champs ne peuvent pas être enregistrés.
  ['pe-naissance','pe-pied','pe-statut']
    .forEach(id => { document.getElementById(id).disabled = identityMissing; });
  openPerfModal('playerEditModal');
}

/* L'équipe principale ne se coche pas aussi en « autre équipe ». */
function syncOtherTeams() {
  const main = Number(document.getElementById('pe-team').value) || null;
  document.querySelectorAll('#pe-other-teams input').forEach(b => {
    b.disabled = Number(b.value) === main;
    if (b.disabled) b.checked = false;
  });
}

async function savePlayerEdit() {
  if (!canEditPlayer || !player) return;
  const val = id => document.getElementById(id).value.trim();
  const nom = val('pe-nom');
  if (!nom) return notify('Le nom est obligatoire.', 'error');

  const body = {
    nom,
    prenom: val('pe-prenom') || null,
    poste: val('pe-poste') || null,
  };
  if (!identityMissing) {
    Object.assign(body, {
      date_naissance: val('pe-naissance') || null,
      pied_fort: val('pe-pied') || null,
      statut: val('pe-statut') || null,
    });
  }
  if (!document.getElementById('pe-team-field').classList.contains('hidden')) body.team_id = Number(val('pe-team')) || null;
  if (!document.getElementById('pe-other-field').classList.contains('hidden')) {
    body.other_team_ids = [...document.querySelectorAll('#pe-other-teams input:checked')].map(b => Number(b.value));
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
  const [[mRes, tRes], pRes] = await Promise.all([
    fetchPhysical(),
    sb.from('players').select('photo_path').eq('id',player.id).single(),
  ]);
  setSeasonData(mRes.data||[], tRes.data||[]);
  if (pRes.data) player.photo_path=pRes.data.photo_path;
  await loadSquad();
  const availableStages=STAGES.filter(s=>tests.some(t=>t.stage===s.key)).map(s=>s.key);
  if (!availableStages.includes(stage)) stage=availableStages[0]||'pre';
  document.getElementById('stageSelect').value=stage;
  await loadClubAverages();
  renderRadar();
  renderMeasurements();
}

async function uploadPhoto(file) {
  if (!file || !canChangePlayerPhoto(ctxProfile?.role)) return;
  if (file.size > 5 * 1024 * 1024) return notify('Photo trop volumineuse (max 5 Mo).','error');
  const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
  const path=`${player.club_id}/${player.id}/${Date.now()}.${ext}`;
  const { error: upErr } = await sb.storage.from('player-photos').upload(path,file,{contentType:file.type||'image/jpeg'});
  if (upErr) return notify(upErr.message,'error');
  const old=player.photo_path;
  const error = await savePlayerPhotoPath(player.id, path);
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

document.querySelectorAll('[data-close]').forEach(btn=>{
  btn.addEventListener('click',()=>closePerfModal(btn.dataset.close));
});
document.getElementById('stageSelect').addEventListener('change', async e => {
  stage = e.target.value;
  await loadClubAverages();
  renderRadar();
  renderMeasurements();
});
document.getElementById('compareSelect').addEventListener('change', e => {
  compareId = Number(e.target.value) || null;
  renderRadar();
});
document.getElementById('btnAddMeasurement').addEventListener('click',openMeasureModal);
document.getElementById('btnAddCareer').addEventListener('click',()=>openCareerModal());
document.getElementById('btnSaveCareer').addEventListener('click',saveCareer);
document.getElementById('btnDeleteCareer').addEventListener('click',deleteCareer);
document.getElementById('btnAddTests').addEventListener('click',openTestModal);
document.getElementById('m-date').addEventListener('change',e=>{
  const month = seasonMonthOf(e.target.value);
  if (month) document.getElementById('m-month').value = month;
});
document.getElementById('btnEditPlayer').addEventListener('click',openPlayerEdit);
document.getElementById('btnSavePlayer').addEventListener('click',savePlayerEdit);
document.getElementById('pe-team').addEventListener('change', syncOtherTeams);
document.getElementById('btnDeletePlayer').addEventListener('click',deletePlayer);
document.getElementById('btnAddStrength').addEventListener('click',()=>openNoteModal('strength'));
document.getElementById('btnAddImprovement').addEventListener('click',()=>openNoteModal('improvement'));
document.getElementById('btnSaveMeasurement').addEventListener('click',saveMeasurement);
document.getElementById('btnSaveTest').addEventListener('click',saveTest);
document.getElementById('btnAddObjective').addEventListener('click',()=>openNoteModal('objective'));
document.getElementById('btnAddPrevention').addEventListener('click',()=>openNoteModal('prevention'));
// Photo : un clic sur l'avatar (initiales ou photo) pour l'ajouter ou la changer.
document.getElementById('playerAvatar').addEventListener('click',()=>{ if (canChangePlayerPhoto(ctxProfile?.role)) document.getElementById('photoFile').click(); });
document.getElementById('photoFile').addEventListener('change',e=>uploadPhoto(e.target.files[0]));
document.getElementById('btnImportExcel').addEventListener('click',()=>ExcelImport.open({
  clubId: player.club_id,
  seasonStartMonth: clubSeasonStartMonth(ctxProfile?.clubs),
  userId: ctxProfile.id,
  focusPlayerId: player.id,
  onDone: reloadData,
}));

/* ---------- Ce que voit le joueur ----------
   Le staff masque une rubrique de la page Performance dans l'espace du
   joueur (players.hidden_sections, lmfc_v7.sql) : la toile seule, par
   exemple. Masquage d'affichage : ce sont ses propres données. */
function applyPlayerVisibility() {
  const emptied = { tests: !visibleTestRows().length, suivi: !MEASURE_ITEMS.some(([k]) => measureShown(k)) };
  document.querySelectorAll('[data-vis]').forEach(c => c.classList.toggle('hidden', hiddenForPlayer(c.dataset.vis) || !!emptied[c.dataset.vis]));
  Object.entries({ metricHeight: 'height_cm', metricWeight: 'weight_kg', metricBodyFat: 'body_fat_pct' })
    .forEach(([id, k]) => document.getElementById(id).closest('.perf-metric').classList.toggle('hidden', !measureShown(k)));
}
/* Staff : sous le titre de chaque bloc, l'interrupteur du bloc entier ;
   pour les tests et le suivi, le détail élément par élément (juste les
   sprints, juste le 505, tout…). */
const VIS_ITEMS = {
  tests: () => PLAYER_METRICS.map(m => [`test:${m.key}`, m.label]),
  suivi: () => MEASURE_ITEMS.map(([k, label]) => [`mesure:${k}`, label]),
};
function setupVisibilityToggles() {
  if (!canEditPlans || !('hidden_sections' in player)) return;   // migration lmfc_v7 pas encore passée
  const syncs = [];
  const save = async (keys) => {
    const { error } = await sb.rpc('set_player_hidden_sections', { p_player_ids: [player.id], p_sections: [...keys] });
    if (error) {
      console.error('Visibilité non enregistrée', error);
      notify(/hidden_sections_check/.test(error.message) ? 'Base à mettre à jour : exécutez supabase/lmfc_v8.sql.' : error.message, 'error');
    } else player.hidden_sections = [...keys].sort();
    syncs.forEach(f => f());
  };
  const toggle = (key) => {
    const keys = new Set(player.hidden_sections || []);
    if (keys.has(key)) keys.delete(key); else keys.add(key);
    return save(keys);
  };
  document.querySelectorAll('[data-vis]').forEach(card => {
    const section = card.dataset.vis, items = VIS_ITEMS[section]?.() || [];
    const box = el('input', { type: 'checkbox', role: 'switch' });
    const text = el('span');
    const chips = items.map(([key, label]) => el('button', { type: 'button', class: 'vis-chip', 'data-key': key }, label));
    const detail = items.length ? el('div', { class: 'vis-items', role: 'group', 'aria-label': 'Détail visible par le joueur' }, ...chips) : null;
    const sync = () => {
      const hidden = player.hidden_sections || [], shown = !hidden.includes(section);
      box.checked = shown;
      text.textContent = shown ? 'Visible par le joueur' : 'Masqué pour le joueur';
      card.classList.toggle('is-masked', !shown);
      chips.forEach(c => {
        const on = shown && !hidden.includes(c.dataset.key);
        c.setAttribute('aria-pressed', String(on));
        c.disabled = !shown;
        c.title = on ? 'Visible par le joueur : cliquer pour masquer' : 'Masqué pour le joueur';
      });
    };
    syncs.push(sync);
    box.addEventListener('change', () => { box.disabled = true; toggle(section).finally(() => { box.disabled = false; }); });
    chips.forEach(c => c.addEventListener('click', () => toggle(c.dataset.key)));
    card.querySelector('.section-head > div').append(el('label', { class: 'vis-toggle' }, box, text), ...(detail ? [detail] : []));
    sync();
  });
}

/* ---------- Onglets (staff) : Fiche · Performance · Vidéos ----------
   Le contenu change sur place ; ?tab= garde l'onglet au rechargement
   et au retour arrière. Les vidéos ne se chargent qu'à la première
   ouverture de leur onglet. */
const PF_TABS = ['fiche', 'performance', 'videos'];
let pfVideosMounted = false;
function setupTabs() {
  const nav = document.getElementById('pfTabs');
  nav.classList.remove('hidden');
  document.getElementById('pfTab-videos').classList.toggle('hidden', !canManageVideos(ctxProfile.role));
  nav.addEventListener('click', (e) => {
    const t = e.target.closest('[data-pf-tab]');
    if (t) showTab(t.dataset.pfTab, true);
  });
  nav.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const tabs = [...nav.querySelectorAll('[role="tab"]:not(.hidden)')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus(); showTab(next.dataset.pfTab, true);
  });
  const asked = new URLSearchParams(location.search).get('tab');
  showTab(asked, false);
}
function showTab(tab, remember) {
  const allowed = PF_TABS.filter(k => k !== 'videos' || canManageVideos(ctxProfile.role));
  if (!allowed.includes(tab)) tab = 'fiche';
  document.querySelectorAll('[data-pf-tab]').forEach(b => {
    const on = b.dataset.pfTab === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('[data-pf-panel]').forEach(p => { p.hidden = p.dataset.pfPanel !== tab; });
  if (remember) {
    const u = new URL(location.href);
    u.searchParams.set('tab', tab);
    history.replaceState(history.state, '', u);
  }
  if (tab === 'videos' && !pfVideosMounted && player) {
    pfVideosMounted = true;
    mountPlayerVideos(document.getElementById('pfVideos'), { player, profile: ctxProfile });
  }
  if (tab === 'performance') renderRadar();   // tailles justes une fois l'onglet visible
}

/* Suppression d'un joueur : sa fiche et tout ce qui en dépend partent
   ensemble dans la corbeille et reviennent ensemble. Sans la corbeille
   (lmfc_v5.sql non passée), on refuse : ce serait définitif. */
async function deletePlayer() {
  if (ctxProfile?.role !== 'admin' || !player) return;
  const name = `${player.prenom || ''} ${player.nom || ''}`.trim() || 'ce joueur';
  if (!(await trashReady())) {
    return notify('Activez d’abord la corbeille (supabase/lmfc_v5.sql) : la suppression d’un joueur doit rester récupérable.', 'error');
  }
  const account = player.auth_user_id ? '\nSon compte joueur n’aura plus accès à son espace.' : '';
  if (!confirm(`Supprimer ${name} ?\n\nSa fiche part avec tout ce qui la concerne : mesures, tests, vidéos et séquences, objectifs et préventions, programme, parcours, présences.${account}\n\nRécupérable depuis la Corbeille.`)) return;
  const btn = document.getElementById('btnDeletePlayer');
  btn.disabled = true;
  try {
    const { data, error } = await sb.from('players').delete().eq('id', player.id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Suppression réservée à l’administrateur du club.');
    toast(`${name} est dans la corbeille.`, 'success');
    setTimeout(() => { location.href = 'players.html'; }, 600);
  } catch (e) {
    console.error('Suppression du joueur impossible', e);
    notify(e.message, 'error');
    btn.disabled = false;
  }
}

loadPage().catch(e => console.error('player-performance:', e));
