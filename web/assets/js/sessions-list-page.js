/* ============================================================
   FootSession Pro — sessions-list-page.js (Chemin B / Supabase)
   ============================================================ */

let myProfile = null;

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  myProfile = ctx.profile;

  document.getElementById('uName').textContent = myProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[myProfile.role] || myProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (myProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  if (canEdit(myProfile.role)) document.getElementById('btnNew').classList.remove('hidden');

  document.getElementById('searchSession').addEventListener('input', applySearch);

  await loadList();
})();

async function loadList() {
  const wrap = document.getElementById('listWrap');
  try {
    const { data: sessions, error } = await sb.from('sessions')
      .select('id, titre, date_seance, categorie, equipe, duree_min, procedures(id)')
      .order('date_seance', { ascending: false }).order('id', { ascending: false });
    if (error) throw error;

    document.getElementById('sessSub').textContent = `${sessions.length} séance${sessions.length > 1 ? 's' : ''} au total`;

    if (!sessions.length) {
      wrap.innerHTML = `<div class="empty">Aucune séance enregistrée.</div>`;
      return;
    }

    const canWrite = canEdit(myProfile.role);
    wrap.innerHTML = `<div class="card" style="padding:6px;">
      <table class="table" id="sessionsTable">
        <thead><tr><th>Titre</th><th>Date</th><th>Catégorie</th><th>Équipe</th><th>Durée</th><th>Procédés</th><th></th></tr></thead>
        <tbody>
          ${sessions.map(s => `
            <tr data-search="${escapeHtml((s.titre + ' ' + (s.categorie || '') + ' ' + (s.equipe || '')).toLowerCase())}">
              <td><a class="text-gold" href="session-edit.html?id=${s.id}">${escapeHtml(s.titre)}</a></td>
              <td>${escapeHtml(s.date_seance)}</td>
              <td>${s.categorie ? `<span class="badge">${escapeHtml(s.categorie)}</span>` : '—'}</td>
              <td>${escapeHtml(s.equipe || '—')}</td>
              <td>${s.duree_min} min</td>
              <td>${(s.procedures || []).length}</td>
              <td style="text-align:right;white-space:nowrap;">
                <a class="btn btn-sm" href="session-edit.html?id=${s.id}">Ouvrir</a>
                <button class="btn btn-sm" type="button" onclick="generateSessionPDF(${s.id})">PDF</button>
                ${canWrite ? `<button class="btn btn-sm btn-danger" type="button" onclick="deleteSession(${s.id}, this)">Suppr.</button>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  } catch (e) { wrap.innerHTML = `<p class="text-danger">${escapeHtml(e.message)}</p>`; }
}

function applySearch(e) {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('#sessionsTable tbody tr').forEach(tr => {
    tr.style.display = tr.dataset.search.includes(q) ? '' : 'none';
  });
}

window.deleteSession = async (id, btn) => {
  if (!confirm('Supprimer cette séance et tous ses procédés ?')) return;
  try {
    const { error } = await sb.from('sessions').delete().eq('id', id);
    if (error) throw error;
    btn.closest('tr').remove();
    toast('Séance supprimée.', 'success');
  } catch (e) { toast(e.message, 'error'); }
};
