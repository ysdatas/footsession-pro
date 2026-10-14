/* ============================================================
   LMFC Performance — club-access.js (Mon club, administrateur)
   « Accès » d'un membre du staff, en plus de ses équipes cochées
   (lmfc_v19.sql, appliqué par la base) :
     - « Lecture sur toutes les équipes » (profiles.lecture_club) ;
     - exceptions par joueur (staff_player_access) : Aucun retire un
       joueur de ses équipes, Lecture ou Modification en ouvre un autre.
   Tout s'enregistre au changement. Un coach ou un préparateur sans
   équipe, sans lecture club ni exception ne voit rien : sa ligne le
   signale (accessSummary).
   Dépend de club-page.js (roster, loadMembers, playerName, fold).
   ============================================================ */

const ACCESS_NIVEAUX = [['aucun', 'Aucun'], ['lecture', 'Lecture'], ['modification', 'Modification']];
let accessExceptions = new Map();   // profile_id → Map(player_id → niveau)
let accessMember = null;            // membre dont le panneau est ouvert

async function loadAccessExceptions() {
  const { data, error } = await sb.from('staff_player_access').select('profile_id, player_id, niveau');
  if (error) { console.warn('Exceptions d’accès indisponibles', error.message); accessExceptions = new Map(); return; }
  accessExceptions = new Map();
  (data || []).forEach(r => {
    if (!accessExceptions.has(r.profile_id)) accessExceptions.set(r.profile_id, new Map());
    accessExceptions.get(r.profile_id).set(r.player_id, r.niveau);
  });
}

/* Ligne d'un membre : ce qu'il a en plus de ses équipes, et s'il ne voit rien. */
function accessSummary(m) {
  const ex = accessExceptions.get(m.id) || new Map();
  const opened = [...ex.values()].filter(n => n !== 'aucun').length;
  const staff = !['admin', 'joueur'].includes(m.role);
  const hasTeams = (window.CLUB_TEAMS || []).length > 0;
  return {
    bits: [m.lecture_club && 'Lecture sur toutes les équipes', ex.size && `${ex.size} exception${ex.size > 1 ? 's' : ''}`].filter(Boolean),
    none: staff && hasTeams && !(m.team_ids || []).length && !m.lecture_club && !opened,
  };
}

function openAccessPanel(m) {
  accessMember = m;
  document.getElementById('amTitle').textContent = `Accès de ${m.nom || 'ce membre'}`;
  const teams = (m.team_ids || []).map(teamName).filter(Boolean);
  document.getElementById('amTeams').textContent = teams.length
    ? `Équipes : ${teams.join(', ')} — leurs joueurs, ${m.role === 'prepa' ? 'données physiques modifiables' : 'en modification'}.`
    : 'Aucune équipe cochée : seuls la lecture club et les exceptions ci-dessous lui donnent accès à des joueurs.';
  document.getElementById('amReadAll').checked = !!m.lecture_club;
  document.getElementById('amSearch').value = '';
  document.getElementById('amResults').innerHTML = '';
  renderAccessList();
  openModal('accessModal');
}

function renderAccessList() {
  const ex = accessExceptions.get(accessMember.id) || new Map();
  const rows = [...ex].map(([pid, niveau]) => ({ p: roster.find(x => x.id === pid), pid, niveau })).filter(r => r.p)
    .sort((a, b) => playerName(a.p).localeCompare(playerName(b.p), 'fr'));
  document.getElementById('amList').innerHTML = rows.length ? rows.map(({ p, pid, niveau }) => `
    <div class="am-row" data-player="${pid}">
      <span>${escapeHtml(playerName(p))}<small>${escapeHtml(teamName(p.team_id) || 'Sans équipe')}</small></span>
      <select aria-label="Niveau pour ${escapeHtml(playerName(p))}">
        ${ACCESS_NIVEAUX.map(([v, l]) => `<option value="${v}"${v === niveau ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
      <button class="btn btn-sm btn-icon" type="button" data-am-remove aria-label="Retirer l’exception">✕</button>
    </div>`).join('') : '<p class="text-muted am-empty">Aucune exception.</p>';
}

async function setException(pid, niveau) {
  const ex = accessExceptions.get(accessMember.id) || new Map();
  const { error } = niveau
    ? await sb.from('staff_player_access').upsert({ profile_id: accessMember.id, player_id: pid, club_id: myProfile.club_id, niveau, updated_at: new Date().toISOString() })
    : await sb.from('staff_player_access').delete().eq('profile_id', accessMember.id).eq('player_id', pid);
  if (error) { console.error('Exception d’accès non enregistrée', error); toast(error.message, 'error'); return; }
  if (niveau) ex.set(pid, niveau); else ex.delete(pid);
  accessExceptions.set(accessMember.id, ex);
  renderAccessList();
  loadMembers();
}

document.getElementById('amReadAll').addEventListener('change', async (e) => {
  const lecture_club = e.target.checked;
  const { data, error } = await sb.from('profiles').update({ lecture_club }).eq('id', accessMember.id).select('lecture_club');
  if (error || !data?.length) {
    console.error('Lecture club non enregistrée', error);
    e.target.checked = !lecture_club;
    return toast(error?.message || 'Modification refusée.', 'error');
  }
  accessMember.lecture_club = lecture_club;
  toast(lecture_club ? 'Lecture sur toutes les équipes accordée.' : 'Lecture sur toutes les équipes retirée.', 'success');
  loadMembers();
});
document.getElementById('amList').addEventListener('change', (e) => {
  const row = e.target.closest('[data-player]');
  if (row && e.target.tagName === 'SELECT') setException(Number(row.dataset.player), e.target.value);
});
document.getElementById('amList').addEventListener('click', (e) => {
  const row = e.target.closest('[data-player]');
  if (row && e.target.closest('[data-am-remove]')) setException(Number(row.dataset.player), null);
});
document.getElementById('amSearch').addEventListener('input', (e) => {
  const qy = fold(e.target.value.trim()), ex = accessExceptions.get(accessMember.id) || new Map();
  const hits = qy ? roster.filter(p => !ex.has(p.id) && fold(`${playerName(p)} ${teamName(p.team_id) || ''}`).includes(qy)).slice(0, 8) : [];
  document.getElementById('amResults').innerHTML = hits.map(p => `
    <button type="button" class="am-hit" data-add="${p.id}">${escapeHtml(playerName(p))}<small>${escapeHtml(teamName(p.team_id) || 'Sans équipe')}</small></button>`).join('');
});
document.getElementById('amResults').addEventListener('click', (e) => {
  const b = e.target.closest('[data-add]');
  if (!b) return;
  document.getElementById('amSearch').value = '';
  document.getElementById('amResults').innerHTML = '';
  // Par défaut, l'exception ouvre le joueur en lecture : le cas le plus courant.
  setException(Number(b.dataset.add), 'lecture');
});
