/* ============================================================
   LMFC Performance — analytics-cats.js
   Catégories et saisons de la page Bilan. Une catégorie est une équipe du
   club (teams) : U14, U17, N2… telles qu'elles existent, rien d'écrit en dur.
   Pour ne jamais mélanger les catégories :
     - une séance compte dans chacune de ses équipes (séance commune,
       lmfc_v51.sql) ; une séance sans équipe, seulement dans « Toutes » ;
     - une présence compte dans les équipes du joueur que la séance réunit.
       Un joueur sans équipe (extérieur, pas encore rangé) compte dans l'équipe
       principale de la séance ; un joueur d'une autre équipe (invité), ou que
       le compte ne voit pas, seulement dans « Toutes ».
   Sélection vide = toutes les catégories : rien n'est retiré.
   Dépend de nav.js (sessionTeamIds, teamName), procedure-time.js
   (sessionWorkMin) et perf-metrics.js (seasonKeyFor).
   ============================================================ */

/* Équipes du joueur que la séance réunit (règles ci-dessus). */
function presenceCats(a, s) {
  const p = a.players;
  if (!p) return [];
  const mine = [p.team_id, ...(p.other_team_ids || [])].filter(Boolean);
  if (!mine.length) return s.team_id ? [s.team_id] : [];
  return sessionTeamIds(s).filter(t => mine.includes(t));
}

/* Séances d'une sélection, chacune avec les seules présences de la sélection. */
function pickCats(sessions, sel) {
  if (!sel.length) return sessions;
  const hit = (ids) => ids.some(t => sel.includes(t));
  return sessions.filter(s => hit(sessionTeamIds(s)))
    .map(s => ({ ...s, attendance: (s.attendance || []).filter(a => hit(presenceCats(a, s))) }));
}

/* Chiffres d'une liste de séances. Présence : null sans aucune présence notée. */
function sessionKpis(sessions) {
  const att = sessions.flatMap(s => s.attendance || []).filter(a => a.statut !== 'non_concerne');   // retiré de la séance : hors présence
  const procs = sessions.flatMap(s => s.procedures || []);
  return {
    sessions: sessions.length, procedures: procs.length,
    presence: att.length ? Math.round(att.filter(a => a.present).length / att.length * 100) : null,
    volume: sessionWorkMin(procs),   // temps ballon, récupérations exclues
  };
}

/* Lignes de comparaison : les catégories choisies, ou toutes celles du compte
   (avec les séances sans équipe s'il y en a). Moins de deux lignes : rien. */
function compareRows(sessions, sel, teamIds) {
  const rows = (sel.length ? sel : teamIds).map(id => ({ label: teamName(id), ...sessionKpis(pickCats(sessions, [id])) }));
  const none = sel.length ? [] : sessions.filter(s => !sessionTeamIds(s).length);
  if (none.length) rows.push({ label: 'Sans équipe', ...sessionKpis(none) });
  return rows.length > 1 ? rows : [];
}

/* Libellé d'une sélection : « Toutes les catégories », « U15 », « U15 + U14 ». */
const catsLabel = (sel) => (sel.length ? sel.map(teamName).join(' + ') : 'Toutes les catégories');

/* Filtre de requête (PostgREST) d'une sélection, séances communes comprises. */
const catsFilter = (sel) => `team_id.in.(${sel.join(',')}),other_team_ids.ov.{${sel.join(',')}}`;

/* Saisons proposées, de l'actuelle à celle de la plus ancienne séance. */
function seasonsFrom(firstIso, startMonth) {
  const last = Number(seasonKeyFor(null, startMonth).slice(0, 4));
  const first = Math.min(last, firstIso ? Number(seasonKeyFor(firstIso, startMonth).slice(0, 4)) : last);
  return Array.from({ length: last - first + 1 }, (_, i) => `${last - i}-${last - i + 1}`);
}

/* Bornes d'une saison « 2026-2027 » : du 1er du mois de début à la veille de la suivante. */
function seasonBounds(key, startMonth) {
  const y = Number(key.slice(0, 4)), end = new Date(y + 1, startMonth - 1, 0);
  const p2 = (n) => String(n).padStart(2, '0');
  return { from: `${y}-${p2(startMonth)}-01`, to: `${end.getFullYear()}-${p2(end.getMonth() + 1)}-${p2(end.getDate())}` };
}

/* Boutons « Toutes les catégories », puis une équipe par bouton. Un clic
   ajoute ou retire l'équipe (une ou plusieurs) ; « Toutes » vide le choix. */
function renderCatSwitch(box, teams, sel, onChange) {
  const draw = () => {
    box.innerHTML = [`<button type="button" data-cat="" aria-pressed="${!sel.length}">Toutes les catégories</button>`,
      ...teams.map(t => `<button type="button" data-cat="${t.id}" aria-pressed="${sel.includes(t.id)}">${escapeHtml(t.nom)}</button>`)].join('');
  };
  box.addEventListener('click', (e) => {
    const id = Number(e.target.closest('button[data-cat]')?.dataset.cat ?? NaN);
    if (Number.isNaN(id)) return;
    const next = !id ? [] : sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id];
    sel = teams.map(t => t.id).filter(x => next.includes(x));   // ordre des équipes
    draw();
    onChange(sel);
  });
  draw();
}

/* Tableau de comparaison (vide : caché). */
function renderCompare(rows) {
  const box = document.getElementById('catCompare');
  box.classList.toggle('hidden', !rows.length);
  const pct = (v) => (v == null ? '—' : `${v} %`);
  document.getElementById('catCompareBody').innerHTML = rows.map(r => `<tr><th scope="row">${escapeHtml(r.label)}</th>`
    + `<td>${r.sessions}</td><td>${r.procedures}</td><td>${pct(r.presence)}</td><td>${r.volume.toLocaleString('fr-FR')} min</td></tr>`).join('');
}
