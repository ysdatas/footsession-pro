/* ============================================================
   FootSession Pro — analytics-page.js (Chemin B / Supabase)
   Agrégations calculées côté client. Le RLS filtre en amont : on ne
   reçoit que les séances du club de l'utilisateur connecté.
   ============================================================ */

const GOLD = '#C9A84C', GOLD_L = '#E2C97E', GRID = 'rgba(255,255,255,.06)', TXT = '#8A8A8A';
const PIE_COLORS = ['#C9A84C', '#7e6cff', '#3aa0ff', '#4CAF50', '#ff8a5b', '#ff6b9d', '#E2C97E', '#26c6da'];

let charts = {};
let currentPeriod = 'month';
let myProfile = null;

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  myProfile = ctx.profile;

  document.getElementById('uName').textContent = myProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[myProfile.role] || myProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (myProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  if (window.Chart) {
    Chart.defaults.color = TXT;
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.borderColor = GRID;
  }

  document.querySelectorAll('#periodSwitch button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#periodSwitch button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    currentPeriod = b.dataset.period;
    document.getElementById('customRange').classList.toggle('hidden', currentPeriod !== 'custom');
    if (currentPeriod !== 'custom') load();
  }));
  document.getElementById('applyCustom').addEventListener('click', load);
  document.getElementById('btnExportAnalytics').addEventListener('click', exportAnalyticsPdf);

  load();
})();

/* ---------- Bornes de période ---------- */
function periodRange() {
  const today = new Date();
  const iso = d => d.toISOString().slice(0, 10);
  if (currentPeriod === 'custom') {
    const f = document.getElementById('customFrom').value, t = document.getElementById('customTo').value;
    return (f && t) ? { from: f, to: t } : null;
  }
  const from = new Date(today);
  if (currentPeriod === 'week') from.setDate(from.getDate() - 7);
  else if (currentPeriod === 'month') from.setMonth(from.getMonth() - 1);
  else from.setMonth(from.getMonth() - 12);   // saison
  return { from: iso(from), to: iso(today) };
}

/* ---------- Chargement + agrégation ---------- */
async function load() {
  const range = periodRange();
  if (!range) return toast('Choisissez une plage de dates.', 'error');

  try {
    // Séances de la période avec leurs procédés (le RLS restreint au périmètre autorisé).
    const { data: sessions, error } = await sb.from('sessions')
      .select('id, titre, date_seance, duree_min, procedures(id, duree_min, effectif, taille_terrain, principes_jeu, type_procede, nb_sequences, duree_sequence_min, temps_recup_min)')
      .gte('date_seance', range.from).lte('date_seance', range.to)
      .order('date_seance');
    if (error) throw error;

    // Présences sur ces séances.
    const ids = sessions.map(s => s.id);
    let attendance = [];
    if (ids.length) {
      const { data: att } = await sb.from('attendance').select('session_id, present').in('session_id', ids);
      attendance = att || [];
    }

    const allProcs = sessions.flatMap(s => s.procedures || []);
    const nbSessions = sessions.length;
    const nbProcedures = allProcs.length;
    const presence = attendance.length ? Math.round(attendance.filter(a => a.present).length / attendance.length * 100) : 0;
    // Volume de travail = temps ballon, récupérations exclues.
    const volume = sessionWorkMin(allProcs);

    document.getElementById('kpiSessions').textContent = nbSessions;
    document.getElementById('kpiProcedures').textContent = nbProcedures;
    document.getElementById('kpiPresence').textContent = presence + '%';
    document.getElementById('kpiVolume').textContent = volume.toLocaleString('fr-FR') + " min";

    if (nbSessions === 0 && nbProcedures === 0) { showEmpty(); return; }
    restoreCharts();

    bar('chartCategory', countBy(allProcs, p => p.type_procede), GOLD);
    line('chartMonths', await sessionsPerMonth());
    hbar('chartEspaces', countBy(allProcs, p => p.taille_terrain), GOLD_L);
    hbar('chartVolume', volumePerSession(sessions), '#3aa0ff');
    bar('chartPrincipes', countBy(allProcs, p => p.principes_jeu), '#7e6cff');
    pie('chartEffectifs', countBy(allProcs, p => p.effectif));
  } catch (e) { toast(e.message, 'error'); }
}

/** Compte les occurrences d'un champ texte, trié décroissant, top 8. */
function countBy(rows, getter) {
  const counts = {};
  rows.forEach(r => {
    const v = (getter(r) || '').trim();
    if (v) counts[v] = (counts[v] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, c]) => ({ label, c }));
}

/** Volume de travail (temps ballon) par séance, top 8. */
function volumePerSession(sessions) {
  return sessions
    .map(s => ({ label: (s.titre || '').slice(0, 22), c: sessionWorkMin(s.procedures) }))
    .filter(r => r.c > 0).sort((a, b) => b.c - a.c).slice(0, 8);
}

