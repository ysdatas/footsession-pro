/* ============================================================
   LMFC Performance — analyse-timeline.js
   Panneau « Timeline / Codage vidéo », collé en bas de l'onglet Analyse
   (admin, coach, analyste). On y fait tout sans changer de page :
     - lire une vidéo du joueur ; marquer le début (I) et la fin (O), puis
       « Créer le clip » (Entrée) : la fenêtre de codage s'ouvre, la séquence
       est créée et codée ensemble (analyse-coding.js) ;
     - une ligne par action, un segment par clip, placés dans le TEMPS DE LA
       VIDÉO (la minute du match, quand elle est connue, est un champ du clip) ;
     - sélectionner : clic = un seul ; ⌘ ou Ctrl + clic = ajouter / retirer ;
       glisser dans le vide = rectangle (toutes les lignes = une plage de
       temps) ; ⌘A = tout ; Échap = rien. Double-clic = coder ou modifier ;
     - barre d'actions de la sélection : descripteurs ajoutés ou retirés,
       caractéristiques communes ; chaque opération est une transaction et se
       défait (⌘Z) sans écraser ce qui a changé depuis (lmfc_v49.sql).
   Raccourcis : seulement quand le focus est DANS le panneau (écouteur posé
   sur lui, pas sur la page) : une fenêtre de codage ouverte ne les reçoit pas.
     anTlMount()   anTlRender()   anTlBulk(ids, op, label)   anTlTime()
   ============================================================ */

const AN_TL_ZOOMS = [1, 2, 4, 8, 16, 32];
const anDockEl = (k) => document.querySelector(`#anDock [data-el="${k}"]`);
const anVid = () => document.getElementById('anVideo');
const anTlClips = () => AN.clips.filter(c => c.video_id === AN.tl.video);
/* Durée affichée : celle de la vidéo ; tant qu'elle n'est pas lue, la fin du dernier clip. */
const anTlDur = () => AN.tl.dur || Math.max(60, ...anTlClips().map(c => c.end_sec));
/* Position de lecture, ou null si aucune vidéo n'est chargée. */
function anTlTime() { const v = anVid(); return AN.tl.open && v?.readyState ? v.currentTime : null; }
const anPlural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

function anTlMount() {
  if (document.getElementById('anDock')) return;
  AN.root.insertAdjacentHTML('afterend', `<section id="anDock" class="an-dock" tabindex="-1" aria-label="Timeline de codage vidéo">
    <div class="an-dock-bar" data-el="bar"></div>
    <div class="an-dock-sel" data-el="selbar" hidden></div>
    <div class="an-dock-body" data-el="body" hidden>
      <div class="an-dock-video"><video id="anVideo" controls playsinline preload="metadata"></video><div class="an-dock-marks" data-el="marks"></div></div>
      <div class="an-tl"><div class="an-tl-names" data-el="names"></div>
        <div class="an-tl-scroll"><div class="an-tl-track" data-el="track"></div></div></div>
    </div></section>`);
  const dock = document.getElementById('anDock'), vid = anVid();
  dock.addEventListener('click', anTlClick);
  dock.addEventListener('dblclick', (e) => { const s = e.target.closest('.an-seg'); if (s) anOpenCoding(AN.clips.find(c => c.id === Number(s.dataset.seq))); });
  dock.addEventListener('change', anTlChange);
  dock.addEventListener('keydown', anTlKey);
  dock.addEventListener('pointerdown', anTlDown);
  vid.addEventListener('loadedmetadata', () => { AN.tl.dur = vid.duration || 0; anTlRender(); });
  vid.addEventListener('error', () => { AN.tl.loaded = null; });   // lien signé expiré : rechargé à la prochaine ouverture
  vid.addEventListener('timeupdate', anTlHead);
}

