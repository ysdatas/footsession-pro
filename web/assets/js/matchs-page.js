/* ============================================================
   LMFC Performance — matchs-page.js
   Retours de match (lmfc_v11.sql) : la rencontre, ses joueurs
   (statut, minutes, buts, passes, + / = / −, commentaire court) et
   l'historique de chaque joueur au fil des matchs.
   Tout le staff consulte ; administrateur et coachs saisissent
   (la base refuse les autres).
   ============================================================ */

const STATUTS_MATCH = [['titulaire', 'Titulaire'], ['remplacant', 'Remplaçant'], ['non_entre', 'Non entré']];
const STATUT_MATCH_LABEL = Object.fromEntries(STATUTS_MATCH);
const LIEUX = { domicile: 'Domicile', exterieur: 'Extérieur', neutre: 'Terrain neutre' };
const RESULTATS = { v: 'Victoire', n: 'Nul', d: 'Défaite' };
// BILAN_NOTES (+ / = / −) : procedure-time.js.

let myProfile = null;
let CAN_EDIT_MATCH = false;
let matches = [];        // matchs de l'équipe choisie, du plus récent au plus ancien
let clubPlayers = [];    // tout l'effectif du club (noms, recherche)
let editing = null;      // match ouvert : { id, rows: Map(player_id → ligne), removed: Set }

const val = (id) => document.getElementById(id).value.trim();
const playerName = (p) => `${p?.prenom || ''} ${p?.nom || ''}`.trim() || 'Joueur';
const playerOf = (id) => clubPlayers.find(p => p.id === id);
const resultOf = (m) => (m.score_pour == null || m.score_contre == null ? null
  : m.score_pour > m.score_contre ? 'v' : m.score_pour < m.score_contre ? 'd' : 'n');
const scoreHtml = (m) => {
  const r = resultOf(m);
  return r ? `<span class="mt-res mt-${r}" title="${RESULTATS[r]}">${m.score_pour} – ${m.score_contre}</span>` : '<span class="mt-res">—</span>';
};
const noteHtml = (k) => {
  const n = BILAN_NOTES.find(x => x.key === k);
  return n ? `<span class="mt-note mt-note-${k}" title="${n.label}">${n.sign}</span>` : '';
};

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  myProfile = ctx.profile;
  CAN_EDIT_MATCH = canEdit(myProfile.role);
  document.getElementById('uName').textContent = myProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[myProfile.role] || myProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (myProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  if (CAN_EDIT_MATCH) {
    const btn = document.getElementById('btnNewMatch');
    btn.classList.remove('hidden');
    btn.addEventListener('click', () => openMatch(null));
  }
  initTabs();
  initEditor();
  document.getElementById('matchList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-match]');
    if (row) openMatch(matches.find(m => m.id === Number(row.dataset.match)));
  });
  document.getElementById('playerPick').addEventListener('change', (e) => { savePageState({ player: e.target.value }); renderPlayerHistory(); });
  document.getElementById('playerHistory').addEventListener('click', async (e) => {
    const row = e.target.closest('[data-open-match]');
    if (!row) return;
    const { data, error } = await sb.from('matches').select('*').eq('id', Number(row.dataset.openMatch)).single();
    if (error) return toast(error.message, 'error');
    openMatch(data);
  });

  await Promise.all([loadPlayers(), loadMatches()]);
  renderPlayerPick();
})();

/* ---------- Onglets « Matchs » / « Par joueur » (mémorisés) ---------- */
function initTabs() {
  const tabs = ['tabMatches', 'tabPlayer'].map(id => document.getElementById(id));
  const show = (tab) => {
    tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    savePageState({ tab: tab.id });
  };
  tabs.forEach(t => t.addEventListener('click', () => show(t)));
  if (pageState().tab === 'tabPlayer') show(tabs[1]);
}

