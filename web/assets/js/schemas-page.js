/* ============================================================
   LMFC Performance — schemas-page.js (schemas)
   Bibliothèque de schémas, en page (menu) : la fenêtre « Schémas » de
   la séance (session-templates.js) telle quelle — recherche, type,
   tags, suppression — où « Insérer » devient « Nouvelle séance » :
   session-edit.html?template=… crée la séance avec ce procédé.
   Chargé AVANT session-templates.js, qui complète EDIT_DO.
   Droits : ceux des schémas (exercise_templates), dans la base.
   ============================================================ */

/* Boutons générés : data-do (la politique de contenu interdit les onclick="…"). */
const EDIT_DO = {};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-do]');
  if (b && Object.hasOwn(EDIT_DO, b.dataset.do)) EDIT_DO[b.dataset.do](b);
});

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  const me = ctx.profile;
  document.getElementById('uName').textContent = me.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[me.role] || me.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (me.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  TPL.insertLabel = 'Nouvelle séance';
  EDIT_DO.insertTemplate = (b) => { location.href = `session-edit?template=${Number(b.dataset.arg)}`; };
  openLibrary();   // session-templates.js : charge, filtre et affiche
})();
