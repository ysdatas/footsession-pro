/* ============================================================
   FootSession Pro — comparaison-page.js
   Comparaison de l'effectif : tests bruts, évolution sur la saison,
   données physiques. Réservé au staff qui a accès à la performance
   (admin, coach, analyste, prépa) — la RLS refuse déjà les autres,
   la garde ci-dessous évite simplement une page vide inexpliquée.
   ============================================================ */

const CMP_STAGES = [
  { key: 'pre', label: 'Pré-saison' },
  { key: 'mid', label: 'Mi-saison' },
  { key: 'end', label: 'Fin de saison' },
];

let myProfile = null;
let roster = [];        // players du club
let allTests = [];      // player_physical_tests, toutes sessions
let allMeasures = [];   // player_physical_measurements
let cmpTab = 'tests';
let cmpStage = 'pre';
let cmpMetric = 'vift_kmh';
let cmpSearch = '';
let cmpOnlyFlagged = false;
let sortKey = 'name';
let sortAsc = true;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const numOrNull = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmtVal = (v, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? '—' : Number(v).toFixed(digits).replace('.', ',');

const playerName = p => `${p.prenom || ''} ${p.nom || ''}`.trim() || `Fiche #${p.id}`;

/* ------------------------------------------------------------ */

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  myProfile = ctx.profile;

  document.getElementById('uName').textContent = myProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[myProfile.role] || myProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent =
    (myProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', e => { e.preventDefault(); logout(); });

  // can_view_performance() côté base : admin, coach, analyste, prépa.
  if (!['admin', 'coach', 'analyste', 'prepa'].includes(myProfile.role)) {
    document.getElementById('cmpSub').textContent = 'Accès réservé au staff technique.';
    document.getElementById('cmpContent').innerHTML =
      `<div class="empty">Cette rubrique est réservée aux rôles ayant accès aux données de performance
       (administrateur, coach, analyste vidéo, préparateur physique).</div>`;
    document.querySelector('.cmp-toolbar')?.classList.add('hidden');
    return;
  }

  document.getElementById('cmpMetric').innerHTML =
    PERF_METRICS.map(m => `<option value="${m.key}">${esc(m.label)}</option>`).join('');
  document.getElementById('cmpMetric').value = cmpMetric;

  document.querySelectorAll('#cmpTabs button').forEach(b =>
    b.addEventListener('click', () => switchTab(b.dataset.tab)));
  document.getElementById('cmpStage').addEventListener('change', e => { cmpStage = e.target.value; render(); });
  document.getElementById('cmpMetric').addEventListener('change', e => { cmpMetric = e.target.value; render(); });
  document.getElementById('cmpSearch').addEventListener('input', e => { cmpSearch = e.target.value; render(); });
  document.getElementById('cmpOnlyFlagged').addEventListener('change', e => { cmpOnlyFlagged = e.target.checked; render(); });

  await loadData();
  render();
})();

async function loadData() {
  const [rRes, tRes, mRes] = await Promise.all([
    sb.from('players').select('id, nom, prenom, numero, poste').order('nom'),
    sb.from('player_physical_tests').select('*'),
    sb.from('player_physical_measurements').select('*'),
  ]);

  const err = rRes.error || tRes.error || mRes.error;
  if (err) {
    document.getElementById('cmpContent').innerHTML =
      `<div class="empty text-danger">Lecture impossible : ${esc(err.message)}</div>`;
    throw err;
  }

  roster = rRes.data || [];
  allTests = tRes.data || [];
  allMeasures = mRes.data || [];

  const n = roster.length;
  document.getElementById('cmpSub').textContent =
    `${n} joueur${n > 1 ? 's' : ''} · ${allTests.length} session${allTests.length > 1 ? 's' : ''} de tests enregistrée${allTests.length > 1 ? 's' : ''}`;
}

