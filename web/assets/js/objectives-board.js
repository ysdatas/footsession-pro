/* ============================================================
   LMFC Performance — objectives-board.js
   Performance → Objectifs · Préventions : tous les objectifs et
   préventions de l'effectif sur un seul écran, sans ouvrir chaque
   fiche joueur.
     - « + Objectif » / « + Prévention » : un ou plusieurs joueurs
       cochés, un titre (facultatif), une description, un statut, des
       images (PNG, JPG) affichées tout de suite. Une ligne
       player_performance_notes par joueur, et ses propres copies
       d'images dans SON dossier (la RLS du stockage lit par joueur).
     - Chaque ligne : statut modifiable sur place, Modifier, Supprimer
       (images comprises).
   Le joueur d'un point ne change jamais après coup (trigger
   guard_performance_note, lmfc_v3.sql) : pour un autre joueur, on
   en crée un nouveau.
   Utilisé par comparaison-page.js (onglet « Objectifs · Préventions »),
   qui fournit l'effectif (roster) et la recherche. Dépend de notes.js
   (NOTE_KINDS, OBJ_STATUS, noteTitle, shrinkImage).
   ============================================================ */

const OBJ_KINDS = ['objective', 'prevention'];
const objBoard = {
  loaded: false, rows: [], media: new Map(), status: 'all', kind: 'all', player: null, editId: null,
  draft: { existing: [], pending: [] },
  pick: { on: false, ids: new Set() },   // mode sélection : statut ou suppression groupés
  shown: [],                             // lignes affichées (filtres appliqués) : « Tout sélectionner » porte sur elles
};

