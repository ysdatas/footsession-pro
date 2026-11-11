/* ============================================================
   LMFC Performance — analyse-coding.js
   Fenêtre de codage de l'onglet Analyse (admin, coach, analyste ; la base
   refuse les autres, lmfc_v48.sql et lmfc_v49.sql). Trois usages, une fenêtre :
     - un clip existant (double-clic sur la timeline) : découpage, action et
       ses champs, points au clic, minute du match, tags ;
     - un nouveau clip (début et fin marqués sur la timeline) : la séquence
       est créée ET codée à l'enregistrement, en une transaction, et reste
       réservée au staff (aucun réglage de partage ici) ; « Annuler » ne crée rien ;
     - plusieurs clips (AN.bulk, « Ajouter des descripteurs ») : seuls les
       descripteurs renseignés sont écrits ; l'action d'un clip déjà codé ne
       se change pas ici.
   Vocabulaire du club : descripteur = action et ses champs ; tag = observation libre.
   Un champ non choisi reste inconnu ; recliquer une valeur choisie l'efface.
   ============================================================ */

const AN_NUM = ['periode', 'ligne', 'nb_attaquants', 'touches', 'tiers_depart', 'tiers_arrivee'];
/* Lignes de la fenêtre : l'action, ses champs (menus de l'espace + champs sans menu), puis le contexte. */
const AN_CODE_ACTION = anF('action', 'Action', Object.entries(AN_ACTIONS).map(([a, A]) => [a, A.one]));
const AN_CODE_COMMON = AN_GENERAL.filter(d => ['periode', 'ligne', 'nb_attaquants', 'pression'].includes(d.key));
const anActionRows = (action) => { const A = AN_ACTIONS[action]; return A ? [...A.filters, ...(A.more || [])] : []; };