/* ---------- Chargement ---------- */
async function loadPlayers() {
  const { data, error } = await sb.from('players').select('id, nom, prenom, numero, poste, team_id, other_team_ids').order('nom');
  if (error) { console.error('Effectif indisponible', error); toast(error.message, 'error'); return; }
  clubPlayers = data || [];
}

async function loadMatches() {
  const list = document.getElementById('matchList');
  const { data, error } = await byTeam(sb.from('matches').select('*, match_players(count)')).order('date_match', { ascending: false });
  if (error) {
    console.error('Matchs illisibles (lmfc_v11.sql ?)', error);
    list.innerHTML = '<div class="empty">Les retours de match ne sont pas encore disponibles. Prévenez l’administrateur du club.</div>';
    document.getElementById('matchSub').textContent = '';
    return;
  }
  matches = data || [];
  renderMatches();
}

/* ---------- Liste des matchs ---------- */
function renderMatches() {
  const n = (r) => matches.filter(m => resultOf(m) === r).length;
  const team = currentTeam();
  document.getElementById('matchSub').textContent = [`${matches.length} match${matches.length > 1 ? 's' : ''}`,
    matches.length ? `${n('v')} V · ${n('n')} N · ${n('d')} D` : '', team?.nom].filter(Boolean).join(' · ');
  document.getElementById('matchList').innerHTML = matches.length
    ? `<div class="mt-list">${matches.map(m => {
        const players = m.match_players?.[0]?.count;
        const sub = [m.competition, LIEUX[m.lieu], !currentTeamId() && teamName(m.team_id)].filter(Boolean).map(escapeHtml).join(' · ');
        return `<button type="button" class="mt-row" data-match="${m.id}">
          <span class="mt-date">${fmtDateFr(m.date_match)}</span>
          <span class="mt-main"><strong>${escapeHtml(m.adversaire)}</strong>${sub ? `<small>${sub}</small>` : ''}</span>
          <span class="mt-count">${players ? `${players} joueur${players > 1 ? 's' : ''}` : ''}</span>
          ${scoreHtml(m)}
        </button>`;
      }).join('')}</div>`
    : `<div class="empty">Aucun match enregistré.${CAN_EDIT_MATCH ? '<br>Cliquez sur « + Nouveau match ».' : ''}</div>`;
}

/* ---------- Saisie d'un match ---------- */
async function openMatch(m) {
  editing = { id: m?.id || null, rows: new Map(), removed: new Set() };
  const set = (id, v) => { document.getElementById(id).value = v ?? ''; };
  set('m-adv', m?.adversaire); set('m-date', m?.date_match || new Date().toISOString().slice(0, 10));
  set('m-comp', m?.competition); set('m-lieu', m?.lieu); set('m-pour', m?.score_pour); set('m-contre', m?.score_contre);
  set('m-infos', m?.infos); set('m-comment', m?.commentaire); set('m-retenir', m?.a_retenir);
  const teams = window.CLUB_TEAMS || [];
  document.getElementById('m-team-field').classList.toggle('hidden', !teams.length);
  document.getElementById('m-team').innerHTML = '<option value="">Sans équipe</option>'
    + teams.map(t => `<option value="${t.id}">${escapeHtml(t.nom)}</option>`).join('');
  set('m-team', m ? m.team_id : currentTeamId());
  document.getElementById('matchModalTitle').textContent = !m ? 'Nouveau match' : CAN_EDIT_MATCH ? 'Modifier le match' : `${m.adversaire} · ${fmtDateFr(m.date_match)}`;
  // Lecture seule (préparateur) : tout se lit, rien ne s'enregistre.
  document.querySelectorAll('#matchModal input, #matchModal select, #matchModal textarea').forEach(f => { f.disabled = !CAN_EDIT_MATCH; });
  ['mpTools', 'm-save'].forEach(id => document.getElementById(id).classList.toggle('hidden', !CAN_EDIT_MATCH));
  document.getElementById('m-delete').classList.toggle('hidden', !(m && CAN_EDIT_MATCH));
  document.getElementById('m-cancel').textContent = CAN_EDIT_MATCH ? 'Annuler' : 'Fermer';
  document.getElementById('mpList').innerHTML = m ? '<p class="text-muted">Chargement…</p>' : '';
  openModal('matchModal');
  if (m) {
    const { data, error } = await sb.from('match_players').select('*').eq('match_id', m.id);
    if (error) { console.error('Joueurs du match illisibles', error); toast(error.message, 'error'); }
    (data || []).forEach(r => editing.rows.set(r.player_id, r));
  }
  renderRows();
}

