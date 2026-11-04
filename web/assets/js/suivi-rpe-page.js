/* ============================================================
   LMFC Performance — suivi-rpe-page.js (suivi-rpe.html)
   Suivi RPE du staff (lmfc_v29.sql), équipe par équipe ; les 10, 20 ou
   50 dernières séances, une semaine (‹ ›) ou des dates (du … au …), avec
   les matchs de la même période (lmfc_v38.sql), mêlés aux séances :
     - capsules : les équipes du compte (toutes s'il n'est pas
       restreint), indépendantes du menu « Équipe » ; ?team= dans
       l'adresse. La RLS décide toujours de ce qui est lu ;
     - Tableau de bord (suivi-rpe-dash.js) : tuiles, graphiques, charge
       ressentie, tableau des séances ;
     - Courbatures (soreness.js, lmfc_v35.sql) : alertes non vues (même
       muscle 3 jours de suite, « Vu ») et la grille joueurs × jours de séance ;
     - Détail joueurs : la grille joueurs × dernières séances (jusqu'à
       aujourd'hui) ; chaque case : la valeur du joueur (couleur de
       rpe.js), « ? » si sa réponse est attendue et manque (rpeExpected),
       « … » si elle est attendue mais que le délai (J+14) court encore,
       « abs. » si une absence est enregistrée, vide si la séance ne le
       concerne pas ; « staff » marque une saisie du staff ; une case :
       saisir ou corriger (même feuille que le joueur) ; une séance :
       l'éditeur ; un joueur : sa fiche.
   Lecture seule par la RLS (séances et procédés, matchs et feuilles,
   présences, joueurs, session_rpe, match_rpe) ; écriture par rpe_set() et
   match_rpe_set(), qui décident. Un match porte key « m12 », car une
   séance et un match peuvent avoir le même numéro.
   Dépend de auth.js, nav.js, app.js, procedure-time.js, rpe.js,
   rpe-stats.js, analytics-charts.js, suivi-rpe-dash.js.
   ============================================================ */

const SR = { n: 10, period: null, sore: { rows: [], alerts: [], error: null }, team: null, view: 'dash', sessions: [], players: [], cells: [], att: new Map(), rpe: new Map(), seq: 0 };
const srKey = (s, p) => `${s}:${p}`;
const srIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const srToday = () => srIso(new Date());
const srDays = (iso, n) => { const d = new Date(`${iso}T12:00`); d.setDate(d.getDate() + n); return srIso(d); };
const srMonday = (iso) => srDays(iso, -((new Date(`${iso}T12:00`).getDay() + 6) % 7));
const srShort = (iso) => new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(`${iso}T12:00`));
// L'heure, seulement les jours à plusieurs séances : elle seule les distingue alors.
const srHour = (s) => (SR.sessions.some(x => x.key !== s.key && x.date_seance === s.date_seance) && s.heure?.slice(0, 5)) || '';
const srWhen = (s) => [srShort(s.date_seance), srHour(s)].filter(Boolean).join(' ');
const srHref = (s) => (s.match ? `matchs.html?id=${s.id}` : `session-edit.html?id=${s.id}`);
/* Un match en colonne : durée = la plus longue de la feuille, sinon 90 min (charge sans minutes jouées). */
const srMatch = (m) => ({ id: m.id, key: `m${m.id}`, match: true, titre: `Match · ${m.adversaire}`, adversaire: m.adversaire, date_seance: m.date_match, heure: m.heure,
  team_id: m.team_id, sheet: m.match_players, duree_min: Math.max(0, ...m.match_players.map(r => r.minutes || 0)) || 90 });
