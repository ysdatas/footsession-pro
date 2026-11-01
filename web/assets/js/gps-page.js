/* ============================================================
   LMFC Performance — gps-page.js (comparaison.html, onglet GPS)
   Données GPS (lmfc_v32.sql), staff :
     - « Importer des données GPS » (admin, préparateur) : fichier →
       date, équipe, séance du jour → Analyser (gps-import.js) → aperçu :
       indicateurs et unités, contrôles, colonnes inconnues (à cocher pour
       les garder sous leur nom), lignes exclues, joueurs reconnus / à
       confirmer / à choisir / non reconnus, doublons → Valider ;
     - comparatif joueurs × indicateurs, pour une séance ou une période
       (moyenne), brut ou par minute, par ligne ; graphique de
       l'indicateur choisi ; période précédente ;
     - historique des imports (annuler) ; indicateurs visibles par les
       joueurs (admin, préparateur).
   La base décide (RLS) ; rien n'est écrasé : un import se crée ou
   s'annule. Dépend de comparaison-page.js (myProfile, roster, render),
   gps-import.js, gps-import-ui.js (openGpsImport), analytics-charts.js (hbar).
   ============================================================ */

const GPS = { imports: [], rows: [], settings: [], loaded: false, metric: 'distance', pick: 'periode', days: 30, perMin: false, line: '' };
const GPS_PER_MIN = new Set(['distance', 'count', 'plain']);   // ramenés à la minute ; vitesse, rythme, durée : non
const gpsCanEdit = () => ['admin', 'prepa'].includes(myProfile?.role);
const gpsInfo = (key) => GPS.imports.flatMap(i => i.colonnes || []).find(c => c.key === key) || { key, label: key, unit: '' };
const gpsNum = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('fr-FR'));
const gpsIsGk = (p) => /gard/i.test(p?.poste || '');

async function gpsLoad() {
  const imp = await byTeam(sb.from('gps_imports').select('id, team_id, session_id, date_seance, libelle, fichier, fournisseur, colonnes, nb_joueurs, created_at, annule_at')
    .order('date_seance', { ascending: false }).limit(80));
  if (imp.error) throw imp.error;
  GPS.imports = imp.data || [];
  const live = GPS.imports.filter(i => !i.annule_at).map(i => i.id);
  const [r, s] = await Promise.all([
    live.length ? sb.from('gps_rows').select('import_id, player_id, nom_lu, metrics').in('import_id', live) : { data: [] },
    sb.from('gps_settings').select('player_metrics').maybeSingle(),
  ]);
  if (r.error) throw r.error;
  GPS.rows = r.data || [];
  GPS.settings = s.data?.player_metrics || [];
  GPS.loaded = true;
}

