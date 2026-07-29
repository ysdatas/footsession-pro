<?php
require_once __DIR__ . '/php/includes/bootstrap.php';
require_login();
page_head('Bilan & Analytics', ['analytics.css', 'pdf.css']);
app_shell_open('analytics');
?>
<div class="page-head">
  <div>
    <h1>Bilan &amp; Analytics</h1>
    <p class="subtitle">Volume de travail, présence et tendances de vos séances.</p>
  </div>
  <div class="page-actions">
    <button class="btn" id="btnExportAnalytics" type="button">Exporter PDF</button>
  </div>
</div>

<div class="flex-between" style="margin-bottom:18px;flex-wrap:wrap;gap:12px;">
  <div class="segmented" id="periodSwitch">
    <button data-period="week">Semaine</button>
    <button data-period="month" class="active">Mois</button>
    <button data-period="season">Saison</button>
    <button data-period="custom">Personnalisé</button>
  </div>
  <div id="customRange" class="hidden" style="display:flex;gap:10px;align-items:center;">
    <input type="date" id="customFrom"><span class="text-muted">→</span><input type="date" id="customTo">
    <button class="btn btn-sm" id="applyCustom" type="button">Appliquer</button>
  </div>
</div>

<div id="analyticsContent">
  <div class="kpi-grid" id="analyticsKpis">
    <div class="card kpi"><div class="kpi-num" id="kpiSessions">—</div><div class="kpi-label">Séances réalisées</div></div>
    <div class="card kpi"><div class="kpi-num" id="kpiProcedures">—</div><div class="kpi-label">Procédés travaillés</div></div>
    <div class="card kpi gold"><div class="kpi-num" id="kpiPresence">—</div><div class="kpi-label">Présence moyenne</div></div>
  </div>

  <div id="chartsArea" class="charts-grid">
    <div class="card chart-card"><h3>Volume par catégorie</h3><div class="chart-box"><canvas id="chartCategory"></canvas></div></div>
    <div class="card chart-card"><h3>Séances par mois (6 mois)</h3><div class="chart-box"><canvas id="chartMonths"></canvas></div></div>
    <div class="card chart-card"><h3>Postes les plus ciblés</h3><div class="chart-box"><canvas id="chartPostes"></canvas></div></div>
    <div class="card chart-card"><h3>Zones de jeu travaillées</h3><div class="chart-box"><canvas id="chartZones"></canvas></div></div>
    <div class="card chart-card"><h3>Principes de jeu récurrents</h3><div class="chart-box"><canvas id="chartPrincipes"></canvas></div></div>
    <div class="card chart-card"><h3>Effectifs utilisés</h3><div class="chart-box"><canvas id="chartEffectifs"></canvas></div></div>
  </div>
</div>

<?php
app_shell_close([
    'app.js',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'analytics.js',
]);
