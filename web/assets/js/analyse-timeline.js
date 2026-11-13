/* ============================================================
   LMFC Performance — analyse-timeline.js
   Panneau « Timeline / Codage vidéo », collé en bas de l'onglet Analyse
   (admin, coach, analyste) : lecteur, pistes et dessin. Les gestes et les
   opérations sont dans analyse-timeline-edit.js.
   Deux vues (AN.tl.mode) :
     all    « Tous les clips » : tous les clips du joueur, toutes vidéos
            confondues, bout à bout comme une séquence de montage (anMontage).
            La lecture enchaîne d'un clip au suivant, d'une vidéo à l'autre ;
     video  « Une vidéo » : les clips à leur minutage dans la vidéo source.
            C'est ici qu'on en crée un : début (I), fin (O), Entrée.
   Une piste par action, un segment par clip. Chaque segment porte une poignée
   à chaque bout : la tirer rogne le clip ; le glisser vers une autre piste
   change son action (analyse-timeline-move.js).
   Espace de travail : le lecteur à gauche, à droite le panneau de codage et la
   bibliothèque de tags (jamais par-dessus la vidéo), les pistes en dessous.
   Lecteur (AN.tl.size) : pistes seules, normal (le coin bas-droit se tire pour
   l'élargir), agrandi (pistes resserrées) ; plein écran : tout l'écran.
   Les temps sont ceux de la VIDÉO ; la minute du match est un champ du clip.
     anTlMount()   anTlRender()   anTlTime(videoId)   anTlGo(clip, dans, lire)
   ============================================================ */

const AN_TL_ZOOMS = [1, 2, 4, 8, 16, 32];
const anDockEl = (k) => document.querySelector(`#anDock [data-el="${k}"]`);
const anVid = () => document.getElementById('anVideo');
const anPlural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/* Clips placés sur la timeline de la vue ouverte : [{ c, at, dur }], en secondes de la timeline. */
function anTlPlaced() {
  return AN.tl.mode === 'all' ? anMontage(AN.clips, AN.videos).map(m => ({ c: m.clip, at: m.at, dur: m.dur }))
    : AN.clips.filter(c => c.video_id === AN.tl.video).map(c => ({ c, at: c.start_sec, dur: c.end_sec - c.start_sec }));
}
/* Longueur de la timeline : le montage entier, ou la vidéo (tant qu'elle n'est pas lue : la fin du dernier clip). */
function anTlDur() {
  const end = Math.max(0, ...anTlPlaced().map(m => m.at + m.dur));
  return AN.tl.mode === 'all' ? Math.max(end, 1) : AN.tl.dur || Math.max(60, end);
}
/* Position de lecture dans la vidéo chargée, ou null si ce n'est pas videoId qui est chargée. */
function anTlTime(videoId = AN.tl.loaded) { const v = anVid(); return AN.tl.open && v?.readyState && AN.tl.loaded === videoId ? v.currentTime : null; }

function anTlMount() {
  if (document.getElementById('anDock')) return;
  AN.root.insertAdjacentHTML('afterend', `<section id="anDock" class="an-dock" tabindex="-1" aria-label="Timeline de codage vidéo">
    <div class="an-dock-bar" data-el="bar"></div>
    <div class="an-dock-sel" data-el="selbar" hidden></div>
    <div class="an-dock-body" data-el="body" hidden>
      <div class="an-dock-video"><video id="anVideo" controls playsinline preload="metadata"></video><div class="an-dock-marks" data-el="marks"></div></div>
      <aside class="an-dock-side" data-el="side" aria-label="Codage et tags"></aside>
      <div class="an-tl"><div class="an-tl-names" data-el="names"></div>
        <div class="an-tl-scroll"><div class="an-tl-track" data-el="track"></div></div></div>
      <p class="an-dock-keys" data-el="keys"></p>
    </div></section>`);
  const dock = document.getElementById('anDock'), vid = anVid();
  dock.addEventListener('click', anTlClick);
  dock.addEventListener('change', anTlChange);
  // Raccourcis : la timeline est « au premier plan » quand le dernier clic (ou le dernier focus) de la page était
  // chez elle. Ce qui se passe dans une fenêtre (codage, tags, lecteur) ne change rien : en la fermant, on y revient.
  const front = (e) => {
    if (e.target === document.body || e.target.closest?.('.modal-backdrop')) return;
    AN.tl.front = dock.contains(e.target);
    dock.classList.toggle('is-front', AN.tl.front);
  };
  document.addEventListener('pointerdown', front, true);
  document.addEventListener('focusin', front);
  document.addEventListener('keydown', anTlKey);
  dock.addEventListener('pointerdown', anTlDown);
  vid.addEventListener('loadedmetadata', () => { AN.tl.dur = vid.duration || 0; if (!AN.tl.trim) anTlRender(); });
  vid.addEventListener('timeupdate', anTlTick);
  anLibMount(anDockEl('side'));
}

