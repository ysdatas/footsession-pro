/* ============================================================
   LMFC Performance — calendrier-page.js (calendrier)
   Calendrier commun du staff et des joueurs (lmfc_v28.sql) :
     - séances et matchs lus là où ils vivent : rien n'est recopié, une
       date changée dans sa rubrique se voit ici aussitôt ; plus les
       événements du club (club_events) ;
     - vues Mois, Semaine, À venir ; filtre par type (mémorisé sur
       l'appareil) ; l'équipe est celle du sélecteur du menu (staff) ;
     - staff : un clic sur séance ou match ouvre son résumé (calendar-summary.js) ; joueur :
       une fiche résumée (my_calendar : jamais les notes du staff) et,
       pour une séance, son RPE (rpe.js, lmfc_v29.sql) ;
     - ajouter une séance ou un événement, seul ou en série, et modifier
       une série : calendar-edit.js (lmfc_v30.sql) ; la base décide (RLS),
       la page suit ; les joueurs concernés sont prévenus (calNotify).
   Dépend de calendar-utils.js, calendar-edit.js, nav.js, auth.js, player-nav.js (joueur).
   ============================================================ */

const CAL_KINDS = { seance: 'Séance', match: 'Match', evenement: 'Événement' };
const CAL_LIEUX = { domicile: 'Domicile', exterieur: 'Extérieur', neutre: 'Terrain neutre' };
const CAL_MEMO = 'lmfc-calendar';
const CAL = { view: 'month', anchor: calToday(), day: calToday(), kinds: new Set(Object.keys(CAL_KINDS)),
  items: [], seq: 0, profile: null, asPlayer: false };
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

/* Vue et types affichés : un confort de cet appareil, jamais nécessaire. */
function calMemo(save) {
  try {
    if (save) return localStorage.setItem(CAL_MEMO, JSON.stringify({ view: CAL.view, kinds: [...CAL.kinds] }));
    const m = JSON.parse(localStorage.getItem(CAL_MEMO) || '{}');
    if (['month', 'week', 'list', 'day'].includes(m.view)) CAL.view = m.view;
    if (Array.isArray(m.kinds)) CAL.kinds = new Set(m.kinds.filter(k => CAL_KINDS[k]));
  } catch { /* stockage indisponible : réglages par défaut */ }
}

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  CAL.profile = ctx.profile;
  CAL.asPlayer = ctx.profile.role === 'joueur';
  if (CAL.asPlayer) {
    const { data: player, error } = await sb.from('players').select('id, prenom, nom').eq('auth_user_id', ctx.user.id).maybeSingle();
    if (error) console.error('Calendrier : fiche du joueur illisible', error);
    setPlayerShellUser(player);
  } else {
    fillUserBlock(ctx.profile.nom || 'Utilisateur', ROLE_LABELS[ctx.profile.role] || ctx.profile.role);
    document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });
  }
  document.getElementById('calAdd').classList.toggle('hidden', !canEditTeamContent(ctx.profile.role));
  calMemo();
  // Joueur : toujours sur « Jour » à l'ouverture (la semaine en bandeau et ses cartes « Répondre »,
  // calendar-player.js), même si une autre vue a été choisie la dernière fois sur cet appareil.
  if (CAL.asPlayer) CAL.view = 'day';
  if (!CAL.asPlayer && CAL.view === 'day') CAL.view = 'month';
  document.querySelector('[data-cal-view="day"]').classList.toggle('hidden', !CAL.asPlayer);
  document.querySelector('.cal-kinds').classList.toggle('hidden', CAL.asPlayer);   // joueur : séances et matchs, toujours
  if (CAL.asPlayer) CAL.kinds = new Set(Object.keys(CAL_KINDS));   // un ancien filtre mémorisé ne cache rien
  if (CAL.view === 'list') CAL.anchor = calToday();
  bindCal();
  loadCal();
  if (canEditTeamContent(ctx.profile.role)) calNotify();   // changements encore en attente (éditeur de séance, envoi interrompu)
})();

function calError(e) {
  if (['42703', '42P01', 'PGRST202', 'PGRST205'].includes(e?.code)) return 'Le calendrier n’est pas à jour : passez les migrations jusqu’à lmfc_v30.sql dans Supabase.';
  if (e?.code === '42501') return 'Vous ne pouvez pas enregistrer d’événement pour cette équipe.';
  return e?.message || String(e);
}

