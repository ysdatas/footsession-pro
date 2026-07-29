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
let uidSeq = 1;
const nextUid = () => 'p' + (uidSeq++);

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
  document.getElementById('attendanceToggle').addEventListener('click', () => document.querySelector('.attendance').classList.toggle('open'));
  document.getElementById('proceduresList').addEventListener('input', (e) => {
    if (e.target.classList.contains('proc-duree') || e.target.classList.contains('proc-name')) updateMeta();
  });

  if (EDITOR_MODE === 'edit') {
    document.getElementById('editorTitle').innerHTML = 'Modifier la séance <span class="badge badge-gold">ÉDITION</span>';
    const pdfBtn = document.getElementById('btnExportPdf');
    pdfBtn?.classList.remove('hidden');
    pdfBtn?.addEventListener('click', () => window.generateSessionPDF(SESSION_ID));
    await loadSession();
  } else {
    document.getElementById('f-date').value = new Date().toISOString().slice(0, 10);
    await loadPlayersForNew();
    addProcedure({ nom: 'Échauffement', duree_min: 15 });
  }
  renderProcedures();
  renderAttendance();
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

    document.getElementById('f-titre').value = s.titre || '';
    document.getElementById('f-date').value = s.date_seance || '';
    document.getElementById('f-categorie').value = s.categorie || '';
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
    image_path: null, expanded: true,
  });
  renderProcedures();
  updateMeta();
}

/* ---------- Bibliothèque d'exercices (modèles réutilisables) ---------- */
const TPL_FIELDS = ['nom', 'duree_min', 'objectif', 'effectif', 'taille_terrain',
  'consignes', 'principes_jeu', 'comportements_individuels', 'temps_recup_min'];

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
      club_id: myProfile.club_id, nom, categorie: document.getElementById('f-categorie').value.trim() || null, data, image_path,
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
        <input class="proc-duree" data-field="duree_min" type="number" min="0" step="5" value="${Number(p.duree_min) || 0}" ${dis}>
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
          <div class="field"><label>Effectif</label><input data-field="effectif" value="${f(p.effectif)}" placeholder="Ex: 11v11, 5v3…" ${dis}></div>
          <div class="field"><label>Taille terrain</label><input data-field="taille_terrain" value="${f(p.taille_terrain)}" placeholder="Ex: 30×20m" ${dis}></div>
          <div class="field"><label>Récup (min)</label><input data-field="temps_recup_min" type="number" min="0" value="${p.temps_recup_min ?? ''}" ${dis}></div>
        </div>
        <div class="field"><label>Consignes</label><textarea data-field="consignes" placeholder="Instructions détaillées…" ${dis}>${f(p.consignes)}</textarea></div>
        <div class="field"><label>Principes de jeu</label><textarea data-field="principes_jeu" placeholder="Ex: Conservation, transitions…" ${dis}>${f(p.principes_jeu)}</textarea></div>
        <div class="field"><label>Comportements individuels</label><textarea data-field="comportements_individuels" placeholder="Ex: Présenter le pied…" ${dis}>${f(p.comportements_individuels)}</textarea></div>
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
      else if (k === 'temps_recup_min') p[k] = inp.value === '' ? '' : Number(inp.value);
      else p[k] = inp.value;
    });
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
};
function updatePresentCount() {
  const n = attendance.filter(a => a.present).length;
  document.getElementById('presentCount').textContent = `${n} marqué${n > 1 ? 's' : ''}`;
}

/* ---------- Méta ---------- */
function updateMeta() {
  let total = 0;
  document.querySelectorAll('#proceduresList .proc-duree').forEach(i => total += (Number(i.value) || 0));
  const n = procedures.length;
  document.getElementById('editorMeta').textContent = `${n} procédé${n > 1 ? 's' : ''} · ${total} min au total`;
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
    categorie: document.getElementById('f-categorie').value.trim() || null,
    equipe: document.getElementById('f-equipe').value.trim() || null,
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
