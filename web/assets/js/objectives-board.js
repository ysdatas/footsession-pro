/* ============================================================
   LMFC Performance — objectives-board.js
   Performance → Objectifs : tous les objectifs de l'effectif sur
   un seul écran, sans ouvrir chaque fiche joueur.
     - « + Ajouter un objectif » : un ou plusieurs joueurs cochés,
       un titre, une description, un statut. Un objectif par joueur
       est créé (une ligne player_performance_notes chacun).
     - Chaque objectif : statut modifiable sur place, Modifier,
       Supprimer (images comprises).
   Le joueur d'un objectif ne change jamais après coup (trigger
   guard_performance_note, lmfc_v3.sql) : pour un autre joueur, on
   en crée un nouveau. Les images s'ajoutent depuis la fiche.
   Utilisé par comparaison-page.js (onglet « Objectifs »), qui
   fournit l'effectif (roster) et la recherche.
   ============================================================ */

const objBoard = { loaded: false, rows: [], media: new Map(), status: 'all', player: null, editId: null };

async function loadObjectives() {
  const [nRes, mRes] = await Promise.all([
    sb.from('player_performance_notes').select('id, player_id, club_id, title, body, status, created_at, updated_at')
      .eq('kind', 'objective').order('created_at', { ascending: false }),
    sb.from('player_performance_media').select('id, note_id, storage_path').not('note_id', 'is', null),
  ]);
  if (nRes.error) throw nRes.error;
  if (mRes.error) console.warn('Images des objectifs illisibles', mRes.error);
  objBoard.rows = nRes.data || [];
  objBoard.media = new Map();
  (mRes.data || []).forEach(m => objBoard.media.set(m.note_id, [...(objBoard.media.get(m.note_id) || []), m]));
  objBoard.loaded = true;
}

const objPlayer = (id) => roster.find(p => p.id === id);
const objStatusKey = (r) => (OBJ_STATUS[r.status] ? r.status : 'active');

/* HTML de l'onglet ; les événements sont posés une fois (bindObjectivesTab). */
function renderObjectivesTab() {
  if (!objBoard.loaded) {
    loadObjectives().then(render).catch(e => {
      console.error('Objectifs illisibles', e);
      document.getElementById('cmpContent').innerHTML = `<div class="empty text-danger">Objectifs illisibles : ${esc(e.message)}</div>`;
    });
    return '<div class="empty">Chargement des objectifs…</div>';
  }
  const inRoster = objBoard.rows.filter(r => objPlayer(r.player_id));
  const q = cmpSearch.trim().toLowerCase();
  const shown = inRoster.filter(r =>
    (objBoard.status === 'all' || objStatusKey(r) === objBoard.status)
    && (!objBoard.player || r.player_id === objBoard.player)
    && (!q || playerName(objPlayer(r.player_id)).toLowerCase().includes(q) || r.title.toLowerCase().includes(q)));
  const count = (k) => inRoster.filter(r => k === 'all' || objStatusKey(r) === k).length;
  const chips = [['all', 'Tous'], ['active', 'En cours'], ['achieved', 'Atteints'], ['missed', 'Non atteints']];
  const byPlayer = new Map();
  shown.forEach(r => byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) || []), r]));
  const groups = [...byPlayer.entries()].sort((a, b) => playerName(objPlayer(a[0])).localeCompare(playerName(objPlayer(b[0])), 'fr'));
  const filteredPlayer = objBoard.player && objPlayer(objBoard.player);

  return `
  <div class="obj-head">
    <div class="obj-chips" role="group" aria-label="Filtrer par statut">${chips.map(([k, label]) =>
      `<button type="button" class="obj-chip${objBoard.status === k ? ' on' : ''}" data-obj-filter="${k}" aria-pressed="${objBoard.status === k}">${label} <span>${count(k)}</span></button>`).join('')}
      ${filteredPlayer ? `<button type="button" class="obj-chip on" data-obj-player-clear title="Voir tous les joueurs">${esc(playerName(filteredPlayer))} ✕</button>` : ''}
    </div>
    <button class="btn btn-primary" type="button" data-obj-new>+ Ajouter un objectif</button>
  </div>
  ${groups.length ? groups.map(([pid, list]) => {
    const p = objPlayer(pid);
    return `<section class="obj-group">
      <div class="obj-group-head">
        <a href="player.html?id=${pid}" class="obj-player">${esc(playerName(p))}${p.poste ? ` <span>${esc(p.poste)}</span>` : ''}</a>
        <button class="btn btn-sm" type="button" data-obj-new="${pid}">+ Objectif</button>
      </div>
      <div class="obj-list">${list.map(r => {
        const imgs = (objBoard.media.get(r.id) || []).length;
        return `<article class="obj-row obj-${objStatusKey(r)}">
          <div class="obj-main">
            <strong>${esc(r.title)}</strong>
            ${r.body ? `<p>${esc(r.body.length > 160 ? `${r.body.slice(0, 157)}…` : r.body)}</p>` : ''}
            <span class="obj-meta">Créé le ${esc(new Date(r.created_at).toLocaleDateString('fr-FR'))}${imgs ? ` · ${imgs} image${imgs > 1 ? 's' : ''}` : ''}</span>
          </div>
          <div class="obj-actions">
            ${objStatusControl(r, true)}
            <button class="btn btn-sm" type="button" data-obj-edit="${r.id}">Modifier</button>
            <button class="btn btn-sm btn-danger" type="button" data-obj-del="${r.id}" aria-label="Supprimer « ${esc(r.title)} »">Supprimer</button>
          </div>
        </article>`;
      }).join('')}</div>
    </section>`;
  }).join('') : `<div class="empty">${inRoster.length ? 'Aucun objectif ne correspond à ce filtre.' : 'Aucun objectif pour l’instant. « + Ajouter un objectif » : choisissez un ou plusieurs joueurs, c’est enregistré sur chaque fiche.'}</div>`}`;
}

