/* ============================================================
   LMFC Performance — rpe.js
   RPE après la séance (lmfc_v29.sql), commun aux pages :
     - RPE_SCALE : 1 à 10, libellés de l'échelle CR-10, une couleur
       du vert (facile) au rouge (maximal) ;
     - openRpeSheet : la saisie du joueur (accueil, calendrier) ; dix
       grosses touches, un geste, enregistré aussitôt ;
     - renderRpeTrend : l'évolution d'un joueur (fiche, staff et joueur).
   Écriture par rpe_set() seulement : la base vérifie la séance, le délai
   (jusqu'à J+2) et les droits. Aucun calcul de charge, aucune alerte.
   ============================================================ */

const RPE_SCALE = [
  [1, 'Très, très facile'], [2, 'Facile'], [3, 'Modéré'], [4, 'Un peu dur'], [5, 'Dur'],
  [6, 'Dur +'], [7, 'Très dur'], [8, 'Très dur +'], [9, 'Presque maximal'], [10, 'Maximal'],
];
const RPE_DAYS = 2;   // = rpe_open() : saisie du jour de la séance à J+2
const rpeLabel = (v) => RPE_SCALE.find(([n]) => n === Number(v))?.[1] || '';
const rpeColor = (v) => `hsl(${Math.round(130 - (Number(v) - 1) * 14.4)} 62% 46%)`;
const rpeFr = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
const rpeDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');   // sans procedure-time.js
/* La date ISO d'une séance est-elle dans le délai de saisie du joueur ? (la base tranche) */
function rpeOpen(iso) {
  const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date(), from = new Date();
  from.setDate(today.getDate() - RPE_DAYS);
  return iso >= day(from) && iso <= day(today);
}

/* Saisie du joueur. session : { id, titre, date } ; onSaved(valeur). */
function openRpeSheet({ session, value = null, onSaved }) {
  if (!document.getElementById('rpeSheet')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="rpeSheet">
      <div class="modal rpe-modal" role="dialog" aria-modal="true" aria-labelledby="rpeTitle">
        <button type="button" class="modal-x" aria-label="Fermer"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        <h2 class="as-h3" id="rpeTitle">Ton effort</h2>
        <p class="rpe-session" id="rpeSession"></p>
        <p class="rpe-q" id="rpeQ">Comment as-tu ressenti l’effort de toute la séance ?</p>
        <div class="rpe-scale" role="group" aria-labelledby="rpeQ" id="rpeScale"></div>
        <p class="rpe-help">1 = très, très facile · 10 = effort maximal. Ta réponse va au staff, jamais aux autres joueurs.</p>
        <p class="rpe-status" id="rpeStatus" role="status" aria-live="polite"></p>
      </div></div>`);
    document.getElementById('rpeScale').addEventListener('click', (e) => {
      const b = e.target.closest('[data-rpe-v]');
      if (b) rpeSave(Number(b.dataset.rpeV));
    });
  }
  const sheet = document.getElementById('rpeSheet');
  sheet.rpe = { session, onSaved };
  document.getElementById('rpeSession').textContent = [session.titre, session.date && rpeDate(session.date)].filter(Boolean).join(' · ');
  document.getElementById('rpeStatus').textContent = value ? `Ta réponse : ${value} · ${rpeLabel(value)}. Touche une autre valeur pour la changer.` : '';
  document.getElementById('rpeScale').innerHTML = RPE_SCALE.map(([v, label]) => `<button type="button" class="rpe-opt" data-rpe-v="${v}"
      aria-pressed="${v === Number(value)}" style="--rpe:${rpeColor(v)}"><b>${v}</b><span>${label}</span></button>`).join('');
  openModal('rpeSheet');
  (document.querySelector('#rpeScale [aria-pressed="true"]') || document.querySelector('#rpeScale .rpe-opt')).focus();
}

async function rpeSave(v) {
  const sheet = document.getElementById('rpeSheet'), status = document.getElementById('rpeStatus');
  const { session, onSaved } = sheet.rpe;
  sheet.setAttribute('data-busy', '');
  status.textContent = 'Enregistrement…';
  const { error } = await sb.rpc('rpe_set', { p_session: session.id, p_rpe: v });
  sheet.removeAttribute('data-busy');
  if (error) {
    console.error('RPE non enregistré', error);
    status.innerHTML = `<span class="text-danger">${escapeHtml(error.code === 'PGRST202' ? 'Le RPE n’est pas encore installé (lmfc_v29.sql).' : error.message)}</span>`;
    return;
  }
  document.querySelectorAll('#rpeScale .rpe-opt').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.rpeV) === v)));
  status.textContent = `Enregistré : ${v} · ${rpeLabel(v)}. Merci !`;
  onSaved?.(v);
  setTimeout(() => { if (sheet.rpe?.session === session) closeModal('rpeSheet'); }, 900);
}

/* Évolution d'un joueur : une colonne par séance, de la plus ancienne à la plus récente. */
async function renderRpeTrend(playerId) {
  const card = document.getElementById('rpeCard'), box = document.getElementById('rpeTrend');
  if (!card || !box) return;
  const { data, error } = await sb.rpc('rpe_history', { p_player: playerId, p_limit: 20 });
  if (error) { if (error.code !== 'PGRST202') console.warn('RPE : évolution indisponible', error.message); return; }
  card.classList.remove('hidden');
  if (!data?.length) { box.innerHTML = '<p class="text-muted">Aucun RPE pour l’instant : il se renseigne après chaque séance (Mon espace, Calendrier).</p>'; return; }
  const rows = [...data].reverse(), avg = rows.reduce((s, r) => s + r.rpe, 0) / rows.length;
  box.innerHTML = `<p class="rpe-trend-sum">${rows.length} séance${rows.length > 1 ? 's' : ''} · moyenne <strong>${rpeFr(avg)}</strong> · dernière <strong>${rows.at(-1).rpe}</strong> (${escapeHtml(rpeLabel(rows.at(-1).rpe))})</p>
    <div class="rpe-cols" role="list">${rows.map(r => `<div class="rpe-col" role="listitem"
        title="${escapeHtml(`${rpeDate(r.date_seance)} · ${r.titre} : ${r.rpe} (${rpeLabel(r.rpe)})${r.corrige ? ' · saisi ou corrigé par le staff' : ''}`)}">
        <span class="rpe-col-v">${r.rpe}${r.corrige ? '*' : ''}</span>
        <span class="rpe-col-bar" style="--h:${r.rpe * 11}px;--rpe:${rpeColor(r.rpe)}"></span>
        <span class="rpe-col-d">${rpeDate(r.date_seance).slice(0, 5)}</span>
      </div>`).join('')}</div>
    ${rows.some(r => r.corrige) ? '<p class="rpe-note">* saisi ou corrigé par le staff</p>' : ''}`;
}
