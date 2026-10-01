/* ============================================================
   FootSession Pro — video-status.js
   Vocabulaire commun des vidéos, côté joueur comme côté staff :
     vidéo source → séquence (une nouvelle vidéo, portion de la source)
                  → habillage → envoi au staff.
   Statut d'une séquence (un seul badge, jamais cumulé) :
     Brouillon → Envoyé (« À voir » pour le staff) → Vu → Retour
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
  sent:     { label: 'Envoyé',    staff: 'À voir',    cls: 'is-sent',     hint: 'Envoyée, pas encore ouverte par le staff' },
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

/* ---------- Miniatures ----------
   L'image de la vidéo source à l'instant t (#t=… : le navigateur
   affiche cette image sans lire la vidéo). */
function thumbHtml(url, t, badge = '') {
  const src = url ? `${url}#t=${Math.max(.05, Number(t) || 0).toFixed(2)}` : '';
  return `<span class="vthumb">${src ? `<video muted playsinline preload="none" tabindex="-1" aria-hidden="true" data-src="${escapeHtml(src)}"></video>` : ''}${badge ? `<span class="vthumb-badge">${escapeHtml(badge)}</span>` : ''}</span>`;
}
let thumbObserver = null;
function loadThumbs(root = document) {
  const start = (v) => { v.preload = 'metadata'; v.src = v.dataset.src; v.removeAttribute('data-src'); };
  if (!thumbObserver && 'IntersectionObserver' in window) {
    thumbObserver = new IntersectionObserver((entries) => entries.forEach(en => {
      if (!en.isIntersecting) return;
      thumbObserver.unobserve(en.target);
      start(en.target);
    }), { rootMargin: '200px' });
  }
  root.querySelectorAll('.vthumb video[data-src]').forEach(v => (thumbObserver ? thumbObserver.observe(v) : start(v)));
}
