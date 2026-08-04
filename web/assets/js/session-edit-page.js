/* ============================================================
   FootSession Pro — session-edit-page.js (Chemin B / Supabase)
   Création / édition d'une séance : procédés dynamiques, présences.
   ============================================================ */

const SESSION_ID = new URLSearchParams(location.search).get('id') ? Number(new URLSearchParams(location.search).get('id')) : null;
const EDITOR_MODE = SESSION_ID ? 'edit' : 'create';

let myProfile = null;
let CAN_WRITE = false;
let procedures = [];   // {_uid, id?, nom, duree_min, objectif, effectif, taille_terrain,
                        //  consignes, principes_jeu, comportements_individuels, temps_recup_min,
                        //  canvas_image?, expanded}
let attendance = [];   // {player_id, nom, prenom, numero, poste, present}
let teams = [];        // [{nom, couleur, player_ids:[]}] — chasubles de la séance
let activeTeam = 0;    // équipe qui reçoit les joueurs cliqués dans le vivier
let uidSeq = 1;
const nextUid = () => 'p' + (uidSeq++);

/* Couleurs proposées dans l'ordre pour les nouvelles équipes. */
const TEAM_PRESETS = [
  { nom: 'Bleus', couleur: '#1f6feb' },
  { nom: 'Rouges', couleur: '#E03131' },
  { nom: 'Jaunes', couleur: '#F2B21E' },
  { nom: 'Verts', couleur: '#2FA84F' },
];

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  myProfile = ctx.profile;
  CAN_WRITE = canEdit(myProfile.role);

  document.getElementById('uName').textContent = myProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[myProfile.role] || myProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (myProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  if (!CAN_WRITE) {
    document.getElementById('btnSave').classList.add('hidden');
    document.getElementById('btnAddProc').classList.add('hidden');
    document.getElementById('btnAddProc2').classList.add('hidden');
    document.getElementById('btnLibrary')?.classList.add('hidden');
  } else {
    document.getElementById('btnLibrary')?.addEventListener('click', openLibrary);
  }

  document.getElementById('btnAddProc').addEventListener('click', () => addProcedure());
  document.getElementById('btnAddProc2').addEventListener('click', () => addProcedure());
  document.getElementById('btnSave').addEventListener('click', save);
  // Second bouton d'enregistrement au niveau des procédés : évite de
  // remonter en haut de page après chaque modification.
  document.getElementById('btnSaveHere')?.addEventListener('click', save);
  if (!CAN_WRITE) document.getElementById('btnSaveHere')?.classList.add('hidden');

  // Deux blocs dépliables (présences, équipes) : on cible celui du bouton cliqué.
  document.querySelectorAll('#attendanceToggle, #teamsToggle').forEach(btn =>
    btn.addEventListener('click', () => btn.closest('.attendance').classList.toggle('open')));
  document.getElementById('btnAddTeam').addEventListener('click', addTeam);
  if (!CAN_WRITE) document.getElementById('btnAddTeam').classList.add('hidden');
  document.getElementById('proceduresList').addEventListener('input', (e) => {
    if (e.target.classList.contains('proc-duree') || e.target.classList.contains('proc-name')) updateMeta();
    // Les temps se recalculent à la frappe. On met à jour les champs concernés
    // sur place plutôt que de re-générer le HTML, ce qui ferait perdre le focus.
    if (['nb_sequences', 'duree_sequence_min', 'temps_recup_min'].includes(e.target.dataset.field)) {
      refreshProcTimes(e.target.closest('.proc'));
      updateMeta();
    }
  });

  if (EDITOR_MODE === 'edit') {
    document.getElementById('editorTitle').innerHTML = 'Modifier la séance <span class="badge badge-gold">ÉDITION</span>';
    const fullBtn = document.getElementById('btnPdfFull');
    fullBtn?.classList.remove('hidden');
    fullBtn?.addEventListener('click', () => window.generateSessionPDF(SESSION_ID));
    const coachBtn = document.getElementById('btnPdfCoach');
    coachBtn?.classList.remove('hidden');
    coachBtn?.addEventListener('click', () => window.generateCoachPDF(SESSION_ID));
    await loadSession();
  } else {
    document.getElementById('f-date').value = new Date().toISOString().slice(0, 10);
    await loadPlayersForNew();
    addProcedure({ nom: 'Échauffement', duree_min: 15 });
  }
  renderProcedures();
  renderAttendance();
  renderTeams();
  updateMeta();
  if (EDITOR_MODE === 'edit' && document.getElementById('commentList')) initCellule();
})();

