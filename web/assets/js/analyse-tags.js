/* ============================================================
   LMFC Performance — analyse-tags.js
   Bibliothèque de tags de l'onglet Analyse (lmfc_v49.sql).
   Vocabulaire du club : un DESCRIPTEUR est une donnée codée du clip (action,
   résultat, sens, zone, pied… : analyse-coding.js). Un TAG est une
   observation libre posée dessus (« Passe cassant une ligne ») : c'est lui
   qu'on gère ici. Le catalogue du club (table sequence_descriptors, nommée
   avant ce choix de mots) range chaque tag dans une catégorie et lui donne
   une couleur ; un tag absent du catalogue reste utilisable : « Sans catégorie ».
   Aucun calcul de réussite ne regarde les tags.
   Panneau fixe à droite du lecteur de la timeline (jamais par-dessus la vidéo) :
     - une séquence ouverte dans le panneau de codage : un clic pose ou
       retire le tag, enregistré tout seul (analyse-autosave.js) ;
     - plusieurs séquences sélectionnées : cocher, puis « Appliquer aux 12
       séquences » ; ce que la sélection porte déjà se retire d'un clic ; la
       sélection reste. Les cases cochées repartent à zéro quand la cible change ;
     - gérer : créer, renommer, ranger, colorer, archiver, supprimer.
   Archiver = ne plus le proposer, sans le retirer des clips déjà codés.
   Supprimer = le retirer de tous les clips : nombre annoncé, confirmation.
   ============================================================ */

const AN_DESC_CATS = [['technique', 'Technique'], ['tactique', 'Tactique'], ['comportement', 'Comportement'], ['defensif', 'Défensif'],
  ['offensif', 'Offensif'], ['autre', 'Autre']];
/* Bibliothèque de départ, proposée tant que le catalogue est vide : la liste du club.
   Un nom n'y figure qu'une fois (« Bonne couverture » : rangé en tactique). */
const AN_DESC_START = {
  technique: ['Bonne qualité de contrôle', 'Mauvais contrôle', 'Bonne orientation corporelle', 'Mauvaise orientation corporelle', 'Bonne qualité de passe',
    'Passe imprécise', 'Bonne qualité de frappe'],
  tactique: ["Prise d'information", 'Anticipation', 'Passe cassant une ligne', "Bonne occupation de l'espace", 'Mauvais positionnement', 'Bonne couverture',
    'Mauvais placement', "Fixation de l'adversaire"],
  comportement: ['Sous pression', 'Sans pression', 'Bonne prise de décision', 'Mauvaise prise de décision', 'Réactivité', 'Intensité'],
  defensif: ['Bonne intervention', 'Lecture de trajectoire', 'Marquage efficace', 'Intervention en retard', 'Mauvaise anticipation'],
  offensif: ['Bonne percussion', 'Bon appel', 'Création de décalage', 'Mauvaise décision', 'Bonne projection', 'Capacité à éliminer'],
};

const anDesc = (tag) => AN.descs.find(d => d.nom === tag);
/* Couleur du tag, portée par la puce (la base n'accepte que #rrggbb). */
function anDescStyle(tag) { const c = anDesc(tag)?.couleur; return c ? ` style="--c:${esc(c)}"` : ''; }
/* Tags proposés à la saisie : ceux des clips et le catalogue en service. */
function anKnownTags() {
  return [...new Set([...anAllTags(), ...AN.descs.filter(d => !d.archived_at).map(d => d.nom)])].sort((a, b) => a.localeCompare(b, 'fr'));
}
/* Groupes affichés : chaque catégorie du catalogue, puis les tags de clips qui n'y sont pas. */
function anDescGroups(withArchived) {
  const rows = AN.descs.filter(d => withArchived || !d.archived_at), loose = anAllTags().filter(t => !anDesc(t));
  return [...AN_DESC_CATS.map(([k, l]) => [l, rows.filter(d => d.categorie === k)]), ['Sans catégorie', loose.map(nom => ({ nom }))]].filter(([, list]) => list.length);
}

