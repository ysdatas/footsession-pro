/* ============================================================
   FootSession Pro — club-page.js
   Logique de la page « Mon club » : identité (nom/couleur/logo),
   code d'invitation, gestion des rôles des membres.
   ============================================================ */

let logoFile = null;
let myProfile = null;

(async () => {
  try {
    const ctx = await requireAuth();
    if (!ctx) return;
    myProfile = ctx.profile;

    document.getElementById('uName').textContent = myProfile.nom || 'Utilisateur';
    document.getElementById('uRole').textContent = (ROLE_LABELS[myProfile.role] || myProfile.role).toUpperCase();
    document.getElementById('uAvatar').textContent = (myProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

    const club = myProfile.clubs;
    document.getElementById('clubSub').textContent = club?.nom || 'Club';
    document.getElementById('clubName').value = club?.nom || '';
    document.getElementById('clubColor').value = club?.color || '#C9A84C';
    document.getElementById('clubSaison').value = club?.saison_start || '';

    if (club?.logo_path) {
      const { data } = await sb.storage.from('logos').createSignedUrl(club.logo_path, 3600);
      if (data?.signedUrl) {
        document.getElementById('logoPreview').src = data.signedUrl;
        document.getElementById('logoPreviewWrap').classList.remove('hidden');
      }
    }

    const isAdmin = myProfile.role === 'admin';
    if (isAdmin) {
      document.getElementById('clubName').disabled = false;
      document.getElementById('clubColor').disabled = false;
      document.getElementById('clubSaison').disabled = false;
      document.getElementById('clubLogoFile').disabled = false;
      document.getElementById('saveClub').classList.remove('hidden');
      document.getElementById('inviteCard').classList.remove('hidden');
      document.getElementById('joinCode').textContent = club?.join_code || '------';
    } else {
      document.getElementById('viewerNote').classList.remove('hidden');
    }

    document.getElementById('clubLogoFile').addEventListener('change', (e) => {
      logoFile = e.target.files[0] || null;
      if (logoFile) {
        document.getElementById('logoPreview').src = URL.createObjectURL(logoFile);
        document.getElementById('logoPreviewWrap').classList.remove('hidden');
      }
    });

    document.getElementById('copyCode').addEventListener('click', () => {
      navigator.clipboard?.writeText(document.getElementById('joinCode').textContent);
      toast('Code copié', 'success');
    });

    document.getElementById('saveClub').addEventListener('click', async () => {
      const btn = document.getElementById('saveClub'); btn.disabled = true;
      try {
        const updates = { nom: document.getElementById('clubName').value.trim(), color: document.getElementById('clubColor').value };
        // Champ date vide → null, sinon Postgres refuse la chaîne vide.
        updates.saison_start = document.getElementById('clubSaison').value || null;
        if (logoFile) {
          const path = `${myProfile.club_id}/logo-${Date.now()}.${logoFile.name.split('.').pop()}`;
          const { error: upErr } = await sb.storage.from('logos').upload(path, logoFile, { upsert: true });
          if (upErr) throw upErr;
          updates.logo_path = path;
        }
        const { error } = await sb.from('clubs').update(updates).eq('id', myProfile.club_id);
        if (error) throw error;
        toast('Club mis à jour', 'success');
        setTimeout(() => location.reload(), 700);
      } catch (e) { toast(e.message || 'Erreur', 'error'); }
      finally { btn.disabled = false; }
    });

    await loadMembers(isAdmin);
  } catch (e) {
    document.getElementById('clubSub').textContent = 'Erreur de chargement.';
    console.error('club-page.js init error:', e);
  }
})();

async function loadMembers(isAdmin) {
  const list = document.getElementById('memberList');
  const [{ data: members, error }, { data: roster, error: rosterError }] = await Promise.all([
    sb.from('profiles').select('id, nom, role').eq('club_id', myProfile.club_id).order('nom'),
    sb.from('players').select('id, nom, prenom, numero, auth_user_id').eq('club_id', myProfile.club_id).order('nom')
  ]);
  if (error || rosterError) {
    list.innerHTML = `<p class="text-danger">${escapeHtmlClub((error || rosterError).message)}</p>`;
    return;
  }

  const availablePlayers = roster || [];
  list.innerHTML = (members || []).map(m => {
    const linked = availablePlayers.find(p => p.auth_user_id === m.id);
    const roleCell = isAdmin
      ? `<div class="member-controls">
          <select data-id="${m.id}" class="role-select" ${m.id === myProfile.id ? 'disabled title="Vous ne pouvez pas changer votre propre rôle"' : ''}>
            ${Object.keys(ROLE_LABELS).map(r => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${ROLE_LABELS[r]}</option>`).join('')}
          </select>
          <select class="player-link-select ${m.role === 'joueur' ? '' : 'hidden'}" data-profile-id="${m.id}" aria-label="Fiche joueur">
            <option value="">— Associer une fiche joueur —</option>
            ${availablePlayers.filter(p => !p.auth_user_id || p.auth_user_id === m.id).map(p =>
              `<option value="${p.id}" ${linked?.id === p.id ? 'selected' : ''}>${escapeHtmlClub(`${p.prenom || ''} ${p.nom}`.trim())}${p.numero != null ? ` #${p.numero}` : ''}</option>`
            ).join('')}
          </select>
          <button type="button" class="btn btn-sm player-link-save ${m.role === 'joueur' ? '' : 'hidden'}" data-profile-id="${m.id}" ${m.id === myProfile.id ? 'disabled' : ''}>Associer</button>
        </div>`
      : `<span class="badge badge-gold">${ROLE_LABELS[m.role] || m.role}${linked ? ` · ${escapeHtmlClub(`${linked.prenom || ''} ${linked.nom}`.trim())}` : ''}</span>`;
    return `<div class="member-row"><span class="member-name">${escapeHtmlClub(m.nom || 'Membre')}</span>${roleCell}</div>`;
  }).join('') || '<p class="text-muted">Aucun membre.</p>';

  if (!isAdmin) return;

  list.querySelectorAll('.role-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const profileId = sel.dataset.id;
      const role = sel.value;
      if (role === 'joueur') {
        list.querySelector(`.player-link-select[data-profile-id="${profileId}"]`)?.classList.remove('hidden');
        list.querySelector(`.player-link-save[data-profile-id="${profileId}"]`)?.classList.remove('hidden');
        return;
      }
      sel.disabled = true;
      const { error: rpcError } = await sb.rpc('club_set_member_role', { p_profile_id: profileId, p_role: role });
      sel.disabled = false;
      if (rpcError) { toast(rpcError.message, 'error'); await loadMembers(isAdmin); }
      else { toast('Rôle mis à jour', 'success'); await loadMembers(isAdmin); }
    });
  });

  list.querySelectorAll('.player-link-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const profileId = btn.dataset.profileId;
      const playerId = list.querySelector(`.player-link-select[data-profile-id="${profileId}"]`)?.value;
      if (!playerId) { toast('Choisissez une fiche joueur.', 'error'); return; }
      btn.disabled = true;
      const { error: rpcError } = await sb.rpc('club_link_player', {
        p_profile_id: profileId,
        p_player_id: Number(playerId)
      });
      btn.disabled = false;
      if (rpcError) toast(rpcError.message, 'error');
      else { toast('Compte associé à la fiche joueur.', 'success'); await loadMembers(isAdmin); }
    });
  });
}
function escapeHtmlClub(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