/* Équipes proposées : celles du compte, toutes s'il n'est pas restreint. */
const srTeams = () => { const all = window.CLUB_TEAMS || [], mine = accountTeams(window.CURRENT_PROFILE, all); return mine.length ? mine : all; };

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  fillUserBlock(ctx.profile.nom || 'Utilisateur', ROLE_LABELS[ctx.profile.role] || ctx.profile.role);
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });
  if (window.Chart) setChartDefaults();
  const url = new URL(location.href), teams = srTeams(), asked = Number(url.searchParams.get('team'));
  SR.team = (teams.find(t => t.id === asked) || teams.find(t => t.id === currentTeamId()) || teams[0])?.id ?? null;
  SR.view = { joueurs: 'grid', courbatures: 'sore' }[url.searchParams.get('vue')] || 'dash';
  document.getElementById('srBody').addEventListener('click', srClick);
  document.querySelector('.page-actions').addEventListener('click', (e) => {
    const n = e.target.closest('[data-sr-n]'), v = e.target.closest('[data-sr-view]');
    if (n) srChoose(n.dataset.srN);
    if (v && v.dataset.srView !== SR.view) { SR.view = v.dataset.srView; srUrl(); renderSr(); }
    srPressed();
  });
  document.getElementById('srTeams').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sr-team]');
    if (!b || Number(b.dataset.srTeam) === SR.team) return;
    SR.team = Number(b.dataset.srTeam);
    srUrl(); renderSrTeams(); loadSr();
  });
  document.getElementById('srPeriod').addEventListener('click', (e) => {
    const w = e.target.closest('[data-sr-week]');
    if (!w || w.disabled) return;
    const from = srDays(SR.period.from, 7 * Number(w.dataset.srWeek));
    SR.period = { mode: 'week', from, to: srDays(from, 6) };
    srPressed(); loadSr();
  });
  document.getElementById('srPeriod').addEventListener('change', () => {
    const from = document.getElementById('srFrom').value, to = document.getElementById('srTo').value;
    if (!from || !to || from > to) return;
    SR.period = { mode: 'dates', from, to };
    loadSr();
  });
  renderSrTeams(); srPressed(); loadSr();
})();

/* 10 / 20 / 50 dernières séances, une semaine (celle d'aujourd'hui pour commencer) ou des dates (4 semaines). */
function srChoose(v) {
  const today = srToday();
  if (v === 'week') SR.period = SR.period?.mode === 'week' ? SR.period : { mode: 'week', from: srMonday(today), to: srDays(srMonday(today), 6) };
  else if (v === 'dates') SR.period = SR.period?.mode === 'dates' ? SR.period : { mode: 'dates', from: SR.period?.from || srDays(today, -27), to: SR.period?.to || today };
  else { SR.period = null; SR.n = Number(v); }
  srPressed(); loadSr();
}

