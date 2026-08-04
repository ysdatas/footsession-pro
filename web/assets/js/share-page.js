/* ============================================================
   FootSession Pro — share-page.js
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
    document.title = 'FootSession Pro — ' + (s.titre || 'Séance');

    let logoUrl = null;
    if (club.logo_path) logoUrl = sb.storage.from('logos').getPublicUrl(club.logo_path).data.publicUrl;

    const metaParts = [
      `<span>Date : ${escapeHtml(s.date_seance)}</span>`,
      s.equipe ? `<span>Équipe : ${escapeHtml(s.equipe)}</span>` : '',
      `<span>Durée séance : ${s.duree_min} min</span>`,
      `<span>Travail : ${fmtMin(sessionWorkMin(procedures))} min</span>`,
      `<span>Total : ${fmtMin(sessionTotalMin(procedures))} min</span>`,
      `<span>${procedures.length} procédé${procedures.length > 1 ? 's' : ''}</span>`,
    ].filter(Boolean).join('');

    const procsHtml = procedures.map((p, i) => {
      const imgUrl = p.image_path ? sb.storage.from('schemas').getPublicUrl(p.image_path).data.publicUrl : null;
      const fields = [
        ['objectif', 'Objectif'], ['consignes', 'Consignes'], ['postes_cibles', 'Postes ciblés'],
        ['principes_jeu', 'Principes'], ['comportements_individuels', 'Comportements'],
      ].filter(([k]) => p[k]).map(([k, lbl]) => `<div class="sp-field"><b>${lbl} :</b> ${escapeHtml(p[k])}</div>`).join('');
      const meta = [p.type_procede, sequenceLabel(p)].filter(Boolean).join(' · ');
      return `<div class="card sp-proc">
        <h3><span>${i + 1}. ${escapeHtml(p.nom)}</span><span class="text-muted">${escapeHtml(meta)}</span></h3>
        ${imgUrl ? `<img src="${imgUrl}" alt="Schéma">` : ''}
        ${fields}
      </div>`;
    }).join('');

    const present = attendance.filter(a => a.present).length;
    const attHtml = attendance.length ? `<div class="card">
      <h3>Présence — ${present}/${attendance.length}</h3>
      <div class="tag-row" style="display:flex;flex-wrap:wrap;gap:6px;">
        ${attendance.map(a => `<span class="pill" style="border-color:${a.present ? 'var(--success)' : 'var(--border)'};">${escapeHtml((a.prenom || '') + ' ' + a.nom)}${a.numero != null ? ' #' + a.numero : ''}</span>`).join('')}
      </div>
    </div>` : '';

    wrap.innerHTML = `
      <div class="share-head">
        ${logoUrl ? `<img src="${logoUrl}" alt="">` : ''}
        <div style="flex:1;">
          <h1 style="margin:0;">${escapeHtml(s.titre)}</h1>
          <div class="text-muted">${escapeHtml(club.nom || 'FootSession Pro')}</div>
        </div>
        <span class="ro-badge">LECTURE SEULE</span>
      </div>
      <div class="sp-meta">${metaParts}</div>
      ${procsHtml}
      ${attHtml}
      <p class="text-muted" style="text-align:center;margin-top:24px;font-size:.8rem;">Généré par FootSession Pro</p>`;
  } catch (e) {
    wrap.innerHTML = `<div class="empty">Erreur de chargement : ${escapeHtml(e.message)}</div>`;
  }
})();
