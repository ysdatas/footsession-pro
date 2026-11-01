/* ============================================================
   LMFC Performance — calendrier-page.js (calendrier.html)
   Calendrier commun du staff et des joueurs (lmfc_v28.sql) :
     - séances et matchs lus là où ils vivent : rien n'est recopié, une
       date changée dans sa rubrique se voit ici aussitôt ; plus les
       événements du club (club_events) ;
     - vues Mois, Semaine, À venir ; filtre par type (mémorisé sur
       l'appareil) ; l'équipe est celle du sélecteur du menu (staff) ;
     - staff : une séance ouvre l'éditeur, un match sa fiche ; joueur :
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
    if (['month', 'week', 'list'].includes(m.view)) CAL.view = m.view;
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
  document.getElementById('calAdd').classList.toggle('hidden', !canEdit(ctx.profile.role));
  calMemo();
  if (CAL.view === 'list') CAL.anchor = calToday();
  bindCal();
  loadCal();
  if (canEdit(ctx.profile.role)) calNotify();   // changements encore en attente (éditeur de séance, envoi interrompu)
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
    // Les séances à noter (RPE) marquées dans le calendrier : le joueur les voit sans chercher.
    const [{ data, error }, todo] = await Promise.all([sb.rpc('my_calendar', { p_from: from, p_to: to }), sb.rpc('my_rpe_sessions')]);
    if (error) throw error;
    const toRate = new Set((todo.data || []).filter(r => r.rpe == null && !r.corrige).map(r => r.session_id));
    return (data || []).map(r => ({ kind: r.kind, id: r.id, date: r.date_cal, heure: hhmm(r.heure), titre: r.titre,
      team_id: r.team_id, lieu: r.lieu, stade: r.stade, score: score(r), notes: r.notes, rpeTodo: r.kind === 'seance' && toRate.has(r.id) }));
  }
  const [s, m, e] = await Promise.all([
    byTeam(sb.from('sessions').select('id, titre, date_seance, heure, team_id, serie_id, lieu, duree_min')).gte('date_seance', from).lte('date_seance', to),
    byTeam(sb.from('matches').select('id, adversaire, date_match, heure, team_id, lieu, stade, competition, score_pour, score_contre'))
      .gte('date_match', from).lte('date_match', to),
    byTeam(sb.from('club_events').select('*')).gte('date_event', from).lte('date_event', to),
  ]);
  const failed = [s, m, e].find(r => r.error);
  if (failed) throw failed.error;
  return [
    ...s.data.map(x => ({ kind: 'seance', id: x.id, date: x.date_seance, heure: hhmm(x.heure), titre: x.titre, team_id: x.team_id, lieu: x.lieu, row: x })),
    ...m.data.map(x => ({ kind: 'match', id: x.id, date: x.date_match, heure: hhmm(x.heure), titre: x.adversaire, team_id: x.team_id,
      lieu: x.lieu, stade: x.stade, sub: x.competition, score: score(x) })),
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
const calTitleOf = (i) => (i.kind === 'match' ? `Match · ${i.titre}` : i.titre);
function calSub(i) {
  const team = !CAL.asPlayer && !currentTeamId() ? teamName(i.team_id) : '';
  return [i.kind === 'match' ? CAL_LIEUX[i.lieu] : i.lieu, i.stade, i.sub, team].filter(Boolean).join(' · ');
}
function calItemHtml(i) {
  const sub = calSub(i);
  return `<button type="button" class="cal-item k-${i.kind}" data-cal-open="${CAL.items.indexOf(i)}">
    <span class="cal-time">${i.heure || ''}</span>
    <span class="cal-what"><span class="cal-kind">${CAL_KINDS[i.kind]}</span><strong>${escapeHtml(calTitleOf(i))}</strong>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span>
    ${i.score ? `<span class="cal-score">${escapeHtml(i.score)}</span>` : ''}${i.rpeTodo ? '<span class="cal-rpe-todo">RPE à noter</span>' : ''}
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
      ${list.slice(0, 3).map(i => `<button type="button" class="cal-chip k-${i.kind}" data-cal-open="${CAL.items.indexOf(i)}">${i.rpeTodo ? '<i class="cal-chip-rpe">RPE</i> ' : ''}${i.heure ? `<b>${i.heure}</b> ` : ''}${escapeHtml(calTitleOf(i))}</button>`).join('')}
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
      + `${!CAL.asPlayer && currentTeam() ? ` · ${currentTeam().nom} et tout le club` : ''}`;
  }
  body.className = `cal-body is-${CAL.view}`;
  body.innerHTML = CAL.view === 'month' ? calMonthHtml(items) : CAL.view === 'week' ? calWeekHtml(items) : calListHtml(items);
}

/* ---------- Ouvrir un élément ---------- */
function openCalItem(i) {
  if (!i) return;
  // Événement, ou séance d'une série : la fenêtre de calendar-edit.js ; une séance seule s'ouvre dans l'éditeur.
  if (canEdit(CAL.profile.role) && (i.kind === 'evenement' || i.row?.serie_id)) return openCalEdit(i);
  if (i.kind !== 'evenement' && !CAL.asPlayer) {
    window.location.href = i.kind === 'seance' ? `session-edit.html?id=${i.id}` : `matchs.html?id=${i.id}`;
    return;
  }
  const rows = [['Date', calCap(calDayLabel(i.date))], ['Heure', i.heure], ['Lieu', CAL_LIEUX[i.lieu] || i.lieu],
    ['Stade', i.stade], ['Score', i.score], ['Informations', i.notes]].filter(([, v]) => v);
  document.getElementById('calDetailTitle').textContent = calTitleOf(i);
  document.getElementById('calDetailBody').innerHTML = `<p class="cal-kind k-${i.kind}">${CAL_KINDS[i.kind]}</p>
    <dl class="cal-dl">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
    ${CAL.asPlayer && i.kind === 'seance' ? '<div class="cal-rpe" id="calRpe" aria-live="polite"></div>' : ''}`;
  openModal('calDetailModal');
  if (CAL.asPlayer && i.kind === 'seance') calRpe(i);
}

