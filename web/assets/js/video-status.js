/* ============================================================
   FootSession Pro — video-status.js
   Statut d'une séquence vidéo, le même pour le joueur et le staff :
     Brouillon → Prêt → Envoyé → Vu → Retour
                          ↘ Modifié (changé depuis l'envoi : à renvoyer)
   « Vu » et « Modifié » demandent supabase/video_status.sql
   (seen_at, edited_at) ; sans elle, ces deux statuts n'apparaissent
   simplement jamais.
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
  draft:    { label: 'Brouillon', cls: 'is-draft',    hint: 'Rien d’ajouté pour l’instant' },
  ready:    { label: 'Prêt',      cls: 'is-ready',    hint: 'Prêt à envoyer au staff' },
  sent:     { label: 'Envoyé',    cls: 'is-sent',     hint: 'Envoyé, pas encore ouvert par le staff' },
  seen:     { label: 'Vu',        cls: 'is-seen',     hint: 'Ouvert par le staff' },
  modified: { label: 'Modifié',   cls: 'is-modified', hint: 'Modifié depuis l’envoi : à renvoyer' },
  answered: { label: 'Retour',    cls: 'is-answered', hint: 'Le staff a répondu' },
};
const isAfter = (a, b) => !!a && (!b || new Date(a) > new Date(b));

function seqStatus(s) {
  if (!s.submitted_at) return hasWork(s) ? 'ready' : 'draft';
  if (isAfter(s.edited_at, s.submitted_at)) return 'modified';
  if (s.feedback_at && !isAfter(s.submitted_at, s.feedback_at)) return 'answered';
  if (s.seen_at && !isAfter(s.submitted_at, s.seen_at)) return 'seen';
  return 'sent';
}
/* Envoyée et sans retour postérieur : le staff a quelque chose à voir. */
const seqToSee = (s) => !!s.submitted_at && (!s.feedback_at || isAfter(s.submitted_at, s.feedback_at));

function statusPill(s) {
  const st = SEQ_STATUS[seqStatus(s)];
  return `<span class="vw-status ${st.cls}" title="${st.hint}">${st.label}</span>`;
}