/* Lien de lecture signé de la vidéo choisie (comme l'onglet Vidéos). Sans lui, la timeline reste utilisable. */
async function anTlLoad() {
  const tl = AN.tl, v = AN.videos.find(x => x.id === tl.video);
  if (!tl.open || !v || tl.loaded === v.id) return;
  Object.assign(tl, { loaded: v.id, dur: 0, in: null, out: null });
  try {
    const url = await videoUrl(v.storage_path);
    if (!url) throw new Error('vidéo introuvable dans le stockage');
    if (tl.loaded === v.id) anVid().src = url;
  } catch (err) {
    console.error('Analyse : lecture impossible', err);
    toast(`Lecture impossible : ${err.message}. La timeline reste utilisable, sans création de clip.`, 'error');
  }
}

/* ---------- Dessin ---------- */

function anVideoSelect(v, key, label, values) {
  return `<label class="an-sel an-sel-sm"><span>${label}</span><select data-an-video="${key}" data-id="${v.id}">
    <option value="">Inconnu</option>${values.map(([val, l]) => `<option value="${val}"${v[key] === val ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}

function anTlRender() {
  const dock = document.getElementById('anDock'), tl = AN.tl;
  if (!dock) return;
  if (!AN.videos.some(v => v.id === tl.video)) tl.video = AN.videos[0]?.id ?? null;
  tl.sel = new Set([...tl.sel].filter(id => AN.clips.some(c => c.id === id)));   // un clip supprimé quitte la sélection
  const v = AN.videos.find(x => x.id === tl.video), todo = AN.clips.filter(c => !c.coded).length, last = tl.undo.at(-1);
  dock.classList.toggle('is-big', tl.big);
  anDockEl('body').hidden = !tl.open || !v;
  const general = (key) => AN_GENERAL.find(d => d.key === key).values;
  anDockEl('bar').innerHTML = `<button type="button" class="btn btn-sm btn-primary" data-tl="toggle" aria-expanded="${tl.open}">Timeline / Codage vidéo</button>
    <span class="an-on">${anPlural(AN.clips.length - todo, 'codé')}, ${todo} à coder</span>
    ${!tl.open ? '' : !v ? '<span class="text-muted">Aucune vidéo pour ce joueur : envoyez-en une dans l’onglet Vidéos.</span>'
      : `<label class="an-sel an-sel-sm"><span>Vidéo</span><select data-tl-video>${AN.videos.map(x =>
          `<option value="${x.id}"${x.id === v.id ? ' selected' : ''}>${esc(x.titre)}</option>`).join('')}</select></label>
        ${anVideoSelect(v, 'poste', 'Poste', general('poste'))}${anVideoSelect(v, 'lieu', 'Lieu', general('lieu'))}`}
    <span class="an-grow"></span>
    ${last ? `<button type="button" class="btn btn-sm" data-tl="undo" title="⌘Z ou Ctrl+Z">↶ Annuler : ${esc(last.label)}</button>` : ''}
    ${tl.open && v ? `<span class="an-dock-keys">Espace : lecture · I / O : début, fin · Entrée : créer · ⌘ clic ou glisser : sélection</span>
      <button type="button" class="btn btn-sm" data-tl="zoom" data-value="-1" aria-label="Dézoomer la timeline"${tl.zoom === 1 ? ' disabled' : ''}>−</button>
      <button type="button" class="btn btn-sm" data-tl="zoom" data-value="1" aria-label="Zoomer la timeline"${tl.zoom === AN_TL_ZOOMS.at(-1) ? ' disabled' : ''}>+</button>
      <button type="button" class="btn btn-sm" data-tl="size">${tl.big ? 'Réduire' : 'Agrandir'}</button>` : ''}`;
  if (tl.open && v) { anTlLoad(); anTlTrack(); anTlMarks(); }
  anTlSel();
}

/* Échelle, lignes et segments ; la largeur suit le zoom (défilement horizontal natif). */
function anTlTrack() {
  const D = anTlDur(), clips = anTlClips(), pct = (t) => ((t / D) * 100).toFixed(3);
  anDockEl('names').innerHTML = `<span></span>${AN_LANES.map(([k, l]) => `<span class="an-tl-name"><i class="an-seg is-${k}"></i>${esc(l)}
    <small>${clips.filter(c => anLane(c) === k).length}</small></span>`).join('')}`;
  const lanes = AN_LANES.map(([k]) => `<div class="an-tl-lane" data-lane="${k}">${clips.filter(c => anLane(c) === k).map(c =>
    `<button type="button" class="an-seg is-${k}" data-seq="${c.id}" style="left:${pct(c.start_sec)}%;width:${pct(c.end_sec - c.start_sec)}%"
      title="${esc(anClipName(c))}" aria-label="${esc(anClipName(c))}. Double-clic : coder" aria-pressed="false"></button>`).join('')}</div>`).join('');
  const track = anDockEl('track');
  track.style.width = `${AN.tl.zoom * 100}%`;
  track.innerHTML = `<div class="an-tl-ruler">${anTicks(D, AN.tl.zoom).map(t => `<span style="left:${pct(t)}%">${fmtT(t)}</span>`).join('')}</div>${lanes}
    <div class="an-tl-mark" data-el="mark" hidden></div><div class="an-tl-head" data-el="head"></div><div class="an-tl-band" data-el="band" hidden></div>`;
  anTlHead();
}

function anTlHead() {
  const head = anDockEl('head'), t = anTlTime();
  if (head) head.style.left = `${((t ?? 0) / anTlDur()) * 100}%`;
}

/* Début et fin marqués du prochain clip : boutons sous la vidéo et plage sur la timeline. */
function anTlMarks() {
  const { in: a, out: b } = AN.tl, D = anTlDur(), ok = a != null && b != null && b - a >= 0.5, mark = anDockEl('mark');
  anDockEl('marks').innerHTML = `<button type="button" class="btn btn-sm" data-tl="in" title="Touche I">⇤ Début</button><output>${a == null ? '–' : fmtT(a)}</output>
    <button type="button" class="btn btn-sm" data-tl="out" title="Touche O">Fin ⇥</button><output>${b == null ? '–' : fmtT(b)}</output>
    <button type="button" class="btn btn-sm btn-primary" data-tl="create" title="Touche Entrée"${ok ? '' : ' disabled'}>Créer le clip</button>`;
  if (!mark) return;
  mark.hidden = a == null;
  if (a != null) Object.assign(mark.style, { left: `${(a / D) * 100}%`, width: `${((Math.max(b ?? a, a) - a) / D) * 100}%` });
}

/* Sélection : segments surlignés et barre d'actions (seulement s'il y a une sélection). */
function anTlSel() {
  const sel = AN.tl.sel, bar = anDockEl('selbar');
  document.querySelectorAll('#anDock .an-tl-lane .an-seg').forEach(s => {
    const on = sel.has(Number(s.dataset.seq));
    s.classList.toggle('is-on', on); s.setAttribute('aria-pressed', on);
  });
  bar.hidden = !sel.size;
  bar.innerHTML = !sel.size ? '' : `<strong aria-live="polite">${anPlural(sel.size, 'séquence sélectionnée', 'séquences sélectionnées')}</strong>
    <button type="button" class="btn btn-sm btn-primary" data-tl="add">Ajouter des descripteurs</button>
    <button type="button" class="btn btn-sm" data-tl="remove">Retirer des descripteurs</button>
    <button type="button" class="btn btn-sm" data-tl="edit">Modifier les caractéristiques</button>
    <button type="button" class="btn btn-sm btn-ghost" data-tl="clear">Annuler la sélection</button>`;
}

/* ---------- Opérations groupées : une transaction chacune, défaisable ---------- */

async function anTlBulk(ids, op, label) {
  try {
    const changes = await anBulk(ids, op);
    if (changes.length) AN.tl.undo.push({ label, changes });
    toast(changes.length ? `${label} : ${anPlural(changes.length, 'séquence modifiée', 'séquences modifiées')} sur ${ids.length}.`
      : `Rien à changer : ${ids.length > 1 ? 'ces séquences avaient' : 'cette séquence avait'} déjà ces valeurs.`);
    await anReload();
    return true;
  } catch (err) {   // tout ou rien : aucune séquence n'a été modifiée
    toast(err.message.replace(/\([^)]*tags_check[^)]*\)/, '(20 descripteurs au plus par clip)'), 'error');
    return false;
  }
}

