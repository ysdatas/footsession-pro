/* ============================================================
   LMFC Performance — analyse-coding.js
   Codage des clips de l'onglet Analyse (admin, coach, analyste ; la base
   refuse les autres, lmfc_v48.sql) :
     - par vidéo : poste et lieu, repris par tous ses clips ;
     - par clip : fenêtre de codage (boutons, points x/y au clic sur le
       terrain ou en chiffres, tags). Un champ non choisi reste inconnu ;
       recliquer une valeur choisie l'efface ;
     - tags : renommer ou supprimer sur tous les clips.
   ============================================================ */

const AN_NUM = ['periode', 'ligne', 'nb_attaquants', 'touches', 'tiers_depart', 'tiers_arrivee'];
/* Lignes de la fenêtre : l'action, ses champs (menus de l'espace + champs sans menu), puis le contexte. */
const AN_CODE_ACTION = anF('action', 'Action', Object.entries(AN_ACTIONS).map(([a, A]) => [a, A.one]));
const AN_CODE_COMMON = AN_GENERAL.filter(d => ['periode', 'ligne', 'nb_attaquants', 'pression'].includes(d.key));
const anGeneral = (key) => AN_GENERAL.find(d => d.key === key).values;

function anActionLabel(c) {
  const A = AN_ACTIONS[c.action];
  return [A.one, c.resultat && anLabel(A.res, c.resultat)].filter(Boolean).join(' · ');
}

/* ---------- Carte « Codage des clips » ---------- */

