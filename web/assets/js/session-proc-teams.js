/* ============================================================
   LMFC Performance — session-proc-teams.js (page séance)
   Dans chaque procédé (procedures.equipes / staff / filme,
   lmfc_v9.sql) : ses équipes (couleur, joueurs), son staff (nom →
   rôle) et, si la séance est filmée, s'il l'est. P1 en Rouges /
   Bleus, P2 en Jaunes / Rouges… « Reprendre de… » copie un autre
   procédé. Une alerte signale un procédé filmé sans personne à la
   gestion vidéo.
   Rendu dans la carte du procédé ([data-proc-teams], [data-proc-staff]) :
   seul ce bloc est redessiné, les champs du procédé gardent le focus.
   ============================================================ */

/* Couleurs proposées dans l'ordre pour les nouvelles équipes. */
const TEAM_PRESETS = [
  { nom: 'Rouges', couleur: '#E03131' },
  { nom: 'Bleus', couleur: '#1f6feb' },
  { nom: 'Jaunes', couleur: '#F2B21E' },
  { nom: 'Verts', couleur: '#2FA84F' },
  { nom: 'Blancs', couleur: '#F1F3F5' },
  { nom: 'Oranges', couleur: '#F76707' },
];
const STAFF_ROLE_SUGGESTIONS = ['Animation', 'Consignes', 'Gestion vidéo', 'Source de balle', 'Arbitrage', 'Chrono / GPS', 'Prépa physique'];

let sessionFilmee = false;
const activeTeam = new Map();   // procédé → équipe qui reçoit les joueurs cliqués

const procLabel = (p) => `P${procedures.indexOf(p) + 1}${(p.nom || '').trim() ? ` · ${p.nom.trim()}` : ''}`;
const procFilmed = (p) => sessionFilmee && p.filme !== false;
const procVideoStaff = (p) => (p.staff || []).filter(m => isVideoRole(m.role) && (m.nom || '').trim());
const procByUid = (uid) => procedures.find(p => p._uid === uid) || null;
const teamDots = (p) => (p.equipes || []).map(t => `<span class="team-dot" style="background:${escapeHtml(t.couleur)}"></span>`).join('');

/* Pastilles sur l'en-tête d'un procédé (visibles replié) : couleurs, staff, vidéo. */
function procBadgesHtml(p) {
  const staffN = (p.staff || []).filter(m => (m.nom || '').trim()).length;
  return `${teamDots(p)}${staffN ? `<span class="proc-badge" title="Staff du procédé">${staffN} staff</span>` : ''}${procFilmed(p) ? '<span class="proc-badge is-video" title="Procédé filmé">Filmé</span>' : ''}`;
}

/* Blocs ajoutés sous les champs de la carte d'un procédé. */
function procExtrasHtml(p) {
  return `<div class="proc-extras">
    <div class="proc-sub" data-proc-teams="${p._uid}">${procTeamsInner(p)}</div>
    <div class="proc-sub" data-proc-staff="${p._uid}">${procStaffInner(p)}</div>
  </div>`;
}

function copyFromHtml(kind, p, has) {
  const others = procedures.filter(x => x !== p && has(x));
  if (!CAN_WRITE || !others.length) return '';
  return `<select class="copy-from" data-copy-${kind} aria-label="Reprendre d'un autre procédé">
    <option value="">Reprendre de…</option>
    ${others.map(x => `<option value="${x._uid}">${escapeHtml(procLabel(x))}</option>`).join('')}</select>`;
}

