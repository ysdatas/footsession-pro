/* ============================================================
   FootSession Pro — players-page.js (Chemin B / Supabase)
   Effectif : recherche par nom, filtre par poste, ajout d'un joueur.
   Un clic ouvre la fiche joueur (player.html), point d'entrée vers
   Performance, Vidéos et Préventions. Les présences se consultent
   sur la fiche ; la suppression d'un joueur n'est plus proposée ici.
   Les données sont scopées au club via RLS, et à l'équipe choisie
   dans le menu (nav.js).
   ============================================================ */

let playersCache = [];
let myProfile = null;
let CAN_EDIT_PLAYERS = false;

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  myProfile = ctx.profile;

  document.getElementById('uName').textContent = myProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[myProfile.role] || myProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (myProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  const team = currentTeam();
  document.querySelector('.page-head h1').textContent = team ? `Joueurs — ${team.nom}` : 'Joueurs du club';

  CAN_EDIT_PLAYERS = canEdit(myProfile.role);
  if (CAN_EDIT_PLAYERS) {
    document.getElementById('btnAddPlayer').classList.remove('hidden');
    document.getElementById('btnAddPlayer').addEventListener('click', openPlayerModal);
    document.getElementById('m-save').addEventListener('click', savePlayer);
  }

  // Import du classeur du préparateur : réservé aux rôles qui écrivent la
  // performance (is_performance_editor() côté base : admin et prépa).
  if (canEditPerformanceData(myProfile.role)) {
    const btn = document.getElementById('btnImportExcel');
    btn.classList.remove('hidden');
    btn.addEventListener('click', () => ExcelImport.open({
      clubId: myProfile.club_id,
      seasonStartMonth: clubSeasonStartMonth(myProfile.clubs),
      userId: myProfile.id,
      onDone: loadGrid,
    }));
  }

  document.getElementById('searchPlayer').addEventListener('input', renderGrid);
  document.getElementById('posteFilter').addEventListener('change', renderGrid);

  await loadGrid();
})();

function avatarClass(i) { return 'av' + (i % 6); }
/* Initiales : sans nom de famille, (p.nom || '')[0] vaut undefined et
   la concaténation affichait « Aundefined ». */
function playerInitials(p) {
  return (((p?.prenom || p?.nom || '')[0] || '') + ((p?.nom || '')[0] || '') || '?').toUpperCase();
}
const fullName = (p) => `${p.prenom || ''} ${p.nom}`.trim();

/* ---------- Grille ---------- */
async function loadGrid() {
  try {
    // team_id n'existe qu'après la migration des équipes : sans équipe
    // choisie, on n'en a pas besoin et la page marche sans elle.
    const withTeams = (window.CLUB_TEAMS || []).length > 0;
    const query = byTeam(sb.from('players')
      .select(`id, nom, prenom, numero, poste, photo_path${withTeams ? ', team_id' : ''}`).order('nom'));
    const { data: players, error } = await query;
    if (error) throw error;

    const photoResults = await Promise.all(players.map(p =>
      p.photo_path
        ? sb.storage.from('player-photos').createSignedUrl(p.photo_path, 3600)
        : Promise.resolve({ data: null })
    ));
    playersCache = players.map((p, i) => ({ ...p, photo_url: photoResults[i]?.data?.signedUrl || null }));

    fillPosteFilter();
    renderUnassigned();
    renderGrid();
    document.getElementById('playersSub').textContent =
      `${playersCache.length} joueur${playersCache.length > 1 ? 's' : ''}`;
  } catch (e) { toast(e.message, 'error'); }
}

