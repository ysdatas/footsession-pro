/* ============================================================
   LMFC Performance — session-edit-page.js (Chemin B / Supabase)
   Création / édition d'une séance : procédés dynamiques, présences.
   Statuts, invités et bilan : session-roster.js ; équipes, staff et
   vidéo par procédé : session-proc-teams.js (lmfc_v9.sql) ; droits
   d'accès : session-access.js (lmfc_v10.sql) ; enregistrement
   automatique : session-autosave.js.
   ============================================================ */

const SESSION_ID = new URLSearchParams(location.search).get('id') ? Number(new URLSearchParams(location.search).get('id')) : null;
const EDITOR_MODE = SESSION_ID ? 'edit' : 'create';
// Séance existante : l'en-tête final s'affiche dès l'ouverture (titre, sous-titre
// d'une ligne, exports), pour que rien ne bouge quand la séance arrive (CLS).
if (EDITOR_MODE === 'edit') {
  document.getElementById('editorTitle').textContent = 'Modifier la séance';
  document.getElementById('editorSubtitle').textContent = 'Chargement…';
  ['btnPdfFull', 'btnPdfCoach'].forEach(id => document.getElementById(id)?.classList.remove('hidden'));
}
// Séance déjà créée par un premier enregistrement : les suivants la mettent à jour.
let savedSessionId = SESSION_ID;

let myProfile = null;
let CAN_WRITE = false;
let procedures = [];   // {_uid, id?, nom, duree_min, objectif, effectif, taille_terrain,
                        //  consignes, principes_jeu, comportements_individuels, temps_recup_min,
                        //  canvas_image?, expanded}
let attendance = [];   // {player_id, nom, prenom, numero, poste, team_id, statut, statut_libre, present, invite}
let bilans = new Map(); // player_id → {note: 'plus'|'egal'|'moins'|null, commentaire}
let uidSeq = 1;
const nextUid = () => 'p' + (uidSeq++);
let sessionTeamId = null; // équipe du club concernée (table teams), null = sans équipe
let loadedSession = null; // la séance telle que lue (créateur, accès de base)
const hasTeams = () => (window.CLUB_TEAMS || []).length > 0;

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  myProfile = ctx.profile;
  CAN_WRITE = canEdit(myProfile.role);
  // Tout ce qui ne dépend que du compte part en même temps que la séance.
  loadPrincipleSuggestions();
  loadProcSuggestions();
  const staffReady = loadStaffSuggestions();
  // Séance existante : le droit de la modifier vient de la base (créateur, réglages, équipe).
  if (EDITOR_MODE === 'edit') {
    const [{ data: lvl, error }, loaded] = await Promise.all([sb.rpc('session_access_level', { p_session: SESSION_ID }), loadSession()]);
    if (loaded === null) return;                 // introuvable : retour à la liste en cours
    if (loaded === false) return showLoadFailure();
    if (!error && lvl) CAN_WRITE = lvl === 'modification';   // sans lmfc_v10.sql : le rôle décide, comme avant
  }

  document.getElementById('uName').textContent = myProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[myProfile.role] || myProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (myProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  if (!CAN_WRITE) {
    ['f-titre', 'f-principe', 'f-date', 'f-heure', 'f-equipe', 'f-duree'].forEach(id => { document.getElementById(id).disabled = true; });
    document.getElementById('btnAddProc').classList.add('hidden');
    document.getElementById('btnAddProc2').classList.add('hidden');
    document.getElementById('btnLibrary')?.classList.add('hidden');
  } else {
    document.getElementById('btnLibrary')?.addEventListener('click', openLibrary);
  }

  document.getElementById('btnAddProc').addEventListener('click', () => addProcedure());
  document.getElementById('btnAddProc2').addEventListener('click', () => addProcedure());

  // Blocs dépliables (présences, équipes, staff, bilan) : on cible celui du bouton cliqué.
  document.querySelectorAll('.attendance-head').forEach(btn =>
    btn.addEventListener('click', () => btn.closest('.attendance').classList.toggle('open')));
  initRoster();
  initProcBlocks();
  initPitch();
  document.getElementById('proceduresList').addEventListener('input', (e) => {
    if (e.target.classList.contains('proc-duree') || e.target.classList.contains('proc-name')) updateMeta();
    // Les temps se recalculent à la frappe. On met à jour les champs concernés
    // sur place plutôt que de re-générer le HTML, ce qui ferait perdre le focus.
    if (['nb_sequences', 'duree_sequence_min', 'temps_recup_min'].includes(e.target.dataset.field)) {
      refreshProcTimes(e.target.closest('.proc'));
      updateMeta();
    }
  });

  // Exports : ce qui est en attente est enregistré d'abord, le PDF lit la base.
  const exportPdf = async (fn) => { if (await flushSave()) fn(savedSessionId); else toast('Enregistrez d’abord la séance (titre et date).', 'error'); };
  document.getElementById('btnPdfFull')?.addEventListener('click', () => exportPdf(window.generateSessionPDF));
  document.getElementById('btnPdfCoach')?.addEventListener('click', () => exportPdf(window.generateCoachPDF));
  if (EDITOR_MODE === 'edit') {
    showSavedSession();
  } else {
    document.getElementById('f-date').value = new Date().toISOString().slice(0, 10);
    sessionTeamId = currentTeamId();
    await loadPlayersForNew();
    addProcedure({ nom: 'Échauffement', duree_min: 15 });
  }
  mountTeamSelect();
  document.getElementById('f-filmee').checked = sessionFilmee;
  document.getElementById('filmeeState').textContent = sessionFilmee ? 'Oui' : 'Non';
  if (!CAN_WRITE) ['f-filmee', 'f-notes'].forEach(id => { document.getElementById(id).disabled = true; });
  renderProcedures();
  renderAttendance();
  renderBilans();
  updateMeta();
  if (EDITOR_MODE === 'edit') renderShare();
  await initAccess(loadedSession, staffReady);
  if (CAN_WRITE) {
    const main = document.querySelector('main');
    // La recherche d'un invité ne modifie rien tant qu'on n'a pas choisi le joueur.
    const edit = (e) => { if (!e.target.closest('#guestSearch')) markDirty(); };
    main.addEventListener('input', edit);
    main.addEventListener('change', edit);
    // Clics qui modifient la séance (les champs, eux, passent par input / change).
    ['bilanList', 'guestResults', 'btnAllPresent'].forEach(id => document.getElementById(id)?.addEventListener('click', (e) => {
      if (e.target.closest('button:not([role="tab"])')) markDirty();
    }));
  }
  startAutosave(loadedSession);
  initSessionLibrary();   // vidéos de la bibliothèque (session-library.js)
  initSessionRpe();       // RPE des joueurs (session-rpe.js)
})();

