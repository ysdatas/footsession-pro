/* ============================================================
   LMFC Performance — gps-views.js (comparaison.html, onglet GPS)
   Vues Joueur et Comparer de l'onglet GPS (gps-page.js : état GPS,
   chargement, vue Séance) :
     - Joueur : un joueur, une période ; un indicateur séance par
       séance (graphique), puis chaque séance avec les indicateurs
       clés, son RPE et sa charge ressentie (à côté, jamais additionnés) ;
     - Comparer : joueurs × indicateurs pour une séance ou une période
       (moyenne), brut ou par minute, par ligne ; période précédente.
   ============================================================ */

const GPS_DAYS = [[7, '7 jours'], [30, '30 jours'], [90, '90 jours'], [365, '12 mois']];
const gpsSince = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };
const gpsDaysOptions = (cur) => GPS_DAYS.map(([d, l]) => `<option value="${d}"${cur === d ? ' selected' : ''}>${l}</option>`).join('');

/* ---------- Joueur ---------- */
function gpsPlayerHtml(live) {
  const ids = new Set(GPS.rows.map(r => r.player_id));
  const players = roster.filter(p => ids.has(p.id)).sort((a, b) => playerFullName(a).localeCompare(playerFullName(b), 'fr'));
  if (!players.length) return '<div class="empty">Aucun joueur de cette équipe dans les imports GPS.</div>';
  if (!players.some(p => p.id === GPS.player)) GPS.player = players[0].id;
  const from = gpsSince(GPS.pdays), byId = new Map(live.map(i => [i.id, i]));
  const list = GPS.rows.filter(r => r.player_id === GPS.player && byId.get(r.import_id)?.date_seance >= from)
    .map(r => ({ ...r, imp: byId.get(r.import_id), ...gpsRpe(byId.get(r.import_id), r.player_id) }))
    .sort((a, b) => a.imp.date_seance.localeCompare(b.imp.date_seance));
  const cols = [...new Map(list.flatMap(x => x.imp.colonnes || []).map(c => [c.key, c])).values()], keys = gpsKeyCols(cols);
  const metric = keys.find(c => c.key === GPS.pmetric) || keys[0];
  GPS.chartRows = metric ? list.map(x => ({ label: gpsDate(x.imp.date_seance).slice(0, 5), c: Math.round((gpsKeyValue(x.metrics, metric) ?? 0) * 10) / 10 })) : null;
  const bar = `<div class="gps-bar">
      <label class="cmp-field">Joueur<select data-gps-set="player">${players.map(p => `<option value="${p.id}"${p.id === GPS.player ? ' selected' : ''}>${escapeHtml(playerFullName(p))}</option>`).join('')}</select></label>
      <label class="cmp-field">Période<select data-gps-set="pdays">${gpsDaysOptions(GPS.pdays)}</select></label>
      ${keys.length ? `<label class="cmp-field">Indicateur<select data-gps-set="pmetric">${keys.map(c => `<option value="${c.key}"${c === metric ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}</select></label>` : ''}
      <p class="gps-link">${playerLink(GPS.player, 'Fiche du joueur →')}</p>
    </div>`;
  if (!list.length) return `${bar}<div class="empty">Aucune séance GPS sur cette période.</div>`;
  return `${bar}
    <section class="card chart-card gps-chart"><h2 class="chart-title">${escapeHtml(metric.label)} <span>${escapeHtml(metric.unit || '')} · séance par séance</span></h2>
      <div class="chart-box"><canvas id="gpsPlayerChart" role="img" aria-label="${escapeHtml(metric.label)} à chaque séance (détail dans le tableau)"></canvas></div></section>
    <div class="cmp-table-wrap"><table class="cmp-table gps-table"><thead><tr><th scope="col" class="p-name">Séance</th>
      ${keys.map(c => `<th scope="col" title="${escapeHtml(c.label)}">${escapeHtml(c.short || c.label)}${c.unit ? ` <small>${escapeHtml(c.unit)}</small>` : ''}</th>`).join('')}<th scope="col">RPE</th><th scope="col" title="Charge ressentie">sRPE <small>UA</small></th></tr></thead>
      <tbody>${[...list].reverse().map(x => `<tr><td class="p-name">${gpsDate(x.imp.date_seance)} · ${escapeHtml(x.imp.libelle || x.imp.fichier)}</td>
        ${keys.map(c => `<td>${gpsNum(gpsKeyValue(x.metrics, c), gpsDec(c))}</td>`).join('')}<td>${x.rpe ?? '—'}</td><td>${gpsNum(x.load, 0)}</td></tr>`).join('')}</tbody></table></div>
    <p class="text-muted cmp-foot">RPE et charge ressentie : réponse du joueur sur la séance liée à l’import. Case vide : donnée absente.</p>`;
}

/* ---------- Comparer ---------- */
function gpsCompareView(live) {
  const keys = [...new Set(live.flatMap(i => (i.colonnes || []).map(c => c.key)))].filter(k => k !== 'duree');
  if (!keys.includes(GPS.metric)) GPS.metric = keys[0] || 'distance';
  return `<div class="gps-bar">
      <label class="cmp-field">Séance<select data-gps-set="pick"><option value="periode">Moyenne de la période</option>
        ${live.map(i => `<option value="${i.id}"${String(GPS.pick) === String(i.id) ? ' selected' : ''}>${gpsDate(i.date_seance)} · ${escapeHtml(i.libelle || i.fichier)}</option>`).join('')}</select></label>
      <label class="cmp-field">Période<select data-gps-set="days">${gpsDaysOptions(GPS.days)}</select></label>
      <label class="cmp-field">Indicateur<select data-gps-set="metric">${keys.map(k => `<option value="${k}"${k === GPS.metric ? ' selected' : ''}>${escapeHtml(gpsInfo(k).label)}</option>`).join('')}</select></label>
      <label class="cmp-field">Ligne<select data-gps-set="line"><option value="">Tous</option><option value="nogk"${GPS.line === 'nogk' ? ' selected' : ''}>Sans les gardiens</option><option value="gk"${GPS.line === 'gk' ? ' selected' : ''}>Gardiens</option></select></label>
      <label class="cmp-check"><input type="checkbox" data-gps-set="perMin"${GPS.perMin ? ' checked' : ''}> Par minute</label>
    </div>${gpsCompareHtml(keys)}`;
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
  const live = gpsLive(), today = new Date().toISOString().slice(0, 10);
  if (GPS.pick !== 'periode') return { now: live.filter(i => String(i.id) === String(GPS.pick)).map(i => i.id), before: [] };
  const from = gpsSince(GPS.days), prev = gpsSince(GPS.days * 2);
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
      <tbody>${list.map(x => `<tr><td class="p-name"><button type="button" class="gps-who" data-gps-player="${x.p.id}">${escapeHtml(playerFullName(x.p))}</button></td>${keys.map(k => `<td>${gpsNum(gpsCell(x.cur.values, k), k === 'vmax' || GPS.perMin ? 1 : 0)}</td>`).join('')}
        ${GPS.pick === 'periode' ? `<td>${x.cur.n}</td><td>${x.old ? gpsDelta(gpsCell(x.cur.values, GPS.metric), gpsCell(x.old.values, GPS.metric)) : '—'}</td>` : ''}</tr>`).join('')}</tbody></table></div>
    <p class="text-muted cmp-foot">Charge externe mesurée par GPS : jamais additionnée à la charge ressentie (RPE). Case vide : donnée absente du fichier.</p>`;
}
const gpsDelta = (a, b) => (a === null || !b ? '—' : `${gpsNum(b, 0)} → <strong class="${a >= b ? 'gps-up' : 'gps-down'}">${a >= b ? '+' : '−'}${Math.abs(Math.round((a - b) / b * 100))} %</strong>`);
