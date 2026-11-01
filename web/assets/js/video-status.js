/* ============================================================
   LMFC Performance — video-status.js
   Vocabulaire commun des vidéos, côté joueur comme côté staff :
     vidéo source → séquence (une nouvelle vidéo, portion de la source)
                  → habillage → envoi au staff.
   Statut d'une séquence (un seul badge, jamais cumulé) :
     Brouillon → Envoyé (« À traiter » pour le staff) → Vu → Retour
                  ↘ Modifié : changée depuis l'envoi, à renvoyer.
   « Vu » et « Modifié » demandent supabase/video_status.sql.
   Contient aussi les miniatures (l'image de la source au début
   de la séquence, chargée seulement quand elle devient visible).
   ============================================================ */

const fmtT = (sec) => {
  sec = Math.max(0, Number(sec) || 0);
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
};
/* Durée lisible : « 16 s », « 1 min 05 ». */
const fmtDur = (sec) => {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  return sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, '0')}`;
};
const hasWork = (s) => (s.drawings || []).length > 0 || !!(s.player_note || '').trim();

const SEQ_STATUS = {
  draft:    { label: 'Brouillon', staff: 'Brouillon', cls: 'is-draft',    hint: 'Pas encore envoyée au staff' },
  sent:     { label: 'Envoyé',    staff: 'À traiter', cls: 'is-sent',     hint: 'Envoyée, pas encore ouverte par le staff' },
  seen:     { label: 'Vu',        staff: 'Vu',        cls: 'is-seen',     hint: 'Ouverte par le staff' },
  answered: { label: 'Retour',    staff: 'Répondu',   cls: 'is-answered', hint: 'Le staff a répondu' },
  modified: { label: 'Modifié',   staff: 'Modifié',   cls: 'is-modified', hint: 'Modifiée depuis l’envoi : à renvoyer' },
};
const isAfter = (a, b) => !!a && (!b || new Date(a) > new Date(b));

function seqStatus(s) {
  if (!s.submitted_at) return 'draft';
  if (isAfter(s.edited_at, s.submitted_at)) return 'modified';
  if (s.feedback_at && !isAfter(s.submitted_at, s.feedback_at)) return 'answered';
  if (s.seen_at && !isAfter(s.submitted_at, s.seen_at)) return 'seen';
  return 'sent';
}
/* Envoyée et sans retour postérieur : le staff a quelque chose à voir. */
const seqToSee = (s) => !!s.submitted_at && (!s.feedback_at || isAfter(s.submitted_at, s.feedback_at));

function statusPill(s, viewer = 'player') {
  const st = SEQ_STATUS[seqStatus(s)];
  return `<span class="vw-status ${st.cls}" title="${st.hint}">${viewer === 'staff' ? st.staff : st.label}</span>`;
}

/* Nom par défaut d'une nouvelle séquence : le numéro suivant, jamais un doublon. */
function nextSeqLabel(seqs) {
  const n = seqs.reduce((m, s) => Math.max(m, Number(/^Séquence (\d+)/.exec(s.label || '')?.[1] || 0)), 0);
  return `Séquence ${Math.max(n, seqs.length) + 1}`;
}

/* Joueur reconnu dans le nom d'un fichier envoyé (« Eliott-1.mp4 », « barbey_2 »,
   « Eliott Barbey but ») : prénom et nom, sinon prénom ou nom seul, s'il ne
   désigne qu'un joueur. Deux Eliott, ou aucun nom : null (à choisir). */
const vsWords = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/(\d+)/g, ' $1 ').split(/[^a-z0-9]+/).filter(Boolean);
function playerFromFile(name, players) {
  const w = vsWords(String(name).replace(/\.[^.]+$/, ''));
  const has = (s) => { const l = vsWords(s); return l.length > 0 && l.every(x => w.includes(x)); };
  const hits = players.map(p => ({ p, n: has(p.prenom) + has(p.nom) })).filter(x => x.n);
  const best = Math.max(0, ...hits.map(x => x.n)), top = hits.filter(x => x.n === best);
  return top.length === 1 ? top[0].p : null;
}

/* ---------- Miniatures ----------
   Image fixe gardée avec la vidéo ou la séquence (thumb, lmfc_v18.sql) :
   rien à télécharger. Sans elle, l'image de la vidéo source à l'instant t
   (#t=… : le navigateur lit l'index et quelques images de la source,
   plusieurs Mo par miniature d'après la mesure du lot 2). keep
   (« player_videos:12 ») : cette image-là est gardée comme miniature dès
   qu'elle arrive, une fois pour toutes (vidéos d'avant lmfc_v18, staff). */
function thumbHtml(url, t, badge = '', thumb = null, keep = null) {
  const src = url ? `${url}#t=${Math.max(.05, Number(t) || 0).toFixed(2)}` : '';
  const img = thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async">`
    : src ? `<video muted playsinline preload="none" tabindex="-1" aria-hidden="true" data-src="${escapeHtml(src)}"${keep ? ` data-keep-thumb="${escapeHtml(keep)}"` : ''}></video>` : '';
  return `<span class="vthumb">${img}${badge ? `<span class="vthumb-badge">${escapeHtml(badge)}</span>` : ''}</span>`;
}
/* Miniature de l'image affichée par une vidéo : JPEG 320 px (~15 Ko).
   null si la vidéo n'est pas prête ou vient d'un autre domaine. */
