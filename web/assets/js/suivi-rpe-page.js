/* ============================================================
   LMFC Performance — suivi-rpe-page.js (suivi-rpe.html)
   Suivi RPE du staff (lmfc_v29.sql), équipe par équipe :
     - capsules : les équipes du compte (toutes s'il n'est pas
       restreint), indépendantes du menu « Équipe » ; ?team= dans
       l'adresse. La RLS décide toujours de ce qui est lu ;
     - Tableau de bord (suivi-rpe-dash.js) : tuiles, graphiques, charge
       ressentie, tableau des séances ;
     - Détail joueurs : la grille joueurs × dernières séances (jusqu'à
       aujourd'hui) ; chaque case : la valeur du joueur (couleur de
       rpe.js), « ? » si sa réponse est attendue et manque (rpeExpected),
       « abs. » si une absence est enregistrée, vide si la séance ne le
       concerne pas ; « staff » marque une saisie du staff ; une case :
       saisir ou corriger (même feuille que le joueur) ; une séance :
       l'éditeur ; un joueur : sa fiche.
   Lecture seule par la RLS (séances et procédés, présences, joueurs,
   session_rpe) ; écriture par rpe_set(), qui décide.
   Dépend de auth.js, nav.js, app.js, procedure-time.js, rpe.js,
   rpe-stats.js, analytics-charts.js, suivi-rpe-dash.js.
   ============================================================ */

const SR = { n: 10, team: null, view: 'dash', sessions: [], players: [], cells: [], att: new Map(), rpe: new Map(), seq: 0 };
const srKey = (s, p) => `${s}:${p}`;
const srToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const srShort = (iso) => new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(`${iso}T12:00`));
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
  SR.view = url.searchParams.get('vue') === 'joueurs' ? 'grid' : 'dash';
  document.getElementById('srBody').addEventListener('click', srClick);
  document.querySelector('.page-actions').addEventListener('click', (e) => {
    const n = e.target.closest('[data-sr-n]'), v = e.target.closest('[data-sr-view]');
    if (n && Number(n.dataset.srN) !== SR.n) { SR.n = Number(n.dataset.srN); loadSr(); }
    if (v && v.dataset.srView !== SR.view) { SR.view = v.dataset.srView; srUrl(); renderSr(); }
    srPressed();
  });
  document.getElementById('srTeams').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sr-team]');
    if (!b || Number(b.dataset.srTeam) === SR.team) return;
    SR.team = Number(b.dataset.srTeam);
    srUrl(); renderSrTeams(); loadSr();
  });
  renderSrTeams(); srPressed(); loadSr();
})();

function srUrl() {
  const u = new URL(location.href);
  if (SR.team) u.searchParams.set('team', SR.team); else u.searchParams.delete('team');
  if (SR.view === 'grid') u.searchParams.set('vue', 'joueurs'); else u.searchParams.delete('vue');
  history.replaceState(null, '', u);
}
function srPressed() {
  document.querySelectorAll('[data-sr-n]').forEach(x => x.setAttribute('aria-pressed', String(Number(x.dataset.srN) === SR.n)));
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
      byTeam(sb.from('sessions').select('id, titre, date_seance, heure, team_id, duree_min, procedures(nb_sequences, duree_sequence_min, duree_min, temps_recup_min)'), SR.team)
        .lte('date_seance', srToday()).order('date_seance', { ascending: false }).order('heure', { ascending: false, nullsFirst: false }).limit(SR.n),
      sb.from('players').select(`id, nom, prenom${(window.CLUB_TEAMS || []).length ? ', team_id, other_team_ids' : ''}`).order('nom'),
    ]);
    if (s.error || p.error) throw s.error || p.error;
    const ids = s.data.map(x => x.id);
    const [a, r] = ids.length ? await Promise.all([
      sb.from('attendance').select('session_id, player_id, statut, present, invite').in('session_id', ids),
      sb.from('session_rpe').select('session_id, player_id, rpe, corrige_par').in('session_id', ids),
    ]) : [{ data: [] }, { data: [] }];
    if (a.error || r.error) throw a.error || r.error;
    if (seq !== SR.seq) return;   // une autre équipe a été choisie entre-temps
    // De la plus ancienne à la plus récente, comme l'évolution du joueur ; travail prévu = temps de travail des procédés.
    SR.sessions = [...s.data].reverse().map(x => ({ ...x, travail: sessionWorkMin(x.procedures) }));
    SR.att = new Map(a.data.map(x => [srKey(x.session_id, x.player_id), x]));
    SR.rpe = new Map(r.data.map(x => [srKey(x.session_id, x.player_id), x]));
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

/* La séance concerne-t-elle ce joueur ? (comme player_session_ok : équipe, « joue aussi en », invitation, ou une réponse). */
function srConcerned(s, p) {
  const att = SR.att.get(srKey(s.id, p.id));
  if (SR.rpe.has(srKey(s.id, p.id)) || att?.invite) return true;
  if (att?.statut === 'non_concerne') return false;   // retiré de cette séance (lmfc_v30.sql)
  if (!(window.CLUB_TEAMS || []).length) return true;
  return s.team_id != null && (s.team_id === p.team_id || (p.other_team_ids || []).includes(s.team_id));
}

