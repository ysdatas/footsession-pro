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
  const staffReady = loadStaffSuggestions();
  // Séance existante : le droit de la modifier vient de la base (créateur, réglages, équipe).
  if (EDITOR_MODE === 'edit') {
    const [{ data: lvl, error }] = await Promise.all([sb.rpc('session_access_level', { p_session: SESSION_ID }), loadSession()]);
    if (!error && lvl) CAN_WRITE = lvl === 'modification';   // sans lmfc_v10.sql : le rôle décide, comme avant
  }

  document.getElementById('uName').textContent = myProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[myProfile.role] || myProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (myProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  if (!CAN_WRITE) {
    ['f-titre', 'f-principe', 'f-date', 'f-equipe', 'f-duree'].forEach(id => { document.getElementById(id).disabled = true; });
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
    area.innerHTML = `<input readonly value="${url}" onclick="this.select()" style="margin-bottom:8px;">
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
/* Lien de partage : la date de modification renvoyée garde le verrou de la sauvegarde automatique à jour. */
async function setShareToken(token) {
  await flushSave();
  const { data, error } = await sb.from('sessions').update({ share_token: token }).eq('id', savedSessionId).select('updated_at');
  if (error) throw error;
  if (data?.[0]) autosave.knownAt = data[0].updated_at;
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
    if (e1 || !s) { toast('Séance introuvable.', 'error'); setTimeout(() => location.href = 'sessions.html', 1200); return; }
    if (e2 || e3) throw e2 || e3;
    shareToken = s.share_token || null;
    loadedSession = s;
    sessionFilmee = !!s.filmee;
    terrain = s.terrain && typeof s.terrain === 'object' ? s.terrain : {};
    document.getElementById('f-notes').value = s.notes || '';

    document.getElementById('f-titre').value = s.titre || '';
    document.getElementById('f-date').value = s.date_seance || '';
    document.getElementById('f-equipe').value = s.equipe || '';
    sessionTeamId = s.team_id ?? null;
    document.getElementById('f-duree').value = decStr(s.duree_min ?? 90);
    document.getElementById('editorSubtitle').textContent = `Créée le ${(s.created_at || '').slice(0, 10)}`;

    procedures = (procs || []).map(p => ({
      _uid: nextUid(), id: p.id, nom: p.nom || '', duree_min: p.duree_min || 20,
      objectif: p.objectif || '', effectif: p.effectif || '',
      taille_terrain: p.taille_terrain || '', consignes: p.consignes || '',
      principes_jeu: p.principes_jeu || '', comportements_individuels: p.comportements_individuels || '',
      temps_recup_min: p.temps_recup_min ?? '',
      type_procede: p.type_procede || '', nb_sequences: p.nb_sequences ?? '',
      duree_sequence_min: p.duree_sequence_min ?? '',
      image_path: p.tactical_schemas?.image_path || null, video_id: p.tactical_schemas?.video_id || null, expanded: false,
      equipes: cleanTeams(p.equipes), staff: Array.isArray(p.staff) ? p.staff : [], filme: p.filme ?? null,
    }));
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
  } catch (e) { console.error('Séance illisible', e); toast(e.message, 'error'); }
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
function addProcedure(data = {}) {
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
  });
  // Modèle qui avait un principe de jeu : il devient celui de la séance s'il manque.
  const principe = document.getElementById('f-principe');
  if (data.principes_jeu && principe && !principe.value.trim()) principe.value = data.principes_jeu;
  markDirty();
  renderProcedures();
  updateMeta();
}

/* ---------- Bibliothèque d'exercices (modèles réutilisables) ---------- */
const TPL_FIELDS = ['nom', 'duree_min', 'objectif', 'effectif', 'taille_terrain',
  'consignes', 'principes_jeu', 'comportements_individuels', 'temps_recup_min',
  'type_procede', 'nb_sequences', 'duree_sequence_min'];

window.saveAsTemplate = async (uid) => {
  syncFromDom();
  const p = procedures.find(x => x._uid === uid); if (!p) return;
  const nom = prompt('Nom du modèle :', p.nom || 'Exercice'); if (!nom) return;
  const data = {}; TPL_FIELDS.forEach(k => data[k] = p[k]);
  data.principes_jeu = procPrinciple(p, { principes_jeu: document.getElementById('f-principe').value });
  try {
    let image_path = null;
    if (p.image_path) {
      image_path = `${myProfile.club_id}/templates/${Date.now()}.png`;
      const { error: copyErr } = await sb.storage.from('schemas').copy(p.image_path, image_path);
      if (copyErr) image_path = null;   // pas bloquant : le modèle reste utile sans image
    }
    const { error } = await sb.from('exercise_templates').insert({
      // La catégorie du modèle reprend le type du procédé (jeu / exercice / situation),
      // ce qui donne à la bibliothèque un classement utile.
      club_id: myProfile.club_id, nom, categorie: p.type_procede || null, data, image_path,
    });
    if (error) throw error;
    toast('Modèle enregistré dans la bibliothèque', 'success');
  } catch (e) { toast(e.message, 'error'); }
};

async function openLibrary() {
  openModal('libraryModal');
  const list = document.getElementById('libraryList');
  list.innerHTML = '<p class="text-muted">Chargement…</p>';
  try {
    const { data: templates, error } = await sb.from('exercise_templates').select('id, nom, categorie, image_path').order('created_at', { ascending: false });
    if (error) throw error;
    if (!templates.length) { list.innerHTML = '<p class="text-muted">Aucun modèle enregistré. Cliquez sur ☆ sur un procédé pour en créer un.</p>'; return; }

    const withUrls = await Promise.all(templates.map(async t => {
      if (!t.image_path) return { ...t, url: null };
      const { data } = await sb.storage.from('schemas').createSignedUrl(t.image_path, 3600);
      return { ...t, url: data?.signedUrl || null };
    }));

    list.innerHTML = withUrls.map(t => `
      <div class="library-card">
        ${t.url ? `<img src="${t.url}" alt="">` : '<div class="lib-noimg">Sans schéma</div>'}
        <div class="lib-body">
          <div class="lib-name">${escapeHtml(t.nom)}</div>
          <div class="lib-cat">${escapeHtml(t.categorie || '')}</div>
          <div class="lib-actions">
            <button class="btn btn-sm btn-primary" type="button" onclick="insertTemplate(${t.id})">Insérer</button>
            <button class="btn btn-sm btn-danger" type="button" onclick="deleteTemplate(${t.id}, this)">Supprimer</button>
          </div>
        </div>
      </div>`).join('');
  } catch (e) { list.innerHTML = `<p class="text-danger">${escapeHtml(e.message)}</p>`; }
}
window.insertTemplate = async (id) => {
  try {
    const { data: tpl, error } = await sb.from('exercise_templates').select('data').eq('id', id).single();
    if (error) throw error;
    addProcedure(tpl.data || {});
    closeModal('libraryModal');
    toast('Procédé ajouté depuis la bibliothèque', 'success');
  } catch (e) { toast(e.message, 'error'); }
};
window.deleteTemplate = async (id, btn) => {
  if (!confirm(`Supprimer ce modèle ?${await trashNote()}`)) return;
  try {
    const { error } = await sb.from('exercise_templates').delete().eq('id', id);
    if (error) throw error;
    btn.closest('.library-card').remove();
  } catch (e) { toast(e.message, 'error'); }
};

function procTemplate(p, index) {
  const f = (val) => escapeHtml(val ?? '');
  const dis = CAN_WRITE ? '' : 'disabled';
  const tac = schemaBoxHtml(p);

  return `
  <div class="proc ${p.expanded ? 'expanded' : ''}" data-uid="${p._uid}">
    <div class="proc-head">
      <span class="proc-num">${index + 1}</span>
      <input class="proc-name" data-field="nom" value="${f(p.nom)}" placeholder="Nom du procédé" ${dis}>
      <div class="proc-head-right">
        <span class="proc-badges" data-proc-badges="${p._uid}">${procBadgesHtml(p)}</span>
        <span class="proc-dot"></span>
        <input class="proc-duree" data-field="duree_min" type="text" inputmode="decimal"
               value="${decStr(hasSequences(p) ? totalMin(p) : (Number(p.duree_min) || 0))}"
               ${hasSequences(p) ? 'readonly title="Calculé : séquences + récupérations"' : ''} ${dis}>
        <span class="proc-unit">min</span>
        ${CAN_WRITE ? `
        <button class="proc-btn" type="button" title="Enregistrer comme modèle" onclick="saveAsTemplate('${p._uid}')">☆</button>
        <button class="proc-btn" type="button" title="Monter"    onclick="moveProc('${p._uid}',-1)">▲</button>
        <button class="proc-btn" type="button" title="Descendre" onclick="moveProc('${p._uid}',1)">▼</button>
        <button class="proc-btn danger" type="button" title="Supprimer" onclick="removeProc('${p._uid}')">×</button>` : ''}
        <button class="proc-btn" type="button" title="Détails" onclick="toggleProc('${p._uid}')">▾</button>
      </div>
    </div>
    <div class="proc-body">
      <div class="proc-fields">
        <div class="field"><label>Objectif</label><textarea data-field="objectif" placeholder="But de l'exercice…" ${dis}>${f(p.objectif)}</textarea></div>
        <div class="field-row">
          <div class="field"><label>Type de procédé</label>
            <select data-field="type_procede" ${dis}>
              <option value=""${p.type_procede ? '' : ' selected'}>—</option>
              ${PROC_TYPES.map(t => `<option value="${t}"${p.type_procede === t ? ' selected' : ''}>${t}</option>`).join('')}
            </select></div>
          <div class="field"><label>Effectif</label><input data-field="effectif" value="${f(p.effectif)}" placeholder="Ex: 11v11, 5v3…" ${dis}></div>
          <div class="field"><label>Taille terrain</label><input data-field="taille_terrain" value="${f(p.taille_terrain)}" placeholder="Ex: 30×20m" ${dis}></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Nb séquences</label>
            <input data-field="nb_sequences" type="number" min="1" step="1" value="${p.nb_sequences ?? ''}" placeholder="Ex: 3" ${dis}></div>
          <div class="field"><label>Durée séquence (min)</label>
            <input data-field="duree_sequence_min" type="text" inputmode="decimal" value="${decStr(p.duree_sequence_min)}" placeholder="Ex: 1,5" ${dis}></div>
          <div class="field"><label>Récup (min)</label>
            <input data-field="temps_recup_min" type="text" inputmode="decimal" value="${decStr(p.temps_recup_min)}" placeholder="Ex: 0,5" ${dis}></div>
          <div class="field"><label>Récapitulatif</label>
            <input value="${escapeHtml(sequenceLabel(p))}" readonly tabindex="-1"
                   title="Travail ${fmtMin(workMin(p))}' · récup ${fmtMin(recupMin(p))}' · total ${fmtMin(totalMin(p))}'"></div>
        </div>
        <div class="field"><label>Consignes</label><textarea data-field="consignes" placeholder="Instructions détaillées…" ${dis}>${f(p.consignes)}</textarea></div>
        <div class="field"><label>Comportements individuels</label><textarea data-field="comportements_individuels" placeholder="Ex: Présenter le pied…" ${dis}>${f(p.comportements_individuels)}</textarea></div>
      </div>
      <div>
        <label>Schéma tactique</label>
        <div class="schema-box" data-schema-box>${tac}</div>
        <div class="schema-recap">Procédé ${index + 1} / ${procedures.length} · ${escapeHtml(sequenceLabel(p))}</div>
      </div>
      ${procExtrasHtml(p)}
    </div>
  </div>`;
}

/* ---------- Schéma tactique d'un procédé ----------
   Procédé enregistré : son schéma (tactical_schemas). Procédé pas encore
   enregistré : un brouillon dessiné tout de suite (tactical-board.html
   ?draft=…), gardé dans le navigateur et rattaché au procédé par la
   sauvegarde automatique (commitDraftSchemas). */
const lsJson = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { console.warn('Brouillon illisible', key, e); return null; } };
const schemaUrl = (path, v) => `${sb.storage.from('schemas').getPublicUrl(path).data.publicUrl}${v ? `?v=${v}` : ''}`;
function schemaBoxHtml(p) {
  if (p.id) {
    return `${p.image_path ? `<img class="schema-thumb" src="${escapeHtml(schemaUrl(p.image_path, p.image_v))}" alt="Schéma du procédé" loading="lazy">` : '<p class="schema-empty">Aucun schéma pour ce procédé.</p>'}
       <button class="btn btn-sm" type="button" onclick="openBoard(${p.id})">${p.image_path ? 'Modifier le schéma →' : 'Dessiner le schéma →'}</button>
       ${p.video_id ? `<button class="btn btn-sm" type="button" onclick="openLinkedVideo(${p.video_id})">▶ Vidéo liée</button>` : ''}`;
  }
  if (!CAN_WRITE) return '<p class="schema-empty">Aucun schéma pour ce procédé.</p>';
  const meta = p.draft_key && lsJson('tb_draftmeta_' + p.draft_key);
  const started = p.draft_key && localStorage.getItem('tb_draft_' + p.draft_key);
  if (meta || started) {
    return `${meta?.image_path ? `<img class="schema-thumb" src="${escapeHtml(schemaUrl(meta.image_path, meta.at))}" alt="Aperçu du schéma">` : ''}
      <p class="schema-empty">${meta ? 'Schéma prêt : il est rattaché au procédé dès que la séance est enregistrée (titre et date).' : 'Schéma commencé : cliquez « Enregistrer » dans le tableau.'}</p>
      <button class="btn btn-sm" type="button" onclick="openDraftBoard('${p._uid}')">Modifier le schéma →</button>`;
  }
  return `<button class="btn btn-sm btn-primary" type="button" onclick="openDraftBoard('${p._uid}')">Dessiner le schéma →</button>
    <p class="schema-empty">Le schéma est rattaché au procédé dès que la séance est enregistrée.</p>`;
}
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
    if (p) { p.image_path = m.image_path; p.image_v = m.at; refreshSchemaBox(p); }
  }
});
/* À la sauvegarde : chaque brouillon enregistré dans le tableau (« Enregistrer »,
   tb_draftmeta_*) devient le schéma de son procédé, désormais enregistré (image
   copiée à sa place définitive). Le procédé garde sa clé : si le tableau est
   encore ouvert et enregistre de nouveau, le schéma suit. */
async function commitDraftSchemas() {
  for (const p of procedures.filter(x => x.draft_key && x.id)) {
    const json = lsJson('tb_draft_' + p.draft_key);
    const meta = lsJson('tb_draftmeta_' + p.draft_key);
    if (!json || !meta) continue;
    let image_path = null;
    if (meta?.image_path) {
      const dest = `${myProfile.club_id}/procedure-${p.id}.png`;
      const { error: rmErr } = await sb.storage.from('schemas').remove([dest]);   // copy() n'écrase pas
      if (rmErr) console.warn('Ancienne image du procédé non retirée', rmErr);
      const { error: cpErr } = await sb.storage.from('schemas').copy(meta.image_path, dest);
      if (cpErr) console.warn('Image du brouillon non copiée : elle sera refaite à la prochaine ouverture du tableau', cpErr);
      else image_path = dest;
    }
    const { error } = await sb.from('tactical_schemas').upsert({
      procedure_id: p.id, canvas_json: json, image_path, vue_terrain: json.view || 'complet',
    }, { onConflict: 'procedure_id' });
    if (error) throw error;
    if (meta?.image_path && image_path) {
      const { error: delErr } = await sb.storage.from('schemas').remove([meta.image_path]);
      if (delErr) console.warn('Image de brouillon restée dans le stockage', delErr);
    }
    localStorage.removeItem('tb_draft_' + p.draft_key);
    localStorage.removeItem('tb_draftmeta_' + p.draft_key);
    p.image_path = image_path; p.image_v = Date.now();
    refreshSchemaBox(p);
  }
}

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

/* Chasubles lues en base : toujours { nom, couleur, player_ids[] }. */
function cleanTeams(list) {
  return (Array.isArray(list) ? list : []).map(t => ({
    nom: t.nom || 'Équipe', couleur: t.couleur || '#1f6feb',
    player_ids: Array.isArray(t.player_ids) ? t.player_ids.map(Number) : [],
  }));
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
