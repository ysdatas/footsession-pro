/* ============================================================
   LMFC Performance — rpe-pdf.js (suivi-rpe.html)
   Export PDF du Suivi RPE : l'équipe et les séances affichées (SR,
   suivi-rpe-page.js), calculs de rpe-stats.js, mise en page commune
   (pdf-kit.js). On coche le contenu ; le choix est gardé dans ce
   navigateur pour la fois suivante. Graphiques dessinés en vectoriel à
   la largeur de la page ; détail joueur × séance en tableaux de 8
   séances, jamais plus larges que la page. Rien n'est recalculé ni
   complété : une donnée absente reste « — ».
   ============================================================ */

const SR_PDF_KEY = 'lmfc-rpe-pdf';
const SR_PDF_COLS = 8;   // séances par tableau de détail au plus (A4 portrait), réparties à parts égales
const srPdfFr = (x, d = 1) => (x === null || x === undefined ? '—' : fmtPdf(x, d));
const srPdfGap = (g) => (g === null || g === undefined ? '—' : pdfStr(rpeGapFr(g)));
const srPdfDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function openSrPdf() {
  if (!SR.sessions.length) return toast('Aucune séance à exporter pour cette équipe.', 'error');
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SR_PDF_KEY)); } catch { /* stockage indisponible : tout coché */ }
  if (Array.isArray(saved)) document.querySelectorAll('input[name="sr-pdf"]').forEach(c => { c.checked = saved.includes(c.value); });
  const team = (window.CLUB_TEAMS || []).find(t => t.id === SR.team);
  document.getElementById('srPdfLead').textContent = `${team?.nom || 'Équipe'} · ${SR.sessions.length} séance${SR.sessions.length > 1 ? 's' : ''}, du ${rpeDate(SR.sessions[0].date_seance)} au ${rpeDate(SR.sessions.at(-1).date_seance)}. Cochez le contenu du PDF.`;
  openModal('srPdfModal');
}

/* Colonnes verticales : valeur au-dessus, date dessous ; mark : repère horizontal (RPE attendue). */
function srPdfBars(k, { items, max, fmt, color, mark = null, h = 52 }) {
  const { doc, M, CW } = k, top = k.y + 4, base = top + h, step = CW / Math.max(items.length, 1), bw = Math.min(step * 0.62, 14);
  k.hline(M, M + CW, base, PDF_LINE, 0.3);
  items.forEach((it, i) => {
    const cx = M + step * i + step / 2;
    if (it.value !== null && it.value !== undefined && it.value > 0) {
      const bh = Math.max(0.6, (it.value / max) * (h - 6));
      k.fill(cx - bw / 2, base - bh, bw, bh, color, 0.8);
      k.font(6.8, 'bold', PDF_INK); k.write(fmt(it.value), cx, base - bh - 3.6, { align: 'center' });
    }
    if (mark && it.mark) {
      const my = base - (it.mark / max) * (h - 6);
      doc.setDrawColor(...k.ACC); doc.setLineWidth(0.8); doc.line(cx - bw / 2 - 1.4, my, cx + bw / 2 + 1.4, my);
    }
    if (items.length <= 24 || i % 2 === 0) { k.font(6.2, 'normal', PDF_MUTE); k.write(it.label, cx, base + 1.6, { align: 'center' }); }
  });
  k.y = base + 7;
  if (mark) {
    doc.setDrawColor(...k.ACC); doc.setLineWidth(0.8); doc.line(M, k.y + 1.4, M + 5, k.y + 1.4);
    k.font(7, 'normal', PDF_MUTE); k.write(mark, M + 7, k.y);
    k.y += 5;
  }
  k.y += 3;
}

