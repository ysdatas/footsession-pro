/* ============================================================
   LMFC Performance — gps-page.js (comparaison.html, onglet GPS)
   Données GPS (lmfc_v32.sql), staff, en trois vues courtes :
     - Séance (par défaut : la dernière importée) : les indicateurs clés
       (gpsKeyCols, gps-import.js) en tuiles (moyenne de l'équipe) et
       par joueur, avec le RPE et la charge ressentie (sRPE) du joueur
       sur la séance liée — à côté, jamais additionnés ; « Tous les
       indicateurs » ajoute les autres colonnes ;
     - Joueur, Comparer : gps-views.js ;
     - « Imports » (fenêtre) : l'historique (annuler) et les indicateurs
       visibles par les joueurs (admin, préparateur) ; « Importer des
       données GPS » : gps-import-ui.js.
   ?tab=gps&vue=joueur&joueur=ID ouvre un joueur (lien de sa fiche).
   La base décide (RLS) ; rien n'est écrasé : un import se crée ou
   s'annule. Dépend de comparaison-page.js (myProfile, roster, render),
   gps-import.js, gps-views.js, analytics-charts.js (hbar, columns).
   ============================================================ */

const GPS = { imports: [], rows: [], settings: [], loaded: false, view: 'seance', seance: null, all: false, sort: null,
  player: null, pmetric: 'distance', pdays: 90, metric: 'distance', pick: 'periode', days: 30, perMin: false, line: '', rpe: new Map(), dur: new Map() };
{
  const q = new URLSearchParams(location.search);
  if (['joueur', 'comparer'].includes(q.get('vue'))) GPS.view = q.get('vue');
  GPS.player = Number(q.get('joueur')) || null;
}
const GPS_PER_MIN = new Set(['distance', 'count', 'plain']);   // ramenés à la minute ; vitesse, rythme, durée : non
const gpsCanEdit = () => ['admin', 'prepa'].includes(myProfile?.role);
const gpsInfo = (key) => GPS.imports.flatMap(i => i.colonnes || []).find(c => c.key === key) || { key, label: key, unit: '' };
const gpsNum = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('fr-FR'));
const gpsDec = (c) => (['speed', 'rate', 'plain'].includes(c.kind) ? 1 : 0);
const gpsIsGk = (p) => /gard/i.test(p?.poste || '');
const gpsLive = () => GPS.imports.filter(i => !i.annule_at);
const gpsName = (pid, fallback = '') => { const p = roster.find(x => x.id === pid); return p ? playerFullName(p) : fallback; };
/* RPE du joueur sur la séance liée à l'import, et sa charge ressentie (RPE × durée de la séance). */
function gpsRpe(imp, pid) {
  const rpe = imp?.session_id ? GPS.rpe.get(`${imp.session_id}:${pid}`) : null, dur = imp?.session_id ? GPS.dur.get(imp.session_id) : null;
  return { rpe: rpe ?? null, load: rpe && dur ? rpe * dur : null };
}

async function gpsLoad() {
  const imp = await byTeam(sb.from('gps_imports').select('id, team_id, session_id, date_seance, libelle, fichier, fournisseur, colonnes, nb_joueurs, created_at, annule_at')
    .order('date_seance', { ascending: false }).limit(80));
  if (imp.error) throw imp.error;
  GPS.imports = imp.data || [];
  const live = gpsLive().map(i => i.id), sessions = [...new Set(gpsLive().map(i => i.session_id).filter(Boolean))];
  const [r, s, rp, se] = await Promise.all([
    live.length ? sb.from('gps_rows').select('import_id, player_id, nom_lu, metrics').in('import_id', live) : { data: [] },
    sb.from('gps_settings').select('player_metrics').maybeSingle(),
    sessions.length ? sb.from('session_rpe').select('session_id, player_id, rpe').in('session_id', sessions) : { data: [] },
    sessions.length ? sb.from('sessions').select('id, duree_min').in('id', sessions) : { data: [] },
  ]);
  if (r.error) throw r.error;
  GPS.rows = r.data || [];
  GPS.settings = s.data?.player_metrics || [];
  GPS.rpe = new Map((rp.data || []).map(x => [`${x.session_id}:${x.player_id}`, x.rpe]));   // sans lmfc_v29 : vide
  GPS.dur = new Map((se.data || []).map(x => [x.id, Number(x.duree_min) || null]));
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
  const live = gpsLive();
  document.getElementById('cmpSub').textContent = `GPS · ${live.length} séance${live.length > 1 ? 's' : ''} importée${live.length > 1 ? 's' : ''}`;
  const views = [['seance', 'Séance'], ['joueur', 'Joueur'], ['comparer', 'Comparer']];
  GPS.chartRows = null;   // chaque vue pose le sien
  content.innerHTML = `
    <div class="gps-head">
      <div class="segmented" role="group" aria-label="Vue GPS">${views.map(([k, l]) => `<button type="button" data-gps-view="${k}" aria-pressed="${GPS.view === k}">${l}</button>`).join('')}</div>
      <div class="gps-actions">${GPS.imports.length ? `<button class="btn" type="button" data-gps="imports">Imports · ${GPS.imports.length}</button>` : ''}
        ${gpsCanEdit() ? '<button class="btn btn-primary" type="button" data-gps="import">Importer des données GPS</button>' : ''}</div>
    </div>
    ${!live.length ? '<div class="empty">Aucune donnée GPS pour l’instant. Importez l’export de la séance (CSV ou Excel).</div>'
      : GPS.view === 'joueur' ? gpsPlayerHtml(live) : GPS.view === 'comparer' ? gpsCompareView(live) : gpsSeanceHtml(live)}`;
  gpsChart();
}

