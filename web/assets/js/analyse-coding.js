/* ============================================================
   LMFC Performance — analyse-coding.js
   Panneau de codage de l'onglet Analyse (admin, coach, analyste ; la base
   refuse les autres, lmfc_v48.sql et lmfc_v49.sql), à droite du lecteur :
     - une séquence (un clic sur la timeline) : découpage, action et ses
       champs, points, minute du match, tags. Le panneau est rechargé depuis
       ce qui est enregistré à chaque changement de séquence, rien d'une autre
       ne reste ; chaque modification s'enregistre seule (analyse-autosave.js) ;
     - plusieurs séquences (« Ajouter des descripteurs ») : seuls les
       descripteurs renseignés sont écrits, sur « Appliquer » ; l'action d'un
       clip déjà codé ne se change pas ici.
   Vocabulaire du club : descripteur = action et ses champs ; tag = observation libre.
   Un champ non choisi reste inconnu ; recliquer une valeur choisie l'efface.
   Changer d'action retire ce que la nouvelle ne porte pas (rien n'est
   converti) ; ⌘Z le rend, tant que la séquence n'a pas été recodée.
   ============================================================ */

const AN_NUM = ['periode', 'ligne', 'nb_attaquants', 'touches', 'tiers_depart', 'tiers_arrivee'];
/* Lignes de la fenêtre : l'action, ses champs (menus de l'espace + champs sans menu), puis le contexte. */
const AN_CODE_ACTION = anF('action', 'Action', Object.entries(AN_ACTIONS).map(([a, A]) => [a, A.one]));
const AN_CODE_COMMON = AN_GENERAL.filter(d => ['periode', 'ligne', 'nb_attaquants', 'pression'].includes(d.key));
const anActionRows = (action) => { const A = AN_ACTIONS[action]; return A ? [...A.filters, ...(A.more || [])] : []; };

function anEnsureModal() {
  if (document.getElementById('anCodeModal')) return;
  anDockEl('side').insertAdjacentHTML('afterbegin', `<section class="an-pane an-code" id="anCodeModal" aria-labelledby="anCodeTitle">
      <div class="an-pane-head"><h2 class="as-h4" id="anCodeTitle">Séquence</h2>
        <span class="an-save-box" data-el="save"><button type="button" class="an-save" id="anSaveState" data-and="retry" aria-live="polite" disabled></button>
          <button type="button" class="btn btn-sm btn-ghost" id="anSaveDrop" data-and="discard" hidden>Annuler les modifications</button></span></div>
      <p class="an-code-sub" id="anCodeSub"></p><div id="anCodeBody"></div>
      <div class="an-pane-actions" data-el="bulk-actions"><button type="button" class="btn btn-sm" data-and="cancel">Fermer</button>
        <button type="button" class="btn btn-sm btn-primary" data-and="save">Appliquer</button></div></section>`);
  const m = document.getElementById('anCodeModal');
  m.addEventListener('click', anDraftClick);
  m.addEventListener('change', anDraftChange);
  m.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'anTagInput') { e.preventDefault(); anDraftAddTag(); } });
}

function anShowModal(title, sub, focus) {
  anTlReveal();
  anEnsureModal();
  document.getElementById('anCodeTitle').textContent = title;
  document.getElementById('anCodeSub').textContent = sub;
  anDockEl('bulk-actions').hidden = !AN.bulk;
  document.querySelector('#anCodeModal [data-el="save"]').hidden = !!AN.bulk;
  openModal('anCodeModal');   // ouvert avant le dessin : la bibliothèque vise alors cette séquence
  anRenderDraft();
  anDockEl('side').scrollTop = 0;
  if (focus) document.querySelector('#anCodeBody button')?.focus({ preventScroll: true });
}

/* Ferme le panneau. Une séquence modifiée est d'abord enregistrée ; en cas d'échec, il reste ouvert. */
async function anCodeClose() {
  if (!await anCodeFlush()) return false;
  closeModal('anCodeModal');
  Object.assign(AN, { draftClip: null, bulk: null });
  anLibRender();
  return true;
}

