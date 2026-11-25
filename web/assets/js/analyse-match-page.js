/* ============================================================
   LMFC Performance — analyse-match-page.js (analyse-match?id=<match>)
   Analyse d'un match pour toute l'équipe (lmfc_v75.sql) : les mêmes blocs que
   l'onglet Analyse d'un joueur (Avec ballon / Sans ballon, terrains, zones,
   tableaux, lecture des séquences), tirés des séquences de TOUS les joueurs
   qui ont la vidéo du match (anFetchMatch), avec un menu « Joueur » en plus.
   Timeline du match : la vidéo commune, une piste par action, chaque segment
   au nom de son joueur ; on y corrige et on y code (pas de création : une
   séquence appartient à un joueur, elle vient de l'import XML ou de sa fiche).
   Staff vidéo (admin, coach, analyste, lecteur en lecture) ; la RLS décide de
   ce qui est lu (joueurs suivis) et écrit (save_sequence_code).
   ============================================================ */

const esc = escapeHtml;   // analyse-*.js (comme player-performance-page.js)

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  fillUserBlock(ctx.profile.nom || 'Utilisateur', ROLE_LABELS[ctx.profile.role] || ctx.profile.role);
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });
  renderPageKicker(ctx.profile);
  const id = Number(new URL(location.href).searchParams.get('id')), root = document.getElementById('pfAnalyse'), sub = document.getElementById('amSub');
  if (ctx.profile.role === 'joueur') { location.replace('mes-videos'); return; }
  const { data: m, error } = id ? await sb.from('matches').select('id, adversaire, date_match, team_id').eq('id', id).maybeSingle() : { data: null };
  if (error || !m) {
    sub.textContent = '';
    root.innerHTML = `<div class="empty">${escapeHtml(error?.message || 'Match introuvable.')}</div>`;
    return;
  }
  document.getElementById('amTitle').textContent = `Match contre ${m.adversaire || 'adversaire'}`;
  document.title = `LMFC Performance — Analyse : ${m.adversaire || 'match'}`;
  document.getElementById('amBack').href = `matchs?id=${m.id}`;
  sub.textContent = `${fmtDateFr(m.date_match)} · tous les joueurs du match, ou un seul avec le menu « Joueur »`;
  AN.load = () => anFetchMatch(m.id);   // analyse-data.js
  await mountAnalyse(root, { player: { id: null, nom: `match-${m.adversaire || m.id}` }, profile: ctx.profile, canCode: canManagePlayerVideos(ctx.profile.role) });
})();