async function loadObjectives() {
  const [nRes, mRes] = await Promise.all([
    sb.from('player_performance_notes').select('id, player_id, club_id, kind, title, body, status, created_at, updated_at')
      .in('kind', OBJ_KINDS).order('created_at', { ascending: false }),
    sb.from('player_performance_media').select('id, note_id, player_id, storage_path, caption, sort_order').not('note_id', 'is', null),
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
const objKindLabel = (k) => NOTE_KINDS[k]?.badge || 'Objectif';

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
  const ofKind = inRoster.filter(r => objBoard.kind === 'all' || r.kind === objBoard.kind);
  const q = cmpSearch.trim().toLowerCase();
  const shown = ofKind.filter(r =>
    (objBoard.status === 'all' || objStatusKey(r) === objBoard.status)
    && (!objBoard.player || r.player_id === objBoard.player)
    && (!q || playerName(objPlayer(r.player_id)).toLowerCase().includes(q)
      || noteTitle(r).toLowerCase().includes(q) || (r.body || '').toLowerCase().includes(q)));
  const count = (k) => ofKind.filter(r => k === 'all' || objStatusKey(r) === k).length;
  const kindCount = (k) => inRoster.filter(r => k === 'all' || r.kind === k).length;
  const chips = [['all', 'Tous'], ['active', 'En cours'], ['achieved', 'Atteints'], ['missed', 'Non atteints']];
  const kinds = [['all', 'Tout'], ['objective', 'Objectifs'], ['prevention', 'Préventions']];
  const byPlayer = new Map();
  shown.forEach(r => byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) || []), r]));
  const groups = [...byPlayer.entries()].sort((a, b) => playerName(objPlayer(a[0])).localeCompare(playerName(objPlayer(b[0])), 'fr'));
  const filteredPlayer = objBoard.player && objPlayer(objBoard.player);
  objBoard.shown = shown;
  const pick = objBoard.pick;
  [...pick.ids].forEach(id => { if (!shown.some(r => r.id === id)) pick.ids.delete(id); });   // un filtre retire de la sélection ce qu'il cache
  const pickNoun = objBoard.kind === 'prevention' ? ['prévention', 'préventions', true]
    : objBoard.kind === 'objective' ? ['objectif', 'objectifs', false] : ['élément', 'éléments', false];

  return `
  <div class="obj-head">
    <div class="obj-filters">
      <div class="segmented obj-kinds" role="group" aria-label="Type">${kinds.map(([k, label]) =>
        `<button type="button" class="${objBoard.kind === k ? 'active' : ''}" data-obj-kind="${k}" aria-pressed="${objBoard.kind === k}">${label} <span>${kindCount(k)}</span></button>`).join('')}</div>
      <div class="obj-chips" role="group" aria-label="Filtrer par statut">${chips.map(([k, label]) =>
        `<button type="button" class="obj-chip${objBoard.status === k ? ' on' : ''}" data-obj-filter="${k}" aria-pressed="${objBoard.status === k}">${label} <span>${count(k)}</span></button>`).join('')}
        ${filteredPlayer ? `<button type="button" class="obj-chip on" data-obj-player-clear title="Voir tous les joueurs">${esc(playerName(filteredPlayer))} ✕</button>` : ''}
      </div>
    </div>
    <div class="obj-new">
      ${shown.length ? `<button class="btn" type="button" data-obj-pick aria-pressed="${pick.on}">Sélectionner</button>` : ''}
      <button class="btn btn-primary" type="button" data-obj-new data-kind="objective">+ Objectif</button>
      <button class="btn" type="button" data-obj-new data-kind="prevention">+ Prévention</button>
    </div>
  </div>
  ${pick.on ? bulkBarHtml({ n: pick.ids.size, total: shown.length, noun: pickNoun, actions: [
    ...Object.entries(OBJ_STATUS).map(([k, st]) => ({ key: `status:${k}`, label: st.label })),
    { key: 'delete', label: 'Supprimer', danger: true }] }) : ''}
  ${groups.length ? groups.map(([pid, list]) => {
    const p = objPlayer(pid);
    return `<section class="obj-group">
      <div class="obj-group-head">
        <a href="player.html?id=${pid}" class="obj-player">${esc(playerName(p))}${p.poste ? ` <span>${esc(p.poste)}</span>` : ''}</a>
        <span class="obj-group-add">
          <button class="btn btn-sm" type="button" data-obj-new="${pid}" data-kind="objective">+ Objectif</button>
          <button class="btn btn-sm" type="button" data-obj-new="${pid}" data-kind="prevention">+ Prévention</button>
        </span>
      </div>
      <div class="obj-list">${list.map(r => {
        const imgs = (objBoard.media.get(r.id) || []).length;
        const title = noteTitle(r);
        const body = r.title?.trim() ? r.body : (r.body || '').trim().split('\n').slice(1).join(' ');
        if (pick.on) {
          const on = pick.ids.has(r.id);
          return `<article class="obj-row obj-${objStatusKey(r)} is-selectable${on ? ' is-picked' : ''}" data-obj-toggle="${r.id}" role="checkbox" aria-checked="${on}" tabindex="0">
          ${selCheckHtml(on)}
          <div class="obj-main">
            <span class="badge ${NOTE_KINDS[r.kind]?.cls || 'badge-gold'}">${objKindLabel(r.kind)}</span>
            <strong>${esc(title)}</strong>
            ${body ? `<p>${esc(body.length > 160 ? `${body.slice(0, 157)}…` : body)}</p>` : ''}
          </div>
          <span class="obj-status ${OBJ_STATUS[objStatusKey(r)].cls}">${OBJ_STATUS[objStatusKey(r)].label}</span>
        </article>`;
        }
        return `<article class="obj-row obj-${objStatusKey(r)}">
          <div class="obj-main">
            <span class="badge ${NOTE_KINDS[r.kind]?.cls || 'badge-gold'}">${objKindLabel(r.kind)}</span>
            <strong>${esc(title)}</strong>
            ${body ? `<p>${esc(body.length > 160 ? `${body.slice(0, 157)}…` : body)}</p>` : ''}
            <span class="obj-meta">Créé le ${esc(new Date(r.created_at).toLocaleDateString('fr-FR'))}${imgs ? ` · ${imgs} image${imgs > 1 ? 's' : ''}` : ''}</span>
          </div>
          <div class="obj-actions">
            ${objStatusControl(r, true)}
            <button class="btn btn-sm" type="button" data-obj-edit="${r.id}">Modifier</button>
            <button class="btn btn-sm btn-danger" type="button" data-obj-del="${r.id}" aria-label="Supprimer « ${esc(title)} »">Supprimer</button>
          </div>
        </article>`;
      }).join('')}</div>
    </section>`;
  }).join('') : `<div class="empty">${inRoster.length ? 'Aucun élément ne correspond à ce filtre.' : 'Aucun objectif ni prévention pour l’instant. « + Objectif » : choisissez un ou plusieurs joueurs, c’est enregistré sur chaque fiche.'}</div>`}`;
}

