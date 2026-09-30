/* ============================================================
   FootSession Pro — club-page.js
   Page « Mon club » : identité (nom, couleur, logo), équipes,
   accès par adresse e-mail et membres (admin, coach, joueur).
   ============================================================ */

let logoFile = null;
let myProfile = null;
let roster = [];        // fiches joueurs du club
let isAdmin = false;

(async () => {
  try {
    const ctx = await requireAuth();
    if (!ctx) return;
    myProfile = ctx.profile;
    isAdmin = myProfile.role === 'admin';

    document.getElementById('uName').textContent = myProfile.nom || 'Utilisateur';
    document.getElementById('uRole').textContent = (ROLE_LABELS[myProfile.role] || myProfile.role).toUpperCase();
    document.getElementById('uAvatar').textContent = (myProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

    const club = myProfile.clubs;
    document.getElementById('clubSub').textContent = club?.nom || 'Club';
    document.getElementById('clubName').value = club?.nom || '';
    document.getElementById('clubColor').value = club?.color || '#C9A84C';

    if (club?.logo_path) {
      const { data } = await sb.storage.from('logos').createSignedUrl(club.logo_path, 3600);
      if (data?.signedUrl) showLogo(data.signedUrl);
    }

    renderTeams(isAdmin);
    if (isAdmin) {
      for (const id of ['clubName', 'clubColor', 'logoTile']) document.getElementById(id).disabled = false;
      document.getElementById('saveClub').classList.remove('hidden');
      document.getElementById('accessCard').classList.remove('hidden');
    } else {
      document.getElementById('viewerNote').classList.remove('hidden');
    }

    document.getElementById('logoTile').addEventListener('click', () => document.getElementById('clubLogoFile').click());
    document.getElementById('clubLogoFile').addEventListener('change', (e) => {
      logoFile = e.target.files[0] || null;
      if (logoFile) showLogo(URL.createObjectURL(logoFile));
    });

    document.getElementById('saveClub').addEventListener('click', async () => {
      const btn = document.getElementById('saveClub'); btn.disabled = true;
      try {
        const updates = { nom: document.getElementById('clubName').value.trim(), color: document.getElementById('clubColor').value };
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

    await loadMembers();
  } catch (e) {
    document.getElementById('clubSub').textContent = 'Erreur de chargement.';
    console.error('club-page.js init error:', e);
  }
})();

function showLogo(src) {
  const img = document.getElementById('logoPreview');
  img.src = src;
  img.classList.remove('hidden');
  document.getElementById('logoEmpty').classList.add('hidden');
}

const playerName = (p) => `${p.prenom || ''} ${p.nom || ''}`.trim() || 'Joueur';

/* ---------- Accès (e-mail + fonction + fiche) et membres ---------- */
async function loadMembers() {
  const list = document.getElementById('memberList');
  const [{ data: members, error }, { data: players, error: rosterError }, access] = await Promise.all([
    sb.from('profiles').select('id, nom, role').eq('club_id', myProfile.club_id).order('nom'),
    sb.from('players').select('id, nom, prenom, auth_user_id').eq('club_id', myProfile.club_id).order('nom'),
    isAdmin ? sb.from('club_access').select('*').is('claimed_at', null).order('created_at', { ascending: false }) : { data: [] },
  ]);
  if (error || rosterError) {
    list.innerHTML = `<p class="text-danger">${escapeHtml((error || rosterError).message)}</p>`;
    return;
  }
  roster = players || [];
  if (access.error) console.warn('Accès indisponibles (migration platform_v2.sql non passée ?) :', access.error.message);
  const pending = access.data || [];

  if (isAdmin) renderAccess(pending);

  list.innerHTML = (members || []).map(m => {
    const linked = roster.find(p => p.auth_user_id === m.id);
    const sub = m.role === 'joueur' ? (linked ? `Fiche : ${escapeHtml(playerName(linked))}` : 'Aucune fiche associée') : (ROLE_LABELS[m.role] || m.role);
    const self = m.id === myProfile.id;
    const controls = isAdmin && !self
      ? `<div class="member-controls" data-id="${m.id}">
          <select class="role-select" aria-label="Fonction">
            ${Object.keys(ROLE_LABELS).map(r => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${ROLE_LABELS[r]}</option>`).join('')}
          </select>
          <select class="player-link-select ${m.role === 'joueur' ? '' : 'hidden'}" aria-label="Fiche joueur">
            <option value="">Choisir le joueur…</option>
            ${roster.filter(p => !p.auth_user_id || p.auth_user_id === m.id).map(p =>
              `<option value="${p.id}" ${linked?.id === p.id ? 'selected' : ''}>${escapeHtml(playerName(p))}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-sm btn-danger" data-remove>Retirer</button>
        </div>`
      : `<span class="badge badge-gold">${self ? 'Vous · ' : ''}${ROLE_LABELS[m.role] || m.role}</span>`;
    return `<div class="member-row"><span class="member-name">${escapeHtml(m.nom || 'Membre')}<small>${sub}</small></span>${controls}</div>`;
  }).join('') || '<p class="text-muted">Aucun membre.</p>';
}

function renderAccess(pending) {
  const sel = document.getElementById('accPlayer');
  const taken = new Set(pending.map(a => a.player_id).filter(Boolean));
  sel.innerHTML = '<option value="">Choisir le joueur…</option>' + roster
    .filter(p => !p.auth_user_id && !taken.has(p.id))
    .map(p => `<option value="${p.id}">${escapeHtml(playerName(p))}</option>`).join('');
  syncAccessForm();
  document.getElementById('pendingList').innerHTML = pending.length
    ? `<div class="access-list"><h4>En attente de première connexion</h4>${pending.map(a => {
        const p = roster.find(x => x.id === a.player_id);
        return `<div class="member-row"><span class="member-name">${escapeHtml(a.email)}<small>${ROLE_LABELS[a.role] || a.role}${p ? ` · ${escapeHtml(playerName(p))}` : ''}</small></span>
          <button class="btn btn-sm" type="button" data-access-delete="${a.id}">Annuler</button></div>`;
      }).join('')}</div>`
    : '';
}

function syncAccessForm() {
  document.getElementById('accPlayer').classList.toggle('hidden', document.getElementById('accRole').value !== 'joueur');
}
document.getElementById('accRole').addEventListener('change', syncAccessForm);

document.getElementById('accessForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('accEmail').value.trim().toLowerCase();
  const role = document.getElementById('accRole').value;
  const playerId = Number(document.getElementById('accPlayer').value) || null;
  if (role === 'joueur' && !playerId) return toast('Choisissez la fiche du joueur.', 'error');
  const btn = e.submitter; if (btn) btn.disabled = true;
  try {
    const { error } = await sb.from('club_access').insert({
      club_id: myProfile.club_id, email, role, player_id: role === 'joueur' ? playerId : null, created_by: myProfile.id,
    });
    if (error) throw error;
    e.target.reset(); syncAccessForm();
    toast('Accès enregistré : il s’activera à la première connexion avec cette adresse.', 'success');
    await loadMembers();
  } catch (err) {
    console.error('Accès non enregistré', err);
    toast(err.code === '23505' ? 'Cette adresse ou ce joueur a déjà un accès en attente.'
      : /club_access/.test(err.message || '') ? 'Base à mettre à jour : exécutez supabase/platform_v2.sql.' : err.message, 'error');
  } finally { if (btn) btn.disabled = false; }
});

document.getElementById('pendingList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-access-delete]'); if (!b) return;
  const { error } = await sb.from('club_access').delete().eq('id', Number(b.dataset.accessDelete));
  if (error) return toast(error.message, 'error');
  await loadMembers();
});

/* Fonction d'un membre : Admin / Coach directement ; Joueur une fois la fiche choisie. */
document.getElementById('memberList').addEventListener('change', async (e) => {
  const box = e.target.closest('.member-controls'); if (!box) return;
  const profileId = box.dataset.id;
  const role = box.querySelector('.role-select').value;
  const linkSel = box.querySelector('.player-link-select');
  linkSel.classList.toggle('hidden', role !== 'joueur');
  let rpc;
  if (role === 'joueur') {
    if (!linkSel.value) { toast('Choisissez la fiche du joueur pour appliquer la fonction.', 'info'); return; }
    rpc = sb.rpc('club_link_player', { p_profile_id: profileId, p_player_id: Number(linkSel.value) });
  } else {
    rpc = sb.rpc('club_set_member_role', { p_profile_id: profileId, p_role: role });
  }
  const { error } = await rpc;
  if (error) toast(error.message, 'error'); else toast('Membre mis à jour', 'success');
  await loadMembers();
});

document.getElementById('memberList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-remove]'); if (!b) return;
  const profileId = b.closest('.member-controls').dataset.id;
  const name = b.closest('.member-row').querySelector('.member-name').firstChild.textContent;
  if (!confirm(`Retirer ${name} du club ? Son compte n’aura plus accès aux données du club.`)) return;
  const { error } = await sb.rpc('club_remove_member', { p_profile_id: profileId });
  if (error) return toast(error.message, 'error');
  toast('Membre retiré', 'success');
  await loadMembers();
});

