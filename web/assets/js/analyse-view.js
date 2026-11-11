/* ============================================================
   LMFC Performance — analyse-view.js
   Onglet Analyse de la fiche joueur (staff et lecteur) :
     - bandeau : menus déroulants des filtres généraux (#anFilters, posé
       dans l'en-tête joueur, visible quand l'onglet est ouvert) ;
     - AVEC BALLON | SANS BALLON : trois sous-rubriques chacun (une action
       affichée à la fois), ses menus, ses chiffres, son terrain cliquable
       et « Lire les vidéos », tous tirés de la MÊME liste (anActionClips) ;
     - en bas, et seulement là : les tableaux détaillés, un onglet par
       action, plus les lignes cassées ; export CSV de l'onglet ouvert ;
     - pour qui peut coder : le panneau « Timeline / Codage vidéo » collé en
       bas (analyse-timeline.js, analyse-timeline-edit.js), la fenêtre de codage (analyse-coding.js) et
       la bibliothèque de tags (analyse-tags.js).
   Lecture : lecteur vidéo existant (openVideoWorkspace, player-videos.js),
   avec la liste filtrée pour « Précédent / Suivant ».
     mountAnalyse(root, { player, profile, canCode })
   ============================================================ */

const AN = {
  root: null, player: null, profile: null, canCode: false, token: 0,
  videos: [], clips: [], descs: [], error: null, f: anEmptyFilters(),
  tab: { ballon: 'passe', sans: 'duel_sol' }, synth: 'passe', pitchEnd: 'zone_depart',
  draft: null, draftClip: null, bulk: null, lib: null,
  // Timeline : vue (tous les clips bout à bout | une vidéo), clip en cours, vidéo dans le lecteur et liens signés,
  // taille, zoom, marques du prochain clip, sélection, opérations à défaire.
  tl: { open: false, mode: 'all', cur: null, video: null, loaded: null, urls: new Map(), dur: 0, big: true, full: false, zoom: 1,
    in: null, out: null, sel: new Set(), undo: [], trim: false, dragged: false, front: false },
};
const AN_SYNTH = [...Object.entries(AN_ACTIONS).map(([a, A]) => [a, A.label]), ['lignes', 'Lignes cassées']];

async function mountAnalyse(root, { player, profile, canCode }) {
  Object.assign(AN, { root, player, profile, canCode, token: AN.token + 1 });
  if (!root.dataset.anBound) {
    root.dataset.anBound = '1';
    const head = document.getElementById('anFilters');
    for (const host of [root, head]) {
      host.addEventListener('click', anClick);
      host.addEventListener('change', anChange);
    }
    root.addEventListener('keydown', (e) => {   // formes du terrain (SVG) : Entrée ou Espace comme un bouton
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('g[role="button"][data-an]')) { e.preventDefault(); anClick(e); }
    });
    if (canCode) anTlMount();
  }
  await anReload();
}

async function anReload() {
  const token = AN.token;
  try {
    Object.assign(AN, await anFetch(AN.player.id), { error: null });
  } catch (err) {
    AN.error = err.message;
  }
  if (token === AN.token) anRender();
}

/* Le contrôle qui a le focus, décrit par ses attributs : retrouvé après le dessin. */
function anFocusKey(a) {
  if (!a?.closest?.('#anFilters, #pfAnalyse')) return null;
  return ['data-an-f', 'data-an-tag', 'data-an', 'data-an-video', 'data-level', 'data-space', 'data-key', 'data-value', 'data-seq', 'data-id']
    .filter(n => a.hasAttribute(n)).map(n => `[${n}="${CSS.escape(a.getAttribute(n))}"]`).join('') || null;
}

/* Redessine tout en gardant le focus clavier sur le même contrôle. */
function anRender() {
  const keep = anFocusKey(document.activeElement);
  anRenderFilters();
  AN.root.innerHTML = AN.error ? `<p class="an-error card" role="alert">${esc(AN.error)}</p>`
    : `<div class="an-spaces">${anSpaceHtml('ballon')}${anSpaceHtml('sans')}</div>${anSynthHtml()}`;
  if (keep) document.querySelector(`#anFilters ${keep}, #pfAnalyse ${keep}`)?.focus();
  anTlRender();   // analyse-timeline.js : rien pour qui ne code pas
  anLibRender();  // analyse-tags.js : la bibliothèque, si elle est ouverte
}

