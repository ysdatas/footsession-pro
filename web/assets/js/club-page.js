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
  const { data: members, error } = await sb.from('profiles').select('id, nom, role').eq('club_id', myProfile.club_id).order('nom');
  const list = document.getElementById('memberList');
  if (error) { list.innerHTML = `<p class="text-danger">${error.message}</p>`; return; }
  list.innerHTML = members.map(m => {
    const roleCell = isAdmin
      ? `<select data-id="${m.id}" class="role-select" ${m.id === myProfile.id ? 'disabled title="Vous ne pouvez pas changer votre propre rôle"' : ''}>
           ${Object.keys(ROLE_LABELS).map(r => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${ROLE_LABELS[r]}</option>`).join('')}
         </select>`
      : `<span class="badge badge-gold">${ROLE_LABELS[m.role] || m.role}</span>`;
    return `<div class="member-row"><span class="member-name">${escapeHtmlClub(m.nom || 'Membre')}</span>${roleCell}</div>`;
  }).join('') || '<p class="text-muted">Aucun membre.</p>';

  if (isAdmin) {
    list.querySelectorAll('.role-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const { error } = await sb.from('profiles').update({ role: sel.value }).eq('id', sel.dataset.id);
        if (error) toast(error.message, 'error'); else toast('Rôle mis à jour', 'success');
      });
    });
  }
}
function escapeHtmlClub(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