/* Séance enregistrée : titre, exports et partage disponibles. */
function showSavedSession() {
  document.getElementById('editorTitle').innerHTML = CAN_WRITE ? 'Modifier la séance <span class="badge badge-gold">ÉDITION</span>'
    : 'Séance <span class="badge">LECTURE SEULE</span>';
  ['btnPdfFull', 'btnPdfCoach'].forEach(id => document.getElementById(id)?.classList.remove('hidden'));
}
/* Première sauvegarde d'une nouvelle séance (session-autosave.js). */
function onSessionCreated() {
  showSavedSession();
  renderShare();
  document.getElementById('editorSubtitle').textContent = `Créée le ${new Date().toISOString().slice(0, 10)} · enregistrée à chaque modification`;
}

/* Principes déjà utilisés par le club : proposés à la saisie, pour que le
   même principe s'écrive toujours pareil (et se compte bien dans Analytics). */
async function loadPrincipleSuggestions() {
  const { data, error } = await sb.from('sessions').select('principes_jeu').not('principes_jeu', 'is', null).limit(300);
  if (error) return console.warn('Principes de jeu déjà utilisés indisponibles', error);
  const list = [...new Set((data || []).map(r => (r.principes_jeu || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  document.getElementById('principesList').innerHTML = list.map(t => `<option value="${escapeHtml(t)}"></option>`).join('');
}

/* Effectifs et terrains déjà utilisés par le club, du plus courant au moins
   courant, écrits comme dans le bilan (label-norm.js) : on choisit « 7v7 »
   plutôt que d'en créer une variante (« 7c7 », « 7 vs 7 »). */
async function loadProcSuggestions() {
  const { data, error } = await sb.from('procedures').select('effectif, taille_terrain')
    .or('effectif.not.is.null,taille_terrain.not.is.null').order('id', { ascending: false }).limit(1000);
  if (error) return console.warn('Effectifs et terrains déjà utilisés indisponibles', error);
  const fill = (id, values, norm) => {
    document.getElementById(id).innerHTML = countNormalized(values, norm, 30)
      .map(g => `<option value="${escapeHtml(g.label)}"></option>`).join('');
  };
  fill('effectifList', data.map(r => r.effectif), normEffectif);
  fill('terrainList', data.map(r => r.taille_terrain), normTerrain);
}

/* Quand le club a des équipes, le champ texte « Équipe » devient une
   liste : la séance est rattachée à une vraie équipe, et la liste de
   présence se limite à ses joueurs. */
function mountTeamSelect() {
  if (!hasTeams()) return;
  const input = document.getElementById('f-equipe');
  const select = el('select', { id: 'f-team', disabled: CAN_WRITE ? null : 'disabled' },
    el('option', { value: '' }, 'Sans équipe'),
    window.CLUB_TEAMS.map(t => el('option', { value: t.id, selected: t.id === sessionTeamId ? 'selected' : null }, t.nom)));
  input.classList.add('hidden');
  input.after(select);
  document.querySelector('label[for="f-equipe"]')?.setAttribute('for', 'f-team');   // le libellé suit la liste
  select.addEventListener('change', async () => {
    sessionTeamId = Number(select.value) || null;
    // Les statuts déjà saisis et les invités restent ; la liste suit la nouvelle équipe.
    const before = new Map(attendance.map(a => [a.player_id, a]));
    await loadPlayersForNew();
    attendance.forEach(a => { const b = before.get(a.player_id); if (b) Object.assign(a, { statut: b.statut, statut_libre: b.statut_libre, present: b.present }); });
    renderAccess();   // le staff de l'équipe change
    before.forEach(b => { if (!attendance.some(a => a.player_id === b.player_id) && (b.invite || participe(b))) attendance.push(b); });
    renderAttendance();
    renderRosterDependents();
  });
}

/* Joueurs proposés dans la liste de présence : ceux de l'équipe de la
   séance, plus ceux déjà inscrits (knownIds : invités, présents d'avant).
   Tout l'effectif reste à portée pour ajouter un invité. */
async function playersForSession(knownIds = new Set()) {
  await loadClubPlayers();
  return clubPlayers.filter(p => playerInTeam(p, sessionTeamId) || knownIds.has(p.id));
}

/* ---------- Lien de partage (lecture seule, sans compte) ----------
   Le commentaire de la séance est sessions.notes (un seul champ) ; les
   anciens « commentaires de la cellule » y ont été recopiés (lmfc_v9.sql). */
let shareToken = null;
function renderShare() {
  const area = document.getElementById('shareArea');
  if (shareToken) {
    const url = location.origin + baseUrl('share.html') + '?token=' + shareToken;
    area.innerHTML = `<input readonly value="${url}" data-do="select" style="margin-bottom:8px;">
      <div class="flex gap-sm"><button class="btn btn-sm" type="button" id="shareCopy">Copier</button>
      ${CAN_WRITE ? '<button class="btn btn-sm btn-danger" type="button" id="shareToggle">Désactiver</button>' : ''}</div>`;
    document.getElementById('shareCopy').addEventListener('click', () => { navigator.clipboard?.writeText(url); toast('Lien copié', 'success'); });
    document.getElementById('shareToggle')?.addEventListener('click', unshare);
  } else if (!CAN_WRITE) {
    area.innerHTML = '<p class="text-muted" style="font-size:var(--fs-md);">Aucun lien pour cette séance.</p>';
  } else {
    area.innerHTML = `<button class="btn btn-primary" id="shareToggle" type="button">Générer un lien</button>`;
    document.getElementById('shareToggle').addEventListener('click', doShare);
  }
}
function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join(''); }
/* Lien de partage : écrit dans la même file que la sauvegarde automatique
   (jamais en même temps qu'elle) ; la date renvoyée garde le verrou à jour. */
async function setShareToken(token) {
  await exclusiveWrite(async () => {
    const { data, error } = await sb.from('sessions').update({ share_token: token }).eq('id', savedSessionId).select('updated_at');
    if (error) throw error;
    if (data?.[0]) autosave.knownAt = data[0].updated_at;
  });
  shareToken = token;
  renderShare();
}
async function doShare() {
  try { await setShareToken(randomToken()); toast('Lien de partage activé', 'success'); } catch (e) { toast(e.message, 'error'); }
}
async function unshare() {
  try { await setShareToken(null); toast('Partage désactivé', 'success'); } catch (e) { toast(e.message, 'error'); }
}

/* ---------- Chargement ----------
   Une seule vague de requêtes : séance, procédés, présences, bilans et
   effectif partent ensemble (avant : six allers-retours à la suite). */
async function loadSession() {
  try {
    const [{ data: s, error: e1 }, { data: procs, error: e2 }, { data: att, error: e3 }, { data: bl, error: blErr }] = await Promise.all([
      sb.from('sessions').select('*').eq('id', SESSION_ID).single(),
      sb.from('procedures').select('*, tactical_schemas(*)').eq('session_id', SESSION_ID).order('ordre'),
      sb.from('attendance').select('*').eq('session_id', SESSION_ID),
      sb.from('session_bilans').select('player_id, note, commentaire').eq('session_id', SESSION_ID),
      loadClubPlayers(),
    ]);
    // Introuvable (ou plus de droit) : retour à la liste. Panne : on le dit, sans rien enregistrer.
    if (!s && (!e1 || e1.code === 'PGRST116')) { toast('Séance introuvable.', 'error'); setTimeout(() => location.href = 'sessions.html', 1200); return null; }
    if (e1 || e2 || e3) throw e1 || e2 || e3;
    shareToken = s.share_token || null;
    loadedSession = s;
    sessionFilmee = !!s.filmee;
    terrain = s.terrain && typeof s.terrain === 'object' ? s.terrain : {};
    document.getElementById('f-notes').value = s.notes || '';

    document.getElementById('f-titre').value = s.titre || '';
    document.getElementById('f-date').value = s.date_seance || '';
    document.getElementById('f-heure').value = s.heure ? s.heure.slice(0, 5) : '';   // lmfc_v28.sql
    document.getElementById('f-equipe').value = s.equipe || '';
    sessionTeamId = s.team_id ?? null;
    document.getElementById('f-duree').value = decStr(s.duree_min ?? 90);
    document.getElementById('editorSubtitle').textContent = `Créée le ${(s.created_at || '').slice(0, 10)}`;

    procedures = (procs || []).map(p => procFromRow(p, nextUid()));   // procedure-time.js
    // Ancienne séance : ses chasubles valaient pour toute la séance. Elles sont
    // reprises sur chaque procédé ; la prochaine sauvegarde les y range (_legacyTeams :
    // à enregistrer même sans autre changement, puisque la séance perd les siennes).
    const legacy = cleanTeams(s.equipes);
    if (legacy.length && procedures.every(p => !p.equipes.length)) {
      procedures.forEach(p => { p.equipes = JSON.parse(JSON.stringify(legacy)); p._legacyTeams = true; });
    }
    document.getElementById('f-principe').value = sessionPrinciple(s, procedures);

    if (blErr) console.warn('Bilans indisponibles (lmfc_v9.sql ?)', blErr);
    bilans = new Map((bl || []).map(b => [b.player_id, { note: b.note, commentaire: b.commentaire || '' }]));
    const attMap = new Map((att || []).map(a => [a.player_id, a]));
    // Hors de l'équipe : les invités et les joueurs déjà marqués présents restent listés.
    const players = await playersForSession(new Set((att || []).filter(a => a.invite || a.present).map(a => a.player_id)));
    attendance = players.map(p => ({
      player_id: p.id, nom: p.nom, prenom: p.prenom, numero: p.numero, poste: p.poste, team_id: p.team_id,
      statut: statutOf(attMap.get(p.id)), statut_libre: attMap.get(p.id)?.statut_libre || '',
      present: !!attMap.get(p.id)?.present, invite: !!attMap.get(p.id)?.invite,
    }));
    rememberSavedRoster(attMap);   // ce qui est déjà en base ne sera pas renvoyé tel quel
    return true;
  } catch (e) {
    console.error('Séance illisible', e);
    return false;
  }
}

/* Séance pas chargée (réseau) : rien n'est modifiable ni enregistré, sinon une
   saisie sur un écran vide écraserait la séance en base. */
function showLoadFailure() {
  CAN_WRITE = false;
  document.getElementById('editorTitle').textContent = 'Séance';
  const main = document.querySelector('main');
  main.insertAdjacentHTML('afterbegin', `<div class="load-failure" role="alert">
    <strong>La séance n’a pas pu être chargée.</strong> Vérifiez la connexion : rien n’a été modifié.
    <button class="btn btn-primary btn-sm" type="button" data-do="reload">Réessayer</button></div>`);
  main.querySelectorAll('input, textarea, select, button:not(.load-failure button)').forEach(el => { el.disabled = true; });
}

/* Tout l'effectif du club, une fois (liste de présence, recherche d'invités). */
async function loadClubPlayers() {
  if (clubPlayers.length) return;
  const { data, error } = await sb.from('players')
    .select(`id, nom, prenom, numero, poste${hasTeams() ? ', team_id, other_team_ids' : ''}`).order('nom');
  if (error) throw error;
  clubPlayers = data || [];
}

async function loadPlayersForNew() {
  try {
    const players = await playersForSession();
    attendance = players.map(p => ({
      player_id: p.id, nom: p.nom, prenom: p.prenom, numero: p.numero, poste: p.poste, team_id: p.team_id,
      statut: 'absent', invite: false,
    }));
  } catch (e) { console.error('Liste des joueurs indisponible', e); attendance = []; }
}

/* ---------- Procédés ---------- */
/* schema : schéma d'un modèle de la bibliothèque ({ image_path, canvas_json }),
   rattaché au procédé à son premier enregistrement (commitDraftSchemas). */
function addProcedure(data = {}, schema = null) {
  syncFromDom();
  procedures.push({
    _uid: nextUid(), nom: data.nom || '', duree_min: data.duree_min || 20,
    objectif: data.objectif || '', effectif: data.effectif || '',
    taille_terrain: data.taille_terrain || '', consignes: data.consignes || '',
    principes_jeu: '', comportements_individuels: data.comportements_individuels || '',
    temps_recup_min: data.temps_recup_min ?? '',
    type_procede: data.type_procede || '', nb_sequences: data.nb_sequences ?? '',
    duree_sequence_min: data.duree_sequence_min ?? '',
    image_path: null, expanded: true, equipes: [], staff: [], filme: null,
    from_template: schema?.image_path || schema?.canvas_json ? schema : null,
  });
  // Modèle qui avait un principe de jeu : il devient celui de la séance s'il manque.
  const principe = document.getElementById('f-principe');
  if (data.principes_jeu && principe && !principe.value.trim()) principe.value = data.principes_jeu;
  markDirty();
  renderProcedures();
  updateMeta();
}

/* Schémas enregistrés (fenêtre « Schémas », ☆ d'un procédé) : session-templates.js. */

/* Icônes des boutons d'un procédé (tracés Lucide, 24 × 24). */
const PROC_IC = {
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
};
const procIc = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${PROC_IC[k]}</svg>`;

function procTemplate(p, index) {
  const f = (val) => escapeHtml(val ?? '');
  const dis = CAN_WRITE ? '' : 'disabled';
  const tac = schemaBoxHtml(p);
  const fid = (k) => `pf-${p._uid}-${k}`;   // libellé relié à son champ (lecteurs d'écran)

  return `
  <div class="proc ${p.expanded ? 'expanded' : ''}" data-uid="${p._uid}">
    <div class="proc-head">
      <span class="proc-num">${index + 1}</span>
      <input class="proc-name" data-field="nom" aria-label="Nom du procédé" value="${f(p.nom)}" placeholder="Nom du procédé" ${dis}>
      <div class="proc-head-right">
        <span class="proc-badges" data-proc-badges="${p._uid}">${procBadgesHtml(p)}</span>
        <span class="proc-dot"></span>
        <input class="proc-duree" data-field="duree_min" type="text" inputmode="decimal" aria-label="Durée du procédé (min)"
               value="${decStr(hasSequences(p) ? totalMin(p) : (Number(p.duree_min) || 0))}"
               ${hasSequences(p) ? 'readonly title="Calculé : séquences + récupérations"' : ''} ${dis}>
        <span class="proc-unit">min</span>
        ${CAN_WRITE ? `
        <span class="proc-tools">
          <button class="proc-btn" type="button" title="Enregistrer comme modèle" aria-label="Enregistrer comme modèle" data-do="saveAsTemplate" data-arg="${p._uid}">${procIc('star')}</button>
          <button class="proc-btn" type="button" title="Monter" aria-label="Monter le procédé" data-do="moveUp" data-arg="${p._uid}">${procIc('up')}</button>
          <button class="proc-btn" type="button" title="Descendre" aria-label="Descendre le procédé" data-do="moveDown" data-arg="${p._uid}">${procIc('down')}</button>
          <button class="proc-btn danger" type="button" title="Supprimer" aria-label="Supprimer le procédé" data-do="removeProc" data-arg="${p._uid}">${procIc('trash')}</button>
        </span>` : ''}
        <button class="proc-btn proc-toggle" type="button" title="Détails" aria-label="Afficher les détails" aria-expanded="${p.expanded ? 'true' : 'false'}" data-do="toggleProc" data-arg="${p._uid}">${procIc('down')}</button>
      </div>
    </div>
    <div class="proc-body">
      <div class="proc-fields">
        <div class="field"><label for="${fid('objectif')}">Objectif</label><textarea data-field="objectif" id="${fid('objectif')}" placeholder="But de l'exercice…" ${dis}>${f(p.objectif)}</textarea></div>
        <p class="proc-group">Organisation</p>
        <div class="field-row">
          <div class="field"><label for="${fid('type_procede')}">Type de procédé</label>
            <select data-field="type_procede" id="${fid('type_procede')}" ${dis}>
              <option value=""${p.type_procede ? '' : ' selected'}>—</option>
              ${PROC_TYPES.map(t => `<option value="${t}"${p.type_procede === t ? ' selected' : ''}>${t}</option>`).join('')}
            </select></div>
          <div class="field"><label for="${fid('effectif')}">Effectif</label><input data-field="effectif" id="${fid('effectif')}" list="effectifList" autocomplete="off" value="${f(p.effectif)}" placeholder="Ex: 11v11, 5v3…" ${dis}></div>
          <div class="field"><label for="${fid('taille_terrain')}">Taille terrain</label><input data-field="taille_terrain" id="${fid('taille_terrain')}" list="terrainList" autocomplete="off" value="${f(p.taille_terrain)}" placeholder="Ex: 30×20 m" ${dis}></div>
        </div>
        <p class="proc-group">Temps de jeu</p>
        <div class="field-row">
          <div class="field"><label for="${fid('nb_sequences')}">Nb séquences</label>
            <input data-field="nb_sequences" id="${fid('nb_sequences')}" type="number" min="1" step="1" value="${p.nb_sequences ?? ''}" placeholder="Ex: 3" ${dis}></div>
          <div class="field"><label for="${fid('duree_sequence_min')}">Durée séquence (min)</label>
            <input data-field="duree_sequence_min" id="${fid('duree_sequence_min')}" type="text" inputmode="decimal" value="${decStr(p.duree_sequence_min)}" placeholder="Ex: 1,5" ${dis}></div>
          <div class="field"><label for="${fid('temps_recup_min')}">Récup (min)</label>
            <input data-field="temps_recup_min" id="${fid('temps_recup_min')}" type="text" inputmode="decimal" value="${decStr(p.temps_recup_min)}" placeholder="Ex: 0,5" ${dis}></div>
          <div class="field"><label for="${fid('recap')}">Récapitulatif</label>
            <input id="${fid('recap')}" value="${escapeHtml(sequenceLabel(p))}" readonly tabindex="-1"
                   title="Travail ${fmtMin(workMin(p))}' · récup ${fmtMin(recupMin(p))}' · total ${fmtMin(totalMin(p))}'"></div>
        </div>
        <div class="field"><label for="${fid('consignes')}">Consignes</label><textarea data-field="consignes" id="${fid('consignes')}" placeholder="Instructions détaillées…" ${dis}>${f(p.consignes)}</textarea></div>
        <div class="field"><label for="${fid('comportements_individuels')}">Comportements individuels</label><textarea data-field="comportements_individuels" id="${fid('comportements_individuels')}" placeholder="Ex: Présenter le pied…" ${dis}>${f(p.comportements_individuels)}</textarea></div>
      </div>
      <div>
        <p class="proc-group">Schéma tactique</p>
        <div class="schema-box" data-schema-box>${tac}</div>
        <div class="schema-recap">Procédé ${index + 1} / ${procedures.length} · ${escapeHtml(sequenceLabel(p))}</div>
        <div data-lib-box="${p._uid}">${libraryBoxHtml(p)}</div>
      </div>
      ${procExtrasHtml(p)}
    </div>
  </div>`;
}

/* ---------- Schéma tactique d'un procédé ----------
   Procédé enregistré : son schéma (tactical_schemas), dessiné dans le
   tableau ou importé en image (importSchemaImage). Procédé pas encore
   enregistré : un brouillon dessiné tout de suite (tactical-board.html
   ?draft=…), gardé dans le navigateur et rattaché au procédé par la
   sauvegarde automatique (commitDraftSchemas). */
const lsJson = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { console.warn('Brouillon illisible', key, e); return null; } };
const schemaUrl = (path, v) => `${sb.storage.from('schemas').getPublicUrl(path).data.publicUrl}${v ? `?v=${v}` : ''}`;
function schemaBoxHtml(p) {
  if (p.id) {
    const draw = !p.image_path ? 'Dessiner le schéma →' : p.has_canvas ? 'Modifier le schéma →' : 'Dessiner à la place →';
    return `${p.image_path ? `<img class="schema-thumb" src="${escapeHtml(schemaUrl(p.image_path, p.image_v))}" alt="Schéma du procédé" loading="lazy" data-fail-uid="${p._uid}">` : '<p class="schema-empty">Aucun schéma pour ce procédé.</p>'}
       <button class="btn btn-sm" type="button" data-do="openBoard" data-arg="${p.id}">${draw}</button>
       ${CAN_WRITE ? `<button class="btn btn-sm" type="button" data-do="importSchemaImage" data-arg="${p._uid}">${p.image_path ? 'Remplacer par une image' : 'Importer une image'}</button>` : ''}
       ${p.video_id ? `<button class="btn btn-sm" type="button" data-do="openLinkedVideo" data-arg="${p.video_id}">▶ Vidéo liée</button>` : ''}`;
  }
  if (!CAN_WRITE) return '<p class="schema-empty">Aucun schéma pour ce procédé.</p>';
  if (p.from_template) {
    return `${p.from_template.image_path ? `<img class="schema-thumb" src="${escapeHtml(schemaUrl(p.from_template.image_path))}" alt="Schéma du modèle">` : ''}
      <p class="schema-empty">Schéma du modèle : rattaché au procédé dès que la séance est enregistrée.</p>`;
  }
  const meta = p.draft_key && lsJson('tb_draftmeta_' + p.draft_key);
  const started = p.draft_key && localStorage.getItem('tb_draft_' + p.draft_key);
  if (meta || started) {
    return `${meta?.image_path ? `<img class="schema-thumb" src="${escapeHtml(schemaUrl(meta.image_path, meta.at))}" alt="Aperçu du schéma">` : ''}
      <p class="schema-empty">${meta ? 'Schéma prêt : il est rattaché au procédé dès que la séance est enregistrée (titre et date).' : 'Schéma commencé : cliquez « Enregistrer » dans le tableau.'}</p>
      <button class="btn btn-sm" type="button" data-do="openDraftBoard" data-arg="${p._uid}">Modifier le schéma →</button>`;
  }
  return `<button class="btn btn-sm btn-primary" type="button" data-do="openDraftBoard" data-arg="${p._uid}">Dessiner le schéma →</button>
    <p class="schema-empty">Le schéma est rattaché au procédé dès que la séance est enregistrée.</p>`;
}
/* Image du schéma illisible (cache, réseau) : un essai par lien signé,
   sinon on le dit au lieu d'afficher un cadre vide. */
window.schemaImgFailed = async (img, uid) => {
  const p = procedures.find(x => x._uid === uid);
  if (!p?.image_path) return;
  if (!img.dataset.retried) {
    img.dataset.retried = '1';
    const { data } = await sb.storage.from('schemas').createSignedUrl(p.image_path, 3600);
    if (data?.signedUrl) { img.src = data.signedUrl; return; }
  }
  console.warn('Image du schéma illisible', p.image_path);
  img.outerHTML = '<p class="schema-empty">Image du schéma introuvable : ouvrez le tableau et enregistrez le schéma.</p>';
};
function refreshSchemaBox(p) {
  const box = document.querySelector(`.proc[data-uid="${p._uid}"] [data-schema-box]`);
  if (box) box.innerHTML = schemaBoxHtml(p);
}
window.openDraftBoard = (uid) => {
  syncFromDom();
  const p = procedures.find(x => x._uid === uid);
  if (!p) return;
  if (!p.draft_key) { p.draft_key = randomToken().slice(0, 16); markDirty(); }
  const name = p.nom.trim() || `Procédé ${procedures.indexOf(p) + 1}`;
  window.open(`tactical-board.html?draft=${p.draft_key}&name=${encodeURIComponent(name)}`, '_blank');
  refreshSchemaBox(p);
};
/* Le tableau, ouvert dans un autre onglet, prévient quand il enregistre :
   seul l'encadré du procédé change, ce qui est en cours de saisie reste. */
window.addEventListener('storage', (e) => {
  if (!e.key || !e.newValue) return;
  if (e.key.startsWith('tb_draftmeta_')) {
    const p = procedures.find(x => x.draft_key && e.key === 'tb_draftmeta_' + x.draft_key);
    if (p) { refreshSchemaBox(p); markDirty(); }   // la sauvegarde automatique rattache le schéma au procédé
  } else if (e.key === 'tb_proc_saved') {
    const m = lsJson('tb_proc_saved');
    const p = m && procedures.find(x => x.id === m.procedure_id);
    if (p) { p.image_path = m.image_path; p.image_v = m.at; p.has_canvas = true; refreshSchemaBox(p); }
  }
});
/* À la sauvegarde : chaque brouillon enregistré dans le tableau (« Enregistrer »,
   tb_draftmeta_*) devient le schéma de son procédé, désormais enregistré (image
   copiée à sa place définitive). Le procédé garde sa clé : si le tableau est
   encore ouvert et enregistre de nouveau, le schéma suit. */
async function commitDraftSchemas() {
  for (const p of procedures.filter(x => x.from_template && x.id)) await attachTemplateSchema(p);
  for (const p of procedures.filter(x => x.draft_key && x.id)) {
    const json = lsJson('tb_draft_' + p.draft_key);
    const meta = lsJson('tb_draftmeta_' + p.draft_key);
    if (!json || !meta) continue;
    const image_path = meta.image_path ? await copySchemaImage(meta.image_path, p) : p.image_path;
    await setSchema(p, { canvas_json: json, image_path, vue_terrain: json.view || 'complet' });
    if (meta.image_path) {
      const { error: delErr } = await sb.storage.from('schemas').remove([meta.image_path]);
      if (delErr) console.warn('Image de brouillon restée dans le stockage', delErr);
    }
    localStorage.removeItem('tb_draft_' + p.draft_key);
    localStorage.removeItem('tb_draftmeta_' + p.draft_key);
    p.has_canvas = true;
    refreshSchemaBox(p);
  }
}

/* Procédé inséré depuis la bibliothèque, désormais enregistré : il reçoit
   une copie de l'image du modèle et son dessin (modifiable dans le tableau). */
async function attachTemplateSchema(p) {
  const { image_path: src, canvas_json } = p.from_template;
  const image_path = src ? await copySchemaImage(src, p) : null;
  await setSchema(p, { canvas_json: canvas_json || null, image_path });
  Object.assign(p, { has_canvas: !!canvas_json, from_template: null });
  refreshSchemaBox(p);
}

/* Copie d'une image (brouillon, modèle) pour un procédé, sous un nom neuf :
   l'image en place reste intacte tant que la copie n'a pas réussi. Échec :
   l'enregistrement est signalé et réessayé, rien n'est effacé. */
async function copySchemaImage(src, p) {
  const dest = `${myProfile.club_id}/procedure-${p.id}-${Date.now()}.png`;
  const { error } = await sb.storage.from('schemas').copy(src, dest);
  if (error) throw new Error(`image du schéma de « ${p.nom || 'procédé'} » non copiée (${error.message})`);
  return dest;
}
/* Écrit le schéma du procédé, puis retire l'ancienne image s'il en change. */
async function setSchema(p, fields) {
  const { data, error } = await sb.from('tactical_schemas').upsert({ procedure_id: p.id, ...fields }, { onConflict: 'procedure_id' })
    .select('updated_at').maybeSingle();
  if (error) throw error;
  const old = p.image_path;
  p.image_path = fields.image_path;
  p.image_v = data?.updated_at ? Date.parse(data.updated_at) : Date.now();
  if (old && old !== p.image_path) {
    const { error: rmErr } = await sb.storage.from('schemas').remove([old]);
    if (rmErr) console.warn('Ancienne image du schéma restée dans le stockage', rmErr);
  }
}

/* Image à la place d'un schéma dessiné (photo d'un tableau blanc, capture…) :
   réduite (shrinkImage, app.js), rangée à la place du schéma du tableau (un
   seul fichier par procédé) et reprise partout comme lui : fiche, PDF,
   partage. Le dessin éventuel est remplacé : « Dessiner à la place » repart
   d'un terrain vide. */
window.importSchemaImage = (uid) => {
  const p = procedures.find(x => x._uid === uid);
  if (!p?.id || !CAN_WRITE) return;
  const input = el('input', { type: 'file', accept: 'image/png,image/jpeg' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    if (p.has_canvas && !confirm('Remplacer le schéma dessiné par cette image ? Le dessin sera perdu.')) return;
    try {
      const img = await shrinkImage(file);
      if (!['image/png', 'image/jpeg'].includes(img.type)) throw new Error('choisissez une image JPEG ou PNG');
      const path = `${myProfile.club_id}/procedure-${p.id}-${Date.now()}.${img.type === 'image/png' ? 'png' : 'jpg'}`;
      const { error: upErr } = await sb.storage.from('schemas').upload(path, img, { contentType: img.type });
      if (upErr) throw upErr;
      await setSchema(p, { image_path: path, canvas_json: null });
      p.has_canvas = false;
      refreshSchemaBox(p);
      toast('Image ajoutée au procédé.', 'success');
    } catch (e) {
      console.error('Image du procédé non enregistrée', e);
      toast(`Image non enregistrée : ${e.message}`, 'error');
    }
  });
  input.click();
};

/* Recalcule la durée et le récapitulatif d'un procédé après saisie des
   séquences. Dès que la structure est complète, la durée devient calculée
   et n'est plus modifiable à la main : une seule valeur fait foi. */
function refreshProcTimes(node) {
  if (!node) return;
  const p = procedures.find(x => x._uid === node.dataset.uid);
  if (!p) return;
  node.querySelectorAll('[data-field]').forEach(inp => {
    const k = inp.dataset.field;
    if (k === 'nb_sequences') p[k] = inp.value === '' ? '' : Number(inp.value);
    else if (k === 'duree_sequence_min' || k === 'temps_recup_min') p[k] = parseDecimal(inp.value);
  });

  const dureeInput = node.querySelector('.proc-duree');
  if (dureeInput) {
    if (hasSequences(p)) {
      p.duree_min = totalMin(p);
      dureeInput.value = decStr(p.duree_min);
      dureeInput.readOnly = true;
      dureeInput.title = 'Calculé : séquences + récupérations';
    } else {
      dureeInput.readOnly = false;
      dureeInput.title = '';
    }
  }

  const recap = node.querySelector('.proc-body .field-row input[readonly][tabindex="-1"]');
  if (recap) {
    recap.value = sequenceLabel(p);
    recap.title = `Travail ${fmtMin(workMin(p))}' · récup ${fmtMin(recupMin(p))}' · total ${fmtMin(totalMin(p))}'`;
  }
  const schemaRecap = node.querySelector('.schema-recap');
  if (schemaRecap) {
    const idx = procedures.indexOf(p);
    schemaRecap.textContent = `Procédé ${idx + 1} / ${procedures.length} · ${sequenceLabel(p)}`;
  }
}

function renderProcedures() {
  document.getElementById('proceduresList').innerHTML = procedures.map(procTemplate).join('');
  document.getElementById('procCount').textContent = procedures.length;
  renderProcBlocks();   // équipes et staff de chaque procédé, résumé vidéo
}


function syncFromDom() {
  document.querySelectorAll('#proceduresList .proc').forEach(node => {
    const p = procedures.find(x => x._uid === node.dataset.uid);
    if (!p) return;
    node.querySelectorAll('[data-field]').forEach(inp => {
      const k = inp.dataset.field;
      if (k === 'duree_min') p[k] = parseDecimal(inp.value) || 0;
      else if (k === 'nb_sequences') p[k] = inp.value === '' ? '' : Number(inp.value);
      else if (k === 'temps_recup_min' || k === 'duree_sequence_min') p[k] = parseDecimal(inp.value);
      else p[k] = inp.value;
    });
    // La structure en séquences fait foi sur la durée saisie librement.
    if (hasSequences(p)) p.duree_min = totalMin(p);
    p.expanded = node.classList.contains('expanded');
  });
}

window.toggleProc = (uid) => { syncFromDom(); const p = procedures.find(x => x._uid === uid); if (p) { p.expanded = !p.expanded; renderProcedures(); } };
window.removeProc = (uid) => { syncFromDom(); procedures = procedures.filter(x => x._uid !== uid); markDirty(); renderProcedures(); updateMeta(); };
window.moveProc = (uid, dir) => {
  syncFromDom();
  const i = procedures.findIndex(x => x._uid === uid), j = i + dir;
  if (i < 0 || j < 0 || j >= procedures.length) return;
  [procedures[i], procedures[j]] = [procedures[j], procedures[i]];
  markDirty(); renderProcedures(); updateMeta();
};
/* Vidéo associée au schéma depuis le tableau tactique (platform_v2.sql). */
window.openLinkedVideo = async (videoId) => {
  const { data: v } = await sb.from('player_videos').select('titre, storage_path').eq('id', videoId).maybeSingle();
  const src = v ? await videoUrl(v.storage_path).catch(e => { console.warn('Vidéo liée', e); return null; }) : null;
  if (!src) return toast('Vidéo introuvable.', 'error');
  openLightbox({ title: v.titre, items: [{ type: 'video', src }] });
};
window.openBoard = (procId) => { window.open('tactical-board.html?procedure_id=' + procId, '_blank'); };

/* ---------- Méta ---------- */
function updateMeta() {
  syncFromDom();   // les temps se lisent sur l'état, pas sur le DOM brut
  const n = procedures.length;
  const travail = sessionWorkMin(procedures), total = sessionTotalMin(procedures);
  const recup = total - travail;
  document.getElementById('editorMeta').textContent =
    `${n} procédé${n > 1 ? 's' : ''} · ${fmtMin(travail)} min de travail`
    + (recup > 0 ? ` + ${fmtMin(recup)} min de récup` : '')
    + ` · ${fmtMin(total)} min au total`;
  document.getElementById('procCount').textContent = n;
}

/* Boutons générés : data-do="action" (et data-arg), une seule écoute.
   La politique de contenu du site (web/_headers) interdit les onclick="…". */
const EDIT_DO = {
  select: (b) => b.select(),
  reload: () => location.reload(),
  moveUp: (b) => moveProc(b.dataset.arg, -1),
  moveDown: (b) => moveProc(b.dataset.arg, 1),
  removeProc: (b) => removeProc(b.dataset.arg),
  toggleProc: (b) => toggleProc(b.dataset.arg),
  openBoard: (b) => openBoard(Number(b.dataset.arg)),
  importSchemaImage: (b) => importSchemaImage(b.dataset.arg),
  openLinkedVideo: (b) => openLinkedVideo(Number(b.dataset.arg)),
  openDraftBoard: (b) => openDraftBoard(b.dataset.arg),
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-do]');
  if (b && Object.hasOwn(EDIT_DO, b.dataset.do)) EDIT_DO[b.dataset.do](b);
});
// Image de schéma illisible (onerror en ligne interdit) : l'erreur ne remonte pas, on l'écoute en capture.
document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement && e.target.dataset.failUid) schemaImgFailed(e.target, e.target.dataset.failUid);
}, true);
