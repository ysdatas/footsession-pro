/* ============================================================
   LMFC Performance — matchs-page.js
   Retours de match (lmfc_v11.sql) : la rencontre, ses joueurs
   (statut, minutes, buts, passes, + / = / −, commentaire court) ;
   onglet Effectif : les chiffres de chaque joueur de l'équipe, puis
   son historique (match-history.js).
   Tout le staff consulte ; administrateur et coachs saisissent
   (la base refuse les autres). Heure, stade et import du calendrier
   FFF : lmfc_v27.sql, matchs-fff.js. matchs.html?id=… ouvre un match.
   ============================================================ */

// STATUTS_MATCH, LIEUX, resultOf, scoreHtml, noteHtml : match-history.js ; BILAN_NOTES : procedure-time.js.

let myProfile = null;
let CAN_EDIT_MATCH = false;
let matches = [];        // matchs de l'équipe choisie, du plus récent au plus ancien
let clubPlayers = [];    // tout l'effectif du club (noms, recherche)
let editing = null;      // match ouvert : { id, rows: Map(player_id → ligne), removed: Set }
let comp = null;         // compétition choisie (clé mhCompKey, '' = non renseignée, 'dup' = doublons) ; null = toutes
let dups = new Map();    // id → matchs du club à la même date contre le même adversaire (mhDuplicates)

const val = (id) => document.getElementById(id).value.trim();
const playerName = playerFullName;   // app.js
const playerOf = (id) => clubPlayers.find(p => p.id === id);

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
    initFffImport();
  }
  initTabs();
  initEditor();
  document.getElementById('matchList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-match]');
    if (row) openMatch(matches.find(m => m.id === Number(row.dataset.match)));
  });
  document.getElementById('panelPlayer').addEventListener('click', squadClick);
  document.getElementById('mtComps').addEventListener('click', (e) => {
    const b = e.target.closest('[data-comp]');
    if (!b) return;
    comp = b.dataset.all === 'true' ? null : b.dataset.comp;
    savePageState({ comp });
    renderMatches();
    renderSquad();
  });

  await Promise.all([loadPlayers(), loadMatches()]);
  renderSquad();
  openMatchFromUrl();
})();

/* matchs.html?id=… (calendrier, liens) : ouvre ce match, même hors de l'équipe choisie. */
async function openMatchFromUrl() {
  const id = Number(new URLSearchParams(location.search).get('id'));
  if (!id) return;
  const known = matches.find(m => m.id === id);
  if (known) return openMatch(known);
  const { data, error } = await sb.from('matches').select('*').eq('id', id).maybeSingle();
  if (error || !data) return toast(error?.message || 'Match introuvable, ou réservé à une autre équipe.', 'error');
  openMatch(data);
}

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
  // Doublons cherchés dans tout le club (la RLS limite) : un match saisi dans une équipe, importé dans une autre.
  const [{ data, error }, all] = await Promise.all([byTeam(sb.from('matches').select('*, match_players(count)')).order('date_match', { ascending: false }),
    sb.from('matches').select('id, team_id, date_match, adversaire, ext_source')]);
  if (error) {
    console.error('Matchs illisibles (lmfc_v11.sql ?)', error);
    list.innerHTML = '<div class="empty">Les retours de match ne sont pas encore disponibles. Prévenez l’administrateur du club.</div>';
    document.getElementById('matchSub').textContent = '';
    return;
  }
  matches = data || [];
  dups = mhDuplicates(all.data || matches);
  if (comp === null) comp = pageState().comp ?? null;
  renderMatches();
}
/* Matchs affichés (liste et Effectif) : ceux de la compétition choisie, ou les doublons. */
const shownMatches = () => (comp === null ? matches : comp === 'dup' ? matches.filter(m => dups.has(m.id)) : matches.filter(m => mhCompKey(m.competition) === comp));
function renderComps() {
  const list = mhCompetitions(matches), nDup = matches.filter(m => dups.has(m.id)).length;
  if (comp !== null && comp !== 'dup' && !list.some(c => c.key === comp)) comp = null;
  if (comp === 'dup' && !nDup) comp = null;
  const chip = (key, label, n, cls = '') => `<button type="button" class="mt-comp${cls}" data-comp="${key ?? ''}" data-all="${key === null}" aria-pressed="${comp === key}">${escapeHtml(label)} <span>${n}</span></button>`;
  document.getElementById('mtComps').innerHTML = matches.length
    ? chip(null, 'Toutes les compétitions', matches.length) + list.map(c => chip(c.key, c.label, c.n)).join('') + (nDup ? chip('dup', 'Doublons possibles', nDup, ' is-dup') : '') : '';
  const on = document.querySelector('.mt-comp[aria-pressed="true"]'), row = on?.parentElement;   // téléphone : le choix reste visible dans la ligne qui défile
  if (on) row.scrollLeft = on.offsetLeft - row.offsetLeft - 12;
}

