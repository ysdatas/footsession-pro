/* ============================================================
   FootSession Pro — session.js
   Éditeur de séance : procédés dynamiques, présences, sauvegarde.
   ============================================================ */

const API_SESSIONS = 'php/api/sessions.php';
const API_PLAYERS  = 'php/api/players.php';

let procedures = [];   // {_uid,id?,nom,duree_min,objectif,effectif,postes_cibles,zones_jeu,
                       //  taille_terrain,consignes,principes_jeu,comportements_individuels,
                       //  canvas_image?,vue_terrain?,expanded}
let attendance = [];   // {player_id,nom,prenom,numero,poste,present}
let uidSeq = 1;
const nextUid = () => 'p' + (uidSeq++);

const PROC_TEXTAREAS = ['objectif', 'consignes', 'principes_jeu', 'comportements_individuels'];
const PROC_INPUTS    = ['effectif', 'postes_cibles', 'zones_jeu', 'taille_terrain'];

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  $('#btnAddProc').addEventListener('click', () => addProcedure());
  $('#btnAddProc2').addEventListener('click', () => addProcedure());
  $('#btnSave').addEventListener('click', save);
  $('#btnExportPdf').addEventListener('click', exportPdf);
  $('#btnLibrary').addEventListener('click', openLibrary);
  $('#attendanceToggle').addEventListener('click', () => $('.attendance').classList.toggle('open'));

  // Recalcul live du total / compteur présents.
  $('#proceduresList').addEventListener('input', (e) => {
    if (e.target.classList.contains('proc-duree') || e.target.classList.contains('proc-name')) updateMeta();
  });

  if (window.EDITOR_MODE === 'edit' && window.SESSION_ID) {
    await loadSession(window.SESSION_ID);
  } else {
    $('#f-date').value = new Date().toISOString().slice(0, 10);
    await loadPlayersForNew();
    addProcedure({ nom: 'Échauffement', duree_min: 15 });
  }
  renderProcedures();
  renderAttendance();
  updateMeta();
  if (window.EDITOR_MODE === 'edit' && $('#commentList')) initCellule();
}

/* ---------- Commentaires & partage (cellule) ---------- */
let shareToken = null;
function initCellule() {
  loadComments();
  $('#commentSend').addEventListener('click', sendComment);
  $('#shareToggle').addEventListener('click', () => shareToken ? unshare() : doShare());
  renderShare();
}
async function loadComments() {
  try {
    const d = await API(`php/api/comments.php?action=list&session_id=${window.SESSION_ID}`);
    const me = d.me;
    $('#commentList').innerHTML = d.comments.length ? d.comments.map(c => `
      <div class="comment">
        <div class="comment-head"><strong>${escapeHtml(c.author_name)}</strong>
          ${c.role ? `<span class="badge">${escapeHtml(({admin:'Admin',coach:'Coach',analyste:'Analyste',prepa:'Prépa',viewer:'Viewer'})[c.role] || c.role)}</span>` : ''}
          <span class="text-muted">${(c.created_at || '').slice(0, 16).replace('T', ' ')}</span>
          <button class="comment-del" type="button" onclick="delComment(${c.id}, this)" title="Supprimer">×</button>
        </div>
        <div class="comment-body">${escapeHtml(c.body)}</div>
      </div>`).join('') : '<p class="text-muted">Aucun commentaire.</p>';
  } catch (e) { $('#commentList').innerHTML = `<p class="text-danger">${escapeHtml(e.message)}</p>`; }
}
async function sendComment() {
  const body = $('#commentInput').value.trim(); if (!body) return;
  try { await API('php/api/comments.php?action=add', { method: 'POST', body: { session_id: window.SESSION_ID, body } }); $('#commentInput').value = ''; loadComments(); }
  catch (e) { toast(e.message, 'error'); }
}
window.delComment = async (id, btn) => {
  try { await API('php/api/comments.php?action=delete', { method: 'POST', body: { id } }); btn.closest('.comment').remove(); }
  catch (e) { toast(e.message, 'error'); }
};
function renderShare() {
  const area = $('#shareArea');
  if (shareToken) {
    const url = baseUrl('share.php') + '?token=' + shareToken;
    area.innerHTML = `<input readonly value="${url}" onclick="this.select()" style="margin-bottom:8px;">
      <div class="flex gap-sm"><button class="btn btn-sm" type="button" id="shareCopy">Copier</button>
      <button class="btn btn-sm btn-danger" type="button" id="shareToggle">Désactiver</button></div>`;
    $('#shareCopy').addEventListener('click', () => { navigator.clipboard?.writeText(url); toast('Lien copié', 'success'); });
    $('#shareToggle').addEventListener('click', unshare);
  } else {
    area.innerHTML = `<button class="btn btn-primary" id="shareToggle" type="button">Générer un lien</button>`;
    $('#shareToggle').addEventListener('click', doShare);
  }
}
async function doShare() {
  try { const d = await API(`php/api/sessions.php?action=share&id=${window.SESSION_ID}`, { method: 'POST', body: {} }); shareToken = d.token; renderShare(); toast('Lien de partage activé', 'success'); }
  catch (e) { toast(e.message, 'error'); }
}
async function unshare() {
  try { await API(`php/api/sessions.php?action=unshare&id=${window.SESSION_ID}`, { method: 'POST', body: {} }); shareToken = null; renderShare(); toast('Partage désactivé', 'success'); }
  catch (e) { toast(e.message, 'error'); }
}