/* Joueurs du match : titulaires, remplaçants, non entrés, puis sans statut. */
function renderRows() {
  const dis = CAN_EDIT_MATCH ? '' : 'disabled';
  const rank = { titulaire: 0, remplacant: 1, non_entre: 2 };
  const rows = [...editing.rows.values()].sort((a, b) => (rank[a.statut] ?? 3) - (rank[b.statut] ?? 3)
    || playerName(playerOf(a.player_id)).localeCompare(playerName(playerOf(b.player_id)), 'fr'));
  document.getElementById('mpCount').textContent = rows.length ? `· ${rows.length}` : '';
  const num = (r, k, max, unit) => `<label class="mp-num"><input data-k="${k}" type="number" min="0" max="${max}" inputmode="numeric" value="${r[k] ?? ''}" ${dis}><span>${unit}</span></label>`;
  document.getElementById('mpList').innerHTML = rows.length ? rows.map(r => {
    const name = playerName(playerOf(r.player_id));
    return `<div class="mp-row" data-player="${r.player_id}">
      <span class="mp-name">${escapeHtml(name)}</span>
      <select data-k="statut" aria-label="Statut de ${escapeHtml(name)}" ${dis}><option value="">—</option>${STATUTS_MATCH.map(([k, l]) => `<option value="${k}"${r.statut === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      ${num(r, 'minutes', 130, 'min')}${num(r, 'buts', 20, 'buts')}${num(r, 'passes', 20, 'passes')}
      <span class="bilan-notes" role="group" aria-label="Note de ${escapeHtml(name)}">${BILAN_NOTES.map(n =>
        `<button type="button" class="bn bn-${n.key}" data-note="${n.key}" aria-pressed="${r.note === n.key}" title="${n.label}" ${dis}>${n.sign}</button>`).join('')}</span>
      <input class="mp-comment" data-k="commentaire" maxlength="500" value="${escapeHtml(r.commentaire || '')}" placeholder="Commentaire" aria-label="Commentaire sur ${escapeHtml(name)}" ${dis}>
      ${CAN_EDIT_MATCH ? `<button class="att-remove" type="button" data-remove aria-label="Retirer ${escapeHtml(name)} du match" title="Retirer du match">✕</button>` : ''}
    </div>`;
  }).join('') : `<p class="text-muted">Aucun joueur.${CAN_EDIT_MATCH ? ' « Ajouter l’effectif » ou cherchez un joueur du club.' : ''}</p>`;
}

function addRow(id) {
  if (editing.rows.has(id)) return;
  editing.removed.delete(id);
  editing.rows.set(id, { player_id: id, statut: null, minutes: null, buts: null, passes: null, note: null, commentaire: '' });
}

function candidates(query) {
  const q = query.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (q.length < 2) return [];
  return clubPlayers.filter(p => !editing.rows.has(p.id)
    && `${p.prenom || ''} ${p.nom || ''} ${p.prenom || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q)).slice(0, 8);
}

function initEditor() {
  const list = document.getElementById('mpList');
  const rowOf = (e) => editing.rows.get(Number(e.target.closest('[data-player]')?.dataset.player));
  list.addEventListener('input', (e) => {
    const r = rowOf(e), k = e.target.dataset.k;
    if (!r || !k) return;
    if (k === 'statut' || k === 'commentaire') r[k] = e.target.value || null;
    else r[k] = e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value)));
  });
  list.addEventListener('click', (e) => {
    const r = rowOf(e);
    if (!r || !CAN_EDIT_MATCH) return;
    const b = e.target.closest('[data-note]');
    if (b) {
      r.note = r.note === b.dataset.note ? null : b.dataset.note;   // second clic : retire la note
      b.parentElement.querySelectorAll('[data-note]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.note === r.note)));
    } else if (e.target.closest('[data-remove]')) {
      editing.rows.delete(r.player_id);
      editing.removed.add(r.player_id);
      renderRows();
    }
  });
  document.getElementById('btnSquad').addEventListener('click', () => {
    const teamId = Number(val('m-team')) || currentTeamId();
    const squad = clubPlayers.filter(p => playerInTeam(p, teamId));
    squad.forEach(p => addRow(p.id));
    renderRows();
    toast(`${squad.length} joueur${squad.length > 1 ? 's' : ''} de l’effectif`, 'success');
  });
  const search = document.getElementById('mpSearch'), results = document.getElementById('mpResults');
  const renderResults = () => {
    const list = candidates(search.value);
    results.innerHTML = list.map(p => `<button type="button" class="guest-hit" data-add="${p.id}">
        <strong>${escapeHtml(playerName(p))}</strong><span>${escapeHtml(teamName(p.team_id) || 'Sans équipe')}${p.numero != null ? ` · #${p.numero}` : ''}</span></button>`).join('')
      || (search.value.trim().length >= 2 ? '<p class="text-muted guest-none">Aucun joueur du club ne correspond.</p>' : '');
  };
  search.addEventListener('input', renderResults);
  results.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    addRow(Number(b.dataset.add));
    search.value = '';
    renderResults();
    renderRows();
  });
  document.getElementById('m-save').addEventListener('click', saveMatch);
  document.getElementById('m-delete').addEventListener('click', deleteMatch);
}

