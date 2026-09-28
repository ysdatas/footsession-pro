/* ============================================================
   FootSession Pro — preventions-page.js
   Préventions / développement — salle de musculation.
   Lecture : tout le staff du club (équipe choisie dans le menu).
   Écriture : admin, coach, préparateur (can_manage_plans() en base).
   Les éléments « visibles par le joueur » apparaissent dans sa
   fiche Performance.
   ============================================================ */

let progProfile = null;
let progPlayers = [];
let programs = [];
let CAN_MANAGE = false;

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  progProfile = ctx.profile;
  document.getElementById('uName').textContent = progProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[progProfile.role] || progProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (progProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  CAN_MANAGE = canManagePlans(progProfile.role);
  const form = document.getElementById('programForm');
  const categoryOptions = Object.entries(PROGRAM_CATEGORIES).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('');
  form.category.innerHTML = categoryOptions;
  form.status.innerHTML = Object.entries(PROGRAM_STATUS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('');
  document.getElementById('fCategory').insertAdjacentHTML('beforeend', categoryOptions);

  if (CAN_MANAGE) {
    const btn = document.getElementById('btnAddProgram');
    btn.classList.remove('hidden');
    btn.addEventListener('click', () => openProgram());
    document.getElementById('btnSaveProgram').addEventListener('click', saveProgram);
    document.getElementById('btnDeleteProgram').addEventListener('click', deleteProgram);
  }
  for (const id of ['fPlayer', 'fCategory', 'fStatus']) document.getElementById(id).addEventListener('change', renderPrograms);

  await loadAll();
  const requested = new URLSearchParams(location.search).get('player');
  if (requested && progPlayers.some(p => p.id === Number(requested))) {
    document.getElementById('fPlayer').value = requested;
    renderPrograms();
  }
})();

const progName = (p) => `${p?.prenom || ''} ${p?.nom || ''}`.trim();

