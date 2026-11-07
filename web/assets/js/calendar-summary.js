/* ============================================================
   LMFC Performance — calendar-summary.js
   Résumé compact d'une séance ou d'un match depuis le calendrier.
   Champs + participants sont enregistrés par une RPC transactionnelle
   (lmfc_v43.sql) ; les RLS des séances, matchs, attendance et feuilles
   restent appliquées.
   ============================================================ */

const CS_STATUS = [
  ['', '—'], ['present', 'Présent'], ['absent', 'Absent'], ['reprise', 'Reprise'],
  ['retard', 'En retard'], ['excuse', 'Excusé'], ['blesse', 'Blessé'], ['malade', 'Malade'],
  ['selection', 'Sélection'], ['groupe_pro', 'Groupe pro'], ['autre', 'Autre'],
];
const CS_MATCH_STATUS = [['', 'À renseigner'], ['titulaire', 'Titulaire'], ['remplacant', 'Remplaçant'], ['non_entre', 'Non entré']];
const CS = { item: null, editable: false, players: [], entries: new Map(), fields: {}, loading: false };
const csEl = (id) => document.getElementById(id);
const csName = (p) => `${p?.prenom || ''} ${p?.nom || ''}`.trim() || 'Joueur';
const csInTeam = (p, teamId) => !!teamId && (p.team_id === teamId || (p.other_team_ids || []).includes(teamId));
const csStatusOptions = (list, value) => list.map(([v, label]) =>
  `<option value="${v}"${v === (value || '') ? ' selected' : ''}>${label}</option>`).join('');

function csCanEditMatch(item) {
  const p = CAL.profile;
  if (!canEditTeamContent(p.role)) return false;
  if (p.role === 'admin') return true;
  const assigned = (p.team_ids?.length ? p.team_ids : [p.team_id]).filter(Boolean).map(Number);
  // v42 autorise l'analyste seulement dans ses équipes. Un match sans équipe
  // reste modifiable par son créateur coach, comme la politique SQL.
  if (p.role === 'analyste') return !!item.team_id && assigned.includes(Number(item.team_id));
  if (!item.team_id) return item.row?.created_by === p.id || !(window.CLUB_TEAMS || []).length;
  return assigned.includes(Number(item.team_id)) || !(window.CLUB_TEAMS || []).length;
}

async function openCalSummary(item) {
  CS.item = item;
  CS.editable = false;
  CS.entries = new Map();
  const source = item.row || {};
  CS.fields = item.kind === 'seance'
    ? { titre: source.titre || item.titre, date: source.date_seance || item.date, heure: (source.heure || item.heure || '').slice(0, 5), lieu: source.lieu || '', duree_min: source.duree_min ?? 90 }
    : { adversaire: source.adversaire || item.titre, date: source.date_match || item.date, heure: (source.heure || item.heure || '').slice(0, 5),
      lieu: source.lieu || '', stade: source.stade || '', competition: source.competition || '', score_pour: source.score_pour ?? '', score_contre: source.score_contre ?? '' };
  CS.loading = true;
  csEl('calSummaryTitle').textContent = calTitleOf(item);
  csEl('calSummaryBody').innerHTML = '<p class="text-muted">Chargement du récapitulatif…</p>';
  csEl('calSummarySave').classList.add('hidden');
  csEl('calSummaryDelete').classList.add('hidden');
  csEl('calSummaryFull').href = item.kind === 'seance' ? `session-edit?id=${item.id}` : `matchs?id=${item.id}`;
  openModal('calSummaryModal');

  try {
    const canTeamEdit = canEditTeamContent(CAL.profile.role);
    const access = item.kind === 'seance' && canTeamEdit
      ? await sb.rpc('session_access_level', { p_session: item.id }) : null;
    const table = item.kind === 'seance' ? 'attendance' : 'match_players';
    const [playersRes, rosterRes] = await Promise.all([
      sb.from('players').select('id, nom, prenom, team_id, other_team_ids, numero, poste').order('nom'),
      sb.from(table).select(item.kind === 'seance' ? 'player_id, statut, statut_libre, invite, present' : 'player_id, statut').eq(item.kind === 'seance' ? 'session_id' : 'match_id', item.id),
    ]);
    if (playersRes.error) throw playersRes.error;
    if (rosterRes.error) throw rosterRes.error;
    CS.players = playersRes.data || [];
    const current = new Map((rosterRes.data || []).map(r => [Number(r.player_id), r]));
    const member = CS.players.filter(p => csInTeam(p, item.team_id));
    const candidates = new Map([...member, ...CS.players.filter(p => current.has(Number(p.id)))].map(p => [Number(p.id), p]));
    CS.entries = new Map([...candidates].map(([id, player]) => {
      const r = current.get(id);
      const isMember = csInTeam(player, item.team_id);
      const included = item.kind === 'seance'
        ? (r ? r.statut !== 'non_concerne' : isMember)
        : !!r;
      return [id, { player, included, statut: r?.statut || (item.kind === 'seance' && isMember ? 'absent' : ''),
        statut_libre: r?.statut_libre || '', invite: !!r?.invite || !isMember, present: !!r?.present }];
    }));
    CS.editable = item.kind === 'seance'
      ? !!(canTeamEdit && !access?.error && access?.data === 'modification')
      : csCanEditMatch(item);
    csRender();
    if (CS.editable) {
      csEl('calSummarySave').classList.remove('hidden');
      csEl('calSummaryDelete').classList.remove('hidden');
    }
  } catch (e) {
    console.error('Calendrier : récapitulatif illisible', e);
    csEl('calSummaryBody').innerHTML = `<p class="text-danger">${escapeHtml(e.message || 'Récapitulatif indisponible.')}</p>`;
  } finally { CS.loading = false; }
}

