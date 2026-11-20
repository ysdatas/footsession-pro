/* ============================================================
   LMFC Performance — form-levels.js
   Échelles des formulaires (lmfc_v63.sql) : une question Échelle peut porter
   « niveaux », une liste { valeur, libelle, couleur }. La valeur reste un
   nombre (calculs, alertes) ; le libellé et la couleur ne servent qu'à
   l'affichage. Sans niveaux : les entiers de min à max, sans libellé.
   Partagé par Mes formulaires, Formulaires, Suivi RPE et l'historique.
   ============================================================ */

/* Échelle d'intensité de référence (1 à 10), proposée dans l'éditeur : modifiable. */
const FQ_RPE_PRESET = [
  [1, 'Très très facile', '#2e7d32'], [2, 'Très facile', '#2e7d32'], [3, 'Facile', '#2e7d32'], [4, 'Modéré', '#2e7d32'],
  [5, 'Moyen', '#ef6c00'], [6, 'Un peu difficile', '#ef6c00'], [7, 'Difficile', '#ef6c00'],
  [8, 'Très difficile', '#c62828'], [9, 'Très très difficile', '#c62828'], [10, 'Maximal', '#c62828'],
].map(([valeur, libelle, couleur]) => ({ valeur, libelle, couleur }));

/* Les niveaux d'une question Échelle, dans l'ordre des valeurs. */
function fqLevels(q) {
  if (Array.isArray(q?.niveaux) && q.niveaux.length) {
    return q.niveaux.map(n => ({ valeur: Number(n.valeur), libelle: String(n.libelle || ''), couleur: n.couleur || null }))
      .filter(n => Number.isFinite(n.valeur)).sort((a, b) => a.valeur - b.valeur);
  }
  const min = Number.isInteger(Number(q?.min)) ? Number(q.min) : 1;
  const max = Number.isInteger(Number(q?.max)) ? Number(q.max) : 10;
  return Array.from({ length: Math.max(0, Math.min(11, max - min + 1)) }, (_, i) => ({ valeur: min + i, libelle: '', couleur: null }));
}

const fqLevel = (q, v) => (v == null || v === '' ? null : fqLevels(q).find(n => n.valeur === Number(v)) || null);

/* Une réponse telle qu'enregistrée, lisible : « 7 – Difficile », « Oui », « 12,5 ». Jamais recalculée. */
function fqAnswerText(q, v) {
  if (v == null || v === '') return '';
  if (v === true) return 'Oui';
  if (v === false) return 'Non';
  if (typeof v === 'number') {
    const n = String(v).replace('.', ',');
    const label = q?.type === 'scale' ? fqLevel(q, v)?.libelle : '';
    return label ? `${n} – ${label}` : n;
  }
  return String(v);
}

/* Couleur d'un niveau, sûre pour un attribut style (#rrggbb seulement). */
const fqColor = (q, v) => { const c = fqLevel(q, v)?.couleur; return /^#[0-9a-f]{6}$/i.test(c || '') ? c : null; };