/* ---------- Liste des matchs ---------- */
function renderMatches() {
  renderComps();
  const shown = shownMatches(), n = (r) => shown.filter(m => resultOf(m) === r).length;
  const team = currentTeam();
  document.getElementById('matchSub').textContent = [`${shown.length} match${shown.length > 1 ? 's' : ''}`,
    shown.length ? `${n('v')} V · ${n('n')} N · ${n('d')} D` : '', team?.nom].filter(Boolean).join(' · ');
  const dupNote = comp === 'dup' ? '<p class="mt-dup-help">Même date, même adversaire : ouvrez celui à garder (de préférence l’import FFF), puis « Réunir dans ce match ». Tant qu’ils sont deux, un joueur présent dans les deux compte deux matchs.</p>' : '';
  document.getElementById('matchList').innerHTML = shown.length
    ? `${dupNote}<div class="mt-list">${shown.map(m => {
        const twin = dups.get(m.id);
        const players = m.match_players?.[0]?.count;
        const sub = [m.heure?.slice(0, 5), m.competition, LIEUX[m.lieu], !currentTeamId() && teamName(m.team_id)].filter(Boolean).map(escapeHtml).join(' · ');
        return `<button type="button" class="mt-row" data-match="${m.id}">
          <span class="mt-date">${fmtDateFr(m.date_match)}</span>
          <span class="mt-main"><strong>${escapeHtml(m.adversaire)}${twin ? ` <span class="mt-dup" title="${escapeHtml(`Même date et même adversaire : ${twin.map(t => `${t.adversaire}${teamName(t.team_id) ? ` (${teamName(t.team_id)})` : ''}`).join(', ')}`)}">Doublon ?</span>` : ''}</strong>${sub ? `<small>${sub}</small>` : ''}</span>
          <span class="mt-count">${players ? `${players} joueur${players > 1 ? 's' : ''}` : ''}</span>
          ${scoreHtml(m)}
        </button>`;
      }).join('')}</div>`
    : `<div class="empty">Aucun match enregistré.${CAN_EDIT_MATCH ? '<br>Cliquez sur « + Nouveau match ».' : ''}</div>`;
}

/* ---------- Saisie d'un match ---------- */
/* Droit de modifier CE match (lmfc_v19.sql, la base décide aussi) : admin,
   créateur, coach de l'équipe du match ; club sans équipe : tout coach. */
