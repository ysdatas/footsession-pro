/* ============================================================
   LMFC Performance — players-page.js (Chemin B / Supabase)
   Effectif en lignes compactes : le nom à gauche, taille — poids —
   poste à droite (dernière mesure connue, rien d'inventé). Recherche
   par nom, filtre par poste, ajout d'un joueur. Un clic ouvre la
   fiche joueur (player-performance.html), point d'entrée vers Performance et
   Vidéos. Les présences se consultent sur la fiche.
   Les données sont scopées au club via RLS, et à l'équipe choisie
   dans le menu (nav.js).
   ============================================================ */

let playersCache = [];
let myProfile = null;
let CAN_EDIT_PLAYERS = false;
/* Mode sélection (administrateur) : plusieurs fiches d'un coup, suppression groupée. */
const pickPlayers = { on: false, ids: new Set() };

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
  // performance (is_performance_editor() côté base : admin et préparateur).
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

  // Supprimer des joueurs : administrateur seulement (RLS players_delete).
  if (myProfile.role === 'admin') {
    const btn = document.getElementById('btnSelectPlayers');
    btn.classList.remove('hidden');
    btn.addEventListener('click', () => setPickPlayers(!pickPlayers.on));
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
    // select('*') : team_id et ligne n'existent qu'après leurs migrations ;
    // une liste explicite ferait échouer la page tant qu'elles manquent.
    const { data: players, error } = await byTeam(sb.from('players').select('*').order('nom'));
    if (error) throw error;

    const ids = players.map(p => p.id);
    const [photoResults, mRes] = await Promise.all([
      Promise.all(players.map(p => p.photo_path
        ? sb.storage.from('player-photos').createSignedUrl(p.photo_path, 3600)
        : Promise.resolve({ data: null }))),
      ids.length
        ? sb.from('player_physical_measurements').select('player_id, season_key, month_label, measured_at, height_cm, weight_kg').in('player_id', ids)
        : Promise.resolve({ data: [] }),
    ]);
    if (mRes.error) console.warn('Mesures indisponibles pour la liste des joueurs', mRes.error.message);
    const last = latestMeasures(mRes.data || []);
    playersCache = players.map((p, i) => ({ ...p, photo_url: photoResults[i]?.data?.signedUrl || null, ...last.get(p.id) }));

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
  select.innerHTML = '<option value="">Tous postes</option>'
    + postes.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  select.value = postes.includes(current) ? current : '';
  restoreRemembered(select.parentElement);   // filtre retenu (mémoire de navigation)
}

/* Glisser une carte vers une autre rubrique enregistre la ligne du
   joueur (colonne players.ligne). Sans cette colonne (migration
   player_lines.sql non passée), les cartes ne se déplacent pas. */
const canDragLines = () => CAN_EDIT_PLAYERS && !pickPlayers.on && playersCache.some(p => 'ligne' in p)
  && matchMedia('(pointer: fine)').matches;   // glisser-déposer à la souris ; au doigt, la ligne se change sur la fiche

/* Dernière taille et dernier poids de chaque joueur, sur sa saison la
   plus récente (le mois fait foi, comme sur la fiche Performance). */
function latestMeasures(rows) {
  const out = new Map();
  const byPlayer = new Map();
  rows.forEach(r => byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) || []), r]));
  for (const [pid, list] of byPlayer) {
    const season = latestSeasonOf(list);
    const ordered = list.filter(r => !season || r.season_key === season)
      .sort((a, b) => (MONTHS.indexOf(a.month_label) - MONTHS.indexOf(b.month_label))
        || String(a.measured_at || '').localeCompare(String(b.measured_at || '')));
    const lastOf = (k) => ordered.filter(r => num(r[k]) !== null).at(-1)?.[k] ?? null;
    out.set(pid, { height_cm: lastOf('height_cm'), weight_kg: lastOf('weight_kg') });
  }
  return out;
}
const frNum = (v, d) => Number(v).toFixed(d).replace('.', ',');

