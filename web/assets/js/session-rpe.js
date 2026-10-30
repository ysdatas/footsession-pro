/* ============================================================
   LMFC Performance — session-rpe.js (session-edit.html)
   Bloc « RPE des joueurs » d'une séance enregistrée (lmfc_v29.sql) :
   synthèse de l'équipe (réponses, moyenne, plus bas, plus haut), une
   barre par joueur, ceux dont la réponse est attendue (rpeExpected) et
   manque. Le staff qui suit un joueur corrige ou saisit à sa place, dans
   la même feuille que le joueur (marqué « staff ») ;
   la base décide. Le RPE est la perception du joueur : il reste à part
   du bilan du staff. Aucun calcul de charge, aucune alerte.
   Dépend de session-edit-page.js (attendance, savedSessionId,
   myProfile), session-roster.js (rosterName, savedAtt), procedure-time.js
   (participe), rpe.js.
   ============================================================ */

const SRPE = { rows: new Map(), bound: false };

async function initSessionRpe() {
  const card = document.getElementById('srpeCard');
  if (!card || !savedSessionId || !['admin', 'coach', 'prepa'].includes(myProfile.role)) return;
  const { data, error } = await sb.from('session_rpe').select('player_id, rpe, corrige_par').eq('session_id', savedSessionId);
  if (error) {
    if (!['42P01', 'PGRST205'].includes(error.code)) console.warn('RPE de la séance illisible', error.message);
    return;   // sans lmfc_v29.sql : pas de bloc
  }
  SRPE.rows = new Map(data.map(r => [r.player_id, r]));
  card.classList.remove('hidden');
  renderSessionRpe();
  if (!SRPE.bound) {
    SRPE.bound = true;
    document.getElementById('srpeBody').addEventListener('click', editSessionRpe);
  }
}

function renderSessionRpe() {
  // Attendu : participe, ou présence pas encore enregistrée (rpeExpected) ; savedAtt : session-roster.js.
  const people = attendance.map(a => ({ a, r: SRPE.rows.get(a.player_id), exp: rpeExpected(savedAtt.has(a.player_id) ? a : null) }));
  const answered = people.filter(p => p.r).sort((x, y) => y.r.rpe - x.r.rpe || rosterName(x.a).localeCompare(rosterName(y.a), 'fr'));
  const missing = people.filter(p => !p.r && p.exp);
  const vals = answered.map(p => p.r.rpe);
  document.getElementById('srpeCount').textContent = `${answered.length}/${answered.length + missing.length}`;
  const sum = vals.length
    ? `${vals.length} réponse${vals.length > 1 ? 's' : ''} · moyenne <strong>${rpeFr(vals.reduce((s, v) => s + v, 0) / vals.length)}</strong>
       · plus bas <strong>${Math.min(...vals)}</strong> · plus haut <strong>${Math.max(...vals)}</strong>`
    : 'Aucune réponse pour l’instant.';
  const noPresence = attendance.length && !attendance.some(a => savedAtt.has(a.player_id));
  document.getElementById('srpeBody').innerHTML = `<p class="srpe-sum">${sum}</p>
    ${answered.length ? `<div class="srpe-list">${answered.map(({ a, r, exp }) => `<div class="srpe-row">
      <span class="srpe-name">${escapeHtml(rosterName(a))}</span>
      <span class="srpe-bar" aria-hidden="true"><span style="--w:${r.rpe * 10}%;--rpe:${rpeColor(r.rpe)}"></span></span>
      <strong class="srpe-v">${r.rpe}</strong>
      <span class="srpe-l">${escapeHtml(rpeLabel(r.rpe))}${r.corrige_par ? ' <span class="rpe-staff">staff</span>' : ''}${exp ? '' : ' · noté absent'}</span>
      <button class="btn btn-sm" type="button" data-srpe="${a.player_id}" aria-label="Corriger le RPE de ${escapeHtml(rosterName(a))}">Corriger</button>
    </div>`).join('')}</div>` : ''}
    ${missing.length ? `<p class="srpe-miss-h">Sans réponse (${missing.length})</p><div class="srpe-miss">${missing.map(({ a }) =>
      `<button type="button" class="chip" data-srpe="${a.player_id}" title="Saisir à sa place">${escapeHtml(rosterName(a))}</button>`).join('')}</div>` : ''}
    <p class="srpe-help">Réponses des joueurs depuis leur espace, du jour de la séance à J+2 : leur ressenti, à part du bilan du staff.
      Ensuite, seul le staff saisit ou corrige (marqué <span class="rpe-staff">staff</span>).${noPresence ? ' Présences non renseignées : tout l’effectif est attendu.' : ''}</p>`;
}

function editSessionRpe(e) {
  const b = e.target.closest('[data-srpe]');
  if (!b) return;
  const id = Number(b.dataset.srpe), a = attendance.find(x => x.player_id === id);
  openRpeSheet({
    session: { id: savedSessionId, titre: document.getElementById('f-titre').value.trim(), date: document.getElementById('f-date').value },
    value: SRPE.rows.get(id)?.rpe ?? null, player: { id, nom: rosterName(a) }, onSaved: () => initSessionRpe(),
  });
}
