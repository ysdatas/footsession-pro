/* ============================================================
   LMFC Performance — library-access.js
   Qui voit un procédé de la bibliothèque (fiche, pour qui en a la
   gestion : son créateur, l'administrateur) : rôles, équipes, niveau,
   et personnes précises (dont « aucun accès »). La base refuse ce qui
   dépasse les droits de l'auteur (guard_library_item, lmfc_v24.sql) :
   hors admin, on n'ouvre qu'à ses propres équipes, jamais à tout le
   club. La page ne propose déjà que cela.
   ============================================================ */

const LIB_LEVELS = { aucun: 'Aucun accès', lecture: 'Consultation', modification: 'Modification' };
const LIB_ROLES = { coach: 'coachs', prepa: 'préparateurs' };

function libAccessSummary(it, teams) {
  if (!it.acces_roles.length) return 'Privé : vous, l’administrateur et les personnes ci-dessous.';
  const who = it.acces_roles.map(r => LIB_ROLES[r]).join(' et ');
  const where = it.acces_teams.length ? `de ${it.acces_teams.map(id => teams.find(t => t.id === id)?.nom || 'équipe supprimée').join(', ')}` : 'de tout le club';
  return `${capFirst(who)} ${where}, ${it.acces_niveau === 'modification' ? 'les coachs peuvent aussi modifier' : 'en consultation'}.`;
}

