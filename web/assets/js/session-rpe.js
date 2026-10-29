/* ============================================================
   LMFC Performance — session-rpe.js (session-edit.html)
   Bloc « RPE des joueurs » d'une séance enregistrée (lmfc_v29.sql) :
   synthèse de l'équipe (réponses, moyenne, plus bas, plus haut), une
   barre par joueur, ceux qui participent sans avoir répondu. Le staff
   qui suit un joueur corrige ou saisit à sa place (marqué « staff ») ;
   la base décide. Le RPE est la perception du joueur : il reste à part
   du bilan du staff. Aucun calcul de charge, aucune alerte.
   Dépend de session-edit-page.js (attendance, savedSessionId,
   myProfile), session-roster.js (rosterName), procedure-time.js
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
  const people = attendance.map(a => ({ a, r: SRPE.rows.get(a.player_id) }));
  const answered = people.filter(p => p.r).sort((x, y) => y.r.rpe - x.r.rpe || rosterName(x.a).localeCompare(rosterName(y.a), 'fr'));
  const missing = people.filter(p => !p.r && participe(p.a));
  const present = people.filter(p => participe(p.a)).length;
  const vals = answered.map(p => p.r.rpe);
  document.getElementById('srpeCount').textContent = `${answered.length}/${present}`;
  const sum = vals.length
    ? `${vals.length} réponse${vals.length > 1 ? 's' : ''} · moyenne <strong>${rpeFr(vals.reduce((s, v) => s + v, 0) / vals.length)}</strong>
       · plus bas <strong>${Math.min(...vals)}</strong> · plus haut <strong>${Math.max(...vals)}</strong>`
    : 'Aucune réponse pour l’instant.';
  document.getElementById('srpeBody').innerHTML = `<p class="srpe-sum">${sum}</p>
    ${answered.length ? `<div class="srpe-list">${answered.map(({ a, r }) => `<div class="srpe-row">
      <span class="srpe-name">${escapeHtml(rosterName(a))}</span>
      <span class="srpe-bar" aria-hidden="true"><span style="--w:${r.rpe * 10}%;--rpe:${rpeColor(r.rpe)}"></span></span>
      <strong class="srpe-v">${r.rpe}</strong>
      <span class="srpe-l">${escapeHtml(rpeLabel(r.rpe))}${r.corrige_par ? ' · saisi par le staff' : ''}${participe(a) ? '' : ' · noté absent'}</span>
      <button class="btn btn-sm" type="button" data-srpe="${a.player_id}" aria-label="Corriger le RPE de ${escapeHtml(rosterName(a))}">Corriger</button>
    </div>`).join('')}</div>` : ''}
    ${missing.length ? `<p class="srpe-miss-h">Sans réponse (${missing.length})</p><div class="srpe-miss">${missing.map(({ a }) =>
      `<button type="button" class="chip" data-srpe="${a.player_id}" title="Saisir à sa place">${escapeHtml(rosterName(a))}</button>`).join('')}</div>` : ''}
    <p class="srpe-help">Les joueurs répondent depuis leur espace, du jour de la séance à J+2. Ensuite, seul le staff saisit ou corrige.</p>`;
}

async function editSessionRpe(e) {
  const b = e.target.closest('[data-srpe]');
  if (!b) return;
  const id = Number(b.dataset.srpe), a = attendance.find(x => x.player_id === id), cur = SRPE.rows.get(id)?.rpe;
  const v = prompt(`RPE de ${rosterName(a)} (1 à 10). Laisser vide pour effacer.`, cur ?? '');
  if (v === null) return;
  const n = v.trim() === '' ? null : Number(v);
  if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= 10)) return toast('Le RPE va de 1 à 10.', 'error');
  const { error } = await sb.rpc('rpe_set', { p_session: savedSessionId, p_rpe: n, p_player: id });
  if (error) { console.error('RPE non corrigé', error); return toast(error.message, 'error'); }
  toast(n === null ? 'RPE effacé' : `RPE de ${rosterName(a)} : ${n} (saisi par le staff)`, 'success');
  initSessionRpe();
}
