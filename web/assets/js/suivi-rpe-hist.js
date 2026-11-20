/* ============================================================
   LMFC Performance — suivi-rpe-hist.js (suivi-rpe, vue « Historique »)
   Toutes les réponses des joueurs de l'équipe, journée par journée, dans un
   tableau comme la vue Réponses : une ligne par joueur, jour et séance (ou
   match), une colonne par question ; en-têtes et première colonne fixes, la
   suite défile vers la droite. On y trouve le RPE (session_rpe, match_rpe),
   les courbatures (player_soreness), l'avis de match (match_feedback) et les
   questionnaires (custom_form_responses), tels qu'enregistrés : rien n'est
   recalculé. Filtres : joueur, période, formulaire ; l'équipe est celle des
   capsules. Lecture seule, la RLS ne rend que ce que le compte peut voir.
   Adresse : suivi-rpe?vue=historique&joueur=&du=&au=&form= (fiche joueur).
   Dépend de suivi-rpe-resp.js (srRespCell, srInitials) et form-levels.js.
   ============================================================ */
const HR = { key: null, players: [], rows: [], cols: [], photos: new Map(), seq: 0, player: null, from: null, to: null, form: '' };
const HR_DAYS = 14;   // période par défaut : les deux dernières semaines
const HR_LATE = 15;   // une réponse arrive jusqu'à J+14 (rpe_open) : on lit un jour de plus
const HR_FIXED = [   // colonnes d'origine, avant celles des questionnaires
  { key: 'rpe', group: 'rpe', form: 'RPE', label: 'Effort ressenti (sur 10)', q: { type: 'scale', min: 1, max: 10 } },
  { key: 'sore_n', group: 'sore', form: 'Courbatures au réveil', label: 'Niveau (0 à 10)', q: { type: 'scale', min: 0, max: 10 } },
  { key: 'sore_m', group: 'sore', form: 'Courbatures au réveil', label: 'Muscles', q: { type: 'textarea', required: false } },
  { key: 'avis_i', group: 'avis', form: 'Avis de match', label: 'Sa performance', q: { type: 'textarea', required: false } },
  { key: 'avis_c', group: 'avis', form: 'Avis de match', label: 'L’équipe', q: { type: 'textarea', required: false } },
];
const hrDay = (iso) => new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(`${iso}T12:00`));

/* Filtres lus dans l'adresse la première fois, puis gardés en mémoire. */
function hrInit() {
  if (HR.from) return;
  const u = new URL(location.href), today = srToday();
  HR.player = Number(u.searchParams.get('joueur')) || null;
  HR.to = u.searchParams.get('au') || today;
  HR.from = u.searchParams.get('du') || srDays(today, -HR_DAYS + 1);
  HR.form = u.searchParams.get('form') || '';
}

function hrUrl() {
  const u = new URL(location.href), set = (k, v) => (v ? u.searchParams.set(k, v) : u.searchParams.delete(k));
  set('joueur', HR.player); set('du', HR.from); set('au', HR.to); set('form', HR.form);
  history.replaceState(null, '', u);
}

async function renderSrHist(body) {
  hrInit();
  const key = `${SR.team}|${HR.from}|${HR.to}`;
  if (HR.key !== key) {
    body.classList.add('is-loading');
    document.getElementById('srStatus').textContent = 'Chargement de l’historique…';
    const ok = await hrLoad(key);
    body.classList.remove('is-loading');
    if (!ok || SR.view !== 'hist') return;
  }
  hrUrl();
  hrRender(body);
}