/* Éléments de la période : le joueur par my_calendar, le staff par les tables (RLS). */
async function fetchItems(from, to) {
  const score = (r) => (r.score_pour != null && r.score_contre != null ? `${r.score_pour} – ${r.score_contre}` : null);
  if (CAL.asPlayer) {
    // À remplir (player-todo.js), lu une fois : chaque séance ou match porte ses questionnaires,
    // et sa carte son bouton « Répondre » (calendar-player.js).
    CAL.todoP ||= ptLoad().catch(e => { console.error('Calendrier : questionnaires à remplir illisibles', e); return { items: [], rpe: [] }; });
    const [{ data, error }, todo] = await Promise.all([sb.rpc('my_calendar', { p_from: from, p_to: to }), CAL.todoP]);
    if (error) throw error;
    const forEv = (kind, id) => todo.items.filter(t => t.kind === kind && Number(t.id) === Number(id));
    return (data || []).map(r => ({ kind: r.kind, id: r.id, date: r.date_cal, heure: hhmm(r.heure), titre: r.titre,
      team_id: r.team_id, lieu: r.lieu, stade: r.stade, score: score(r), notes: r.notes, todo: forEv(r.kind, r.id) }));
  }
  const [s, m, e] = await Promise.all([
    bySessionTeam(sb.from('sessions').select('id, titre, date_seance, heure, team_id, other_team_ids, serie_id, lieu, duree_min, created_by'))
      .gte('date_seance', from).lte('date_seance', to).is('fusionnee_dans', null),   // fusionnée : lmfc_v52.sql
    byTeam(sb.from('matches').select('id, adversaire, date_match, heure, team_id, lieu, stade, competition, score_pour, score_contre, created_by'))
      .gte('date_match', from).lte('date_match', to),
    byTeam(sb.from('club_events').select('*')).gte('date_event', from).lte('date_event', to),
  ]);
  const failed = [s, m, e].find(r => r.error);
  if (failed) throw failed.error;
  return [
    ...s.data.map(x => ({ kind: 'seance', id: x.id, date: x.date_seance, heure: hhmm(x.heure), titre: x.titre, team_id: x.team_id, lieu: x.lieu, row: x })),
    ...m.data.map(x => ({ kind: 'match', id: x.id, date: x.date_match, heure: hhmm(x.heure), titre: x.adversaire, team_id: x.team_id,
      lieu: x.lieu, stade: x.stade, sub: x.competition, score: score(x), row: x })),
    ...e.data.map(x => ({ kind: 'evenement', id: x.id, date: x.date_event, heure: hhmm(x.heure), titre: x.titre, team_id: x.team_id,
      lieu: x.lieu, notes: x.notes, row: x })),
  ];
}

async function loadCal() {
  const { from, to } = calRange(CAL.view, CAL.anchor);
  const seq = ++CAL.seq, status = document.getElementById('calStatus');
  CAL.items = [];
  CAL.loading = true;
  status.textContent = 'Chargement…';
  renderCal();   // la grille vide prend sa place tout de suite : rien ne bouge à l'arrivée des données
  try {
    const items = await fetchItems(from, to);
    if (seq !== CAL.seq) return;
    CAL.items = items.sort((a, b) => a.date.localeCompare(b.date) || (a.heure || '').localeCompare(b.heure || ''));
    CAL.failed = false;
  } catch (e) {
    if (seq !== CAL.seq) return;
    console.error('Calendrier illisible', e);
    CAL.failed = true;
    status.innerHTML = `<span class="text-danger">${escapeHtml(calError(e))}</span>`;
  }
  CAL.loading = false;
  renderCal();
}