/* ---------- Chargement ---------- */
async function loadSession(id) {
  try {
    const data = await API(`${API_SESSIONS}?action=get&id=${id}`);
    const s = data.session;
    shareToken = s.share_token || null;
    $('#f-titre').value = s.titre || '';
    $('#f-date').value = s.date_seance || '';
    $('#f-categorie').value = s.categorie || '';
    $('#f-equipe').value = s.equipe || '';
    $('#f-duree').value = s.duree_min || 90;
    $('#editorSubtitle').textContent = `Créée le ${s.created_at?.slice(0, 10) || ''}`;

    procedures = (data.procedures || []).map(p => ({
      _uid: nextUid(), id: Number(p.id), nom: p.nom || '', duree_min: Number(p.duree_min) || 20,
      objectif: p.objectif || '', effectif: p.effectif || '', postes_cibles: p.postes_cibles || '',
      zones_jeu: p.zones_jeu || '', taille_terrain: p.taille_terrain || '', consignes: p.consignes || '',
      principes_jeu: p.principes_jeu || '', comportements_individuels: p.comportements_individuels || '',
      intensite: p.intensite ?? '', temps_recup_min: p.temps_recup_min ?? '',
      canvas_image: p.canvas_image || null, vue_terrain: p.vue_terrain || null, expanded: false,
    }));
    attendance = (data.attendance || []).map(a => ({
      player_id: Number(a.player_id), nom: a.nom, prenom: a.prenom,
      numero: a.numero, poste: a.poste, present: Number(a.present) === 1,
    }));
  } catch (e) { toast(e.message, 'error'); }
}

async function loadPlayersForNew() {
  try {
    const data = await API(`${API_PLAYERS}?action=list`);
    attendance = (data.players || []).map(p => ({
      player_id: Number(p.id), nom: p.nom, prenom: p.prenom,
      numero: p.numero, poste: p.poste, present: false,
    }));
  } catch (e) { attendance = []; }
}

/* ---------- Procédés ---------- */
function addProcedure(data = {}) {
  syncFromDom();
  procedures.push({
    _uid: nextUid(), nom: data.nom || '', duree_min: data.duree_min || 20,
    objectif: data.objectif || '', effectif: data.effectif || '', postes_cibles: data.postes_cibles || '',
    zones_jeu: data.zones_jeu || '', taille_terrain: data.taille_terrain || '',
    consignes: data.consignes || '', principes_jeu: data.principes_jeu || '',
    comportements_individuels: data.comportements_individuels || '',
    intensite: data.intensite ?? '', temps_recup_min: data.temps_recup_min ?? '',
    canvas_image: null, expanded: true,
  });
  renderProcedures();
  updateMeta();
}

/* ---------- Bibliothèque d'exercices (modèles) ---------- */
const TPL_FIELDS = ['nom', 'duree_min', 'objectif', 'effectif', 'postes_cibles', 'zones_jeu',
  'taille_terrain', 'consignes', 'principes_jeu', 'comportements_individuels', 'intensite', 'temps_recup_min'];

window.saveAsTemplate = async (uid) => {
  syncFromDom();
  const p = procedures.find(x => x._uid === uid); if (!p) return;
  const nom = prompt('Nom du modèle :', p.nom || 'Exercice'); if (!nom) return;
  const data = {}; TPL_FIELDS.forEach(k => data[k] = p[k]);
  try {
    await API('php/api/templates.php?action=create', { method: 'POST', body: { nom, categorie: $('#f-categorie').value.trim(), data, canvas_image: p.canvas_image || null } });
    toast('Modèle enregistré dans la bibliothèque', 'success');
  } catch (e) { toast(e.message, 'error'); }
};

