/* ============================================================
   FootSession Pro — video-send.js
   « Envoyer au staff » en une feuille, puis une confirmation :
     contenu (miniature, titre, durée, habillage) → destinataire
     → message facultatif (c'est l'analyse du joueur) → Envoyer.
   Après l'envoi, la feuille ne se ferme pas d'elle-même : elle
   confirme ce qui est parti, à qui, quand, et le statut.
   Utilisé par video-workspace.js : createSender(ws).
   ============================================================ */

function createSender(ws) {
  let club = null, seq = null;
  async function clubName() {
    if (club !== null) return club;
    try {
      const { data } = await sb.from('clubs').select('nom').eq('id', ws.video.club_id).maybeSingle();
      club = data?.nom || '';
    } catch (e) { console.warn('Nom du club indisponible', e); club = ''; }
    return club;
  }
  const to = () => `Staff${club ? ` — ${escapeHtml(club)}` : ''}`;
  const item = (s) => {
    const r = ws.range(s), n = (s.drawings || []).length;
    return `<div class="vw-send-item">
      ${thumbHtml(ws.src, r.start, fmtDur(r.end - r.start))}
      <span><strong>${escapeHtml(s.label || 'Séquence')}</strong>
        <small>${fmtDur(r.end - r.start)} · ${n ? `${n} annotation${n > 1 ? 's' : ''}` : 'sans habillage'}</small></span>
    </div>`;
  };

  async function open(s) {
    seq = s;
    await clubName();
    ws.showSheet(`
      <div class="vw-sheet" role="dialog" aria-modal="true" aria-labelledby="vwSendTitle">
        <div class="vw-sheet-grip" aria-hidden="true"></div>
        <h3 id="vwSendTitle">Envoyer au staff</h3>
        <div class="vw-send-part"><span class="vw-block-title">Contenu</span>${item(s)}</div>
        <div class="vw-send-part"><span class="vw-block-title">Destinataire</span>
          <strong>${to()}</strong><small class="vw-muted">Les entraîneurs de ton club : eux seuls la verront.</small></div>
        <label class="vw-send-part"><span class="vw-block-title">Message (facultatif)</span>
          <textarea rows="3" data-el="sendMsg" placeholder="Ce que tu veux que ton staff regarde…">${escapeHtml(s.player_note || '')}</textarea></label>
        <p class="vw-send-err hidden" data-el="sendErr" role="alert"></p>
        <div class="vw-sheet-actions">
          <button class="btn" type="button" data-act="sheet-close">Plus tard</button>
          <button class="btn btn-primary" type="button" data-act="send-confirm">${vwIc('send')}<span>Envoyer au staff</span></button>
        </div>
      </div>`);
  }

  async function confirm() {
    const s = seq; if (!s) return;
    const btn = ws.$w('[data-act="send-confirm"]'), err = ws.$w('[data-el="sendErr"]');
    if (!btn || btn.disabled) return;
    btn.disabled = true; btn.querySelector('span').textContent = 'Envoi…';
    err.classList.add('hidden');
    const msg = ws.$w('[data-el="sendMsg"]').value.trim() || null;
    const ok = await ws.patch(s, { selected: true, submitted_at: new Date().toISOString(), player_note: msg });
    if (!ok) {
      btn.disabled = false; btn.querySelector('span').textContent = 'Envoyer au staff';
      err.textContent = 'L’envoi n’a pas abouti. Vérifie ta connexion, puis réessaie.';
      err.classList.remove('hidden');
      return;
    }
    ws.showSheet(`
      <div class="vw-sheet vw-sent" role="dialog" aria-modal="true" aria-labelledby="vwSentTitle">
        <div class="vw-sent-ico" aria-hidden="true">${vwIc('check')}</div>
        <h3 id="vwSentTitle">Séquence envoyée au staff</h3>
        ${item(s)}
        <dl class="vw-sent-facts">
          <div><dt>Destinataire</dt><dd>${to()}</dd></div>
          <div><dt>Envoyée le</dt><dd>${escapeHtml(vwDate(s.submitted_at))}</dd></div>
          <div><dt>Statut</dt><dd>${statusPill(s)}</dd></div>
        </dl>
        <p class="vw-muted">Elle passera « Vu » dès que ton staff l’aura ouverte.</p>
        <button class="btn btn-primary" type="button" data-act="sheet-close">OK</button>
      </div>`);
    toast('Séquence envoyée au staff.', 'success');
  }

  return { open, confirm };
}