function srUrl() {
  const u = new URL(location.href);
  if (SR.team) u.searchParams.set('team', SR.team); else u.searchParams.delete('team');
  if (SR.view === 'dash') u.searchParams.delete('vue'); else u.searchParams.set('vue', SR.view === 'grid' ? 'joueurs' : 'courbatures');
  history.replaceState(null, '', u);
}
function srPressed() {
  const mode = SR.period?.mode || String(SR.n), p = SR.period, today = srToday(), box = document.getElementById('srPeriod');
  document.querySelectorAll('[data-sr-n]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.srN === mode)));
  box.classList.toggle('hidden', !p);
  box.innerHTML = !p ? '' : p.mode === 'week'
    ? `<button class="btn btn-sm" type="button" data-sr-week="-1" aria-label="Semaine précédente">‹</button>
       <strong>Semaine du ${srShort(p.from)} au ${srShort(p.to)}</strong>
       <button class="btn btn-sm" type="button" data-sr-week="1" aria-label="Semaine suivante"${p.to >= today ? ' disabled' : ''}>›</button>`
    : `<label for="srFrom">Du</label><input type="date" id="srFrom" value="${p.from}" max="${today}">
       <label for="srTo">au</label><input type="date" id="srTo" value="${p.to}" max="${today}">`;
  document.querySelectorAll('[data-sr-view]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.srView === SR.view)));
}
function renderSrTeams() {
  document.body.dataset.team = SR.team || '';   // la ligne « club · équipe » et la barre du haut suivent la capsule
  renderPageKicker(window.CURRENT_PROFILE);
  document.getElementById('srTeams').innerHTML = srTeams().map(t => `<button type="button" class="sr-team" data-sr-team="${t.id}"
    aria-pressed="${t.id === SR.team}">${escapeHtml(t.nom)}</button>`).join('');
}

async function loadSr() {
  const status = document.getElementById('srStatus'), body = document.getElementById('srBody'), seq = ++SR.seq;
  status.textContent = 'Chargement…';
  try {
    const [s, p] = await Promise.all([
      byTeam(sb.from('sessions').select('id, titre, date_seance, heure, team_id, duree_min, rpe_attendue, procedures(nb_sequences, duree_sequence_min, duree_min, temps_recup_min)'), SR.team)
        .lte('date_seance', SR.period && SR.period.to < srToday() ? SR.period.to : srToday()).gte('date_seance', SR.period?.from || '1900-01-01')
        .order('date_seance', { ascending: false }).order('heure', { ascending: false, nullsFirst: false }).limit(SR.period ? 200 : SR.n),
      sb.from('players').select(`id, nom, prenom${(window.CLUB_TEAMS || []).length ? ', team_id, other_team_ids' : ''}`).order('nom'),
    ]);
    if (s.error || p.error) throw s.error || p.error;
    const ids = s.data.map(x => x.id);
    const days = [...new Set(s.data.map(x => x.date_seance))];
    // Les matchs de la période ; sans séance, ceux du dernier mois.
    const [m, [a, r, so, al]] = await Promise.all([byTeam(sb.from('matches').select('id, adversaire, date_match, heure, team_id, match_players(player_id, statut, minutes), match_rpe(player_id, rpe, corrige_par)'), SR.team)
      .lte('date_match', SR.period && SR.period.to < srToday() ? SR.period.to : srToday()).gte('date_match', SR.period?.from || s.data.at(-1)?.date_seance || srDays(srToday(), -30)),
    ids.length ? Promise.all([
      sb.from('attendance').select('session_id, player_id, statut, present, invite').in('session_id', ids),
      sb.from('session_rpe').select('session_id, player_id, rpe, corrige_par').in('session_id', ids),
      sb.from('player_soreness').select('player_id, jour, niveau, muscles').in('jour', days),   // lmfc_v35.sql
      sb.from('soreness_alerts').select('id, player_id, jour, muscles').is('vu_at', null).order('jour', { ascending: false }),
    ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]]);
    if (a.error || r.error) throw a.error || r.error;
    // Sans les matchs, les séances restent lisibles : la page le dit.
    if (m.error) { console.error('Suivi RPE : matchs illisibles', m.error); toast('Matchs indisponibles : seules les séances sont affichées.', 'error'); }
    const matches = m.data || [];
    if (seq !== SR.seq) return;   // une autre équipe a été choisie entre-temps
    // Du plus ancien au plus récent, comme l'évolution du joueur ; travail prévu = temps de travail des procédés.
    SR.sessions = [...s.data.map(x => ({ ...x, key: x.id, travail: sessionWorkMin(x.procedures) })), ...matches.map(srMatch)]
      .sort((x, y) => x.date_seance.localeCompare(y.date_seance) || (x.heure || '').localeCompare(y.heure || ''));
    SR.att = new Map(a.data.map(x => [srKey(x.session_id, x.player_id), x]));
    SR.rpe = new Map([...r.data.map(x => [srKey(x.session_id, x.player_id), x]), ...matches.flatMap(x => x.match_rpe.map(y => [srKey(`m${x.id}`, y.player_id), y]))]);
    // Courbatures : sans lmfc_v35.sql, la vue le dit ; le reste de la page marche.
    SR.sore = { rows: so.data || [], alerts: al.data || [], error: so.error || al.error || null };
    if (SR.sore.error) console.warn('Courbatures indisponibles', SR.sore.error);
    SR.players = p.data.filter(pl => SR.sessions.some(se => srConcerned(se, pl)));
    SR.cells = SR.players.map(pl => SR.sessions.map(se => srCell(se, pl)));
    renderSr();
  } catch (e) {
    console.error('Suivi RPE illisible', e);
    status.textContent = '';
    body.innerHTML = `<div class="empty text-danger">${escapeHtml(['42P01', 'PGRST205'].includes(e?.code)
      ? 'Le RPE n’est pas encore installé : passez lmfc_v29.sql dans Supabase.' : e?.message || String(e))}</div>`;
  }
}

/* La séance concerne-t-elle ce joueur ? (comme player_session_ok : équipe, « joue aussi en », invitation, ou une réponse.)
   Un match : la feuille décide dès qu'elle existe, comme player_match_rpe_ok (lmfc_v38.sql). */
function srConcerned(s, p) {
  const att = SR.att.get(srKey(s.key, p.id));
  if (SR.rpe.has(srKey(s.key, p.id)) || att?.invite) return true;
  if (att?.statut === 'non_concerne') return false;   // retiré de cette séance (lmfc_v30.sql)
  if (s.sheet?.length) return rpeOnSheet(s.sheet, p.id);
  if (!(window.CLUB_TEAMS || []).length) return true;
  return s.team_id != null && (s.team_id === p.team_id || (p.other_team_ids || []).includes(s.team_id));
}

/* État d'une case : { v, staff } réponse ; 'miss' attendue et absente ; 'wait' attendue, délai pas fini ; 'abs' absence enregistrée ; null pas concerné. */
function srCell(s, p) {
  const r = SR.rpe.get(srKey(s.key, p.id));
  if (r) return { v: r.rpe, staff: !!r.corrige_par, min: s.sheet?.find(x => x.player_id === p.id)?.minutes };   // min : charge d'un match
  if (!srConcerned(s, p)) return null;
  if (!rpeExpected(SR.att.get(srKey(s.key, p.id)))) return 'abs';
  return rpeOpen(s.date_seance) ? 'wait' : 'miss';   // le joueur peut encore répondre (rpe.js)
}

function renderSr() {
  const team = (window.CLUB_TEAMS || []).find(t => t.id === SR.team), body = document.getElementById('srBody');
  if (!SR.sessions.length) {
    document.getElementById('srStatus').textContent = team ? team.nom : '';
    body.innerHTML = `<div class="empty">${SR.period ? 'Aucune séance de cette équipe sur cette période.' : 'Aucune séance passée pour cette équipe. Le RPE s’ouvre pour chaque séance posée au Calendrier, sans attendre le coach.'}</div>`;
    return;
  }
  const missing = SR.cells.flat().filter(c => c === 'miss').length, pending = SR.cells.flat().filter(c => c === 'wait').length;
  const nM = SR.sessions.filter(s => s.match).length, nS = SR.sessions.length - nM, plural = nS > 1 ? 's' : '', matchs = nM ? `, ${nM} match${nM > 1 ? 's' : ''}` : '';
  document.getElementById('srStatus').textContent = [team?.nom, SR.period ? `${nS} séance${plural}${matchs} du ${srShort(SR.period.from)} au ${srShort(SR.period.to)}` : `${nS} dernière${plural} séance${plural}${matchs}`,
    missing ? `${missing} réponse${missing > 1 ? 's' : ''} manquante${missing > 1 ? 's' : ''}` : 'aucune réponse manquante',
    pending ? `${pending} en attente` : ''].filter(Boolean).join(' · ');
  if (SR.view === 'dash') { renderSrDash(body, SR.sessions, SR.players, SR.cells); return; }
  if (SR.view === 'sore') {
    const inTeam = new Set(SR.players.map(p => p.id)), err = SR.sore.error;
    body.innerHTML = err ? `<div class="empty">${escapeHtml(['42P01', 'PGRST205'].includes(err.code) ? 'Le questionnaire de courbatures n’est pas encore installé : passez lmfc_v35.sql dans Supabase.' : err.message)}</div>`
      : soreHtml({ players: SR.players, days: [...new Set(SR.sessions.filter(x => !x.match).map(x => x.date_seance))],
        rows: SR.sore.rows.filter(x => inTeam.has(x.player_id)), alerts: SR.sore.alerts.filter(x => inTeam.has(x.player_id)) });
    return;
  }
  const head = SR.sessions.map((s, j) => {
    const col = SR.cells.map(row => row[j]), vals = col.filter(c => c?.v).map(c => c.v), due = col.filter(c => c?.v || c === 'miss' || c === 'wait').length;
    return `<th scope="col"><a class="sr-sess" href="${srHref(s)}" title="${escapeHtml(s.titre)}">
      <span class="sr-date">${srWhen(s)}</span>${s.match ? '<span class="sr-kind">Match</span>' : ''}<span class="sr-t">${escapeHtml(s.adversaire || s.titre)}</span>
      <span class="sr-avg"${vals.length ? ` style="--rpe:${rpeColor(vals.reduce((a, b) => a + b, 0) / vals.length)}"` : ''}>${vals.length ? rpeFr(vals.reduce((a, b) => a + b, 0) / vals.length) : '—'}</span>
      <span class="sr-rate">${vals.length}/${due}${s.rpe_attendue ? ` · att. ${s.rpe_attendue}` : ''}</span></a></th>`;
  }).join('');
  const rows = SR.players.map((p, i) => `<tr><th scope="row">${playerLink(p.id, playerFullName(p))}</th>${SR.cells[i].map((c, j) => {
    const s = SR.sessions[j], label = `${playerFullName(p)}, ${srWhen(s)}`;
    if (c === null) return '<td class="sr-na"></td>';
    if (c === 'abs') return `<td><button type="button" class="sr-c is-abs" data-sr="${j}:${i}" aria-label="${escapeHtml(label)} : absent, saisir quand même">abs.</button></td>`;
    if (c === 'wait') return `<td><button type="button" class="sr-c is-wait" data-sr="${j}:${i}" aria-label="${escapeHtml(label)} : en attente (il peut encore répondre), saisir à sa place">…</button></td>`;
    if (c === 'miss') return `<td><button type="button" class="sr-c is-miss" data-sr="${j}:${i}" aria-label="${escapeHtml(label)} : pas de réponse, saisir à sa place">?</button></td>`;
    return `<td><button type="button" class="sr-c" style="--rpe:${rpeColor(c.v)}" data-sr="${j}:${i}"
      aria-label="${escapeHtml(`${label} : ${c.v} (${rpeLabel(c.v)})${c.staff ? ', saisi par le staff' : ''}, corriger`)}">${c.v}${c.staff ? '<i>staff</i>' : ''}</button></td>`;
  }).join('')}</tr>`).join('');
  body.innerHTML = `<div class="sr-wrap"><table class="sr-grid">
      <thead><tr><th scope="col" class="sr-corner">Joueur</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="sr-legend"><span class="sr-c is-miss" aria-hidden="true">?</span> réponse manquante (délai passé)
      · <span class="sr-c is-wait" aria-hidden="true">…</span> en attente : le joueur peut encore répondre
      · <span class="sr-c is-abs" aria-hidden="true">abs.</span> absence enregistrée
      · <span class="rpe-staff">staff</span> saisi ou corrigé par le staff.
      Touchez une case pour saisir ou corriger à la place du joueur. Les joueurs répondent depuis leur espace jusqu’à ${RPE_DAYS} jours après la séance ;
      la présence non cochée compte comme attendue. Un match attend ceux qui ont joué d’après la feuille, tout le groupe s’il n’y en a pas.</p>`;
}

async function srClick(e) {
  const seen = e.target.closest('[data-sore-seen]');
  if (seen) {
    seen.disabled = true;
    const { error } = await sb.rpc('soreness_alert_seen', { p_alert: Number(seen.dataset.soreSeen) });
    if (error) { seen.disabled = false; return toast(error.message, 'error'); }
    SR.sore.alerts = SR.sore.alerts.filter(a => a.id !== Number(seen.dataset.soreSeen));
    return renderSr();
  }
  const b = e.target.closest('[data-sr]');
  if (!b) return;
  const [j, i] = b.dataset.sr.split(':').map(Number), s = SR.sessions[j], p = SR.players[i];
  openRpeSheet({ session: { id: s.id, titre: s.titre, date: s.date_seance, heure: s.heure, match: s.match }, value: SR.rpe.get(srKey(s.key, p.id))?.rpe ?? null,
    player: { id: p.id, nom: playerFullName(p) }, onSaved: () => loadSr() });
}
