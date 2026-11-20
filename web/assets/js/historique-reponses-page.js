/* ============================================================
   LMFC Performance — historique-reponses-page.js (historique-reponses)
   Toutes les réponses d'un joueur, par journée : RPE de séance et de match
   (session_rpe, match_rpe), courbatures (player_soreness), avis de match
   (match_feedback) et questionnaires (custom_form_responses), tels qu'ils
   sont enregistrés : rien n'est recalculé. Filtres : équipe, joueur,
   période, formulaire. Lecture seule ; la RLS ne rend que ce que le compte
   peut voir. Ouverte depuis Suivi RPE et la fiche joueur (?joueur=, ?team=).
   ============================================================ */
const HR = { team: null, players: [], rows: [], events: { sessionOf: new Map(), matchOf: new Map() }, form: '', seq: 0 };
const HR_ROLES = ['admin', 'coach', 'prepa', 'analyste'];   // comme Suivi RPE (nav.js)
const HR_DAYS = 14;   // période par défaut : les deux dernières semaines
const HR_LATE = 15;   // une réponse arrive jusqu'à J+14 (rpe_open) : on lit un jour de plus
const hrIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hrShift = (iso, n) => { const d = new Date(`${iso}T12:00`); d.setDate(d.getDate() + n); return hrIso(d); };
const hrDayLabel = (iso) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${iso}T12:00`));
const hrTime = (ts) => (ts ? new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short' }).format(new Date(ts)) : '');

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  fillUserBlock(ctx.profile.nom || 'Utilisateur', ROLE_LABELS[ctx.profile.role] || ctx.profile.role);
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });
  if (!HR_ROLES.includes(ctx.profile.role)) { location.replace(roleHome(ctx.profile.role)); return; }
  const url = new URL(location.href), all = window.CLUB_TEAMS || [], mine = accountTeams(window.CURRENT_PROFILE, all);
  const teams = mine.length ? mine : all, asked = Number(url.searchParams.get('team'));
  HR.team = (teams.find(t => t.id === asked) || teams.find(t => t.id === currentTeamId()) || teams[0])?.id ?? null;
  document.getElementById('hrTeam').innerHTML = teams.map(t => `<option value="${t.id}"${t.id === HR.team ? ' selected' : ''}>${escapeHtml(t.nom)}</option>`).join('');
  const today = hrIso(new Date());
  document.getElementById('hrTo').value = url.searchParams.get('au') || today;
  document.getElementById('hrFrom').value = url.searchParams.get('du') || hrShift(today, -HR_DAYS + 1);
  document.getElementById('hrFilters').addEventListener('change', hrChange);
  document.getElementById('hrFilters').addEventListener('submit', (e) => e.preventDefault());
  HR.form = url.searchParams.get('form') || '';
  await hrLoadPlayers(Number(url.searchParams.get('joueur')) || null);
  await hrLoad();
})();

/* Les joueurs de l'équipe (et l'invité demandé par l'adresse, même hors de l'équipe). */
async function hrLoadPlayers(wanted) {
  const { data, error } = await sb.from('players').select('id, nom, prenom, team_id, other_team_ids, exterieur').order('nom');
  if (error) { console.error('Historique : joueurs illisibles', error); hrFail(error); return; }
  HR.players = (data || []).filter(p => playerInTeam(p, HR.team) || p.id === wanted);
  const select = document.getElementById('hrPlayer');
  select.innerHTML = `<option value="">Tous les joueurs</option>${HR.players.map(p => `<option value="${p.id}"${p.id === wanted ? ' selected' : ''}>${escapeHtml(playerFullName(p))}</option>`).join('')}`;
}

async function hrChange(e) {
  if (e.target.id === 'hrTeam') { HR.team = Number(e.target.value) || null; await hrLoadPlayers(null); }
  if (e.target.id === 'hrForm') { HR.form = e.target.value; hrUrl(); hrRender(); return; }   // filtre local
  await hrLoad();
}

function hrUrl() {
  const u = new URL(location.href), set = (k, v) => (v ? u.searchParams.set(k, v) : u.searchParams.delete(k));
  set('team', HR.team); set('joueur', document.getElementById('hrPlayer').value);
  set('du', document.getElementById('hrFrom').value); set('au', document.getElementById('hrTo').value); set('form', HR.form);
  history.replaceState(null, '', u);
  document.getElementById('hrBack').href = HR.team ? `suivi-rpe?team=${HR.team}&vue=reponses` : 'suivi-rpe';
}

function hrFail(error) {
  document.getElementById('hrStatus').textContent = 'Réponses illisibles pour le moment.';
  document.getElementById('hrBody').innerHTML = `<p class="text-danger">${escapeHtml(error?.message || 'Une erreur est survenue.')}</p>`;
}

/* Tout ce que les joueurs choisis ont répondu sur la période, ramené à une liste d'entrées
   { player_id, day, event, when, key, form, items: [{ label, text, empty }] }. */
async function hrLoad() {
  const seq = ++HR.seq, playerId = Number(document.getElementById('hrPlayer').value) || null;
  let from = document.getElementById('hrFrom').value, to = document.getElementById('hrTo').value;
  if (from > to) [from, to] = [to, from];
  hrUrl();
  const ids = (playerId ? [playerId] : HR.players.map(p => p.id));
  const body = document.getElementById('hrBody');
  if (!ids.length) { HR.rows = []; hrRender(); return; }
  body.classList.add('is-loading');
  document.getElementById('hrStatus').textContent = 'Chargement…';
  const late = `${hrShift(to, HR_LATE)}T23:59:59`;
  const [sr, mr, so, fb, cf] = await Promise.all([
    sb.from('session_rpe').select('player_id, rpe, corrige_par, sessions!inner(id, titre, date_seance, heure)').in('player_id', ids)
      .gte('sessions.date_seance', from).lte('sessions.date_seance', to),
    sb.from('match_rpe').select('player_id, rpe, corrige_par, matches!inner(id, adversaire, date_match, heure)').in('player_id', ids)
      .gte('matches.date_match', from).lte('matches.date_match', to),
    sb.from('player_soreness').select('player_id, jour, niveau, muscles, updated_at').in('player_id', ids).gte('jour', from).lte('jour', to),
    sb.from('match_feedback').select('player_id, individuel, collectif, matches!inner(id, adversaire, date_match, heure)').in('player_id', ids)
      .gte('matches.date_match', from).lte('matches.date_match', to),
    sb.from('custom_form_responses').select('id, form_id, player_id, occurrence, form_title_snapshot, questions_snapshot, answers, submitted_at')
      .in('player_id', ids).gte('submitted_at', `${from}T00:00:00`).lte('submitted_at', late).order('submitted_at'),
  ]);
  if (seq !== HR.seq) return;
  const warn = (r, what) => { if (r.error && !['42P01', 'PGRST205', 'PGRST200'].includes(r.error.code)) console.warn(`Historique : ${what} illisible`, r.error); return r.data || []; };
  const rows = [];
  const sessionOf = new Map(), matchOf = new Map();
  for (const r of warn(sr, 'RPE de séance')) {
    const s = r.sessions; sessionOf.set(s.id, s);
    rows.push({ player_id: r.player_id, day: s.date_seance, event: `s${s.id}`, key: 'rpe', form: 'RPE de séance',
      items: [{ label: 'Effort ressenti sur la séance (sur 10)', text: `${r.rpe}${r.corrige_par ? ' (saisi ou corrigé par le staff)' : ''}`, color: rpeColor(r.rpe) }] });
  }
  for (const r of warn(mr, 'RPE de match')) {
    const m = r.matches; matchOf.set(m.id, m);
    rows.push({ player_id: r.player_id, day: m.date_match, event: `m${m.id}`, key: 'rpe', form: 'RPE de match',
      items: [{ label: 'Effort ressenti sur le match (sur 10)', text: `${r.rpe}${r.corrige_par ? ' (saisi ou corrigé par le staff)' : ''}`, color: rpeColor(r.rpe) }] });
  }
  for (const r of warn(fb, 'avis de match')) {
    const m = r.matches; matchOf.set(m.id, m);
    rows.push({ player_id: r.player_id, day: m.date_match, event: `m${m.id}`, key: 'avis', form: 'Avis sur le match',
      items: [['individuel', 'Sa performance'], ['collectif', 'L’équipe']].map(([k, label]) => ({ label, text: r[k] || '', empty: !r[k] })) });
  }
  for (const r of warn(so, 'courbatures')) {
    rows.push({ player_id: r.player_id, day: r.jour, event: `j${r.jour}`, when: hrTime(r.updated_at), key: 'courbatures', form: 'Courbatures au réveil',
      items: [{ label: 'Niveau (0 à 10)', text: String(r.niveau) }, { label: 'Muscles', text: (r.muscles || []).join(', '), empty: !(r.muscles || []).length }] });
  }
  const forms = warn(cf, 'questionnaires');
  // Séances et matchs des questionnaires dont le RPE n'est pas sur la période lue.
  const needS = [...new Set(forms.filter(r => /^s\d+$/.test(r.occurrence)).map(r => Number(r.occurrence.slice(1))).filter(id => !sessionOf.has(id)))];
  const needM = [...new Set(forms.filter(r => /^m\d+$/.test(r.occurrence)).map(r => Number(r.occurrence.slice(1))).filter(id => !matchOf.has(id)))];
  const [xs, xm] = await Promise.all([
    needS.length ? sb.from('sessions').select('id, titre, date_seance, heure').in('id', needS) : { data: [] },
    needM.length ? sb.from('matches').select('id, adversaire, date_match, heure').in('id', needM) : { data: [] },
  ]);
  if (seq !== HR.seq) return;
  (xs.data || []).forEach(s => sessionOf.set(s.id, s));
  (xm.data || []).forEach(m => matchOf.set(m.id, m));
  for (const r of forms) {
    const occ = r.occurrence || '', n = Number(occ.slice(1));
    const day = occ.startsWith('s') ? sessionOf.get(n)?.date_seance : occ.startsWith('m') ? matchOf.get(n)?.date_match
      : occ.startsWith('j') ? occ.slice(1) : hrIso(new Date(r.submitted_at));
    if (!day || day < from || day > to) continue;
    const answers = r.answers || {};
    rows.push({ player_id: r.player_id, day, event: occ || `f${r.id}`, when: hrTime(r.submitted_at), key: `f${r.form_id}`,
      form: String(r.form_title_snapshot || 'Questionnaire').split(' · ')[0],
      items: (r.questions_snapshot || []).filter(q => !q.fixe).map(q => {
        const text = fqAnswerText(q, answers[q.id]);
        return { label: q.label || 'Question', text, empty: !text, color: fqColor(q, answers[q.id]) };
      }) });
  }
  HR.rows = rows;
  HR.events = { sessionOf, matchOf };
  body.classList.remove('is-loading');
  hrForms();
  hrRender();
}

/* Les formulaires présents sur la période, pour le filtre. */
function hrForms() {
  const select = document.getElementById('hrForm'), seen = new Map();
  HR.rows.forEach(r => { if (!seen.has(r.key)) seen.set(r.key, r.key === 'rpe' ? 'RPE (séance et match)' : r.form); });
  if (HR.form && !seen.has(HR.form)) seen.set(HR.form, 'Formulaire choisi');
  select.innerHTML = `<option value="">Tous</option>${[...seen].map(([k, label]) => `<option value="${escapeHtml(k)}"${k === HR.form ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}`;
}

/* La séance, le match ou la journée d'une entrée, comme le joueur la reconnaît. */
function hrEventLabel(event) {
  const n = Number(event.slice(1));
  if (event.startsWith('s')) { const s = HR.events.sessionOf.get(n); return `${s?.titre || 'Séance'}${s?.heure ? ` · ${s.heure.slice(0, 5)}` : ''}`; }
  if (event.startsWith('m')) { const m = HR.events.matchOf.get(n); return `Match${m?.adversaire ? ` contre ${m.adversaire}` : ''}${m?.heure ? ` · ${m.heure.slice(0, 5)}` : ''}`; }
  if (event.startsWith('j')) return 'Au réveil';
  return 'Questionnaire';
}

function hrRender() {
  const rows = HR.rows.filter(r => !HR.form || r.key === HR.form);
  const playerId = Number(document.getElementById('hrPlayer').value) || null;
  const byPlayer = new Map();
  rows.forEach(r => byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) || []), r]));
  const players = HR.players.filter(p => byPlayer.has(p.id));
  const days = new Set(rows.map(r => `${r.player_id}|${r.day}`)).size;
  document.getElementById('hrStatus').textContent = rows.length
    ? `${days} journée${days > 1 ? 's' : ''} avec des réponses${playerId ? '' : `, ${players.length} joueur${players.length > 1 ? 's' : ''}`}`
    : 'Aucune réponse sur cette période.';
  const body = document.getElementById('hrBody');
  if (!rows.length) { body.innerHTML = '<div class="empty">Aucune réponse pour ces filtres. Élargissez la période ou choisissez un autre joueur.</div>'; return; }
  // Un joueur : ses journées. Tous : un bloc replié par joueur, le premier ouvert.
  body.innerHTML = playerId ? hrDaysHtml(byPlayer.get(playerId) || [])
    : players.map((p, i) => `<details class="card hr-player"${i === 0 ? ' open' : ''}><summary><span class="hr-player-name">${escapeHtml(playerFullName(p))}</span>
        <span class="hr-player-n">${new Set(byPlayer.get(p.id).map(r => r.day)).size} j.</span></summary>
        <div class="hr-player-body">${hrDaysHtml(byPlayer.get(p.id))}</div></details>`).join('');
}

