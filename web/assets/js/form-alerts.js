/* ============================================================
   LMFC Performance — form-alerts.js (suivi-rpe, accueil)
   Alertes des questionnaires après séance et après match (lmfc_v62.sql) :
   plaisir ou vie personnelle sous 5 trois jours de suite, jambes ou vie
   personnelle (match) à 3 ou moins, douleur déclarée. La base les calcule
   (form_alerts_open) dans le périmètre du compte ; « Vu » les retire.
   Sans la migration, rien ne s'affiche.
   ============================================================ */
const FA = { rows: [] };

/* Le texte d'une alerte, selon sa règle. */
function faText(a) {
  const r = a.regle || {}, label = a.question_label || 'Question';
  if (a.mode === 'serie') return `« ${label} » sous ${r.sous ?? 5} ${r.fois ?? 3} jours de suite (dernière réponse : ${a.valeur})`;
  if (a.mode === 'seuil') return `« ${label} » : ${a.valeur} (alerte à ${r.max ?? 3} ou moins)`;
  return `Douleur ${a.valeur}/10${a.detail ? ` : ${faZone(a.detail)}` : ' (zone non précisée)'}`;
}

/* Zone de douleur : texte, ou liste en JSON si la question est à choix multiple (lmfc_v67.sql). */
function faZone(detail) {
  if (!String(detail).startsWith('[')) return detail;
  try { const list = JSON.parse(detail); return Array.isArray(list) ? list.join(', ') : detail; } catch { return detail; }
}

const faKey = (a) => `${a.player_id}|${a.form_id}|${a.question_id}|${a.jour}`;

function faHtml(rows) {
  if (!rows.length) return '';
  return `<section class="sore-alerts" aria-label="Alertes des questionnaires">${rows.map(a => `
    <div class="sore-alert"><strong>${typeof playerLink === 'function' ? playerLink(a.player_id, a.player_nom) : escapeHtml(a.player_nom)}</strong>
      <span>${escapeHtml(a.team_nom || '')} | ${rpeDate(a.jour)} | ${escapeHtml(a.form_titre)} :</span> ${escapeHtml(faText(a))}
      <button class="btn btn-sm" type="button" data-fa-seen="${escapeHtml(faKey(a))}">Vu</button></div>`).join('')}</section>`;
}

/* Charge les alertes et les écrit dans #srFormAlerts. */
async function faLoad() {
  const box = document.getElementById('srFormAlerts');
  if (!box) return;
  const { data, error } = await sb.rpc('form_alerts_open');
  if (error) {
    if (!['PGRST202', '42883'].includes(error.code)) console.warn('Alertes des questionnaires illisibles', error);
    FA.rows = [];
  } else FA.rows = data || [];
  box.innerHTML = faHtml(FA.rows);
}

async function faSeen(button) {
  const a = FA.rows.find(x => faKey(x) === button.dataset.faSeen);
  if (!a) return;
  button.disabled = true;
  const { error } = await sb.rpc('form_alert_seen', { p_player: a.player_id, p_form: a.form_id, p_question: a.question_id, p_jour: a.jour });
  if (error) { button.disabled = false; return toast(error.message, 'error'); }
  FA.rows = FA.rows.filter(x => x !== a);
  document.getElementById('srFormAlerts').innerHTML = faHtml(FA.rows);
}

document.addEventListener('click', (e) => {
  const seen = e.target.closest('[data-fa-seen]');
  if (seen) faSeen(seen);
});
