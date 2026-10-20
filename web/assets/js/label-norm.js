/* ============================================================
   LMFC Performance — label-norm.js
   Une même valeur écrite de plusieurs façons (« 7c7 », « 7 vs 7 »,
   « 7v7 » ; « 40 x 35 », « 40 m / 35 m » ; « Demi terrain »,
   « demi-terrain ») est comptée une seule fois dans les bilans.
   Rien n'est réécrit en base : seul l'affichage regroupe.
   Utilisé par analytics-page.js (bilan) et session-edit-page.js (formats
   proposés à la saisie) ; testé par tests/label-norm.test.mjs.
   ============================================================ */

/* Effectif : « 7c7 », « 7 vs 7 » → « 7v7 » ; « 17 », « 17 J » → « 17 joueurs » ;
   « 20 J +3GB » → « 20 joueurs + 3 GB ». « 3 x 7 » (3 groupes de 7) reste tel quel. */
function normEffectif(raw) {
  let s = String(raw ?? '').trim().replace(/\s+/g, ' ').replace(/[,;]+$/, '');
  if (!s) return '';
  s = s.replace(/(\d)\s*(?:vs|v|c|contre)\s*(?=\d)/gi, '$1v');
  s = s.replace(/\s*\+\s*/g, '+').replace(/(\d)\s*gb\b/gi, '$1 GB');
  const players = s.match(/^(\d+)\s*(?:joueurs?|j)?(\+\d+ GB)?$/i);
  if (players) s = `${players[1]} joueurs${players[2] || ''}`;
  return s.replace(/\+/g, ' + ').replace(/,\s*/g, ', ');
}

/* Taille de terrain : « 40 x 35 », « 40x35m », « 40 m / 35 m » → « 40×35 m ». */
function normTerrain(raw) {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  const dims = s.match(/^(\d+)\s*m?\s*(?:x|×|\/|par)\s*(\d+)\s*m?(?![a-z])\s*(.*)$/i);
  return dims ? `${dims[1]}×${dims[2]} m${dims[3] ? ` ${dims[3]}` : ''}` : s;
}

/* Clé de regroupement : sans casse, sans accents, tirets = espaces. */
const normKey = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-\u2010\u2013]/g, ' ').replace(/\s+/g, ' ').trim();
const normCap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* Compte les valeurs regroupées, triées de la plus fréquente à la moins
   fréquente (top `limit`). L'écriture affichée est la plus courante. */
function countNormalized(values, norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' '), limit = 8) {
  const groups = new Map();
  values.forEach((raw) => {
    const label = norm(raw);
    if (!label) return;
    const key = normKey(label);
    const g = groups.get(key) || { c: 0, forms: new Map() };
    g.c += 1;
    g.forms.set(label, (g.forms.get(label) || 0) + 1);
    groups.set(key, g);
  });
  return [...groups.values()]
    .map(g => ({ label: normCap([...g.forms].sort((a, b) => b[1] - a[1])[0][0]), c: g.c }))
    .sort((a, b) => b.c - a.c)
    .slice(0, limit);
}
