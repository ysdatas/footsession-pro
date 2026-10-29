/* ============================================================
   LMFC Performance — session-library.js
   Vidéo de la bibliothèque dans un procédé de séance (lmfc_v25.sql).
   Le procédé garde la VERSION choisie et le titre du moment : une vidéo
   remplacée ensuite dans la bibliothèque ne change pas la séance en
   silence (« Passer à la v3 » : seulement sur clic).
   Le lien passe par library_link_procedure, hors sauvegarde automatique :
   il est refusé si une personne qui voit la séance ne peut pas lire la
   vidéo (avertissement nominatif), et un refus ne bloque jamais le reste
   de la séance. L'accès à la séance ne donne jamais accès à la vidéo.
   Depuis la bibliothèque : session-edit.html?id=…&lib=<procédé> (sans id :
   nouvelle séance) ajoute un procédé avec cette vidéo.
   ============================================================ */

const LIB = { loaded: false, info: new Map(), current: new Map(), gaps: new Map(), browser: null, target: null };
const libInEditor = () => ['admin', 'coach', 'prepa'].includes(myProfile?.role);

/* Versions liées : numéro, fichier, procédé (titre, statut, version en cours). */
async function libLoadInfo() {
  const items = [...new Set(procedures.map(p => p.library_item_id).filter(Boolean))];
  LIB.loaded = true;
  if (!items.length) return;
  const [vers, its, gaps] = await Promise.all([
    sb.from('library_versions').select('id, version_no, item_id, library_files(id, storage_path, duree_sec)').in('item_id', items),
    sb.from('library_items').select('id, titre, statut, current_version_id').in('id', items),
    savedSessionId ? sb.rpc('library_session_check', { p_session: savedSessionId }) : { data: [] },
  ]);
  const err = vers.error || its.error || gaps.error;
  if (err) console.warn('Bibliothèque : vidéos de la séance', err);
  const byItem = new Map((its.data || []).map(i => [i.id, i]));
  LIB.info = new Map((vers.data || []).map(v => [v.id, { ...v, item: byItem.get(v.item_id) }]));
  LIB.current = new Map((its.data || []).map(i => [i.id, (vers.data || []).find(v => v.id === i.current_version_id)]));
  LIB.gaps = new Map();
  (gaps.data || []).forEach(g => LIB.gaps.set(g.procedure_id, [...(LIB.gaps.get(g.procedure_id) || []), g.nom]));
}

function libraryBoxHtml(p) {
  if (!libInEditor()) return '';
  const btn = (act, label, cls = '') => `<button class="btn btn-sm${cls}" type="button" data-do="${act}" data-arg="${p._uid}">${label}</button>`;
  if (p.library_version_id) {
    const v = LIB.info.get(p.library_version_id), titre = escapeHtml(p.library_titre || v?.item?.titre || 'Vidéo de la bibliothèque');
    if (LIB.loaded && !v) {
      return `<div class="lib-proc is-locked">Vidéo de la bibliothèque : « ${titre} ». Accès réservé : votre compte ne peut pas lire cette vidéo.
        ${CAN_WRITE ? `<div class="lib-proc-actions">${btn('libUnlinkProc', 'Retirer la vidéo', ' btn-danger')}</div>` : ''}</div>`;
    }
    const cur = v && LIB.current.get(v.item_id), newer = cur && cur.id !== v.id && v.item?.statut === 'actif';
    const gaps = LIB.gaps.get(p.id) || [];
    return `<div class="lib-proc"><div class="lib-proc-row">${libThumbHtml(v?.library_files?.id, v?.library_files?.duree_sec)}
      <div class="lib-proc-body"><span class="lib-proc-title">${titre}</span>
        <span class="lib-proc-meta">Bibliothèque vidéo · v${v?.version_no ?? '…'}${LIB_STATUT[v?.item?.statut] ? ` · ${LIB_STATUT[v.item.statut]}` : ''}</span>
        <div class="lib-proc-actions">${btn('libPlayProc', '▶ Lire')}
          <a class="btn btn-sm" href="bibliotheque.html?item=${p.library_item_id}" target="_blank" rel="noopener">Fiche</a>
          ${CAN_WRITE && newer ? btn('libUpdateProc', `Passer à la v${cur.version_no}`, ' btn-primary') : ''}
          ${CAN_WRITE ? btn('libUnlinkProc', 'Retirer la vidéo', ' btn-danger') : ''}</div></div></div>
      ${newer ? `<p class="lib-proc-warn">Version plus récente dans la bibliothèque (v${cur.version_no}) : la séance garde la v${v.version_no} tant que vous ne la changez pas.</p>` : ''}
      ${gaps.length ? `<p class="lib-proc-warn">Voient la séance sans pouvoir lire cette vidéo : ${escapeHtml(gaps.join(', '))}.</p>` : ''}</div>`;
  }
  if (p._libPending) {
    return `<div class="lib-proc"><span class="lib-proc-title">${escapeHtml(p._libPending.titre)}</span>
      <p class="lib-proc-meta">Vidéo de la bibliothèque : rattachée dès que la séance est enregistrée (titre et date).</p></div>`;
  }
  return CAN_WRITE ? btn('libPickFor', '+ Vidéo de la bibliothèque') : '';
}
function refreshLibBoxes() {
  procedures.forEach(p => {
    const box = document.querySelector(`[data-lib-box="${p._uid}"]`);
    if (box) box.innerHTML = libraryBoxHtml(p);
  });
  observeLibThumbs(document.getElementById('proceduresList'));
}

