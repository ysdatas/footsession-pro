/* ============================================================
   LMFC Performance — player-home.js (mon-espace)
   Accueil du joueur, même signature que l'accueil du staff :
     - « Bonjour, Prénom », date, club · poste · équipe ;
     - « Pour toi en ce moment » : une carte par questionnaire à remplir (player-todo.js :
       pré-séance, après séance, avant et après match, chacun ouvert dans Mes
       formulaires), côte à côte avec vidéos reçues, retours du staff, objectifs et
       préventions en cours, exercices à faire ;
     - « Mes derniers chiffres » : poids, masse grasse, dernière
       session de tests (RPC my_physical_* : jamais les indicateurs
       réservés au staff) ;
     - encart « Activer les notifications » tant que ce téléphone ne
       les reçoit pas (push.js) ;
     - « Mon compte » : changer son e-mail ou son mot de passe.
   Lecture seule (sauf l’abonnement aux notifications) : la RLS ne
   renvoie que SES données.
   ============================================================ */

// Icônes du menu (NAV_IC, nav-mobile.js) : une seule collection pour tout le site.
const PH_IC_KEY = { video: 'videos', activity: 'performance', forms: 'check' };
const phIc = (k) => navIc(PH_IC_KEY[k] || k);
/* Une case « Pour toi » : libellé court, chiffre, précision éventuelle (même gabarit que l'accueil du staff). */
const phCard = ({ href, icon, value, label, detail, tone = '' }) => `
  <a class="home-attn-card${tone ? ` is-${tone}` : ''}" href="${href}">
    <span class="home-attn-head"><strong>${label}</strong>${phIc(icon)}</span>
    <span class="home-attn-value">${value ?? '—'}</span>
    ${detail ? `<small>${detail}</small>` : ''}
  </a>`;
const plural = (n, one, many = `${one}s`) => (n > 1 ? many : one);
const daysAgo = (iso) => (Date.now() - new Date(iso).getTime()) / 864e5;

