/* ============================================================
   LMFC Performance — gps-card.js (player-performance.html)
   Carte « GPS » de l'onglet Performance (lmfc_v32.sql) :
     - staff : ses séances GPS (imports non annulés), la dernière en
       chiffres, l'évolution d'un indicateur au choix, et la charge
       ressentie (RPE × durée) de la même séance, à côté, jamais additionnée
       (charge externe mesurée / charge interne ressentie) ; lien vers la
       vue Joueur de l'onglet GPS de Performance ;
     - joueur : my_gps(), seulement les indicateurs que le staff a ouverts.
   Cachée s'il n'y a rien à montrer (ou si lmfc_v32.sql n'est pas passée).
   Dépend de app.js, rpe.js (rpeDate).
   ============================================================ */

const GC = { rows: [], metric: null, labels: {}, rpe: new Map(), link: '' };
const GC_MAIN = ['distance', 'duree', 'vmax', 'dist_gt25', 'rate_gt20', 'sprints', 'acc_gt3', 'dec_gt3'];
const gcNum = (v, k) => (v === null || v === undefined ? '—' : (Math.round(v * (k === 'vmax' || k.startsWith('rate') ? 10 : 1)) / (k === 'vmax' || k.startsWith('rate') ? 10 : 1)).toLocaleString('fr-FR'));

async function renderGpsCard(playerId, asPlayer) {
  const card = document.getElementById('gpsCard');
  if (!card) return;
  GC.link = asPlayer ? '' : `comparaison.html?tab=gps&vue=joueur&joueur=${Number(playerId)}`;   // staff : la vue Joueur de l'onglet GPS
  let rows;
  if (asPlayer) {
    const { data, error } = await sb.rpc('my_gps');
    if (error) { if (error.code !== 'PGRST202') console.warn('GPS : indisponible', error.message); return; }
    rows = (data || []).filter(r => r.metrics && Object.keys(r.metrics).length).map(r => ({ date: r.date_seance, libelle: r.libelle, metrics: r.metrics, colonnes: [] }));
  } else {
    const { data, error } = await sb.from('gps_rows').select('metrics, gps_imports!inner(date_seance, libelle, session_id, colonnes, annule_at)')
      .eq('player_id', playerId).is('gps_imports.annule_at', null).limit(200);
    if (error) { if (!['42P01', 'PGRST205', 'PGRST200'].includes(error.code)) console.warn('GPS : indisponible', error.message); return; }
    rows = (data || []).map(r => ({ date: r.gps_imports.date_seance, libelle: r.gps_imports.libelle, session: r.gps_imports.session_id, metrics: r.metrics, colonnes: r.gps_imports.colonnes || [] }));
    const sessions = [...new Set(rows.map(r => r.session).filter(Boolean))];
    if (sessions.length) {
      const [rp, se] = await Promise.all([sb.from('session_rpe').select('session_id, rpe').eq('player_id', playerId).in('session_id', sessions),
        sb.from('sessions').select('id, duree_min').in('id', sessions)]);
      const dur = new Map((se.data || []).map(s => [s.id, Number(s.duree_min) || null]));
      GC.rpe = new Map((rp.data || []).map(r => [r.session_id, { rpe: r.rpe, load: dur.get(r.session_id) ? r.rpe * dur.get(r.session_id) : null }]));
    }
  }
  if (!rows.length) return;
  rows.sort((a, b) => a.date.localeCompare(b.date));
  GC.rows = rows;
  GC.labels = Object.fromEntries(rows.flatMap(r => r.colonnes).map(c => [c.key, c.label]));
  const keys = [...new Set(rows.flatMap(r => Object.keys(r.metrics)))];
  GC.metric = keys.includes(GC.metric) ? GC.metric : keys.includes('distance') ? 'distance' : keys[0];
  card.classList.remove('hidden');
  gcDraw(keys);
  card.querySelector('#gpsMetric').addEventListener('change', (e) => { GC.metric = e.target.value; gcDraw(keys); });
}

const gcLabel = (k) => GC.labels[k] || { distance: 'Distance totale', duree: 'Temps', vmax: 'Vitesse max', sprints: 'Sprints', rythme: 'Rythme' }[k] || k;

function gcDraw(keys) {
  const last = GC.rows.at(-1), shown = GC_MAIN.filter(k => last.metrics[k] != null).concat(Object.keys(last.metrics).filter(k => !GC_MAIN.includes(k))).slice(0, 8);
  const series = GC.rows.slice(-12).map(r => ({ d: r.date, v: r.metrics[GC.metric] })).filter(x => x.v != null), max = Math.max(...series.map(x => x.v), 1);
  const rpe = last.session && GC.rpe.get(last.session);
  document.getElementById('gpsCardBody').innerHTML = `
    <div class="gps-card-head"><p class="text-muted">Dernière séance : <strong>${rpeDate(last.date)}</strong>${last.libelle ? ` · ${escapeHtml(last.libelle)}` : ''} · ${GC.rows.length} séance${GC.rows.length > 1 ? 's' : ''} mesurée${GC.rows.length > 1 ? 's' : ''}</p>
      <label class="cmp-field">Évolution<select id="gpsMetric">${keys.map(k => `<option value="${k}"${k === GC.metric ? ' selected' : ''}>${escapeHtml(gcLabel(k))}</option>`).join('')}</select></label>
      ${GC.link ? `<a class="btn btn-sm" href="${GC.link}">Tout son GPS →</a>` : ''}</div>
    <div class="gps-last">${shown.map(k => `<div><b>${gcNum(last.metrics[k], k)}</b><span>${escapeHtml(gcLabel(k))}</span></div>`).join('')}</div>
    <div class="gps-bars" role="list" aria-label="${escapeHtml(gcLabel(GC.metric))} séance par séance">${series.map(x => `<div role="listitem" title="${rpeDate(x.d)} : ${gcNum(x.v, GC.metric)}">
      <b>${gcNum(x.v, GC.metric)}</b><i style="--h:${Math.round(x.v / max * 110)}px"></i><small>${rpeDate(x.d).slice(0, 5)}</small></div>`).join('')}</div>
    ${rpe ? `<p class="gps-rpe">Même séance, ressenti du joueur : RPE ${rpe.rpe}/10${rpe.load ? ` · charge ressentie ${Math.round(rpe.load)} UA` : ''}. Charge interne, à lire à côté de la charge externe mesurée par GPS, jamais additionnée.</p>` : ''}`;
}
