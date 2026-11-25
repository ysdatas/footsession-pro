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
let allMatches = [];     // tous les matchs lisibles du club : doublons, et comparaison avant d'enregistrer
let distinctPairs = new Set();   // paires déclarées « Ce n'est pas un doublon » (lmfc_v53.sql, mhPairKey)
const dupOpts = () => ({ teamNameOf: teamName, distinct: distinctPairs });
/* Mode sélection (administrateur, coachs) : plusieurs matchs d'un coup ; Maj + clic
   prend une plage (pickRange). Seuls les matchs affichés (filtre) comptent. */
const pick = { on: false, ids: new Set(), anchor: null };

const val = (id) => document.getElementById(id).value.trim();
const playerName = playerFullName;   // app.js
const playerOf = (id) => clubPlayers.find(p => p.id === id);

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  myProfile = ctx.profile;
  CAN_EDIT_MATCH = canEditTeamContent(myProfile.role);
  document.getElementById('uName').textContent = myProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[myProfile.role] || myProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (myProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  if (CAN_EDIT_MATCH) {
    const btn = document.getElementById('btnNewMatch');
    btn.classList.remove('hidden');
    btn.addEventListener('click', () => openMatch(null));
    initFffImport();
    const sel = document.getElementById('btnSelectMatches');
    sel.classList.remove('hidden');
    sel.addEventListener('click', () => setPick(!pick.on));
    document.getElementById('matchBulk').addEventListener('click', matchBulkClick);
  }
  initTabs();
  initEditor();
  document.getElementById('matchList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-match]');
    if (!row) return;
    if (pick.on) return pickMatch(Number(row.dataset.match), e.shiftKey);
    openMatch(matches.find(m => m.id === Number(row.dataset.match)));
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

/* matchs.html?id=… (calendrier, liens, « Retour au match ») : ouvre ce match, même hors de l'équipe
   choisie. Le lien sert une fois (takeUrlParam, app.js) : fermée, la fenêtre ne se rouvre plus seule. */
async function openMatchFromUrl() {
  const id = Number(takeUrlParam('id'));
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
  const { data, error } = await sb.from('players').select('id, nom, prenom, numero, poste, team_id, other_team_ids, date_naissance, exterieur, origine').order('nom');
  if (error) { console.error('Effectif indisponible', error); toast(error.message, 'error'); return; }
  clubPlayers = data || [];
}

async function loadMatches() {
  const list = document.getElementById('matchList');
  // Doublons cherchés dans tout le club (la RLS limite) : un match saisi dans une équipe, importé dans une autre.
  const [{ data, error }, all, decided] = await Promise.all([byTeam(sb.from('matches').select('*, match_players(count)')).order('date_match', { ascending: false }),
    sb.from('matches').select('id, team_id, date_match, heure, adversaire, competition, lieu, score_pour, score_contre, ext_source'),
    sb.from('match_not_duplicates').select('match_a, match_b')]);   // lmfc_v53.sql ; sans elle, aucune décision
  if (error) {
    console.error('Matchs illisibles (lmfc_v11.sql ?)', error);
    list.innerHTML = '<div class="empty">Les retours de match ne sont pas encore disponibles. Prévenez l’administrateur du club.</div>';
    document.getElementById('matchSub').textContent = '';
    return;
  }
  matches = data || [];
  allMatches = all.data || matches;
  if (decided.error) console.warn('Décisions « pas un doublon » non lues (lmfc_v53.sql ?)', decided.error.message);
  distinctPairs = new Set((decided.data || []).map(d => mhPairKey(d.match_a, d.match_b)));
  dups = mhDuplicates(allMatches, dupOpts());
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
  renderMatchBulk();
  const shown = shownMatches(), n = (r) => shown.filter(m => resultOf(m) === r).length;
  const team = currentTeam();
  document.getElementById('matchSub').textContent = [`${shown.length} match${shown.length > 1 ? 's' : ''}`,
    shown.length ? `${n('v')} V – ${n('n')} N – ${n('d')} D` : '', team?.nom].filter(Boolean).join(' – ');
  const dupNote = comp === 'dup' ? '<p class="mt-dup-help">Même date, même adversaire : ouvrez celui à garder (de préférence l’import FFF), puis « Réunir dans ce match ». Tant qu’ils sont deux, un joueur présent dans les deux compte deux matchs.</p>' : '';
  document.getElementById('matchList').innerHTML = shown.length
    ? `${dupNote}<div class="mt-list">${shown.map(m => {
        const twin = dups.get(m.id);
        const players = (m.match_players?.[0]?.count || 0) + (m.hors_plateforme?.length || 0);
        const sub = [m.heure?.slice(0, 5), m.competition, LIEUX[m.lieu], !currentTeamId() && teamName(m.team_id)].filter(Boolean).map(escapeHtml).join(' – ');
        const on = pick.ids.has(m.id);
        return `<button type="button" class="mt-row${pick.on ? ` is-selectable${on ? ' is-picked' : ''}` : ''}" data-match="${m.id}"${pick.on ? ` role="checkbox" aria-checked="${on}"` : ''}>
          ${pick.on ? selCheckHtml(on) : ''}<span class="mt-date">${fmtDateFr(m.date_match)}</span>
          <span class="mt-main"><strong>${escapeHtml(m.adversaire)}${twin ? ` <span class="mt-dup" title="${escapeHtml(`Même date et même adversaire : ${twin.map(t => `${t.adversaire}${teamName(t.team_id) ? ` (${teamName(t.team_id)})` : ''}`).join(', ')}`)}">Doublon ?</span>` : ''}</strong>${sub ? `<small>${sub}</small>` : ''}</span>
          <span class="mt-count">${players ? `${players} joueur${players > 1 ? 's' : ''}` : ''}</span>
          ${scoreHtml(m)}
        </button>`;
      }).join('')}</div>`
    : `<div class="empty">Aucun match enregistré.${CAN_EDIT_MATCH ? '<br>Cliquez sur « + Nouveau match ».' : ''}</div>`;
}

/* ---------- Sélection : modifier ou supprimer plusieurs matchs ---------- */
const MATCH_NOUN = ['match', 'matchs', false];
const matchLabel = (m) => `${m.adversaire} (${fmtDateFr(m.date_match)})`;
const pickedMatches = () => shownMatches().filter(m => pick.ids.has(m.id));
function setPick(on) {
  Object.assign(pick, { on, ids: new Set(), anchor: null });
  const btn = document.getElementById('btnSelectMatches');
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.toggle('active', on);
  renderMatches();
}
function renderMatchBulk() {
  document.getElementById('matchBulk').innerHTML = !pick.on ? '' : bulkBarHtml({
    n: pickedMatches().length, total: shownMatches().length, noun: MATCH_NOUN,
    actions: [{ key: 'edit', label: 'Modifier', primary: true }, { key: 'delete', label: 'Supprimer', danger: true }] });
}
/* Clic : coche ou décoche ; Maj + clic : toute la plage depuis le clic précédent. */
function pickMatch(id, range) {
  if (range && pick.anchor !== null) pickRange(shownMatches().map(m => m.id), pick.anchor, id).forEach(x => pick.ids.add(x));
  else if (pick.ids.has(id)) pick.ids.delete(id);
  else pick.ids.add(id);
  pick.anchor = id;
  renderMatches();
  document.querySelector(`.mt-row[data-match="${id}"]`)?.focus();
}
function matchBulkClick(e) {
  const act = e.target.closest('[data-bulk]')?.dataset.bulk;
  if (act === 'all') shownMatches().forEach(m => pick.ids.add(m.id));
  else if (act === 'none') pick.ids.clear();
  else if (act === 'done') return setPick(false);
  else if (act === 'edit') return editPickedMatches(pickedMatches());
  else if (act === 'delete') return deletePickedMatches(pickedMatches());
  else return;
  renderMatches();
}
/* Une seule requête pour tous ; la base garde les droits match par match (RLS). */
async function editPickedMatches(list) {
  if (!list.length) return;
  const teams = window.CLUB_TEAMS || [];
  const mine = myProfile.role === 'admin' || !(myProfile.team_ids || []).length ? teams : teams.filter(t => myProfile.team_ids.includes(t.id));
  const fields = [{ key: 'competition', label: 'Compétition', list: [...new Set(matches.map(m => m.competition).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')) }];
  if (teams.length) fields.push({ key: 'team_id', label: 'Équipe', options: [['', 'Sans équipe'], ...mine.map(t => [t.id, t.nom])], parse: (v) => Number(v) || null });
  fields.push({ key: 'lieu', label: 'Lieu', options: [['', 'Non renseigné'], ...Object.entries(LIEUX)], parse: (v) => v || null });
  const patch = await bulkEditDialog({ noun: MATCH_NOUN, rows: list, names: list.map(matchLabel), fields,
    blocked: list.filter(m => !canEditMatch(m)).map(matchLabel) });
  if (!patch) return;
  try {
    const { data, error } = await sb.from('matches').update(patch).in('id', list.map(m => m.id)).select('id');
    if (error) throw error;
    bulkReport(data?.length || 0, list.length, MATCH_NOUN, 'modifié');
    await loadMatches();
    renderSquad();
  } catch (err) {
    console.error('Matchs non modifiés', err);
    toast(err.message, 'error');
  }
}
async function deletePickedMatches(list) {
  if (!list.length || !await confirmDialog(`Supprimer ${list.length > 1 ? `ces ${list.length} matchs` : 'ce match'} et leurs joueurs ?\n\n${namesList(list.map(matchLabel))}${await trashNote()}`)) return;
  const { data, error } = await sb.from('matches').delete().in('id', list.map(m => m.id)).select('id');
  if (error) { console.error('Matchs non supprimés', error); return toast(error.message, 'error'); }
  bulkReport(data?.length || 0, list.length, MATCH_NOUN, 'supprimé');
  pick.ids.clear();
  await loadMatches();
  renderSquad();
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
  editing = { id: m?.id || null, orig: m || null, rows: new Map(), removed: new Set(), editable: canEditMatch(m),
    extras: [...(m?.hors_plateforme || [])], hadExtras: !!m?.hors_plateforme?.length };   // hors plateforme (lmfc_v37.sql)
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
  document.getElementById('matchModalTitle').textContent = !m ? 'Nouveau match' : editing.editable ? 'Modifier le match' : `${m.adversaire} – ${fmtDateFr(m.date_match)}`;
  // Lecture seule (préparateur, match d'une autre équipe) : tout se lit, rien ne s'enregistre.
  document.querySelectorAll('#matchModal input, #matchModal select, #matchModal textarea').forEach(f => { f.disabled = !editing.editable; });
  ['mpTools', 'm-save'].forEach(id => document.getElementById(id).classList.toggle('hidden', !editing.editable));
  document.getElementById('m-delete').classList.toggle('hidden', !(m && editing.editable));
  document.getElementById('m-cancel').textContent = editing.editable ? 'Annuler' : 'Fermer';
  document.getElementById('mpList').innerHTML = m ? '<p class="text-muted">Chargement…</p>' : '';
  renderFeedback(null);
  openModal('matchModal');
  if (m) {
    const [{ data, error }, fb] = await Promise.all([
      sb.from('match_players').select('*').eq('match_id', m.id),
      sb.from('match_feedback').select('player_id, individuel, collectif, updated_at').eq('match_id', m.id),
    ]);
    if (error) { console.error('Joueurs du match illisibles', error); toast(error.message, 'error'); }
    (data || []).forEach(r => editing.rows.set(r.player_id, r));
    renderFeedback(fb);
  }
  renderRows();
  mvShow(m);   // vidéo du match et import Sportscode (match-video.js)
  editing.snap = matchSnapshot();
  // Relances (lmfc_v59.sql) : match enregistré, déjà joué, staff qui relance.
  document.getElementById('mRemind').classList.toggle('hidden', !(m?.id && m.date_match <= new Date().toISOString().slice(0, 10)
    && ['admin', 'coach', 'prepa', 'analyste'].includes(myProfile.role)));   // fiche d'un joueur ouverte depuis ce match : rien de non enregistré ne doit se perdre
}

/* Lien vers la fiche d'un joueur depuis le match (lot 2.4) : sa fiche propose « Retour au match ».
   Match modifié et pas encore enregistré : la fiche s'ouvre dans un nouvel onglet, rien ne se perd. */
const matchBack = () => (editing?.id ? `matchs?id=${editing.id}` : 'matchs');
const matchSnapshot = () => JSON.stringify([
  [...document.querySelectorAll('#matchModal input:not([type="search"]), #matchModal select, #matchModal textarea')].map(f => (f.type === 'checkbox' ? f.checked : f.value)),
  [...editing.rows.values()], editing.extras, [...editing.removed]]);
/* Relancer (remind-ui.js) : les joueurs de la feuille et de l'équipe ; la base garde ceux qui doivent encore répondre. */
document.getElementById('mRemind').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remind]');
  if (!b || !editing?.id) return;
  const team = Number(val('m-team')) || null, ids = new Set([...editing.rows.keys(), ...clubPlayers.filter(p => team && playerInTeam(p, team)).map(p => p.id)]);
  openRemindDialog({ kind: b.dataset.remind, id: editing.id, label: `${val('m-adv')} – ${fmtDateFr(val('m-date'))}`,
    players: [...ids].map(id => ({ id, name: playerName(playerOf(id)) })) });
});
document.getElementById('matchModal').addEventListener('click', (e) => {
  const a = e.target.closest('a.player-link');
  if (!a || e.metaKey || e.ctrlKey || !editing || editing.snap === matchSnapshot()) return;
  e.preventDefault();
  window.open(a.href, '_blank', 'noopener');
  toast('Le match a des modifications non enregistrées : la fiche s’ouvre dans un nouvel onglet.', 'info');
});

/* Avis des joueurs (lmfc_v36.sql), en lecture : ceux que la base laisse voir (joueurs suivis). */
function renderFeedback(res) {
  if (res?.error && !['42P01', 'PGRST205'].includes(res.error.code)) console.warn('Avis des joueurs illisibles', res.error.message);
  const name = (f) => playerName(playerOf(f.player_id)) || 'Joueur';
  const list = (res?.data || []).filter(f => f.individuel || f.collectif).sort((a, b) => name(a).localeCompare(name(b), 'fr'));
  document.getElementById('mfStaff').classList.toggle('hidden', !list.length);
  document.getElementById('mfCount').textContent = list.length ? `(${list.length})` : '';
  document.getElementById('mfList').innerHTML = list.map(f => `<article class="mf-item">
      <p class="mf-who"><strong>${playerLink(f.player_id, name(f), '', matchBack())}</strong> <small>${escapeHtml(fmtDateFr(f.updated_at.slice(0, 10)))}</small></p>
      ${f.individuel ? `<p class="mf-q">Sa performance</p><p class="mf-a">${escapeHtml(f.individuel)}</p>` : ''}
      ${f.collectif ? `<p class="mf-q">L’équipe</p><p class="mf-a">${escapeHtml(f.collectif)}</p>` : ''}
    </article>`).join('');
}

/* Joueurs du match : titulaires, remplaçants, non entrés, puis sans statut. */
function renderRows() {
  const dis = editing.editable ? '' : 'disabled';
  const rank = { titulaire: 0, remplacant: 1, non_entre: 2 };
  const rows = [...editing.rows.values()].sort((a, b) => (rank[a.statut] ?? 3) - (rank[b.statut] ?? 3)
    || playerName(playerOf(a.player_id)).localeCompare(playerName(playerOf(b.player_id)), 'fr'));
  const n = rows.length + editing.extras.length;
  document.getElementById('mpCount').textContent = n ? `· ${n}` : '';
  const num = (r, k, max, unit) => `<label class="mp-num"><input data-k="${k}" type="number" min="0" max="${max}" inputmode="numeric" value="${r[k] ?? ''}" ${dis}><span>${unit}</span></label>`;
  // En-tête des colonnes (grand écran) : chaque champ garde aussi son libellé pour les lecteurs d'écran et le téléphone.
  const head = `<div class="mp-head" aria-hidden="true"><span>Joueur</span><span>Statut</span><span>Min</span><span>Buts</span><span>Passes</span>
    <span>Jaune</span><span>Rouge</span><span>Note</span><span>Commentaire</span><span></span></div>`;
  document.getElementById('mpList').innerHTML = rows.length ? head + rows.map(r => {
    const name = playerName(playerOf(r.player_id));
    return `<div class="mp-row" data-player="${r.player_id}">
      <span class="mp-name">${playerLink(r.player_id, name, ` title="${escapeHtml(name)} – fiche du joueur"`, matchBack())}${playerOf(r.player_id)?.exterieur
        ? `<span class="mp-src" title="${escapeHtml(extTeamLabel(playerOf(r.player_id)))}">Extérieur</span>` : ''}${mpSrcHtml(r)}</span>
      <select data-k="statut" aria-label="Statut de ${escapeHtml(name)}" ${dis}><option value="">—</option>${STATUTS_MATCH.map(([k, l]) => `<option value="${k}"${r.statut === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      ${num(r, 'minutes', 130, 'min')}${num(r, 'buts', 20, 'buts')}${num(r, 'passes', 20, 'passes')}${num(r, 'cartons_jaunes', 2, 'jaune')}
      <label class="mp-red"><input type="checkbox" data-k="carton_rouge"${r.carton_rouge ? ' checked' : ''} ${dis}><span>rouge</span></label>
      <span class="bilan-notes" role="group" aria-label="Note de ${escapeHtml(name)}">${BILAN_NOTES.map(n =>
        `<button type="button" class="bn bn-${n.key}" data-note="${n.key}" aria-pressed="${r.note === n.key}" title="${n.label}" ${dis}>${n.sign}</button>`).join('')}</span>
      <input class="mp-comment" data-k="commentaire" maxlength="500" value="${escapeHtml(r.commentaire || '')}" placeholder="Commentaire" aria-label="Commentaire sur ${escapeHtml(name)}" ${dis}>
      ${editing.editable ? `<button class="att-remove" type="button" data-remove aria-label="Retirer ${escapeHtml(name)} du match" title="Retirer du match">✕</button>` : ''}
    </div>`;
  }).join('') : editing.extras.length ? '' : `<p class="text-muted">Aucun joueur.${editing.editable ? ' « Ajouter l’effectif » ou cherchez un joueur du club.' : ''}</p>`;
  // Hors plateforme (feuille de match) : sur ce match seulement, sans fiche ni statistiques.
  document.getElementById('mpList').insertAdjacentHTML('beforeend', editing.extras.map((x, i) => `<div class="mp-extra-row">
      <span class="mp-name">${escapeHtml(x.nom)} <span class="fff-st is-warn" title="Sans fiche : sur la feuille de ce match seulement, dans aucune statistique">Hors plateforme</span></span>
      <span class="mp-extra">${escapeHtml([STATUT_MATCH_LABEL[x.statut], x.minutes != null && `${x.minutes} min`, x.buts && `${x.buts} but${x.buts > 1 ? 's' : ''}`,
        x.cartons_jaunes && `${x.cartons_jaunes} jaune`, x.carton_rouge && 'rouge'].filter(Boolean).join(' – ') || '—')}</span>
      ${editing.editable ? `<button class="btn btn-sm" type="button" data-extra-fiche="${i}" title="Lui créer une fiche de joueur extérieur (ou retrouver la sienne) : ce match comptera dans ses statistiques">Créer sa fiche</button>
        <button class="att-remove" type="button" data-remove-extra="${i}" aria-label="Retirer ${escapeHtml(x.nom)} du match" title="Retirer du match">✕</button>` : ''}
    </div>`).join(''));
}

function addRow(id) {
  if (editing.rows.has(id)) return;
  editing.removed.delete(id);
  editing.rows.set(id, { player_id: id, statut: null, minutes: null, buts: null, passes: null, note: null, commentaire: '' });
}

/* Joueur hors plateforme (lmfc_v37.sql) → fiche de joueur extérieur (lmfc_v54.sql), retrouvée ou créée :
   sa ligne du match garde statut, minutes, buts et cartons, et compte désormais dans ses statistiques. */
async function extraToFiche(i) {
  const x = editing.extras[i];
  const p = await newExterieur(x.nom, clubPlayers);   // player-exterieur.js
  if (!p) return;
  if (!clubPlayers.some(c => c.id === p.id)) clubPlayers.push(p);
  if (editing.rows.has(p.id)) return toast(`${playerName(p)} est déjà sur la feuille de ce match.`, 'error');
  addRow(p.id);
  Object.assign(editing.rows.get(p.id), { statut: x.statut || null, minutes: x.minutes ?? null, buts: x.buts ?? null,
    cartons_jaunes: x.cartons_jaunes ?? null, carton_rouge: x.carton_rouge ?? null });
  editing.extras.splice(i, 1);
  renderRows();
  toast('Ligne reprise sur sa fiche : enregistrez le match.', 'success');
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
    if (r.ext_data) e.target.closest('.mp-row')?.querySelector('.mp-src.is-fff')?.replaceWith(mpSrcNode(r));   // « modifié » suit la saisie
  });
  list.addEventListener('click', (e) => {
    const x = e.target.closest('[data-remove-extra]');
    if (x && editing.editable) { editing.extras.splice(Number(x.dataset.removeExtra), 1); return renderRows(); }
    const f = e.target.closest('[data-extra-fiche]');
    if (f && editing.editable) return extraToFiche(Number(f.dataset.extraFiche));
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
    const q = search.value.trim();
    results.innerHTML = (list.map(p => `<button type="button" class="guest-hit" data-add="${p.id}">
        <strong>${escapeHtml(playerName(p))}</strong><span>${escapeHtml(extTeamLabel(p))}${p.numero != null ? ` | #${p.numero}` : ''}</span></button>`).join('')
      || (q.length >= 2 ? '<p class="text-muted guest-none">Aucun joueur du club ne correspond.</p>' : ''))
      + (q.length >= 2 && editing.editable ? `<button type="button" class="guest-hit guest-new" data-new-ext><strong>+ Joueur extérieur</strong><span>« ${escapeHtml(q)} » n’a pas de fiche au club</span></button>` : '');
  };
  search.addEventListener('input', renderResults);
  results.addEventListener('click', async (e) => {
    if (e.target.closest('[data-new-ext]')) {
      const p = await newExterieur(search.value, clubPlayers);   // player-exterieur.js (lmfc_v54.sql)
      if (!p) return;
      if (!clubPlayers.some(x => x.id === p.id)) clubPlayers.push(p);
      addRow(p.id);
      search.value = '';
      renderResults();
      return renderRows();
    }
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
    // Garder les deux : l'alerte se retire pour cette fois ; elle reviendra.
    const keep = e.target.closest('[data-dup-keep]');
    if (keep) { keep.closest('.dup-item').remove(); if (!document.querySelector('#m-dup .dup-item')) document.getElementById('m-dup').classList.add('hidden'); return; }
    const distinct = e.target.closest('[data-dup-distinct]');
    if (distinct) {
      distinct.disabled = true;
      try {
        await markNotDuplicate(editing.id, [Number(distinct.dataset.dupDistinct)]);   // match-merge.js
        toast('Noté : ce ne sont pas des doublons. L’alerte ne reviendra plus.', 'success');
        await loadMatches();
        const { data } = await sb.from('matches').select('*').eq('id', editing.id).single();
        if (data) openMatch(data);
      } catch (err) { toast(err.message, 'error'); distinct.disabled = false; }
      return;
    }
    const b = e.target.closest('[data-merge]');
    if (!b || !await confirmDialog('Réunir l’autre match dans celui-ci ?\n\nSes joueurs absents d’ici y sont ajoutés ; pour ceux présents dans les deux, les cases vides d’ici sont complétées, comme le score ou la compétition. Puis l’autre match est supprimé (corbeille). Les modifications non enregistrées de cette fenêtre sont perdues.')) return;
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
  if (editing.extras.length || editing.hadExtras) row.hors_plateforme = editing.extras;   // envoyé s'il sert (lmfc_v37.sql)
  // Doublon possible (nouveau match, ou date, adversaire, équipe, compétition changés) : comparer et choisir avant d'enregistrer.
  const o = editing.orig, team = 'team_id' in row ? row.team_id : o?.team_id ?? null;
  let distinctFrom = [];
  if (!o || ['date_match', 'adversaire', 'competition'].some(k => (row[k] || null) !== (o[k] || null)) || team !== (o.team_id ?? null)) {
    const twins = mhTwins({ ...row, id: editing.id, team_id: team }, allMatches, dupOpts());
    if (twins.length) {
      const choice = await dupDialog({ ...row, team_id: team }, twins);   // match-merge.js
      if (!choice) return;
      if (choice === 'open') {
        const { data } = await sb.from('matches').select('*').eq('id', twins[0].id).single();
        return data ? openMatch(data) : toast('Match introuvable.', 'error');
      }
      if (choice === 'distinct') distinctFrom = twins.map(t => t.id);
    }
  }
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
    if (distinctFrom.length) await markNotDuplicate(id, distinctFrom).catch(e => toast(`Match enregistré, mais la décision « pas un doublon » ne l’est pas : ${e.message}`, 'error'));
    closeModal('matchModal');
    toast('Match enregistré', 'success');
    await loadMatches();
    renderSquad();
  } catch (e) {
    console.error('Match non enregistré', e);
    toast(/hors_plateforme/.test(e.message || '') ? updateNeeded('lmfc_v37.sql') : e.message, 'error');
  } finally { btn.disabled = false; }
}

async function deleteMatch() {
  if (!editing?.id || !await confirmDialog(`Supprimer ce match et ses joueurs ?${await trashNote()}`)) return;
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
  swapKeepView(document.getElementById('squad'), players.length ? mhSquadHtml(players, matchSquad(SQUAD.rows), SQUAD.sort) : '<div class="empty">Aucun joueur dans cette équipe.</div>');
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
    box.innerHTML = `<div class="mh-head"><button type="button" class="btn btn-sm" data-mh-back><span class="arr arr-l" aria-hidden="true"></span>Effectif</button>
      <h2 class="as-h3">${escapeHtml(playerName(playerOf(pid)))}</h2>${playerLink(pid, 'Fiche du joueur →', '', 'matchs')}</div>${mhHistoryHtml(rows)}`;
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
