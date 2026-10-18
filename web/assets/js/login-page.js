/* LMFC Performance — login-page.js
   Page de connexion (index.html) : connexion, création de compte, renvoi de l’e-mail de confirmation.
   Script sorti de la page pour la politique de contenu (CSP : aucun script en ligne). */
const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');
const toggleLink = document.getElementById('toggleMode');
const errBox = document.getElementById('authError');
const okBox = document.getElementById('authOk');
const sub = document.getElementById('authSub');
let mode = 'login';

const resendBtn = document.getElementById('resendBtn');
// Le lien de confirmation ramène toujours ici (à autoriser dans Supabase :
// Authentication → URL Configuration → Redirect URLs).
const AUTH_REDIRECT = `${location.origin}/`;
let resendTo = '';

function showError(msg) { errBox.textContent = msg; errBox.classList.remove('hidden'); okBox.classList.add('hidden'); }
function showOk(msg) { okBox.textContent = msg; okBox.classList.remove('hidden'); errBox.classList.add('hidden'); }
function clearMsgs() { errBox.classList.add('hidden'); okBox.classList.add('hidden'); resendBtn.classList.add('hidden'); }
function offerResend(email) { resendTo = email; resendBtn.classList.remove('hidden'); }

/* Erreurs Supabase Auth → message compréhensible. */
function authMessage(error, fallback) {
  const code = error?.code || '';
  if (code === 'email_not_confirmed' || /not confirmed/i.test(error?.message || ''))
    return 'Adresse e-mail pas encore confirmée : ouvrez le lien reçu par e-mail (regardez aussi dans les spams).';
  if (code === 'over_email_send_rate_limit' || /rate limit/i.test(error?.message || ''))
    return 'Trop d’e-mails envoyés en peu de temps. Réessayez un peu plus tard.';
  if (code === 'user_already_exists') return 'Un compte existe déjà avec cette adresse : connectez-vous.';
  if (code === 'weak_password') return 'Mot de passe trop faible : 6 caractères au moins.';
  if (code === 'email_address_invalid') return 'Adresse e-mail invalide.';
  return fallback;
}

resendBtn.addEventListener('click', async () => {
  if (!resendTo) return;
  resendBtn.disabled = true;
  const { error } = await sb.auth.resend({ type: 'signup', email: resendTo, options: { emailRedirectTo: AUTH_REDIRECT } });
  if (error) {
    console.error('Renvoi de la confirmation', error);
    showError(authMessage(error, error.message || 'Renvoi impossible.'));
    resendBtn.classList.remove('hidden');
  } else {
    showOk(`E-mail de confirmation renvoyé à ${resendTo}. Regardez aussi dans les spams.`);
    resendBtn.classList.remove('hidden');
  }
  setTimeout(() => { resendBtn.disabled = false; }, 60000);   // Supabase : un renvoi par minute
});

toggleLink.addEventListener('click', (e) => {
  e.preventDefault();
  clearMsgs();
  mode = mode === 'login' ? 'signup' : 'login';
  loginForm.classList.toggle('hidden', mode !== 'login');
  signupForm.classList.toggle('hidden', mode !== 'signup');
  toggleLink.textContent = mode === 'login' ? 'Pas encore de compte ? Créer un compte' : 'Déjà un compte ? Se connecter';
  sub.textContent = mode === 'login' ? 'Staff et joueurs' : 'Avec l’adresse enregistrée par le club';
  document.querySelector('.auth-title').textContent = mode === 'login' ? 'Connexion' : 'Créer mon compte';
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMsgs();
  const email = document.getElementById('l-email').value.trim();
  const password = document.getElementById('l-password').value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    const msg = authMessage(error, 'Identifiants incorrects ou compte inexistant.');
    showError(msg);
    if (error.code === 'email_not_confirmed' || /not confirmed/i.test(error.message || '')) offerResend(email);
    return;
  }
  try { sessionStorage.removeItem('lmfc-nav'); } catch { /* mémoire de navigation (app.js) */ }
  await goHome();
});

signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMsgs();
  const nom = document.getElementById('s-nom').value.trim();
  const email = document.getElementById('s-email').value.trim();
  const password = document.getElementById('s-password').value;
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { nom }, emailRedirectTo: AUTH_REDIRECT } });
  if (error) {
    console.error('Inscription', error);
    return showError(authMessage(error, error.message || 'Inscription impossible.'));
  }
  if (data.session) { await goHome(); return; }
  showOk(`Compte créé ! Un e-mail de confirmation vient d’être envoyé à ${email} : ouvrez le lien qu’il contient, puis connectez-vous. Rien reçu ? Regardez dans les spams.`);
  offerResend(email);
});

/* Une seule page de connexion pour tout le monde : l'accès enregistré
   par l'admin (e-mail + fonction + fiche) est activé, puis chacun
   arrive dans son espace. */
async function goHome() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  await claimClubAccess();
  const { data: profile } = await sb.from('profiles')
    .select('role, club_id').eq('id', session.user.id).maybeSingle();
  window.location.href = homeFor(profile);
}
goHome();
