/* ============================================================
   LMFC Performance — session-rpe.js (session-edit)
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

const SRPE = { rows: new Map(), others: new Map(), bound: false };

async function initSessionRpe() {
  const card = document.getElementById('srpeCard');
  if (!card || !savedSessionId || !canAccessTeamReviewTools(myProfile.role)) return;
  const [{ data, error }, o] = await Promise.all([sb.from('session_rpe').select('player_id, rpe, corrige_par').eq('session_id', savedSessionId),
    sb.rpc('rpe_slot_others', { p_sessions: [savedSessionId] })]);   // lmfc_v61.sql : même demi-journée, autres équipes
  if (o.error && o.error.code !== 'PGRST202') console.warn('RPE : demi-journée illisible', o.error.message);
  SRPE.others = new Map();
  (o.data || []).forEach(x => SRPE.others.set(x.player_id, [...(SRPE.others.get(x.player_id) || []), x]));
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
    document.getElementById('f-rpe-att').addEventListener('change', renderSessionRpe);
  }
}

function renderSessionRpe() {
  // Attendu : participe, ou présence pas encore enregistrée (rpeExpected) ; savedAtt : session-roster.js.
  // Un seul RPE par demi-journée (lmfc_v61.sql) : away, la séance qui porte la sienne si c'est une autre ; dups, ses autres réponses.
  const people = attendance.map(a => {
    const list = SRPE.others.get(a.player_id) || [], own = list[0]?.owner_id;
    return { a, r: SRPE.rows.get(a.player_id), exp: rpeExpected(savedAtt.has(a.player_id) ? a : null),
      away: own && own !== savedSessionId ? list.find(x => x.other_id === own) : null, dups: list.filter(x => x.other_rpe != null) };
  });
  const answered = people.filter(p => p.r).sort((x, y) => y.r.rpe - x.r.rpe || rosterName(x.a).localeCompare(rosterName(y.a), 'fr'));
  const away = people.filter(p => !p.r && p.away);
  const missing = people.filter(p => !p.r && p.exp && !p.away);
  const vals = answered.map(p => p.r.rpe);
  document.getElementById('srpeCount').textContent = `${answered.length}/${answered.length + missing.length}`;
  const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  const att = Number(document.getElementById('f-rpe-att')?.value) || null;   // RPE attendue (lmfc_v34.sql), à part de la charge
  const sum = (vals.length
    ? `${vals.length} réponse${vals.length > 1 ? 's' : ''} | moyenne <strong>${rpeFr(avg)}</strong>
       | plus bas <strong>${Math.min(...vals)}</strong> | plus haut <strong>${Math.max(...vals)}</strong>`
    : 'Aucune réponse pour l’instant.')
    + (att ? `<br>RPE attendue <strong>${att}</strong>${avg !== null ? ` | écart <strong class="rpe-gap">${rpeGapFr(avg - att)}</strong> (moyenne déclarée − attendue)` : ''}` : '');
  const noPresence = attendance.length && !attendance.some(a => savedAtt.has(a.player_id));
  document.getElementById('srpeBody').innerHTML = `<p class="srpe-sum">${sum}</p>
    ${answered.length ? `<div class="srpe-list">${answered.map(({ a, r, exp, dups }) => `<div class="srpe-row">
      <span class="srpe-name">${escapeHtml(rosterName(a))}</span>
      <span class="srpe-bar" aria-hidden="true"><span style="--w:${r.rpe * 10}%;--rpe:${rpeColor(r.rpe)}"></span></span>
      <strong class="srpe-v">${r.rpe}</strong>
      <span class="srpe-l">${escapeHtml(rpeLabel(r.rpe))}${r.corrige_par ? ' <span class="rpe-staff">staff</span>' : ''}${exp ? '' : ' | noté absent'}${
        dups.length ? ` | <span class="text-danger">aussi noté avec ${escapeHtml(dups.map(x => `${x.other_label} (${x.other_rpe})`).join(', '))}</span>` : ''}</span>
      <button class="btn btn-sm" type="button" data-srpe="${a.player_id}" aria-label="Corriger le RPE de ${escapeHtml(rosterName(a))}">Corriger</button>
    </div>`).join('')}</div>` : ''}
    ${missing.length ? `<p class="srpe-miss-h">Sans réponse (${missing.length})</p><div class="srpe-miss">${missing.map(({ a }) =>
      `<button type="button" class="chip" data-srpe="${a.player_id}" title="Saisir à sa place">${escapeHtml(rosterName(a))}</button>`).join('')}</div>` : ''}
    ${away.length ? `<p class="srpe-miss-h">Notés à une autre séance de la demi-journée (${away.length})</p><div class="srpe-miss">${away.map(({ a, away: w }) =>
      `<button type="button" class="chip" data-srpe="${a.player_id}" title="${escapeHtml(`Avec ${w.other_label}${w.other_rpe != null ? ` : ${w.other_rpe}` : ''}. Saisir ici l’y retire.`)}">${escapeHtml(`${rosterName(a)} – ${w.other_label}`)}</button>`).join('')}</div>` : ''}
    <p class="srpe-help">Réponses des joueurs depuis leur espace, du jour de la séance à J+${RPE_DAYS}, une seule fois : leur ressenti, à part du bilan du staff.
      Ensuite, seul le staff saisit ou corrige (marqué <span class="rpe-staff">staff</span>). Un seul RPE par demi-journée et par joueur, toutes équipes confondues.${noPresence ? ' Présences non renseignées : tout l’effectif est attendu.' : ''}</p>`;
}

function editSessionRpe(e) {
  const b = e.target.closest('[data-srpe]');
  if (!b) return;
  const id = Number(b.dataset.srpe), a = attendance.find(x => x.player_id === id);
  const list = SRPE.others.get(id) || [], elsewhere = list.filter(x => x.other_rpe != null);
  openRpeSheet({
    note: elsewhere.length ? `Un seul RPE par demi-journée : ${elsewhere.map(x => `${x.other_label} (${x.other_rpe})`).join(', ')} sera retiré si vous enregistrez une valeur ici.` : '',
    session: { id: savedSessionId, titre: document.getElementById('f-titre').value.trim(), date: document.getElementById('f-date').value, heure: document.getElementById('f-heure').value },
    value: SRPE.rows.get(id)?.rpe ?? null, player: { id, nom: rosterName(a) }, onSaved: () => initSessionRpe(),
  });
}
