/* ============================================================
   FootSession Pro — sessions-list-page.js (Chemin B / Supabase)
   Liste des séances : recherche, tri, et regroupement en dossiers
   hebdomadaires numérotés depuis le début de saison du club.
   ============================================================ */

let myProfile = null;
let sessionsCache = [];
let saisonStart = null;          // date de reprise du club (peut être nulle)
let sortBy = 'date';
let sortAsc = false;
let grouped = true;              // dossiers par semaine actifs par défaut
const openWeeks = new Set();     // semaines dépliées (clé = lundi ISO)

/* Réglages d'affichage mémorisés localement : ils n'ont pas à voyager
   en base, ils ne concernent que le confort de lecture sur ce poste. */
const VIEW_KEY = 'footsession-sessions-view';

/* Sens de lecture par défaut de chaque critère. */
const SORT_DEFAULT_ASC = { date: false, titre: true, equipe: true, travail: false };

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  myProfile = ctx.profile;

  document.getElementById('uName').textContent = myProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[myProfile.role] || myProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (myProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  if (canEdit(myProfile.role)) document.getElementById('btnNew').classList.remove('hidden');

  restoreView();
  document.getElementById('searchSession').addEventListener('input', render);
  document.getElementById('sortBy').addEventListener('change', (e) => {
    sortBy = e.target.value;
    // Chaque critère a un sens de lecture naturel : les séances récentes et
    // les plus chargées d'abord, mais les noms et les équipes de A à Z.
    sortAsc = SORT_DEFAULT_ASC[sortBy];
    persistView(); syncControls(); render();
  });
  document.getElementById('sortDir').addEventListener('click', () => { sortAsc = !sortAsc; persistView(); syncControls(); render(); });
  document.getElementById('groupToggle').addEventListener('click', () => { grouped = !grouped; persistView(); syncControls(); render(); });

  await loadList();
})();

function restoreView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
    if (['date', 'titre', 'equipe', 'travail'].includes(v.sortBy)) sortBy = v.sortBy;
    if (typeof v.sortAsc === 'boolean') sortAsc = v.sortAsc;
    if (typeof v.grouped === 'boolean') grouped = v.grouped;
  } catch (e) { /* réglages illisibles : on garde les valeurs par défaut */ }
  syncControls();
}
function persistView() {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify({ sortBy, sortAsc, grouped })); } catch (e) {}
}
function syncControls() {
  document.getElementById('sortBy').value = sortBy;
  const dir = document.getElementById('sortDir');
  dir.textContent = sortAsc ? '↑' : '↓';
  dir.title = sortAsc ? 'Ordre croissant — cliquer pour inverser' : 'Ordre décroissant — cliquer pour inverser';
  document.getElementById('groupToggle').classList.toggle('active', grouped);
}

async function loadList() {
  const wrap = document.getElementById('listWrap');
  try {
    const [{ data: sessions, error }, { data: club }] = await Promise.all([
      sb.from('sessions')
        .select('id, titre, date_seance, equipe, duree_min, procedures(id, duree_min, nb_sequences, duree_sequence_min, temps_recup_min)')
        .order('date_seance', { ascending: false }).order('id', { ascending: false }),
      sb.from('clubs').select('saison_start').eq('id', myProfile.club_id).maybeSingle(),
    ]);
    if (error) throw error;

    sessionsCache = sessions || [];
    // Sans date de reprise renseignée, la semaine de la séance la plus
    // ancienne fait office de Semaine 1.
    saisonStart = club?.saison_start
      || sessionsCache.map(s => s.date_seance).filter(Boolean).sort()[0]
      || null;

    render();
  } catch (e) { wrap.innerHTML = `<p class="text-danger">${escapeHtml(e.message)}</p>`; }
}

/* ---------- Tri ---------- */
function sortSessions(list) {
  const dir = sortAsc ? 1 : -1;
  const byDate = (a, b) => (a.date_seance || '').localeCompare(b.date_seance || '') || (a.id - b.id);
  const cmp = {
    date: byDate,
    titre: (a, b) => (a.titre || '').localeCompare(b.titre || '', 'fr', { sensitivity: 'base' }),
    equipe: (a, b) => (a.equipe || '').localeCompare(b.equipe || '', 'fr', { sensitivity: 'base' }) || byDate(a, b),
    travail: (a, b) => sessionWorkMin(a.procedures) - sessionWorkMin(b.procedures) || byDate(a, b),
  }[sortBy] || byDate;
  return [...list].sort((a, b) => cmp(a, b) * dir);
}