/* ---------- Équipes du procédé ---------- */
function procTeamsInner(p) {
  const dis = CAN_WRITE ? '' : 'disabled';
  const presents = attendance.filter(participe);
  const teams = p.equipes;
  const act = Math.min(activeTeam.get(p._uid) || 0, Math.max(0, teams.length - 1));
  const assigned = new Set(teams.flatMap(t => t.player_ids));
  const pool = presents.filter(a => !assigned.has(a.player_id));
  const chip = (a, action) => `<button type="button" class="pchip" ${CAN_WRITE ? `data-${action}="${a.player_id}"` : 'disabled'}>${escapeHtml(rosterName(a))}${a.numero != null ? `<span class="num">#${a.numero}</span>` : ''}${a.invite ? '<span class="num">invité</span>' : ''}</button>`;
  const blocks = teams.map((t, i) => {
    const members = t.player_ids.map(id => presents.find(a => a.player_id === id)).filter(Boolean);
    return `<div class="team-block ${i === act && CAN_WRITE ? 'active' : ''}" data-team-block="${i}">
      <div class="team-head">
        <input type="color" data-team="${i}" data-tfield="couleur" value="${escapeHtml(t.couleur)}" title="Couleur de la chasuble" aria-label="Couleur" ${dis}>
        <input type="text" data-team="${i}" data-tfield="nom" value="${escapeHtml(t.nom)}" placeholder="Nom de l'équipe" aria-label="Nom de l'équipe" ${dis}>
        <span class="team-count">${members.length} joueur${members.length > 1 ? 's' : ''}</span>
        ${CAN_WRITE ? `<button class="att-remove" type="button" data-remove-team="${i}" aria-label="Supprimer l’équipe ${escapeHtml(t.nom)}" title="Supprimer l’équipe">✕</button>` : ''}
      </div>
      <div class="team-chips">${members.map(a => chip(a, 'unassign')).join('')}</div>
    </div>`;
  }).join('');
  return `<div class="proc-sub-head"><span class="proc-sub-title">Équipes</span>
      <span class="proc-sub-tools">${CAN_WRITE ? '<button class="btn btn-sm" type="button" data-team-add>+ Équipe</button>' : ''}${copyFromHtml('teams', p, x => x.equipes.length)}</span></div>
    ${blocks ? `<div class="team-grid">${blocks}</div>` : '<p class="text-muted proc-sub-empty">Aucune équipe pour ce procédé.</p>'}
    ${teams.length && CAN_WRITE ? (presents.length
      ? `<div class="team-pool"><div class="team-pool-label">Présents non affectés (${pool.length}) — un clic les met dans l’équipe encadrée</div>
         <div class="team-chips">${pool.map(a => chip(a, 'assign')).join('')}</div></div>`
      : '<p class="text-muted proc-sub-empty">Marquez d’abord des joueurs présents.</p>') : ''}`;
}

/* ---------- Staff du procédé ---------- */
function procStaffInner(p) {
  const dis = CAN_WRITE ? '' : 'disabled';
  const rows = (p.staff || []).map((m, i) => `<div class="staff-row${isVideoRole(m.role) ? ' is-video' : ''}">
      <input list="staffNames" data-staff="${i}" data-sfield="nom" value="${escapeHtml(m.nom || '')}" placeholder="Membre du staff" aria-label="Membre du staff" ${dis}>
      <input list="staffRoles" data-staff="${i}" data-sfield="role" value="${escapeHtml(m.role || '')}" placeholder="Rôle (ex. Animation)" aria-label="Rôle" ${dis}>
      ${CAN_WRITE ? `<button class="att-remove" type="button" data-remove-staff="${i}" aria-label="Retirer">✕</button>` : ''}
    </div>`).join('');
  const warn = procFilmed(p) && !procVideoStaff(p).length;
  return `<div class="proc-sub-head"><span class="proc-sub-title">Staff</span>
      <span class="proc-sub-tools">${CAN_WRITE ? '<button class="btn btn-sm" type="button" data-staff-add>+ Membre</button>' : ''}${copyFromHtml('staff', p, x => (x.staff || []).length)}</span></div>
    ${sessionFilmee ? `<label class="check proc-filmed"><input type="checkbox" data-proc-filme ${procFilmed(p) ? 'checked' : ''} ${dis}> Procédé filmé</label>` : ''}
    <p class="video-warn${warn ? '' : ' hidden'}" data-video-warn>Procédé filmé sans responsable « Gestion vidéo ».</p>
    ${rows ? `<div class="staff-rows">${rows}</div>` : '<p class="text-muted proc-sub-empty">Personne pour ce procédé.</p>'}`;
}