/* ---------- Fenêtre d'ajout / de modification ---------- */
function mountObjectiveModal() {
  if (document.getElementById('objModal')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-backdrop" id="objModal">
    <div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="objModalTitle">
      <h3 id="objModalTitle">Ajouter un objectif</h3>
      <div class="field">
        <span class="field-label" id="objKindLabel">Type</span>
        <div class="segmented obj-kind-pick" role="radiogroup" aria-labelledby="objKindLabel">
          <button type="button" role="radio" data-kind-pick="objective">Objectif</button>
          <button type="button" role="radio" data-kind-pick="prevention">Prévention</button>
        </div>
      </div>
      <div class="field" id="objPlayersField">
        <label for="objPlayerSearch">Joueur(s) concerné(s)</label>
        <div class="obj-picker">
          <div class="obj-picker-tools">
            <input id="objPlayerSearch" type="search" placeholder="Rechercher un joueur…" autocomplete="off">
            <button class="btn btn-sm" type="button" data-obj-all>Tout sélectionner</button>
            <button class="btn btn-sm" type="button" data-obj-none>Tout désélectionner</button>
          </div>
          <div id="objPlayerList" class="obj-picker-list" role="group" aria-label="Joueurs"></div>
        </div>
        <small class="field-hint" id="objPickedHint">Cochez au moins un joueur.</small>
      </div>
      <p class="obj-fixed hidden" id="objFixedPlayer"></p>
      <div class="field"><label for="objTitle">Titre <span class="label-opt">(facultatif)</span></label><input id="objTitle" autocomplete="off" placeholder="Ex. VMA : passer de 17 à 18 km/h"></div>
      <div class="field"><label for="objBody">Description / consignes</label><textarea id="objBody" rows="4" placeholder="Échéance, moyens, exercices…"></textarea></div>
      <div class="field"><label for="objStatus">Statut</label>
        <select id="objStatus">${Object.entries(OBJ_STATUS).map(([v, s]) => `<option value="${v}">${s.label}</option>`).join('')}</select></div>
      <div class="field">
        <span class="field-label">Images</span>
        <div id="objImages" class="note-images-edit"></div>
        <label class="file-pick"><input id="objFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple>
          <span class="btn btn-sm">+ Ajouter des images (PNG, JPG)</span></label>
        <small class="field-hint" id="objImagesHint">Elles s’affichent tout de suite ici et seront visibles par le joueur.</small>
      </div>
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
  document.querySelector('.obj-kind-pick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind-pick]');
    if (b) setModalKind(b.dataset.kindPick);
  });
  const imgs = document.getElementById('objImages');
  imgs.addEventListener('input', (e) => {
    const [key, i] = (e.target.dataset.caption || '').split(':');
    if (key) objBoard.draft[key][Number(i)].caption = e.target.value;
  });
  imgs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-img-toggle]'); if (!b) return;
    const [key, i] = b.dataset.imgToggle.split(':');
    const d = objBoard.draft;
    if (key === 'pending') { URL.revokeObjectURL(d.pending[i].url); d.pending.splice(Number(i), 1); }
    else d.existing[Number(i)].removed = !d.existing[Number(i)].removed;
    renderObjImages();
  });
  document.getElementById('objFiles').addEventListener('change', (e) => {
    for (const file of e.target.files) {
      if (!/^image\//.test(file.type)) { toast(`« ${file.name} » n’est pas une image.`, 'error'); continue; }
      if (file.size > 15 * 1024 * 1024) { toast(`« ${file.name} » dépasse 15 Mo.`, 'error'); continue; }
      objBoard.draft.pending.push({ file, url: URL.createObjectURL(file), caption: '' });
    }
    e.target.value = '';
    renderObjImages();
  });
  document.getElementById('objSave').addEventListener('click', () => saveObjective(false));
  document.getElementById('objSaveMore').addEventListener('click', () => saveObjective(true));
}
const pickedIds = () => [...document.querySelectorAll('#objPlayerList input:checked')].map(c => Number(c.value));
const modalKind = () => document.querySelector('.obj-kind-pick [aria-checked="true"]')?.dataset.kindPick || 'objective';
function setModalKind(kind) {
  document.querySelectorAll('.obj-kind-pick [data-kind-pick]').forEach(b => {
    const on = b.dataset.kindPick === kind;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
  const edit = !!objBoard.editId;
  document.getElementById('objModalTitle').textContent = `${edit ? 'Modifier' : 'Ajouter'} ${kind === 'prevention' ? 'une prévention' : 'un objectif'}`;
  document.getElementById('objTitle').placeholder = kind === 'prevention' ? 'Ex. Ischios : Nordic 2 fois par semaine' : 'Ex. VMA : passer de 17 à 18 km/h';
  syncPicked();
}
function syncPicked() {
  const n = pickedIds().length;
  const prev = modalKind() === 'prevention';
  document.getElementById('objPickedHint').textContent = n
    ? `${n} joueur${n > 1 ? 's' : ''} : ${prev ? 'une prévention sera créée' : 'un objectif sera créé'} sur ${n > 1 ? 'chaque fiche' : 'sa fiche'}.`
    : 'Cochez au moins un joueur.';
  document.getElementById('objImagesHint').textContent = n > 1
    ? 'Elles s’affichent tout de suite ici ; chaque joueur coché reçoit sa copie, visible par lui seul et le staff.'
    : 'Elles s’affichent tout de suite ici et seront visibles par le joueur.';
}
function renderObjImages() {
  const row = (img, key, i) => `<div class="nie-row${img.removed ? ' is-removed' : ''}">
      <img src="${esc(img.url)}" alt="">
      <input type="text" data-caption="${key}:${i}" value="${esc(img.caption)}" placeholder="Légende (facultatif)" ${img.removed ? 'disabled' : ''}>
      <button class="btn btn-sm" type="button" data-img-toggle="${key}:${i}">${key === 'pending' ? 'Retirer' : (img.removed ? 'Garder' : 'Retirer')}</button>
    </div>`;
  const d = objBoard.draft;
  document.getElementById('objImages').innerHTML = d.existing.map((img, i) => row(img, 'existing', i)).join('')
    + d.pending.map((img, i) => row(img, 'pending', i)).join('');
}

async function openObjectiveModal(editId = null, presetPlayer = null, kind = 'objective') {
  mountObjectiveModal();
  const r = editId ? objBoard.rows.find(x => x.id === editId) : null;
  objBoard.editId = r ? r.id : null;
  document.getElementById('objPlayersField').classList.toggle('hidden', !!r);
  document.getElementById('objSaveMore').classList.toggle('hidden', !!r);
  const fixed = document.getElementById('objFixedPlayer');
  fixed.classList.toggle('hidden', !r);
  if (r) fixed.innerHTML = `Joueur : <strong>${esc(playerName(objPlayer(r.player_id)))}</strong> <span class="text-muted">— il reste attaché à son joueur.</span>`;
  document.getElementById('objTitle').value = r?.title || '';
  document.getElementById('objBody').value = r?.body || '';
  document.getElementById('objStatus').value = r ? objStatusKey(r) : 'active';
  objBoard.draft.pending.forEach(p => URL.revokeObjectURL(p.url));
  objBoard.draft = { existing: [], pending: [] };
  if (!r) {
    const preset = presetPlayer || objBoard.player;
    document.getElementById('objPlayerSearch').value = '';
    document.getElementById('objPlayerList').innerHTML = [...roster]
      .sort((a, b) => playerName(a).localeCompare(playerName(b), 'fr'))
      .map(p => `<label><input type="checkbox" value="${p.id}"${p.id === preset ? ' checked' : ''}> ${esc(playerName(p))}${p.poste ? ` <span class="text-muted">${esc(p.poste)}</span>` : ''}</label>`).join('')
      || '<p class="text-muted">Aucun joueur dans cette équipe.</p>';
  }
  setModalKind(r?.kind || kind);
  renderObjImages();
  openModal('objModal');
  setTimeout(() => document.getElementById(r || presetPlayer ? 'objTitle' : 'objPlayerSearch').focus(), 50);
  if (r) {
    // Images existantes : URL signées seulement à l'ouverture (pas pour toute la liste).
    const media = [...(objBoard.media.get(r.id) || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
    if (!media.length) return;
    const { data: signed } = await sb.storage.from(NOTES_BUCKET).createSignedUrls(media.map(m => m.storage_path), 3600);
    if (objBoard.editId !== r.id) return;
    objBoard.draft.existing = media.map((m, i) => ({ id: m.id, path: m.storage_path, url: signed?.[i]?.signedUrl || '', caption: m.caption || '', removed: false }));
    renderObjImages();
  }
}

/* Envoie les images en attente sur chaque point créé : une copie par
   joueur, dans {club}/{joueur}/{point}/… (lecture : ce joueur et le staff). */
async function uploadObjImages(notes) {
  const files = await Promise.all(objBoard.draft.pending.map(p => shrinkImage(p.file)));
  let failed = 0;
  for (const note of notes) {
    let order = Math.max(-1, ...(objBoard.media.get(note.id) || []).map(m => m.sort_order || 0));
    for (const [i, file] of files.entries()) {
      const ext = file.type === 'image/png' ? 'png' : 'jpg';
      const path = `${myProfile.club_id}/${note.player_id}/${note.id}/${Date.now()}-${i}.${ext}`;
      const up = await sb.storage.from(NOTES_BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg' });
      if (up.error) { console.error('Image non envoyée', up.error); failed++; continue; }
      const { error } = await sb.from('player_performance_media').insert({
        club_id: myProfile.club_id, player_id: note.player_id, note_id: note.id, storage_path: path,
        caption: objBoard.draft.pending[i].caption.trim() || null, sort_order: ++order, created_by: myProfile.id,
      });
      if (error) { console.error('Image non rattachée', error); await sb.storage.from(NOTES_BUCKET).remove([path]); failed++; }
    }
  }
  if (failed) toast(`${failed} image${failed > 1 ? 's' : ''} non enregistrée${failed > 1 ? 's' : ''}.`, 'error');
}

async function saveObjective(again) {
  const kind = modalKind();
  const title = document.getElementById('objTitle').value.trim() || null;
  const body = document.getElementById('objBody').value.trim() || null;
  const status = document.getElementById('objStatus').value;
  const d = objBoard.draft;
  const keptImages = d.existing.filter(m => !m.removed).length + d.pending.length;
  if (!title && !body && !keptImages) return toast('Écrivez un titre ou une description, ou ajoutez une image.', 'error');
  const btns = ['objSave', 'objSaveMore'].map(id => document.getElementById(id));
  btns.forEach(b => { b.disabled = true; });
  try {
    if (objBoard.editId) {
      const r = objBoard.rows.find(x => x.id === objBoard.editId);
      const { error } = await sb.from('player_performance_notes').update({ kind, title, body, status }).eq('id', r.id);
      if (error) throw error;
      const removed = d.existing.filter(m => m.removed);
      if (removed.length) {
        const { error: dErr } = await sb.from('player_performance_media').delete().in('id', removed.map(m => m.id));
        if (dErr) throw dErr;
        const { error: sErr } = await sb.storage.from(NOTES_BUCKET).remove(removed.map(m => m.path));
        if (sErr) console.warn('Images retirées de la fiche mais pas du stockage', sErr);
      }
      for (const m of d.existing.filter(x => !x.removed)) {
        const before = (objBoard.media.get(r.id) || []).find(x => x.id === m.id)?.caption || '';
        if (m.caption.trim() !== before) {
          const { error: cErr } = await sb.from('player_performance_media').update({ caption: m.caption.trim() || null }).eq('id', m.id);
          if (cErr) throw cErr;
        }
      }
      if (d.pending.length) await uploadObjImages([r]);
      toast(kind === 'prevention' ? 'Prévention mise à jour.' : 'Objectif mis à jour.', 'success');
    } else {
      const ids = pickedIds();
      if (!ids.length) return toast('Cochez au moins un joueur.', 'error');
      // Chaque ligne porte le joueur coché et le club de l'utilisateur ;
      // la RLS vérifie que ce joueur est bien dans ce club.
      const rows = ids.map(player_id => ({
        club_id: myProfile.club_id, player_id, kind, title, body, status, created_by: myProfile.id,
      }));
      const { data: created, error } = await sb.from('player_performance_notes').insert(rows).select('id, player_id');
      if (error) throw error;
      if (d.pending.length) await uploadObjImages(created || []);
      const label = kind === 'prevention' ? 'Prévention ajoutée' : 'Objectif ajouté';
      toast(ids.length > 1 ? `${label} à ${ids.length} joueurs.` : `${label}.`, 'success');
    }
    await loadObjectives();
    render();
    if (again && !objBoard.editId) {
      document.getElementById('objTitle').value = '';
      document.getElementById('objBody').value = '';
      d.pending.forEach(p => URL.revokeObjectURL(p.url));
      objBoard.draft = { existing: [], pending: [] };
      renderObjImages();
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
  if (!confirm(`Supprimer « ${noteTitle(r)} » (${objKindLabel(r.kind).toLowerCase()}) de ${playerName(objPlayer(r.player_id))}${files.length ? ' et ses images' : ''} ?${await trashNote()}`)) return;
  try {
    const { error } = await sb.from('player_performance_notes').delete().eq('id', id);
    if (error) throw error;
    if (files.length && !(await trashReady())) {   // corbeille : images gardées
      const { error: sErr } = await sb.storage.from(NOTES_BUCKET).remove(files);
      if (sErr) console.warn('Images supprimées de la fiche mais pas du stockage', sErr);
    }
    objBoard.rows = objBoard.rows.filter(x => x.id !== id);
    objBoard.media.delete(id);
    render();
    toast(r.kind === 'prevention' ? 'Prévention supprimée.' : 'Objectif supprimé.', 'success');
  } catch (e) {
    console.error('Suppression impossible', e);
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
  toast(`${objKindLabel(r.kind)} : ${OBJ_STATUS[status].label.toLowerCase()}.`, 'success');
}

/* ---------- Actions groupées ---------- */
async function setPickedStatus(status) {
  const ids = [...objBoard.pick.ids];
  if (!ids.length || !OBJ_STATUS[status]) return;
  const { error } = await sb.from('player_performance_notes').update({ status }).in('id', ids);
  if (error) { console.error('Statuts non enregistrés', error); return toast(error.message, 'error'); }
  objBoard.rows.forEach(r => { if (objBoard.pick.ids.has(r.id)) r.status = status; });
  render();
  toast(`${ids.length} élément${ids.length > 1 ? 's' : ''} : ${OBJ_STATUS[status].label.toLowerCase()}.`, 'success');
}
async function deletePicked() {
  const list = objBoard.rows.filter(r => objBoard.pick.ids.has(r.id));
  if (!list.length) return;
  const files = list.flatMap(r => (objBoard.media.get(r.id) || []).map(m => m.storage_path));
  if (!confirm(`Supprimer ${list.length > 1 ? `ces ${list.length} éléments` : 'cet élément'}${files.length ? ' et leurs images' : ''} ?\n\n`
    + `${namesList(list.map(r => `${objKindLabel(r.kind)} · ${noteTitle(r)} (${playerName(objPlayer(r.player_id))})`))}${await trashNote()}`)) return;
  try {
    const { error } = await sb.from('player_performance_notes').delete().in('id', list.map(r => r.id));
    if (error) throw error;
    if (files.length && !(await trashReady())) {   // corbeille : images gardées
      const { error: sErr } = await sb.storage.from(NOTES_BUCKET).remove(files);
      if (sErr) console.warn('Images supprimées des fiches mais pas du stockage', sErr);
    }
    const gone = new Set(list.map(r => r.id));
    objBoard.rows = objBoard.rows.filter(r => !gone.has(r.id));
    gone.forEach(id => objBoard.media.delete(id));
    objBoard.pick.ids.clear();
    render();
    toast(`${list.length} élément${list.length > 1 ? 's supprimés' : ' supprimé'}.`, 'success');
  } catch (e) {
    console.error('Suppression groupée impossible', e);
    toast(e.message, 'error');
  }
}
function toggleObjPick(id) {
  const ids = objBoard.pick.ids;
  if (ids.has(id)) ids.delete(id); else ids.add(id);
  render();
  document.querySelector(`[data-obj-toggle="${id}"]`)?.focus();
}

function bindObjectivesTab() {
  const box = document.getElementById('cmpContent');
  box.addEventListener('keydown', (e) => {
    const row = e.target.closest?.('[data-obj-toggle]');
    if (cmpTab === 'objectifs' && row && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); toggleObjPick(Number(row.dataset.objToggle)); }
  });
  box.addEventListener('click', (e) => {
    if (cmpTab !== 'objectifs') return;
    if (e.target.closest('[data-obj-pick]')) { objBoard.pick.on = !objBoard.pick.on; objBoard.pick.ids.clear(); return render(); }
    const row = e.target.closest('[data-obj-toggle]');
    if (row) return toggleObjPick(Number(row.dataset.objToggle));
    const bulk = e.target.closest('[data-bulk]')?.dataset.bulk;
    if (bulk === 'all') { objBoard.shown.forEach(r => objBoard.pick.ids.add(r.id)); return render(); }
    if (bulk === 'none') { objBoard.pick.ids.clear(); return render(); }
    if (bulk === 'done') { objBoard.pick.on = false; objBoard.pick.ids.clear(); return render(); }
    if (bulk === 'delete') return deletePicked();
    if (bulk?.startsWith('status:')) return setPickedStatus(bulk.slice(7));
    const f = e.target.closest('[data-obj-filter]');
    if (f) { objBoard.status = f.dataset.objFilter; return render(); }
    const k = e.target.closest('[data-obj-kind]');
    if (k) { objBoard.kind = k.dataset.objKind; return render(); }
    if (e.target.closest('[data-obj-player-clear]')) { objBoard.player = null; return render(); }
    const add = e.target.closest('[data-obj-new]');
    if (add) return openObjectiveModal(null, Number(add.dataset.objNew) || null, add.dataset.kind || 'objective');
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
