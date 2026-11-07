/* ============================================================
   LMFC Performance — soreness.js : courbatures avant la séance (lmfc_v35.sql)
     - joueur (accueil) : openSorenessSheet, niveau au réveil 0 à 10 ;
       0 = fin du questionnaire ; 1 à 10 : les muscles courbaturés, bas du
       corps et haut du corps en deux couleurs, puis « Envoyer ». La base
       (soreness_set) décide : jour de séance, muscles connus, et l'alerte
       (même muscle 3 jours de calendrier de suite), envoyée au staff par
       le Worker (/api/push/soreness) ;
     - staff (Suivi RPE, vue « Courbatures ») : soreHtml, alertes non vues
       (« Vu » : soreness_alert_seen) puis la grille joueurs × jours.
   Dépend de app.js (escapeHtml), rpe.js (rpeColor, rpeDate), supabase-client.js (siteApi).
   ============================================================ */

/* [clé (base), libellé, sigle, zone] */
const SORE_MUSCLES = [
  ['ischios', 'Ischio-jambiers', 'IJ', 'bas'], ['quadriceps', 'Quadriceps', 'Qua', 'bas'], ['adducteurs', 'Adducteurs', 'Add', 'bas'],
  ['abducteurs', 'Abducteurs', 'Abd', 'bas'], ['mollets', 'Mollets', 'Mol', 'bas'],
  ['pectoraux', 'Pectoraux', 'Pec', 'haut'], ['dorsaux', 'Dorsaux', 'Dor', 'haut'], ['abdominaux', 'Abdominaux', 'Abdo', 'haut'],
  ['biceps', 'Biceps', 'Bi', 'haut'], ['triceps', 'Triceps', 'Tri', 'haut'],
];
const SORE_ZONES = [['bas', 'Bas du corps'], ['haut', 'Haut du corps']];
const soreMuscle = (k) => SORE_MUSCLES.find(m => m[0] === k);
const soreColor = (n) => (n ? rpeColor(n) : 'var(--success)');   // 0 : rien, en vert
/* Muscles en pastilles de la couleur de leur zone ; short : sigles (grille). */
const soreChips = (keys, short = false) => (keys || []).map(soreMuscle).filter(Boolean)
  .map(([, label, sigle, zone]) => `<span class="sore-chip is-${zone}" title="${label}">${short ? sigle : label}</span>`).join('');