/* ---------- Rendu ---------- */
/* Un joueur qui ne participe plus (absent, blessé…) sort des équipes. */
function pruneTeams() {
  const ids = new Set(attendance.filter(participe).map(a => a.player_id));
  procedures.forEach(p => (p.equipes || []).forEach(t => { t.player_ids = t.player_ids.filter(id => ids.has(id)); }));
}
function renderBadges(p) {
  const el = document.querySelector(`[data-proc-badges="${p._uid}"]`);
  if (el) el.innerHTML = procBadgesHtml(p);
}
function renderProcPart(p, part) {
  const el = document.querySelector(`[data-proc-${part}="${p._uid}"]`);
  if (el) el.innerHTML = part === 'teams' ? procTeamsInner(p) : procStaffInner(p);
  renderBadges(p);
}
/* Tout ce qui dépend des présences ou du réglage vidéo. */
function renderProcBlocks() {
  pruneTeams();
  procedures.forEach(p => { renderProcPart(p, 'teams'); renderProcPart(p, 'staff'); });
  renderVideoSummary();
}

/* « Gestion vidéo : Paul (P1, P2) · Thomas (P3) », ou les procédés filmés sans responsable. */
function renderVideoSummary() {
  const el = document.getElementById('videoSummary');
  if (!el) return;
  if (!sessionFilmee) { el.textContent = 'Séance non filmée.'; el.className = 'video-summary'; return; }
  const who = new Map();
  procedures.forEach((p, i) => { if (procFilmed(p)) procVideoStaff(p).forEach(m => who.set(m.nom.trim(), [...(who.get(m.nom.trim()) || []), `P${i + 1}`])); });
  const orphan = procedures.map((p, i) => (procFilmed(p) && !procVideoStaff(p).length ? `P${i + 1}` : null)).filter(Boolean);
  const filmed = procedures.filter(procFilmed).length;
  el.className = `video-summary is-on${orphan.length ? ' has-warn' : ''}`;
  el.textContent = `${filmed} procédé${filmed > 1 ? 's' : ''} filmé${filmed > 1 ? 's' : ''} sur ${procedures.length}`
    + (who.size ? ` — gestion vidéo : ${[...who].map(([n, ps]) => `${n} (${ps.join(', ')})`).join(' · ')}` : '')
    + (orphan.length ? ` — sans responsable vidéo : ${orphan.join(', ')}` : '');
}