/* ---------- Affichage ---------- */
const calShown = () => CAL.items.filter(i => CAL.kinds.has(i.kind));
const calByDay = (items) => items.reduce((m, i) => m.set(i.date, [...(m.get(i.date) || []), i]), new Map());
const calTitleOf = (i) => (i.kind === 'match' ? `Match – ${i.titre}` : i.titre);
function calSub(i) {
  const team = !CAL.asPlayer && !currentTeamId() ? (i.kind === 'seance' && i.row ? sessionTeamsLabel(i.row) : teamName(i.team_id)) : '';
  return [i.kind === 'match' ? CAL_LIEUX[i.lieu] : i.lieu, i.stade, i.sub, team].filter(Boolean).join(' – ');
}
function calItemHtml(i) {
  const sub = calSub(i);
  return `<button type="button" class="cal-item k-${i.kind}" data-cal-open="${CAL.items.indexOf(i)}">
    <span class="cal-time">${i.heure || ''}</span>
    <span class="cal-what"><span class="cal-kind">${CAL_KINDS[i.kind]}</span><strong>${escapeHtml(calTitleOf(i))}</strong>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span>
    ${i.score ? `<span class="cal-score">${escapeHtml(i.score)}</span>` : ''}${i.todo?.length ? '<span class="cal-rpe-todo">À remplir</span>' : ''}
  </button>`;
}

function calMonthHtml(items) {
  const { from } = calRange('month', CAL.anchor), month = CAL.anchor.slice(0, 7), today = calToday(), days = calByDay(items);
  const cells = Array.from({ length: 42 }, (_, k) => {
    const d = calAddDays(from, k), list = days.get(d) || [];
    const cls = ['cal-cell', d.slice(0, 7) !== month && 'is-out', d === today && 'is-today', d === CAL.day && 'is-sel'].filter(Boolean).join(' ');
    const label = `${calDayLabel(d)}${list.length ? `, ${list.length} élément${list.length > 1 ? 's' : ''}` : ''}`;
    return `<div class="${cls}" data-cal-cell="${d}">
      <button type="button" class="cal-num" data-cal-day="${d}" aria-label="${label}" aria-pressed="${d === CAL.day}"${d === today ? ' aria-current="date"' : ''}>${Number(d.slice(8))}</button>
      ${list.slice(0, 3).map(i => `<button type="button" class="cal-chip k-${i.kind}" data-cal-open="${CAL.items.indexOf(i)}">${i.todo?.length ? '<i class="cal-chip-todo"><span class="sr-only">À remplir : </span></i>' : ''}${i.heure ? `<b>${i.heure}</b> ` : ''}${escapeHtml(calTitleOf(i))}</button>`).join('')}
      ${list.length > 3 ? `<span class="cal-more">+${list.length - 3}</span>` : ''}
    </div>`;
  }).join('');
  const dayList = CAL.day && days.get(CAL.day);
  return `<div class="cal-month">
      <div class="cal-dows" aria-hidden="true">${CAL_DOW.map(d => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
    </div>
    ${CAL.day ? `<section class="cal-daypanel"><h2 class="cal-day-h">${calCap(calDayLabel(CAL.day))}</h2>
      ${dayList ? dayList.map(calItemHtml).join('') : '<p class="cal-empty">Rien de prévu ce jour-là.</p>'}</section>` : ''}`;
}
function calWeekHtml(items) {
  const { from } = calRange('week', CAL.anchor), days = calByDay(items), today = calToday();
  return `<div class="cal-week">${Array.from({ length: 7 }, (_, k) => {
    const d = calAddDays(from, k), list = days.get(d) || [];
    return `<section class="cal-wday${d === today ? ' is-today' : ''}${list.length ? '' : ' is-empty'}">
      <h2 class="cal-day-h">${calCap(calFmt(d, { weekday: 'short', day: 'numeric', month: 'short' }))}</h2>
      ${list.length ? list.map(calItemHtml).join('') : '<p class="cal-empty">—</p>'}</section>`;
  }).join('')}</div>`;
}
function calListHtml(items) {
  const days = calByDay(items);
  if (!days.size) return CAL.loading ? '' : '<div class="empty">Rien de prévu sur ces 60 jours.</div>';
  return [...days].map(([d, list]) => `<section class="cal-lday"><h2 class="cal-day-h">${calCap(calDayLabel(d))}</h2>${list.map(calItemHtml).join('')}</section>`).join('');
}

