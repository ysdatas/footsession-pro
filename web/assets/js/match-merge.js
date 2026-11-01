/* ============================================================
   LMFC Performance — match-merge.js (matchs.html)
   Réunir deux matchs en double (même date, même adversaire :
   mhDuplicates, match-history.js) dans celui qu'on garde :
     - les joueurs de l'autre absents d'ici y passent, avec leur ligne ;
     - un joueur présent dans les deux garde sa ligne d'ici, dont les
       cases vides sont complétées (minutes, buts, cartons, note…) ;
     - score, compétition, heure, stade, lieu, notes : complétés s'ils
       sont vides ici ; l'équipe et l'import FFF de celui-ci restent ;
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
  return { match: fill(keep, drop, MERGE_MATCH_KEYS), fills, moves: dropRows.filter(r => !mine.has(r.player_id)).map(r => r.id) };
}

/* Bandeau de la fenêtre du match : l'autre match du doublon, et le bouton. */
function mergeBannerHtml(m, twins) {   // teamName : nav.js
  return twins.map(t => `<p>Doublon possible : <strong>${escapeHtml(t.adversaire)}</strong>${teamName(t.team_id) ? ` (${escapeHtml(teamName(t.team_id))})` : ''}, même date.
    ${t.ext_source === 'fff' && m.ext_source !== 'fff' ? 'Conseil : ouvrez plutôt l’autre, importé de la FFF (il reste à jour), et réunissez-y celui-ci.' : ''}
    <button class="btn btn-sm" type="button" data-merge="${t.id}">Réunir dans ce match</button></p>`).join('');
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