/* ---------- Choisir une vidéo ---------- */
function openLibPicker(uid) {
  LIB.target = uid;
  openModal('libPickModal');
  LIB.browser ||= createLibBrowser(document.getElementById('libPick'), { pick: true, hl: 3, onPick: libPicked });
  LIB.browser.focus();
}
function libPicked(row) {
  closeModal('libPickModal');
  let p = LIB.target && procedures.find(x => x._uid === LIB.target);
  if (!p) {   // nouveau procédé à partir de la vidéo : nom et consignes recopiés
    addProcedure({ nom: row.titre, consignes: row.description || '' });
    p = procedures[procedures.length - 1];
  }
  libLink(p, { id: row.id, titre: row.titre, version_id: row.version_id });
}

async function libLink(p, row) {
  if (p._libBusy) return;   // déjà en cours (sauvegarde suivante pendant le lien)
  p._libBusy = true;
  try { await libLinkNow(p, row); } finally { p._libBusy = false; }
}
async function libLinkNow(p, row) {
  // La séance et le procédé doivent exister en base avant le lien.
  if (!(await flushSave()) || !savedSessionId || !p.id) {
    p._libPending = row;
    refreshLibBoxes();
    return toast('Vidéo rattachée dès que la séance est enregistrée (titre et date).', 'info');
  }
  const { data: gaps, error: gErr } = await sb.rpc('library_session_gaps', { p_session: savedSessionId, p_item: row.id });
  if (gErr) return toast(libError(gErr), 'error');
  if (gaps?.length) { p._libPending = null; refreshLibBoxes(); return libShowGaps(p, row, gaps); }
  const { data, error } = await sb.rpc('library_link_procedure', { p_procedure: p.id, p_version: row.version_id });
  p._libPending = null;
  if (error) { refreshLibBoxes(); return toast(libError(error), 'error'); }
  Object.assign(p, { library_item_id: data[0].item_id, library_version_id: data[0].version_id, library_titre: data[0].titre });
  await libLoadInfo();
  refreshLibBoxes();
  toast('Vidéo ajoutée au procédé.', 'success');
}