function grabThumb(video) {
  if (!video || video.readyState < 2 || !video.videoWidth) return null;
  const c = document.createElement('canvas');
  c.width = 320; c.height = Math.round(320 * video.videoHeight / video.videoWidth);
  try {
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
  } catch (e) { return null; }   // vidéo d'un autre domaine : canvas protégé
}
/* Miniature d'un fichier vidéo pas encore envoyé (1 s du début) : lue sur
   l'appareil, rien ne transite. null si le navigateur ne sait pas la lire. */
function fileThumb(file, at = 1) {
  return new Promise((resolve) => {
    const v = document.createElement('video'), url = URL.createObjectURL(file);
    let over = false;
    const done = (x) => { if (over) return; over = true; URL.revokeObjectURL(url); v.removeAttribute('src'); resolve(x); };
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.addEventListener('loadedmetadata', () => { v.currentTime = Math.min(at, (v.duration || 2) / 2); }, { once: true });
    v.addEventListener('seeked', () => done(grabThumb(v)), { once: true });
    v.addEventListener('error', () => done(null), { once: true });
    setTimeout(() => done(null), 8000);
    v.src = url;
  });
}
/* Colonnes d'une séquence pour les listes : tout sauf la miniature,
   chargée à part pour les seules séquences affichées. */
const SEQ_LIST_COLS = 'id, club_id, player_id, video_id, label, start_sec, end_sec, drawings, player_note, selected, submitted_at, staff_feedback, feedback_by, feedback_at, seen_at, edited_at, created_by, created_at, updated_at';
let thumbObserver = null;
/* Vignette d'une vidéo sans miniature (data-keep-thumb) : l'image affichée
   est enregistrée (~15 Ko), et les prochains affichages, joueur compris, ne
   relisent plus la vidéo (~3 Mo). Seulement si elle est encore vide. */
const KEEP_THUMB_TABLES = ['player_videos', 'video_sequences'];
function keepFirstFrame(v) {
  const [table, id] = (v.dataset.keepThumb || '').split(':');
  if (!KEEP_THUMB_TABLES.includes(table) || !(Number(id) > 0)) return;
  const save = () => {
    if (!v.dataset.keepThumb) return;
    const thumb = grabThumb(v);
    if (!thumb) return;
    v.removeAttribute('data-keep-thumb');
    sb.from(table).update({ thumb }).eq('id', Number(id)).is('thumb', null)
      .then(({ error }) => { if (error) console.warn('Miniature non enregistrée', error.message); });
  };
  v.addEventListener('loadeddata', save, { once: true });
  v.addEventListener('seeked', save, { once: true });
}
function loadThumbs(root = document) {
  const start = (v) => { keepFirstFrame(v); v.preload = 'metadata'; v.src = v.dataset.src; v.removeAttribute('data-src'); };
  if (!thumbObserver && 'IntersectionObserver' in window) {
    thumbObserver = new IntersectionObserver((entries) => entries.forEach(en => {
      if (!en.isIntersecting) return;
      thumbObserver.unobserve(en.target);
      start(en.target);
    }), { rootMargin: '200px' });
  }
  root.querySelectorAll('.vthumb video[data-src]').forEach(v => (thumbObserver ? thumbObserver.observe(v) : start(v)));
}
