/* ============================================================
   LMFC Performance — match-merge.js (matchs)
   Réunir deux matchs en double (même date, même adversaire :
   mhDuplicates, match-history.js) dans celui qu'on garde :
     - les joueurs de l'autre absents d'ici y passent, avec leur ligne ;
     - un joueur présent dans les deux garde sa ligne d'ici, dont les
       cases vides sont complétées (minutes, buts, cartons, note…) ;
     - score, compétition, heure, stade, lieu, notes : complétés s'ils
       sont vides ici ; l'équipe et l'import FFF de celui-ci restent ;
     - ses joueurs hors plateforme s'ajoutent (même nom : une fois) ;
     - puis l'autre match est supprimé (corbeille, comme « Supprimer »).
   Rien n'est supprimé tant que les lignes n'ont pas été déplacées : un
   refus de la base (droits sur l'autre équipe) arrête tout avant.
   ============================================================ */

const MERGE_MATCH_KEYS = ['competition', 'lieu', 'heure', 'stade', 'score_pour', 'score_contre', 'infos', 'commentaire', 'a_retenir'];
const MERGE_ROW_SKIP = new Set(['id', 'club_id', 'match_id', 'player_id', 'created_at', 'updated_at']);
const mergeEmpty = (v) => v === null || v === undefined || v === '';

/* Plan pur (testé) : { match: champs à compléter, fills: [{ id, patch }], moves: [id des lignes à déplacer] }. */
function matchMergePlan(keep, keepRows, drop, dropRows) {
  const fill = (to, from, keys) => Object.fromEntries(keys.filter(k => k in to && mergeEmpty(to[k]) && !mergeEmpty(from[k])).map(k => [k, from[k]]));
  const mine = new Map(keepRows.map(r => [r.player_id, r]));
  const fills = dropRows.filter(r => mine.has(r.player_id))
    .map(r => ({ id: mine.get(r.player_id).id, patch: fill(mine.get(r.player_id), r, Object.keys(r).filter(k => !MERGE_ROW_SKIP.has(k))) }))
    .filter(f => Object.keys(f.patch).length);
  const match = fill(keep, drop, MERGE_MATCH_KEYS);
  const extra = (drop.hors_plateforme || []).filter(x => !(keep.hors_plateforme || []).some(y => y.nom.toLowerCase() === x.nom.toLowerCase()));
  if (extra.length) match.hors_plateforme = [...(keep.hors_plateforme || []), ...extra];
  return { match, fills, moves: dropRows.filter(r => !mine.has(r.player_id)).map(r => r.id) };
}

/* Caractéristiques comparées de deux matchs (doublon possible) : ce qui les distingue se voit. */
function dupCompareHtml(a, b, labels = ['Ce match', 'L’autre']) {   // teamName : nav.js ; mhMatchCat : match-history.js
  const cat = (m) => mhMatchCat(m, teamName).toUpperCase() || '—';
  const score = (m) => (m.score_pour == null || m.score_contre == null ? '—' : `${m.score_pour} – ${m.score_contre}`);
  const rows = [['Équipe', (m) => teamName(m.team_id) || 'Sans équipe'], ['Catégorie', cat], ['Compétition', (m) => m.competition || '—'],
    ['Date', (m) => fmtDateFr(m.date_match)], ['Heure', (m) => m.heure?.slice(0, 5) || '—'], ['Lieu', (m) => LIEUX[m.lieu] || '—'], ['Score', score],
    ['Source', (m) => (m.ext_source === 'fff' ? 'Import FFF' : 'Saisi à la main')]];
  return `<table class="dup-compare"><thead><tr><th></th><th>${escapeHtml(labels[0])}</th><th>${escapeHtml(labels[1])}</th></tr></thead><tbody>
    ${rows.map(([k, f]) => { const x = f(a), y = f(b); return `<tr${x !== y ? ' class="is-diff"' : ''}><th>${k}</th><td>${escapeHtml(x)}</td><td>${escapeHtml(y)}</td></tr>`; }).join('')}
    </tbody></table>`;
}

