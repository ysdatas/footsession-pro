/* ============================================================
   LMFC Performance — rpe-stats.js
   Calculs du tableau de bord Suivi RPE. Pur (ni page ni base) :
   tests/rpe-stats.test.mjs.
   Entrée : les séances, de la plus ancienne à la plus récente, et la
   grille des cases telle que la dessine la page (une ligne par joueur,
   une colonne par séance) : { v, staff } réponse ; 'miss' attendue et
   absente ; 'wait' attendue, délai de réponse (J+2) pas fini ; 'abs'
   absence enregistrée ; null pas concerné. Une réponse manquante n'est
   jamais remplacée : elle sort des moyennes.
   Charge ressentie (sRPE, méthode de Foster) = RPE × durée totale de la
   séance (min), en unités arbitraires (UA). La durée est celle de la
   séance : une participation partielle n'est pas connue. La charge
   prévue (durée, temps de travail) reste à part, jamais additionnée.
   RPE attendue (sessions.rpe_attendue, lmfc_v34.sql) : écart = moyenne
   des RPE déclarés − RPE attendue, sans rapport avec la charge.
   ============================================================ */

const rpeMean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function rpeSummary(sessions, cells) {
  const answered = (list) => list.filter(c => c?.v).map(c => c.v);
  const count = (list, k) => list.filter(c => c === k).length;
  const perSession = sessions.map((s, j) => {
    const col = cells.map(row => row[j]), vals = answered(col), missing = count(col, 'miss'), pending = count(col, 'wait');
    const avg = rpeMean(vals), duree = Number(s.duree_min) > 0 ? Number(s.duree_min) : null, expected = Number(s.rpe_attendue) || null;
    return { avg, n: vals.length, missing, pending, due: vals.length + missing + pending, duree, travail: s.travail || null,
      load: avg !== null && duree ? avg * duree : null, expected, gap: avg !== null && expected ? avg - expected : null };
  });
  // Variation de la charge ressentie d'une séance à la suivante (sans séance précédente notée : rien).
  perSession.forEach((x, j) => {
    const prev = perSession.slice(0, j).reverse().find(p => p.load !== null)?.load;
    x.delta = x.load !== null && prev ? (x.load - prev) / prev : null;
  });
  const perPlayer = cells.map(row => {
    const vals = answered(row);
    const loads = row.map((c, j) => (c?.v && perSession[j].duree ? c.v * perSession[j].duree : null)).filter(x => x !== null);
    return { avg: rpeMean(vals), n: vals.length, missing: count(row, 'miss'), pending: count(row, 'wait'), load: rpeMean(loads) };
  });
  const all = cells.flat(), vals = answered(all), missing = count(all, 'miss'), pending = count(all, 'wait');
  const gaps = perSession.map(x => x.gap).filter(x => x !== null);
  return {
    perSession, perPlayer,
    total: { avg: rpeMean(vals), n: vals.length, missing, pending, due: vals.length + missing + pending,
      rate: vals.length + missing ? vals.length / (vals.length + missing) : null,   // hors « en attente »
      load: rpeMean(perSession.map(x => x.load).filter(x => x !== null)),
      gap: rpeMean(gaps), gapN: gaps.length },
  };
}