function switchTab(tab) {
  cmpTab = tab;
  document.querySelectorAll('#cmpTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelector('.cmp-metric-field').classList.toggle('hidden', tab !== 'evolution');
  document.querySelector('#cmpStage').closest('.cmp-field').classList.toggle('hidden', tab === 'evolution');
  sortKey = 'name'; sortAsc = true;
  render();
}

/* Dernière ligne de tests d'un joueur pour une session donnée. */
function testFor(playerId, stage) {
  const rows = allTests
    .filter(t => t.player_id === playerId && t.stage === stage)
    .sort((a, b) => (a.id || 0) - (b.id || 0));
  return rows.length ? rows[rows.length - 1] : null;
}

/* Dernière mesure physique connue d'un joueur. */
function latestMeasureFor(playerId) {
  const MONTHS = ['Août','Septembre','Octobre','Novembre','Décembre','Janvier','Février','Mars','Avril','Mai','Juin'];
  const rows = allMeasures.filter(m => m.player_id === playerId);
  if (!rows.length) return null;
  return [...rows].sort((a, b) =>
    String(a.measured_at || '').localeCompare(String(b.measured_at || ''))
    || (MONTHS.indexOf(a.month_label) - MONTHS.indexOf(b.month_label))
    || ((a.id || 0) - (b.id || 0))
  ).at(-1);
}

function visibleRoster() {
  const q = cmpSearch.trim().toLowerCase();
  return roster.filter(p => !q || playerName(p).toLowerCase().includes(q));
}

function sortRows(rows, key) {
  const dir = sortAsc ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'name') return dir * playerName(a.player).localeCompare(playerName(b.player));
    const va = a.values?.[key], vb = b.values?.[key];
    // Les valeurs absentes restent en bas, quel que soit le sens du tri.
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    return dir * (va - vb);
  });
}

function headerCell(key, label, title) {
  const arrow = sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '';
  return `<th class="sortable ${sortKey === key ? 'sorted' : ''}" data-sort="${key}"
    ${title ? `title="${esc(title)}"` : ''}>${esc(label)}${arrow}</th>`;
}

function bindSorting() {
  document.querySelectorAll('th.sortable').forEach(th => th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (sortKey === key) sortAsc = !sortAsc;
    else { sortKey = key; sortAsc = key === 'name'; }
    render();
  }));
}

/* Cellule de valeur : rang dans l'effectif, et signalement hors bornes. */
function valueCell(key, value, rank, total) {
  const m = PERF_METRIC_BY_KEY[key];
  if (value === null) return `<td class="v-empty">—</td>`;
  const flagged = isImplausible(key, value);
  const podium = !flagged && rank != null && total >= 3 && rank <= 3 ? ` rank-${rank}` : '';
  return `<td class="v${podium}${flagged ? ' v-flagged' : ''}"
    ${flagged ? `title="Valeur hors des bornes attendues pour ${esc(m.label)} (${m.min}–${m.max} ${m.unit}). À vérifier : le plus souvent une saisie dans la mauvaise colonne."` : ''}>
    ${fmtVal(value, m.digits)}${flagged ? ' <span class="flag-pill">⚠</span>' : ''}</td>`;
}

/* Rangs d'une métrique, en ignorant les valeurs hors bornes. */
function ranksFor(rows, key) {
  const m = PERF_METRIC_BY_KEY[key];
  const usable = rows
    .map(r => ({ id: r.player.id, v: r.values[key] }))
    .filter(r => r.v !== null && !isImplausible(key, r.v));
  if (!m.better) return {};
  usable.sort((a, b) => m.better === 'lower' ? a.v - b.v : b.v - a.v);
  return Object.fromEntries(usable.map((r, i) => [r.id, i + 1]));
}

/* ------------------------------------------------------------
   Onglet 1 — Tests physiques bruts
   ------------------------------------------------------------ */