/* ---------- Vue Séance ---------- */
function gpsSeanceHtml(live) {
  const imp = live.find(i => i.id === GPS.seance) || live.reduce((a, b) => (b.date_seance > a.date_seance ? b : a));   // par défaut : la plus récente
  GPS.seance = imp.id;
  const cols = imp.colonnes || [], keys = gpsKeyCols(cols);
  const extra = GPS.all ? cols.filter(c => !keys.some(k => k.key === c.key)) : [];
  const shown = [...keys, ...extra], val = (r, c) => gpsKeyValue(r.metrics, c);
  const rows = GPS.rows.filter(r => r.import_id === imp.id).map(r => ({ ...r, name: gpsName(r.player_id, r.nom_lu), ...gpsRpe(imp, r.player_id) }));
  const sort = GPS.sort && [...shown.map(c => c.key), 'rpe', 'load'].includes(GPS.sort) ? GPS.sort : keys[0]?.key;
  const sortVal = (r) => (sort === 'rpe' || sort === 'load' ? r[sort] : val(r, shown.find(c => c.key === sort) || {}));
  rows.sort((a, b) => (sortVal(b) ?? -1) - (sortVal(a) ?? -1) || a.name.localeCompare(b.name, 'fr'));
  const mean = (c) => { const v = rows.map(r => val(r, c)).filter(x => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const th = (k, l, unit, title = l) => `<th scope="col" aria-sort="${sort === k ? 'descending' : 'none'}"><button type="button" data-gps-sort="${k}" title="${escapeHtml(title)} : trier">${escapeHtml(l)}${unit ? ` <small>${escapeHtml(unit)}</small>` : ''}</button></th>`;
  const hasRpe = rows.some(r => r.rpe !== null);
  return `<div class="gps-bar">
      <label class="cmp-field">Séance<select data-gps-set="seance">${live.map(i => `<option value="${i.id}"${i.id === imp.id ? ' selected' : ''}>${gpsDate(i.date_seance)} · ${escapeHtml(i.libelle || i.fichier)}</option>`).join('')}</select></label>
      <label class="cmp-check"><input type="checkbox" data-gps-set="all"${GPS.all ? ' checked' : ''}> Tous les indicateurs</label>
    </div>
    <div class="gps-last gps-tiles">${keys.map(c => `<div><b>${gpsNum(mean(c), gpsDec(c))}<small> ${escapeHtml(c.unit || '')}</small></b><span>${escapeHtml(c.label)}</span></div>`).join('')}</div>
    <p class="gps-sub">Moyenne des ${rows.length} joueur${rows.length > 1 ? 's' : ''} de la séance${imp.session_id ? '' : ' · import sans séance liée : pas de RPE'}.</p>
    <div class="cmp-table-wrap"><table class="cmp-table gps-table"><thead><tr><th scope="col" class="p-name">Joueur</th>
      ${shown.map(c => th(c.key, c.short || c.label, c.unit, c.label)).join('')}${th('rpe', 'RPE', '1-10', 'RPE du joueur')}${th('load', 'sRPE', 'UA', 'Charge ressentie')}</tr></thead>
      <tbody>${rows.map(r => `<tr><td class="p-name"><button type="button" class="gps-who" data-gps-player="${r.player_id}">${escapeHtml(r.name)}</button></td>
        ${shown.map(c => `<td>${gpsNum(val(r, c), gpsDec(c))}</td>`).join('')}<td>${r.rpe ?? '—'}</td><td>${gpsNum(r.load, 0)}</td></tr>`).join('')}</tbody></table></div>
    <p class="text-muted cmp-foot">Charge externe (GPS) et charge ressentie (sRPE = RPE × durée de la séance) côte à côte, jamais additionnées.${hasRpe ? '' : ' Aucun RPE sur cette séance.'}
      « calculée » : somme des bandes de vitesse du fichier. Case vide : donnée absente.</p>`;
}

function gpsChart() {
  if (!window.Chart || !GPS.chartRows?.length) return;
  if (!gpsChart.ready) { setChartDefaults(); gpsChart.ready = true; }
  if (document.getElementById('gpsChart')) hbar('gpsChart', GPS.chartRows);
  if (document.getElementById('gpsPlayerChart')) columns('gpsPlayerChart', GPS.chartRows);
}

/* ---------- Fenêtre « Imports » : historique, visibilité joueurs ---------- */
function gpsImportsOpen() {
  if (!document.getElementById('gpsImportsModal')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="gpsImportsModal"><div class="modal gps-modal" role="dialog" aria-modal="true" aria-labelledby="gpsImportsTitle">
      <h2 class="as-h3" id="gpsImportsTitle">Imports GPS</h2><div id="gpsImportsBody"></div>
      <div class="modal-actions"><button class="btn" type="button" data-close="gpsImportsModal">Fermer</button></div></div></div>`);
  }
  const keys = [...new Set(gpsLive().flatMap(i => (i.colonnes || []).map(c => c.key)))].filter(k => k !== 'duree');
  document.getElementById('gpsImportsBody').innerHTML = gpsHistoryHtml() + (gpsCanEdit() && keys.length ? gpsSettingsHtml(keys) : '');
  openModal('gpsImportsModal');
}
function gpsHistoryHtml() {
  return `<section class="gps-history"><ul>${GPS.imports.map(i => `
    <li class="${i.annule_at ? 'is-off' : ''}"><span><strong>${gpsDate(i.date_seance)} · ${escapeHtml(i.libelle || i.fichier)}</strong>
      <small>${i.nb_joueurs} joueur${i.nb_joueurs > 1 ? 's' : ''} · ${escapeHtml(i.fichier)} · ${escapeHtml(i.fournisseur)} · importé le ${gpsDate(i.created_at)}${i.annule_at ? ` · annulé le ${gpsDate(i.annule_at)}` : ''}</small></span>
      ${gpsCanEdit() && !i.annule_at ? `<button class="btn btn-sm btn-danger" type="button" data-gps="cancel" data-id="${i.id}">Annuler l’import</button>` : ''}</li>`).join('')}</ul></section>`;
}
function gpsSettingsHtml(keys) {
  return `<section class="gps-settings"><h3 class="as-h4">Visible par les joueurs <small>dans leur espace Performance</small></h3>
    <p class="text-muted">Par défaut, les données GPS sont réservées au staff. Cochez ce que chaque joueur peut voir de ses propres séances ; la base applique ce choix.</p>
    <div class="gps-metrics">${keys.map(k => `<label><input type="checkbox" data-gps-visible="${k}"${GPS.settings.includes(k) ? ' checked' : ''}> ${escapeHtml(gpsInfo(k).label)}</label>`).join('')}</div>
    <button class="btn btn-sm" type="button" data-gps="settings">Enregistrer la visibilité</button></section>`;
}

async function gpsCancel(id) {
  if (!confirm('Annuler cet import ?\n\nIl reste dans l’historique ; ses valeurs sortent des fiches. Les autres imports ne bougent pas.')) return;
  const { data, error } = await sb.rpc('gps_import_cancel', { p_import: id });
  if (error || !data) return toast(error?.message || 'Annulation refusée : droits insuffisants.', 'error');
  toast('Import annulé', 'success');
  closeModal('gpsImportsModal');
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

/* ---------- Événements ---------- */
function gpsUrl() {
  const u = new URL(location.href);
  if (GPS.view === 'seance') u.searchParams.delete('vue'); else u.searchParams.set('vue', GPS.view);
  if (GPS.view === 'joueur' && GPS.player) u.searchParams.set('joueur', GPS.player); else u.searchParams.delete('joueur');
  history.replaceState(null, '', u);
}
const GPS_NUM = new Set(['days', 'pdays', 'seance', 'player']);
document.addEventListener('change', (e) => {
  const k = e.target.dataset?.gpsSet;
  if (!k) return;
  GPS[k] = e.target.type === 'checkbox' ? e.target.checked : GPS_NUM.has(k) ? Number(e.target.value) : e.target.value;
  if (k === 'player') gpsUrl();
  render();
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-gps], [data-gps-view], [data-gps-sort], [data-gps-player]');
  if (!b) return;
  if (b.dataset.gpsView) { GPS.view = b.dataset.gpsView; gpsUrl(); render(); }
  if (b.dataset.gpsSort) { GPS.sort = b.dataset.gpsSort; render(); }
  if (b.dataset.gpsPlayer) { GPS.player = Number(b.dataset.gpsPlayer); GPS.view = 'joueur'; gpsUrl(); render(); }
  if (b.dataset.gps === 'import') openGpsImport();
  if (b.dataset.gps === 'imports') gpsImportsOpen();
  if (b.dataset.gps === 'cancel') gpsCancel(Number(b.dataset.id));
  if (b.dataset.gps === 'settings') gpsSaveSettings();
});
