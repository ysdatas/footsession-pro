/* ============================================================
   LMFC Performance — calendar-edit.js (calendrier.html)
   Ajouter et modifier dans le calendrier (lmfc_v30.sql), staff :
     - Séance (une vraie séance : Séances, éditeur, RPE) ou Événement ;
     - Répéter chaque semaine ou toutes les 2 semaines, jours cochés,
       jusqu'à une date ou un nombre de fois (calRepeat), avec un aperçu ;
       une date où l'équipe a déjà une séance est sautée (calendar_add) ;
     - participants : l'équipe par défaut ; décocher retire un joueur,
       ajouter prend un joueur d'une autre équipe sans changer son équipe
       (séance : présence « invité » / « non concerné » ; événement :
       club_event_players) ;
     - une occurrence de série : cet élément / celui-ci et les suivants /
       toute la série, pour enregistrer comme pour supprimer (la date ne
       change que pour un seul élément) ;
     - après chaque opération, calNotify : le Worker envoie aux joueurs
       les messages que la base a préparés (/api/push/calendar).
   La base décide (RLS, calendar_add) ; la page suit.
   Dépend de calendar-utils.js, calendrier-page.js (CAL, loadCal, calError).
   ============================================================ */

const CE = { mode: 'add', kind: 'seance', item: null, serie: null, players: null, add: new Map(), remove: new Set(), timer: 0 };
const ceEl = (id) => document.getElementById(id);
const ceVal = (id) => ceEl(id).value.trim();
const ceDay = (iso) => calFmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
const ceSeasonEnd = (iso) => `${Number(iso.slice(0, 4)) + (Number(iso.slice(5, 7)) >= 7 ? 1 : 0)}-06-30`;
const ceRadio = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;
const ceTeamPlayers = () => (CE.players || []).filter(p => CE.team && (p.team_id === CE.team || (p.other_team_ids || []).includes(CE.team)));
const ceName = (p) => `${p.prenom || ''} ${p.nom}`.trim();
const cePlural = (n, kind) => `${n} ${kind === 'seance' ? `séance${n > 1 ? 's' : ''}` : `événement${n > 1 ? 's' : ''}`}`;

/* Notifications des joueurs : textes et destinataires préparés par la base pour MES changements. */
async function calNotify() {
  for (let i = 0; i < 8; i++) {
    const r = await siteApi('push/calendar', { method: 'POST' }, 'Notifications').catch((e) => { console.warn('Notifications du calendrier non envoyées', e.message); return null; });
    if (!r?.more) return;
  }
}

