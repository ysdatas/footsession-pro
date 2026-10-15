/* ============================================================
   LMFC Performance — excel-match.js
   Rapprochement des lignes de l'Excel du préparateur avec les fiches
   du club, sur plusieurs critères : nom et prénom, date de naissance,
   équipe de l'import, dernière taille connue.

   Règles (import Excel, excel-import.js) :
   - une date de naissance différente écarte la fiche : autre joueur ;
   - un seul candidat sûr (nom et prénom exacts, ou même date de
     naissance) est reconnu ; plusieurs candidats : rien n'est associé
     sans le choix du préparateur ;
   - deux lignes de l'Excel ne peuvent pas viser la même fiche ;
   - aucune valeur n'est inventée : un critère absent reste absent.
   Pur (ni page ni base) : tests/excel-import.test.mjs.
   Dépend de perf-metrics.js (normalizeName) et excel-import.js
   (splitExcelName, containsAll, levenshtein).
   ============================================================ */

const XM_HEIGHT_NEAR = 3, XM_HEIGHT_FAR = 8;   // cm d'écart avec la dernière taille connue

/* Lien de nom entre une ligne de l'Excel et une fiche : 'exact' (nom et
   prénom), 'nom' (fiche sans prénom), 'proche' (initiale, prénom composé,
   une ou deux lettres d'écart), ou null (autre joueur). */
function xmNameLink(excelName, fiche) {
  const parts = normalizeName(excelName).split(' ').filter(Boolean);
  const nom = normalizeName(fiche.nom), prenom = normalizeName(fiche.prenom);
  if (!nom) return null;
  const x = splitExcelName(excelName);
  const xNom = normalizeName(x.nom), xPrenom = normalizeName(x.prenom);
  if (containsAll(parts, nom)) {
    if (!prenom) return 'nom';
    if (containsAll(parts, prenom)) return 'exact';
    const p = prenom.replace(/\.$/, '');
    if (xPrenom && (xPrenom.startsWith(p) || p.startsWith(xPrenom) || levenshtein(xPrenom, prenom) <= 2)) return 'proche';
    return null;
  }
  const tol = nom.length < 5 ? 1 : 2;
  return xNom && levenshtein(xNom, nom) <= tol && (!prenom || !xPrenom || xPrenom === prenom) ? 'proche' : null;
}

/* Carte d'identité d'une ligne, telle que lue par parseExcel : date de
   naissance (modèle Espoirs), dernière taille et dernier poids du fichier. */
function xmIdentity(name, data) {
  const last = (k) => [...(data?.measurements || [])].reverse().find(m => m[k] !== null && m[k] !== undefined)?.[k] ?? null;
  return { name, birthDate: data?.birthDate || null, height: last('height_cm'), weight: last('weight_kg') };
}

/* Critères d'une fiche pour une ligne. ctx : { teamId, heights: Map(id → cm) }. */
function xmCandidate(id, fiche, link, ctx) {
  const born = fiche.date_naissance ? String(fiche.date_naissance).slice(0, 10) : null;
  const birth = id.birthDate && born ? (born === id.birthDate ? 'same' : 'diff') : null;
  const team = !!ctx.teamId && (fiche.team_id === ctx.teamId || (fiche.other_team_ids || []).includes(ctx.teamId));
  const knownHeight = ctx.heights?.get(fiche.id) ?? null;
  const dh = id.height !== null && knownHeight !== null ? Math.abs(id.height - knownHeight) : null;
  const height = dh === null ? null : dh <= XM_HEIGHT_NEAR ? 'near' : dh > XM_HEIGHT_FAR ? 'far' : null;
  return { fiche, link, birth, team, height, knownHeight };
}
/* Ordre d'affichage des candidats : le plus probable d'abord. */
const xmScore = (c) => (c.birth === 'same' ? 8 : 0) + ({ exact: 4, nom: 2, proche: 1 })[c.link]
  + (c.team ? 2 : 0) + (c.height === 'near' ? 1 : c.height === 'far' ? -2 : 0);

/* Rapproche chaque ligne de l'Excel des fiches du club.
   rows : [{ name, identity, dupInFile }] ; roster : fiches du club.
   Statuts : 'ok' (reconnu), 'confirm' (un seul candidat, nom moins sûr),
   'choose' (plusieurs fiches possibles), 'new' (aucune fiche), 'dup'
   (deux lignes du fichier portent ce nom : non importable). */
function matchExcelRows(rows, roster, ctx = {}) {
  const out = rows.map(r => {
    const all = roster.map(f => { const link = xmNameLink(r.name, f); return link && xmCandidate(r.identity, f, link, ctx); })
      .filter(Boolean).sort((a, b) => xmScore(b) - xmScore(a));
    const candidates = all.filter(c => c.birth !== 'diff');
    const excluded = all.filter(c => c.birth === 'diff');
    const sameBirth = candidates.filter(c => c.birth === 'same');
    const base = { ...r, candidates, excluded, fiche: null, reason: '' };
    if (r.dupInFile) return { ...base, status: 'dup' };
    if (!candidates.length) {
      // Pas de fiche à ce nom : une fiche née le même jour est peut-être la même personne.
      const twins = r.identity.birthDate ? roster.filter(f => String(f.date_naissance || '').slice(0, 10) === r.identity.birthDate) : [];
      return { ...base, status: 'new', twins };
    }
    if (sameBirth.length === 1) return { ...base, status: 'ok', fiche: sameBirth[0].fiche, reason: 'même date de naissance' };
    if (candidates.length === 1 && candidates[0].link === 'exact') return { ...base, status: 'ok', fiche: candidates[0].fiche, reason: 'nom et prénom' };
    if (candidates.length === 1) {
      return { ...base, status: 'confirm', fiche: candidates[0].fiche,
        reason: candidates[0].link === 'nom' ? 'fiche sans prénom' : 'orthographe proche' };
    }
    return { ...base, status: 'choose', reason: `${candidates.length} fiches possibles` };
  });
  // Une fiche proposée pour plusieurs lignes : seule une ligne reconnue sans
  // doute la garde ; les autres (ou toutes, s'il n'y en a pas) sont à choisir.
  const claims = new Map();
  out.filter(r => r.fiche).forEach(r => claims.set(r.fiche.id, [...(claims.get(r.fiche.id) || []), r]));
  for (const list of claims.values()) {
    if (list.length < 2) continue;
    const oks = list.filter(r => r.status === 'ok');
    list.forEach(r => {
      if (oks.length === 1 && r === oks[0]) return;
      Object.assign(r, { status: 'choose', fiche: null, reason: 'fiche visée par plusieurs lignes' });
    });
  }
  return out;
}