/* Partage impossible : qui, et la solution si l'on gère la vidéo. */
async function libShowGaps(p, row, gaps) {
  const { data: lvl } = await sb.rpc('library_level', { p_item: row.id });
  const them = gaps.length > 1 ? 'leur' : 'lui';
  document.getElementById('libGapsBody').innerHTML = `
    <p>La vidéo « ${escapeHtml(row.titre)} » n’a pas été ajoutée : ${gaps.length > 1 ? 'ces personnes voient' : 'cette personne voit'} la séance
      sans avoir accès à la vidéo.</p>
    <ul class="lib-gaps">${gaps.map(g => `<li>${escapeHtml(g.nom)} · ${escapeHtml(ROLE_LABELS[g.role] || g.role)}</li>`).join('')}</ul>
    <p class="field-hint">L’accès à une séance ne donne jamais accès à une vidéo de la bibliothèque.
      ${lvl === 'gestion' ? `Vous pouvez ${them} ouvrir la vidéo (consultation).`
        : `Demandez à son créateur ou à l’administrateur de ${them} ouvrir la vidéo, ou retirez-${gaps.length > 1 ? 'les' : 'la'} de la séance.`}</p>`;
  const open = document.getElementById('libGapsOpen');
  open.textContent = `${capFirst(them)} ouvrir la vidéo`;
  open.classList.toggle('hidden', lvl !== 'gestion');
  open.onclick = async () => {
    const { error } = await sb.from('library_access').upsert(gaps.map(g => ({ item_id: row.id, profile_id: g.profile_id, niveau: 'lecture' })), { onConflict: 'item_id,profile_id' });
    closeModal('libGapsModal');
    if (error) return toast(libError(error), 'error');
    libLink(p, row);
  };
  openModal('libGapsModal');
}

/* Sauvegarde terminée (session-autosave.js) : les vidéos en attente se rattachent. */
function onSessionSaved() {
  procedures.filter(p => p._libPending && p.id).forEach(p => libLink(p, p._libPending));
}

/* Arrivée depuis la bibliothèque (?lib=<procédé>) : un procédé avec cette vidéo. */
async function libFromUrl() {
  const id = Number(new URLSearchParams(location.search).get('lib'));
  if (!id || !CAN_WRITE) return;
  history.replaceState(null, '', location.pathname + (savedSessionId ? `?id=${savedSessionId}` : ''));   // recharger ne l'ajoute pas deux fois
  const { data: it, error } = await sb.from('library_items').select('id, titre, description, statut, current_version_id').eq('id', id).maybeSingle();
  if (error || !it) return toast(error ? libError(error) : 'Vidéo de la bibliothèque introuvable.', 'error');
  if (it.statut !== 'actif') return toast('Ce procédé est archivé ou retiré : il ne peut plus être ajouté.', 'error');
  // Nouvelle séance : l'échauffement d'office laisse la place au procédé choisi.
  if (EDITOR_MODE === 'create' && procedures.length === 1 && !procedures[0].id) procedures = [];
  addProcedure({ nom: it.titre, consignes: it.description || '' });
  libLink(procedures[procedures.length - 1], { id: it.id, titre: it.titre, version_id: it.current_version_id });
}

async function initSessionLibrary() {
  if (!libInEditor()) return;
  if (CAN_WRITE) document.getElementById('btnLibVideo')?.classList.remove('hidden');
  document.getElementById('btnLibVideo')?.addEventListener('click', () => openLibPicker(null));
  if (procedures.some(p => p.library_item_id)) await libLoadInfo();
  else LIB.loaded = true;
  refreshLibBoxes();
  libFromUrl();
}

const libProc = (b) => procedures.find(x => x._uid === b.dataset.arg);
Object.assign(EDIT_DO, {
  libPickFor: (b) => openLibPicker(b.dataset.arg),
  libPlayProc: (b) => { const p = libProc(b), v = p && LIB.info.get(p.library_version_id); libPlay(v?.library_files?.storage_path, p?.library_titre); },
  libUpdateProc: (b) => {
    const p = libProc(b), cur = p && LIB.current.get(p.library_item_id);
    if (cur) libLink(p, { id: p.library_item_id, titre: p.library_titre, version_id: cur.id });
  },
  libUnlinkProc: async (b) => {
    const p = libProc(b);
    if (!p?.id || !confirm('Retirer la vidéo de ce procédé ?\n\nElle reste dans la bibliothèque.')) return;
    const { error } = await sb.rpc('library_link_procedure', { p_procedure: p.id, p_version: null });
    if (error) return toast(libError(error), 'error');
    Object.assign(p, { library_item_id: null, library_version_id: null, library_titre: '' });
    refreshLibBoxes();
  },
});
