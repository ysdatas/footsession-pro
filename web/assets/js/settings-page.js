/* ============================================================
   FootSession Pro — settings-page.js
   Compte, mot de passe, préférences de travail (tableau tactique)
   et bloc d'administration pour les admins de club.
   ============================================================ */

let myProfile = null;

/* Valeurs par défaut : servent aussi de référence au tableau tactique. */
const DEFAULT_PREFS = {
  jersey: '#E03131',
  opp: '#1f6feb',
  draw: '#C9A84C',
  tokenR: 18,
  equipR: 16,
  view: 'complet',
  font: 'Inter, sans-serif',
  showNumbers: true,
};

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  myProfile = ctx.profile;

  document.getElementById('uName').textContent = myProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[myProfile.role] || myProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (myProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  // --- Mon compte ---
  document.getElementById('p-nom').value = myProfile.nom || '';
  document.getElementById('p-email').value = ctx.user.email || '';
  document.getElementById('p-role').value = ROLE_LABELS[myProfile.role] || myProfile.role;
  document.getElementById('settingsSub').textContent =
    (myProfile.clubs?.nom || 'Club') + ' · ' + (ROLE_LABELS[myProfile.role] || myProfile.role);

  document.getElementById('saveAccount').addEventListener('click', saveAccount);
  document.getElementById('savePassword').addEventListener('click', savePassword);
  document.getElementById('savePrefs').addEventListener('click', savePrefs);

  // Retours visuels des curseurs
  const tok = document.getElementById('pf-token'), eqp = document.getElementById('pf-equip');
  tok.addEventListener('input', () => document.getElementById('pf-tokenVal').textContent = tok.value);
  eqp.addEventListener('input', () => document.getElementById('pf-equipVal').textContent = eqp.value);

  fillPrefs(await loadPrefs());

  if (myProfile.role === 'admin') await showAdmin();
})();

/* ---------- Préférences ---------- */
async function loadPrefs() {
  const { data, error } = await sb.from('profiles').select('prefs').eq('id', myProfile.id).single();
  if (error) {
    // La colonne prefs n'existe pas encore : on reste sur les valeurs par défaut.
    console.warn('prefs indisponibles :', error.message);
    return { ...DEFAULT_PREFS };
  }
  return { ...DEFAULT_PREFS, ...(data.prefs || {}) };
}

function fillPrefs(p) {
  document.getElementById('pf-jersey').value = p.jersey;
  document.getElementById('pf-opp').value = p.opp;
  document.getElementById('pf-draw').value = p.draw;
  document.getElementById('pf-token').value = p.tokenR;
  document.getElementById('pf-equip').value = p.equipR;
  document.getElementById('pf-tokenVal').textContent = p.tokenR;
  document.getElementById('pf-equipVal').textContent = p.equipR;
  document.getElementById('pf-view').value = p.view;
  document.getElementById('pf-font').value = p.font;
  document.getElementById('pf-numbers').value = p.showNumbers ? '1' : '0';
}

async function savePrefs() {
  const prefs = {
    jersey: document.getElementById('pf-jersey').value,
    opp: document.getElementById('pf-opp').value,
    draw: document.getElementById('pf-draw').value,
    tokenR: Number(document.getElementById('pf-token').value),
    equipR: Number(document.getElementById('pf-equip').value),
    view: document.getElementById('pf-view').value,
    font: document.getElementById('pf-font').value,
    showNumbers: document.getElementById('pf-numbers').value === '1',
  };
  const btn = document.getElementById('savePrefs'); btn.disabled = true;
  try {
    const { error } = await sb.from('profiles').update({ prefs }).eq('id', myProfile.id);
    if (error) throw error;
    toast('Préférences enregistrées', 'success');
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

/* ---------- Compte ---------- */
async function saveAccount() {
  const nom = document.getElementById('p-nom').value.trim();
  if (!nom) return toast('Le nom est obligatoire.', 'error');
  const btn = document.getElementById('saveAccount'); btn.disabled = true;
  try {
    const { error } = await sb.from('profiles').update({ nom }).eq('id', myProfile.id);
    if (error) throw error;
    toast('Compte mis à jour', 'success');
    setTimeout(() => location.reload(), 700);
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

async function savePassword() {
  const p1 = document.getElementById('p-pass').value, p2 = document.getElementById('p-pass2').value;
  if (p1.length < 6) return toast('6 caractères minimum.', 'error');
  if (p1 !== p2) return toast('Les deux mots de passe ne correspondent pas.', 'error');
  const btn = document.getElementById('savePassword'); btn.disabled = true;
  try {
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) throw error;
    document.getElementById('p-pass').value = '';
    document.getElementById('p-pass2').value = '';
    toast('Mot de passe modifié', 'success');
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

/* ---------- Administration ---------- */
async function showAdmin() {
  document.getElementById('adminCard').classList.remove('hidden');
  const [{ count: nbSessions }, { count: nbPlayers }, { data: members }, { count: nbTemplates }] = await Promise.all([
    sb.from('sessions').select('id', { count: 'exact', head: true }),
    sb.from('players').select('id', { count: 'exact', head: true }),
    sb.from('profiles').select('id').eq('club_id', myProfile.club_id),
    sb.from('exercise_templates').select('id', { count: 'exact', head: true }),
  ]);
  // Toutes ces données appartiennent au club et sont partagées par le staff :
  // les compteurs reflètent donc bien l'activité collective.
  const stats = [
    ['Séances', nbSessions ?? 0], ['Joueurs', nbPlayers ?? 0],
    ['Modèles d\'exercices', nbTemplates ?? 0], ['Membres du club', members?.length ?? 0],
  ];
  document.getElementById('adminStats').innerHTML = stats.map(([label, val]) =>
    `<div class="card kpi"><div class="kpi-num">${val}</div><div class="kpi-label">${label}</div></div>`).join('');
}