/* Un panneau de droite s'ouvre (codage, tags) : la timeline aussi, lecteur visible. */
function anTlReveal() {
  const tl = AN.tl;
  if (tl.open && tl.size !== 'reduit') return;
  Object.assign(tl, { open: true, size: tl.size === 'reduit' ? 'normal' : tl.size });
  anTlRender();
}

/* ---------- Lecteur ---------- */

/* Liens de lecture signés de toutes les vidéos du joueur, en un appel (comme l'onglet Vidéos). */
async function anTlUrls() {
  const miss = AN.videos.filter(v => !AN.tl.urls.has(v.id));
  if (!miss.length) return;
  const got = await videoUrls(miss.map(v => v.storage_path));
  for (const v of miss) if (got.get(v.storage_path)) AN.tl.urls.set(v.id, got.get(v.storage_path));
}
const anVidReady = (vid) => new Promise((ok, ko) => {
  const done = (fn, arg) => { vid.removeEventListener('loadedmetadata', onOk); vid.removeEventListener('error', onKo); fn(arg); };
  const onOk = () => done(ok), onKo = () => done(ko, new Error('fichier illisible ou lien expiré'));
  vid.addEventListener('loadedmetadata', onOk); vid.addEventListener('error', onKo);
});

/* Met une vidéo dans le lecteur et l'amène au temps t (secondes de CETTE vidéo ; null : sans la déplacer).
   Sans lien de lecture, la timeline reste utilisable : sélection, descripteurs, tags. */
async function anTlShow(videoId, t = null, play = false) {
  const tl = AN.tl, vid = anVid();
  if (tl.loaded !== videoId) {
    Object.assign(tl, { loaded: videoId, dur: 0 });
    try {
      await anTlUrls();
      if (tl.loaded !== videoId) return;   // une autre vidéo a été demandée entre-temps
      if (!tl.urls.get(videoId)) throw new Error('vidéo introuvable dans le stockage');
      vid.src = tl.urls.get(videoId);
      await anVidReady(vid);
    } catch (err) {
      console.error('Analyse : lecture impossible', err);
      if (tl.loaded === videoId) { tl.loaded = null; tl.urls.delete(videoId); }   // lien expiré : redemandé au prochain essai
      return toast(`Lecture impossible : ${err.message}. La timeline reste utilisable.`, 'error');
    }
    if (tl.loaded !== videoId) return;
  }
  if (t != null) vid.currentTime = t;
  if (play) vid.play().catch(() => {});
  anTlHead();
}

/* Amène la lecture sur un clip, « into » secondes après son début. */
function anTlGo(clip, into = 0, play = false) {
  AN.tl.cur = clip.id;
  anTlMarks();
  return anTlShow(clip.video_id, clip.start_sec + into, play);
}

/* Pendant la lecture, vue « Tous les clips » : la fin d'un clip enchaîne sur le suivant.
   ponytail: timeupdate bat environ 4 fois par seconde, la coupe peut déborder d'un quart de seconde ;
   requestVideoFrameCallback si une coupe à l'image près devient nécessaire. */