async function renderGps(content) {
  if (!GPS.loaded) {
    content.innerHTML = '<div class="empty cmp-loading">Chargement des données GPS…</div>';
    try { await gpsLoad(); } catch (e) {
      console.error('GPS illisible', e);
      content.innerHTML = `<div class="empty text-danger">${escapeHtml(['42P01', 'PGRST205'].includes(e?.code) ? 'Le GPS n’est pas encore installé : passez lmfc_v32.sql dans Supabase.' : e.message)}</div>`;
      return;
    }
  }
  const live = GPS.imports.filter(i => !i.annule_at);
  const keys = [...new Set(live.flatMap(i => (i.colonnes || []).map(c => c.key)))].filter(k => k !== 'duree');
  if (!keys.includes(GPS.metric)) GPS.metric = keys[0] || 'distance';
  content.innerHTML = `
    <div class="gps-bar">
      ${gpsCanEdit() ? '<button class="btn btn-primary" type="button" data-gps="import">Importer des données GPS</button>' : ''}
      <label class="cmp-field">Séance<select data-gps-set="pick"><option value="periode">Moyenne de la période</option>
        ${live.map(i => `<option value="${i.id}"${String(GPS.pick) === String(i.id) ? ' selected' : ''}>${gpsDate(i.date_seance)} · ${escapeHtml(i.libelle || i.fichier)}</option>`).join('')}</select></label>
      <label class="cmp-field">Période<select data-gps-set="days">${[[7, '7 jours'], [30, '30 jours'], [90, '90 jours'], [365, '12 mois']].map(([d, l]) => `<option value="${d}"${GPS.days === d ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="cmp-field">Indicateur<select data-gps-set="metric">${keys.map(k => `<option value="${k}"${k === GPS.metric ? ' selected' : ''}>${escapeHtml(gpsInfo(k).label)}</option>`).join('')}</select></label>
      <label class="cmp-field">Ligne<select data-gps-set="line"><option value="">Tous</option><option value="nogk"${GPS.line === 'nogk' ? ' selected' : ''}>Sans les gardiens</option><option value="gk"${GPS.line === 'gk' ? ' selected' : ''}>Gardiens</option></select></label>
      <label class="cmp-check"><input type="checkbox" data-gps-set="perMin"${GPS.perMin ? ' checked' : ''}> Par minute</label>
    </div>
    ${live.length ? gpsCompareHtml(keys) : '<div class="empty">Aucune donnée GPS pour l’instant. Importez l’export de la séance (CSV ou Excel).</div>'}
    ${gpsHistoryHtml()}${gpsCanEdit() && keys.length ? gpsSettingsHtml(keys) : ''}`;
  gpsChart();
}

/* Valeurs d'un joueur : la séance choisie, ou la moyenne de ses séances de la période. */
function gpsPlayerValues(pid, importIds) {
  const rows = GPS.rows.filter(r => r.player_id === pid && importIds.includes(r.import_id));
  if (!rows.length) return null;
  const avg = (k) => { const v = rows.map(r => r.metrics[k]).filter(x => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const keys = new Set(rows.flatMap(r => Object.keys(r.metrics)));
  return { n: rows.length, values: Object.fromEntries([...keys].map(k => [k, avg(k)])) };
}
function gpsCell(vals, key) {
  const v = vals?.[key];
  if (v === null || v === undefined) return null;
  if (GPS.perMin && GPS_PER_MIN.has(gpsInfo(key).kind) && key !== 'duree') return vals.duree ? v / vals.duree : null;
  return v;
}

function gpsScope() {
  const live = GPS.imports.filter(i => !i.annule_at), today = new Date().toISOString().slice(0, 10);
  if (GPS.pick !== 'periode') return { now: live.filter(i => String(i.id) === String(GPS.pick)).map(i => i.id), before: [] };
  const back = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const from = back(GPS.days), prev = back(GPS.days * 2);
  return { now: live.filter(i => i.date_seance >= from && i.date_seance <= today).map(i => i.id), before: live.filter(i => i.date_seance >= prev && i.date_seance < from).map(i => i.id) };
}

function gpsCompareHtml(keys) {
  const scope = gpsScope(), byLine = (p) => (GPS.line === 'gk' ? gpsIsGk(p) : GPS.line === 'nogk' ? !gpsIsGk(p) : true);
  const list = roster.filter(byLine).map(p => ({ p, cur: gpsPlayerValues(p.id, scope.now), old: gpsPlayerValues(p.id, scope.before) })).filter(x => x.cur)
    .sort((a, b) => (gpsCell(b.cur.values, GPS.metric) ?? -1) - (gpsCell(a.cur.values, GPS.metric) ?? -1));
  GPS.chartRows = list.map(x => ({ label: playerFullName(x.p), c: Math.round((gpsCell(x.cur.values, GPS.metric) ?? 0) * 100) / 100 })).filter(r => r.c);
  if (!list.length) return `<div class="empty">Aucune donnée sur ${GPS.pick === 'periode' ? `les ${GPS.days} derniers jours` : 'cette séance'} pour cette équipe.</div>`;
  const durs = list.map(x => x.cur.values.duree).filter(Boolean), spread = durs.length > 1 && Math.max(...durs) / Math.min(...durs) > 1.2;
  const info = gpsInfo(GPS.metric), unit = GPS.perMin && GPS_PER_MIN.has(info.kind) ? `${info.unit || ''}/min` : info.unit;
  return `${spread && !GPS.perMin ? `<p class="gps-warn">Temps de jeu différents (de ${gpsNum(Math.min(...durs), 0)} à ${gpsNum(Math.max(...durs), 0)} min) : comparez « Par minute » pour des valeurs comparables.</p>` : ''}
    <section class="card chart-card gps-chart"><h2 class="chart-title">${escapeHtml(info.label)} <span>${escapeHtml(unit || '')}${GPS.pick === 'periode' ? ` · moyenne sur ${GPS.days} jours` : ''}</span></h2>
      <div class="chart-box" style="height:${Math.max(140, GPS.chartRows.length * 26 + 24)}px"><canvas id="gpsChart" role="img" aria-label="${escapeHtml(info.label)} par joueur (détail dans le tableau)"></canvas></div></section>
    <div class="cmp-table-wrap"><table class="cmp-table gps-table"><thead><tr><th class="p-name">Joueur</th>${keys.map(k => `<th title="${escapeHtml(gpsInfo(k).label)}">${escapeHtml(gpsInfo(k).label)}</th>`).join('')}
      ${GPS.pick === 'periode' ? '<th>Séances</th><th>Période précédente</th>' : ''}</tr></thead>
      <tbody>${list.map(x => `<tr><td class="p-name">${playerLink(x.p.id, playerFullName(x.p))}</td>${keys.map(k => `<td>${gpsNum(gpsCell(x.cur.values, k), k === 'vmax' || GPS.perMin ? 1 : 0)}</td>`).join('')}
        ${GPS.pick === 'periode' ? `<td>${x.cur.n}</td><td>${x.old ? gpsDelta(gpsCell(x.cur.values, GPS.metric), gpsCell(x.old.values, GPS.metric)) : '—'}</td>` : ''}</tr>`).join('')}</tbody></table></div>
    <p class="text-muted cmp-foot">Charge externe mesurée par GPS : jamais additionnée à la charge ressentie (RPE). Case vide : donnée absente du fichier.</p>`;
}
const gpsDelta = (a, b) => (a === null || !b ? '—' : `${gpsNum(b, 0)} → <strong class="${a >= b ? 'gps-up' : 'gps-down'}">${a >= b ? '+' : '−'}${Math.abs(Math.round((a - b) / b * 100))} %</strong>`);

function gpsChart() {
  if (!window.Chart || !document.getElementById('gpsChart') || !GPS.chartRows?.length) return;
  if (!gpsChart.ready) { setChartDefaults(); gpsChart.ready = true; }
  hbar('gpsChart', GPS.chartRows);
}

function gpsHistoryHtml() {
  if (!GPS.imports.length) return '';
  return `<section class="card gps-history"><h2 class="chart-title">Imports <span>${GPS.imports.length}</span></h2><ul>${GPS.imports.map(i => `
    <li class="${i.annule_at ? 'is-off' : ''}"><span><strong>${gpsDate(i.date_seance)}</strong> · ${escapeHtml(i.libelle || i.fichier)} · ${i.nb_joueurs} joueur${i.nb_joueurs > 1 ? 's' : ''}
      <small>${escapeHtml(i.fichier)} · ${escapeHtml(i.fournisseur)} · importé le ${gpsDate(i.created_at)}${i.annule_at ? ` · annulé le ${gpsDate(i.annule_at)}` : ''}</small></span>
      ${gpsCanEdit() && !i.annule_at ? `<button class="btn btn-sm btn-danger" type="button" data-gps="cancel" data-id="${i.id}">Annuler l’import</button>` : ''}</li>`).join('')}</ul></section>`;
}

function gpsSettingsHtml(keys) {
  return `<section class="card gps-settings"><h2 class="chart-title">Visible par les joueurs <span>dans leur espace Performance</span></h2>
    <p class="text-muted">Par défaut, les données GPS sont réservées au staff. Cochez ce que chaque joueur peut voir de ses propres séances ; la base applique ce choix.</p>
    <div class="gps-metrics">${keys.map(k => `<label><input type="checkbox" data-gps-visible="${k}"${GPS.settings.includes(k) ? ' checked' : ''}> ${escapeHtml(gpsInfo(k).label)}</label>`).join('')}</div>
    <button class="btn btn-sm" type="button" data-gps="settings">Enregistrer la visibilité</button></section>`;
}

async function gpsCancel(id) {
  if (!confirm('Annuler cet import ?\n\nIl reste dans l’historique ; ses valeurs sortent des fiches. Les autres imports ne bougent pas.')) return;
  const { data, error } = await sb.rpc('gps_import_cancel', { p_import: id });
  if (error || !data) return toast(error?.message || 'Annulation refusée : droits insuffisants.', 'error');
  toast('Import annulé', 'success');
  GPS.loaded = false;
  render();
}

async function gpsSaveSettings() {
  const metrics = [...document.querySelectorAll('[data-gps-visible]:checked')].map(x => x.dataset.gpsVisible);
  const { error } = await sb.from('gps_settings').upsert({ club_id: myProfile.club_id, player_metrics: metrics, updated_at: new Date().toISOString() });
  if (error) return toast(error.message, 'error');
  GPS.settings = metrics;
  toast(metrics.length ? `${metrics.length} indicateur${metrics.length > 1 ? 's' : ''} visible${metrics.length > 1 ? 's' : ''} par les joueurs` : 'GPS réservé au staff', 'success');
}

document.addEventListener('change', (e) => {
  const k = e.target.dataset?.gpsSet;
  if (!k) return;
  GPS[k] = k === 'perMin' ? e.target.checked : k === 'days' ? Number(e.target.value) : e.target.value;
  render();
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-gps]');
  if (!b) return;
  if (b.dataset.gps === 'import') openGpsImport();
  if (b.dataset.gps === 'cancel') gpsCancel(Number(b.dataset.id));
  if (b.dataset.gps === 'settings') gpsSaveSettings();
});
