/* ============================================================
   LMFC Performance — rpe-stats.js
   Calculs du tableau de bord Suivi RPE. Pur (ni page ni base) :
   tests/rpe-stats.test.mjs.
   Entrée : les séances, de la plus ancienne à la plus récente, et la
   grille des cases telle que la dessine la page (une ligne par joueur,
   une colonne par séance) : { v, staff } réponse ; 'miss' attendue et
   absente ; 'abs' absence enregistrée ; null pas concerné.
   Charge ressentie (sRPE, méthode de Foster) = RPE × durée totale de la
   séance (min), en unités arbitraires (UA). La durée est celle de la
   séance : une participation partielle n'est pas connue. La charge
   prévue (durée, temps de travail) reste à part, jamais additionnée.
   ============================================================ */

const rpeMean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function rpeSummary(sessions, cells) {
  const answered = (list) => list.filter(c => c?.v).map(c => c.v);
  const perSession = sessions.map((s, j) => {
    const col = cells.map(row => row[j]), vals = answered(col), missing = col.filter(c => c === 'miss').length;
    const avg = rpeMean(vals), duree = Number(s.duree_min) > 0 ? Number(s.duree_min) : null;
    return { avg, n: vals.length, missing, due: vals.length + missing, duree, travail: s.travail || null,
      load: avg !== null && duree ? avg * duree : null };
  });
  // Variation de la charge ressentie d'une séance à la suivante (sans séance précédente notée : rien).
  perSession.forEach((x, j) => {
    const prev = perSession.slice(0, j).reverse().find(p => p.load !== null)?.load;
    x.delta = x.load !== null && prev ? (x.load - prev) / prev : null;
  });
  const perPlayer = cells.map(row => {
    const vals = answered(row);
    const loads = row.map((c, j) => (c?.v && perSession[j].duree ? c.v * perSession[j].duree : null)).filter(x => x !== null);
    return { avg: rpeMean(vals), n: vals.length, missing: row.filter(c => c === 'miss').length, load: rpeMean(loads) };
  });
  const vals = answered(cells.flat()), missing = cells.flat().filter(c => c === 'miss').length;
  return {
    perSession, perPlayer,
    total: { avg: rpeMean(vals), n: vals.length, missing, due: vals.length + missing,
      rate: vals.length + missing ? vals.length / (vals.length + missing) : null,
      load: rpeMean(perSession.map(x => x.load).filter(x => x !== null)) },
  };
}