function anTlTick() {
  const tl = AN.tl, vid = anVid();
  if (tl.mode === 'all' && !vid.paused && !tl.trim) {
    const items = anTlPlaced(), i = items.findIndex(m => m.c.id === tl.cur), m = items[i];
    if (m && tl.loaded === m.c.video_id && vid.currentTime >= m.c.end_sec - 0.05) {
      if (items[i + 1]) anTlGo(items[i + 1].c, 0, true); else vid.pause();
    }
  }
  anTlHead();
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
  if (tl.mode === 'all' && !AN.clips.length) tl.mode = 'video';   // rien à mettre bout à bout : on part d'une vidéo
  tl.sel = new Set([...tl.sel].filter(id => AN.clips.some(c => c.id === id)));   // un clip supprimé quitte la sélection
  const v = AN.videos.find(x => x.id === tl.video), todo = AN.clips.filter(c => !c.coded).length, last = tl.undo.at(-1), on = tl.open && !!v;
  dock.classList.toggle('is-reduit', tl.size === 'reduit');
  dock.classList.toggle('is-agrandi', tl.size === 'agrandi');
  dock.classList.toggle('is-full', on && tl.full);
  anDockEl('body').hidden = !on;
  const general = (key) => AN_GENERAL.find(d => d.key === key).values;
  const size = (k, l) => `<button type="button" class="an-chip${tl.size === k ? ' is-on' : ''}" data-tl="size" data-value="${k}" aria-pressed="${tl.size === k}">${l}</button>`;
  const mode = (k, l) => `<button type="button" class="an-chip${tl.mode === k ? ' is-on' : ''}" data-tl="mode" data-value="${k}" aria-pressed="${tl.mode === k}">${l}</button>`;
  anDockEl('bar').innerHTML = `<button type="button" class="btn btn-sm btn-primary" data-tl="toggle" aria-expanded="${tl.open}">Timeline / Codage vidéo</button>
    <span class="an-on">${anPlural(AN.clips.length - todo, 'codé')}, ${todo} à coder</span>
    ${!tl.open ? '' : !v ? '<span class="text-muted">Aucune vidéo pour ce joueur : envoyez-en une dans l’onglet Vidéos.</span>'
      : `<span class="an-tl-modes" role="group" aria-label="Vue de la timeline">${mode('all', 'Tous les clips')}${mode('video', 'Une vidéo')}</span>
        ${tl.mode === 'all' ? '' : `<label class="an-sel an-sel-sm"><span>Vidéo</span><select data-tl-video>${AN.videos.map(x =>
            `<option value="${x.id}"${x.id === v.id ? ' selected' : ''}>${esc(x.titre)}</option>`).join('')}</select></label>
          ${anVideoSelect(v, 'poste', 'Poste', general('poste'))}${anVideoSelect(v, 'lieu', 'Lieu', general('lieu'))}`}`}
    <span class="an-grow"></span>
    ${last ? `<button type="button" class="btn btn-sm" data-tl="undo" title="⌘Z ou Ctrl+Z">↶ Annuler : ${esc(last.label)}</button>` : ''}
    ${!on ? '' : `<button type="button" class="btn btn-sm" data-tl="zoom" data-value="-1" aria-label="Dézoomer la timeline"${tl.zoom === 1 ? ' disabled' : ''}>−</button>
      <button type="button" class="btn btn-sm" data-tl="zoom" data-value="1" aria-label="Zoomer la timeline"${tl.zoom === AN_TL_ZOOMS.at(-1) ? ' disabled' : ''}>+</button>
      ${tl.full ? '' : `<span class="an-tl-modes" role="group" aria-label="Taille du lecteur">${size('reduit', 'Pistes seules')}${size('normal', 'Lecteur')}${size('agrandi', 'Lecteur agrandi')}</span>`}
      <button type="button" class="btn btn-sm" data-tl="full" aria-pressed="${tl.full}">${tl.full ? 'Quitter le plein écran' : 'Plein écran'}</button>`}`;
  if (on) {
    const items = anTlPlaced();
    if (tl.mode === 'all' && !items.some(m => m.c.id === tl.cur)) tl.cur = items[0]?.c.id ?? null;
    const cur = AN.clips.find(c => c.id === tl.cur);
    // Le lecteur suit la vue : la vidéo choisie, ou celle du clip en cours du montage.
    if (tl.mode === 'video') { if (tl.loaded !== tl.video) anTlShow(tl.video); } else if (cur && tl.loaded !== cur.video_id) anTlGo(cur);
    anTlTrack(items);
    anTlMarks();
    anDockEl('keys').textContent = `Espace : lecture · ← → : 2 s · clic : lire et coder · ⌘ clic ou glisser dans le vide : sélection · tirer un bord : rogner · glisser vers une autre piste : changer d’action · ⌥ glisser : copier · ⌘Z : annuler${
      tl.mode === 'video' ? ' · I / O : début, fin · Entrée : créer le clip' : ''}`;
  } else anVid()?.pause();
  anTlSel();
}