async function anTlUndo() {
  const op = AN.tl.undo.pop();
  if (!op) return;
  try {
    const { restored, kept } = await anUndo(op.changes);
    toast(`Annulé (${op.label}) : ${anPlural(restored, 'séquence rétablie', 'séquences rétablies')}${kept
      ? `, ${kept} laissée${kept > 1 ? 's' : ''} telle${kept > 1 ? 's' : ''} quelle${kept > 1 ? 's' : ''} car modifiée${kept > 1 ? 's' : ''} depuis` : ''}.`);
    await anReload();
  } catch (err) {
    AN.tl.undo.push(op);
    toast(err.message, 'error');
  }
}

function anTlCreate() {
  const tl = AN.tl, v = AN.videos.find(x => x.id === tl.video);
  if (!v || tl.in == null || tl.out == null || tl.out - tl.in < 0.5) return toast('Marquez le début (I) puis la fin (O) du clip, à une demi-seconde au moins.', 'error');
  anVid().pause();
  anOpenCoding({ id: null, video_id: v.id, label: nextSeqLabel(anTlClips()), video_title: v.titre, start_sec: tl.in, end_sec: tl.out, tags: [] });
}
/* Le clip vient d'être créé : les marques repartent de zéro, il est sélectionné. */
function anTlCreated(id) { Object.assign(AN.tl, { in: null, out: null, sel: new Set([id]) }); }

