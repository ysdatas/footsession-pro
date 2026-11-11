/* ============================================================
   LMFC Performance — analyse-tags.js
   Bibliothèque de descripteurs de l'onglet Analyse (lmfc_v49.sql).
   Un descripteur EST un tag de clip (sequence_codes.tags) ; le catalogue du
   club (sequence_descriptors) le range dans une catégorie et lui donne une
   couleur. Un tag absent du catalogue reste utilisable : « Sans catégorie ».
   Une observation qualitative : aucun calcul de réussite ne la regarde.
   Fenêtre par-dessus tout, qui ne touche ni à la sélection ni au codage ouvert :
     anLibOpen(mode, { n, has, only, onApply(noms) })
       'add'     cocher des descripteurs à poser sur n séquences
       'remove'  cocher, parmi « only », ceux à retirer de n séquences
       'pick'    cocher ceux à ajouter au clip en cours de codage (sauf « has »)
       'manage'  créer, renommer, ranger, colorer, archiver, supprimer
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
/* Couleur du descripteur, portée par la puce (la base n'accepte que #rrggbb). */
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

function anLibOpen(mode, opts = {}) {
  if (!document.getElementById('anLibModal')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop an-lib" id="anLibModal">
      <div class="modal an-lib-modal" role="dialog" aria-modal="true" aria-labelledby="anLibTitle">
        <h2 class="as-h3" id="anLibTitle">Bibliothèque de descripteurs</h2>
        <div class="an-lib-top"><input type="search" id="anLibQ" placeholder="Rechercher un descripteur" aria-label="Rechercher un descripteur" maxlength="40">
          <button type="button" class="btn btn-sm" data-lib="mode"></button></div>
        <div id="anLibBody"></div>
        <div class="modal-actions"><button type="button" class="btn" data-lib="close">Fermer</button>
          <button type="button" class="btn btn-primary" data-lib="apply"></button></div></div></div>`);
    const m = document.getElementById('anLibModal');
    m.addEventListener('click', anLibClick);
    m.addEventListener('change', anLibChange);
    m.addEventListener('input', (e) => { if (e.target.id === 'anLibQ') { AN.lib.q = e.target.value; anLibRender(); } });
  }
  AN.lib = { mode, back: mode === 'manage' ? null : mode, q: '', picked: new Set(), opts };
  document.getElementById('anLibQ').value = '';
  anLibRender();
  openModal('anLibModal');
  document.getElementById('anLibQ').focus();
}

function anLibRender() {
  const lib = AN.lib, m = document.getElementById('anLibModal');
  if (!lib || !m) return;
  const q = lib.q.trim().toLowerCase(), hit = (d) => !q || d.nom.toLowerCase().includes(q), manage = lib.mode === 'manage', n = lib.opts.n;
  const apply = m.querySelector('[data-lib="apply"]');
  m.querySelector('[data-lib="mode"]').textContent = manage ? (lib.back ? '← Retour au choix' : '') : 'Gérer les descripteurs';
  m.querySelector('[data-lib="mode"]').hidden = manage && !lib.back;
  apply.hidden = manage;
  apply.disabled = !lib.picked.size;
  apply.textContent = lib.mode === 'remove' ? `Retirer ${n > 1 ? `des ${n} séquences` : 'de la séquence'}`
    : lib.mode === 'pick' ? 'Ajouter au clip' : `Appliquer ${n > 1 ? `aux ${n} séquences` : 'à la séquence'}`;
  const groups = anDescGroups(manage).map(([label, list]) => [label, list.filter(hit).filter(d =>
    manage || (lib.mode === 'remove' ? lib.opts.only.includes(d.nom) : !(lib.opts.has || []).includes(d.nom)))]).filter(([, list]) => list.length);
  document.getElementById('anLibBody').innerHTML = (manage ? anLibManageHead() : '') + (groups.length
    ? groups.map(([label, list]) => `<section class="an-lib-group"><h3 class="as-h4">${esc(label)}</h3>
        ${manage ? `<ul class="an-lib-rows">${list.map(anLibRow).join('')}</ul>` : `<div class="an-crow-b">${list.map(d => {
          const on = lib.picked.has(d.nom);
          return `<button type="button" class="an-chip${on ? ' is-on' : ''}" data-lib="pick" data-value="${esc(d.nom)}" aria-pressed="${on}"${anDescStyle(d.nom)}>${esc(d.nom)}</button>`;
        }).join('')}</div>`}</section>`).join('')
    : `<p class="text-muted">${q ? 'Aucun descripteur ne correspond.' : lib.mode === 'remove' ? 'Ces séquences ne portent aucun descripteur.'
        : 'Aucun descripteur : ouvrez « Gérer les descripteurs » pour en créer.'}</p>`);
}

const anCatOptions = (cur) => AN_DESC_CATS.map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${l}</option>`).join('');

function anLibManageHead() {
  return `<div class="an-lib-new"><input type="text" id="anLibName" maxlength="40" placeholder="Nouveau descripteur" aria-label="Nom du nouveau descripteur">
      <select id="anLibCat" aria-label="Catégorie du nouveau descripteur">${anCatOptions('technique')}</select>
      <input type="color" id="anLibColor" value="#e8c14a" aria-label="Couleur du nouveau descripteur">
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
  const lib = AN.lib, { lib: act, value } = b.dataset, d = anDesc(value);
  if (act === 'close') return closeModal('anLibModal');
  if (act === 'pick') { if (lib.picked.has(value)) lib.picked.delete(value); else lib.picked.add(value); return anLibRender(); }
  if (act === 'mode') { lib.mode = lib.mode === 'manage' ? lib.back : 'manage'; return anLibRender(); }
  if (act === 'apply') { closeModal('anLibModal'); return lib.opts.onApply([...lib.picked]); }
  if (act === 'seed') return anLibRun(() => anDescSeed(Object.entries(AN_DESC_START).flatMap(([categorie, noms]) => noms.map(nom => ({ nom, categorie })))),
    'Bibliothèque de départ ajoutée.');
  if (act === 'create') {
    const nom = document.getElementById('anLibName').value.trim();
    if (!nom) return toast('Donnez un nom au descripteur.', 'error');
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