/* ---------- Équipes ---------- */
function renderTeams(isAdmin) {
  const list = document.getElementById('teamList');
  const teams = window.CLUB_TEAMS || [];
  list.innerHTML = teams.length ? teams.map(t => `
    <div class="team-row" data-id="${t.id}">
      <strong>${escapeHtml(t.nom)}</strong>
      ${isAdmin ? `<span class="flex gap-sm">
        <button class="btn btn-sm" type="button" data-action="rename">Renommer</button>
        <button class="btn btn-sm btn-danger" type="button" data-action="delete">Supprimer</button></span>` : ''}
    </div>`).join('')
    : '<p class="text-muted">Aucune équipe pour l\'instant : tout le club est affiché ensemble.</p>';
  if (!isAdmin) return;
  document.getElementById('teamForm').classList.remove('hidden');
}

async function reloadTeams() {
  const { data, error } = await sb.from('teams').select('id, nom, sort_order').order('sort_order').order('nom');
  if (error) throw error;
  window.CLUB_TEAMS = data || [];
  renderTeams(true);
  renderNav(myProfile);
}

document.getElementById('teamForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('teamName');
  const nom = input.value.trim();
  if (!nom) return;
  try {
    const { error } = await sb.from('teams').insert({ club_id: myProfile.club_id, nom });
    if (error) throw error;
    input.value = '';
    await reloadTeams();
    toast('Équipe ajoutée', 'success');
  } catch (err) { toast(err.code === '23505' ? 'Cette équipe existe déjà.' : err.message, 'error'); }
});

document.getElementById('teamList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = Number(btn.closest('.team-row').dataset.id);
  const team = (window.CLUB_TEAMS || []).find(t => t.id === id);
  try {
    if (btn.dataset.action === 'rename') {
      const nom = prompt('Nouveau nom de l\'équipe', team?.nom || '')?.trim();
      if (!nom) return;
      const { error } = await sb.from('teams').update({ nom }).eq('id', id);
      if (error) throw error;
    } else {
      if (!confirm(`Supprimer l'équipe « ${team?.nom} » ? Les joueurs et séances ne sont pas supprimés : ils redeviennent « sans équipe ».`)) return;
      const { error } = await sb.from('teams').delete().eq('id', id);
      if (error) throw error;
    }
    await reloadTeams();
  } catch (err) { toast(err.message, 'error'); }
});