async function runSrPdf() {
  const want = new Set([...document.querySelectorAll('input[name="sr-pdf"]:checked')].map(c => c.value));
  if (!want.size) return toast('Cochez au moins un élément.', 'error');
  try { localStorage.setItem(SR_PDF_KEY, JSON.stringify([...want])); } catch { /* idem */ }
  const btn = document.getElementById('btnSrPdfRun');
  btn.disabled = true;
  try {
    const sessions = SR.sessions, st = rpeSummary(sessions, SR.cells), t = st.total;
    const club = window.CURRENT_PROFILE?.clubs?.nom || 'Le Mans FC';
    const team = (window.CLUB_TEAMS || []).find(x => x.id === SR.team)?.nom || 'Équipe';
    const range = `${rpeDate(sessions[0].date_seance)} – ${rpeDate(sessions.at(-1).date_seance)}`;
    const k = await openPdf({ accent: window.CURRENT_PROFILE?.clubs?.color, runTitle: `Suivi RPE · ${team}`, runRight: club });
    k.cover({
      kicker: `${club} · Suivi RPE`, title: `Suivi RPE · ${team}`,
      subtitle: `${sessions.length} séance${sessions.length > 1 ? 's' : ''} · ressenti des joueurs (RPE 1 à 10)`,
      facts: [['Période', range], ['Édité le', new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })]],
    });
    if (want.has('summary')) {
      k.section('Synthèse', { keep: 22 });
      k.kpis([
        { label: 'RPE moyen', value: srPdfFr(t.avg), sub: `${t.n} réponse${t.n > 1 ? 's' : ''}` },
        { label: 'Réponses', value: `${t.n}/${t.due}`, sub: t.rate === null ? '' : `${Math.round(t.rate * 100)} % hors en attente` },
        { label: 'Manquantes', value: String(t.missing), sub: t.pending ? `+ ${t.pending} en attente` : 'délai passé' },
        { label: 'Écart attendue', value: t.gapN ? srPdfGap(t.gap) : '—', sub: t.gapN ? `${t.gapN} séance${t.gapN > 1 ? 's' : ''}` : 'aucune RPE attendue' },
        { label: 'Charge moy. (UA)', value: srPdfFr(t.load, 0), sub: 'RPE × durée' },
      ]);
    }
    if (want.has('chartRpe')) {
      k.section('RPE déclaré par séance', { keep: 70, note: 'moyenne des réponses, 1 à 10' });
      srPdfBars(k, { items: sessions.map((s, j) => ({ label: srPdfDay(s.date_seance), value: st.perSession[j].avg, mark: st.perSession[j].expected })),
        max: 10, fmt: (v) => fmtPdf(v, 1), color: PDF_SOFT, mark: st.perSession.some(x => x.expected) ? 'RPE attendue (saisie dans la séance)' : null });
    }
    if (want.has('chartLoad')) {
      const loads = st.perSession.map(x => x.load);
      k.section('Charge ressentie par séance', { keep: 70, note: 'UA, moyenne de l’équipe' });
      srPdfBars(k, { items: sessions.map((s, j) => ({ label: srPdfDay(s.date_seance), value: loads[j] })),
        max: Math.max(1, ...loads.filter(Boolean)) * 1.1, fmt: (v) => fmtPdf(v, 0), color: PDF_MUTE });
    }
    if (want.has('sessions')) {
      k.section('Séances', { keep: 30 });
      k.table({
        cols: [{ label: 'Date', w: 1.1 }, { label: 'Séance', w: 2.1, strong: true }, { label: 'Durée', w: 0.9, align: 'right' }, { label: 'RPE att.', w: 0.9, align: 'right' },
          { label: 'RPE moy.', w: 0.9, align: 'right' }, { label: 'Écart', w: 0.9, align: 'right' }, { label: 'Charge UA', w: 1, align: 'right' }, { label: 'Réponses', w: 1.8, align: 'right' }],
        rows: sessions.map((s, j) => { const x = st.perSession[j]; return [rpeDate(s.date_seance), s.titre, x.duree ? `${fmtMin(x.duree)} min` : '—', x.expected ?? '—',
          srPdfFr(x.avg), { text: srPdfGap(x.gap), bold: x.gap !== null && Math.abs(x.gap) >= 1 }, srPdfFr(x.load, 0),
          `${x.n}/${x.due}${x.missing ? ` · ${x.missing} manq.` : ''}${x.pending ? ` · ${x.pending} att.` : ''}`]; }).reverse(),
      });
    }
    if (want.has('players')) {
      k.section('Résultats individuels', { keep: 30, note: 'sur les séances du document' });
      k.table({
        cols: [{ label: 'Joueur', w: 2.6, strong: true }, { label: 'RPE moyen', w: 1, align: 'right' }, { label: 'Réponses', w: 1, align: 'right' },
          { label: 'Manquantes', w: 1, align: 'right' }, { label: 'Charge UA', w: 1.5, align: 'right' }],
        rows: SR.players.map((p, i) => ({ p, ...st.perPlayer[i] })).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1))
          .map(x => [playerFullName(x.p), srPdfFr(x.avg), String(x.n), x.missing ? String(x.missing) : '—', srPdfFr(x.load, 0)]),
      });
    }
    if (want.has('grid')) srPdfGrid(k, sessions);
    if (want.has('missing')) srPdfMissing(k, sessions);
    if (want.has('method')) {
      k.section('Méthode de calcul', { keep: 42 });   // les quatre paragraphes ensemble
      [`Charge ressentie (sRPE, méthode de Foster) = RPE du joueur × durée totale de la séance (min), en unités arbitraires (UA). Charge d’une séance = moyenne des RPE déclarés × durée.`,
        `RPE moyen = moyenne de toutes les réponses de la période. Écart = RPE moyen déclaré − RPE attendue (saisie par le staff dans la séance) ; il ne dépend pas de la durée.`,
        `Une réponse manquante n’est jamais remplacée : elle sort des moyennes. « En attente » : le joueur peut encore répondre (jusqu’à J+${RPE_DAYS}). Absent ou non concerné : ni attendu ni compté.`,
        `La durée est celle prévue dans la séance : une participation partielle n’est pas connue. La charge mesurée par GPS n’est jamais additionnée à ces chiffres.`]
        .forEach(line => k.text(line, { size: 8.4 }));
    }
    k.save(pdfFileName('suivi-rpe', team, sessions.at(-1).date_seance));
    closeModal('srPdfModal');
    toast('PDF généré', 'success');
  } catch (e) {
    console.error('Export PDF du Suivi RPE impossible', e);
    toast(`Export PDF impossible : ${e.message}`, 'error');
  } finally { btn.disabled = false; }
}

