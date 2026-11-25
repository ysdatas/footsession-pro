/* ============================================================
   LMFC Performance — rpe.js
   RPE après la séance (lmfc_v29.sql) et le match (lmfc_v38.sql), commun
   aux pages :
     - RPE_SCALE : 1 à 10, libellés de l'échelle CR-10, une couleur
       du vert (facile) au rouge (maximal) ;
     - myRpeItems : ce que le joueur peut noter, séances et matchs ;
     - openRpeSheet : la saisie ou la correction du staff à la place du
       joueur (séance, Suivi RPE), marquée ; le joueur, lui, note son
       effort dans le questionnaire après séance (todo-parts.js) ;
     - rpeExpected : la réponse est-elle attendue de ce joueur ?
     - renderRpeTrend : l'évolution d'un joueur (fiche, staff et joueur).
   Écriture par rpe_set() et match_rpe_set() seulement : la base vérifie
   la séance ou le match, le délai (jusqu'à J+2, lmfc_v70.sql), la réponse
   unique et les droits. Aucun calcul de charge, aucune alerte.
   ============================================================ */

const RPE_SCALE = [
  [1, 'Très, très facile'], [2, 'Facile'], [3, 'Modéré'], [4, 'Un peu dur'], [5, 'Dur'],
  [6, 'Dur +'], [7, 'Très dur'], [8, 'Très dur +'], [9, 'Presque maximal'], [10, 'Maximal'],
];
const RPE_DAYS = 2;   // = rpe_open() (lmfc_v70.sql) : saisie du jour de la séance à J+2
const rpeLabel = (v) => RPE_SCALE.find(([n]) => n === Number(v))?.[1] || '';
const rpeColor = (v) => `hsl(${Math.round(130 - (Number(v) - 1) * 14.4)} 62% 46%)`;
const rpeFr = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
/* Écart moyenne déclarée − RPE attendue (lmfc_v34.sql) : « +2,0 », « −1,5 », « 0,0 ». */
const rpeGapFr = (g) => `${g > 0.04 ? '+' : g < -0.04 ? '−' : ''}${rpeFr(Math.abs(g)).replace(/^(\d+)$/, '$1,0')}`;
const rpeDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');   // sans procedure-time.js
/* Séance telle que le joueur la reconnaît, même s'il y en a deux dans la journée. */
const rpeWhen = (s) => [s.date && rpeDate(s.date), s.heure?.slice(0, 5)].filter(Boolean).join(' à ');
const rpeWhat = (s) => (s.match ? 'tout le match' : 'toute la séance');
/* Textes réglés dans Formulaires (lmfc_v47.sql), portés par la séance ou le match ; sinon ceux
   d'origine. Les questions ajoutées se posent avec, dans le même questionnaire (todo-parts.js). */
const formLabel = (item, id) => item?.form_questions?.find(q => q.id === id)?.label;
/* Échelle montrée au joueur : les niveaux réglés dans Formulaires (lmfc_v63.sql : libellé, couleur,
   niveaux retirés), sinon RPE_SCALE. La valeur envoyée reste le nombre de 1 à 10. */
