/* ============================================================
   LMFC Performance — share-page.js
   Page publique en LECTURE SEULE d'une séance (aucune connexion
   requise). Utilise la fonction RPC get_shared_session(token),
   qui contourne le RLS de façon contrôlée (SECURITY DEFINER).
   ============================================================ */

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

(async () => {
  const token = new URLSearchParams(location.search).get('token');
  const wrap = document.getElementById('shareWrap');
  if (!token) { wrap.innerHTML = '<div class="empty">Lien de partage invalide.</div>'; return; }

  try {
    const { data, error } = await sb.rpc('get_shared_session', { p_token: token });
    if (error) throw error;
    if (!data || !data.session) { wrap.innerHTML = '<div class="empty">Lien de partage invalide ou expiré.</div>'; return; }

    const s = data.session, club = data.club || {}, procedures = data.procedures || [], attendance = data.attendance || [];
    document.title = 'LMFC Performance — ' + (s.titre || 'Séance');

    let logoUrl = null;
    if (club.logo_path) logoUrl = sb.storage.from('logos').getPublicUrl(club.logo_path).data.publicUrl;

    const principe = sessionPrinciple(s, procedures);
    const metaParts = [
      `<span>Date : ${escapeHtml(fmtDateFrLong(s.date_seance))}</span>`,
      principe ? `<span>Principe de jeu : ${escapeHtml(principe)}</span>` : '',
      s.equipe ? `<span>Équipe : ${escapeHtml(s.equipe)}</span>` : '',
      `<span>Durée séance : ${s.duree_min} min</span>`,
      `<span>Travail : ${fmtMin(sessionWorkMin(procedures))} min</span>`,
      `<span>Total : ${fmtMin(sessionTotalMin(procedures))} min</span>`,
      `<span>${procedures.length} procédé${procedures.length > 1 ? 's' : ''}</span>`,
      s.filmee ? '<span>Séance filmée</span>' : '',
    ].filter(Boolean).join('');

    // Chasubles : celles de chaque procédé ; ancienne séance, celles de toute la séance.
    const perProc = procedures.some(p => Array.isArray(p.equipes) && p.equipes.length);
    const nameOf = (a) => `${a.prenom || ''} ${a.nom}`.trim() + (a.numero != null ? ' #' + a.numero : '');
    const teamsHtml = (list) => (Array.isArray(list) ? list : []).filter(t => (t.player_ids || []).length).map(t => {
      const noms = (t.player_ids || []).map(id => attendance.find(a => a.id === id)).filter(Boolean).map(nameOf).join(', ');
      return `<div class="sp-field" style="border-left:3px solid ${escapeHtml(t.couleur || '#888')};padding-left:8px;margin-bottom:6px;">
        <b>${escapeHtml(t.nom || 'Équipe')} :</b> ${escapeHtml(noms || '—')}</div>`;
    }).join('');
    const procsHtml = procedures.map((p, i) => {
      const imgUrl = p.image_path ? sb.storage.from('schemas').getPublicUrl(p.image_path).data.publicUrl : null;
      // Le principe de jeu est celui de la séance (en tête) ; un ancien
      // procédé qui avait le sien, différent, le garde ici.
      const own = (p.principes_jeu || '').trim();
      const fields = [
        ['objectif', 'Objectif'], ['consignes', 'Consignes'], ['postes_cibles', 'Postes ciblés'],
        ['principes_jeu', 'Principe de jeu'], ['comportements_individuels', 'Comportements'],
      ].filter(([k]) => p[k] && (k !== 'principes_jeu' || own !== principe))
        .map(([k, lbl]) => `<div class="sp-field"><b>${lbl} :</b> ${escapeHtml(p[k])}</div>`).join('');
      const meta = [p.type_procede, sequenceLabel(p), procIsFilmed(p, s) ? 'filmé' : ''].filter(Boolean).join(' · ');
      const staff = (Array.isArray(p.staff) ? p.staff : []).filter(m => (m.nom || '').trim());
      return `<div class="card sp-proc">
        <h3><span>${i + 1}. ${escapeHtml(p.nom)}</span><span class="text-muted">${escapeHtml(meta)}</span></h3>
        ${imgUrl ? `<img src="${imgUrl}" alt="Schéma">` : ''}
        ${fields}
        ${perProc ? teamsHtml(p.equipes) : ''}
        ${staff.length ? `<div class="sp-field"><b>Staff :</b> ${staff.map(m => escapeHtml(`${m.nom}${m.role ? ` (${m.role})` : ''}`)).join(' · ')}</div>` : ''}
      </div>`;
    }).join('');

    // Présents regroupés, absents à part : on cherchait les pastilles vertes
    // une par une quand tout était mélangé.
    const presents = attendance.filter(a => a.present);
    const absents = attendance.filter(a => !a.present);
    const pills = (list, color) => `<div class="tag-row" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${list.map(a => `<span class="pill" style="border-color:${color};">${escapeHtml(nameOf(a))}${a.invite ? ' · invité' : ''}</span>`).join('')}
      </div>`;

    const attHtml = attendance.length ? `<div class="card">
      <h3>Présents — ${presents.length}/${attendance.length}</h3>
      ${presents.length ? pills(presents, 'var(--success)') : '<p class="text-muted">Aucun.</p>'}
      ${absents.length ? `<h3 style="margin-top:16px;">Absents — ${absents.length}</h3>${pills(absents, 'var(--border)')}` : ''}
    </div>` : '';

    const legacyTeams = perProc ? '' : teamsHtml(s.equipes);
    const sessionTeamsHtml = legacyTeams ? `<div class="card"><h3>Équipes de travail</h3>${legacyTeams}</div>` : '';

    wrap.innerHTML = `
      <div class="share-head">
        ${logoUrl ? `<img src="${logoUrl}" alt="">` : ''}
        <div style="flex:1;">
          <h1 style="margin:0;">${escapeHtml(s.titre)}</h1>
          <div class="text-muted">${escapeHtml(club.nom || 'LMFC Performance')}</div>
        </div>
        <span class="ro-badge">LECTURE SEULE</span>
      </div>
      <div class="sp-meta">${metaParts}</div>
      ${procsHtml}
      ${attHtml}
      ${sessionTeamsHtml}
      <p class="text-muted" style="text-align:center;margin-top:24px;font-size:var(--fs-sm);">Généré par LMFC Performance</p>`;
  } catch (e) {
    wrap.innerHTML = `<div class="empty">Erreur de chargement : ${escapeHtml(e.message)}</div>`;
  }
})();