async function openLibrary() {
  openModal('libraryModal');
  const list = $('#libraryList'); list.innerHTML = '<p class="text-muted">Chargement…</p>';
  try {
    const d = await API('php/api/templates.php?action=list');
    if (!d.templates.length) { list.innerHTML = '<p class="text-muted">Aucun modèle enregistré. Cliquez sur ☆ sur un procédé pour en créer un.</p>'; return; }
    list.innerHTML = d.templates.map(t => `
      <div class="library-card">
        ${t.canvas_image ? `<img src="${t.canvas_image}" alt="">` : '<div class="lib-noimg">Sans schéma</div>'}
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
    const d = await API(`php/api/templates.php?action=get&id=${id}`);
    const data = JSON.parse(d.template.data || '{}');
    addProcedure(data);
    closeModal('libraryModal');
    toast('Procédé ajouté depuis la bibliothèque', 'success');
  } catch (e) { toast(e.message, 'error'); }
};
window.deleteTemplate = async (id, btn) => {
  if (!confirm('Supprimer ce modèle ?')) return;
  try { await API('php/api/templates.php?action=delete', { method: 'POST', body: { id } }); btn.closest('.library-card').remove(); }
  catch (e) { toast(e.message, 'error'); }
};

function procTemplate(p, index) {
  const f = (name, val) => escapeHtml(val ?? '');
  const tac = p.id
    ? `<img class="schema-thumb" src="${p.canvas_image || ''}" alt="Schéma" style="${p.canvas_image ? '' : 'display:none'}"
            onclick="openBoard(${p.id})">
       ${p.canvas_image ? '' : '<p class="schema-empty">Aucun schéma pour ce procédé.</p>'}
       <button class="btn btn-sm" type="button" onclick="openBoard(${p.id})">Ouvrir le tableau tactique →</button>`
    : `<p class="schema-empty">Enregistrez la séance pour lier un schéma tactique à ce procédé.</p>`;

  return `
  <div class="proc ${p.expanded ? 'expanded' : ''}" data-uid="${p._uid}">
    <div class="proc-head">
      <span class="proc-num">${index + 1}</span>
      <input class="proc-name" data-field="nom" value="${f('nom', p.nom)}" placeholder="Nom du procédé">
      <div class="proc-head-right">
        <span class="proc-dot"></span>
        <input class="proc-duree" data-field="duree_min" type="number" min="0" step="5" value="${Number(p.duree_min) || 0}">
        <span class="proc-unit">min</span>
        <button class="proc-btn" type="button" title="Monter"    onclick="moveProc('${p._uid}',-1)">▲</button>
        <button class="proc-btn" type="button" title="Descendre" onclick="moveProc('${p._uid}',1)">▼</button>
        <button class="proc-btn" type="button" title="Enregistrer comme modèle" onclick="saveAsTemplate('${p._uid}')">☆</button>
        <button class="proc-btn danger" type="button" title="Supprimer" onclick="removeProc('${p._uid}')">×</button>
        <button class="proc-btn" type="button" title="Détails" onclick="toggleProc('${p._uid}')">▾</button>
      </div>
    </div>
    <div class="proc-body">
      <div class="proc-fields">
        <div class="field"><label>Objectif</label><textarea data-field="objectif" placeholder="But de l'exercice…">${f('o', p.objectif)}</textarea></div>
        <div class="field-row">
          <div class="field"><label>Effectif</label><input data-field="effectif" value="${f('e', p.effectif)}" placeholder="Ex: 11v11, 5v3…"></div>
          <div class="field"><label>Postes ciblés</label><input data-field="postes_cibles" value="${f('p', p.postes_cibles)}" placeholder="Ex: Milieux"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Taille terrain</label><input data-field="taille_terrain" value="${f('t', p.taille_terrain)}" placeholder="Ex: 30×20m"></div>
          <div class="field"><label>Intensité (RPE 1–10)</label><input data-field="intensite" type="number" min="1" max="10" value="${p.intensite ?? ''}" placeholder="1 à 10"></div>
          <div class="field"><label>Récup (min)</label><input data-field="temps_recup_min" type="number" min="0" value="${p.temps_recup_min ?? ''}" placeholder="Ex: 3"></div>
        </div>
        <div class="field"><label>Consignes</label><textarea data-field="consignes" placeholder="Instructions détaillées…">${f('c', p.consignes)}</textarea></div>
        <div class="field"><label>Principes de jeu</label><textarea data-field="principes_jeu" placeholder="Ex: Conservation, transitions…">${f('pj', p.principes_jeu)}</textarea></div>
        <div class="field"><label>Comportements individuels</label><textarea data-field="comportements_individuels" placeholder="Ex: Présenter le pied…">${f('ci', p.comportements_individuels)}</textarea></div>
      </div>
      <div>
        <label>Schéma tactique</label>
        <div class="schema-box">${tac}</div>
        <div class="schema-recap">Procédé ${index + 1} / ${procedures.length} · ${Number(p.duree_min) || 0} min</div>
      </div>
    </div>
  </div>`;
}

function renderProcedures() {
  $('#proceduresList').innerHTML = procedures.map(procTemplate).join('');
  $('#procCount').textContent = procedures.length;
}

function syncFromDom() {
  $$('#proceduresList .proc').forEach(node => {
    const p = procedures.find(x => x._uid === node.dataset.uid);
    if (!p) return;
    node.querySelectorAll('[data-field]').forEach(inp => {
      const k = inp.dataset.field;
      p[k] = k === 'duree_min' ? (Number(inp.value) || 0) : inp.value;
    });
    p.expanded = node.classList.contains('expanded');
  });
}

window.toggleProc = (uid) => {
  syncFromDom();
  const p = procedures.find(x => x._uid === uid);
  if (p) { p.expanded = !p.expanded; renderProcedures(); }
};
window.removeProc = (uid) => {
  syncFromDom();
  procedures = procedures.filter(x => x._uid !== uid);
  renderProcedures(); updateMeta();
};
window.moveProc = (uid, dir) => {
  syncFromDom();
  const i = procedures.findIndex(x => x._uid === uid);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= procedures.length) return;
  [procedures[i], procedures[j]] = [procedures[j], procedures[i]];
  renderProcedures(); updateMeta();
};
window.openBoard = (procId) => {
  window.open('tactical-board.php?procedure_id=' + procId, '_blank');
};

/* ---------- Présences ---------- */
function renderAttendance() {
  const list = $('#attendanceList');
  if (!attendance.length) {
    list.innerHTML = `<p class="text-muted">Aucun joueur. <a class="text-gold" href="players.php">Ajouter des joueurs</a></p>`;
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
  attendance[i].present = !attendance[i].present;
  $$('#attendanceList .att-item')[i].classList.toggle('present', attendance[i].present);
  updatePresentCount();
};
function updatePresentCount() {
  const n = attendance.filter(a => a.present).length;
  $('#presentCount').textContent = `${n} marqué${n > 1 ? 's' : ''}`;
}

/* ---------- Méta (total durée) ---------- */
function updateMeta() {
  let total = 0;
  $$('#proceduresList .proc-duree').forEach(i => total += (Number(i.value) || 0));
  if (!$$('#proceduresList .proc').length) total = 0;
  const n = procedures.length;
  $('#editorMeta').textContent = `${n} procédé${n > 1 ? 's' : ''} · ${total} min au total`;
  $('#procCount').textContent = n;
}

/* ---------- Sauvegarde ---------- */
function collectPayload() {
  syncFromDom();
  return {
    session: {
      titre: $('#f-titre').value.trim(),
      date_seance: $('#f-date').value,
      categorie: $('#f-categorie').value.trim(),
      equipe: $('#f-equipe').value.trim(),
      duree_min: Number($('#f-duree').value) || 0,
    },
    procedures: procedures.map(p => ({
      id: p.id || undefined, nom: p.nom, duree_min: p.duree_min, objectif: p.objectif,
      effectif: p.effectif, postes_cibles: p.postes_cibles, zones_jeu: p.zones_jeu,
      taille_terrain: p.taille_terrain, consignes: p.consignes, principes_jeu: p.principes_jeu,
      comportements_individuels: p.comportements_individuels,
      intensite: p.intensite, temps_recup_min: p.temps_recup_min,
    })),
    attendance: attendance.map(a => ({ player_id: a.player_id, present: a.present ? 1 : 0 })),
  };
}

async function save() {
  const payload = collectPayload();
  if (!payload.session.titre || !payload.session.date_seance) {
    return toast('Titre et date sont obligatoires.', 'error');
  }
  const btn = $('#btnSave'); btn.disabled = true;
  try {
    if (window.EDITOR_MODE === 'edit' && window.SESSION_ID) {
      await API(`${API_SESSIONS}?action=update&id=${window.SESSION_ID}`, { method: 'POST', body: payload });
      toast('Séance mise à jour', 'success');
      await loadSession(window.SESSION_ID);
      renderProcedures(); renderAttendance(); updateMeta();
    } else {
      const res = await API(`${API_SESSIONS}?action=create`, { method: 'POST', body: payload });
      toast('Séance créée', 'success');
      window.location.href = 'edit-session.php?id=' + res.id;
    }
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function exportPdf() {
  if (!(window.EDITOR_MODE === 'edit' && window.SESSION_ID)) {
    return toast('Enregistrez la séance avant d\'exporter le PDF.', 'error');
  }
  if (typeof window.generateSessionPDF === 'function') window.generateSessionPDF(window.SESSION_ID);
  else toast('Module PDF indisponible.', 'error');
}