async function saveMatch() {
  const adversaire = val('m-adv'), date_match = val('m-date');
  if (!adversaire || !date_match) return toast('Adversaire et date sont obligatoires.', 'error');
  const score = (id) => (val(id) === '' ? null : Math.max(0, Math.round(Number(val(id)))));
  const row = {
    adversaire, date_match, competition: val('m-comp') || null, lieu: val('m-lieu') || null,
    score_pour: score('m-pour'), score_contre: score('m-contre'), infos: val('m-infos') || null,
    commentaire: val('m-comment') || null, a_retenir: val('m-retenir') || null,
  };
  if (!document.getElementById('m-team-field').classList.contains('hidden')) row.team_id = Number(val('m-team')) || null;
  const btn = document.getElementById('m-save');
  btn.disabled = true;
  try {
    let id = editing.id;
    if (id) {
      // .select : une modification refusée par la base ne renvoie aucune ligne, sans erreur.
      const { data, error } = await sb.from('matches').update(row).eq('id', id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Modification refusée : droits insuffisants.');
    } else {
      const { data, error } = await sb.from('matches').insert({ ...row, club_id: myProfile.club_id }).select('id').single();
      if (error) throw error;
      id = editing.id = data.id;
    }
    if (editing.removed.size) {
      const { error } = await sb.from('match_players').delete().eq('match_id', id).in('player_id', [...editing.removed]);
      if (error) throw error;
      editing.removed.clear();
    }
    const rows = [...editing.rows.values()].map(r => ({
      club_id: myProfile.club_id, match_id: id, player_id: r.player_id, statut: r.statut || null,
      minutes: r.minutes ?? null, buts: r.buts ?? null, passes: r.passes ?? null, note: r.note || null,
      commentaire: (r.commentaire || '').trim() || null,
    }));
    if (rows.length) {
      const { error } = await sb.from('match_players').upsert(rows, { onConflict: 'match_id,player_id' });
      if (error) throw error;
    }
    closeModal('matchModal');
    toast('Match enregistré', 'success');
    await loadMatches();
    if (document.getElementById('playerPick').value) renderPlayerHistory();
  } catch (e) {
    console.error('Match non enregistré', e);
    toast(e.message, 'error');
  } finally { btn.disabled = false; }
}

async function deleteMatch() {
  if (!editing?.id || !confirm(`Supprimer ce match et ses joueurs ?${await trashNote()}`)) return;
  const { data, error } = await sb.from('matches').delete().eq('id', editing.id).select('id');
  if (error || !data?.length) return toast(error?.message || 'Suppression refusée : droits insuffisants.', 'error');
  closeModal('matchModal');
  toast('Match supprimé', 'success');
  await loadMatches();
  if (document.getElementById('playerPick').value) renderPlayerHistory();
}

/* ---------- Par joueur : historique et totaux ---------- */
function renderPlayerPick() {
  const pick = document.getElementById('playerPick');
  const squad = clubPlayers.filter(p => playerInTeam(p, currentTeamId()))
    .sort((a, b) => playerName(a).localeCompare(playerName(b), 'fr'));
  pick.innerHTML = '<option value="">Choisir un joueur…</option>'
    + squad.map(p => `<option value="${p.id}">${escapeHtml(playerName(p))}${p.poste ? ` · ${escapeHtml(p.poste)}` : ''}</option>`).join('');
  const last = pageState().player;
  if (last && squad.some(p => String(p.id) === last)) { pick.value = last; renderPlayerHistory(); }
}

async function renderPlayerHistory() {
  const box = document.getElementById('playerHistory');
  const pid = Number(document.getElementById('playerPick').value);
  if (!pid) { box.innerHTML = ''; return; }
  box.innerHTML = '<p class="text-muted">Chargement…</p>';
  const { data, error } = await sb.from('match_players')
    .select('*, matches(id, adversaire, date_match, competition, lieu, score_pour, score_contre)').eq('player_id', pid);
  if (error) { console.error('Historique du joueur illisible', error); box.innerHTML = `<p class="text-danger">${escapeHtml(error.message)}</p>`; return; }
  const rows = (data || []).filter(r => r.matches)
    .sort((a, b) => String(b.matches.date_match).localeCompare(String(a.matches.date_match)));
  if (!rows.length) { box.innerHTML = '<div class="empty">Aucun match pour ce joueur.</div>'; return; }
  const sum = (k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const count = (k, v) => rows.filter(r => r[k] === v).length;
  const stats = [['Matchs', rows.length], ['Titulaire', count('statut', 'titulaire')], ['Minutes', sum('minutes')],
    ['Buts', sum('buts')], ['Passes', sum('passes')], ['+ / = / −', `${count('note', 'plus')} / ${count('note', 'egal')} / ${count('note', 'moins')}`]];
  box.innerHTML = `<div class="mt-stats">${stats.map(([l, v]) => `<div class="mt-stat"><strong>${v}</strong><span>${l}</span></div>`).join('')}</div>
    <div class="mt-list">${rows.map(r => {
      const m = r.matches;
      const line = [STATUT_MATCH_LABEL[r.statut], r.minutes != null ? `${r.minutes}'` : '',
        r.buts ? `${r.buts} but${r.buts > 1 ? 's' : ''}` : '', r.passes ? `${r.passes} passe${r.passes > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
      return `<button type="button" class="mt-row mt-hist" data-open-match="${m.id}">
        <span class="mt-date">${fmtDateFr(m.date_match)}</span>
        <span class="mt-main"><strong>${escapeHtml(m.adversaire)}</strong><small>${escapeHtml(line || '—')}</small>
          ${r.commentaire ? `<em class="mt-comment">${escapeHtml(r.commentaire)}</em>` : ''}</span>
        ${noteHtml(r.note) || '<span></span>'}
        ${scoreHtml(m)}
      </button>`;
    }).join('')}</div>`;
}