/* Joueur × séance, en tableaux de même taille (10 séances : 2 × 5) et de colonnes fixes :
   jamais plus large que la page, jamais étiré quand il reste peu de séances. */
function srPdfGrid(k, sessions) {
  k.section('Détail joueur par séance', { keep: 30, note: '? manquante · … en attente · abs. absent' });
  const cell = (c) => (c === null ? '' : c === 'abs' ? 'abs.' : c === 'miss' ? '?' : c === 'wait' ? '…' : String(c.v));
  const size = Math.ceil(sessions.length / Math.ceil(sessions.length / SR_PDF_COLS)), NAME = 52, COL = 16;
  for (let from = 0; from < sessions.length; from += size) {
    const part = sessions.slice(from, from + size).map((s, j) => ({ s, j: from + j }));
    k.table({
      width: Math.min(k.CW, NAME + part.length * COL),
      cols: [{ label: 'Joueur', w: NAME, strong: true }, ...part.map(({ s }) => ({ label: `${srPdfDay(s.date_seance)}${s.rpe_attendue ? ` (${s.rpe_attendue})` : ''}`, w: COL, align: 'right' }))],
      rows: SR.players.map((p, i) => [playerFullName(p), ...part.map(({ j }) => cell(SR.cells[i][j]))])
        .filter(r => r.slice(1).some(Boolean)),
      size: 8,
    });
  }
  k.text('Entre parenthèses : RPE attendue de la séance.', { size: 7.4, color: PDF_MUTE });
}

function srPdfMissing(k, sessions) {
  k.section('Réponses manquantes et en attente', { keep: 20 });
  const rows = sessions.map((s, j) => {
    const who = (kind) => SR.players.filter((_, i) => SR.cells[i][j] === kind).map(playerFullName);
    return { s, miss: who('miss'), wait: who('wait') };
  }).filter(r => r.miss.length || r.wait.length).reverse();
  if (!rows.length) { k.text('Aucune réponse manquante sur ces séances.', { color: PDF_MUTE, style: 'italic' }); return; }
  k.table({
    cols: [{ label: 'Séance', w: 1.6, strong: true }, { label: 'Manquantes', w: 3 }, { label: 'En attente', w: 2 }],
    rows: rows.map(r => [`${rpeDate(r.s.date_seance)} · ${r.s.titre}`, r.miss.join(', ') || '—', r.wait.join(', ') || '—']),
    size: 8,
  });
}

document.getElementById('btnSrPdf').addEventListener('click', openSrPdf);
document.getElementById('btnSrPdfRun').addEventListener('click', runSrPdf);
