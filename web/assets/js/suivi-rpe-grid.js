/* ============================================================
   LMFC Performance — suivi-rpe-grid.js (suivi-rpe)
   Vue « Détail joueurs » (et « Courbatures », renderSrSore) : la grille joueurs × séances ou matchs affichés
   (SR, suivi-rpe-page.js). Chaque case : la valeur du joueur, « ? » réponse
   manquante, « … » en attente, « abs. » absence, l'équipe en gris (« N2 »)
   si son RPE de la demi-journée est donné avec une autre équipe
   (lmfc_v71.sql), vide si la séance ne le concerne pas. En tête : le jour,
   l'heure s'il y a deux séances, la pastille des réponses attendues. Légende
   en pictogrammes : un toucher ouvre la définition.
   ============================================================ */

function renderSrGrid(body) {
  const head = SR.sessions.map((s, j) => {
    const col = SR.cells.map(row => row[j]), late = col.filter(c => c === 'miss').length, none = late + col.filter(c => c === 'wait').length;
    const tip = `${s.match ? 'Match – ' : ''}${s.adversaire || s.titre}${none ? ` : ${none} sans réponse${late ? ` (${late} en retard)` : ''}` : ''}`;
    // Jour en clair, date, heure en or (deux séances le même jour) ; pastille : réponses attendues (or : en retard).
    const [wd, dm] = srShort(s.date_seance).split(' ');
    return `<th scope="col"><a class="sr-sess${s.match ? ' is-match' : ''}" href="${srHref(s)}" title="${escapeHtml(tip)}">
      <span class="sr-wd">${escapeHtml(s.match ? 'Match' : wd.replace('.', ''))}</span><span class="sr-dm">${escapeHtml(dm || '')}</span>
      <span class="sr-hr">${escapeHtml(srHour(s).replace(':', 'h'))}</span>
      <span class="sr-cnt${late ? ' is-late' : ''}${none ? '' : ' is-zero'}">${none || ''}</span></a></th>`;
  }).join('');
  const rows = SR.players.map((p, i) => `<tr><th scope="row">${playerLink(p.id, playerFullName(p))}</th>${SR.cells[i].map((c, j) => {
    const s = SR.sessions[j], label = `${playerFullName(p)}, ${srWhen(s)}`;
    if (c === null) return '<td class="sr-na"></td>';
    if (c === 'away') {
      const w = srAway(s, p), t = w.other_rpe == null ? `${label} : ${w.other_label} à cette demi-journée`
        : `${label} : RPE ${w.other_rpe} donné avec ${w.other_label} (même demi-journée), saisir ici l’y retire`;
      return `<td><button type="button" class="sr-c is-away" data-sr="${j}:${i}" title="${escapeHtml(t)}" aria-label="${escapeHtml(t)}">${escapeHtml(srAwayTeam(w))}<i>${w.other_rpe ?? ''}</i></button></td>`;
    }
    if (c === 'abs') return `<td><button type="button" class="sr-c is-abs" data-sr="${j}:${i}" aria-label="${escapeHtml(label)} : absent, saisir quand même">abs.</button></td>`;
    if (c === 'wait') return `<td class="sr-has-bell"><button type="button" class="sr-c is-wait" data-sr="${j}:${i}" aria-label="${escapeHtml(label)} : en attente (il peut encore répondre), saisir à sa place">…</button>${srBellHtml(c, j, i)}</td>`;
    if (c === 'miss') return `<td><button type="button" class="sr-c is-miss" data-sr="${j}:${i}" aria-label="${escapeHtml(label)} : pas de réponse, saisir à sa place">?</button></td>`;
    const dup = c.dup ? `, aussi noté avec ${srDups(s, p).map(x => `${x.other_label} (${x.other_rpe})`).join(', ')} : un seul RPE par demi-journée, effacer celui en trop` : '';
    return `<td><button type="button" class="sr-c${c.dup ? ' has-dup' : ''}" style="--rpe:${rpeColor(c.v)}" data-sr="${j}:${i}"${dup ? ` title="${escapeHtml(dup.slice(2))}"` : ''}
      aria-label="${escapeHtml(`${label} : ${c.v} (${rpeLabel(c.v)})${c.staff ? ', saisi par le staff' : ''}${dup}, corriger`)}">${c.v}${c.staff ? '<i>staff</i>' : ''}${c.dup ? '<span class="sr-dup" aria-hidden="true">2×</span>' : ''}</button></td>`;
  }).join('')}</tr>`).join('');
  swapKeepView(body, `<div class="sr-wrap"><table class="sr-grid">
      <thead><tr><th scope="col" class="sr-corner">Joueur</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    ${srKeysHtml()}`);
}