/* Les journées d'un joueur, de la plus récente à la plus ancienne ; dans chacune, chaque séance ou match. */
function hrDaysHtml(rows) {
  const days = [...new Set(rows.map(r => r.day))].sort().reverse();
  return days.map(day => {
    const ofDay = rows.filter(r => r.day === day), events = [...new Set(ofDay.map(r => r.event))];
    return `<section class="hr-day"><h2 class="hr-day-title">${escapeHtml(hrDayLabel(day))}</h2>
      ${events.map(ev => `<div class="hr-event"><h3 class="hr-event-title">${escapeHtml(hrEventLabel(ev))}</h3>
        <div class="hr-forms">${ofDay.filter(r => r.event === ev).map(hrFormHtml).join('')}</div></div>`).join('')}</section>`;
  }).join('');
}

function hrFormHtml(r) {
  return `<article class="hr-form"><header><strong>${escapeHtml(r.form)}</strong>${r.when ? `<span>${escapeHtml(r.when)}</span>` : ''}</header>
    <dl>${r.items.map(it => `<div class="${it.empty ? 'is-empty' : ''}"><dt>${escapeHtml(it.label)}</dt>
      <dd>${it.empty ? 'Sans réponse' : `${it.color ? `<span class="hr-dot" style="--lv:${it.color}" aria-hidden="true"></span>` : ''}${escapeHtml(it.text)}`}</dd></div>`).join('')}</dl></article>`;
}