function anTlMark(which) {
  const tl = AN.tl, t = anTlTime();
  if (t == null) return toast('La vidéo n’est pas chargée.', 'error');
  tl[which] = Math.round(t * 10) / 10;
  if (tl.in != null && tl.out != null && tl.out <= tl.in) tl[which === 'in' ? 'out' : 'in'] = null;   // marques croisées : on garde la dernière posée
  anTlMarks();
}

/* ---------- Gestes ---------- */

function anTlClick(e) {
  const tl = AN.tl, b = e.target.closest('[data-tl]'), seg = e.target.closest('.an-tl-lane .an-seg');
  if (seg) {   // clic : ce clip seul ; ⌘ ou Ctrl : l'ajouter ou le retirer
    const id = Number(seg.dataset.seq), clip = AN.clips.find(c => c.id === id);
    if (e.metaKey || e.ctrlKey) { if (tl.sel.has(id)) tl.sel.delete(id); else tl.sel.add(id); }
    else { tl.sel = new Set([id]); if (anTlTime() != null) anVid().currentTime = clip.start_sec; }
    return anTlSel();
  }
  if (!b || b.disabled) return;
  const act = b.dataset.tl, ids = [...tl.sel], picked = AN.clips.filter(c => tl.sel.has(c.id));
  if (act === 'toggle') tl.open = !tl.open;
  else if (act === 'size') tl.big = !tl.big;
  else if (act === 'zoom') tl.zoom = AN_TL_ZOOMS[AN_TL_ZOOMS.indexOf(tl.zoom) + Number(b.dataset.value)] ?? tl.zoom;
  else if (act === 'in' || act === 'out') return anTlMark(act);
  else if (act === 'create') return anTlCreate();
  else if (act === 'undo') return anTlUndo();
  else if (act === 'clear') { tl.sel.clear(); return anTlSel(); }
  else if (act === 'edit') return anOpenBulk(ids);
  else if (act === 'add') return anLibOpen('add', { n: ids.length,
    onApply: (names) => anTlBulk(ids, { add: names }, anPlural(names.length, 'descripteur ajouté', 'descripteurs ajoutés')) });
  else if (act === 'remove') return anLibOpen('remove', { n: ids.length, only: [...new Set(picked.flatMap(c => c.tags))],
    onApply: (names) => anTlBulk(ids, { remove: names }, anPlural(names.length, 'descripteur retiré', 'descripteurs retirés')) });
  anTlRender();
}

