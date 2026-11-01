/* ============================================================
   LMFC Performance — analytics-page.js (Chemin B / Supabase)
   Agrégations calculées côté client. Le RLS filtre en amont : on ne
   reçoit que les séances du club de l'utilisateur connecté.
   ============================================================ */

let CHARTS_HTML = '';

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

  if (window.Chart) setChartDefaults();
  CHARTS_HTML = document.getElementById('chartsArea').innerHTML;   // pour revenir après « pas de données »

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
    // Les 6 derniers mois ne dépendent pas de la période : ils partent tout de suite.
    const monthsP = sessionsPerMonth();
    monthsP.catch(() => {});   // pas attendue si la période est vide
    // Séances de la période avec leurs procédés et leurs présences, en une requête
    // (avant : séances, puis présences, puis les 6 mois). Le RLS restreint au périmètre autorisé.
    const { data: sessions, error } = await sb.from('sessions')
      .select('id, titre, date_seance, duree_min, principes_jeu, procedures(id, duree_min, effectif, taille_terrain, principes_jeu, type_procede, nb_sequences, duree_sequence_min, temps_recup_min), attendance(present, statut)')
      .gte('date_seance', range.from).lte('date_seance', range.to)
      .order('date_seance');
    if (error) throw error;
    const attendance = sessions.flatMap(s => s.attendance || []).filter(a => a.statut !== 'non_concerne');   // retiré de la séance : hors présence

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

    // Saisies équivalentes regroupées (« 7c7 » = « 7v7 », label-norm.js).
    split('chartCategory', countNormalized(allProcs.map(p => p.type_procede)));
    columns('chartMonths', await monthsP);
    hbar('chartVolume', volumePerSession(sessions), ' min');
    // Un principe par séance (les anciennes séances le reprennent de leurs procédés).
    hbar('chartPrincipes', countNormalized(sessions.map(s => sessionPrinciple(s, s.procedures))));
    hbar('chartEffectifs', countNormalized(allProcs.map(p => p.effectif), normEffectif));
    hbar('chartEspaces', countNormalized(allProcs.map(p => p.taille_terrain), normTerrain));
  } catch (e) { toast(e.message, 'error'); }
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
  if (!area.querySelector('.chart-card')) area.innerHTML = CHARTS_HTML;
}
function destroyAll() { Object.values(charts).forEach(c => c?.destroy()); charts = {}; }

/* ---------- Export PDF du bilan ----------
   Mise en page commune (pdf-kit.js). Les graphiques sont redessinés pour
   le papier (fond blanc, texte sombre), pas copiés de l'écran sombre. */
const PRINT_CHARTS = [
  ['chartMonths', 'Séances par mois (6 mois)'], ['chartVolume', 'Temps de travail par séance (min)'],
  ['chartCategory', 'Types de procédés'], ['chartPrincipes', 'Principes de jeu'],
  ['chartEffectifs', 'Formats de jeu'], ['chartEspaces', 'Tailles de terrain'],
];
function chartForPrint(id) {
  const ch = charts[id];
  // Graphique sans aucune valeur : rien à imprimer.
  if (!ch || !ch.data.datasets.some(d => (d.data || []).some(v => Number(v) > 0))) return null;
  const c = document.createElement('canvas');
  c.width = 900; c.height = 520;
  const o = ch.config.options || {};
  const font = { size: 22, family: 'Helvetica, Arial, sans-serif' };
  const scales = Object.fromEntries(Object.entries(o.scales || {}).map(([k, v]) =>
    [k, { ...v, ticks: { ...v.ticks, color: '#4b5563', font }, grid: { ...v.grid, color: '#e5e7eb' }, border: { ...v.border, color: '#d1d5db' } }]));
  const print = new Chart(c, {
    type: ch.config.type,
    data: { labels: [...(ch.data.labels || [])], datasets: ch.data.datasets.map(d => ({ ...d, ...(d.pointBorderColor ? { pointBorderColor: '#ffffff' } : {}) })) },
    options: { ...o, responsive: false, animation: false, devicePixelRatio: 1, maintainAspectRatio: false, scales,
      plugins: { ...o.plugins, legend: { ...o.plugins?.legend, labels: { ...o.plugins?.legend?.labels, color: '#374151', font, boxWidth: 22 } },
        valueLabels: { ...o.plugins?.valueLabels, color: '#374151', size: 20 } } },
    plugins: [{ id: 'papier', beforeDraw: (chart) => { const g = chart.ctx; g.save(); g.fillStyle = '#fff'; g.fillRect(0, 0, chart.width, chart.height); g.restore(); } }],
  });
  const url = c.toDataURL('image/jpeg', 0.92);
  print.destroy();
  return url;
}

async function exportAnalyticsPdf() {
  const btn = document.getElementById('btnExportAnalytics');
  btn.disabled = true;
  try {
    const club = window.CURRENT_PROFILE?.clubs?.nom || 'Le Mans FC';
    const team = typeof currentTeam === 'function' ? currentTeam()?.nom : null;
    const period = document.querySelector('#periodSwitch button.active')?.textContent.trim() || '';
    const { from, to } = periodRange() || {};
    const range = [from, to].every(Boolean) ? `${fmtDate(from)} – ${fmtDate(to)}` : period;
    const k = await openPdf({ accent: window.CURRENT_PROFILE?.clubs?.color, runTitle: 'Bilan des séances', runRight: club });
    k.cover({
      kicker: `${club} · Bilan`,
      title: 'Bilan des séances',
      subtitle: [team || 'Toutes les équipes', period].filter(Boolean).join(' · '),
      facts: [['Période', range], ['Édité le', new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })]],
    });
    const val = (id) => document.getElementById(id)?.textContent.trim() || '—';
    k.kpis([
      { label: 'Séances', value: val('kpiSessions'), sub: 'réalisées' },
      { label: 'Procédés', value: val('kpiProcedures'), sub: 'travaillés' },
      { label: 'Présence', value: val('kpiPresence'), sub: 'moyenne' },
      { label: 'Volume', value: val('kpiVolume'), sub: 'de travail' },
    ]);
    const all = PRINT_CHARTS.map(([id, title]) => ({ title, src: chartForPrint(id) }));
    const shown = all.filter(x => x.src), empty = all.filter(x => !x.src).map(x => x.title);
    k.section('Activité', { keep: shown.length ? 70 : 12 });
    if (!shown.length) k.text('Pas encore assez de données sur cette période.', { color: PDF_MUTE, style: 'italic' });
    const gap = 6, w = (k.CW - gap) / 2, h = w * 520 / 900;
    for (let i = 0; i < shown.length; i += 2) {
      k.ensure(h + 9);
      shown.slice(i, i + 2).forEach((c, j) => {
        const x = k.M + j * (w + gap);
        k.font(8.6, 'bold', PDF_INK); k.write(c.title, x, k.y);
        k.doc.addImage(c.src, 'JPEG', x, k.y + 5.5, w, h);
      });
      k.y += h + 12;
    }
    if (shown.length && empty.length) k.text(`Sans donnée sur la période : ${empty.join(', ').toLowerCase()}.`, { size: 7.6, color: PDF_MUTE });
    k.save(pdfFileName('bilan', team || 'club', new Date().toISOString().slice(0, 10)));
    toast('PDF généré', 'success');
  } catch (e) {
    console.error('Export PDF du bilan impossible', e);
    toast(`Export PDF impossible : ${e.message}`, 'error');
  } finally { btn.disabled = false; }
}
