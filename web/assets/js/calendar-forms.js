/* ============================================================
   LMFC Performance — calendar-forms.js (calendrier, joueur)
   Dans la fiche d'une séance ou d'un match, ce qui reste à remplir, rangé
   comme le joueur le vit :
     - Avant (PRE) : courbatures du matin (soreness.js, lmfc_v35.sql), le
       jour même d'une séance ; questionnaires du jour (« j » + date) et
       « Avant le match » (lmfc_v65.sql) ;
     - Après (POST) : questionnaires de cette séance ou de ce match
       (« s »/« m » + id), proposés une fois le RPE noté (le RPE reste au-dessus,
       calRpe dans calendrier-page.js).
   Un questionnaire s'ouvre dans Mes formulaires (?f=version&o=occurrence).
   Dépend de app.js (escapeHtml), calendar-utils.js (calToday), soreness.js.
   ============================================================ */

/* Avant le match (lmfc_v65.sql) : même occurrence « m » qu'après, le titre les distingue. */
const cqBefore = (f) => /^Avant le match/.test(f.titre || '');
const cqLink = (f) => `<a class="btn btn-sm" href="mes-formulaires.html?f=${Number(f.version_id)}&o=${encodeURIComponent(f.occurrence || '')}">${escapeHtml(String(f.titre || 'Questionnaire').split(' · ')[0])}</a>`;

async function calQuest(i) {
  const box = document.getElementById('calQuest');
  if (!box) return;
  const today = i.kind === 'seance' && i.date === calToday();
  const [pending, sore] = await Promise.all([sb.rpc('custom_forms_my_pending'), today ? sb.rpc('my_soreness_today') : { data: [] }]);
  if (pending.error) console.warn('Questionnaires à remplir illisibles', pending.error.message);
  if (sore.error && !['PGRST202', '42883'].includes(sore.error.code)) console.warn('Courbatures du jour illisibles', sore.error.message);
  if (!document.body.contains(box)) return;   // fiche fermée ou changée pendant le chargement
  const forms = pending.data || [], own = (i.kind === 'match' ? 'm' : 's') + i.id;
  const pre = forms.filter(f => f.occurrence === `j${i.date}` || (f.occurrence === own && cqBefore(f)));
  const post = forms.filter(f => f.occurrence === own && !cqBefore(f));
  const s = (sore.data || [])[0] || null;
  const soreBtn = s ? `<button type="button" class="btn btn-sm${s.niveau == null ? ' btn-primary' : ''}" id="calSoreBtn">${s.niveau == null
    ? 'Courbatures du matin' : `Courbatures : ${Number(s.niveau)}/10, modifier`}</button>` : '';
  const part = (title, items) => `<div class="cal-quest-part"><h3 class="as-h4">${title}</h3><div class="cal-quest-btns">${items.join('')}</div></div>`;
  const parts = [(soreBtn || pre.length) && part('Avant (PRE)', [soreBtn, ...pre.map(cqLink)]), post.length && part('Après (POST)', post.map(cqLink))].filter(Boolean);
  box.classList.toggle('hidden', !parts.length);   // gardé caché : le RPE noté peut le remplir ensuite
  box.innerHTML = parts.join('');
  document.getElementById('calSoreBtn')?.addEventListener('click', () => openSorenessSheet({ today: s, onSaved: (r) => { Object.assign(s, r); calQuest(i); } }));
}