function rpeScaleOf(item) {
  const q = item?.form_questions?.find(x => x.id === 'rpe');
  if (!Array.isArray(q?.niveaux) || !q.niveaux.length) return RPE_SCALE.map(([v, l]) => [v, l, rpeColor(v)]);
  return q.niveaux.map(n => [Number(n.valeur), String(n.libelle || ''), /^#[0-9a-f]{6}$/i.test(n.couleur || '') ? n.couleur : rpeColor(n.valeur)])
    .filter(([v]) => Number.isInteger(v) && v >= 1 && v <= 10).sort((a, b) => a[0] - b[0]);
}
const rpeLabelOf = (item, v) => rpeScaleOf(item).find(([n]) => n === Number(v))?.[1] ?? rpeLabel(v);
/* Une séance est-elle dans le délai de saisie du joueur ? (la base tranche.) Avec son heure,
   pas avant qu'elle commence : la réponse est définitive, et le calendrier ouvre dès le matin. */
function rpeOpen(iso, heure = null) {
  const two = (n) => String(n).padStart(2, '0');
  const day = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  const now = new Date(), from = new Date();
  from.setDate(now.getDate() - RPE_DAYS);
  return iso >= day(from) && iso <= day(now)
    && (iso < day(now) || !heure || heure.slice(0, 5) <= `${two(now.getHours())}:${two(now.getMinutes())}`);
}

/* Réponse attendue : le joueur participe, ou sa présence n'est pas encore
   renseignée (row : sa ligne attendance, absente si rien n'est coché).
   Seule une absence enregistrée l'exclut. participe : procedure-time.js. */
const rpeExpected = (row) => !row || participe({ ...row, statut: row.statut || (row.present ? 'present' : 'absent') });

/* Ce qui reste à noter : sans réponse, ouvert, et pas déjà noté à une autre séance de la même
   demi-journée (ailleurs, lmfc_v71.sql : un seul RPE par demi-journée, toutes équipes). */
const rpeTodo = (rows) => rows.filter(s => s.rpe == null && !s.ailleurs && rpeOpen(s.date_seance, s.heure));

/* Séances et matchs que le joueur peut noter (noté ou non), du plus récent au plus ancien :
   { id, titre, date, date_seance, heure, rpe, corrige, match }. Sans séances lisibles : error. */
async function myRpeItems() {
  const [s, m] = await Promise.all([sb.rpc('my_rpe_sessions'), sb.rpc('my_rpe_matches')]);
  if (m.error) console.warn('RPE des matchs indisponible', m.error.message);
  const item = (r, id, match) => ({ ...r, id, date: r.date_seance, match });
  return { error: s.error, rows: [...(s.data || []).map(r => item(r, r.session_id, false)), ...(m.data || []).map(r => item(r, r.match_id, true))]
    .sort((a, b) => b.date.localeCompare(a.date) || (b.heure || '').localeCompare(a.heure || '')) };
}

/* Saisie du staff à la place du joueur. session : { id, titre, date, heure, match } ;
   player : { id, nom } ; onSaved(valeur, ou null si effacée ; séance ou match). */
function openRpeSheet({ session, value = null, player, onSaved, note = '' }) {
  if (!document.getElementById('rpeSheet')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="rpeSheet">
      <div class="modal rpe-modal" role="dialog" aria-modal="true" aria-labelledby="rpeTitle">
        <button type="button" class="modal-x" aria-label="Fermer"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        <h2 class="as-h3" id="rpeTitle"></h2>
        <p class="rpe-session" id="rpeSession"></p>
        <p class="rpe-q" id="rpeQ"></p>
        <div class="rpe-scale" role="group" aria-labelledby="rpeQ" id="rpeScale"></div>
        <p class="rpe-help" id="rpeHelp"></p>
        <p class="rpe-status" id="rpeStatus" role="status" aria-live="polite"></p>
        <div class="modal-actions hidden" id="rpeStaffActions"><button class="btn btn-danger btn-sm" type="button" id="rpeClear">Effacer ce RPE</button></div>
      </div></div>`);
    document.getElementById('rpeScale').addEventListener('click', (e) => {
      const b = e.target.closest('[data-rpe-v]');
      if (b) rpeSave(Number(b.dataset.rpeV));
    });
    document.getElementById('rpeClear').addEventListener('click', () => rpeSave(null));
  }
  const sheet = document.getElementById('rpeSheet');
  sheet.rpe = { session, player, onSaved };
  document.getElementById('rpeHelp').textContent = [note, 'Saisie du staff à la place du joueur : elle reste marquée « saisi par le staff ».'].filter(Boolean).join(' ');
  document.getElementById('rpeStaffActions').classList.toggle('hidden', !value);
  rpeRender(value);
  openModal('rpeSheet');
  document.querySelector('#rpeScale [aria-pressed="true"], #rpeScale .rpe-opt')?.focus();
}
/* La séance ou le match, puis l'échelle de référence : un clic enregistre. */
function rpeRender(value = null) {
  const { session, player } = document.getElementById('rpeSheet').rpe;
  document.getElementById('rpeTitle').textContent = `RPE de ${player.nom}`;
  document.getElementById('rpeQ').textContent = `Effort ressenti par le joueur sur ${rpeWhat(session)} :`;
  document.getElementById('rpeSession').textContent = [session.titre, session.equipe, rpeWhen(session)].filter(Boolean).join(' – ');
  document.getElementById('rpeStatus').textContent = value ? `RPE actuel : ${value} – ${rpeLabel(value)}. Touche une autre valeur pour la changer.` : '';
  document.getElementById('rpeScale').innerHTML = rpeScaleOf(null).map(([v, label, color]) => `<button type="button" class="rpe-opt" data-rpe-v="${v}"
      aria-pressed="${v === Number(value)}" style="--rpe:${color}"><b>${v}</b><span>${escapeHtml(label)}</span></button>`).join('');
}

async function rpeSave(v) {
  const sheet = document.getElementById('rpeSheet'), status = document.getElementById('rpeStatus');
  const { session, player, onSaved } = sheet.rpe;
  if (sheet.hasAttribute('data-busy')) return;   // un seul envoi à la fois
  sheet.setAttribute('data-busy', '');
  status.textContent = 'Enregistrement…';
  const { error } = await sb.rpc(session.match ? 'match_rpe_set' : 'rpe_set',
    { [session.match ? 'p_match' : 'p_session']: session.id, p_rpe: v, p_player: player.id });
  sheet.removeAttribute('data-busy');
  if (error) {
    console.error('RPE non enregistré', error);
    status.innerHTML = `<span class="text-danger">${escapeHtml(error.code === 'PGRST202' ? 'Le RPE n’est pas encore installé (lmfc_v29.sql).' : error.message)}</span>`;
    return;
  }
  document.querySelectorAll('#rpeScale .rpe-opt').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.rpeV) === v)));
  status.textContent = v == null ? 'RPE effacé.' : `Enregistré : ${v} – ${rpeLabel(v)} (saisi par le staff)`;
  onSaved?.(v, session);
  setTimeout(() => { if (sheet.rpe?.session === session) closeModal('rpeSheet'); }, 900);
}

/* Évolution d'un joueur : une colonne par séance ou match, de la plus ancienne à la plus récente. */
async function renderRpeTrend(playerId) {
  const card = document.getElementById('rpeCard'), box = document.getElementById('rpeTrend');
  if (!card || !box) return;
  const { data, error } = await sb.rpc('rpe_history', { p_player: playerId, p_limit: 20 });
  if (error) { if (error.code !== 'PGRST202') console.warn('RPE : évolution indisponible', error.message); return; }
  card.classList.remove('hidden');
  if (!data?.length) { box.innerHTML = '<p class="text-muted">Aucun RPE pour l’instant : il se renseigne après chaque séance et chaque match (Mon espace, Calendrier).</p>'; return; }
  const rows = [...data].reverse(), avg = rows.reduce((s, r) => s + r.rpe, 0) / rows.length;
  const sameDay = (r) => rows.filter(x => x.date_seance === r.date_seance).length > 1;   // l'heure les distingue
  box.innerHTML = `<p class="rpe-trend-sum">${rows.length} réponse${rows.length > 1 ? 's' : ''} | moyenne <strong>${rpeFr(avg)}</strong> | dernière <strong>${rows.at(-1).rpe}</strong> (${escapeHtml(rpeLabel(rows.at(-1).rpe))})</p>
    <div class="rpe-cols" role="list">${rows.map(r => `<div class="rpe-col" role="listitem"
        title="${escapeHtml(`${rpeWhen({ date: r.date_seance, heure: r.heure })} – ${r.titre} : ${r.rpe} (${rpeLabel(r.rpe)})${r.corrige ? ' – saisi ou corrigé par le staff' : ''}`)}">
        <span class="rpe-col-v">${r.rpe}${r.corrige ? '*' : ''}</span>
        <span class="rpe-col-bar" style="--h:${r.rpe * 11}px;--rpe:${rpeColor(r.rpe)}"></span>
        <span class="rpe-col-d">${rpeDate(r.date_seance).slice(0, 5)}${sameDay(r) && r.heure ? `<br>${r.heure.slice(0, 5)}` : ''}${r.session_id == null ? '<br>M' : ''}</span>
      </div>`).join('')}</div>
    ${rows.some(r => r.corrige || r.session_id == null) ? `<p class="rpe-note">${[rows.some(r => r.corrige) && '* saisi ou corrigé par le staff', rows.some(r => r.session_id == null) && 'M : match'].filter(Boolean).join(' | ')}</p>` : ''}`;
}