/* Monté une fois, sous le panneau de codage, à droite du lecteur (analyse-timeline.js) : toujours visible. */
function anLibMount(side) {
  side.insertAdjacentHTML('beforeend', `<section class="an-pane an-lib open" id="anLibModal" aria-labelledby="anLibTitle">
      <div class="an-pane-head"><h2 class="as-h4" id="anLibTitle">Bibliothèque de tags</h2>
        <button type="button" class="btn btn-sm btn-ghost" data-lib="mode" aria-pressed="false"></button></div>
      <p class="an-lib-for" id="anLibFor" aria-live="polite"></p>
      <input type="search" id="anLibQ" placeholder="Rechercher un tag" aria-label="Rechercher un tag" maxlength="40">
      <div id="anLibBody"></div>
      <div class="an-pane-actions"><button type="button" class="btn btn-sm btn-primary" data-lib="apply"></button></div></section>`);
  const m = document.getElementById('anLibModal');
  m.addEventListener('click', anLibClick);
  m.addEventListener('change', anLibChange);
  m.addEventListener('input', (e) => { if (e.target.id === 'anLibQ') { AN.lib.q = e.target.value; anLibRender(); } });
  AN.lib = { manage: false, q: '', picked: new Set() };
}

/* Ramène la bibliothèque à l'écran, champ de recherche sous le focus (bouton « Tags », bouton du codage). */
function anLibFocus() {
  anTlReveal();
  AN.lib.manage = false;
  anLibRender();
  const q = document.getElementById('anLibQ');
  q.scrollIntoView({ block: 'nearest' });
  q.focus({ preventScroll: true });
}

/* Ce que visent les tags cochés : le clip ouvert dans le panneau de codage, sinon la sélection de la timeline.
   has : tag → nombre de séquences visées qui le portent déjà. */
function anLibTarget() {
  if (AN.draftClip && document.getElementById('anCodeModal')?.classList.contains('open')) return { draft: true, n: 1, has: new Map(AN.draft.tags.map(t => [t, 1])) };
  const picked = AN.clips.filter(c => AN.tl.sel.has(c.id)), has = new Map();
  for (const c of picked) for (const t of c.tags) has.set(t, (has.get(t) || 0) + 1);
  return { draft: false, n: picked.length, ids: picked.map(c => c.id), has };
}
const anLibKey = (T) => (T.draft ? `d${AN.draftClip.id}` : `s${T.ids.join(',')}`);

function anLibRender() {
  const lib = AN.lib, m = document.getElementById('anLibModal');
  if (!lib || !m) return;
  const T = anLibTarget(), q = lib.q.trim().toLowerCase(), hit = (nom) => !q || nom.toLowerCase().includes(q), manage = lib.manage;
  if (lib.key !== anLibKey(T)) { lib.key = anLibKey(T); lib.picked.clear(); }   // autre cible : rien de coché pour une autre
  for (const t of lib.picked) if (T.n && T.has.get(t) === T.n) lib.picked.delete(t);   // déjà partout : rien à poser
  const mode = m.querySelector('[data-lib="mode"]'), apply = m.querySelector('[data-lib="apply"]');
  mode.textContent = manage ? 'Poser des tags' : 'Gérer les tags';
  mode.setAttribute('aria-pressed', manage);
  apply.parentNode.hidden = manage || T.draft;   // la barre entière : collée en bas, elle cacherait des tags
  apply.disabled = !lib.picked.size || !T.n;
  apply.textContent = T.draft ? 'Ajouter au clip' : !T.n ? 'Appliquer' : `Appliquer ${T.n > 1 ? `aux ${T.n} séquences` : 'à la séquence'}${lib.picked.size ? ` (${anPlural(lib.picked.size, 'tag')})` : ''}`;
  document.getElementById('anLibFor').innerHTML = manage || T.draft ? '' : T.n ? `<strong>${anPlural(T.n, 'séquence sélectionnée', 'séquences sélectionnées')}</strong>`
    : 'Aucune séquence sélectionnée.';
  const there = !manage && !T.draft ? [...T.has].filter(([t]) => hit(t)).sort(([a], [b]) => a.localeCompare(b, 'fr')) : [];
  const groups = anDescGroups(manage).map(([label, list]) => [label, list.filter(d => hit(d.nom))]).filter(([, list]) => list.length);
  document.getElementById('anLibBody').innerHTML = (manage ? anLibManageHead() : '')
    + (there.length ? `<section class="an-lib-group"><h3 class="as-h4">Déjà sur la sélection</h3><div class="an-crow-b">${there.map(([t, n]) =>
      `<button type="button" class="an-chip is-on" data-lib="drop" data-value="${esc(t)}"${anDescStyle(t)} title="Retirer de la sélection"
        aria-label="Retirer ${esc(t)} des ${n} séquences sélectionnées qui le portent">${esc(t)} <small>${n}/${T.n}</small><span class="arr arr-x" aria-hidden="true"></span></button>`).join('')}</div></section>` : '')
    + (groups.length ? groups.map(([label, list]) => `<section class="an-lib-group"><h3 class="as-h4">${esc(label)}</h3>
        ${manage ? `<ul class="an-lib-rows">${list.map(anLibRow).join('')}</ul>` : `<div class="an-crow-b">${list.map(d => anLibChip(d, T)).join('')}</div>`}</section>`).join('')
      : `<p class="text-muted">${q ? 'Aucun tag ne correspond.' : 'Aucun tag : ouvrez « Gérer les tags » pour en créer.'}</p>`);
}