/* Joueurs de l'équipe, puis tout ce qu'ils ont répondu sur la période. */
async function hrLoad(key) {
  const seq = ++HR.seq, from = HR.from <= HR.to ? HR.from : HR.to, to = HR.from <= HR.to ? HR.to : HR.from;
  const pl = await sb.from('players').select('id, nom, prenom, team_id, other_team_ids, exterieur, photo_path').order('nom');
  if (seq !== HR.seq) return false;
  if (pl.error) { console.error('Historique : joueurs illisibles', pl.error); hrFail(pl.error); return false; }
  HR.players = (pl.data || []).filter(p => playerInTeam(p, SR.team) || p.id === HR.player);
  const ids = HR.players.map(p => p.id);
  if (!ids.length) { Object.assign(HR, { key, rows: [], cols: [] }); return true; }
  const late = `${srDays(to, HR_LATE)}T23:59:59`;
  const [sr, mr, so, fb, cf, photos] = await Promise.all([
    sb.from('session_rpe').select('player_id, rpe, corrige_par, sessions!inner(id, titre, date_seance, heure)').in('player_id', ids)
      .gte('sessions.date_seance', from).lte('sessions.date_seance', to),
    sb.from('match_rpe').select('player_id, rpe, corrige_par, matches!inner(id, adversaire, date_match, heure)').in('player_id', ids)
      .gte('matches.date_match', from).lte('matches.date_match', to),
    sb.from('player_soreness').select('player_id, jour, niveau, muscles').in('player_id', ids).gte('jour', from).lte('jour', to),
    sb.from('match_feedback').select('player_id, individuel, collectif, matches!inner(id, adversaire, date_match, heure)').in('player_id', ids)
      .gte('matches.date_match', from).lte('matches.date_match', to),
    sb.from('custom_form_responses').select('id, form_id, player_id, occurrence, form_title_snapshot, questions_snapshot, answers, submitted_at')
      .in('player_id', ids).gte('submitted_at', `${from}T00:00:00`).lte('submitted_at', late).order('submitted_at', { ascending: false }),
    signedUrls('player-photos', HR.players.map(p => p.photo_path)).catch(() => new Map()),   // liens gardés 23 h (app.js)
  ]);
  if (seq !== HR.seq) return false;
  const data = (r, what) => { if (r.error && !['42P01', 'PGRST205', 'PGRST200'].includes(r.error.code)) console.warn(`Historique : ${what} illisible`, r.error); return r.data || []; };
  const sessionOf = new Map(), matchOf = new Map(), rows = new Map(), cols = new Map(HR_FIXED.map(c => [c.key, c]));
  // Une ligne : un joueur, un jour, une séance ou un match (ou le réveil, ou un questionnaire libre).
  const row = (player_id, day, event, label, heure) => {
    const k = `${player_id}|${day}|${event}`;
    if (!rows.has(k)) rows.set(k, { player_id, day, event, label, heure: heure || '', vals: new Map(), groups: new Set() });
    return rows.get(k);
  };
  const put = (r, group, values) => { r.groups.add(group); Object.entries(values).forEach(([k, v]) => r.vals.set(k, v)); };
  for (const x of data(sr, 'RPE de séance')) {
    const s = x.sessions; sessionOf.set(s.id, s);
    put(row(x.player_id, s.date_seance, `s${s.id}`, s.titre || 'Séance', s.heure), 'rpe', { rpe: { v: x.rpe, staff: !!x.corrige_par } });
  }
  for (const x of data(mr, 'RPE de match')) {
    const m = x.matches; matchOf.set(m.id, m);
    put(row(x.player_id, m.date_match, `m${m.id}`, `Match contre ${m.adversaire}`, m.heure), 'rpe', { rpe: { v: x.rpe, staff: !!x.corrige_par } });
  }
  for (const x of data(fb, 'avis de match')) {
    const m = x.matches; matchOf.set(m.id, m);
    put(row(x.player_id, m.date_match, `m${m.id}`, `Match contre ${m.adversaire}`, m.heure), 'avis', { avis_i: { v: x.individuel }, avis_c: { v: x.collectif } });
  }
  const forms = data(cf, 'questionnaires');
  // Séances et matchs des questionnaires dont le RPE n'est pas dans la période lue.
  const needS = [...new Set(forms.filter(r => /^s\d+$/.test(r.occurrence)).map(r => Number(r.occurrence.slice(1))).filter(id => !sessionOf.has(id)))];
  const needM = [...new Set(forms.filter(r => /^m\d+$/.test(r.occurrence)).map(r => Number(r.occurrence.slice(1))).filter(id => !matchOf.has(id)))];
  const [xs, xm] = await Promise.all([
    needS.length ? sb.from('sessions').select('id, titre, date_seance, heure').in('id', needS) : { data: [] },
    needM.length ? sb.from('matches').select('id, adversaire, date_match, heure').in('id', needM) : { data: [] },
  ]);
  if (seq !== HR.seq) return false;
  (xs.data || []).forEach(s => sessionOf.set(s.id, s));
  (xm.data || []).forEach(m => matchOf.set(m.id, m));
  for (const r of forms) {
    const occ = r.occurrence || '', n = Number(occ.slice(1)), s = occ[0] === 's' ? sessionOf.get(n) : null, m = occ[0] === 'm' ? matchOf.get(n) : null;
    const day = s?.date_seance || m?.date_match || (occ[0] === 'j' ? occ.slice(1) : srIso(new Date(r.submitted_at)));
    if (!day || day < from || day > to) continue;
    const title = String(r.form_title_snapshot || 'Questionnaire').split(' · ')[0], group = `f${r.form_id}`, vals = {};
    (r.questions_snapshot || []).filter(q => !q.fixe).forEach(q => {
      const k = `${group}:${q.id}`;
      if (!cols.has(k)) cols.set(k, { key: k, group, form: title, label: q.label || 'Question', q });
      vals[k] = { v: r.answers?.[q.id], q };
    });
    const label = s ? s.titre || 'Séance' : m ? `Match contre ${m.adversaire}` : occ[0] === 'j' ? 'Au réveil' : title;
    put(row(r.player_id, day, occ[0] === 's' || occ[0] === 'm' ? occ : occ || `f${r.id}`, label, s?.heure || m?.heure), group, vals);
  }
  // Courbatures : sur la séance du jour s'il y en a une, sinon une ligne « Au réveil ».
  for (const x of data(so, 'courbatures')) {
    const same = [...rows.values()].filter(r => r.player_id === x.player_id && r.day === x.jour && r.event[0] === 's').sort((a, b) => a.heure.localeCompare(b.heure))[0];
    put(same || row(x.player_id, x.jour, `j${x.jour}`, 'Au réveil'), 'sore', { sore_n: { v: x.niveau }, sore_m: { v: (x.muscles || []).join(', ') } });
  }
  Object.assign(HR, { key, photos, cols: [...cols.values()],
    rows: [...rows.values()].sort((a, b) => b.day.localeCompare(a.day) || hrName(a.player_id).localeCompare(hrName(b.player_id), 'fr') || a.heure.localeCompare(b.heure)) });
  return true;
}