/* Légende en pictogrammes : un toucher ouvre sa définition (une à la fois). */
function srKeysHtml() {
  const keys = [
    ['<span class="sr-c is-miss">?</span>', 'Réponse manquante : le délai est passé.'],
    ['<span class="sr-c is-wait">…</span>', `En attente : le joueur peut encore répondre (jusqu’à ${RPE_DAYS} jours après).`],
    ['<span class="sr-c is-abs">abs.</span>', 'Absence enregistrée.'],
    ['<span class="sr-c is-away">N2<i>6</i></span>', 'RPE donné avec une autre équipe la même demi-journée : un seul par demi-journée.'],
    ['<span class="rpe-staff">staff</span>', 'Saisi ou corrigé par le staff.'],
    ['<span class="sr-cnt is-late">2</span>', 'En tête de colonne : réponses attendues (en or : en retard).'],
    ...(srCanRemind() ? [[`<span class="sr-bell">${SR_BELL}</span>`, `Relancer le joueur sur son téléphone (une fois par ${SR_REMIND_H} h).`]] : []),
    ['<span class="sr-key-i">i</span>', 'Touchez une case pour saisir ou corriger à la place du joueur. La présence non cochée compte comme attendue ; un match attend ceux de la feuille, tout le groupe sans feuille.'],
  ];
  return `<div class="sr-keys" role="group" aria-label="Légende">${keys.map(([icon, text]) =>
    `<details class="sr-key"><summary aria-label="${escapeHtml(text)}">${icon}</summary><p>${escapeHtml(text)}</p></details>`).join('')}</div>`;
}
document.addEventListener('toggle', (e) => {
  if (e.target.matches?.('.sr-key[open]')) document.querySelectorAll('.sr-key[open]').forEach(d => { if (d !== e.target) d.open = false; });
}, true);
document.addEventListener('click', (e) => { if (!e.target.closest('.sr-key')) document.querySelectorAll('.sr-key[open]').forEach(d => { d.open = false; }); });

/* Vue « Courbatures » (soreness.js, lmfc_v35.sql) : chacun dans son équipe ; un joueur d'une autre équipe seulement
   les jours où il est noté présent à une séance de celle-ci, étiqueté de son équipe (« Espoirs »). Capsules : toutes
   les équipes ou une seule ; l'équipe affichée d'abord, puis les autres dans l'ordre du club. */
function renderSrSore(body) {
  const err = SR.sore.error;
  if (err) {
    body.innerHTML = `<div class="empty">${escapeHtml(['42P01', 'PGRST205'].includes(err.code) ? 'Le questionnaire de courbatures n’est pas encore installé : passez lmfc_v35.sql dans Supabase.' : err.message)}</div>`;
    return;
  }
  const byId = new Map(SR.players.map(p => [p.id, p])), teams = window.CLUB_TEAMS || [];
  const dayOk = (id, d) => byId.has(id) && SR.sessions.some(s => !s.match && s.date_seance === d && srConcerned(s, byId.get(id)));
  const inTeam = (id, d) => byId.get(id)?.team_id === SR.team || dayOk(id, d);
  const name = (id) => teams.find(t => t.id === id)?.nom || 'Sans équipe';
  const rank = (id) => (id === SR.team ? -1 : teams.findIndex(t => t.id === id));
  const shown = [...new Set(SR.players.map(p => p.team_id))].sort((a, b) => rank(a) - rank(b));
  const pick = shown.includes(SR.soreTeam) ? SR.soreTeam : null, keep = (id) => pick == null || byId.get(id)?.team_id === pick;
  const count = (id) => SR.players.filter(p => id == null || p.team_id === id).length;
  const chips = teams.length && shown.length > 1 ? `<div class="sr-resp-filter sore-teams" role="group" aria-label="Équipe des joueurs">${[null, ...shown].map(id =>
    `<button type="button" class="sr-chip" data-sore-team="${id ?? ''}" aria-pressed="${id === pick}">${id == null ? 'Toutes les équipes' : escapeHtml(name(id))} <b>${count(id)}</b></button>`).join('')}</div>` : '';
  body.innerHTML = chips + soreHtml({
    players: SR.players.filter(p => keep(p.id)).sort((a, b) => rank(a.team_id) - rank(b.team_id)),   // tri stable : par nom dans chaque équipe
    days: [...new Set(SR.sessions.filter(x => !x.match).map(x => x.date_seance))],
    rows: SR.sore.rows.filter(x => dayOk(x.player_id, x.jour) && keep(x.player_id)),
    alerts: SR.sore.alerts.filter(x => inTeam(x.player_id, x.jour) && keep(x.player_id)),
    tag: (p) => (teams.length && p.team_id !== SR.team ? `<span class="sore-team">${escapeHtml(name(p.team_id))}</span>` : ''),
  });
}