function anEnsureModal() {
  if (document.getElementById('anCodeModal')) return;
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="anCodeModal">
    <div class="modal an-code-modal" role="dialog" aria-modal="true" aria-labelledby="anCodeTitle">
      <h2 class="as-h3" id="anCodeTitle">Coder le clip</h2><p class="an-code-sub" id="anCodeSub"></p><div id="anCodeBody"></div>
      <div class="modal-actions"><button type="button" class="btn" data-and="cancel">Annuler</button>
        <button type="button" class="btn btn-primary" data-and="save">Enregistrer</button></div></div></div>`);
  const m = document.getElementById('anCodeModal');
  m.addEventListener('click', anDraftClick);
  m.addEventListener('change', anDraftChange);
  m.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'anTagInput') { e.preventDefault(); anDraftAddTag(); } });
}

function anShowModal(title, sub) {
  anEnsureModal();
  document.getElementById('anCodeTitle').textContent = title;
  document.getElementById('anCodeSub').textContent = sub;
  anRenderDraft();
  openModal('anCodeModal');
  document.querySelector('#anCodeBody button')?.focus();
}

/* Un clip existant, ou un nouveau (clip sans id : { video_id, label, video_title, start_sec, end_sec }). */
function anOpenCoding(clip) {
  if (!clip) return;
  Object.assign(AN, { bulk: null, draftClip: clip });
  AN.draft = { ...Object.fromEntries(AN_CODE_FIELDS.map(k => [k, clip[k] ?? null])), tags: [...(clip.tags || [])],
    start_sec: Math.round(clip.start_sec * 100) / 100, end_sec: Math.round(clip.end_sec * 100) / 100 };
  anShowModal(clip.id ? 'Coder le clip' : 'Nouveau clip', clip.id ? anClipName(clip) : `${clip.video_title} · ${fmtT(clip.start_sec)} → ${fmtT(clip.end_sec)}`);
}

function anOpenBulk(ids) {
  Object.assign(AN, { bulk: ids, draftClip: null, draft: Object.fromEntries(AN_CODE_FIELDS.map(k => [k, null])) });
  anShowModal('Ajouter des descripteurs', `${ids.length} séquence${ids.length > 1 ? 's' : ''} : seuls les descripteurs que vous renseignez sont écrits, les autres ne bougent pas.`);
}

function anDraftRow(d) {
  const cur = AN.draft[d.key];
  return `<div class="an-crow" role="group" aria-label="${esc(d.label)}"><span class="an-crow-l">${esc(d.label)}</span><div class="an-crow-b">${d.values.map(([v, l]) => {
    const on = cur != null && String(cur) === v;
    return `<button type="button" class="an-chip${on ? ' is-on' : ''}" data-and="set" data-key="${d.key}" data-value="${esc(v)}" aria-pressed="${on}">${esc(l)}</button>`;
  }).join('')}</div></div>`;
}

function anDraftPitch() {
  const d = AN.draft;
  const hint = AN_ACTIONS[d.action]?.xy2 ? (d.x1 == null ? 'Cliquez le départ.' : d.x2 == null ? 'Cliquez l’arrivée.' : 'Un nouveau clic recommence au départ.')
    : 'Cliquez le lieu de l’action.';
  return `<p class="an-hint">${hint}</p>${anPitchHtml(d.x1 != null ? [{ ...AN.draftClip, ...d }] : [],
    { layer: anZonesLayer(), idp: 'an-code', label: 'Terrain du codage : cliquez pour placer le point' })}`;
}

const anNumInput = (k, label, attrs) => `<label class="an-xy"><span>${label}</span><input type="number" inputmode="decimal" ${attrs}
  data-and="num" data-key="${k}" value="${AN.draft[k] ?? ''}"></label>`;

/* Découpage dans la vidéo et minute du match (si elle est connue) : propres à UN clip. */
function anDraftClipRow() {
  const d = AN.draft, at = anTlTime(AN.draftClip.video_id);   // la vidéo de CE clip est-elle dans le lecteur ?
  const here = (k, l) => (at == null ? '' : `<button type="button" class="btn btn-sm btn-ghost" data-and="here" data-key="${k}" title="Reprendre la position de la vidéo (${fmtT(at)})">${l}</button>`);
  return `<div class="an-crow"><span class="an-crow-l">Clip (temps vidéo)</span><div class="an-crow-b an-xys">
      ${anNumInput('start_sec', `Début (s) · ${fmtT(d.start_sec ?? 0)}`, 'min="0" step="0.1"')}${here('start_sec', '⇤ ici')}
      ${anNumInput('end_sec', `Fin (s) · ${fmtT(d.end_sec ?? 0)}`, 'min="0" step="0.1"')}${here('end_sec', 'ici ⇥')}
      ${anNumInput('minute_match', 'Minute du match', 'min="0" max="150" step="1" placeholder="inconnue"')}</div></div>`;
}

function anRenderDraft() {
  const d = AN.draft, body = document.getElementById('anCodeBody');
  if (AN.bulk) {   // plusieurs clips : ce que leur mélange d'actions permet, rien d'autre
    const scope = anBulkScope(AN.clips.filter(c => AN.bulk.includes(c.id)));
    const rows = [...(scope.setAction ? [AN_CODE_ACTION] : []), ...anActionRows(scope.setAction ? d.action : scope.action), ...AN_CODE_COMMON];
    body.innerHTML = `${scope.setAction || scope.action ? '' : '<p class="an-hint">Actions différentes dans la sélection : seuls les descripteurs communs sont proposés.</p>'}
      ${rows.map(anDraftRow).join('')}`;
    return;
  }
  const A = AN_ACTIONS[d.action], rows = [AN_CODE_ACTION, ...anActionRows(d.action), ...AN_CODE_COMMON].map(anDraftRow);
  const xy = (k, label) => anNumInput(k, label, 'min="0" max="100" step="0.1"');
  const tags = d.tags.map(t => `<button type="button" class="an-chip is-on" data-and="tag-del" data-value="${esc(t)}"${anDescStyle(t)}
    aria-label="Retirer le tag ${esc(t)}">${esc(t)}<span class="arr arr-x" aria-hidden="true"></span></button>`).join('');
  body.innerHTML = `${anDraftClipRow()}${rows.join('')}
    <div class="an-crow"><span class="an-crow-l">Points (0 à 100)</span><div class="an-cpitch">
      <div class="an-cpitch-svg" id="anCodePitch">${anDraftPitch()}</div>
      <div class="an-xys">${xy('x1', 'x départ')}${xy('y1', 'y départ')}${A?.xy2 ? xy('x2', 'x arrivée') + xy('y2', 'y arrivée') : ''}
        <button type="button" class="btn btn-sm btn-ghost" data-and="clear-xy">Effacer les points</button></div></div></div>
    <div class="an-crow"><span class="an-crow-l">Tags</span><div class="an-crow-b">${tags}
      <input id="anTagInput" class="an-tag-input" list="anTagList" maxlength="40" placeholder="Nouveau tag" aria-label="Ajouter un tag">
      <datalist id="anTagList">${anKnownTags().filter(t => !d.tags.includes(t)).map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist>
      <button type="button" class="btn btn-sm" data-and="tag-add">Ajouter</button>
      <button type="button" class="btn btn-sm" data-and="lib">Bibliothèque de tags…</button></div></div>`;
}

function anDraftSet(key, value) {
  const d = AN.draft, same = d[key] != null && String(d[key]) === value;
  d[key] = same ? null : AN_NUM.includes(key) ? Number(value) : key === 'pression' ? value === 'true' : value;
  if (key !== 'action') return;
  // Nouvelle action : résultat et sous-famille n'ont plus le même sens, les champs qu'elle ne porte pas partent.
  const keep = anFields(d.action);
  for (const k of AN_CODE_FIELDS) if (k !== 'tags' && (!keep.includes(k) || k === 'resultat' || k === 'categorie')) d[k] = null;
}

function anDraftPoint({ x, y }) {
  const d = AN.draft;
  if (AN_ACTIONS[d.action]?.xy2 && d.x1 != null && d.x2 == null) Object.assign(d, { x2: x, y2: y });
  else Object.assign(d, { x1: x, y1: y, x2: null, y2: null });
}

function anDraftAddTag(tag = document.getElementById('anTagInput')?.value) {
  const input = document.getElementById('anTagInput');
  tag = (tag || '').trim().slice(0, 40);
  if (!tag || AN.draft.tags.includes(tag)) { if (input) input.value = ''; return; }
  if (AN.draft.tags.length >= 20) return toast('20 tags au plus par clip.', 'error');
  AN.draft.tags.push(tag);
  anRenderDraft();
  document.getElementById('anTagInput').focus();
}

async function anDraftSave(btn) {
  const d = AN.draft;
  if (AN.bulk) {   // seuls les champs renseignés ; points et tags ne se règlent pas ici
    const set = Object.fromEntries(Object.entries(d).filter(([k, v]) => v != null && !['x1', 'y1', 'x2', 'y2', 'tags'].includes(k)));
    if (!Object.keys(set).length) return toast('Aucun descripteur renseigné : rien à modifier.', 'error');
    if (await anTlBulk(AN.bulk, { set }, 'descripteurs ajoutés')) closeModal('anCodeModal');
    return;
  }
  if (document.getElementById('anTagInput')?.value.trim()) anDraftAddTag();   // tag tapé sans « Ajouter »
  if ((d.x1 == null) !== (d.y1 == null) || (d.x2 == null) !== (d.y2 == null)) return toast('Renseignez x et y ensemble.', 'error');
  if (!(d.start_sec >= 0) || !(d.end_sec - d.start_sec >= 0.5)) return toast('La fin doit suivre le début d’au moins une demi-seconde.', 'error');
  btn.disabled = true;
  try {
    const id = await anSaveCode(AN.draftClip, d);
    if (!AN.draftClip.id) anTlCreated(id);
    closeModal('anCodeModal');
    toast(AN.draftClip.id ? 'Clip enregistré.' : 'Clip créé et codé.');
    await anReload();
  } catch (err) {
    toast(err.message, 'error');   // une transaction : rien n'a été créé ni modifié
  } finally {
    btn.disabled = false;
  }
}

function anDraftClick(e) {
  const svg = e.target.closest('#anCodePitch .an-pitch-svg');
  if (svg) { anDraftPoint(anPitchPoint(svg, e)); return anRenderDraft(); }
  const b = e.target.closest('[data-and]');
  if (!b || b.disabled || b.matches('input')) return;
  const { and, key, value } = b.dataset;
  if (and === 'set') anDraftSet(key, value);
  else if (and === 'here') AN.draft[key] = Math.round(anTlTime(AN.draftClip.video_id) * 10) / 10;
  else if (and === 'clear-xy') Object.assign(AN.draft, { x1: null, y1: null, x2: null, y2: null });
  else if (and === 'tag-del') AN.draft.tags = AN.draft.tags.filter(t => t !== value);
  else if (and === 'tag-add') return anDraftAddTag();
  else if (and === 'lib') return anLibOpen('pick', { has: AN.draft.tags, onApply: (names) => { names.forEach(n => anDraftAddTag(n)); anRenderDraft(); } });
  else if (and === 'cancel') return closeModal('anCodeModal');
  else if (and === 'save') return anDraftSave(b);
  else return;
  anRenderDraft();
}

/* Nombres tapés : seul le terrain est redessiné (le focus reste dans les champs). */
function anDraftChange(e) {
  const t = e.target, k = t.dataset.key;
  if (t.dataset.and !== 'num') return;
  const max = Number(t.max) || Infinity, n = t.value === '' ? null : Math.min(max, Math.max(0, Math.round(Number(t.value) * 10) / 10));
  AN.draft[k] = Number.isFinite(n) ? (k === 'minute_match' ? Math.round(n) : n) : null;
  if (/^[xy][12]$/.test(k)) document.getElementById('anCodePitch').innerHTML = anDraftPitch();
}
