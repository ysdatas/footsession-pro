/* ============================================================
   FootSession Pro — analytics.js  (Chart.js)
   ============================================================ */

const GOLD = '#C9A84C', GOLD_L = '#E2C97E', GRID = 'rgba(255,255,255,.06)', TXT = '#8A8A8A';
const PIE_COLORS = ['#C9A84C', '#7e6cff', '#3aa0ff', '#4CAF50', '#ff8a5b', '#ff6b9d', '#E2C97E', '#26c6da'];

let charts = {};
let currentPeriod = 'month';

document.addEventListener('DOMContentLoaded', () => {
  if (window.Chart) {
    Chart.defaults.color = TXT;
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.borderColor = GRID;
  }
  $$('#periodSwitch button').forEach(b => b.addEventListener('click', () => {
    $$('#periodSwitch button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    currentPeriod = b.dataset.period;
    $('#customRange').classList.toggle('hidden', currentPeriod !== 'custom');
    if (currentPeriod !== 'custom') load();
  }));
  $('#applyCustom').addEventListener('click', load);
  $('#btnExportAnalytics').addEventListener('click', exportAnalyticsPdf);
  load();
});

async function load() {
  let url = `php/api/analytics.php?action=overview&period=${currentPeriod}`;
  if (currentPeriod === 'custom') {
    const f = $('#customFrom').value, t = $('#customTo').value;
    if (!f || !t) return toast('Choisissez une plage de dates.', 'error');
    url += `&from=${f}&to=${t}`;
  }
  try {
    const d = await API(url);
    $('#kpiSessions').textContent = d.kpis.sessions;
    $('#kpiProcedures').textContent = d.kpis.procedures;
    $('#kpiPresence').textContent = d.kpis.presence + '%';

    const totalData = d.kpis.sessions + d.kpis.procedures;
    if (totalData === 0) { showEmpty(); return; }
    restoreCharts();

    bar('chartCategory', d.byCategory, GOLD);
    line('chartMonths', d.sessionsPerMonth);
    hbar('chartPostes', d.topPostes, GOLD_L);
    hbar('chartZones', d.zones, '#3aa0ff');
    bar('chartPrincipes', d.principes, '#7e6cff');
    pie('chartEffectifs', d.effectifs);
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------- États ---------- */
function showEmpty() {
  destroyAll();
  $('#chartsArea').innerHTML =
    `<div class="analytics-empty">
     <strong>Analyse en cours…</strong><br>Pas encore assez de données sur cette période.
     <br><span class="text-muted">Créez des séances et renseignez les procédés pour voir vos statistiques.</span></div>`;
}
function restoreCharts() {
  const area = $('#chartsArea');
  if (area.querySelector('.chart-card')) return;
  area.innerHTML = `
    <div class="card chart-card"><h3>Volume par catégorie</h3><div class="chart-box"><canvas id="chartCategory"></canvas></div></div>
    <div class="card chart-card"><h3>Séances par mois (6 mois)</h3><div class="chart-box"><canvas id="chartMonths"></canvas></div></div>
    <div class="card chart-card"><h3>Postes les plus ciblés</h3><div class="chart-box"><canvas id="chartPostes"></canvas></div></div>
    <div class="card chart-card"><h3>Zones de jeu travaillées</h3><div class="chart-box"><canvas id="chartZones"></canvas></div></div>
    <div class="card chart-card"><h3>Principes de jeu récurrents</h3><div class="chart-box"><canvas id="chartPrincipes"></canvas></div></div>
    <div class="card chart-card"><h3>Effectifs utilisés</h3><div class="chart-box"><canvas id="chartEffectifs"></canvas></div></div>`;
}
function destroyAll() { Object.values(charts).forEach(c => c?.destroy()); charts = {}; }

/* ---------- Constructeurs ---------- */
function labels(rows) { return rows.map(r => r.label); }
function values(rows) { return rows.map(r => Number(r.c)); }

function make(id, config) {
  charts[id]?.destroy();
  const el = document.getElementById(id);
  if (el) charts[id] = new Chart(el, config);
}
const noLegend = { plugins: { legend: { display: false } }, maintainAspectRatio: false };

function bar(id, rows, color) {
  make(id, {
    type: 'bar',
    data: { labels: labels(rows), datasets: [{ data: values(rows), backgroundColor: color, borderRadius: 6, maxBarThickness: 46 }] },
    options: { ...noLegend, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
}
function hbar(id, rows, color) {
  make(id, {
    type: 'bar',
    data: { labels: labels(rows), datasets: [{ data: values(rows), backgroundColor: color, borderRadius: 6 }] },
    options: { ...noLegend, indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
}
function line(id, rows) {
  make(id, {
    type: 'line',
    data: { labels: rows.map(r => r.label), datasets: [{
      data: rows.map(r => Number(r.c)), borderColor: GOLD, backgroundColor: 'rgba(201,168,76,.12)',
      fill: true, tension: .35, pointBackgroundColor: GOLD, pointRadius: 4 }] },
    options: { ...noLegend, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
}
function pie(id, rows) {
  make(id, {
    type: 'doughnut',
    data: { labels: labels(rows), datasets: [{ data: values(rows), backgroundColor: PIE_COLORS, borderColor: '#141414', borderWidth: 2 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12 } } } },
  });
}

/* ---------- Export PDF ---------- */
async function exportAnalyticsPdf() {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF || !window.html2canvas) return toast('Module PDF indisponible.', 'error');
  toast('Génération du PDF…');
  try {
    const node = document.getElementById('analyticsContent');
    const canvas = await html2canvas(node, { backgroundColor: '#ffffff', scale: 2 });
    const pdf = new jsPDF('p', 'mm', 'a4');
    const w = 210, h = canvas.height * w / canvas.width;
    pdf.setTextColor('#C9A84C'); pdf.setFontSize(18);
    pdf.text('FootSession Pro — Bilan', 14, 16);
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 22, w, h);
    pdf.save('bilan-footsession.pdf');
  } catch (e) { toast('Échec de l\'export PDF.', 'error'); }
}