/* Un tag. Séquence ouverte : allumé s'il la porte, un clic le pose ou le retire.
   Sélection : à cocher ; déjà sur toutes, allumé et inactif ; sur une partie, « 5/12 ». */
function anLibChip(d, T) {
  const n = T.has.get(d.nom) || 0, all = T.n > 0 && n === T.n, on = AN.lib.picked.has(d.nom);
  if (T.draft) return `<button type="button" class="an-chip${n ? ' is-on' : ''}" data-lib="toggle" data-value="${esc(d.nom)}" aria-pressed="${!!n}"${anDescStyle(d.nom)}>${esc(d.nom)}</button>`;
  const tip = all ? (T.draft ? 'Déjà sur le clip' : 'Déjà sur toutes les séquences sélectionnées') : n ? `Déjà sur ${n} séquence${n > 1 ? 's' : ''} sur ${T.n}` : '';
  return `<button type="button" class="an-chip${on ? ' is-on' : ''}${all ? ' is-has' : ''}" data-lib="pick" data-value="${esc(d.nom)}" aria-pressed="${on || all}"${
    all ? ' aria-disabled="true"' : ''}${tip ? ` title="${tip}"` : ''}${anDescStyle(d.nom)}>${all ? '✓ ' : ''}${esc(d.nom)}${n && !all ? ` <small>${n}/${T.n}</small>` : ''}</button>`;
}

/* Séquence ouverte : le tag est posé ou retiré, et part avec la sauvegarde automatique. */
function anLibToggle(tag) {
  const d = AN.draft;
  if (d.tags.includes(tag)) d.tags = d.tags.filter(t => t !== tag);
  else if (d.tags.length >= 20) return toast('20 tags au plus par séquence.', 'error');
  else d.tags.push(tag);
  anRenderDraft();
  anDraftDirty();
}

/* Tags cochés posés sur la sélection : une transaction, ⌘Z. La sélection reste. */
async function anLibApply() {
  const T = anLibTarget(), names = [...AN.lib.picked];
  if (!names.length || !T.n || T.draft) return;
  if (await anTlBulk(T.ids, { add: names }, anPlural(names.length, 'tag ajouté', 'tags ajoutés'))) { AN.lib.picked.clear(); anLibRender(); }
}