function anVideoSelect(v, key, label, values) {
  return `<label class="an-sel an-sel-sm"><span>${label}</span><select data-an-video="${key}" data-id="${v.id}">
    <option value="">Inconnu</option>${values.map(([val, l]) => `<option value="${val}"${v[key] === val ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}

function anCodingCardHtml() {
  const todo = AN.clips.filter(c => !c.coded).length;
  const videos = AN.videos.map(v => {
    const clips = AN.clips.filter(c => c.video_id === v.id).map(c => `<li><span class="an-cv-c">${esc(c.label || 'Séquence')} · ${fmtT(c.start_sec)}</span>
      <span class="an-st${c.coded ? ' is-done' : ''}">${c.coded ? esc(anActionLabel(c)) : 'À coder'}</span>
      <button type="button" class="btn btn-sm" data-an="code" data-seq="${c.id}">${c.coded ? 'Modifier' : 'Coder'}</button></li>`).join('');
    return `<li class="an-cv"><div class="an-cv-h"><strong class="an-cv-t">${esc(v.titre)}</strong>
      ${anVideoSelect(v, 'poste', 'Poste', anGeneral('poste'))}${anVideoSelect(v, 'lieu', 'Lieu', anGeneral('lieu'))}</div>
      ${clips ? `<ol class="an-cv-clips">${clips}</ol>` : '<p class="text-muted">Pas de séquence : découpez-les dans l’onglet Vidéos.</p>'}</li>`;
  }).join('');
  const tags = anAllTags().map(t => `<li class="an-tagrow"><span>${esc(t)} <span class="an-n">(${AN.clips.filter(c => c.tags.includes(t)).length})</span></span>
    <button type="button" class="btn btn-sm btn-ghost" data-an="tag-rename" data-value="${esc(t)}">Renommer</button>
    <button type="button" class="btn btn-sm btn-danger" data-an="tag-delete" data-value="${esc(t)}">Supprimer</button></li>`).join('');
  return `<section class="card an-coding"><details class="an-details" data-an-open="coding"${anOpenAttr('coding')}>
    <summary><h2 class="as-h3">Codage des clips</h2><span class="an-on">${todo} à coder</span></summary>
    ${videos ? `<ol class="an-cv-list">${videos}</ol>` : '<p class="text-muted">Aucune vidéo pour ce joueur.</p>'}
    <h3 class="as-h4 an-tags-h">Tags</h3>
    ${tags ? `<ul class="an-tag-list">${tags}</ul>` : '<p class="text-muted">Aucun tag : ajoutez-les en codant un clip.</p>'}</details></section>`;
}

async function anTagRun(oldTag, newTag) {
  try {
    const n = await anRenameTag(oldTag, newTag);
    const chosen = AN.f.general.tags;
    if (chosen?.includes(oldTag)) {   // le filtre suit le tag renommé
      AN.f.general.tags = [...new Set(chosen.map(t => (t === oldTag ? newTag : t)).filter(Boolean))];
      if (!AN.f.general.tags.length) delete AN.f.general.tags;
    }
    toast(newTag ? `Tag renommé sur ${n} clip(s).` : `Tag supprimé de ${n} clip(s).`);
    await anReload();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function anCodingClick(b) {
  const { an, seq, value } = b.dataset;
  if (an === 'code') return anOpenCoding(Number(seq));
  if (an === 'tag-rename') {
    const name = (await promptDialog(`Renommer le tag « ${value} » sur tous les clips ?`, value))?.trim().slice(0, 40);
    if (name && name !== value) return anTagRun(value, name);
  }
  if (an === 'tag-delete' && await confirmDialog(`Supprimer le tag « ${value} » de tous les clips ?`)) return anTagRun(value, '');
}

async function anCodingChange(t) {
  if (!t.dataset.anVideo) return;
  try {
    await anSaveVideo(Number(t.dataset.id), { [t.dataset.anVideo]: t.value || null });
    await anReload();
  } catch (err) {
    toast(err.message, 'error');
    await anReload();   // le menu reprend la valeur enregistrée
  }
}

/* ---------- Fenêtre de codage d'un clip ---------- */

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

function anOpenCoding(seqId) {
  const clip = AN.clips.find(c => c.id === seqId);
  if (!clip) return;
  AN.draftClip = clip;
  AN.draft = { ...Object.fromEntries(AN_CODE_FIELDS.map(k => [k, clip[k] ?? null])), tags: [...clip.tags] };
  anEnsureModal();
  document.getElementById('anCodeSub').textContent = anClipName(clip);
  anRenderDraft();
  openModal('anCodeModal');
  document.querySelector('#anCodeBody button')?.focus();
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

function anRenderDraft() {
  const d = AN.draft, A = AN_ACTIONS[d.action];
  const rows = [AN_CODE_ACTION, ...(A ? [...A.filters, ...(A.more || [])] : []), ...AN_CODE_COMMON].map(anDraftRow);
  const xy = (k, label) => `<label class="an-xy"><span>${label}</span><input type="number" min="0" max="100" step="0.1"
    inputmode="decimal" data-and="xy" data-key="${k}" value="${d[k] ?? ''}"></label>`;
  const tags = d.tags.map(t => `<button type="button" class="an-chip is-on" data-and="tag-del" data-value="${esc(t)}"
    aria-label="Retirer le tag ${esc(t)}">${esc(t)}<span class="arr arr-x" aria-hidden="true"></span></button>`).join('');
  document.getElementById('anCodeBody').innerHTML = `${rows.join('')}
    <div class="an-crow"><span class="an-crow-l">Points (0 à 100)</span><div class="an-cpitch">
      <div class="an-cpitch-svg" id="anCodePitch">${anDraftPitch()}</div>
      <div class="an-xys">${xy('x1', 'x départ')}${xy('y1', 'y départ')}${A?.xy2 ? xy('x2', 'x arrivée') + xy('y2', 'y arrivée') : ''}
        <button type="button" class="btn btn-sm btn-ghost" data-and="clear-xy">Effacer les points</button></div></div></div>
    <div class="an-crow"><span class="an-crow-l">Tags</span><div class="an-crow-b">${tags}
      <input id="anTagInput" class="an-tag-input" list="anTagList" maxlength="40" placeholder="Nouveau tag" aria-label="Ajouter un tag">
      <datalist id="anTagList">${anAllTags().filter(t => !d.tags.includes(t)).map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist>
      <button type="button" class="btn btn-sm" data-and="tag-add">Ajouter</button></div></div>`;
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

function anDraftAddTag() {
  const input = document.getElementById('anTagInput'), tag = input?.value.trim().slice(0, 40);
  if (!tag || AN.draft.tags.includes(tag)) { if (input) input.value = ''; return; }
  if (AN.draft.tags.length >= 20) return toast('20 tags au plus par clip.', 'error');
  AN.draft.tags.push(tag);
  anRenderDraft();
  document.getElementById('anTagInput').focus();
}

async function anDraftSave(btn) {
  const d = AN.draft;
  if (document.getElementById('anTagInput')?.value.trim()) anDraftAddTag();   // tag tapé sans « Ajouter »
  if ((d.x1 == null) !== (d.y1 == null) || (d.x2 == null) !== (d.y2 == null)) return toast('Renseignez x et y ensemble.', 'error');
  btn.disabled = true;
  try {
    await anSaveCode(AN.draftClip, d, AN.player.id);
    closeModal('anCodeModal');
    toast('Clip codé.');
    await anReload();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function anDraftClick(e) {
  const svg = e.target.closest('#anCodePitch .an-pitch-svg');
  if (svg) { anDraftPoint(anPitchPoint(svg, e)); return anRenderDraft(); }
  const b = e.target.closest('[data-and]');
  if (!b || b.disabled) return;
  const { and, key, value } = b.dataset;
  if (and === 'set') anDraftSet(key, value);
  else if (and === 'clear-xy') Object.assign(AN.draft, { x1: null, y1: null, x2: null, y2: null });
  else if (and === 'tag-del') AN.draft.tags = AN.draft.tags.filter(t => t !== value);
  else if (and === 'tag-add') return anDraftAddTag();
  else if (and === 'cancel') return closeModal('anCodeModal');
  else if (and === 'save') return anDraftSave(b);
  else return;
  anRenderDraft();
}

/* Coordonnées tapées : seul le terrain est redessiné (le focus reste dans les champs). */
function anDraftChange(e) {
  const t = e.target;
  if (t.dataset.and !== 'xy') return;
  const v = t.value === '' ? null : Math.min(100, Math.max(0, Math.round(Number(t.value) * 10) / 10));
  AN.draft[t.dataset.key] = Number.isFinite(v) ? v : null;
  document.getElementById('anCodePitch').innerHTML = anDraftPitch();
}