function renderTests() {
  const rows = visibleRoster().map(p => {
    const t = testFor(p.id, cmpStage);
    const values = Object.fromEntries(PERF_METRICS.map(m => [m.key, t ? numOrNull(t[m.key]) : null]));
    return { player: p, values, hasData: PERF_METRICS.some(m => values[m.key] !== null) };
  });

  const flaggedRows = rows.filter(r => PERF_METRICS.some(m => isImplausible(m.key, r.values[m.key])));
  const shown = (cmpOnlyFlagged ? flaggedRows : rows).filter(r => r.hasData || !cmpOnlyFlagged);

  renderAlert(flaggedRows);

  if (!shown.length) {
    return `<div class="empty">${cmpOnlyFlagged
      ? 'Aucune valeur suspecte sur cette session.'
      : 'Aucun test enregistré pour cette session.'}</div>`;
  }

  const ranks = Object.fromEntries(PERF_METRICS.map(m => [m.key, ranksFor(rows, m.key)]));
  const total = rows.filter(r => r.hasData).length;

  const avgRow = PERF_METRICS.map(m => {
    const a = perfAverage(rows.map(r => r.values), m.key);
    return `<td class="v-avg">${fmtVal(a.value, m.digits)}</td>`;
  }).join('');

  const body = sortRows(shown, sortKey).map(r => `
    <tr>
      <td class="p-name">
        <a href="player-performance.html?id=${r.player.id}">${esc(playerName(r.player))}</a>
        ${r.player.numero != null ? `<span class="p-num">#${r.player.numero}</span>` : ''}
      </td>
      ${PERF_METRICS.map(m => valueCell(m.key, r.values[m.key], ranks[m.key][r.player.id], total)).join('')}
    </tr>`).join('');

  return `<div class="cmp-table-wrap"><table class="cmp-table">
    <thead><tr>
      ${headerCell('name', 'Joueur')}
      ${PERF_METRICS.map(m => headerCell(m.key, `${m.short}${m.unit ? ` (${m.unit})` : ''}`, m.label)).join('')}
    </tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr><td class="p-name">Moyenne du club</td>${avgRow}</tr></tfoot>
  </table></div>`;
}

function renderAlert(flaggedRows) {
  const box = document.getElementById('cmpAlert');
  if (!flaggedRows.length) { box.innerHTML = ''; return; }
  const names = flaggedRows.map(r => esc(playerName(r.player))).join(', ');
  box.innerHTML = `<div class="cmp-alert">
    <strong>⚠ ${flaggedRows.length} fiche${flaggedRows.length > 1 ? 's' : ''} avec une valeur hors bornes</strong>
    <p>${names}. Ces valeurs sont exclues des moyennes et des classements tant qu’elles ne sont pas corrigées,
    pour qu’une saisie dans la mauvaise colonne ne fausse pas la référence de tout le groupe.</p>
  </div>`;
}

/* ------------------------------------------------------------
   Onglet 2 — Évolution sur la saison
   ------------------------------------------------------------ */
function renderEvolution() {
  const m = PERF_METRIC_BY_KEY[cmpMetric];
  const rows = visibleRoster().map(p => {
    const values = Object.fromEntries(
      CMP_STAGES.map(s => [s.key, numOrNull(testFor(p.id, s.key)?.[cmpMetric] ?? null)])
    );
    const first = CMP_STAGES.map(s => values[s.key]).find(v => v !== null) ?? null;
    const lastKey = [...CMP_STAGES].reverse().find(s => values[s.key] !== null)?.key;
    const last = lastKey ? values[lastKey] : null;
    const progress = (first !== null && last !== null && first !== last)
      ? perfDelta(cmpMetric, last, first) : null;
    return { player: p, values: { ...values, progress }, hasData: first !== null };
  }).filter(r => r.hasData);

  document.getElementById('cmpAlert').innerHTML = '';

  if (!rows.length) {
    return `<div class="empty">Aucune donnée de « ${esc(m.label)} » sur la saison.</div>`;
  }

  const body = sortRows(rows, sortKey).map(r => {
    const cells = CMP_STAGES.map(s => valueCell(cmpMetric, r.values[s.key], null, 0)).join('');
    const p = r.values.progress;
    const prog = p === null
      ? '<td class="v-empty">—</td>'
      : `<td class="v ${p >= 0 ? 'gain' : 'loss'}">${p >= 0 ? '↗ +' : '↘ −'}${fmtVal(Math.abs(p), m.digits)}</td>`;
    return `<tr>
      <td class="p-name"><a href="player-performance.html?id=${r.player.id}">${esc(playerName(r.player))}</a></td>
      ${cells}${prog}
    </tr>`;
  }).join('');

  return `<p class="cmp-hint">Progression = écart entre la première et la dernière session renseignée,
    orienté dans le sens favorable au joueur. Une session sans mesure reste vide : rien n’est reporté d’une session à l’autre.</p>
  <div class="cmp-table-wrap"><table class="cmp-table">
    <thead><tr>
      ${headerCell('name', 'Joueur')}
      ${CMP_STAGES.map(s => headerCell(s.key, s.label)).join('')}
      ${headerCell('progress', 'Progression')}
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

/* ------------------------------------------------------------
   Onglet 3 — Données physiques
   ------------------------------------------------------------ */
function renderMorpho() {
  const MONTHS = ['Août','Septembre','Octobre','Novembre','Décembre','Janvier','Février','Mars','Avril','Mai','Juin'];
  const monthsUsed = MONTHS.filter(mo => allMeasures.some(x => x.month_label === mo));

  const rows = visibleRoster().map(p => {
    const latest = latestMeasureFor(p.id);
    const values = Object.fromEntries(MORPHO_METRICS.map(m => [m.key, latest ? numOrNull(latest[m.key]) : null]));
    const byMonth = Object.fromEntries(monthsUsed.map(mo => {
      const row = allMeasures.find(x => x.player_id === p.id && x.month_label === mo);
      return [mo, row ? numOrNull(row.weight_kg) : null];
    }));
    return { player: p, values, byMonth, latestMonth: latest?.month_label || null,
             hasData: MORPHO_METRICS.some(m => values[m.key] !== null) };
  }).filter(r => r.hasData);

  document.getElementById('cmpAlert').innerHTML = '';

  if (!rows.length) return `<div class="empty">Aucune mesure physique enregistrée.</div>`;

  const body = sortRows(rows, sortKey).map(r => `
    <tr>
      <td class="p-name"><a href="player-performance.html?id=${r.player.id}">${esc(playerName(r.player))}</a></td>
      ${MORPHO_METRICS.map(m => valueCell(m.key, r.values[m.key], null, 0)).join('')}
      <td class="v-month">${esc(r.latestMonth || '—')}</td>
      ${monthsUsed.map(mo => {
        const v = r.byMonth[mo];
        return v === null ? '<td class="v-empty">—</td>' : `<td class="v">${fmtVal(v, 1)}</td>`;
      }).join('')}
    </tr>`).join('');

  const avg = MORPHO_METRICS.map(m => {
    const a = perfAverage(rows.map(r => r.values), m.key);
    return `<td class="v-avg">${fmtVal(a.value, m.digits)}</td>`;
  }).join('');

  return `<p class="cmp-hint">Dernière mesure connue de chaque joueur, puis l’évolution du poids mois par mois.</p>
  <div class="cmp-table-wrap"><table class="cmp-table">
    <thead>
      <tr>
        <th rowspan="2" class="sortable ${sortKey === 'name' ? 'sorted' : ''}" data-sort="name">Joueur${sortKey === 'name' ? (sortAsc ? ' ▲' : ' ▼') : ''}</th>
        <th colspan="${MORPHO_METRICS.length}">Dernière mesure</th>
        <th rowspan="2">Mois</th>
        <th colspan="${monthsUsed.length}">Poids (kg) par mois</th>
      </tr>
      <tr>
        ${MORPHO_METRICS.map(m => headerCell(m.key, `${m.label} (${m.unit})`)).join('')}
        ${monthsUsed.map(mo => `<th class="th-month">${esc(mo.slice(0, 4))}</th>`).join('')}
      </tr>
    </thead>
    <tbody>${body}</tbody>
    <tfoot><tr><td class="p-name">Moyenne du club</td>${avg}<td colspan="${monthsUsed.length + 1}"></td></tr></tfoot>
  </table></div>`;
}

function render() {
  const content = document.getElementById('cmpContent');
  content.innerHTML =
    cmpTab === 'tests' ? renderTests() :
    cmpTab === 'evolution' ? renderEvolution() : renderMorpho();
  bindSorting();
}