function fillPosteFilter() {
  const select = document.getElementById('posteFilter');
  const current = select.value;
  const postes = [...new Set(playersCache.map(p => (p.poste || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'fr'));
  select.innerHTML = '<option value="">Tous les postes</option>'
    + postes.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  select.value = postes.includes(current) ? current : '';
}

function renderGrid() {
  const wrap = document.getElementById('gridView');
  if (!playersCache.length) {
    wrap.innerHTML = `<div class="empty">Aucun joueur.${CAN_EDIT_PLAYERS ? '<br>Cliquez sur « Ajouter ».' : ''}</div>`;
    return;
  }
  const q = normalizeName(document.getElementById('searchPlayer').value);
  const poste = document.getElementById('posteFilter').value;
  const shown = playersCache.filter(p =>
    (!q || normalizeName(fullName(p)).includes(q)) && (!poste || (p.poste || '').trim() === poste));
  if (!shown.length) {
    wrap.innerHTML = '<div class="empty">Aucun joueur ne correspond à cette recherche.</div>';
    return;
  }
  wrap.innerHTML = `<div class="players-grid">` + shown.map(p => {
    const i = playersCache.indexOf(p);
    const photo = p.photo_url
      ? `<img class="pc-photo" src="${escapeHtml(p.photo_url)}" alt="" loading="lazy">`
      : `<div class="pc-avatar ${avatarClass(i)}">${escapeHtml(playerInitials(p))}</div>`;
    return `<a class="player-card" href="player.html?id=${p.id}">
      <div class="pc-top">
        ${photo}
        <div>
          <div class="pc-name">${escapeHtml(fullName(p))}</div>
          ${p.poste ? `<div class="pc-poste">${escapeHtml(p.poste)}</div>` : ''}
          ${'team_id' in p ? `<div class="pc-team">${escapeHtml(teamName(p.team_id) || 'Sans équipe')}</div>` : ''}
        </div>
        ${p.numero != null ? `<span class="pc-num">#${p.numero}</span>` : ''}
      </div>
    </a>`;
  }).join('') + `</div>`;
}

/* ---------- Joueurs sans équipe ---------- */
/* Une équipe est choisie et des fiches n'en ont pas encore : on propose
   de les y rattacher en un clic plutôt que fiche par fiche. */
function renderUnassigned() {
  const box = document.getElementById('unassignedBar');
  const team = currentTeam();
  const orphans = playersCache.filter(p => 'team_id' in p && p.team_id == null);
  if (!team || !orphans.length || !CAN_EDIT_PLAYERS) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = `<span>${orphans.length} joueur${orphans.length > 1 ? 's' : ''} sans équipe.</span>
    <button class="btn btn-sm btn-primary" type="button" id="btnAssignTeam">Rattacher à ${escapeHtml(team.nom)}</button>`;
  document.getElementById('btnAssignTeam').addEventListener('click', async (e) => {
    if (!confirm(`Rattacher ${orphans.length} joueur${orphans.length > 1 ? 's' : ''} à l'équipe ${team.nom} ?`)) return;
    e.target.disabled = true;
    try {
      const { error } = await sb.from('players').update({ team_id: team.id }).in('id', orphans.map(p => p.id));
      if (error) throw error;
      toast('Joueurs rattachés', 'success');
      await loadGrid();
    } catch (err) { e.target.disabled = false; toast(err.message, 'error'); }
  });
}

/* ---------- Ajout ---------- */
function openPlayerModal() {
  document.getElementById('playerModalTitle').textContent = 'Nouveau joueur';
  document.getElementById('m-id').value = '';
  for (const id of ['m-prenom', 'm-nom', 'm-numero', 'm-poste']) document.getElementById(id).value = '';
  const teams = window.CLUB_TEAMS || [];
  document.getElementById('m-team-field').classList.toggle('hidden', !teams.length);
  document.getElementById('m-team').innerHTML = '<option value="">Sans équipe</option>'
    + teams.map(t => `<option value="${t.id}">${escapeHtml(t.nom)}</option>`).join('');
  document.getElementById('m-team').value = currentTeamId() || '';
  openModal('playerModal');
}

async function savePlayer() {
  const nom = document.getElementById('m-nom').value.trim();
  const numeroRaw = document.getElementById('m-numero').value;
  if (!nom) return toast('Le nom est obligatoire.', 'error');
  const body = {
    club_id: myProfile.club_id,
    nom, prenom: document.getElementById('m-prenom').value.trim() || null,
    numero: numeroRaw !== '' ? Number(numeroRaw) : null,
    poste: document.getElementById('m-poste').value.trim() || null,
  };
  const teamId = document.getElementById('m-team').value;
  if (teamId) body.team_id = Number(teamId);
  try {
    const { data, error } = await sb.from('players').insert(body).select('id').single();
    if (error) throw error;
    closeModal('playerModal');
    toast('Joueur ajouté', 'success');
    window.location.href = `player.html?id=${data.id}`;
  } catch (e) { toast(e.message, 'error'); }
}