/* ---------- Fenêtre d'ajout / de modification ---------- */
function mountObjectiveModal() {
  if (document.getElementById('objModal')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-backdrop" id="objModal">
    <div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="objModalTitle">
      <h3 id="objModalTitle">Ajouter un objectif</h3>
      <div class="field" id="objPlayersField">
        <label for="objPlayerSearch">Joueur(s) concerné(s)</label>
        <div class="obj-picker">
          <div class="obj-picker-tools">
            <input id="objPlayerSearch" type="search" placeholder="Rechercher un joueur…" autocomplete="off">
            <button class="btn btn-sm" type="button" data-obj-all>Tout cocher</button>
            <button class="btn btn-sm" type="button" data-obj-none>Aucun</button>
          </div>
          <div id="objPlayerList" class="obj-picker-list" role="group" aria-label="Joueurs"></div>
        </div>
        <small class="field-hint" id="objPickedHint">Cochez au moins un joueur.</small>
      </div>
      <p class="obj-fixed hidden" id="objFixedPlayer"></p>
      <div class="field"><label for="objTitle">Objectif</label><input id="objTitle" autocomplete="off" placeholder="Ex. VMA : passer de 17 à 18 km/h"></div>
      <div class="field"><label for="objBody">Description / consignes</label><textarea id="objBody" rows="4" placeholder="Échéance, moyens, exercices…"></textarea></div>
      <div class="field"><label for="objStatus">Statut</label>
        <select id="objStatus">${Object.entries(OBJ_STATUS).map(([v, s]) => `<option value="${v}">${s.label}</option>`).join('')}</select></div>
      <small class="field-hint">Les images d’un objectif s’ajoutent depuis la fiche du joueur.</small>
      <div class="modal-actions">
        <button class="btn" type="button" data-close="objModal">Annuler</button>
        <button class="btn" type="button" id="objSaveMore">Enregistrer et en ajouter un autre</button>
        <button class="btn btn-primary" type="button" id="objSave">Enregistrer</button>
      </div>
    </div>
  </div>`);
  const list = document.getElementById('objPlayerList');
  document.getElementById('objPlayerSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    list.querySelectorAll('label').forEach(l => l.classList.toggle('hidden', !!q && !l.textContent.toLowerCase().includes(q)));
  });
  const visibleBoxes = () => [...list.querySelectorAll('label:not(.hidden) input')];
  document.querySelector('[data-obj-all]').addEventListener('click', () => { visibleBoxes().forEach(c => { c.checked = true; }); syncPicked(); });
  document.querySelector('[data-obj-none]').addEventListener('click', () => { list.querySelectorAll('input').forEach(c => { c.checked = false; }); syncPicked(); });
  list.addEventListener('change', syncPicked);
  document.getElementById('objSave').addEventListener('click', () => saveObjective(false));
  document.getElementById('objSaveMore').addEventListener('click', () => saveObjective(true));
}
const pickedIds = () => [...document.querySelectorAll('#objPlayerList input:checked')].map(c => Number(c.value));
function syncPicked() {
  const n = pickedIds().length;
  document.getElementById('objPickedHint').textContent = n
    ? `${n} joueur${n > 1 ? 's' : ''} : un objectif sera créé sur ${n > 1 ? 'chaque fiche' : 'sa fiche'}.`
    : 'Cochez au moins un joueur.';
}

function openObjectiveModal(editId = null, presetPlayer = null) {
  mountObjectiveModal();
  const r = editId ? objBoard.rows.find(x => x.id === editId) : null;
  objBoard.editId = r ? r.id : null;
  document.getElementById('objModalTitle').textContent = r ? 'Modifier l’objectif' : 'Ajouter un objectif';
  document.getElementById('objPlayersField').classList.toggle('hidden', !!r);
  document.getElementById('objSaveMore').classList.toggle('hidden', !!r);
  const fixed = document.getElementById('objFixedPlayer');
  fixed.classList.toggle('hidden', !r);
  if (r) fixed.innerHTML = `Joueur : <strong>${esc(playerName(objPlayer(r.player_id)))}</strong> <span class="text-muted">— un objectif reste sur son joueur.</span>`;
  document.getElementById('objTitle').value = r?.title || '';
  document.getElementById('objBody').value = r?.body || '';
  document.getElementById('objStatus').value = r ? objStatusKey(r) : 'active';
  if (!r) {
    const preset = presetPlayer || objBoard.player;
    document.getElementById('objPlayerSearch').value = '';
    document.getElementById('objPlayerList').innerHTML = [...roster]
      .sort((a, b) => playerName(a).localeCompare(playerName(b), 'fr'))
      .map(p => `<label><input type="checkbox" value="${p.id}"${p.id === preset ? ' checked' : ''}> ${esc(playerName(p))}${p.poste ? ` <span class="text-muted">${esc(p.poste)}</span>` : ''}</label>`).join('')
      || '<p class="text-muted">Aucun joueur dans cette équipe.</p>';
    syncPicked();
  }
  openModal('objModal');
  setTimeout(() => document.getElementById(r || presetPlayer ? 'objTitle' : 'objPlayerSearch').focus(), 50);
}

async function saveObjective(again) {
  const title = document.getElementById('objTitle').value.trim();
  const body = document.getElementById('objBody').value.trim() || null;
  const status = document.getElementById('objStatus').value;
  if (!title) return toast('Le titre de l’objectif est obligatoire.', 'error');
  const btns = ['objSave', 'objSaveMore'].map(id => document.getElementById(id));
  btns.forEach(b => { b.disabled = true; });
  try {
    if (objBoard.editId) {
      const { error } = await sb.from('player_performance_notes').update({ title, body, status }).eq('id', objBoard.editId);
      if (error) throw error;
      toast('Objectif mis à jour.', 'success');
    } else {
      const ids = pickedIds();
      if (!ids.length) return toast('Cochez au moins un joueur.', 'error');
      // Chaque ligne porte le joueur coché et le club de l'utilisateur ;
      // la RLS vérifie que ce joueur est bien dans ce club.
      const rows = ids.map(player_id => ({
        club_id: myProfile.club_id, player_id, kind: 'objective', title, body, status, created_by: myProfile.id,
      }));
      const { error } = await sb.from('player_performance_notes').insert(rows);
      if (error) throw error;
      toast(ids.length > 1 ? `Objectif ajouté à ${ids.length} joueurs.` : 'Objectif ajouté.', 'success');
    }
    await loadObjectives();
    render();
    if (again && !objBoard.editId) {
      document.getElementById('objTitle').value = '';
      document.getElementById('objBody').value = '';
      document.getElementById('objTitle').focus();
    } else closeModal('objModal');
  } catch (e) {
    console.error('Objectif non enregistré', e);
    toast(e.message, 'error');
  } finally { btns.forEach(b => { b.disabled = false; }); }
}

async function deleteObjective(id) {
  const r = objBoard.rows.find(x => x.id === id);
  if (!r) return;
  const files = (objBoard.media.get(id) || []).map(m => m.storage_path);
  if (!confirm(`Supprimer l’objectif « ${r.title} » de ${playerName(objPlayer(r.player_id))}${files.length ? ' et ses images' : ''} ? C’est définitif.`)) return;
  try {
    const { error } = await sb.from('player_performance_notes').delete().eq('id', id);
    if (error) throw error;
    if (files.length) {
      const { error: sErr } = await sb.storage.from(NOTES_BUCKET).remove(files);
      if (sErr) console.warn('Images de l’objectif non supprimées du stockage', sErr);
    }
    objBoard.rows = objBoard.rows.filter(x => x.id !== id);
    objBoard.media.delete(id);
    render();
    toast('Objectif supprimé.', 'success');
  } catch (e) {
    console.error('Suppression de l’objectif impossible', e);
    toast(e.message, 'error');
  }
}

async function setObjectiveStatus(id, status) {
  const r = objBoard.rows.find(x => x.id === id);
  if (!r || !OBJ_STATUS[status]) return;
  const { error } = await sb.from('player_performance_notes').update({ status }).eq('id', id);
  if (error) { console.error('Statut non enregistré', error); toast(error.message, 'error'); return render(); }
  r.status = status;
  render();
  toast(`Objectif : ${OBJ_STATUS[status].label.toLowerCase()}.`, 'success');
}

function bindObjectivesTab() {
  const box = document.getElementById('cmpContent');
  box.addEventListener('click', (e) => {
    if (cmpTab !== 'objectifs') return;
    const f = e.target.closest('[data-obj-filter]');
    if (f) { objBoard.status = f.dataset.objFilter; return render(); }
    if (e.target.closest('[data-obj-player-clear]')) { objBoard.player = null; return render(); }
    const add = e.target.closest('[data-obj-new]');
    if (add) return openObjectiveModal(null, Number(add.dataset.objNew) || null);
    const edit = e.target.closest('[data-obj-edit]');
    if (edit) return openObjectiveModal(Number(edit.dataset.objEdit));
    const del = e.target.closest('[data-obj-del]');
    if (del) return deleteObjective(Number(del.dataset.objDel));
  });
  box.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-note-status]');
    if (cmpTab === 'objectifs' && sel) setObjectiveStatus(Number(sel.dataset.noteStatus), sel.value);
  });
}