function ceSetKind(kind) {
  CE.kind = kind;
  document.querySelectorAll('[data-ce-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ceKind === kind)));
  document.querySelectorAll('.ce-only-seance').forEach(x => x.classList.toggle('hidden', kind !== 'seance'));
  document.querySelectorAll('.ce-only-evenement').forEach(x => x.classList.toggle('hidden', kind !== 'evenement'));
  ceEl('ceKindHint').textContent = kind === 'seance'
    ? 'Une vraie séance : elle apparaît dans Séances, se complète dans l’éditeur et ouvre le RPE des joueurs.'
    : 'Réunion, stage, tournoi… visible des joueurs concernés, avec ses informations.';
  ceTeams();
}

/* « Pour » : les équipes du compte ; « Tout le club » pour un événement de l'admin (ou un club sans équipe). */
function ceTeams() {
  const p = CAL.profile, teams = window.CLUB_TEAMS || [], admin = p.role === 'admin', sel = ceEl('ev-team'), keep = sel.value;
  const mine = admin || !(p.team_ids || []).length ? teams : teams.filter(t => p.team_ids.includes(t.id) || t.id === CE.item?.team_id);
  const club = !teams.length || (admin && CE.kind === 'evenement');
  sel.innerHTML = (club ? '<option value="">Tout le club</option>' : '') + mine.map(t => `<option value="${t.id}">${escapeHtml(t.nom)}</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : String(currentTeamId() || mine[0]?.id || '');
  ceTeamChanged();
}

async function ceTeamChanged() {
  CE.team = Number(ceVal('ev-team')) || null;
  if (CE.mode === 'add') { CE.add.clear(); CE.remove.clear(); }
  const box = ceEl('cePlayers');
  box.classList.toggle('hidden', !CE.team || (CE.mode === 'edit' && CE.kind === 'seance'));
  if (!CE.players) {
    const { data, error } = await sb.from('players').select('id, nom, prenom, team_id, other_team_ids').order('nom');
    if (error) console.warn('Calendrier : joueurs illisibles', error.message);
    CE.players = data || [];
  }
  cePlayersHtml();
  cePreview();
}

function cePlayersHtml() {
  const team = ceTeamPlayers(), ids = new Set(team.map(p => p.id));
  ceEl('ceTeam').innerHTML = team.length ? team.map(p => `<label><input type="checkbox" data-ce-player="${p.id}"${CE.remove.has(p.id) ? '' : ' checked'}> ${escapeHtml(ceName(p))}</label>`).join('')
    : '<p class="ce-hint">Aucun joueur dans cette équipe.</p>';
  ceEl('ceAddList').innerHTML = (CE.players || []).filter(p => !ids.has(p.id) && !CE.add.has(p.id))
    .map(p => `<option value="${escapeHtml(`${ceName(p)} · ${teamName(p.team_id) || 'sans équipe'}`)}"></option>`).join('');
  ceEl('ceAdded').innerHTML = [...CE.add.values()].map(p => `<span class="ce-chip">${escapeHtml(ceName(p))} <small>${escapeHtml(teamName(p.team_id) || '')}</small>
    <button type="button" data-ce-unadd="${p.id}" aria-label="Retirer ${escapeHtml(ceName(p))}">✕</button></span>`).join('');
  const kept = team.length - [...CE.remove].filter(id => ids.has(id)).length;
  ceEl('cePlayersSum').textContent = `Participants : ${kept === team.length ? 'toute l’équipe' : `${kept} sur ${team.length}`} (${kept})`
    + (CE.add.size ? ` + ${CE.add.size} ajouté${CE.add.size > 1 ? 's' : ''}` : '');
}

/* Dates qui seront créées (ajout), d'après le formulaire. */
function ceDates() {
  const start = ceVal('ev-date'), every = Number(ceVal('ev-repeat'));
  if (!start || !every) return { dates: start ? [start] : [], capped: false };
  const days = [...document.querySelectorAll('.ce-days input:checked')].map(x => Number(x.value));
  return calRepeat({ start, every, days, ...(ceRadio('ce-end') === 'count' ? { count: Number(ceVal('ev-count')) || 1 } : { until: ceVal('ev-until') }) });
}

function cePreview() {
  clearTimeout(CE.timer);
  CE.timer = setTimeout(async () => {
    const out = ceEl('cePreview');
    if (CE.mode !== 'add') { out.textContent = ''; return; }
    const { dates, capped } = ceDates();
    if (!dates.length) { out.textContent = 'Choisissez une date (et les jours de la série).'; return; }
    let text = dates.length === 1 ? `${cePlural(1, CE.kind)} · ${ceDay(dates[0])}`
      : `${cePlural(dates.length, CE.kind)}, du ${ceDay(dates[0])} au ${ceDay(dates.at(-1))}${capped ? ` (${CAL_MAX_REPEAT} au plus : la série s’arrête là)` : ''}`;
    if (CE.kind === 'seance' && CE.team) {
      const { data } = await sb.from('sessions').select('date_seance').eq('team_id', CE.team).gte('date_seance', dates[0]).lte('date_seance', dates.at(-1));
      const taken = dates.filter(d => (data || []).some(s => s.date_seance === d));
      if (taken.length) text += ` · ${taken.length} date${taken.length > 1 ? 's' : ''} déjà prise${taken.length > 1 ? 's' : ''} par une séance de l’équipe : ignorée${taken.length > 1 ? 's' : ''} (${taken.slice(0, 3).map(ceDay).join(', ')}${taken.length > 3 ? '…' : ''})`;
    }
    out.textContent = text;
  }, 200);
}

function ceOpen(mode) {
  CE.mode = mode;
  ceEl('ceKind').classList.toggle('hidden', mode !== 'add');
  ceEl('ceKindHint').classList.toggle('hidden', mode !== 'add');
  ceEl('ceRepeatBox').classList.toggle('hidden', mode !== 'add');
  ceEl('ev-delete').classList.toggle('hidden', mode === 'add');
  ceEl('ev-team').disabled = mode === 'edit' && CE.kind === 'seance';   // une séance ne change pas d'équipe ici
  openModal('calEventModal');
}

function openCalAdd() {
  CE.item = null; CE.serie = crypto.randomUUID(); CE.add.clear(); CE.remove.clear();
  const date = CAL.day || calToday();
  for (const [id, v] of [['ev-titre', ''], ['ev-date', date], ['ev-heure', ''], ['ev-lieu', ''], ['ev-notes', ''], ['ev-duree', '90'], ['ev-repeat', '0'], ['ev-until', ceSeasonEnd(date)], ['ev-count', '10']]) ceEl(id).value = v;
  document.querySelectorAll('.ce-days input').forEach(x => { x.checked = Number(x.value) === (calDate(date).getDay() + 6) % 7; });
  ceEl('ceRepeatMore').classList.add('hidden');
  ceEl('ceScope').classList.add('hidden');
  ceEl('ceOpenSession').classList.add('hidden');
  ceEl('calEventTitle').textContent = 'Ajouter au calendrier';
  ceEl('ev-date-label').textContent = 'Date';
  ceSetKind('seance');
  ceOpen('add');
}

/* Un événement, ou une séance d'une série (une séance seule s'ouvre dans l'éditeur). */
async function openCalEdit(i) {
  const r = i.row;
  CE.item = { id: i.id, kind: i.kind, date: i.date, serie_id: r.serie_id || null, team_id: i.team_id };
  CE.add.clear(); CE.remove.clear();
  for (const [id, v] of [['ev-titre', i.titre], ['ev-date', i.date], ['ev-heure', i.heure || ''], ['ev-lieu', r.lieu || ''], ['ev-notes', r.notes || ''], ['ev-duree', r.duree_min ?? 90]]) ceEl(id).value = v;
  ceEl('calEventTitle').textContent = i.kind === 'seance' ? 'Séance de la série' : 'Modifier l’événement';
  ceEl('ceOpenSession').classList.toggle('hidden', i.kind !== 'seance');
  ceEl('ceOpenSession').href = `session-edit.html?id=${i.id}`;
  ceEl('ceScopeOne').textContent = i.kind === 'seance' ? 'Cette séance' : 'Cet événement';
  document.querySelector('input[name="ce-scope"][value="one"]').checked = true;
  ceEl('ev-date').disabled = false;
  ceSetKind(i.kind);
  ceEl('ev-team').value = i.team_id ?? '';
  ceOpen('edit');
  const table = i.kind === 'seance' ? 'sessions' : 'club_events';
  const [n, x] = await Promise.all([
    r.serie_id ? sb.from(table).select('id', { count: 'exact', head: true }).eq('serie_id', r.serie_id) : { count: 1 },
    i.kind === 'evenement' ? sb.from('club_event_players').select('player_id, inclus').eq('event_id', i.id) : { data: [] },
  ]);
  ceEl('ceScope').classList.toggle('hidden', !(n.count > 1));
  (x.data || []).forEach(e => (e.inclus ? CE.add.set(e.player_id, (CE.players || []).find(p => p.id === e.player_id) || { id: e.player_id, nom: `Joueur ${e.player_id}` }) : CE.remove.add(e.player_id)));
  await ceTeamChanged();
}

function ceForm() {
  const f = { titre: ceVal('ev-titre'), date: ceVal('ev-date'), heure: ceVal('ev-heure') || null, team_id: Number(ceVal('ev-team')) || null,
    lieu: ceVal('ev-lieu') || null, notes: CE.kind === 'evenement' ? ceVal('ev-notes') || null : undefined,
    duree_min: CE.kind === 'seance' ? Number(ceVal('ev-duree')) || 90 : undefined };
  if (!f.titre || !f.date) { toast('Titre et date sont obligatoires.', 'error'); return null; }
  return f;
}
const cePlayersArg = () => ({ add: [...CE.add.keys()], remove: [...CE.remove] });

async function ceSave() {
  const f = ceForm(), btn = ceEl('ev-save');
  if (!f) return;
  btn.disabled = true;
  try {
    if (CE.mode === 'add') {
      const { dates } = ceDates();
      if (!dates.length) throw new Error('Aucune date : cochez au moins un jour.');
      const rows = dates.map(date => ({ ...f, date, serie_id: CE.serie }));
      const { data, error } = await sb.rpc('calendar_add', { p_kind: CE.kind, p_rows: rows, p_players: cePlayersArg() });
      if (error) throw error;
      const made = data.created.length, skip = data.skipped.length;
      toast(`${cePlural(made, CE.kind)} ajouté${CE.kind === 'seance' ? 'e' : ''}${made > 1 ? 's' : ''}${skip ? ` · ${skip} date${skip > 1 ? 's' : ''} ignorée${skip > 1 ? 's' : ''} (déjà une séance)` : ''}`, made ? 'success' : '');
      CAL.day = data.created[0]?.date || f.date;
    } else {
      const scope = ceRadio('ce-scope') || 'one', it = CE.item, seance = it.kind === 'seance';
      const table = seance ? 'sessions' : 'club_events', dcol = seance ? 'date_seance' : 'date_event';
      const patch = seance ? { titre: f.titre, heure: f.heure, lieu: f.lieu, duree_min: f.duree_min }
        : { titre: f.titre, heure: f.heure, lieu: f.lieu, notes: f.notes, team_id: f.team_id };
      let q = sb.from(table).update(scope === 'one' ? { ...patch, [dcol]: f.date } : patch);
      q = scope === 'one' ? q.eq('id', it.id) : q.eq('serie_id', it.serie_id);
      if (scope === 'next') q = q.gte(dcol, it.date);
      const { data, error } = await q.select('id');
      if (error) throw error;
      if (!data.length) throw new Error('Modification refusée : droits insuffisants.');
      if (!seance) {
        const { error: e2 } = await sb.rpc('club_event_set_players', { p_events: data.map(x => x.id), p_players: f.team_id ? cePlayersArg() : {} });
        if (e2) throw e2;
      }
      toast(`${data.length} élément${data.length > 1 ? 's' : ''} modifié${data.length > 1 ? 's' : ''}`, 'success');
      CAL.day = scope === 'one' ? f.date : CAL.day;
    }
    closeModal('calEventModal');
    loadCal();
    calNotify();
  } catch (e) {
    console.error('Calendrier : enregistrement refusé', e);
    toast(calError(e), 'error');
  } finally { btn.disabled = false; }
}

async function ceDelete() {
  const it = CE.item, scope = ceEl('ceScope').classList.contains('hidden') ? 'one' : ceRadio('ce-scope') || 'one', seance = it.kind === 'seance';
  const what = { one: seance ? 'cette séance' : 'cet événement', next: 'cet élément et les suivants de la série', all: 'toute la série' }[scope];
  if (!confirm(`Supprimer ${what} ?\n\n${seance ? 'Les séances vont dans la corbeille.' : 'C’est définitif.'} Les joueurs concernés sont prévenus.`)) return;
  const table = seance ? 'sessions' : 'club_events', dcol = seance ? 'date_seance' : 'date_event';
  let q = sb.from(table).delete();
  q = scope === 'one' ? q.eq('id', it.id) : q.eq('serie_id', it.serie_id);
  if (scope === 'next') q = q.gte(dcol, it.date);
  const { data, error } = await q.select('id');
  if (error || !data?.length) return toast(error ? calError(error) : 'Suppression refusée : droits insuffisants.', 'error');
  closeModal('calEventModal');
  toast(`${data.length} élément${data.length > 1 ? 's' : ''} supprimé${data.length > 1 ? 's' : ''}`, 'success');
  loadCal();
  calNotify();
}

function bindCalEdit() {
  ceEl('ev-save').addEventListener('click', ceSave);
  ceEl('ev-delete').addEventListener('click', ceDelete);
  ceEl('ceKind').addEventListener('click', (e) => { const b = e.target.closest('[data-ce-kind]'); if (b && b.dataset.ceKind !== CE.kind) ceSetKind(b.dataset.ceKind); });
  ceEl('ev-team').addEventListener('change', ceTeamChanged);
  ceEl('ev-repeat').addEventListener('change', () => { ceEl('ceRepeatMore').classList.toggle('hidden', ceVal('ev-repeat') === '0'); cePreview(); });
  ceEl('ceScope').addEventListener('change', () => { ceEl('ev-date').disabled = ceRadio('ce-scope') !== 'one'; });
  ceEl('calEventModal').addEventListener('input', (e) => { if (e.target.closest('#ev-date, #ev-until, #ev-count, .ce-days, .ce-end')) cePreview(); });
  ceEl('ceTeam').addEventListener('change', (e) => {
    const id = Number(e.target.dataset.cePlayer);
    if (id) { if (e.target.checked) CE.remove.delete(id); else CE.remove.add(id); cePlayersHtml(); }
  });
  ceEl('ceAddInput').addEventListener('change', (e) => {
    const p = (CE.players || []).find(x => `${ceName(x)} · ${teamName(x.team_id) || 'sans équipe'}` === e.target.value);
    if (p) { CE.add.set(p.id, p); e.target.value = ''; cePlayersHtml(); }
  });
  ceEl('ceAdded').addEventListener('click', (e) => { const b = e.target.closest('[data-ce-unadd]'); if (b) { CE.add.delete(Number(b.dataset.ceUnadd)); cePlayersHtml(); } });
}
