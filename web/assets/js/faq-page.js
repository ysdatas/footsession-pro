/* LMFC Performance — faq-page.js
   FAQ (faq.html) : profil dans le menu, question ouverte par son ancre.
   Script sorti de la page pour la politique de contenu (CSP : aucun script en ligne). */
(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  const p = ctx.profile;
  document.getElementById('uName').textContent = p.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[p.role] || p.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (p.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });
})();
// Lien direct vers une question (#asymetrie…) : elle s'ouvre.
if (location.hash) document.querySelector(location.hash + '.faq-q')?.setAttribute('open', '');
document.getElementById('faqSearch').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('.faq-q').forEach(d => {
    const hit = !q || d.textContent.toLowerCase().includes(q);
    d.classList.toggle('hidden', !hit);
    if (q && hit) d.setAttribute('open', ''); else if (!q) d.removeAttribute('open');
  });
});
// Recherche retenue (retour sur la FAQ) : la liste se refiltre.
if (document.getElementById('faqSearch').value) document.getElementById('faqSearch').dispatchEvent(new Event('input'));