/* Bandeau de la fenêtre du match : chaque doublon possible, comparé, et les trois choix. */
function mergeBannerHtml(m, twins) {   // teamName : nav.js
  return twins.map(t => `<div class="dup-item"><p>Doublon possible : <strong>${escapeHtml(t.adversaire)}</strong>${teamName(t.team_id) ? ` (${escapeHtml(teamName(t.team_id))})` : ''}, même date.
    ${t.ext_source === 'fff' && m.ext_source !== 'fff' ? 'Conseil : ouvrez plutôt l’autre, importé de la FFF (il reste à jour), et réunissez-y celui-ci.' : ''}</p>
    ${dupCompareHtml(m, t)}
    <p class="dup-actions"><button class="btn btn-sm" type="button" data-merge="${t.id}">Réunir dans ce match</button>
    <button class="btn btn-sm" type="button" data-dup-keep="${t.id}">Garder les deux</button>
    <button class="btn btn-sm" type="button" data-dup-distinct="${t.id}">Ce n’est pas un doublon</button></p></div>`).join('');
}

/* « Ce n'est pas un doublon » : la décision est gardée pour tout le club (lmfc_v53.sql). */
async function markNotDuplicate(id, others) {
  const rows = others.map(o => ({ club_id: myProfile.club_id, match_a: Math.min(id, o), match_b: Math.max(id, o) }));
  const { error } = await sb.from('match_not_duplicates').upsert(rows, { onConflict: 'match_a,match_b', ignoreDuplicates: true });
  if (error) throw /match_not_duplicates/.test(error.message || '') ? new Error(updateNeeded('lmfc_v53.sql')) : error;
}

/* Avant d'enregistrer un nouveau match (ou d'en changer la date, l'adversaire, l'équipe, la compétition) :
   doublon possible → comparaison et choix. 'open' (utiliser l'existant), 'both' (garder les deux),
   'distinct' (ce n'est pas un doublon), null (rien enregistré). */
function dupDialog(candidate, twins) {
  return new Promise((resolve) => {
    const back = document.activeElement;
    const btn = (label, v, cls = 'btn') => { const b = el('button', { type: 'button', class: cls }, label); b.addEventListener('click', () => done(v)); return b; };
    const body = el('div', { class: 'dup-dialog-body' });
    body.innerHTML = twins.map(t => dupCompareHtml(candidate, t, ['Ce match', `Existant : ${t.adversaire}`])).join('');
    const box = el('div', { class: 'modal-backdrop open dlg', 'data-busy': '' },
      el('div', { class: 'modal dlg-box dup-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dupDlgTitle' },
        el('h2', { class: 'as-h3', id: 'dupDlgTitle' }, 'Doublon possible'),
        el('p', { class: 'dlg-body' }, `Un match du club a la même date et le même adversaire${twins.length > 1 ? ` (${twins.length} matchs)` : ''}. Comparez avant d’enregistrer.`),
        body,
        el('div', { class: 'modal-actions dup-dialog-actions' }, btn('Annuler', null), btn('Ouvrir l’existant', 'open'),
          btn('Garder les deux', 'both'), btn('Ce n’est pas un doublon', 'distinct', 'btn btn-primary'))));
    const done = (v) => { box.remove(); back?.focus?.(); resolve(v); };
    box.addEventListener('click', (e) => { if (e.target === box) done(null); });
    box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') done(null); });
    document.body.append(box);
    box.querySelector('.btn-primary').focus();
  });
}

async function mergeMatches(keepId, dropId) {
  const refused = 'Réunion refusée : il faut pouvoir modifier les deux matchs (leur équipe). Rien n’a été supprimé.';
  // RLS : une écriture refusée renvoie 0 ligne, ou une erreur 42501 si la ligne irait vers un match interdit.
  const one = (q) => q.then(({ data, error }) => { if (error) throw error.code === '42501' ? new Error(refused) : error; return data; });
  const [keep, drop, keepRows, dropRows] = await Promise.all([
    one(sb.from('matches').select('*').eq('id', keepId).single()), one(sb.from('matches').select('*').eq('id', dropId).single()),
    one(sb.from('match_players').select('*').eq('match_id', keepId)), one(sb.from('match_players').select('*').eq('match_id', dropId))]);
  const plan = matchMergePlan(keep, keepRows, drop, dropRows);
  if (Object.keys(plan.match).length && !(await one(sb.from('matches').update(plan.match).eq('id', keepId).select('id'))).length) throw new Error(refused);
  for (const f of plan.fills) await one(sb.from('match_players').update(f.patch).eq('id', f.id).select('id'));
  if (plan.moves.length && (await one(sb.from('match_players').update({ match_id: keepId }).in('id', plan.moves).select('id'))).length !== plan.moves.length) {
    throw new Error(refused);
  }
  if (!(await one(sb.from('matches').delete().eq('id', dropId).select('id'))).length) {
    throw new Error('Joueurs réunis, mais l’autre match n’a pas pu être supprimé (droits) : supprimez-le à la main.');
  }
  return { added: plan.moves.length, completed: plan.fills.length };
}