/* ---------- Rendu ---------- */
function render() {
  const wrap = document.getElementById('listWrap');
  const q = (document.getElementById('searchSession').value || '').toLowerCase().trim();
  const match = (s) => !q || `${s.titre || ''} ${s.equipe || ''} ${fmtDateFr(s.date_seance)}`.toLowerCase().includes(q);

  const visible = sortSessions(sessionsCache.filter(match));
  const total = sessionsCache.length;
  document.getElementById('sessSub').textContent = q
    ? `${visible.length} résultat${visible.length > 1 ? 's' : ''} sur ${total} séance${total > 1 ? 's' : ''}`
    : `${total} séance${total > 1 ? 's' : ''} au total`;

  if (!total) { wrap.innerHTML = `<div class="empty">Aucune séance enregistrée.</div>`; return; }
  if (!visible.length) { wrap.innerHTML = `<div class="empty">Aucune séance ne correspond à « ${escapeHtml(q)} ».</div>`; return; }

  wrap.innerHTML = grouped ? renderGrouped(visible, !!q) : renderFlat(visible);
}

function renderFlat(list) {
  return `<div class="card" style="padding:6px;">${table(list)}</div>`;
}

/* Dossiers hebdomadaires. Les semaines sont présentées dans l'ordre
   chronologique choisi ; celle en cours est dépliée d'office. */
function renderGrouped(list, searching) {
  const weeks = new Map();
  list.forEach(s => {
    const key = mondayOf(s.date_seance) || 'sans-date';
    if (!weeks.has(key)) weeks.set(key, []);
    weeks.get(key).push(s);
  });

  const thisMonday = mondayOf(new Date().toISOString().slice(0, 10));
  const keys = [...weeks.keys()].sort((a, b) => a.localeCompare(b));
  // La date reste l'axe des dossiers : les autres tris s'appliquent à l'intérieur.
  if (!sortAsc) keys.reverse();

  return keys.map(key => {
    const items = weeks.get(key);
    const isCurrent = key === thisMonday;
    // Pendant une recherche, tout est ouvert pour ne rien masquer.
    const open = searching || isCurrent || openWeeks.has(key);
    const travail = items.reduce((sum, s) => sum + sessionWorkMin(s.procedures), 0);

    let titre, plage;
    if (key === 'sans-date') {
      titre = 'Sans date'; plage = '';
    } else {
      const n = weekNumber(key, saisonStart);
      titre = n && n >= 1 ? `Semaine ${n}` : 'Avant la reprise';
      plage = weekRangeLabel(key);
    }

    return `<div class="week-folder ${open ? 'open' : ''}" data-week="${key}">
      <button class="week-head" type="button" onclick="toggleWeek('${key}')">
        <span class="week-chevron">▾</span>
        <span class="week-title">${escapeHtml(titre)}${isCurrent ? ' <span class="badge badge-gold">EN COURS</span>' : ''}</span>
        <span class="week-range">${escapeHtml(plage)}</span>
        <span class="week-meta">${items.length} séance${items.length > 1 ? 's' : ''} · ${fmtMin(travail)} min de travail</span>
      </button>
      <div class="week-body">${table(items)}</div>
    </div>`;
  }).join('');
}

window.toggleWeek = (key) => {
  const el = document.querySelector(`.week-folder[data-week="${key}"]`);
  if (!el) return;
  const nowOpen = !el.classList.contains('open');
  el.classList.toggle('open', nowOpen);
  if (nowOpen) openWeeks.add(key); else openWeeks.delete(key);
};

function table(list) {
  const canWrite = canEdit(myProfile.role);
  return `<table class="table">
    <thead><tr><th>Titre</th><th>Date</th><th>Équipe</th><th>Durée séance</th><th>Temps de travail</th><th>Procédés</th><th></th></tr></thead>
    <tbody>
      ${list.map(s => `
        <tr>
          <td><a class="text-gold" href="session-edit.html?id=${s.id}">${escapeHtml(s.titre)}</a></td>
          <td>${escapeHtml(fmtDateFr(s.date_seance))}</td>
          <td>${escapeHtml(s.equipe || '—')}</td>
          <td>${s.duree_min} min</td>
          <td>${fmtMin(sessionWorkMin(s.procedures))} min</td>
          <td>${(s.procedures || []).length}</td>
          <td style="text-align:right;white-space:nowrap;">
            <a class="btn btn-sm" href="session-edit.html?id=${s.id}">Ouvrir</a>
            <button class="btn btn-sm" type="button" title="Fiche détaillée" onclick="generateSessionPDF(${s.id})">PDF</button>
            <button class="btn btn-sm" type="button" title="Tout sur une feuille, pour le staff" onclick="generateCoachPDF(${s.id})">Fiche</button>
            ${canWrite ? `<button class="btn btn-sm btn-danger" type="button" onclick="deleteSession(${s.id}, this)">Suppr.</button>` : ''}
          </td>
        </tr>`).join('')}
    </tbody>
  </table>`;
}

window.deleteSession = async (id, btn) => {
  if (!confirm('Supprimer cette séance et tous ses procédés ?')) return;
  try {
    const { error } = await sb.from('sessions').delete().eq('id', id);
    if (error) throw error;
    sessionsCache = sessionsCache.filter(s => s.id !== id);
    render();
    toast('Séance supprimée.', 'success');
  } catch (e) { toast(e.message, 'error'); }
};