/* ---------- Commentaires & partage (cellule) ---------- */
let shareToken = null;
function initCellule() {
  loadComments();
  document.getElementById('commentSend').addEventListener('click', sendComment);
  renderShare();
}
async function loadComments() {
  try {
    // Pas de jointure possible : session_comments.user_id référence auth.users,
    // pas public.profiles. On récupère les rôles des membres du club séparément.
    const [{ data: comments, error }, { data: members }] = await Promise.all([
      sb.from('session_comments').select('id, body, author, created_at, user_id')
        .eq('session_id', SESSION_ID).order('created_at'),
      sb.from('profiles').select('id, nom, role').eq('club_id', myProfile.club_id),
    ]);
    if (error) throw error;
    const byId = {};
    (members || []).forEach(m => byId[m.id] = m);

    document.getElementById('commentList').innerHTML = comments.length ? comments.map(c => {
      const m = byId[c.user_id];
      return `<div class="comment">
        <div class="comment-head"><strong>${escapeHtml(m?.nom || c.author || 'Anonyme')}</strong>
          ${m?.role ? `<span class="badge">${escapeHtml(ROLE_LABELS[m.role] || m.role)}</span>` : ''}
          <span class="text-muted">${(c.created_at || '').slice(0, 16).replace('T', ' ')}</span>
          ${(c.user_id === myProfile.id || myProfile.role === 'admin') ? `<button class="comment-del" type="button" onclick="delComment(${c.id}, this)" title="Supprimer">×</button>` : ''}
        </div>
        <div class="comment-body">${escapeHtml(c.body)}</div>
      </div>`;
    }).join('') : '<p class="text-muted">Aucun commentaire.</p>';
  } catch (e) { document.getElementById('commentList').innerHTML = `<p class="text-danger">${escapeHtml(e.message)}</p>`; }
}
async function sendComment() {
  const body = document.getElementById('commentInput').value.trim(); if (!body) return;
  try {
    const { error } = await sb.from('session_comments').insert({ session_id: SESSION_ID, user_id: myProfile.id, author: myProfile.nom, body });
    if (error) throw error;
    document.getElementById('commentInput').value = '';
    loadComments();
  } catch (e) { toast(e.message, 'error'); }
}
window.delComment = async (id, btn) => {
  try {
    const { error } = await sb.from('session_comments').delete().eq('id', id);
    if (error) throw error;
    btn.closest('.comment').remove();
  } catch (e) { toast(e.message, 'error'); }
};
function renderShare() {
  const area = document.getElementById('shareArea');
  if (shareToken) {
    const url = location.origin + baseUrl('share.html') + '?token=' + shareToken;
    area.innerHTML = `<input readonly value="${url}" onclick="this.select()" style="margin-bottom:8px;">
      <div class="flex gap-sm"><button class="btn btn-sm" type="button" id="shareCopy">Copier</button>
      <button class="btn btn-sm btn-danger" type="button" id="shareToggle">Désactiver</button></div>`;
    document.getElementById('shareCopy').addEventListener('click', () => { navigator.clipboard?.writeText(url); toast('Lien copié', 'success'); });
    document.getElementById('shareToggle').addEventListener('click', unshare);
  } else {
    area.innerHTML = `<button class="btn btn-primary" id="shareToggle" type="button">Générer un lien</button>`;
    document.getElementById('shareToggle').addEventListener('click', doShare);
  }
}
function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join(''); }
async function doShare() {
  try {
    const token = randomToken();
    const { error } = await sb.from('sessions').update({ share_token: token }).eq('id', SESSION_ID);
    if (error) throw error;
    shareToken = token; renderShare(); toast('Lien de partage activé', 'success');
  } catch (e) { toast(e.message, 'error'); }
}
async function unshare() {
  try {
    const { error } = await sb.from('sessions').update({ share_token: null }).eq('id', SESSION_ID);
    if (error) throw error;
    shareToken = null; renderShare(); toast('Partage désactivé', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------- Chargement ---------- */
async function loadSession() {
  try {
    const { data: s, error: e1 } = await sb.from('sessions').select('*').eq('id', SESSION_ID).single();
    if (e1 || !s) { toast('Séance introuvable.', 'error'); setTimeout(() => location.href = 'sessions.html', 1200); return; }
    shareToken = s.share_token || null;
    // Les équipes sont stockées en JSON sur la séance.
    teams = Array.isArray(s.equipes) ? s.equipes.map(t => ({
      nom: t.nom || 'Équipe', couleur: t.couleur || '#1f6feb',
      player_ids: Array.isArray(t.player_ids) ? t.player_ids : [],
    })) : [];

    document.getElementById('f-titre').value = s.titre || '';
    document.getElementById('f-date').value = s.date_seance || '';
    document.getElementById('f-equipe').value = s.equipe || '';
    document.getElementById('f-duree').value = s.duree_min || 90;
    document.getElementById('editorSubtitle').textContent = `Créée le ${(s.created_at || '').slice(0, 10)}`;

    const { data: procs } = await sb.from('procedures')
      .select('*, tactical_schemas(image_path)')
      .eq('session_id', SESSION_ID).order('ordre');
    procedures = (procs || []).map(p => ({
      _uid: nextUid(), id: p.id, nom: p.nom || '', duree_min: p.duree_min || 20,
      objectif: p.objectif || '', effectif: p.effectif || '',
      taille_terrain: p.taille_terrain || '', consignes: p.consignes || '',
      principes_jeu: p.principes_jeu || '', comportements_individuels: p.comportements_individuels || '',
      temps_recup_min: p.temps_recup_min ?? '',
      type_procede: p.type_procede || '', nb_sequences: p.nb_sequences ?? '',
      duree_sequence_min: p.duree_sequence_min ?? '',
      image_path: p.tactical_schemas?.image_path || null, expanded: false,
    }));

    const { data: players } = await sb.from('players').select('id, nom, prenom, numero, poste').order('nom');
    const { data: att } = await sb.from('attendance').select('player_id, present').eq('session_id', SESSION_ID);
    const attMap = {};
    (att || []).forEach(a => attMap[a.player_id] = !!a.present);
    attendance = (players || []).map(p => ({
      player_id: p.id, nom: p.nom, prenom: p.prenom, numero: p.numero, poste: p.poste,
      present: !!attMap[p.id],
    }));
  } catch (e) { toast(e.message, 'error'); }
}

async function loadPlayersForNew() {
  try {
    const { data: players } = await sb.from('players').select('id, nom, prenom, numero, poste').order('nom');
    attendance = (players || []).map(p => ({
      player_id: p.id, nom: p.nom, prenom: p.prenom, numero: p.numero, poste: p.poste, present: false,
    }));
  } catch (e) { attendance = []; }
}

/* ---------- Procédés ---------- */
function addProcedure(data = {}) {
  syncFromDom();
  procedures.push({
    _uid: nextUid(), nom: data.nom || '', duree_min: data.duree_min || 20,
    objectif: data.objectif || '', effectif: data.effectif || '',
    taille_terrain: data.taille_terrain || '', consignes: data.consignes || '',
    principes_jeu: data.principes_jeu || '', comportements_individuels: data.comportements_individuels || '',
    temps_recup_min: data.temps_recup_min ?? '',
    type_procede: data.type_procede || '', nb_sequences: data.nb_sequences ?? '',
    duree_sequence_min: data.duree_sequence_min ?? '',
    image_path: null, expanded: true,
  });
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
            <button class="btn btn-sm btn-danger" type="button" onclick="deleteTemplate(${t.id}, this)">Suppr.</button>
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
  if (!confirm('Supprimer ce modèle ?')) return;
  try {
    const { error } = await sb.from('exercise_templates').delete().eq('id', id);
    if (error) throw error;
    btn.closest('.library-card').remove();
  } catch (e) { toast(e.message, 'error'); }
};

function procTemplate(p, index) {
  const f = (val) => escapeHtml(val ?? '');
  const dis = CAN_WRITE ? '' : 'disabled';
  const tac = p.id
    ? `<p class="schema-empty">${p.image_path ? 'Schéma enregistré.' : 'Aucun schéma pour ce procédé.'}</p>
       <button class="btn btn-sm" type="button" onclick="openBoard(${p.id})">Ouvrir le tableau tactique →</button>`
    : `<p class="schema-empty">Enregistrez la séance pour lier un schéma tactique à ce procédé.</p>`;

  return `
  <div class="proc ${p.expanded ? 'expanded' : ''}" data-uid="${p._uid}">
    <div class="proc-head">
      <span class="proc-num">${index + 1}</span>
      <input class="proc-name" data-field="nom" value="${f(p.nom)}" placeholder="Nom du procédé" ${dis}>
      <div class="proc-head-right">
        <span class="proc-dot"></span>
        <input class="proc-duree" data-field="duree_min" type="number" min="0" step="5"
               value="${hasSequences(p) ? totalMin(p) : (Number(p.duree_min) || 0)}"
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
            <input data-field="duree_sequence_min" type="number" min="0" step="0.5" value="${p.duree_sequence_min ?? ''}" placeholder="Ex: 4" ${dis}></div>
          <div class="field"><label>Récup (min)</label>
            <input data-field="temps_recup_min" type="number" min="0" step="0.5" value="${p.temps_recup_min ?? ''}" placeholder="Ex: 1" ${dis}></div>
          <div class="field"><label>Récapitulatif</label>
            <input value="${escapeHtml(sequenceLabel(p))}" readonly tabindex="-1"
                   title="Travail ${fmtMin(workMin(p))}' · récup ${fmtMin(recupMin(p))}' · total ${fmtMin(totalMin(p))}'"></div>
        </div>
        <div class="field"><label>Consignes</label><textarea data-field="consignes" placeholder="Instructions détaillées…" ${dis}>${f(p.consignes)}</textarea></div>
        <div class="field"><label>Principes de jeu</label><textarea data-field="principes_jeu" placeholder="Ex: Conservation, transitions…" ${dis}>${f(p.principes_jeu)}</textarea></div>
        <div class="field"><label>Comportements individuels</label><textarea data-field="comportements_individuels" placeholder="Ex: Présenter le pied…" ${dis}>${f(p.comportements_individuels)}</textarea></div>
      </div>
      <div>
        <label>Schéma tactique</label>
        <div class="schema-box">${tac}</div>
        <div class="schema-recap">Procédé ${index + 1} / ${procedures.length} · ${escapeHtml(sequenceLabel(p))}</div>
      </div>
    </div>
  </div>`;
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
    if (['nb_sequences', 'duree_sequence_min', 'temps_recup_min'].includes(k)) {
      p[k] = inp.value === '' ? '' : Number(inp.value);
    }
  });

  const dureeInput = node.querySelector('.proc-duree');
  if (dureeInput) {
    if (hasSequences(p)) {
      p.duree_min = totalMin(p);
      dureeInput.value = p.duree_min;
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
}

function syncFromDom() {
  document.querySelectorAll('#proceduresList .proc').forEach(node => {
    const p = procedures.find(x => x._uid === node.dataset.uid);
    if (!p) return;
    node.querySelectorAll('[data-field]').forEach(inp => {
      const k = inp.dataset.field;
      if (k === 'duree_min') p[k] = Number(inp.value) || 0;
      else if (['temps_recup_min', 'nb_sequences', 'duree_sequence_min'].includes(k)) {
        p[k] = inp.value === '' ? '' : Number(inp.value);
      }
      else p[k] = inp.value;
    });
    // La structure en séquences fait foi sur la durée saisie librement.
    if (hasSequences(p)) p.duree_min = totalMin(p);
    p.expanded = node.classList.contains('expanded');
  });
}

window.toggleProc = (uid) => { syncFromDom(); const p = procedures.find(x => x._uid === uid); if (p) { p.expanded = !p.expanded; renderProcedures(); } };
window.removeProc = (uid) => { syncFromDom(); procedures = procedures.filter(x => x._uid !== uid); renderProcedures(); updateMeta(); };
window.moveProc = (uid, dir) => {
  syncFromDom();
  const i = procedures.findIndex(x => x._uid === uid), j = i + dir;
  if (i < 0 || j < 0 || j >= procedures.length) return;
  [procedures[i], procedures[j]] = [procedures[j], procedures[i]];
  renderProcedures(); updateMeta();
};
window.openBoard = (procId) => { window.open('tactical-board.html?procedure_id=' + procId, '_blank'); };

/* ---------- Présences ---------- */
/* ============================================================
   ÉQUIPES DE TRAVAIL (chasubles)
   ============================================================ */
const playerName = (a) => `${a.prenom || ''} ${a.nom}`.trim();

function addTeam() {
  const preset = TEAM_PRESETS[teams.length % TEAM_PRESETS.length];
  teams.push({ nom: preset.nom, couleur: preset.couleur, player_ids: [] });
  activeTeam = teams.length - 1;
  renderTeams();
}

window.removeTeam = (i) => {
  teams.splice(i, 1);
  if (activeTeam >= teams.length) activeTeam = Math.max(0, teams.length - 1);
  renderTeams();
};

window.setActiveTeam = (i) => { activeTeam = i; renderTeams(); };

/* Affecte un joueur à l'équipe active. Un joueur n'appartient qu'à une
   seule équipe : on le retire d'abord de toutes les autres. */
window.assignToTeam = (playerId) => {
  if (!teams.length) { toast('Ajoutez d\'abord une équipe.', 'error'); return; }
  teams.forEach(t => t.player_ids = t.player_ids.filter(id => id !== playerId));
  teams[activeTeam].player_ids.push(playerId);
  renderTeams();
};

window.unassignPlayer = (playerId) => {
  teams.forEach(t => t.player_ids = t.player_ids.filter(id => id !== playerId));
  renderTeams();
};

function renderTeams() {
  const wrap = document.getElementById('teamsList');
  if (!wrap) return;
  const dis = CAN_WRITE ? '' : 'disabled';
  const presents = attendance.filter(a => a.present);

  // Un joueur devenu absent ne doit pas rester dans une équipe.
  const presentIds = presents.map(a => a.player_id);
  teams.forEach(t => t.player_ids = t.player_ids.filter(id => presentIds.includes(id)));

  const assigned = new Set(teams.flatMap(t => t.player_ids));
  const pool = presents.filter(a => !assigned.has(a.player_id));

  const chip = (a, onclick) => {
    const num = a.numero != null ? `<span class="num">#${a.numero}</span>` : '';
    return `<span class="pchip" ${CAN_WRITE ? `onclick="${onclick}"` : ''}>${escapeHtml(playerName(a))}${num}</span>`;
  };

  const blocks = teams.map((t, i) => {
    const members = t.player_ids
      .map(id => presents.find(a => a.player_id === id))
      .filter(Boolean);
    return `
    <div class="team-block ${i === activeTeam ? 'active' : ''}" onclick="setActiveTeam(${i})">
      <div class="team-head">
        <span class="team-dot" style="background:${escapeHtml(t.couleur)}"></span>
        <input type="text" data-team="${i}" data-tfield="nom" value="${escapeHtml(t.nom)}" placeholder="Nom de l'équipe" ${dis}>
        <input type="color" data-team="${i}" data-tfield="couleur" value="${escapeHtml(t.couleur)}" title="Couleur de la chasuble" ${dis}>
        <span class="team-count">${members.length} joueur${members.length > 1 ? 's' : ''}</span>
        ${CAN_WRITE ? `<button class="btn btn-sm btn-danger" type="button" onclick="event.stopPropagation();removeTeam(${i})">Suppr.</button>` : ''}
      </div>
      <div class="team-chips">
        ${members.map(a => chip(a, `event.stopPropagation();unassignPlayer(${a.player_id})`)).join('')}
      </div>
    </div>`;
  }).join('');

  const poolHtml = !presents.length
    ? `<p class="text-muted" style="font-size:.85rem;">Marquez d'abord des joueurs présents ci-dessus.</p>`
    : `<div class="team-pool">
         <div class="team-pool-label">Vivier — présents non affectés (${pool.length})</div>
         <div class="team-chips">${pool.map(a => chip(a, `assignToTeam(${a.player_id})`)).join('')}</div>
       </div>`;

  wrap.innerHTML = (blocks || `<p class="text-muted" style="font-size:.85rem;">Aucune équipe. Cliquez sur « Ajouter une équipe ».</p>`) + poolHtml;

  const n = teams.length;
  document.getElementById('teamsCount').textContent = `${n} équipe${n > 1 ? 's' : ''}`;

  // Nom et couleur : on écrit dans l'état sans re-générer le HTML à chaque frappe.
  wrap.querySelectorAll('[data-tfield]').forEach(inp => {
    inp.addEventListener('click', e => e.stopPropagation());
    inp.addEventListener('input', () => {
      const t = teams[Number(inp.dataset.team)];
      if (!t) return;
      t[inp.dataset.tfield] = inp.value;
      if (inp.dataset.tfield === 'couleur') {
        inp.closest('.team-head').querySelector('.team-dot').style.background = inp.value;
      }
    });
  });
}

function renderAttendance() {
  const list = document.getElementById('attendanceList');
  if (!attendance.length) {
    list.innerHTML = `<p class="text-muted">Aucun joueur. <a class="text-gold" href="players.html">Ajouter des joueurs</a></p>`;
    updatePresentCount(); return;
  }
  list.innerHTML = attendance.map((a, i) => {
    const name = escapeHtml(`${a.prenom || ''} ${a.nom}`.trim());
    const meta = [a.numero ? '#' + a.numero : '', a.poste || ''].filter(Boolean).join(' · ');
    return `<div class="att-item ${a.present ? 'present' : ''}" data-i="${i}" onclick="toggleAtt(${i})">
              <span class="att-check">✓</span>
              <div><div class="att-name">${name}</div><div class="att-meta">${escapeHtml(meta)}</div></div>
            </div>`;
  }).join('');
  updatePresentCount();
}
window.toggleAtt = (i) => {
  if (!CAN_WRITE) return;
  attendance[i].present = !attendance[i].present;
  document.querySelectorAll('#attendanceList .att-item')[i].classList.toggle('present', attendance[i].present);
  updatePresentCount();
  renderTeams();   // le vivier suit les présences
};
function updatePresentCount() {
  const n = attendance.filter(a => a.present).length;
  document.getElementById('presentCount').textContent = `${n} marqué${n > 1 ? 's' : ''}`;
}

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

/* ---------- Sauvegarde ---------- */
async function save() {
  syncFromDom();
  const titre = document.getElementById('f-titre').value.trim();
  const date_seance = document.getElementById('f-date').value;
  if (!titre || !date_seance) return toast('Titre et date sont obligatoires.', 'error');

  const sessionRow = {
    titre, date_seance,
    equipe: document.getElementById('f-equipe').value.trim() || null,
    equipes: teams.map(t => ({ nom: (t.nom || '').trim() || 'Équipe', couleur: t.couleur, player_ids: t.player_ids })),
    duree_min: Number(document.getElementById('f-duree').value) || 0,
  };

  const btn = document.getElementById('btnSave'); btn.disabled = true;
  try {
    let sid = SESSION_ID;
    if (sid) {
      const { error } = await sb.from('sessions').update(sessionRow).eq('id', sid);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from('sessions').insert({ ...sessionRow, club_id: myProfile.club_id }).select('id').single();
      if (error) throw error;
      sid = data.id;
    }

    await saveProcedures(sid);
    await saveAttendance(sid);

    if (SESSION_ID) {
      toast('Séance mise à jour', 'success');
      location.reload();
    } else {
      toast('Séance créée', 'success');
      location.href = 'session-edit.html?id=' + sid;
    }
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

async function saveProcedures(sid) {
  const { data: existing } = await sb.from('procedures').select('id').eq('session_id', sid);
  const existingIds = (existing || []).map(r => r.id);
  const keep = [];

  let ordre = 1;
  for (const p of procedures) {
    const row = {
      session_id: sid, ordre: ordre++, nom: p.nom.trim() || 'Procédé', duree_min: p.duree_min || 0,
      objectif: p.objectif || null, effectif: p.effectif || null,
      taille_terrain: p.taille_terrain || null, consignes: p.consignes || null,
      principes_jeu: p.principes_jeu || null, comportements_individuels: p.comportements_individuels || null,
      temps_recup_min: p.temps_recup_min === '' ? null : p.temps_recup_min,
      type_procede: p.type_procede || null,
      nb_sequences: p.nb_sequences === '' ? null : p.nb_sequences,
      duree_sequence_min: p.duree_sequence_min === '' ? null : p.duree_sequence_min,
    };
    if (p.id && existingIds.includes(p.id)) {
      const { error } = await sb.from('procedures').update(row).eq('id', p.id);
      if (error) throw error;
      keep.push(p.id);
    } else {
      const { data, error } = await sb.from('procedures').insert(row).select('id').single();
      if (error) throw error;
      p.id = data.id;
      keep.push(data.id);
    }
  }
  const toDelete = existingIds.filter(id => !keep.includes(id));
  if (toDelete.length) {
    const { error } = await sb.from('procedures').delete().in('id', toDelete);
    if (error) throw error;
  }
}

async function saveAttendance(sid) {
  if (!attendance.length) return;
  const rows = attendance.map(a => ({ player_id: a.player_id, session_id: sid, present: !!a.present }));
  const { error } = await sb.from('attendance').upsert(rows, { onConflict: 'player_id,session_id' });
  if (error) throw error;
}