function canEditMatch(m) {
  if (!CAN_EDIT_MATCH) return false;
  if (!m || myProfile.role === 'admin' || m.created_by === myProfile.id) return true;
  const mine = myProfile.team_ids || [];
  return m.team_id ? mine.includes(m.team_id) : !(window.CLUB_TEAMS || []).length;
}
async function openMatch(m) {
  editing = { id: m?.id || null, rows: new Map(), removed: new Set(), editable: canEditMatch(m) };
  const set = (id, v) => { document.getElementById(id).value = v ?? ''; };
  set('m-adv', m?.adversaire); set('m-date', m?.date_match || new Date().toISOString().slice(0, 10));
  set('m-heure', m?.heure?.slice(0, 5)); set('m-stade', m?.stade);
  set('m-comp', m?.competition); set('m-lieu', m?.lieu); set('m-pour', m?.score_pour); set('m-contre', m?.score_contre);
  const ext = document.getElementById('m-ext');
  ext.textContent = m?.ext_source === 'fff' ? `Importé de la FFF${m.ext_data?.journee ? ` (${m.ext_data.journee})` : ''}`
    + `${m.ext_synced_at ? ` le ${fmtDateFr(m.ext_synced_at)}` : ''}. Ce que vous modifiez ici n’est plus remplacé par l’import.` : '';
  ext.classList.toggle('hidden', !ext.textContent);
  const dup = document.getElementById('m-dup'), twins = (m && editing.editable && dups.get(m.id)) || [];
  dup.innerHTML = mergeBannerHtml(m, twins);   // match-merge.js
  dup.classList.toggle('hidden', !twins.length);
  set('m-infos', m?.infos); set('m-comment', m?.commentaire); set('m-retenir', m?.a_retenir);
  const teams = window.CLUB_TEAMS || [];
  document.getElementById('m-team-field').classList.toggle('hidden', !teams.length);
  // Un coach ne range un match que dans ses équipes (sauf celui déjà ouvert).
  const mine = myProfile.role === 'admin' || !(myProfile.team_ids || []).length ? teams
    : teams.filter(t => myProfile.team_ids.includes(t.id) || t.id === m?.team_id);
  document.getElementById('m-team').innerHTML = '<option value="">Sans équipe</option>'
    + mine.map(t => `<option value="${t.id}">${escapeHtml(t.nom)}</option>`).join('');
  set('m-team', m ? m.team_id : currentTeamId());
  document.getElementById('matchModalTitle').textContent = !m ? 'Nouveau match' : editing.editable ? 'Modifier le match' : `${m.adversaire} · ${fmtDateFr(m.date_match)}`;
  // Lecture seule (préparateur, match d'une autre équipe) : tout se lit, rien ne s'enregistre.
  document.querySelectorAll('#matchModal input, #matchModal select, #matchModal textarea').forEach(f => { f.disabled = !editing.editable; });
  ['mpTools', 'm-save'].forEach(id => document.getElementById(id).classList.toggle('hidden', !editing.editable));
  document.getElementById('m-delete').classList.toggle('hidden', !(m && editing.editable));
  document.getElementById('m-cancel').textContent = editing.editable ? 'Annuler' : 'Fermer';
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
  const dis = editing.editable ? '' : 'disabled';
  const rank = { titulaire: 0, remplacant: 1, non_entre: 2 };
  const rows = [...editing.rows.values()].sort((a, b) => (rank[a.statut] ?? 3) - (rank[b.statut] ?? 3)
    || playerName(playerOf(a.player_id)).localeCompare(playerName(playerOf(b.player_id)), 'fr'));
  document.getElementById('mpCount').textContent = rows.length ? `· ${rows.length}` : '';
  const num = (r, k, max, unit) => `<label class="mp-num"><input data-k="${k}" type="number" min="0" max="${max}" inputmode="numeric" value="${r[k] ?? ''}" ${dis}><span>${unit}</span></label>`;
  document.getElementById('mpList').innerHTML = rows.length ? rows.map(r => {
    const name = playerName(playerOf(r.player_id));
    return `<div class="mp-row" data-player="${r.player_id}">
      <span class="mp-name">${playerLink(r.player_id, name, ' target="_blank" rel="noopener" title="Fiche du joueur (nouvel onglet)"')}${r.ext_data
        ? ` <span class="fff-st${mpEdited(r) ? ' is-warn' : ''}" title="Lu sur la feuille de match FFF">${mpEdited(r) ? 'FFF · modifié' : 'FFF'}</span>` : ''}</span>
      <select data-k="statut" aria-label="Statut de ${escapeHtml(name)}" ${dis}><option value="">—</option>${STATUTS_MATCH.map(([k, l]) => `<option value="${k}"${r.statut === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      ${num(r, 'minutes', 130, 'min')}${num(r, 'buts', 20, 'buts')}${num(r, 'passes', 20, 'passes')}${num(r, 'cartons_jaunes', 2, 'jaune')}
      <label class="mp-red"><input type="checkbox" data-k="carton_rouge"${r.carton_rouge ? ' checked' : ''} ${dis}><span>rouge</span></label>
      <span class="bilan-notes" role="group" aria-label="Note de ${escapeHtml(name)}">${BILAN_NOTES.map(n =>
        `<button type="button" class="bn bn-${n.key}" data-note="${n.key}" aria-pressed="${r.note === n.key}" title="${n.label}" ${dis}>${n.sign}</button>`).join('')}</span>
      <input class="mp-comment" data-k="commentaire" maxlength="500" value="${escapeHtml(r.commentaire || '')}" placeholder="Commentaire" aria-label="Commentaire sur ${escapeHtml(name)}" ${dis}>
      ${editing.editable ? `<button class="att-remove" type="button" data-remove aria-label="Retirer ${escapeHtml(name)} du match" title="Retirer du match">✕</button>` : ''}
    </div>`;
  }).join('') : `<p class="text-muted">Aucun joueur.${editing.editable ? ' « Ajouter l’effectif » ou cherchez un joueur du club.' : ''}</p>`;
}

/* Ligne préremplie par la feuille de match (lmfc_v33.sql) puis corrigée à la main. */
const mpEdited = (r) => ['statut', 'minutes', 'buts', 'cartons_jaunes', 'carton_rouge'].some(k => k in r.ext_data && (r[k] ?? null) !== (r.ext_data[k] ?? null));
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
    else if (k === 'carton_rouge') r[k] = e.target.checked;
    else r[k] = e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value)));
  });
  list.addEventListener('click', (e) => {
    const r = rowOf(e);
    if (!r || !editing.editable) return;
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
  document.getElementById('m-dup').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-merge]');
    if (!b || !confirm('Réunir l’autre match dans celui-ci ?\n\nSes joueurs absents d’ici y sont ajoutés ; pour ceux présents dans les deux, les cases vides d’ici sont complétées, comme le score ou la compétition. Puis l’autre match est supprimé (corbeille). Les modifications non enregistrées de cette fenêtre sont perdues.')) return;
    b.disabled = true;
    try {
      const r = await mergeMatches(editing.id, Number(b.dataset.merge));
      toast(`Matchs réunis : ${r.added} joueur${r.added > 1 ? 's' : ''} ajouté${r.added > 1 ? 's' : ''}, ${r.completed} ligne${r.completed > 1 ? 's' : ''} complétée${r.completed > 1 ? 's' : ''}.`, 'success');
      await loadMatches();
      renderSquad();
      const { data } = await sb.from('matches').select('*').eq('id', editing.id).single();
      if (data) openMatch(data);
    } catch (err) {
      console.error('Réunion des matchs', err);
      toast(err.message, 'error');
      b.disabled = false;
    }
  });
}

async function saveMatch() {
  const adversaire = val('m-adv'), date_match = val('m-date');
  if (!adversaire || !date_match) return toast('Adversaire et date sont obligatoires.', 'error');
  const score = (id) => (val(id) === '' ? null : Math.max(0, Math.round(Number(val(id)))));
  const row = {
    adversaire, date_match, heure: val('m-heure') || null, stade: val('m-stade') || null,
    competition: val('m-comp') || null, lieu: val('m-lieu') || null,
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
    // Cartons et feuille de match (lmfc_v33.sql) : envoyés seulement s'ils servent, la fiche reste utilisable sans la migration.
    const v33 = [...editing.rows.values()].some(r => r.cartons_jaunes != null || r.carton_rouge || r.ext_data);
    const rows = [...editing.rows.values()].map(r => ({
      club_id: myProfile.club_id, match_id: id, player_id: r.player_id, statut: r.statut || null,
      minutes: r.minutes ?? null, buts: r.buts ?? null, passes: r.passes ?? null, note: r.note || null,
      commentaire: (r.commentaire || '').trim() || null,
      ...(v33 ? { cartons_jaunes: r.cartons_jaunes ?? null, carton_rouge: r.carton_rouge ?? null, ext_data: r.ext_data ?? null } : {}),
    }));
    if (rows.length) {
      const { error } = await sb.from('match_players').upsert(rows, { onConflict: 'match_id,player_id' });
      if (error) throw error;
    }
    closeModal('matchModal');
    toast('Match enregistré', 'success');
    await loadMatches();
    renderSquad();
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
  renderSquad();
}

/* ---------- Par joueur : historique et totaux ---------- */
/* ---------- Effectif : chiffres de chaque joueur sur les matchs de l'équipe, puis son historique ---------- */
const SQUAD = { rows: [], sort: 'played', seq: 0 };
async function renderSquad() {
  const box = document.getElementById('squad'), seq = ++SQUAD.seq, ids = shownMatches().map(m => m.id);   // la compétition choisie
  box.innerHTML = '<p class="text-muted">Chargement…</p>';
  const { data, error } = ids.length ? await sb.from('match_players').select('*').in('match_id', ids) : { data: [] };
  if (seq !== SQUAD.seq) return;
  if (error) { console.error('Effectif des matchs illisible', error); box.innerHTML = `<p class="text-danger">${escapeHtml(error.message)}</p>`; return; }
  SQUAD.rows = data || [];
  drawSquad();
  const last = Number(pageState().player);
  if (last && clubPlayers.some(p => p.id === last)) showPlayerHistory(last);
}
function drawSquad() {
  const seen = new Set(SQUAD.rows.map(r => r.player_id));
  // L'effectif de l'équipe, et les joueurs d'autres équipes alignés sur ses matchs.
  const players = clubPlayers.filter(p => playerInTeam(p, currentTeamId()) || seen.has(p.id));
  document.getElementById('squad').innerHTML = players.length ? mhSquadHtml(players, matchSquad(SQUAD.rows), SQUAD.sort) : '<div class="empty">Aucun joueur dans cette équipe.</div>';
}
async function showPlayerHistory(pid) {
  const box = document.getElementById('playerHistory');
  savePageState({ player: pid ? String(pid) : '' });
  document.getElementById('squad').hidden = !!pid;
  box.hidden = !pid;
  if (!pid) return;
  box.innerHTML = '<p class="text-muted">Chargement…</p>';
  try {
    const rows = await loadPlayerMatchRows(pid);
    box.innerHTML = `<div class="mh-head"><button type="button" class="btn btn-sm" data-mh-back>← Effectif</button>
      <h2 class="as-h3">${escapeHtml(playerName(playerOf(pid)))}</h2>${playerLink(pid, 'Fiche du joueur →')}</div>${mhHistoryHtml(rows)}`;
  } catch (e) { console.error('Historique du joueur illisible', e); box.innerHTML = `<p class="text-danger">${escapeHtml(e.message)}</p>`; }
}
async function squadClick(e) {
  const sort = e.target.closest('[data-mh-sort]'), who = e.target.closest('[data-mh-player]'), match = e.target.closest('[data-open-match]');
  if (sort) { SQUAD.sort = sort.dataset.mhSort; drawSquad(); document.querySelector(`[data-mh-sort="${SQUAD.sort}"]`)?.focus(); }
  if (who) showPlayerHistory(Number(who.dataset.mhPlayer));
  if (e.target.closest('[data-mh-back]')) { showPlayerHistory(null); document.getElementById('tabPlayer').focus(); }
  if (match) {
    const { data, error } = await sb.from('matches').select('*').eq('id', Number(match.dataset.openMatch)).single();
    if (error) return toast(error.message, 'error');
    openMatch(data);
  }
}