/* État d'une case : { v, staff } réponse ; 'miss' attendue et absente ; 'abs' absence enregistrée ; null pas concerné. */
function srCell(s, p) {
  const r = SR.rpe.get(srKey(s.id, p.id));
  if (r) return { v: r.rpe, staff: !!r.corrige_par };
  if (!srConcerned(s, p)) return null;
  return rpeExpected(SR.att.get(srKey(s.id, p.id))) ? 'miss' : 'abs';
}

function renderSr() {
  const team = (window.CLUB_TEAMS || []).find(t => t.id === SR.team), body = document.getElementById('srBody');
  if (!SR.sessions.length) {
    document.getElementById('srStatus').textContent = team ? team.nom : '';
    body.innerHTML = '<div class="empty">Aucune séance passée pour cette équipe. Le RPE se renseigne après chaque séance créée dans la plateforme.</div>';
    return;
  }
  const missing = SR.cells.flat().filter(c => c === 'miss').length;
  document.getElementById('srStatus').textContent = [team?.nom, `${SR.sessions.length} dernière${SR.sessions.length > 1 ? 's' : ''} séance${SR.sessions.length > 1 ? 's' : ''}`,
    missing ? `${missing} réponse${missing > 1 ? 's' : ''} manquante${missing > 1 ? 's' : ''}` : 'aucune réponse manquante'].filter(Boolean).join(' · ');
  if (SR.view === 'dash') { renderSrDash(body, SR.sessions, SR.players, SR.cells); return; }
  const head = SR.sessions.map((s, j) => {
    const col = SR.cells.map(row => row[j]), vals = col.filter(c => c?.v).map(c => c.v), due = col.filter(c => c?.v || c === 'miss').length;
    return `<th scope="col"><a class="sr-sess" href="session-edit.html?id=${s.id}" title="${escapeHtml(s.titre)}">
      <span class="sr-date">${srShort(s.date_seance)}</span><span class="sr-t">${escapeHtml(s.titre)}</span>
      <span class="sr-avg"${vals.length ? ` style="--rpe:${rpeColor(vals.reduce((a, b) => a + b, 0) / vals.length)}"` : ''}>${vals.length ? rpeFr(vals.reduce((a, b) => a + b, 0) / vals.length) : '—'}</span>
      <span class="sr-rate">${vals.length}/${due}</span></a></th>`;
  }).join('');
  const rows = SR.players.map((p, i) => `<tr><th scope="row">${playerLink(p.id, playerFullName(p))}</th>${SR.cells[i].map((c, j) => {
    const s = SR.sessions[j], label = `${playerFullName(p)}, ${srShort(s.date_seance)}`;
    if (c === null) return '<td class="sr-na"></td>';
    if (c === 'abs') return `<td><button type="button" class="sr-c is-abs" data-sr="${j}:${i}" aria-label="${escapeHtml(label)} : absent, saisir quand même">abs.</button></td>`;
    if (c === 'miss') return `<td><button type="button" class="sr-c is-miss" data-sr="${j}:${i}" aria-label="${escapeHtml(label)} : pas de réponse, saisir à sa place">?</button></td>`;
    return `<td><button type="button" class="sr-c" style="--rpe:${rpeColor(c.v)}" data-sr="${j}:${i}"
      aria-label="${escapeHtml(`${label} : ${c.v} (${rpeLabel(c.v)})${c.staff ? ', saisi par le staff' : ''}, corriger`)}">${c.v}${c.staff ? '<i>staff</i>' : ''}</button></td>`;
  }).join('')}</tr>`).join('');
  body.innerHTML = `<div class="sr-wrap"><table class="sr-grid">
      <thead><tr><th scope="col" class="sr-corner">Joueur</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="sr-legend"><span class="sr-c is-miss" aria-hidden="true">?</span> réponse attendue, pas encore donnée
      · <span class="sr-c is-abs" aria-hidden="true">abs.</span> absence enregistrée
      · <span class="rpe-staff">staff</span> saisi ou corrigé par le staff.
      Touchez une case pour saisir ou corriger à la place du joueur. Les joueurs répondent depuis leur espace jusqu’à ${RPE_DAYS} jours après la séance ;
      la présence non cochée compte comme attendue.</p>`;
}

function srClick(e) {
  const b = e.target.closest('[data-sr]');
  if (!b) return;
  const [j, i] = b.dataset.sr.split(':').map(Number), s = SR.sessions[j], p = SR.players[i];
  openRpeSheet({ session: { id: s.id, titre: s.titre, date: s.date_seance }, value: SR.rpe.get(srKey(s.id, p.id))?.rpe ?? null,
    player: { id: p.id, nom: playerFullName(p) }, onSaved: () => loadSr() });
}