/* Échelle, pistes et segments ; la largeur suit le zoom (défilement horizontal natif). */
function anTlTrack(items) {
  const D = anTlDur(), all = AN.tl.mode === 'all', pct = (t) => ((t / D) * 100).toFixed(3), laneOf = anLane;
  const byLane = Object.fromEntries(AN_LANES.map(([k]) => [k, items.filter(m => laneOf(m.c) === k).sort((a, b) => a.at - b.at)]));
  // Deux clips au même moment sur une piste (une copie, par exemple) : chacun sa moitié de hauteur, aucun ne cache l'autre.
  for (const list of Object.values(byLane)) list.forEach((m, i) => { const p = list.slice(0, i).find(x => x.at + x.dur > m.at); if (p) { p.hi = true; m.lo = true; } });
  anDockEl('names').innerHTML = `<span></span>${AN_LANES.map(([k, l]) => `<span class="an-tl-name"><i class="an-tl-sw is-${k}"></i>${esc(l)}
    <small>${byLane[k].length}</small></span>`).join('')}`;
  const seg = ({ c, at, dur, hi, lo }) => `<button type="button" class="an-seg is-${laneOf(c)}${hi ? ' is-hi' : ''}${lo ? ' is-lo' : ''}"
      data-seq="${c.id}" style="left:${pct(at)}%;width:${pct(dur)}%"
      title="${esc(anClipName(c))}" aria-label="${esc(anClipName(c))}" aria-pressed="false">
      <i class="an-seg-h is-start" data-trim="start" title="Tirer : changer le début"></i><span class="an-seg-t">${esc(all ? c.video_title : c.label || 'Séquence')}</span><i class="an-seg-h is-end" data-trim="end" title="Tirer : changer la fin"></i></button>`;
  const track = anDockEl('track');
  track.style.width = `${AN.tl.zoom * 100}%`;
  track.innerHTML = `<div class="an-tl-ruler">${anTicks(D, AN.tl.zoom).map(t => `<span style="left:${pct(t)}%">${fmtT(t)}</span>`).join('')}</div>
    ${AN_LANES.map(([k]) => `<div class="an-tl-lane" data-lane="${k}">${byLane[k].map(seg).join('')}</div>`).join('')}
    <div class="an-tl-mark" data-el="mark" hidden></div><div class="an-tl-head" data-el="head"></div><div class="an-tl-band" data-el="band" hidden></div>`;
  anTlHead();
}

/* Tête de lecture : le temps de la vidéo, ou la position du clip en cours dans le montage. */
function anTlHead() {
  const head = anDockEl('head'), tl = AN.tl;
  if (!head) return;
  let at = anTlTime() ?? 0;
  if (tl.mode === 'all') {
    const m = anTlPlaced().find(x => x.c.id === tl.cur);
    at = m ? m.at + Math.min(m.dur, Math.max(0, (anTlTime(m.c.video_id) ?? m.c.start_sec) - m.c.start_sec)) : 0;
  }
  head.style.left = `${(at / anTlDur()) * 100}%`;
}

/* Sous le lecteur. « Une vidéo » : début et fin marqués du prochain clip (aussi en plage sur la timeline).
   « Tous les clips » : le clip en cours, et de quoi passer au précédent ou au suivant. */
function anTlMarks() {
  const tl = AN.tl, box = anDockEl('marks'), mark = anDockEl('mark'), scroll = document.querySelector('#anDock .an-tl-scroll');
  if (!box) return;
  // Le clip dans le lecteur est repéré sur sa piste, et ramené à l'écran si le zoom l'en avait sorti.
  document.querySelectorAll('#anDock .an-tl-lane .an-seg').forEach(s => {
    const on = Number(s.dataset.seq) === tl.cur;
    s.classList.toggle('is-cur', on);
    if (on && !tl.trim && (s.offsetLeft < scroll.scrollLeft || s.offsetLeft + s.offsetWidth > scroll.scrollLeft + scroll.clientWidth)) scroll.scrollLeft = Math.max(0, s.offsetLeft - 40);
  });
  if (tl.mode === 'all') {
    const items = anTlPlaced(), i = items.findIndex(m => m.c.id === tl.cur);
    box.innerHTML = `<button type="button" class="btn btn-sm" data-tl="step" data-value="-1" aria-label="Clip précédent"${i > 0 ? '' : ' disabled'}>‹</button>
      <output>${i < 0 ? '–' : `${i + 1} / ${items.length}`}</output>
      <button type="button" class="btn btn-sm" data-tl="step" data-value="1" aria-label="Clip suivant"${i >= 0 && i < items.length - 1 ? '' : ' disabled'}>›</button>
      <span class="an-dock-cur">${i < 0 ? '' : esc(anClipName(items[i].c))}</span>`;
    if (mark) mark.hidden = true;
    return;
  }
  const { in: a, out: b } = tl, D = anTlDur(), ok = a != null && b != null && b - a >= 0.5;
  box.innerHTML = `<button type="button" class="btn btn-sm" data-tl="in" title="Touche I">⇤ Début</button><output>${a == null ? '–' : fmtT(a)}</output>
    <button type="button" class="btn btn-sm" data-tl="out" title="Touche O">Fin ⇥</button><output>${b == null ? '–' : fmtT(b)}</output>
    <button type="button" class="btn btn-sm btn-primary" data-tl="create" title="Touche Entrée"${ok ? '' : ' disabled'}>Créer le clip</button>`;
  if (!mark) return;
  mark.hidden = a == null;
  if (a != null) Object.assign(mark.style, { left: `${(a / D) * 100}%`, width: `${((Math.max(b ?? a, a) - a) / D) * 100}%` });
}
