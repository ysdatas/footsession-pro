/* ============================================================
   LMFC Performance — suivi-rpe-grid.js (suivi-rpe)
   Vue « Détail joueurs » : la grille joueurs × séances ou matchs affichés
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
      const w = srAway(s, p), t = `${label} : RPE ${w.other_rpe} donné avec ${w.other_label} (même demi-journée), saisir ici l’y retire`;
      return `<td><button type="button" class="sr-c is-away" data-sr="${j}:${i}" title="${escapeHtml(t)}" aria-label="${escapeHtml(t)}">${escapeHtml(srAwayTeam(w))}<i>${w.other_rpe}</i></button></td>`;
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
