/* LMFC Performance — onboarding-page.js
   Création du club (onboarding.html).
   Script sorti de la page pour la politique de contenu (CSP : aucun script en ligne). */
const errBox = document.getElementById('authError');
const showErr = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };

document.getElementById('createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  errBox.classList.add('hidden');
  const nom = document.getElementById('c-nom').value.trim();
  const { error } = await sb.rpc('create_club', { p_nom: nom });
  if (error) return showErr(error.message);
  window.location.href = 'dashboard.html';
});
document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

// Connecté mais sans club : l'accès enregistré par un admin est activé ici.
async function check(manual) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }
  document.getElementById('myEmail').textContent = session.user.email || '—';
  await claimClubAccess();
  const { data: profile } = await sb.from('profiles').select('role, club_id').eq('id', session.user.id).maybeSingle();
  if (profile?.club_id) { window.location.href = homeFor(profile); return; }
  if (manual) showErr('Aucun accès enregistré pour cette adresse pour l’instant.');
}
document.getElementById('retryBtn').addEventListener('click', () => check(true));
check(false);