(async () => {
  if (phFromReminder()) return;
  let player;
  try { player = await requirePlayer(); } catch (e) {
    console.error('Mon espace : fiche illisible', e);
    document.getElementById('homeAttn').innerHTML = `<p class="text-danger">Impossible d’ouvrir ton espace (${escapeHtml(e.message)}).</p>`;
    return;
  }
  if (!player) return;

  renderPushCard(document.getElementById('pushBox'), { hideWhenOn: true });
  bindAccount(window.CURRENT_USER);
  document.getElementById('homeDate').textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('greeting').textContent = `Bonjour${player.prenom ? `, ${player.prenom}` : ''}`;

  const [teamRes, vRes, sRes, nRes, eRes, mRes, tRes, todo] = await Promise.all([
    player.team_id ? sb.from('teams').select('nom').eq('id', player.team_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('player_videos').select('id, titre, created_at').eq('player_id', player.id).order('created_at', { ascending: false }),
    sb.from('video_sequences').select('id, label, staff_feedback, feedback_at, submitted_at').eq('player_id', player.id),
    sb.from('player_performance_notes').select('id, kind, status').eq('player_id', player.id),
    sb.from('program_exercises').select('id, done_at').eq('player_id', player.id),
    sb.rpc('my_physical_measurements'),
    sb.rpc('my_physical_tests'),
    ptLoad().catch(e => { console.error('Mon espace : questionnaires à remplir illisibles', e); return null; }),
  ]);
  [vRes, sRes, nRes, eRes, mRes, tRes].forEach(r => { if (r.error) console.warn('Mon espace : donnée indisponible', r.error.message); });

  document.getElementById('clubLine').textContent =
    [window.PLAYER_CLUB || 'Le Mans FC', player.poste, teamRes.data?.nom].filter(Boolean).join(' – ');

  if (todo?.error) console.warn('Mon espace : questionnaires indisponibles', todo.error.message);
  phTodo = todo ? todo.items : null;
  renderAttention(vRes.data || [], sRes.data || [], nRes.data || [], eRes.error ? null : (eRes.data || []));
  renderStats(mRes.data || [], tRes.data || [], player.hidden_sections || []);
})();

/* Relance du staff (lmfc_v50.sql, lmfc_v59.sql) : la notification ouvre mon-espace?rpe=s12 (séance),
   m12 (match) ou ?avis=12 : le questionnaire après séance ou après match, dans Mes formulaires
   (le numéro de relance suit : Mes formulaires la note lue, markReminderOpened). */
function phFromReminder() {
  const p = new URLSearchParams(location.search), rpe = p.get('rpe') || '', avis = Number(p.get('avis'));
  const key = /^[sm]\d+$/.test(rpe) ? `${rpe}:post` : avis ? `m${avis}:post` : null;
  if (!key) return false;
  const rappel = Number(p.get('rappel'));
  location.replace(`mes-formulaires?u=${encodeURIComponent(key)}${rappel ? `&rappel=${rappel}` : ''}`);
  return true;
}

/* « À remplir » : une carte par questionnaire (player-todo.js), côte à côte avec les autres,
   chacune avec son « Répondre » aligné en bas ; sans rouge : un liseré de couleur par moment
   (avant : bleu, après : vert d'eau). null : illisible. */
let phTodo = null;
const PH_TODO_MAX = 4;
function todoCards() {
  if (phTodo === null) return [];
  if (!phTodo.length) return [phCard({ href: 'mes-formulaires', icon: 'forms', tone: 'calm', value: '✓', label: 'Questionnaires', detail: 'Rien à remplir pour l’instant' })];
  const shown = phTodo.length > PH_TODO_MAX ? phTodo.slice(0, PH_TODO_MAX - 1) : phTodo;
  const cards = shown.map(it => `<a class="home-attn-card is-todo is-${it.phase || 'libre'}" href="mes-formulaires?u=${encodeURIComponent(it.key)}">
    <span class="home-attn-head"><strong>${escapeHtml(it.label)}</strong>${phIc('forms')}</span>
    <small>${escapeHtml(ptSub(it))}</small>
    <span class="home-attn-cta">Répondre</span></a>`);
  if (shown.length < phTodo.length) {
    cards.push(`<a class="home-attn-card is-todo" href="mes-formulaires">
      <span class="home-attn-head"><strong>Encore ${phTodo.length - shown.length} à remplir</strong>${phIc('forms')}</span>
      <small>Tous tes questionnaires</small><span class="home-attn-cta">Voir</span></a>`);
  }
  return cards;
}

function renderAttention(videos, seqs, notes, exercises) {
  const cards = todoCards();
  const fresh = videos.filter(v => daysAgo(v.created_at) <= 7);
  cards.push(phCard({ href: 'mes-videos', icon: 'video', tone: fresh.length ? 'new' : (videos.length ? '' : 'calm'),
    value: fresh.length || videos.length, label: fresh.length ? 'Nouvelles vidéos' : 'Vidéos du staff',
    detail: videos.length ? escapeHtml(videos[0].titre || 'Vidéo') : '' }));

  const answered = seqs.filter(s => s.staff_feedback).sort((a, b) => String(b.feedback_at || '').localeCompare(String(a.feedback_at || '')));
  const waiting = seqs.filter(s => s.submitted_at && !s.staff_feedback);
  const quote = (t) => `« ${escapeHtml(t.length > 50 ? `${t.slice(0, 47)}…` : t)} »`;
  cards.push(answered.length
    ? phCard({ href: 'mes-videos?tab=seqs', icon: 'chat', tone: daysAgo(answered[0].feedback_at || 0) <= 7 ? 'new' : '',
        value: answered.length, label: 'Retours du staff', detail: quote(answered[0].staff_feedback) })
    : phCard({ href: 'mes-videos?tab=seqs', icon: 'chat', tone: 'calm', value: waiting.length,
        label: 'Séquences envoyées', detail: waiting.length ? 'En attente de retour' : '' }));

  const active = notes.filter(n => (n.kind === 'objective' || n.kind === 'prevention') && (n.status || 'active') === 'active');
  const prev = active.filter(n => n.kind === 'prevention').length;
  cards.push(phCard({ href: 'mon-programme', icon: 'target', tone: active.length ? '' : 'calm',
    value: active.length, label: 'Objectifs en cours', detail: prev ? `dont ${prev} ${plural(prev, 'prévention')}` : '' }));

  if (exercises?.length) {
    const todo = exercises.filter(e => !e.done_at).length;
    cards.push(phCard({ href: 'mon-programme#exercices', icon: 'check', tone: todo ? '' : 'calm',
      value: todo, label: 'Exercices à faire', detail: `${exercises.length - todo} sur ${exercises.length} faits` }));
  }
  document.getElementById('homeAttn').innerHTML = cards.join('');
}

/* hidden : rubriques que le staff a masquées à ce joueur (Performance). */
function renderStats(measures, tests, hidden) {
  const season = latestSeasonOf(measures);
  const scoped = measures.filter(m => !season || m.season_key === season)
    .sort((a, b) => (MONTHS.indexOf(a.month_label) - MONTHS.indexOf(b.month_label)) || String(a.measured_at || '').localeCompare(String(b.measured_at || '')));
  const last = (k) => scoped.filter(m => num(m[k]) !== null).at(-1);
  const fmt = (v, d) => Number(v).toFixed(d).replace('.', ',');
  const lastTest = [...tests].sort((a, b) => String(a.tested_at || '').localeCompare(String(b.tested_at || ''))).at(-1);
  const stageLabel = (k) => STAGES.find(s => s.key === k)?.label || k;
  const measure = (k) => !hidden.includes('suivi') && !hidden.includes(`mesure:${k}`);
  const anyTest = !hidden.includes('tests') && PLAYER_METRICS.some(m => !hidden.includes(`test:${m.key}`));
  const stats = [
    measure('weight_kg') && ['Poids', last('weight_kg'), (r) => `${fmt(r.weight_kg, 1)} kg`, (r) => r.month_label],
    measure('body_fat_pct') && ['Masse grasse', last('body_fat_pct'), (r) => `${fmt(r.body_fat_pct, 1)} %`, (r) => r.month_label],
    measure('height_cm') && ['Taille', last('height_cm'), (r) => `${fmt(r.height_cm / 100, 2)} m`, (r) => r.month_label],
    anyTest && ['Derniers tests', lastTest, (r) => stageLabel(r.stage), (r) => r.season_key],
  ].filter(Boolean);
  document.getElementById('homeStats').closest('section').hidden = !stats.length;
  document.getElementById('homeStats').innerHTML = stats.some(([, r]) => r)
    ? stats.map(([label, r, val, when]) => `<a class="home-stat" href="player-performance">
        <span>${label}</span><strong>${r ? escapeHtml(val(r)) : '—'}</strong><small>${r ? escapeHtml(when(r) || '') : 'Pas encore mesuré'}</small></a>`).join('')
    : '<p class="text-muted">Aucune mesure pour l’instant : ton préparateur physique les ajoutera.</p>';
}

/* ---------- Mon compte (Supabase Auth) ----------
   Le nouvel e-mail ne remplace l'actuel qu'une fois le lien de
   confirmation ouvert (selon le réglage du projet, aussi celui envoyé à
   l'adresse actuelle) : en attendant, on se connecte avec l'ancien. */
const AUTH_ERRORS = {
  same_password: 'C’est déjà ton mot de passe actuel.',
  weak_password: 'Mot de passe trop faible : 6 caractères minimum.',
  email_exists: 'Cette adresse est déjà utilisée par un autre compte.',
  email_address_invalid: 'Adresse e-mail invalide.',
  over_email_send_rate_limit: 'Trop d’e-mails envoyés : réessaie dans quelques minutes.',
  reauthentication_needed: 'Déconnecte-toi, reconnecte-toi, puis réessaie.',
};
function bindAccount(user) {
  const showEmail = (u) => {
    document.getElementById('emailNow').textContent = `Actuelle : ${u.email}`
      + (u.new_email ? ` – en attente de confirmation : ${u.new_email}` : '');
  };
  showEmail(user);
  const submit = (formId, run) => document.getElementById(formId).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try { await run(e.target); } catch (err) {
      console.error(`Mon compte : ${formId}`, err);
      toast(AUTH_ERRORS[err.code] || err.message, 'error');
    } finally { btn.disabled = false; }
  });
  submit('emailForm', async (form) => {
    const email = form.newEmail.value.trim().toLowerCase();
    if (email === (user.email || '').toLowerCase()) return toast('C’est déjà ton adresse actuelle.', 'error');
    const { data, error } = await sb.auth.updateUser({ email }, { emailRedirectTo: `${location.origin}/` });
    if (error) throw error;
    form.reset();
    showEmail(data.user || { ...user, new_email: email });
    toast(`Lien de confirmation envoyé à ${email} : ouvre-le pour valider (regarde aussi tes spams).`, 'success');
  });
  submit('passForm', async (form) => {
    if (form.newPass.value !== form.newPass2.value) return toast('Les deux mots de passe ne correspondent pas.', 'error');
    const { error } = await sb.auth.updateUser({ password: form.newPass.value });
    if (error) throw error;
    form.reset();
    toast('Mot de passe modifié.', 'success');
  });
}
