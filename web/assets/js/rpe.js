/* ============================================================
   LMFC Performance — rpe.js
   RPE après la séance (lmfc_v29.sql) et le match (lmfc_v38.sql), commun
   aux pages :
     - RPE_SCALE : 1 à 10, libellés de l'échelle CR-10, une couleur
       du vert (facile) au rouge (maximal) ;
     - myRpeItems : ce que le joueur peut noter, séances et matchs ;
     - openRpeSheet : la saisie du joueur (accueil, calendrier) ; dix
       grosses touches, une confirmation : sa réponse est définitive ;
       pending : ce qu'il lui reste à noter, à choisir, l'un après
       l'autre ; avec player, la saisie ou la correction du staff
       (séance, Suivi RPE), marquée ;
     - rpeExpected : la réponse est-elle attendue de ce joueur ?
     - renderRpeTrend : l'évolution d'un joueur (fiche, staff et joueur).
   Écriture par rpe_set() et match_rpe_set() seulement : la base vérifie
   la séance ou le match, le délai (jusqu'à J+14, lmfc_v37.sql), la réponse
   unique et les droits. Aucun calcul de charge, aucune alerte.
   ============================================================ */

const RPE_SCALE = [
  [1, 'Très, très facile'], [2, 'Facile'], [3, 'Modéré'], [4, 'Un peu dur'], [5, 'Dur'],
  [6, 'Dur +'], [7, 'Très dur'], [8, 'Très dur +'], [9, 'Presque maximal'], [10, 'Maximal'],
];
const RPE_DAYS = 14;   // = rpe_open() : saisie du jour de la séance à J+14
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
   d'origine. Les questions ajoutées se posent dans « Mes formulaires », après la réponse. */
const formLabel = (item, id) => item?.form_questions?.find(q => q.id === id)?.label;
const formHasMore = (item) => (item?.form_questions || []).some(q => !q.fixe);
const FORM_MORE = '<a class="btn btn-sm" href="mes-formulaires.html">Répondre aux questions suivantes</a>';
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

/* Séances et matchs que le joueur peut noter (noté ou non), du plus récent au plus ancien :
   { id, titre, date, date_seance, heure, rpe, corrige, match }. Sans séances lisibles : error. */
async function myRpeItems() {
  const [s, m] = await Promise.all([sb.rpc('my_rpe_sessions'), sb.rpc('my_rpe_matches')]);
  if (m.error) console.warn('RPE des matchs indisponible', m.error.message);
  const item = (r, id, match) => ({ ...r, id, date: r.date_seance, match });
  return { error: s.error, rows: [...(s.data || []).map(r => item(r, r.session_id, false)), ...(m.data || []).map(r => item(r, r.match_id, true))]
    .sort((a, b) => b.date.localeCompare(a.date) || (b.heure || '').localeCompare(a.heure || '')) };
}

/* Saisie. session : { id, titre, date, heure, match } ; onSaved(valeur, ou null si effacée ; séance ou match).
   player : { id, nom } pour la saisie du staff à la place du joueur.
   pending (joueur) : ce qu'il lui reste à noter, session comprise (le même objet). */
function openRpeSheet({ session, value = null, player = null, onSaved, pending = [] }) {
  if (!document.getElementById('rpeSheet')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="rpeSheet">
      <div class="modal rpe-modal" role="dialog" aria-modal="true" aria-labelledby="rpeTitle">
        <button type="button" class="modal-x" aria-label="Fermer"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        <h2 class="as-h3" id="rpeTitle"></h2>
        <p class="rpe-session" id="rpeSession"></p>
        <div class="field hidden" id="rpePickBox"><label for="rpePick">À noter</label><select id="rpePick"></select></div>
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
    document.getElementById('rpePick').addEventListener('change', (e) => {
      const r = document.getElementById('rpeSheet').rpe;
      r.session = r.pending[Number(e.target.value)];   // par position : une séance et un match peuvent avoir le même numéro
      rpeRender();
    });
  }
  const sheet = document.getElementById('rpeSheet');
  sheet.rpe = { session, player, onSaved, pending };
  document.getElementById('rpeHelp').textContent = player
    ? 'Saisie du staff à la place du joueur : elle reste marquée « saisi par le staff ».'
    : '1 = très, très facile · 10 = effort maximal. Ta réponse va au staff, jamais aux autres joueurs. Une fois enregistrée, elle ne se modifie plus.';
  document.getElementById('rpeStaffActions').classList.toggle('hidden', !(player && value));
  rpeRender(value);
  openModal('rpeSheet');
  (document.querySelector('#rpeScale [aria-pressed="true"]') || document.querySelector('#rpeScale .rpe-opt')).focus();
}
/* La séance ou le match affiché : date et heure, la liste s'il en reste plusieurs à noter, l'échelle. */
function rpeRender(value = null) {
  const { session, pending, player } = document.getElementById('rpeSheet').rpe;
  document.getElementById('rpeTitle').textContent = player ? `RPE de ${player.nom}` : session.form_titre || 'Ton effort';
  document.getElementById('rpeQ').textContent = player ? `Effort ressenti par le joueur sur ${rpeWhat(session)} :`
    : formLabel(session, 'rpe') || `Comment as-tu ressenti l’effort de ${rpeWhat(session)} ?`;
  document.getElementById('rpeSession').textContent = [session.titre, rpeWhen(session)].filter(Boolean).join(' · ');
  document.getElementById('rpePickBox').classList.toggle('hidden', pending.length < 2);
  document.getElementById('rpePick').innerHTML = pending.map((s, i) => `<option value="${i}"${s === session ? ' selected' : ''}>${escapeHtml(`${rpeWhen(s)} · ${s.titre}`)}</option>`).join('');
  document.getElementById('rpeStatus').textContent = value ? `RPE actuel : ${value} · ${rpeLabel(value)}. Touche une autre valeur pour la changer.` : '';
  document.getElementById('rpeScale').innerHTML = RPE_SCALE.map(([v, label]) => `<button type="button" class="rpe-opt" data-rpe-v="${v}"
      aria-pressed="${v === Number(value)}" style="--rpe:${rpeColor(v)}"><b>${v}</b><span>${label}</span></button>`).join('');
}