function csFieldsHtml(i) {
  const r = i.row || {}, dis = CS.editable ? '' : 'disabled';
  const value = (key, fallback = '') => CS.fields[key] ?? fallback;
  const field = (key, label, type = 'text', attrs = '', initial = r[key] ?? '') => `<label class="cs-field"><span>${label}</span><input data-cs-field="${key}" type="${type}" value="${escapeHtml(value(key, initial))}" ${attrs} ${dis}></label>`;
  const matchLocation = `<label class="cs-field"><span>Lieu</span><select data-cs-field="lieu" ${dis}>
    ${[['', 'Non renseigné'], ['domicile', 'Domicile'], ['exterieur', 'Extérieur'], ['neutre', 'Terrain neutre']]
      .map(([v, l]) => `<option value="${v}"${v === value('lieu', r.lieu || '') ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
  if (i.kind === 'seance') return `<div class="cs-fields">
    ${field('titre', 'Séance', 'text', 'maxlength="120" required')}
    ${field('date', 'Date', 'date', 'required', r.date_seance || i.date)}
    ${field('heure', 'Heure', 'time', '', (r.heure || i.heure || '').slice(0, 5))}
    ${field('duree_min', 'Durée (min)', 'number', 'min="1" max="600" step="0.01"', r.duree_min ?? 90)}
    ${field('lieu', 'Lieu', 'text', 'maxlength="120"')}
    <p class="cs-read">${escapeHtml(teamName(i.team_id) || 'Sans équipe')}</p></div>`;
  return `<div class="cs-fields">
    ${field('adversaire', 'Adversaire', 'text', 'maxlength="120" required')}
    ${field('date', 'Date', 'date', 'required', r.date_match || i.date)}
    ${field('heure', 'Heure', 'time', '', (r.heure || i.heure || '').slice(0, 5))}
    ${matchLocation}
    ${field('stade', 'Stade', 'text', 'maxlength="120"')}
    ${field('competition', 'Compétition', 'text', 'maxlength="160"')}
    ${field('score_pour', 'Buts LMFC', 'number', 'min="0" max="99"')}
    ${field('score_contre', 'Buts adverses', 'number', 'min="0" max="99"')}
    <p class="cs-read">${escapeHtml(teamName(i.team_id) || 'Sans équipe')}</p></div>`;
}

function csPlayerRowsHtml() {
  return [...CS.entries.values()].sort((a, b) => csName(a.player).localeCompare(csName(b.player), 'fr')).map(entry => {
    const p = entry.player, id = Number(p.id), dis = CS.editable ? '' : 'disabled';
    const status = CS.item.kind === 'seance' ? CS_STATUS : CS_MATCH_STATUS;
    const stateLabel = CS.item.kind === 'seance' ? 'Présence' : 'Statut';
    return `<div class="cs-player-row" data-cs-player="${id}">
      <label class="cs-include"><input type="checkbox" data-cs-include="${id}"${entry.included ? ' checked' : ''} ${dis}><span>${escapeHtml(csName(p))}</span>
        <small>${escapeHtml(teamName(p.team_id) || 'Sans équipe')}${p.numero != null ? `${SEP}#${p.numero}` : ''}</small></label>
      ${entry.included ? `<select data-cs-status="${id}" aria-label="${stateLabel} de ${escapeHtml(csName(p))}" ${dis}>${csStatusOptions(status, entry.statut)}</select>` : '<span class="cs-excluded">Non concerné</span>'}
      ${CS.item.kind === 'seance' && entry.included && entry.statut === 'autre' ? `<label class="cs-free"><span>Motif</span><input data-cs-free="${id}" maxlength="40" value="${escapeHtml(entry.statut_libre)}" ${dis}></label>
        <label class="cs-participates"><input type="checkbox" data-cs-present="${id}"${entry.present ? ' checked' : ''} ${dis}> Participe</label>` : ''}
    </div>`;
  }).join('') || '<p class="text-muted">Aucun joueur visible pour cette équipe.</p>';
}

function csRender() {
  const item = CS.item, team = teamName(item.team_id);
  csEl('calSummaryBody').innerHTML = `${!CS.editable ? '<p class="cs-readonly">Consultation seule pour cet élément.</p>' : ''}
    <div class="cs-section"><h3>Informations</h3>${csFieldsHtml(item)}</div>
    <div class="cs-section"><div class="cs-player-heading"><h3>Joueurs concernés</h3><span id="csCount"></span></div>
      <p class="text-muted">${team ? `Effectif ${escapeHtml(team)}${SEP}ajoutez un joueur d’une autre équipe si besoin.` : 'Participants associés à cet élément.'}</p>
      ${CS.editable ? `<label class="cs-add"><span>Ajouter un joueur</span><input id="csAddPlayer" list="csPlayerOptions" autocomplete="off" placeholder="Rechercher un joueur du club…"><datalist id="csPlayerOptions"></datalist></label>` : ''}
      <div class="cs-player-list" id="csPlayerList">${csPlayerRowsHtml()}</div>
    </div>
    <p class="cs-status" id="csStatus" role="status" aria-live="polite"></p>`;
  const allActive = [...CS.entries.values()].filter(x => x.included).length;
  const count = csEl('csCount');
  if (count) count.textContent = `${allActive} joueur${allActive === 1 ? '' : 's'}`;
  if (CS.editable) {
    csEl('csAddPlayer').addEventListener('input', csDatalist);
    csEl('csAddPlayer').addEventListener('change', csAddPlayer);
  }
}

function csDatalist(e) {
  const q = e.target.value.trim().toLocaleLowerCase('fr');
  const existing = new Set(CS.entries.keys());
  const list = CS.players.filter(p => !existing.has(Number(p.id)) && q && csName(p).toLocaleLowerCase('fr').includes(q)).slice(0, 12);
  csEl('csPlayerOptions').innerHTML = list.map(p => `<option value="${escapeHtml(`${csName(p)} – ${teamName(p.team_id) || 'Sans équipe'}`)}"></option>`).join('');
}

function csAddPlayer(e) {
  const value = e.target.value;
  const p = CS.players.find(x => `${csName(x)} – ${teamName(x.team_id) || 'Sans équipe'}` === value);
  if (!p) return;
  const id = Number(p.id), inTeam = csInTeam(p, CS.item.team_id);
  CS.entries.set(id, { player: p, included: true, statut: CS.item.kind === 'seance' ? 'present' : '',
    statut_libre: '', invite: !inTeam, present: true });
  e.target.value = '';
  csRender();
  csEl('csAddPlayer')?.focus();
}

function csPlayerChange(e) {
  const row = e.target.closest('[data-cs-player]'), id = Number(row?.dataset.csPlayer), entry = CS.entries.get(id);
  if (!entry) return;
  if (e.target.matches('[data-cs-include]')) {
    entry.included = e.target.checked;
    if (entry.included && (!entry.statut || entry.statut === 'non_concerne')) entry.statut = CS.item.kind === 'seance' ? 'absent' : '';
    csRender();
    csEl('csPlayerList')?.querySelector(`[data-cs-include="${id}"]`)?.focus();
  } else if (e.target.matches('[data-cs-status]')) {
    entry.statut = e.target.value;
    if (entry.statut !== 'autre') entry.present = ['present', 'reprise', 'retard'].includes(entry.statut);
    if (entry.statut === 'autre') {
      csRender();
      csEl('csPlayerList')?.querySelector(`[data-cs-free="${id}"]`)?.focus();
    }
  } else if (e.target.matches('[data-cs-free]')) entry.statut_libre = e.target.value;
  else if (e.target.matches('[data-cs-present]')) entry.present = e.target.checked;
}

function csFields() {
  const read = (key) => csEl('calSummaryBody').querySelector(`[data-cs-field="${key}"]`)?.value ?? '';
  const i = CS.item;
  const keys = i.kind === 'seance' ? ['titre', 'date', 'heure', 'lieu', 'duree_min']
    : ['adversaire', 'date', 'heure', 'lieu', 'stade', 'competition', 'score_pour', 'score_contre'];
  keys.forEach(k => { CS.fields[k] = read(k); });
  return { ...CS.fields };
}

function csPlayersPayload() {
  csEl('csPlayerList')?.querySelectorAll('[data-cs-player]').forEach(row => {
    const id = Number(row.dataset.csPlayer), entry = CS.entries.get(id);
    if (!entry) return;
    entry.included = !!row.querySelector(`[data-cs-include="${id}"]`)?.checked;
    if (entry.included) {
      entry.statut = row.querySelector(`[data-cs-status="${id}"]`)?.value || '';
      entry.statut_libre = row.querySelector(`[data-cs-free="${id}"]`)?.value || '';
      entry.present = row.querySelector(`[data-cs-present="${id}"]`)?.checked ?? ['present', 'reprise', 'retard'].includes(entry.statut);
    }
  });
  return [...CS.entries.values()].map(x => ({ player_id: Number(x.player.id), inclus: !!x.included,
    statut: x.statut || null, statut_libre: x.statut === 'autre' ? x.statut_libre : null,
    invite: !!x.invite, present: !!x.present }));
}

async function csSave() {
  if (!CS.item || !CS.editable) return;
  const fields = csFields();
  if (!fields.date || !(CS.item.kind === 'seance' ? fields.titre : fields.adversaire)) return toast('Le titre, l’adversaire et la date sont obligatoires.', 'error');
  const btn = csEl('calSummarySave');
  btn.disabled = true;
  try {
    const { data, error } = await sb.rpc('calendar_summary_update', {
      p_kind: CS.item.kind, p_event: CS.item.id, p_fields: fields, p_players: csPlayersPayload(),
    });
    if (error) throw error;
    if (!data?.updated) throw new Error('Aucune modification confirmée par la base.');
    closeModal('calSummaryModal');
    toast('Récapitulatif et participants enregistrés.', 'success');
    CAL.day = fields.date;
    await loadCal();
    calNotify();
  } catch (e) {
    console.error('Calendrier : résumé non enregistré', e);
    const status = csEl('csStatus');
    if (status) status.textContent = `Non enregistré : ${e.message || 'droits insuffisants.'}`;
    toast(e.message || 'Enregistrement refusé.', 'error');
  } finally { btn.disabled = false; }
}

async function csDelete() {
  if (!CS.item || !CS.editable) return;
  const item = CS.item, label = item.kind === 'seance' ? 'cette séance' : 'ce match';
  if (!await confirmDialog(`Supprimer ${label} ?\n\nLes joueurs concernés ne le verront plus dans leur calendrier.`)) return;
  const table = item.kind === 'seance' ? 'sessions' : 'matches';
  const { data, error } = await sb.from(table).delete().eq('id', item.id).select('id');
  if (error || !data?.length) return toast(error?.message || 'Suppression refusée : droits insuffisants.', 'error');
  closeModal('calSummaryModal');
  toast('Élément supprimé.', 'success');
  await loadCal();
  calNotify();
}

csEl('calSummarySave').addEventListener('click', csSave);
csEl('calSummaryDelete').addEventListener('click', csDelete);
csEl('calSummaryBody').addEventListener('change', csPlayerChange);
csEl('calSummaryBody').addEventListener('input', (e) => {
  if (e.target.matches('[data-cs-field]')) CS.fields[e.target.dataset.csField] = e.target.value;
});