function setPickPlayers(on) {
  pickPlayers.on = on; pickPlayers.ids.clear();
  const btn = document.getElementById('btnSelectPlayers');
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.toggle('active', on);
  renderGrid();
}
/* Joueurs affichés (recherche et filtre appliqués) : « Tout sélectionner » porte sur eux. */
function shownPlayers() {
  const q = normalizeName(document.getElementById('searchPlayer').value);
  const poste = document.getElementById('posteFilter').value;
  return playersCache.filter(p => (!q || normalizeName(fullName(p)).includes(q)) && (!poste || (p.poste || '').trim() === poste));
}
function renderPlayersBulk() {
  const box = document.getElementById('playersBulk');
  if (!pickPlayers.on) { box.innerHTML = ''; return; }
  box.innerHTML = bulkBarHtml({ n: pickPlayers.ids.size, total: shownPlayers().length, noun: ['joueur', 'joueurs', false],
    actions: [{ key: 'delete', label: 'Supprimer', danger: true }] });
}
document.getElementById('playersBulk').addEventListener('click', (e) => {
  const act = e.target.closest('[data-bulk]')?.dataset.bulk;
  if (act === 'all') shownPlayers().forEach(p => pickPlayers.ids.add(p.id));
  else if (act === 'none') pickPlayers.ids.clear();
  else if (act === 'done') return setPickPlayers(false);
  else if (act === 'delete') return deletePickedPlayers();
  else return;
  renderGrid();
});
/* Suppression groupée : chaque joueur part dans la corbeille avec toute sa
   fiche (mesures, tests, vidéos, objectifs, parcours, présences). */
async function deletePickedPlayers() {
  const list = playersCache.filter(p => pickPlayers.ids.has(p.id));
  if (!list.length) return;
  if (!(await trashReady())) {
    return toast('Activez d’abord la corbeille (supabase/lmfc_v5.sql) : la suppression d’un joueur doit rester récupérable.', 'error');
  }
  const linked = list.filter(p => p.auth_user_id).length;
  if (!confirm(`Supprimer ${list.length > 1 ? `ces ${list.length} joueurs` : 'ce joueur'} ?\n\n${namesList(list.map(fullName))}\n\n`
    + 'Chaque fiche part avec tout ce qui la concerne : mesures, tests, vidéos et séquences, objectifs et préventions, programme, parcours, présences.'
    + (linked ? `\n${linked > 1 ? `${linked} comptes joueurs n’auront` : 'Un compte joueur n’aura'} plus accès à son espace.` : '')
    + '\n\nRécupérable depuis la Corbeille.')) return;
  try {
    const { data, error } = await sb.from('players').delete().in('id', list.map(p => p.id)).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Suppression réservée à l’administrateur du club.');
    toast(`${data.length} joueur${data.length > 1 ? 's' : ''} dans la corbeille.`, 'success');
    pickPlayers.ids.clear();
    await loadGrid();
  } catch (e) {
    console.error('Suppression des joueurs impossible', e);
    toast(e.message, 'error');
  }
}

function playerRow(p) {
  const i = playersCache.indexOf(p);
  const photo = p.photo_url
    ? `<img class="pr-photo" src="${escapeHtml(p.photo_url)}" alt="" loading="lazy" draggable="false">`
    : `<span class="pr-avatar ${avatarClass(i)}">${escapeHtml(playerInitials(p))}</span>`;
  // L'équipe n'est rappelée que lorsque toutes les équipes sont affichées.
  const team = !currentTeamId() && 'team_id' in p ? teamName(p.team_id) : '';
  const data = [
    num(p.height_cm) !== null ? `<span title="Taille">${frNum(p.height_cm / 100, 2)} m</span>` : '',
    num(p.weight_kg) !== null ? `<span title="Poids">${frNum(p.weight_kg, 1)} kg</span>` : '',
    p.poste ? `<span class="pr-poste" title="Poste">${escapeHtml(p.poste)}</span>` : '',
  ].filter(Boolean).join('');
  if (pickPlayers.on) {
    const on = pickPlayers.ids.has(p.id);
    return `<div class="player-row is-selectable${on ? ' is-picked' : ''}" data-pick="${p.id}" role="checkbox" aria-checked="${on}" tabindex="0">
    ${selCheckHtml(on)}${photo}
    <span class="pr-name"><strong>${escapeHtml(fullName(p))}</strong>${team ? `<small>${escapeHtml(team)}</small>` : ''}</span>
    <span class="pr-data">${data}</span>
  </div>`;
  }
  return `<a class="player-row" href="player-performance.html?id=${p.id}" data-id="${p.id}" draggable="${canDragLines()}">
    ${photo}
    <span class="pr-name"><strong>${escapeHtml(fullName(p))}</strong>${team ? `<small>${escapeHtml(team)}</small>` : ''}</span>
    <span class="pr-data">${data}</span>
    <svg class="pr-go" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
  </a>`;
}