async function loadAll() {
  try {
    const teamId = currentTeamId();
    let q = sb.from('players').select('id, nom, prenom').order('nom');
    if (teamId) q = q.eq('team_id', teamId);
    const { data: players, error: e1 } = await q;
    if (e1) throw e1;
    progPlayers = players || [];
    const ids = progPlayers.map(p => p.id);
    const { data, error: e2 } = ids.length
      ? await sb.from('player_programs').select('*').in('player_id', ids).order('updated_at', { ascending: false })
      : { data: [], error: null };
    if (e2) throw e2;
    programs = data || [];

    const opts = progPlayers.map(p => `<option value="${p.id}">${escapeHtml(progName(p))}</option>`).join('');
    const fPlayer = document.getElementById('fPlayer');
    const keep = fPlayer.value;
    fPlayer.innerHTML = '<option value="">Tous les joueurs</option>' + opts;
    fPlayer.value = keep;
    document.getElementById('programForm').player_id.innerHTML = opts;
    renderPrograms();
  } catch (e) {
    console.error('Préventions : chargement impossible', e);
    document.getElementById('programList').innerHTML = /player_programs/.test(e.message || '')
      ? '<div class="empty">La rubrique n’est pas encore activée : exécutez supabase/roles_teams_preventions.sql dans Supabase.</div>'
      : `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

function renderPrograms() {
  const player = document.getElementById('fPlayer').value;
  const category = document.getElementById('fCategory').value;
  const status = document.getElementById('fStatus').value;
  const shown = programs.filter(p =>
    (!player || p.player_id === Number(player))
    && (!category || p.category === category)
    && (status === '' || (status === 'active' ? p.status !== 'termine' : p.status === status)));

  const list = document.getElementById('programList');
  if (!shown.length) {
    list.innerHTML = `<div class="empty">Aucun élément.${CAN_MANAGE ? '<br>Cliquez sur « Ajouter » pour en créer un.' : ''}</div>`;
    return;
  }
  const byPlayer = new Map();
  shown.forEach(p => byPlayer.set(p.player_id, [...(byPlayer.get(p.player_id) || []), p]));
  list.innerHTML = progPlayers.filter(pl => byPlayer.has(pl.id)).map(pl => `
    <section class="prog-group">
      <h3><a href="player.html?id=${pl.id}">${escapeHtml(progName(pl))}</a></h3>
      <div class="prog-cards">${byPlayer.get(pl.id).map(programCard).join('')}</div>
    </section>`).join('');
}

function programCard(p) {
  const dates = [p.start_date && `du ${fmtDate(p.start_date)}`, p.end_date && `au ${fmtDate(p.end_date)}`].filter(Boolean).join(' ');
  return `<article class="card prog-card">
    <div class="prog-card-head">
      <strong>${escapeHtml(p.title)}</strong>
      ${CAN_MANAGE ? `<button class="btn btn-sm btn-ghost" type="button" onclick="openProgram(${p.id})">Modifier</button>` : ''}
    </div>
    <div class="prog-meta">
      <span class="prog-chip">${escapeHtml(PROGRAM_CATEGORIES[p.category] || p.category)}</span>
      <span class="prog-status-${p.status}">${escapeHtml(PROGRAM_STATUS[p.status] || p.status)}</span>
      ${p.dosage ? `<span>${escapeHtml(p.dosage)}</span>` : ''}
      ${dates ? `<span>${escapeHtml(dates)}</span>` : ''}
      ${p.visible_to_player ? '' : '<span>Staff uniquement</span>'}
    </div>
    ${p.body ? `<p class="prog-body">${escapeHtml(p.body)}</p>` : ''}
    ${p.progress_note ? `<p class="prog-progress">${escapeHtml(p.progress_note)}</p>` : ''}
  </article>`;
}

window.openProgram = (id = null) => {
  if (!progPlayers.length) return toast('Aucun joueur dans cette équipe.', 'error');
  const form = document.getElementById('programForm');
  const p = programs.find(x => x.id === id) || null;
  form.reset();
  form.program_id.value = p?.id || '';
  form.player_id.value = p?.player_id || document.getElementById('fPlayer').value || progPlayers[0].id;
  form.category.value = p?.category || 'prevention';
  form.status.value = p?.status || 'en_cours';
  for (const k of ['title', 'body', 'dosage', 'start_date', 'end_date', 'progress_note']) form[k].value = p?.[k] || '';
  form.visible_to_player.checked = p ? p.visible_to_player : true;
  document.getElementById('programModalTitle').textContent = p ? 'Modifier' : 'Nouvel élément';
  document.getElementById('btnDeleteProgram').classList.toggle('hidden', !p);
  openModal('programModal');
};

async function saveProgram() {
  const form = document.getElementById('programForm');
  if (!form.reportValidity()) return;
  const body = {
    club_id: progProfile.club_id,
    player_id: Number(form.player_id.value),
    category: form.category.value,
    status: form.status.value,
    visible_to_player: form.visible_to_player.checked,
  };
  for (const k of ['title', 'body', 'dosage', 'start_date', 'end_date', 'progress_note']) body[k] = form[k].value.trim() || null;
  const id = Number(form.program_id.value) || null;
  if (!id) body.created_by = progProfile.id;
  const btn = document.getElementById('btnSaveProgram');
  btn.disabled = true;
  try {
    const { error } = id
      ? await sb.from('player_programs').update(body).eq('id', id)
      : await sb.from('player_programs').insert(body);
    if (error) throw error;
    closeModal('programModal');
    toast('Enregistré', 'success');
    await loadAll();
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

async function deleteProgram() {
  const id = Number(document.getElementById('programForm').program_id.value);
  if (!id || !confirm('Supprimer cet élément ?')) return;
  try {
    const { error } = await sb.from('player_programs').delete().eq('id', id);
    if (error) throw error;
    closeModal('programModal');
    await loadAll();
  } catch (e) { toast(e.message, 'error'); }
}