/** Série continue des 6 derniers mois (indépendante du filtre de période). */
async function sessionsPerMonth() {
  const from = new Date(); from.setMonth(from.getMonth() - 5); from.setDate(1);
  const { data } = await sb.from('sessions').select('date_seance').gte('date_seance', from.toISOString().slice(0, 10));
  const found = {};
  (data || []).forEach(s => { const ym = (s.date_seance || '').slice(0, 7); found[ym] = (found[ym] || 0) + 1; });
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    const ym = d.toISOString().slice(0, 7);
    months.push({ label: d.toLocaleDateString('fr-FR', { month: 'short' }), c: found[ym] || 0 });
  }
  return months;
}

/* ---------- États ---------- */
function showEmpty() {
  destroyAll();
  document.getElementById('chartsArea').innerHTML =
    `<div class="analytics-empty">
     <strong>Analyse en cours…</strong><br>Pas encore assez de données sur cette période.
     <br><span class="text-muted">Créez des séances et renseignez les procédés pour voir vos statistiques.</span></div>`;
}
function restoreCharts() {
  const area = document.getElementById('chartsArea');
  if (area.querySelector('.chart-card')) return;
  area.innerHTML = `
    <div class="card chart-card"><h3>Répartition par type de procédé</h3><div class="chart-box"><canvas id="chartCategory"></canvas></div></div>
    <div class="card chart-card"><h3>Séances par mois (6 mois)</h3><div class="chart-box"><canvas id="chartMonths"></canvas></div></div>
    <div class="card chart-card"><h3>Espaces de jeu utilisés</h3><div class="chart-box"><canvas id="chartEspaces"></canvas></div></div>
    <div class="card chart-card"><h3>Volume par séance (min)</h3><div class="chart-box"><canvas id="chartVolume"></canvas></div></div>
    <div class="card chart-card"><h3>Principes de jeu récurrents</h3><div class="chart-box"><canvas id="chartPrincipes"></canvas></div></div>
    <div class="card chart-card"><h3>Effectifs utilisés</h3><div class="chart-box"><canvas id="chartEffectifs"></canvas></div></div>`;
}
function destroyAll() { Object.values(charts).forEach(c => c?.destroy()); charts = {}; }

/* ---------- Constructeurs de graphiques ---------- */
const labelsOf = rows => rows.map(r => r.label);
const valuesOf = rows => rows.map(r => Number(r.c));

function make(id, config) {
  charts[id]?.destroy();
  const el = document.getElementById(id);
  if (el) charts[id] = new Chart(el, config);
}
const noLegend = { plugins: { legend: { display: false } }, maintainAspectRatio: false };

function bar(id, rows, color) {
  make(id, {
    type: 'bar',
    data: { labels: labelsOf(rows), datasets: [{ data: valuesOf(rows), backgroundColor: color, borderRadius: 6, maxBarThickness: 46 }] },
    options: { ...noLegend, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
}
function hbar(id, rows, color) {
  make(id, {
    type: 'bar',
    data: { labels: labelsOf(rows), datasets: [{ data: valuesOf(rows), backgroundColor: color, borderRadius: 6 }] },
    options: { ...noLegend, indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
}
function line(id, rows) {
  make(id, {
    type: 'line',
    data: { labels: labelsOf(rows), datasets: [{
      data: valuesOf(rows), borderColor: GOLD, backgroundColor: 'rgba(201,168,76,.12)',
      fill: true, tension: .35, pointBackgroundColor: GOLD, pointRadius: 4 }] },
    options: { ...noLegend, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
}
function pie(id, rows) {
  make(id, {
    type: 'doughnut',
    data: { labels: labelsOf(rows), datasets: [{ data: valuesOf(rows), backgroundColor: PIE_COLORS, borderColor: '#141414', borderWidth: 2 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12 } } } },
  });
}

/* ---------- Export PDF du bilan ---------- */
async function exportAnalyticsPdf() {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF || !window.html2canvas) return toast('Module PDF indisponible.', 'error');
  toast('Génération du PDF…');
  try {
    const node = document.getElementById('analyticsContent');
    const canvas = await html2canvas(node, { backgroundColor: '#ffffff', scale: 2 });
    const pdf = new jsPDF('p', 'mm', 'a4');
    const w = 210, h = canvas.height * w / canvas.width;
    pdf.setTextColor(GOLD); pdf.setFontSize(18);
    pdf.text('FootSession Pro — Bilan', 14, 16);
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 22, w, h);
    pdf.save('bilan-footsession.pdf');
    toast('PDF généré', 'success');
  } catch (e) { toast('Échec de l\'export PDF.', 'error'); }
}