/* ---------- Événements (une fois, délégués sur la liste des procédés) ---------- */
function initProcBlocks() {
  const list = document.getElementById('proceduresList');
  const procOf = (e) => procByUid(e.target.closest('.proc')?.dataset.uid);
  list.addEventListener('click', e => {
    const p = procOf(e);
    if (!p || !CAN_WRITE) return;
    const hit = (sel) => e.target.closest(sel);
    if (hit('[data-team-add]')) {
      const preset = TEAM_PRESETS.find(x => !p.equipes.some(t => (t.couleur || '').toLowerCase() === x.couleur.toLowerCase())) || TEAM_PRESETS[p.equipes.length % TEAM_PRESETS.length];
      p.equipes.push({ nom: preset.nom, couleur: preset.couleur, player_ids: [] });
      activeTeam.set(p._uid, p.equipes.length - 1);
    } else if (hit('[data-remove-team]')) {
      p.equipes.splice(Number(hit('[data-remove-team]').dataset.removeTeam), 1);
    } else if (hit('[data-assign]')) {
      const id = Number(hit('[data-assign]').dataset.assign);
      const act = Math.min(activeTeam.get(p._uid) || 0, p.equipes.length - 1);
      p.equipes.forEach(t => { t.player_ids = t.player_ids.filter(x => x !== id); });
      p.equipes[act].player_ids.push(id);
    } else if (hit('[data-unassign]')) {
      const id = Number(hit('[data-unassign]').dataset.unassign);
      p.equipes.forEach(t => { t.player_ids = t.player_ids.filter(x => x !== id); });
    } else if (hit('[data-team-block]') && !hit('input')) {
      activeTeam.set(p._uid, Number(hit('[data-team-block]').dataset.teamBlock));
    } else if (hit('[data-staff-add]')) {
      p.staff.push({ nom: '', role: '' });
      markDirty();
      renderProcPart(p, 'staff');
      return document.querySelector(`[data-proc-staff="${p._uid}"] .staff-row:last-child input`)?.focus();
    } else if (hit('[data-remove-staff]')) {
      p.staff.splice(Number(hit('[data-remove-staff]').dataset.removeStaff), 1);
      markDirty(); renderProcPart(p, 'staff'); return renderVideoSummary();
    } else return;
    markDirty();
    renderProcPart(p, 'teams');
  });
  list.addEventListener('input', e => {
    const p = procOf(e);
    const tf = e.target.closest('[data-tfield]'), sf = e.target.closest('[data-sfield]');
    if (p && tf) {
      const t = p.equipes[Number(tf.dataset.team)];
      if (t) t[tf.dataset.tfield] = tf.value;
      if (tf.dataset.tfield === 'couleur') renderBadges(p);
    } else if (p && sf) {
      const m = p.staff[Number(sf.dataset.staff)];
      if (m) m[sf.dataset.sfield] = sf.value;
    }
  });
  list.addEventListener('change', e => {
    const p = procOf(e);
    if (!p) return;
    const sf = e.target.closest('[data-sfield]');
    if (sf) {   // nom ou rôle validé : alerte, pastilles et résumé, sans redessiner les champs
      sf.closest('.staff-row').classList.toggle('is-video', isVideoRole(p.staff[Number(sf.dataset.staff)]?.role));
      document.querySelector(`[data-proc-staff="${p._uid}"] [data-video-warn]`)?.classList.toggle('hidden', !(procFilmed(p) && !procVideoStaff(p).length));
      renderBadges(p);
      return renderVideoSummary();
    }
    const copy = e.target.closest('[data-copy-teams], [data-copy-staff]');
    const src = copy && procByUid(copy.value);
    if (copy && src) {
      if (copy.matches('[data-copy-teams]')) { p.equipes = JSON.parse(JSON.stringify(src.equipes)); renderProcPart(p, 'teams'); }
      else { p.staff = JSON.parse(JSON.stringify(src.staff)); renderProcPart(p, 'staff'); }
    } else if (e.target.closest('[data-proc-filme]')) {
      p.filme = e.target.checked ? null : false;
      renderProcPart(p, 'staff');
    } else return;
    markDirty();
    renderVideoSummary();
  });

  document.getElementById('f-filmee')?.addEventListener('change', e => {
    sessionFilmee = e.target.checked;
    document.getElementById('filmeeState').textContent = sessionFilmee ? 'Oui' : 'Non';
    markDirty();
    renderProcBlocks();
  });
  document.getElementById('staffRoles').innerHTML = STAFF_ROLE_SUGGESTIONS.map(r => `<option value="${escapeHtml(r)}"></option>`).join('');
}

/* Noms proposés pour le staff : les comptes staff du club. */
async function loadStaffSuggestions() {
  const { data, error } = await sb.from('profiles').select('nom, role').eq('club_id', myProfile.club_id).neq('role', 'joueur').order('nom');
  if (error) return console.warn('Staff du club indisponible pour les suggestions', error);
  document.getElementById('staffNames').innerHTML = (data || []).filter(m => m.nom)
    .map(m => `<option value="${escapeHtml(m.nom)}">${escapeHtml(ROLE_LABELS[m.role] || m.role || '')}</option>`).join('');
}