async function anTlChange(e) {
  const t = e.target;
  if ('tlVideo' in t.dataset) { AN.tl.video = Number(t.value); return anTlRender(); }
  if (!t.dataset.anVideo) return;
  try { await anSaveVideo(Number(t.dataset.id), { [t.dataset.anVideo]: t.value || null }); } catch (err) { toast(err.message, 'error'); }
  await anReload();   // en cas de refus, le menu reprend la valeur enregistrée
}

/* Dans le vide de la timeline : un clic déplace la lecture, un glissé trace un rectangle de sélection. */
function anTlDown(e) {
  if (!e.target.closest('button, select, input, video, a')) e.currentTarget.focus({ preventScroll: true });   // raccourcis actifs
  const track = e.target.closest('[data-el="track"]');
  if (!track || e.button || e.target.closest('.an-seg')) return;
  const tl = AN.tl, r = track.getBoundingClientRect(), band = anDockEl('band'), add = e.metaKey || e.ctrlKey, x0 = e.clientX, y0 = e.clientY;
  const tAt = (x) => Math.min(1, Math.max(0, (x - r.left) / r.width)) * anTlDur();
  const moved = (ev) => Math.abs(ev.clientX - x0) > 4 || Math.abs(ev.clientY - y0) > 4;
  const move = (ev) => {
    band.hidden = !moved(ev);
    Object.assign(band.style, { left: `${Math.min(x0, ev.clientX) - r.left}px`, top: `${Math.min(y0, ev.clientY) - r.top}px`,
      width: `${Math.abs(ev.clientX - x0)}px`, height: `${Math.abs(ev.clientY - y0)}px` });
  };
  const up = (ev) => {
    track.removeEventListener('pointermove', move);
    band.hidden = true;
    if (moved(ev)) {
      const top = Math.min(y0, ev.clientY), bottom = Math.max(y0, ev.clientY);
      const lanes = [...track.querySelectorAll('.an-tl-lane')].filter(l => { const b = l.getBoundingClientRect(); return b.bottom > top && b.top < bottom; }).map(l => l.dataset.lane);
      const ids = anInRect(anTlClips(), tAt(x0), tAt(ev.clientX), lanes);
      tl.sel = new Set(add ? [...tl.sel, ...ids] : ids);
    } else {
      if (anTlTime() != null) anVid().currentTime = tAt(x0);
      if (!add) tl.sel.clear();
    }
    anTlSel();
  };
  track.setPointerCapture(e.pointerId);
  track.addEventListener('pointermove', move);
  track.addEventListener('pointerup', up, { once: true });
}

function anTlKey(e) {
  const tl = AN.tl, vid = anVid(), mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase(), onButton = !!e.target.closest('button');
  if (!tl.open || e.altKey || e.target.closest('input, select, textarea')) return;
  if (mod && k === 'a') { tl.sel = new Set(anTlClips().map(c => c.id)); anTlSel(); }
  else if (mod && k === 'z') anTlUndo();
  else if (mod) return;
  else if (k === 'escape') { tl.sel.clear(); anTlSel(); }
  else if (k === 'i') anTlMark('in');
  else if (k === 'o') anTlMark('out');
  else if (k === 'enter' && !onButton) anTlCreate();
  else if (e.target === vid || anTlTime() == null) return;   // le lecteur gère lui-même Espace et les flèches
  else if (k === ' ' && !onButton) { if (vid.paused) vid.play(); else vid.pause(); }
  else if (k === 'arrowleft' || k === 'arrowright') vid.currentTime += (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 10 : 2);
  else return;
  e.preventDefault();
}