async function rpeSave(v) {
  const sheet = document.getElementById('rpeSheet'), status = document.getElementById('rpeStatus');
  const { session, player, onSaved, pending } = sheet.rpe;
  if (sheet.hasAttribute('data-busy')) return;   // un seul envoi à la fois
  // Le joueur ne revient pas sur sa réponse : une touche de travers ne doit pas rester.
  if (!player && !confirm(`${v}/10 (${rpeLabel(v)}) pour ${[session.titre, rpeWhen(session)].filter(Boolean).join(', ')} ?\n\nUne fois enregistrée, ta réponse ne se modifie plus.`)) return;
  sheet.setAttribute('data-busy', '');
  status.textContent = 'Enregistrement…';
  const { error } = await sb.rpc(session.match ? 'match_rpe_set' : 'rpe_set',
    { [session.match ? 'p_match' : 'p_session']: session.id, p_rpe: v, ...(player && { p_player: player.id }) });
  sheet.removeAttribute('data-busy');
  if (error) {
    console.error('RPE non enregistré', error);
    status.innerHTML = `<span class="text-danger">${escapeHtml(error.code === 'PGRST202' ? 'Le RPE n’est pas encore installé (lmfc_v29.sql).' : error.message)}</span>`;
    return;
  }
  document.querySelectorAll('#rpeScale .rpe-opt').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.rpeV) === v)));
  const done = v == null ? 'RPE effacé.' : `Enregistré : ${v} · ${rpeLabel(v)}${player ? ' (saisi par le staff)' : '. Merci !'}`;
  status.textContent = done;
  onSaved?.(v, session);
  sheet.rpe.more ||= !player && formHasMore(session);
  // D'autres à noter : le suivant, sans refermer.
  const rest = pending.filter(s => s !== session);
  if (rest.length) {
    Object.assign(sheet.rpe, { session: rest[0], pending: rest });
    rpeRender();
    status.textContent = `${done} Encore ${rest.length} à noter.`;
    return;
  }
  if (sheet.rpe.more) { status.innerHTML = `${escapeHtml(done)} ${FORM_MORE}`; status.scrollIntoView({ block: 'nearest' }); return; }
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
  box.innerHTML = `<p class="rpe-trend-sum">${rows.length} réponse${rows.length > 1 ? 's' : ''} · moyenne <strong>${rpeFr(avg)}</strong> · dernière <strong>${rows.at(-1).rpe}</strong> (${escapeHtml(rpeLabel(rows.at(-1).rpe))})</p>
    <div class="rpe-cols" role="list">${rows.map(r => `<div class="rpe-col" role="listitem"
        title="${escapeHtml(`${rpeWhen({ date: r.date_seance, heure: r.heure })} · ${r.titre} : ${r.rpe} (${rpeLabel(r.rpe)})${r.corrige ? ' · saisi ou corrigé par le staff' : ''}`)}">
        <span class="rpe-col-v">${r.rpe}${r.corrige ? '*' : ''}</span>
        <span class="rpe-col-bar" style="--h:${r.rpe * 11}px;--rpe:${rpeColor(r.rpe)}"></span>
        <span class="rpe-col-d">${rpeDate(r.date_seance).slice(0, 5)}${sameDay(r) && r.heure ? `<br>${r.heure.slice(0, 5)}` : ''}${r.session_id == null ? '<br>M' : ''}</span>
      </div>`).join('')}</div>
    ${rows.some(r => r.corrige || r.session_id == null) ? `<p class="rpe-note">${[rows.some(r => r.corrige) && '* saisi ou corrigé par le staff', rows.some(r => r.session_id == null) && 'M : match'].filter(Boolean).join(' · ')}</p>` : ''}`;
}