/* Une séquence, telle qu'enregistrée : rien du brouillon d'une autre ne reste. */
function anOpenCoding(clip) {
  if (!clip) return;
  clearTimeout(anSave.timer);
  Object.assign(anSave, { dirty: false, again: false });
  Object.assign(AN, { bulk: null, draftClip: clip });
  AN.draft = { ...Object.fromEntries(AN_CODE_FIELDS.map(k => [k, clip[k] ?? null])), tags: [...(clip.tags || [])],
    start_sec: Math.round(clip.start_sec * 100) / 100, end_sec: Math.round(clip.end_sec * 100) / 100 };
  anShowModal(clip.label || 'Séquence', anClipName(clip).replace(/ · #.*$/, ''));
  anSaveStatus('saved');
  anDockEl('save').querySelector('#anSaveState').textContent = '';   // rien de modifié : pas d'indicateur
}

/* La séquence ouverte a changé ailleurs (annulation, rognage, tags groupés) : relue, si rien n'attend. */
function anPaneSync() {
  if (!AN.draftClip || anSave.dirty || anSave.running) return;
  const c = AN.clips.find(x => x.id === AN.draftClip.id);
  if (c) anOpenCoding(c); else anCodeClose();
}

function anOpenBulk(ids) {
  Object.assign(AN, { bulk: ids, draftClip: null, draft: Object.fromEntries(AN_CODE_FIELDS.map(k => [k, null])) });
  anShowModal('Ajouter des descripteurs', anPlural(ids.length, 'séquence'), true);
  document.querySelector('#anCodeModal [data-and="save"]').textContent = `Appliquer ${ids.length > 1 ? `aux ${ids.length} séquences` : 'à la séquence'}`;
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
  document.getElementById('anCodeBody').innerHTML = anDraftHtml();
  anLibRender();   // « déjà sur le clip » suit les tags du brouillon
}

function anDraftHtml() {
  const d = AN.draft;
  if (AN.bulk) {   // plusieurs clips : ce que leur mélange d'actions permet, rien d'autre
    const scope = anBulkScope(AN.clips.filter(c => AN.bulk.includes(c.id)));
    const rows = [...(scope.setAction ? [AN_CODE_ACTION] : []), ...anActionRows(scope.setAction ? d.action : scope.action), ...AN_CODE_COMMON];
    return `${scope.setAction || scope.action ? '' : '<p class="an-hint">Actions différentes : champs communs seulement.</p>'}
      ${rows.map(anDraftRow).join('')}`;
  }
  const A = AN_ACTIONS[d.action], rows = [AN_CODE_ACTION, ...anActionRows(d.action), ...AN_CODE_COMMON].map(anDraftRow);
  const xy = (k, label) => anNumInput(k, label, 'min="0" max="100" step="0.1"');
  const tags = d.tags.map(t => `<button type="button" class="an-chip is-on" data-and="tag-del" data-value="${esc(t)}"${anDescStyle(t)}
    aria-label="Retirer le tag ${esc(t)}">${esc(t)}<span class="arr arr-x" aria-hidden="true"></span></button>`).join('');
  return `${anDraftClipRow()}${rows.join('')}
    <div class="an-crow"><span class="an-crow-l">Points (0 à 100)</span><div class="an-cpitch">
      <div class="an-cpitch-svg" id="anCodePitch">${anDraftPitch()}</div>
      <div class="an-xys">${xy('x1', 'x départ')}${xy('y1', 'y départ')}${A?.xy2 ? xy('x2', 'x arrivée') + xy('y2', 'y arrivée') : ''}
        <button type="button" class="btn btn-sm btn-ghost" data-and="clear-xy">Effacer les points</button></div></div></div>
    <div class="an-crow"><span class="an-crow-l">Tags</span><div class="an-crow-b">${tags}
      <input id="anTagInput" class="an-tag-input" list="anTagList" maxlength="40" placeholder="Nouveau tag" aria-label="Ajouter un tag">
      <datalist id="anTagList">${anKnownTags().filter(t => !d.tags.includes(t)).map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist>
      <button type="button" class="btn btn-sm" data-and="tag-add">Ajouter</button></div></div>`;
}

function anDraftSet(key, value) {
  const d = AN.draft, same = d[key] != null && String(d[key]) === value;
  const v = same ? null : AN_NUM.includes(key) ? Number(value) : key === 'pression' ? value === 'true' : value;
  if (key !== 'action' || AN.bulk) { d[key] = v; return; }
  // Nouvelle action : ce qu'elle ne porte pas part, rien n'est converti (anMoveCode) ; ⌘Z le rend.
  const before = anCodePayload(d), { code, lost } = anMoveCode(d, v);
  Object.assign(d, code);
  if (lost.length) AN.tl.undo.push({ label: 'changement d’action', move: { id: AN.draftClip.id, before, after: anCodePayload(d) } });
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
  anDraftDirty();
  document.getElementById('anTagInput').focus();
}

/* « Appliquer » (plusieurs séquences) : seuls les champs renseignés ; points et tags ne se règlent pas ici. */
async function anDraftSave() {
  const set = Object.fromEntries(Object.entries(AN.draft).filter(([k, v]) => v != null && !['x1', 'y1', 'x2', 'y2', 'tags'].includes(k)));
  if (!Object.keys(set).length) return toast('Aucun descripteur choisi.', 'error');
  if (await anTlBulk(AN.bulk, { set }, 'descripteurs ajoutés')) anCodeClose();
}

function anDraftClick(e) {
  const svg = e.target.closest('#anCodePitch .an-pitch-svg');
  if (svg) { anDraftPoint(anPitchPoint(svg, e)); anRenderDraft(); return anDraftDirty(); }
  const b = e.target.closest('[data-and]');
  if (!b || b.disabled || b.matches('input')) return;
  const { and, key, value } = b.dataset;
  if (and === 'set') anDraftSet(key, value);
  else if (and === 'here') AN.draft[key] = Math.round(anTlTime(AN.draftClip.video_id) * 10) / 10;
  else if (and === 'clear-xy') Object.assign(AN.draft, { x1: null, y1: null, x2: null, y2: null });
  else if (and === 'tag-del') AN.draft.tags = AN.draft.tags.filter(t => t !== value);
  else if (and === 'tag-add') return anDraftAddTag();
  else if (and === 'cancel') return anCodeClose();
  else if (and === 'save') return anDraftSave();
  else if (and === 'retry') return anCodeFlush();
  else if (and === 'discard') { anSave.dirty = false; return anOpenCoding(AN.clips.find(c => c.id === AN.draftClip.id)); }
  else return;
  anRenderDraft();
  if (!AN.bulk) anDraftDirty();
}

/* Nombres tapés : seul le terrain est redessiné (le focus reste dans les champs). */
function anDraftChange(e) {
  const t = e.target, k = t.dataset.key;
  if (t.dataset.and !== 'num') return;
  const max = Number(t.max) || Infinity, n = t.value === '' ? null : Math.min(max, Math.max(0, Math.round(Number(t.value) * 10) / 10));
  AN.draft[k] = Number.isFinite(n) ? (k === 'minute_match' ? Math.round(n) : n) : null;
  if (/^[xy][12]$/.test(k)) document.getElementById('anCodePitch').innerHTML = anDraftPitch();
  anDraftDirty();
}