/* ---------- Joueur : le questionnaire ---------- */
function openSorenessSheet({ today, onSaved }) {
  if (!document.getElementById('soreSheet')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="soreSheet">
      <div class="modal rpe-modal" role="dialog" aria-modal="true" aria-labelledby="soreTitle">
        <button type="button" class="modal-x" data-close="soreSheet" aria-label="Fermer"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        <h2 class="as-h3" id="soreTitle"></h2>
        <p class="rpe-session" id="soreSession"></p>
        <p class="rpe-q" id="soreQ"></p>
        <div class="sore-scale" role="group" aria-labelledby="soreQ" id="soreScale"></div>
        <div class="sore-muscles hidden" id="soreMuscles" role="group" aria-label="Muscles courbaturés"></div>
        <p class="rpe-status" id="soreStatus" role="status" aria-live="polite"></p>
        <div class="modal-actions hidden" id="soreActions"><button class="btn btn-primary" type="button" id="soreSend">Envoyer</button></div>
      </div></div>`);
    const sheet = document.getElementById('soreSheet');
    sheet.addEventListener('click', (e) => {
      const lvl = e.target.closest('[data-sore-v]'), mus = e.target.closest('[data-sore-m]');
      if (lvl) soreLevel(Number(lvl.dataset.soreV));
      if (mus) { const k = mus.dataset.soreM, st = sheet.sore; st.muscles = st.muscles.includes(k) ? st.muscles.filter(x => x !== k) : [...st.muscles, k]; soreDraw(); }
      if (e.target.id === 'soreSend') soreSave();
    });
  }
  const sheet = document.getElementById('soreSheet');
  sheet.sore = { niveau: today.niveau ?? null, muscles: [...(today.muscles || [])], today, onSaved };
  document.getElementById('soreTitle').textContent = today.form_titre || 'Courbatures au réveil';
  document.getElementById('soreQ').textContent = formLabel(today, 'niveau') || 'Ton niveau de courbature au réveil (0 = aucune, 10 = très fortes) :';
  document.getElementById('soreSession').textContent = [today.titre, 'aujourd’hui'].filter(Boolean).join(' · ');
  document.getElementById('soreStatus').textContent = today.niveau != null ? 'Ta réponse d’aujourd’hui : change-la si besoin.' : '';
  soreDraw();
  openModal('soreSheet');
}
function soreDraw() {
  const { niveau, muscles, today } = document.getElementById('soreSheet').sore;
  document.getElementById('soreScale').innerHTML = Array.from({ length: 11 }, (_, v) => `<button type="button" class="sore-opt" data-sore-v="${v}"
    aria-pressed="${v === niveau}" style="--rpe:${soreColor(v)}">${v}</button>`).join('');
  const box = document.getElementById('soreMuscles');
  box.classList.toggle('hidden', !niveau);
  box.innerHTML = niveau ? `<p class="rpe-q">${escapeHtml(formLabel(today, 'muscles') || 'Quels muscles sont courbaturés ?')}</p>${SORE_ZONES.map(([zone, title]) => `
    <div class="sore-zone is-${zone}"><span class="sore-zone-t">${title}</span><div class="sore-zone-list">
      ${SORE_MUSCLES.filter(m => m[3] === zone).map(([k, label]) => `<button type="button" class="sore-m is-${zone}" data-sore-m="${k}" aria-pressed="${muscles.includes(k)}">${label}</button>`).join('')}
    </div></div>`).join('')}` : '';
  document.getElementById('soreActions').classList.toggle('hidden', !niveau);
  document.getElementById('soreSend').disabled = !muscles.length;
}
/* 0 : fin du questionnaire, envoyé tout de suite. 1 à 10 : choisir les muscles. */
function soreLevel(v) {
  const st = document.getElementById('soreSheet').sore;
  st.niveau = v;
  if (v === 0) { st.muscles = []; soreDraw(); return soreSave(); }
  soreDraw();
}
async function soreSave() {
  const sheet = document.getElementById('soreSheet'), st = sheet.sore, status = document.getElementById('soreStatus');
  if (sheet.hasAttribute('data-busy')) return;
  sheet.setAttribute('data-busy', '');
  status.textContent = 'Envoi…';
  const { data, error } = await sb.rpc('soreness_set', { p_niveau: st.niveau, p_muscles: st.niveau ? st.muscles : [] });
  sheet.removeAttribute('data-busy');
  if (error) {
    console.error('Courbatures non enregistrées', error);
    status.innerHTML = `<span class="text-danger">${escapeHtml(error.code === 'PGRST202' ? 'Le questionnaire n’est pas encore installé (lmfc_v35.sql).' : error.message)}</span>`;
    return;
  }
  // 3 jours de suite : la base a créé l'alerte ; le Worker prévient le staff (sans attendre).
  if (data.alerte) siteApi('push/soreness', { method: 'POST' }, 'Notifications').catch(e => console.warn('Alerte courbatures non envoyée sur les téléphones', e));
  status.textContent = 'Envoyé, merci !';
  st.onSaved?.({ niveau: data.niveau, muscles: data.muscles });
  if (formHasMore(st.today)) { status.innerHTML = `Envoyé, merci ! ${FORM_MORE}`; return; }
  setTimeout(() => closeModal('soreSheet'), 800);
}

/* ---------- Staff : vue « Courbatures » du Suivi RPE ----------
   players : [{ id, nom, prenom }] ; days : ['2026-10-26', …] ; rows : player_soreness ; alerts : non vues. */
function soreHtml({ players, days, rows, alerts }) {
  const name = (id) => playerFullName(players.find(p => p.id === id) || {});
  const cell = new Map(rows.map(r => [`${r.player_id}:${r.jour}`, r]));
  const alertsHtml = alerts.length ? `<section class="sore-alerts" aria-label="Alertes courbatures">${alerts.map(a => `
      <div class="sore-alert"><strong>${escapeHtml(name(a.player_id))}</strong>
        <span>3 jours de suite, jusqu’au ${rpeDate(a.jour)} :</span>${soreChips(a.muscles)}
        <button class="btn btn-sm" type="button" data-sore-seen="${a.id}">Vu</button></div>`).join('')}</section>`
    : '<p class="sore-ok">Aucune alerte : aucun joueur courbaturé au même endroit 3 jours de suite.</p>';
  const shown = players.filter(p => days.some(d => cell.has(`${p.id}:${d}`)));
  if (!shown.length) return `${alertsHtml}<div class="empty">Aucune réponse au questionnaire sur ces jours.</div>`;
  return `${alertsHtml}
    <div class="sr-table-wrap"><table class="table sr-table sore-table"><thead><tr><th scope="col">Joueur</th>
      ${days.map(d => `<th scope="col">${rpeDate(d).slice(0, 5)}</th>`).join('')}</tr></thead>
      <tbody>${shown.map(p => `<tr><th scope="row">${escapeHtml(name(p.id))}</th>${days.map(d => {
        const r = cell.get(`${p.id}:${d}`);
        return r ? `<td><span class="sore-n" style="--rpe:${soreColor(r.niveau)}">${r.niveau}</span>${soreChips(r.muscles, true)}</td>` : '<td class="sore-none">—</td>';
      }).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="sore-foot">Niveau au réveil (0 à 10) et muscles : <span class="sore-chip is-bas">bas du corps</span> <span class="sore-chip is-haut">haut du corps</span>. Case vide : pas de réponse ce jour-là.</p>`;
}