function renderGrid() {
  renderPlayersBulk();
  const wrap = document.getElementById('gridView');
  if (!playersCache.length) {
    wrap.innerHTML = `<div class="empty">Aucun joueur.${CAN_EDIT_PLAYERS ? '<br>Cliquez sur « Ajouter ».' : ''}</div>`;
    return;
  }
  const q = normalizeName(document.getElementById('searchPlayer').value);
  const poste = document.getElementById('posteFilter').value;
  const filtering = !!(q || poste);
  const shown = shownPlayers();
  if (!shown.length) {
    wrap.innerHTML = '<div class="empty">Aucun joueur ne correspond à cette recherche.</div>';
    return;
  }
  const drag = canDragLines();
  const groups = [...PLAYER_LINES, { key: null, label: 'À classer' }];
  wrap.innerHTML = (drag ? '<p class="lines-hint">Glissez un joueur d’une rubrique à l’autre pour changer sa ligne.</p>' : '')
    + groups.map(g => {
      const members = shown.filter(p => lineOf(p) === g.key);
      // Rubriques vides : gardées comme zones de dépôt, sauf pendant une recherche.
      if (!members.length && (g.key === null || filtering || !drag)) return '';
      return `<section class="line-group line-${g.key || 'none'}" ${g.key && drag ? `data-line="${g.key}"` : ''}>
        <h2 class="line-title">${g.label}<span>${members.length}</span></h2>
        <div class="players-list">${members.map(playerRow).join('')
          || '<div class="line-empty">Glissez un joueur ici</div>'}</div>
      </section>`;
    }).join('');
}

/* Mode sélection : un clic (ou Espace / Entrée) coche la ligne. */
const togglePick = (row) => {
  const id = Number(row.dataset.pick);
  if (pickPlayers.ids.has(id)) pickPlayers.ids.delete(id); else pickPlayers.ids.add(id);
  renderGrid();
  document.querySelector(`.player-row[data-pick="${id}"]`)?.focus();
};
document.getElementById('gridView').addEventListener('click', (e) => {
  const row = e.target.closest('.player-row[data-pick]');
  if (row) togglePick(row);
});
document.getElementById('gridView').addEventListener('keydown', (e) => {
  const row = e.target.closest('.player-row[data-pick]');
  if (row && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); togglePick(row); }
});

/* ---------- Glisser-déposer entre rubriques ---------- */
let draggedId = null;
document.getElementById('gridView').addEventListener('dragstart', (e) => {
  const card = e.target.closest('.player-row[draggable="true"]');
  if (!card) return;
  draggedId = Number(card.dataset.id);
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(draggedId));
  card.classList.add('is-dragging');
});
document.getElementById('gridView').addEventListener('dragend', (e) => {
  e.target.closest('.player-row')?.classList.remove('is-dragging');
  document.querySelectorAll('.line-group.is-over').forEach(g => g.classList.remove('is-over'));
  draggedId = null;
});
document.getElementById('gridView').addEventListener('dragover', (e) => {
  const group = e.target.closest('.line-group[data-line]');
  if (!group || draggedId === null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.line-group.is-over').forEach(g => { if (g !== group) g.classList.remove('is-over'); });
  group.classList.add('is-over');
});
document.getElementById('gridView').addEventListener('drop', async (e) => {
  const group = e.target.closest('.line-group[data-line]');
  if (!group || draggedId === null) return;
  e.preventDefault();
  const p = playersCache.find(x => x.id === draggedId);
  const target = group.dataset.line;
  if (!p || lineOf(p) === target) return;
  const previous = p.ligne;
  p.ligne = target;
  renderGrid();
  const { error } = await sb.from('players').update({ ligne: target }).eq('id', p.id);
  if (error) {
    p.ligne = previous;
    renderGrid();
    console.error('Changement de ligne refusé', error);
    toast(/ligne/.test(error.message) ? 'Base à mettre à jour : exécutez supabase/player_lines.sql.' : error.message, 'error');
    return;
  }
  toast(`${fullName(p)} → ${LINE_SINGULAR[target]}`, 'success');
});

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
  for (const id of ['m-prenom', 'm-nom', 'm-poste']) document.getElementById(id).value = '';
  const teams = window.CLUB_TEAMS || [];
  document.getElementById('m-team-field').classList.toggle('hidden', !teams.length);
  document.getElementById('m-team').innerHTML = '<option value="">Sans équipe</option>'
    + teams.map(t => `<option value="${t.id}">${escapeHtml(t.nom)}</option>`).join('');
  document.getElementById('m-team').value = currentTeamId() || '';
  openModal('playerModal');
}

async function savePlayer() {
  const nom = document.getElementById('m-nom').value.trim();
  if (!nom) return toast('Le nom est obligatoire.', 'error');
  const body = {
    club_id: myProfile.club_id,
    nom, prenom: document.getElementById('m-prenom').value.trim() || null,
    poste: document.getElementById('m-poste').value.trim() || null,
  };
  const teamId = document.getElementById('m-team').value;
  if (teamId) body.team_id = Number(teamId);
  try {
    const { data, error } = await sb.from('players').insert(body).select('id').single();
    if (error) throw error;
    closeModal('playerModal');
    toast('Joueur ajouté', 'success');
    window.location.href = `player-performance.html?id=${data.id}`;
  } catch (e) { toast(e.message, 'error'); }
}
