/* ============================================================
   LMFC Performance — session-access.js (page séance)
   Droits d'accès d'une séance (lmfc_v10.sql), réglés par son
   créateur ou l'administrateur :
     - accès de base : staff de l'équipe de la séance (défaut) ou
       tout le staff du club (comme les séances d'avant) ;
     - par personne : Aucun / Lecture / Modification (« Modification »
       seulement pour un compte admin ou coach).
   Seuls les écarts au réglage de base sont enregistrés (session_access).
   ============================================================ */

const ACCESS_LEVELS = [['aucun', 'Aucun'], ['lecture', 'Lecture'], ['modification', 'Modification']];
const access = {
  ready: false,        // table session_access présente (lmfc_v10.sql) et droit de régler
  base: 'equipe',      // sessions.acces
  creator: null,       // sessions.created_by
  staff: [],           // comptes staff du club
  overrides: new Map(),// profile_id → niveau (écarts au réglage de base)
  removed: new Set(),  // réglages à supprimer à l'enregistrement
};

/* Niveau sans réglage nominatif : même règle que session_level() côté base. */
function accessDefault(m) {
  if (m.role === 'admin' || m.id === access.creator) return 'modification';
  if (access.base === 'club') return m.role === 'coach' ? 'modification' : 'lecture';
  return !sessionTeamId || !m.team_id || m.team_id === sessionTeamId ? 'lecture' : 'aucun';
}

/* Charge le bloc si le compte peut régler les droits (créateur ou admin). */
async function initAccess(session) {
  access.base = session?.acces || 'equipe';
  access.creator = session?.created_by || myProfile.id;
  const canManage = CAN_WRITE && (myProfile.role === 'admin' || access.creator === myProfile.id);
  if (!canManage) return;
  const [{ data: staff, error }, rows] = await Promise.all([
    sb.from('profiles').select('id, nom, role, team_id').eq('club_id', myProfile.club_id).neq('role', 'joueur').order('nom'),
    sb.from('session_access').select('profile_id, niveau').eq('session_id', session?.id ?? -1),   // erreur : lmfc_v10.sql non passée
  ]);
  if (error || rows.error) return console.warn('Droits d’accès indisponibles', error || rows.error);
  access.staff = staff || [];
  access.overrides = new Map((rows.data || []).map(r => [r.profile_id, r.niveau]));
  access.ready = true;
  document.getElementById('accessCard').classList.remove('hidden');
  document.getElementById('accessBase').value = access.base;
  renderAccess();
  document.getElementById('accessBase').addEventListener('change', e => { access.base = e.target.value; markDirty(); renderAccess(); });
  document.getElementById('accessList').addEventListener('click', e => {
    const b = e.target.closest('[data-access]');
    if (!b || b.disabled) return;
    const id = b.closest('[data-member]').dataset.member, m = access.staff.find(x => x.id === id);
    if (b.dataset.access === accessDefault(m)) { access.overrides.delete(id); access.removed.add(id); }
    else { access.overrides.set(id, b.dataset.access); access.removed.delete(id); }
    markDirty();
    renderAccess();
  });
}

function renderAccess() {
  if (!access.ready) return;
  const team = teamName(sessionTeamId);
  document.getElementById('accessHint').textContent = access.base === 'club'
    ? 'Tout le staff du club consulte la séance ; administrateur et coachs la modifient.'
    : `Le staff ${team ? `de l’équipe ${team}` : 'du club'} consulte la séance (ainsi que le staff sans équipe fixe). Vous et l’administrateur la modifiez.`;
  document.getElementById('accessList').innerHTML = access.staff.map(m => {
    const fixed = m.role === 'admin' || m.id === access.creator;
    const level = fixed ? 'modification' : (access.overrides.get(m.id) || accessDefault(m));
    const tag = m.id === access.creator ? 'Créateur' : (ROLE_LABELS[m.role] || m.role);
    return `<div class="access-row" data-member="${escapeHtml(m.id)}">
      <span class="access-name">${escapeHtml(m.nom || 'Sans nom')}<span class="access-role">${escapeHtml(tag)}${teamName(m.team_id) ? ` · ${escapeHtml(teamName(m.team_id))}` : ''}</span></span>
      ${fixed ? '<span class="access-fixed">Accès complet</span>' : `<span class="access-seg" role="group" aria-label="Accès de ${escapeHtml(m.nom || '')}">
        ${ACCESS_LEVELS.map(([k, label]) => `<button type="button" data-access="${k}" aria-pressed="${k === level}"
          ${k === 'modification' && !['admin', 'coach'].includes(m.role) ? 'disabled title="Réservé aux comptes admin ou coach"' : ''}>${label}</button>`).join('')}
      </span>`}
    </div>`;
  }).join('');
}

/* Enregistre les écarts au réglage de base (après la séance, qui fournit son id). */
async function saveAccess(sid) {
  if (!access.ready) return;
  // Un écart devenu égal au réglage de base (base changée) n'a plus lieu d'être.
  access.overrides.forEach((niveau, id) => {
    const m = access.staff.find(x => x.id === id);
    if (!m || niveau === accessDefault(m)) { access.overrides.delete(id); access.removed.add(id); }
  });
  if (access.removed.size) {
    const { error } = await sb.from('session_access').delete().eq('session_id', sid).in('profile_id', [...access.removed]);
    if (error) throw error;
    access.removed.clear();
  }
  const rows = [...access.overrides].map(([profile_id, niveau]) => ({ session_id: sid, profile_id, niveau }));
  if (rows.length) {
    const { error } = await sb.from('session_access').upsert(rows, { onConflict: 'session_id,profile_id' });
    if (error) throw error;
  }
}