/* Joueur : son RPE de la séance, et la saisie tant qu'elle est ouverte (jusqu'à J+2). */
async function calRpe(i) {
  const box = document.getElementById('calRpe');
  const { data, error } = await sb.from('session_rpe').select('rpe, corrige_par').eq('session_id', i.id).maybeSingle();
  if (error) { if (!['42P01', 'PGRST205'].includes(error.code)) console.warn('RPE illisible', error.message); box.remove(); return; }
  const open = rpeOpen(i.date) && !data?.corrige_par;
  const btn = (label, primary) => `<button type="button" class="btn${primary ? ' btn-primary' : ''}" id="calRpeBtn">${label}</button>`;
  box.innerHTML = data
    ? `<p>Ton effort : <strong style="color:${rpeColor(data.rpe)}">${data.rpe}/10</strong> · ${escapeHtml(rpeLabel(data.rpe))}${data.corrige_par ? ' (corrigé par le staff)' : ''}</p>${open ? btn('Modifier', false) : ''}`
    : open ? btn('Noter mon effort', true)
      : `<p class="text-muted">${i.date > calToday() ? 'Tu pourras noter ton effort après la séance.' : 'La saisie est fermée (2 jours après la séance).'}</p>`;
  document.getElementById('calRpeBtn')?.addEventListener('click', () => openRpeSheet({
    session: { id: i.id, titre: i.titre, date: i.date }, value: data?.rpe, onSaved: () => { i.rpeTodo = false; renderCal(); calRpe(i); } }));
}

/* ---------- Commandes ---------- */
function calGo(dir) {
  CAL.anchor = dir ? calMove(CAL.view, CAL.anchor, dir) : calToday();
  CAL.day = dir ? (CAL.view === 'month' ? null : CAL.day) : calToday();
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
    const open = e.target.closest('[data-cal-open]');
    if (open) return openCalItem(CAL.items[Number(open.dataset.calOpen)]);
    const cell = e.target.closest('[data-cal-cell]');   // toute la case, au doigt sur téléphone
    if (!cell) return;
    CAL.day = cell.dataset.calCell;
    renderCal();
    document.querySelector(`[data-cal-day="${CAL.day}"]`)?.focus();   // le clavier reste sur le jour choisi
  });
}