function renderCal() {
  document.getElementById('calTitle').textContent = calTitle(CAL.view, CAL.anchor);
  document.querySelectorAll('[data-cal-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.calView === CAL.view)));
  document.querySelectorAll('[data-cal-kind]').forEach(b => b.setAttribute('aria-pressed', String(CAL.kinds.has(b.dataset.calKind))));
  const items = calShown(), body = document.getElementById('calBody');
  if (!CAL.loading && !CAL.failed) {
    document.getElementById('calStatus').textContent = `${items.length} élément${items.length > 1 ? 's' : ''}`
      + `${!CAL.asPlayer && currentTeam() ? ` – ${currentTeam().nom} et tout le club` : ''}`;
  }
  body.className = `cal-body is-${CAL.view}`;
  body.innerHTML = CAL.view === 'month' ? calMonthHtml(items) : CAL.view === 'week' ? calWeekHtml(items)
    : CAL.view === 'day' ? calDayHtml(items) : calListHtml(items);
}

/* ---------- Ouvrir un élément ---------- */
function openCalItem(i) {
  if (!i) return;
  // Un clic calendrier affiche toujours le résumé d'une séance ou d'un match.
  if (i.kind !== 'evenement' && !CAL.asPlayer) return openCalSummary(i);
  if (canEditTeamContent(CAL.profile.role) && i.kind === 'evenement') return openCalEdit(i);
  const rows = [['Date', calCap(calDayLabel(i.date))], ['Heure', i.heure], ['Lieu', CAL_LIEUX[i.lieu] || i.lieu],
    ['Stade', i.stade], ['Score', i.score], ['Informations', i.notes]].filter(([, v]) => v);
  document.getElementById('calDetailTitle').textContent = calTitleOf(i);
  document.getElementById('calDetailBody').innerHTML = `<p class="cal-kind k-${i.kind}">${CAL_KINDS[i.kind]}</p>
    <dl class="cal-dl">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
    ${CAL.asPlayer && i.kind !== 'evenement' ? '<div class="cal-quest hidden" id="calQuest"></div><div class="cal-rpe" id="calRpe" aria-live="polite"></div>' : ''}
    ${CAL.asPlayer && i.kind === 'seance' && i.date === calToday() ? '<div class="cal-rpe" id="calSore" aria-live="polite"></div>' : ''}
    ${CAL.asPlayer && i.kind === 'match' && i.date <= calToday() ? '<div class="cal-rpe" id="calAvis" aria-live="polite"></div>' : ''}`;
  openModal('calDetailModal');
  if (CAL.asPlayer && i.kind !== 'evenement') calPlayerForms(i);
}

/* Joueur : ce qu'il a à remplir (calendar-forms.js), puis ce qu'il a déjà donné (effort, avis). */
async function calPlayerForms(i) {
  calQuest(i);
  const { data, error } = await sb.rpc('my_event_forms', { p_kind: i.kind, p_id: i.id });
  if (error) console.warn('Formulaires de l’événement indisponibles', error.message);
  const form = (source) => (data || []).find(f => f.source === source);
  calRpe(i, form(i.kind === 'match' ? 'rpe_match' : 'rpe_seance'));
  if (i.kind === 'match' && i.date <= calToday()) calAvis(i, form('avis_match'));
  if (document.getElementById('calSore')) calSore(i);
}

/* Joueur : ses courbatures du matin déjà envoyées pour cette séance, à changer si besoin (soreness.js). */
async function calSore(i) {
  const box = document.getElementById('calSore'), { data, error } = await sb.rpc('my_soreness_today');
  if (error && !['PGRST202', '42883'].includes(error.code)) console.warn('Courbatures du jour illisibles', error.message);
  const s = data?.[0];
  if (!box || !s || s.niveau == null || Number(s.session_id) !== Number(i.id)) { box?.remove(); return; }
  box.innerHTML = `<p>Courbatures du matin : <strong>${Number(s.niveau)}/10</strong></p><button type="button" class="btn" id="calSoreBtn">Modifier</button>`;
  document.getElementById('calSoreBtn').addEventListener('click', () => openSorenessSheet({ today: s, onSaved: () => calSore(i) }));
}

/* Joueur : son avis sur un match joué (match-feedback.js, lmfc_v36.sql), à relire ou compléter.
   Sans réponse, il se donne dans le questionnaire après match (calQuest). */
async function calAvis(i, form) {
  const box = document.getElementById('calAvis');
  const { data, error } = await sb.from('match_feedback').select('individuel, collectif').eq('match_id', i.id).maybeSingle();
  if (error) { if (!['42P01', 'PGRST205'].includes(error.code)) console.warn('Avis de match illisible', error.message); box.remove(); return; }
  if (!mfAnswered(data)) { box.remove(); return; }
  box.innerHTML = '<p>Ton avis sur ce match est enregistré.</p><button type="button" class="btn" id="calAvisBtn">Relire ou compléter</button>';
  document.getElementById('calAvisBtn').addEventListener('click', () => openMatchFeedbackSheet({
    match: { id: i.id, titre: i.titre, date: i.date, form_questions: form?.questions }, value: data, onSaved: () => calAvis(i, form) }));
}

/* Joueur : son effort (RPE) déjà noté, définitif ; avant la séance, quand il pourra répondre.
   À noter, il se donne dans le questionnaire après séance (calQuest). */
async function calRpe(i, form) {
  const box = document.getElementById('calRpe'), match = i.kind === 'match', upcoming = i.date >= calToday();
  const { data, error } = await sb.from(match ? 'match_rpe' : 'session_rpe').select('rpe, corrige_par').eq(match ? 'match_id' : 'session_id', i.id).maybeSingle();
  if (error) { if (!['42P01', 'PGRST205'].includes(error.code)) console.warn('RPE illisible', error.message); box.remove(); return; }
  // Effort déjà noté à une autre séance de la même demi-journée (lmfc_v71.sql) : rien à remplir ici.
  const away = !match && !data && (await CAL.todoP)?.rpe?.find(r => !r.match && r.id === i.id)?.ailleurs;
  if (!data && !away && (!form || i.todo?.some(t => t.phase === 'post') || !upcoming)) { box.remove(); return; }
  box.innerHTML = away ? '<p class="text-muted">Ton effort de cette demi-journée est déjà noté sur l’autre séance : une seule réponse par demi-journée.</p>'
    : data ? `<p>Ton effort : <strong style="color:${rpeColor(data.rpe)}">${data.rpe}/10</strong> | ${escapeHtml(rpeLabel(data.rpe))}${data.corrige_par ? ' (corrigé par le staff)' : ''}</p>`
    : `<p class="text-muted">Tu pourras répondre après ${match ? 'le match' : 'la séance'}, jusqu’à ${RPE_DAYS} jours après.</p>`;
}

/* ---------- Commandes ---------- */
function calGo(dir) {
  CAL.anchor = dir ? calMove(CAL.view, CAL.anchor, dir) : calToday();
  CAL.day = !dir ? calToday() : CAL.view === 'day' ? calAddDays(CAL.day || CAL.anchor, 7 * dir) : CAL.view === 'month' ? null : CAL.day;
  loadCal();
}
function bindCal() {
  document.getElementById('calPrev').addEventListener('click', () => calGo(-1));
  document.getElementById('calNext').addEventListener('click', () => calGo(1));
  document.getElementById('calToday').addEventListener('click', () => calGo(0));
  document.getElementById('calAdd').addEventListener('click', () => openCalAdd());
  bindCalEdit();
  document.querySelector('.cal-bar').addEventListener('click', (e) => {
    const v = e.target.closest('[data-cal-view]'), k = e.target.closest('[data-cal-kind]');
    if (v && v.dataset.calView !== CAL.view) {
      CAL.view = v.dataset.calView;
      if (CAL.view === 'list') CAL.anchor = calToday();
      calMemo(true);
      loadCal();
    } else if (k) {
      CAL.kinds[CAL.kinds.has(k.dataset.calKind) ? 'delete' : 'add'](k.dataset.calKind);
      calMemo(true);
      renderCal();
    }
  });
  document.getElementById('calBody').addEventListener('click', (e) => {
    const reply = e.target.closest('[data-cal-reply]');   // « Répondre » : PRE ou POST (calendar-forms.js)
    if (reply) return calReply(CAL.items[Number(reply.dataset.calReply)]);
    const open = e.target.closest('[data-cal-open]');
    if (open) return openCalItem(CAL.items[Number(open.dataset.calOpen)]);
    const cell = e.target.closest('[data-cal-cell]');   // toute la case, au doigt sur téléphone
    if (!cell) return;
    CAL.day = cell.dataset.calCell;
    renderCal();
    document.querySelector(`[data-cal-day="${CAL.day}"]`)?.focus();   // le clavier reste sur le jour choisi
  });
}