const anCatOptions = (cur) => AN_DESC_CATS.map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${l}</option>`).join('');

function anLibManageHead() {
  return `<div class="an-lib-new"><input type="text" id="anLibName" maxlength="40" placeholder="Nouveau tag" aria-label="Nom du nouveau tag">
      <select id="anLibCat" aria-label="Catégorie du nouveau tag">${anCatOptions('technique')}</select>
      <input type="color" id="anLibColor" value="#e8c14a" aria-label="Couleur du nouveau tag">
      <button type="button" class="btn btn-sm btn-primary" data-lib="create">Créer</button></div>
    ${AN.descs.length ? '' : '<p><button type="button" class="btn btn-sm" data-lib="seed">Ajouter la bibliothèque de départ</button></p>'}`;
}

/* Une ligne de gestion. Un tag hors catalogue n'a pas d'identifiant : le ranger dans une catégorie l'y inscrit. */
function anLibRow(d) {
  const name = esc(d.nom), off = !!d.archived_at;
  return `<li class="an-lib-row${off ? ' is-off' : ''}">
    <input type="color" data-lib-set="couleur" data-value="${name}" value="${esc(d.couleur || '#9a9a9a')}" aria-label="Couleur de ${name}"${d.id ? '' : ' disabled'}>
    <span class="an-lib-name">${name}${off ? ' <small>(archivé)</small>' : ''}</span>
    <select data-lib-set="categorie" data-value="${name}" aria-label="Catégorie de ${name}">${d.id ? '' : '<option value="">Sans catégorie</option>'}${anCatOptions(d.categorie)}</select>
    <button type="button" class="btn btn-sm btn-ghost" data-lib="rename" data-value="${name}">Renommer</button>
    ${d.id ? `<button type="button" class="btn btn-sm btn-ghost" data-lib="archive" data-value="${name}">${off ? 'Restaurer' : 'Archiver'}</button>` : ''}
    <button type="button" class="btn btn-sm btn-danger" data-lib="delete" data-value="${name}">Supprimer</button></li>`;
}

/* Écrit puis relit : le catalogue et les clips affichés suivent (anReload redessine aussi cette fenêtre). */
async function anLibRun(fn, done) {
  try { await fn(); if (done) toast(done); } catch (err) { toast(err.message, 'error'); }
  await anReload();
}

async function anLibClick(e) {
  const b = e.target.closest('[data-lib]');
  if (!b || b.disabled) return;
  if (b.getAttribute('aria-disabled') === 'true') return;
  const lib = AN.lib, { lib: act, value } = b.dataset, d = anDesc(value);
  if (act === 'pick') { if (lib.picked.has(value)) lib.picked.delete(value); else lib.picked.add(value); return anLibRender(); }
  if (act === 'mode') { lib.manage = !lib.manage; return anLibRender(); }
  if (act === 'apply') return anLibApply();
  if (act === 'toggle') return anLibToggle(value);
  if (act === 'drop') return anTlBulk(anLibTarget().ids, { remove: [value] }, `tag « ${value} » retiré`);
  if (act === 'seed') return anLibRun(() => anDescSeed(Object.entries(AN_DESC_START).flatMap(([categorie, noms]) => noms.map(nom => ({ nom, categorie })))),
    'Bibliothèque de départ ajoutée.');
  if (act === 'create') {
    const nom = document.getElementById('anLibName').value.trim();
    if (!nom) return toast('Donnez un nom au tag.', 'error');
    if (anDesc(nom)) return toast(`« ${nom} » existe déjà${anDesc(nom).archived_at ? ' (archivé : restaurez-le)' : ''}.`, 'error');
    return anLibRun(() => anDescSave({ nom, categorie: document.getElementById('anLibCat').value, couleur: document.getElementById('anLibColor').value }), `« ${nom} » créé.`);
  }
  if (act === 'archive') return anLibRun(() => anDescSave({ id: d.id, archived_at: d.archived_at ? null : new Date().toISOString() }),
    d.archived_at ? `« ${value} » de nouveau proposé.` : `« ${value} » archivé : il reste sur les clips déjà codés.`);
  if (act === 'rename') {
    const name = (await promptDialog(`Renommer « ${value} » dans le catalogue et sur tous les clips ?`, value))?.trim().slice(0, 40);
    if (name && name !== value) return anLibRun(async () => { const n = await anRenameTag(value, name); anTagFollow(value, name); toast(`Renommé sur ${anPlural(n, 'clip')}.`); });
  }
  if (act === 'delete') {
    let uses;
    try { uses = await anTagUses(value); } catch (err) { return toast(err.message, 'error'); }
    const ok = await confirmDialog(`Supprimer définitivement « ${value} » ? Il sera retiré de ${anPlural(uses, 'clip')} du club, sans retour possible.${
      d?.id ? ' Pour le garder sur les clips déjà codés, archivez-le plutôt.' : ''}`);
    if (ok) return anLibRun(async () => { const n = await anRenameTag(value, ''); anTagFollow(value, ''); toast(`Supprimé, retiré de ${anPlural(n, 'clip')}.`); });
  }
}

/* Le filtre « Tags » du bandeau suit un tag renommé ou supprimé. */
function anTagFollow(oldTag, newTag) {
  const chosen = AN.f.general.tags;
  if (!chosen?.includes(oldTag)) return;
  AN.f.general.tags = [...new Set(chosen.map(t => (t === oldTag ? newTag : t)).filter(Boolean))];
  if (!AN.f.general.tags.length) delete AN.f.general.tags;
}

/* Couleur ou catégorie changée sur une ligne de gestion. */
function anLibChange(e) {
  const t = e.target, key = t.dataset.libSet, d = anDesc(t.dataset.value);
  if (!key || (!d && !t.value)) return;
  anLibRun(() => anDescSave(d ? { id: d.id, [key]: t.value } : { nom: t.dataset.value, categorie: t.value }));
}