async function renderLibAccess(box, it, onSaved) {
  const me = window.CURRENT_PROFILE, admin = me.role === 'admin';
  const teams = window.CLUB_TEAMS || [], mine = new Set(me.team_ids || []);
  const [{ data: rows, error }, staff] = await Promise.all([
    sb.from('library_access').select('id, profile_id, niveau').eq('item_id', it.id), libStaff(),
  ]);
  if (error) { box.innerHTML = `<p class="text-danger">${escapeHtml(libError(error))}</p>`; return; }
  const clubWide = it.acces_roles.length > 0 && it.acces_teams.length === 0;
  const canClub = admin || !teams.length || clubWide;
  const listed = new Set((rows || []).map(r => r.profile_id));
  const addable = [...staff.values()].filter(s => s.id !== it.created_by && s.role !== 'admin' && !listed.has(s.id));
  const lvlOptions = (role, cur) => Object.entries(LIB_LEVELS)
    .filter(([k]) => k !== 'modification' || role === 'coach')
    .map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${l}</option>`).join('');
  box.innerHTML = `
    <p class="lib-access-sum">${escapeHtml(libAccessSummary(it, teams))}</p>
    <fieldset class="lib-fs"><legend>Rôles qui le voient</legend>
      ${Object.entries({ coach: 'Coachs', prepa: 'Préparateurs physiques' }).map(([r, l]) =>
        `<label class="lib-check"><input type="checkbox" data-la-role="${r}"${it.acces_roles.includes(r) ? ' checked' : ''}> ${l}</label>`).join('')}
    </fieldset>
    ${teams.length ? `<fieldset class="lib-fs"><legend>Équipes</legend>
      <label class="lib-check"><input type="radio" name="la-scope" value="club"${clubWide ? ' checked' : ''}${canClub ? '' : ' disabled'}> Tout le club</label>
      <label class="lib-check"><input type="radio" name="la-scope" value="teams"${clubWide ? '' : ' checked'}> Ces équipes :</label>
      ${teams.map(t => { const on = it.acces_teams.includes(t.id); return `<label class="lib-check lib-check-sub"><input type="checkbox" data-la-team="${t.id}"${on ? ' checked' : ''}${admin || mine.has(t.id) || on ? '' : ' disabled'}> ${escapeHtml(t.nom)}</label>`; }).join('')}
      ${admin ? '' : '<p class="field-hint">Vous ne pouvez ouvrir cette vidéo qu’à vos propres équipes ; l’administrateur peut l’ouvrir au-delà.</p>'}
    </fieldset>` : ''}
    <div class="field"><label for="la-niveau">Ce que ces personnes peuvent faire</label>
      <select id="la-niveau"><option value="lecture">Consulter</option>
        <option value="modification"${it.acces_niveau === 'modification' ? ' selected' : ''}>Consulter ; les coachs modifient aussi (titre, tags, vidéo)</option></select></div>
    <button class="btn btn-sm" type="button" data-la-save>Enregistrer l’accès</button>
    <h4 class="lib-sub">Personnes précises</h4>
    <ul class="lib-people">${(rows || []).map(r => { const s = staff.get(r.profile_id); return `<li>
      <span>${escapeHtml(s?.nom || 'Membre retiré')} <span class="text-muted">${escapeHtml(ROLE_LABELS[s?.role] || '')}</span></span>
      <label class="sr-only" for="la-l-${r.id}">Accès de ${escapeHtml(s?.nom || '')}</label>
      <select id="la-l-${r.id}" data-la-lvl="${r.id}">${lvlOptions(s?.role, r.niveau)}</select>
      <button class="btn btn-sm btn-danger" type="button" data-la-del="${r.id}" aria-label="Retirer ${escapeHtml(s?.nom || '')}">Retirer</button></li>`; }).join('')
      || '<li class="text-muted">Aucune.</li>'}</ul>
    ${addable.length ? `<div class="lib-people-add">
      <label class="sr-only" for="la-who">Personne</label>
      <select id="la-who">${addable.map(s => `<option value="${s.id}" data-role="${s.role}">${escapeHtml(s.nom)} · ${escapeHtml(ROLE_LABELS[s.role] || s.role)}</option>`).join('')}</select>
      <label class="sr-only" for="la-wlvl">Accès</label>
      <select id="la-wlvl">${lvlOptions('coach', 'lecture')}</select>
      <button class="btn btn-sm" type="button" data-la-add>Ajouter</button></div>` : ''}`;

  const write = async (promise, ok) => {
    const { error: err } = await promise;
    if (err) return toast(libError(err), 'error');
    toast(ok, 'success');
    onSaved();
  };
  box.onclick = (e) => {
    if (e.target.closest('[data-la-save]')) {
      const roles = [...box.querySelectorAll('[data-la-role]:checked')].map(i => i.dataset.laRole);
      const scope = box.querySelector('[name="la-scope"]:checked')?.value || 'club';
      const ids = scope === 'club' ? [] : [...box.querySelectorAll('[data-la-team]:checked')].map(i => Number(i.dataset.laTeam));
      if (roles.length && scope === 'teams' && !ids.length) return toast('Cochez au moins une équipe, ou aucun rôle (vidéo privée).', 'error');
      return write(sb.from('library_items').update({ acces_roles: roles, acces_teams: ids, acces_niveau: box.querySelector('#la-niveau').value }).eq('id', it.id), 'Accès enregistré.');
    }
    const del = e.target.closest('[data-la-del]');
    if (del) return write(sb.from('library_access').delete().eq('id', Number(del.dataset.laDel)), 'Accès retiré.');
    if (e.target.closest('[data-la-add]')) {
      const who = box.querySelector('#la-who'), role = who.selectedOptions[0]?.dataset.role;
      let niveau = box.querySelector('#la-wlvl').value;
      if (niveau === 'modification' && role !== 'coach') niveau = 'lecture';   // un préparateur consulte seulement
      return write(sb.from('library_access').insert({ item_id: it.id, profile_id: who.value, niveau }), 'Accès ajouté.');
    }
  };
  box.onchange = (e) => {
    const lvl = e.target.closest('[data-la-lvl]');
    if (lvl) write(sb.from('library_access').update({ niveau: lvl.value }).eq('id', Number(lvl.dataset.laLvl)), 'Accès modifié.');
    // « Tout le club » : les cases d'équipes ne comptent plus.
    if (e.target.name === 'la-scope' || e.target.dataset.laTeam) {
      const club = box.querySelector('[name="la-scope"]:checked')?.value === 'club';
      if (e.target.dataset.laTeam && e.target.checked) box.querySelector('[name="la-scope"][value="teams"]').checked = true;
      else if (club) box.querySelectorAll('[data-la-team]').forEach(i => { i.checked = false; });
    }
  };
}