function anAllTags() { return [...new Set(AN.clips.flatMap(c => c.tags))].sort((a, b) => a.localeCompare(b, 'fr')); }
/* Match · séquence · minutage, puis action, résultat et tags une fois codé. */
function anClipName(c) {
  const A = AN_ACTIONS[c.action];
  return [c.video_title, c.label || 'Séquence', fmtT(c.start_sec), c.minute_match != null && `${c.minute_match}'`, A?.one,
    A && c.resultat && anLabel(A.res, c.resultat), ...c.tags.map(t => `#${t}`)]
    .filter(Boolean).join(' · ');
}

/* ---------- Menus déroulants et onglets ---------- */

/* Un menu = un choix. Plusieurs valeurs (OU) viennent des clics sur le terrain : le menu les annonce. */
function anSelect(level, d, key = d.key) {
  const on = AN.f[level][key] || [];
  return `<label class="an-sel"><span>${esc(d.label)}</span><select data-an-f="${level}" data-key="${key}"><option value="">Tous</option>
    ${on.length > 1 ? `<option value="" selected disabled>${on.length} sélectionnés</option>` : ''}${d.values.map(([v, l]) =>
      `<option value="${esc(v)}"${on.length === 1 && on[0] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}

function anTabsHtml(an, space, items, current, label) {
  return `<div class="an-tabs" role="group" aria-label="${esc(label)}">${items.map(([v, l]) => `<button type="button" class="an-tab${v === current ? ' is-on' : ''}"
    data-an="${an}" data-space="${space}" data-value="${v}" aria-pressed="${v === current}">${esc(l)}</button>`).join('')}</div>`;
}

function anRenderFilters() {
  const chosen = AN.f.general.tags || [], free = anAllTags().filter(t => !chosen.includes(t));
  const tagSel = `<label class="an-sel"><span>Tags</span><select data-an-tag><option value="">${chosen.length ? (free.length ? 'Ajouter…' : 'Aucun autre') : 'Tous'}</option>
    ${free.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></label>`;
  const chips = chosen.map(t => `<button type="button" class="an-chip is-on" data-an="untag" data-value="${esc(t)}"
    aria-label="Retirer le tag ${esc(t)} des filtres">${esc(t)}<span class="arr arr-x" aria-hidden="true"></span></button>`).join('');
  const any = Object.values(AN.f).some(f => Object.keys(f).length);
  document.getElementById('anFilters').innerHTML = `<div class="an-sel-grid">${AN_GENERAL.map(d => anSelect('general', d)).join('')}${tagSel}
    <button type="button" class="btn btn-sm an-reset" data-an="reset-all"${any ? '' : ' disabled'}>Réinitialiser</button></div>
    <div class="an-filters-foot">${chips}</div>`;
}

/* ---------- Espaces ---------- */

function anKpisHtml(action, list) {
  const A = AN_ACTIONS[action], n = anCount(list);
  const rows = A.res.length ? A.res.map(([v, l]) => [`${l}s`, n[v] ?? 0]) : anBreakdown(list, 'tiers_depart', AN_TIERS).map(r => [r.label, r.total]);
  if (A.res.some(([v]) => v === 'ok')) rows.push(['Réussite', `<span class="an-pct is-${anTone(n.pct)}">${anPct(n.pct)}</span>`]);
  return `<div class="an-kpis"><p class="an-kpi-main"><span>${esc(A.label)}</span><strong>${n.total}</strong></p>
    <dl>${rows.map(([l, v]) => `<div><dt>${esc(l)}</dt><dd>${v}</dd></div>`).join('')}</dl></div>`;
}

/* Chiffres des formes cliquables d'un terrain : la liste de l'action SANS son propre
   filtre sur ce champ, pour garder la vue d'ensemble pendant qu'on sélectionne. */
function anHitStats(action, key, values) {
  const base = anActionClips(AN.clips, { ...AN.f, [action]: { ...AN.f[action], [key]: [] } }, action), on = AN.f[action][key] || [];
  return Object.fromEntries(anBreakdown(base, key, values).map(r => [r.value, { ...r, on: on.includes(r.value) }]));
}

/* Passes : zones fonctionnelles (départ ou arrivée). Tirs : tiers offensif et zones de tir.
   Le reste : terrain classique, trois tiers cliquables. */
function anPitchBlock(action, list) {
  const A = AN_ACTIONS[action], shot = action === 'tir', withXY = list.filter(c => c.x1 != null).length;
  const hit = { level: action, key: action === 'passe' ? AN.pitchEnd : shot ? 'categorie' : 'tiers_depart' };
  const stats = anHitStats(action, hit.key, A.filters.find(d => d.key === hit.key).values);
  const tools = action !== 'passe' ? '' : `<div class="an-pitch-tools" role="group" aria-label="Ce que comptent les zones du terrain">
    ${[['zone_depart', 'Départ des passes'], ['zone_arrivee', 'Arrivée des passes']].map(([k, l]) =>
      `<button type="button" class="an-chip${hit.key === k ? ' is-on' : ''}" data-an="pitch-end" data-key="${k}" aria-pressed="${hit.key === k}">${l}</button>`).join('')}</div>`;
  const legend = (A.res.length ? A.res : [['na', A.one]]).map(([v, l]) => `<span class="an-leg"><span class="an-dot is-${v}" aria-hidden="true"></span>${esc(l)}</span>`).join('');
  return `<figure class="an-pitch-wrap">${tools}${anPitchHtml(list, { layer: action === 'passe' ? anZonesLayer(stats, hit) : anRectsLayer(stats, hit),
    shot, idp: `an-${action}`, label: `Terrain : ${A.label.toLowerCase()}. Cliquer une zone la filtre` })}
    <figcaption>${legend}<span class="an-grow"></span><span>${shot ? '↑' : '←'} Sens d'attaque · ${withXY} sur ${list.length} sur le terrain</span></figcaption></figure>`;
}

function anSpaceHtml(space) {
  const acts = Object.keys(AN_ACTIONS).filter(a => AN_ACTIONS[a].space === space), action = AN.tab[space], A = AN_ACTIONS[action];
  const list = anActionClips(AN.clips, AN.f, action), title = space === 'ballon' ? 'AVEC BALLON' : 'SANS BALLON';
  // Passes : la hauteur porte sur l'extrémité regardée sur le terrain (départ ou arrivée).
  const keyOf = (d) => (action === 'passe' && d === AN_HAUTEUR ? AN.pitchEnd.replace('zone', 'tiers') : d.key);
  return `<section class="card an-space" data-space="${space}" aria-labelledby="an-h-${space}">
    <header class="an-space-h"><h2 class="as-h3" id="an-h-${space}">${title}</h2>
      <button type="button" class="btn btn-sm btn-ghost" data-an="reset-space" data-space="${space}"${acts.some(a => Object.keys(AN.f[a]).length) ? '' : ' disabled'}>Réinitialiser</button></header>
    ${anTabsHtml('tab', space, acts.map(a => [a, AN_ACTIONS[a].label]), action, `Sous-rubriques ${title.toLowerCase()}`)}
    <div class="an-sel-grid">${A.filters.map(d => anSelect(action, d, keyOf(d))).join('')}</div>
    <div class="an-body"><div class="an-side">${anKpisHtml(action, list)}
      <button type="button" class="btn btn-primary an-play" data-an="play" data-space="${space}"${list.length ? '' : ' disabled'}>
        <span class="arr arr-play" aria-hidden="true"></span>Lire les vidéos (${list.length})</button></div>
      ${anPitchBlock(action, list)}</div></section>`;
}

/* ---------- Synthèse : les seuls tableaux détaillés de la page ---------- */

/* Tableaux de l'onglet ouvert, filtres actifs compris : un par champ codé de l'action. */
function anSynth() {
  const lignes = AN.synth === 'lignes', action = lignes ? 'passe' : AN.synth, A = AN_ACTIONS[action], list = anActionClips(AN.clips, AN.f, action);
  const defs = [...A.filters, ...(A.more || [])].filter(d => (lignes ? d.key === 'lignes' : d.key !== 'resultat'));
  return { A, list, sets: defs.map(d => ({ title: d.label, rows: anBreakdown(list, d.key, d.values) })) };
}

function anTableHtml(s, A, total) {
  const pct = A.res.some(([v]) => v === 'ok');
  const body = s.rows.map(r => `<tr><th scope="row">${esc(r.label)}</th>${A.res.map(([v]) => `<td>${r[v] ?? 0}</td>`).join('')}<td>${r.total}</td>
    <td>${total ? anPct(Math.round((r.total / total) * 1000) / 10) : '–'}</td>${pct ? `<td><span class="an-pct is-${anTone(r.pct)}">${anPct(r.pct)}</span></td>` : ''}</tr>`).join('');
  return `<table class="an-table"><caption>${esc(s.title)}</caption><thead><tr><th scope="col"><span class="sr-only">Valeur</span></th>
    ${A.res.map(([, l]) => `<th scope="col">${esc(l)}s</th>`).join('')}<th scope="col">Total</th><th scope="col">Part</th>${pct ? '<th scope="col">Réussite</th>' : ''}</tr></thead>
    <tbody>${body}</tbody></table>`;
}

function anSynthHtml() {
  const { A, list, sets } = anSynth(), n = anCount(list);
  const note = AN.synth !== 'lignes' ? '' : `<p class="an-note">Passe réussie : ligne franchie. Passe ratée : simple tentative.
    Une passe vers la Zone 2 (Carré) vise la ligne médiane, sauf si le codage dit autre chose.</p>`;
  return `<section class="card an-synth" aria-labelledby="an-h-synth">
    <header class="an-space-h"><h2 class="as-h3" id="an-h-synth">SYNTHÈSE ET TABLEAUX STATISTIQUES</h2>
      <button type="button" class="btn btn-sm" data-an="export">Exporter</button></header>
    ${anTabsHtml('synth', '', AN_SYNTH, AN.synth, 'Tableaux par catégorie')}
    <p class="an-synth-sum"><span>Total ${esc(A.label.toLowerCase())}</span><strong>${n.total}</strong>
      ${A.res.some(([v]) => v === 'ok') ? `<span>Réussite</span><span class="an-pct is-${anTone(n.pct)}">${anPct(n.pct)}</span>` : ''}</p>${note}
    <div class="an-tables">${sets.map(s => anTableHtml(s, A, n.total)).join('')}</div></section>`;
}

/* Export de l'onglet ouvert : CSV « ; » avec BOM (s'ouvre tel quel dans Excel en français). */
function anExport() {
  const { A, sets } = anSynth(), cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`, pct = A.res.some(([v]) => v === 'ok');
  const lines = sets.flatMap(s => [[s.title, ...A.res.map(([, l]) => `${l}s`), 'Total', ...(pct ? ['% réussite'] : [])],
    ...s.rows.map(r => [r.label, ...A.res.map(([v]) => r[v] ?? 0), r.total, ...(pct ? [r.pct == null ? '' : String(r.pct).replace('.', ',')] : [])]), []]);
  const url = URL.createObjectURL(new Blob([`﻿${lines.map(l => l.map(cell).join(';')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
  Object.assign(document.createElement('a'), { href: url, download: `analyse-${AN.synth}-${AN.player.nom || AN.player.id}.csv` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Actions ---------- */

/* Lit les clips de la sous-rubrique ouverte, filtres compris, à la suite. */
function anPlay(space) {
  const items = anActionClips(AN.clips, AN.f, AN.tab[space]).map(c => ({ seqId: c.id, label: anClipName(c), player: AN.player,
    video: AN.videos.find(v => v.id === c.video_id) })).filter(it => it.video);
  document.getElementById('anVideo')?.pause();
  if (items[0]) openVideoWorkspace({ video: items[0].video, player: AN.player, profile: AN.profile, seqId: items[0].seqId, playlist: items, onChange: anReload });
}

/* Départ ↔ arrivée des passes : le filtre de hauteur suit l'extrémité regardée. */
function anPitchEnd(key) {
  const P = AN.f.passe, from = AN.pitchEnd.replace('zone', 'tiers'), to = key.replace('zone', 'tiers');
  if (from !== to && P[from]) { P[to] = P[from]; delete P[from]; }
  AN.pitchEnd = key;
}

function anClick(e) {
  const b = e.target.closest('[data-an]');
  if (!b || b.disabled) return;
  const { an, level, space, key, value } = b.dataset;
  if (an === 'toggle') anToggle(AN.f, level, key, value);
  else if (an === 'tab') AN.tab[space] = value;
  else if (an === 'synth') AN.synth = value;
  else if (an === 'pitch-end') anPitchEnd(key);
  else if (an === 'untag') anToggle(AN.f, 'general', 'tags', value);
  else if (an === 'reset-space') { for (const a in AN_ACTIONS) if (AN_ACTIONS[a].space === space) AN.f[a] = {}; }
  else if (an === 'reset-all') AN.f = anEmptyFilters();
  else if (an === 'play') return anPlay(space);
  else if (an === 'export') return anExport();
  else return;
  anRender();
}

function anChange(e) {
  const t = e.target;
  if (t.dataset.anF) {
    if (t.value) AN.f[t.dataset.anF][t.dataset.key] = [t.value]; else delete AN.f[t.dataset.anF][t.dataset.key];
  } else if ('anTag' in t.dataset) {
    if (t.value) anToggle(AN.f, 'general', 'tags', t.value);
  } else return;
  anRender();
}