const hrName = (id) => playerFullName(HR.players.find(p => p.id === id));

function hrFail(error) {
  document.getElementById('srStatus').textContent = 'Historique illisible pour le moment.';
  document.getElementById('srBody').innerHTML = `<div class="empty text-danger">${escapeHtml(error?.message || 'Une erreur est survenue.')}</div>`;
}

/* Filtres de la vue : joueur, période, formulaire. */
function hrFiltersHtml() {
  const groups = new Map();
  HR.cols.forEach(c => { if (HR.rows.some(r => r.groups.has(c.group)) && !groups.has(c.group)) groups.set(c.group, c.form); });
  if (HR.form && !groups.has(HR.form)) groups.set(HR.form, 'Formulaire choisi');
  return `<div class="hr-filters" role="group" aria-label="Filtres de l’historique">
    <div class="field"><label for="hrPlayer">Joueur</label><select id="hrPlayer" data-hr="player"><option value="">Tous les joueurs</option>
      ${HR.players.map(p => `<option value="${p.id}"${p.id === HR.player ? ' selected' : ''}>${escapeHtml(playerFullName(p))}</option>`).join('')}</select></div>
    <div class="field"><label for="hrFrom">Du</label><input type="date" id="hrFrom" data-hr="from" value="${escapeHtml(HR.from)}"></div>
    <div class="field"><label for="hrTo">Au</label><input type="date" id="hrTo" data-hr="to" value="${escapeHtml(HR.to)}"></div>
    <div class="field"><label for="hrForm">Formulaire</label><select id="hrForm" data-hr="form"><option value="">Tous</option>
      ${[...groups].map(([k, label]) => `<option value="${escapeHtml(k)}"${k === HR.form ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></div>
  </div>`;
}

function hrRender(body) {
  const rows = HR.rows.filter(r => (!HR.player || r.player_id === HR.player) && (!HR.form || r.groups.has(HR.form)));
  const cols = HR.cols.filter(c => (!HR.form || c.group === HR.form) && rows.some(r => r.groups.has(c.group)));
  const days = new Set(rows.map(r => `${r.player_id}|${r.day}`)).size, who = new Set(rows.map(r => r.player_id)).size;
  document.getElementById('srStatus').textContent = rows.length
    ? `${days} journée${days > 1 ? 's' : ''} avec des réponses${HR.player ? '' : `, ${who} joueur${who > 1 ? 's' : ''}`}` : 'Aucune réponse sur cette période.';
  const table = rows.length ? `<div class="sr-resp-wrap hr-wrap"><table class="sr-resp-table hr-table"><thead><tr><th scope="col">${HR.player ? 'Jour' : 'Joueur et jour'}</th>
      ${cols.map(c => `<th scope="col"><div class="sr-th" title="${escapeHtml(`${c.form} : ${c.label}`)}"><small class="hr-th-form">${escapeHtml(c.form)}</small>${escapeHtml(c.label)}</div></th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr${r.day !== rows[rows.indexOf(r) - 1]?.day ? ' class="hr-newday"' : ''}><th scope="row">${hrWho(r)}</th>${cols.map(c => hrCell(r, c)).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Aucune réponse pour ces filtres. Élargissez la période ou choisissez un autre joueur.</div>';
  swapKeepView(body, `${hrFiltersHtml()}<p class="sr-resp-note">Une ligne par joueur, jour et séance ou match ; tout ce qu’il a répondu, tel qu’enregistré.
    <span class="sr-resp-legend"><span class="sr-resp-none">—</span> pas de réponse à ce questionnaire <span class="sr-resp-skip">·</span> question laissée vide</span></p>${table}`);
}

/* Première colonne : le joueur (photo ou initiales) puis le jour et la séance ; un seul joueur : le jour en tête. */
function hrWho(r) {
  const p = HR.players.find(x => x.id === r.player_id) || {}, url = HR.photos.get(p.photo_path);
  const when = `${hrDay(r.day)} · ${r.label}${r.heure ? ` · ${r.heure.slice(0, 5)}` : ''}`;
  if (HR.player) return `<span class="hr-who"><strong>${escapeHtml(hrDay(r.day))}</strong><small>${escapeHtml(`${r.label}${r.heure ? ` · ${r.heure.slice(0, 5)}` : ''}`)}</small></span>`;
  const face = url ? `<img class="sr-resp-face" src="${escapeHtml(url)}" alt="" loading="lazy" width="28" height="28">`
    : `<span class="sr-resp-face" aria-hidden="true">${escapeHtml(srInitials(p))}</span>`;
  return `<button type="button" class="hr-who is-player" data-hr-player="${Number(p.id)}" title="Voir seulement ${escapeHtml(playerFullName(p))}">${face}
    <span><strong>${escapeHtml(playerFullName(p))}</strong><small>${escapeHtml(when)}</small></span></button>`;
}

function hrCell(r, c) {
  if (!r.groups.has(c.group)) return '<td class="is-empty"><span class="sr-resp-none" title="Pas de réponse à ce questionnaire">—</span></td>';
  const x = r.vals.get(c.key);
  if (c.key === 'rpe') return `<td class="is-num"><span class="sr-resp-rpe" style="--rpe:${rpeColor(x.v)}"${x.staff ? ' title="Saisi ou corrigé par le staff"' : ''}>${x.v}${x.staff ? '*' : ''}</span></td>`;
  return srRespCell(x?.q || c.q, true, x?.v);
}

/* Filtres et clic sur un joueur : la vue se redessine, et relit la base si la période change. */
document.addEventListener('change', (e) => {
  const f = e.target.closest('[data-hr]');
  if (!f || SR.view !== 'hist') return;
  if (f.dataset.hr === 'player') HR.player = Number(f.value) || null;
  if (f.dataset.hr === 'form') HR.form = f.value;
  if (f.dataset.hr === 'from' || f.dataset.hr === 'to') { if (!f.value) return; HR[f.dataset.hr] = f.value; }
  renderSrHist(document.getElementById('srBody'));
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-hr-player]');
  if (!b || SR.view !== 'hist') return;
  HR.player = Number(b.dataset.hrPlayer);
  renderSrHist(document.getElementById('srBody'));
});
