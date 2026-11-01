/* ============================================================
   LMFC Performance — suivi-rpe-dash.js (suivi-rpe.html)
   Tableau de bord du Suivi RPE pour l'équipe choisie : tuiles, RPE
   moyen par séance (et RPE attendue en repère), charge ressentie par
   séance, RPE moyen de chaque joueur, tableau des séances. Calculs : rpe-stats.js ; graphiques :
   Chart.js et analytics-charts.js (make, columns, catAxis, valAxis).
   Charge prévue (durée, temps de travail des procédés) et charge
   ressentie (sRPE) restent dans des colonnes et des graphiques à part.
   ============================================================ */

const srInt = (x) => (x === null || x === undefined ? '—' : Math.round(x).toLocaleString('fr-FR'));
const srPct = (x) => (x === null ? '' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x * 100))} %`);
const srDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;   // axe des graphiques : court, sans rotation
const srKpi = (num, label) => `<div class="card kpi"><div class="kpi-num">${num}</div><div class="kpi-label">${label}</div></div>`;
const srGap = (g) => (g === null || g === undefined ? '—' : `<span class="sr-gap">${rpeGapFr(g)}</span>`);
const srChip = (avg) => (avg === null ? '—' : `<span class="sr-chip" style="--rpe:${rpeColor(avg)}">${rpeFr(avg)}</span>`);

function renderSrDash(body, sessions, players, cells) {
  const st = rpeSummary(sessions, cells), t = st.total;
  const ranked = players.map((p, i) => ({ p, ...st.perPlayer[i] })).filter(x => x.n).sort((a, b) => b.avg - a.avg);
  const rows = sessions.map((s, j) => ({ s, ...st.perSession[j] })).reverse();   // la plus récente en haut
  body.innerHTML = `
    <div class="kpi-grid kpi-band sr-kpis">
      ${srKpi(t.avg === null ? '—' : rpeFr(t.avg), 'RPE moyen')}
      ${srKpi(`${t.n}<span class="kpi-of">/${t.due}</span>`, `Réponses${t.rate === null ? '' : ` · ${Math.round(t.rate * 100)} %`}`)}
      ${srKpi(t.missing, `Réponses manquantes${t.pending ? ` · ${t.pending} en attente` : ''}`)}
      ${t.gapN ? srKpi(rpeGapFr(t.gap), 'Écart à la RPE attendue') : ''}
      ${srKpi(srInt(t.load), 'Charge ressentie moyenne (UA)')}
    </div>
    <div class="charts-grid sr-charts">
      <section class="card chart-card"><h2 class="chart-title">RPE moyen par séance <span>1 à 10${t.gapN ? ' · trait : RPE attendue' : ''}</span></h2>
        <div class="chart-box"><canvas id="srRpeChart" role="img" aria-label="RPE moyen de l’équipe à chaque séance (détail dans le tableau Séances)"></canvas></div></section>
      <section class="card chart-card"><h2 class="chart-title">Charge ressentie par séance <span>UA, moyenne de l’équipe</span></h2>
        <div class="chart-box"><canvas id="srLoadChart" role="img" aria-label="Charge ressentie moyenne à chaque séance (détail dans le tableau Séances)"></canvas></div></section>
    </div>
    <section class="card chart-card sr-block"><h2 class="chart-title">Joueurs <span>RPE moyen sur la période, du plus élevé au plus faible</span></h2>
      ${ranked.length ? `<div class="chart-box" style="height:${Math.max(140, ranked.length * 26 + 24)}px"><canvas id="srPlayersChart" role="img" aria-label="RPE moyen de chaque joueur"></canvas></div>`
        : '<p class="text-muted">Aucune réponse sur ces séances.</p>'}</section>
    <section class="card sr-block"><h2 class="chart-title">Séances <span>charge prévue et charge ressentie, à part</span></h2>
      <div class="sr-table-wrap"><table class="table sr-table">
        <thead><tr><th scope="col">Séance</th><th scope="col">Durée prévue</th><th scope="col">Travail prévu</th>
          <th scope="col">RPE attendue</th><th scope="col">RPE moyen</th><th scope="col">Écart RPE</th>
          <th scope="col">Charge ressentie</th><th scope="col">Variation</th><th scope="col">Réponses</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <th scope="row"><a href="session-edit.html?id=${r.s.id}"><span class="sr-date">${srShort(r.s.date_seance)}</span> ${escapeHtml(r.s.titre)}</a></th>
          <td>${r.duree ? `${fmtMin(r.duree)} min` : '—'}</td><td>${r.travail ? `${fmtMin(r.travail)} min` : '—'}</td>
          <td>${r.expected ?? '—'}</td><td>${srChip(r.avg)}</td><td>${srGap(r.gap)}</td><td>${r.load === null ? '—' : `${srInt(r.load)} UA`}</td>
          <td class="${r.delta > 0 ? 'sr-up' : r.delta < 0 ? 'sr-down' : ''}">${srPct(r.delta) || '—'}</td>
          <td>${r.n}/${r.due}${r.missing ? ` <span class="sr-miss-n">${r.missing} manquante${r.missing > 1 ? 's' : ''}</span>` : ''}${r.pending ? ` <span class="sr-miss-n">${r.pending} en attente</span>` : ''}</td></tr>`).join('')}</tbody>
      </table></div></section>
    <p class="sr-method"><strong>Charge ressentie</strong> = RPE du joueur × durée totale de la séance (min), en unités arbitraires (UA, méthode sRPE de Foster).
      La durée est celle saisie dans la séance : une participation partielle n’est pas connue. Le <strong>travail prévu</strong> est le temps de travail des procédés.
      Variation : charge ressentie comparée à la séance précédente.
      <strong>Écart RPE</strong> = RPE moyen déclaré − RPE attendue (saisie dans la séance) : +2 = séance ressentie 2 points plus dure que prévu ; il ne dépend pas de la durée.
      Une réponse manquante n’est jamais remplacée : elle sort des moyennes ; « en attente » = le joueur peut encore répondre (jusqu’à J+2).
      La charge mesurée par GPS n’est jamais additionnée à ces chiffres.</p>`;
  if (!window.Chart) return;   // CDN indisponible : tuiles et tableau suffisent
  make('srRpeChart', { type: 'bar',
    data: { labels: sessions.map(s => srDay(s.date_seance)), datasets: [{ data: st.perSession.map(x => x.avg ?? 0),
      backgroundColor: st.perSession.map(x => (x.avg === null ? MUTED : rpeColor(x.avg))), borderRadius: 4, borderSkipped: 'start', maxBarThickness: 36, categoryPercentage: .72 },
      // RPE attendue : un trait horizontal par-dessus la barre (order -1), sans étiquette (valueLabels ignore ce jeu)
      ...(st.perSession.some(x => x.expected) ? [{ type: 'line', data: st.perSession.map(x => x.expected), showLine: false, pointStyle: 'line',
        pointRadius: 15, pointHoverRadius: 15, pointBorderWidth: 3, pointHoverBorderWidth: 3, pointBorderColor: '#F5F5F5', borderColor: '#F5F5F5', order: -1, noValueLabel: true }] : [])] },
    options: { ...noLegend, layout: { padding: { top: 18 } },
      plugins: { ...noLegend.plugins, valueLabels: { display: true, format: (v) => rpeFr(v) },
        tooltip: { callbacks: { title: (it) => { const s = sessions[it[0].dataIndex]; return `${srShort(s.date_seance)} · ${s.titre}`; },
          label: (it) => { const x = st.perSession[it.dataIndex];
            return [`RPE moyen ${x.avg === null ? '—' : rpeFr(x.avg)} · ${x.n}/${x.due} réponses`, ...(x.expected ? [`RPE attendue ${x.expected} · écart ${x.gap === null ? '—' : rpeGapFr(x.gap)}`] : [])]; } },
          filter: (it) => it.datasetIndex === 0 } },
      scales: { x: catAxis, y: { ...valAxis, max: 10 } } } });
  columns('srLoadChart', sessions.map((s, j) => ({ label: srDay(s.date_seance), c: Math.round(st.perSession[j].load || 0) })));
  if (ranked.length) make('srPlayersChart', { type: 'bar',
    data: { labels: ranked.map(x => playerFullName(x.p)), datasets: [{ data: ranked.map(x => x.avg), backgroundColor: ranked.map(x => rpeColor(x.avg)),
      borderRadius: 4, borderSkipped: 'start', maxBarThickness: 18, categoryPercentage: .72 }] },
    options: { ...noLegend, indexAxis: 'y', layout: { padding: { right: 36 } },
      plugins: { ...noLegend.plugins, valueLabels: { display: true, format: (v) => rpeFr(v) },
        tooltip: { callbacks: { label: (it) => { const x = ranked[it.dataIndex];
          return `RPE moyen ${rpeFr(x.avg)} · ${x.n} réponse${x.n > 1 ? 's' : ''}${x.missing ? ` · ${x.missing} manquante${x.missing > 1 ? 's' : ''}` : ''}${x.load === null ? '' : ` · charge ${srInt(x.load)} UA`}`; } } } },
      scales: { y: { ...catAxis, ticks: { ...catAxis.ticks, autoSkip: false, callback: shortLabel } }, x: { ...valAxis, max: 10 } } } });
}
