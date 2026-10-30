/* ============================================================
   LMFC Performance — player-home.js (mon-espace.html)
   Accueil du joueur, même signature que l'accueil du staff :
     - « Bonjour, Prénom », date, club · poste · équipe ;
     - « Pour toi en ce moment » : RPE de la séance à noter, ou où il
       se note (rpe.js, lmfc_v29.sql), vidéos reçues, retours du staff, objectifs et
       préventions en cours, exercices à faire ;
     - « Mes derniers chiffres » : poids, masse grasse, dernière
       session de tests (RPC my_physical_* : jamais les indicateurs
       réservés au staff) ;
     - accès à Performance, Vidéos, Objectifs ;
     - encart « Activer les notifications » tant que ce téléphone ne
       les reçoit pas (push.js) ;
     - « Mon compte » : changer son e-mail ou son mot de passe.
   Lecture seule (sauf l’abonnement aux notifications) : la RLS ne
   renvoie que SES données.
   ============================================================ */

const PH_IC = {
  video: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.41V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  check: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
};
const phIc = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${PH_IC[k]}</svg>`;
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
  document.getElementById('homeTiles').innerHTML = [
    ['player-performance.html', 'activity', 'Ma performance'],
    ['mes-videos.html', 'video', 'Mes vidéos'],
    ['mon-programme.html', 'target', 'Objectifs & préventions'],
  ].map(([href, ic, label]) => `<a class="home-tile" href="${href}">${phIc(ic)}<span>${label}</span></a>`).join('');

  const [teamRes, vRes, sRes, nRes, eRes, mRes, tRes, rRes] = await Promise.all([
    player.team_id ? sb.from('teams').select('nom').eq('id', player.team_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('player_videos').select('id, titre, created_at').eq('player_id', player.id).order('created_at', { ascending: false }),
    sb.from('video_sequences').select('id, label, staff_feedback, feedback_at, submitted_at').eq('player_id', player.id),
    sb.from('player_performance_notes').select('id, kind, status').eq('player_id', player.id),
    sb.from('program_exercises').select('id, done_at').eq('player_id', player.id),
    sb.rpc('my_physical_measurements'),
    sb.rpc('my_physical_tests'),
    sb.rpc('my_rpe_sessions'),
  ]);
  [vRes, sRes, nRes, eRes, mRes, tRes].forEach(r => { if (r.error) console.warn('Mon espace : donnée indisponible', r.error.message); });

  document.getElementById('clubLine').textContent =
    [window.PLAYER_CLUB || 'Le Mans FC', player.poste, teamRes.data?.nom].filter(Boolean).join(' · ');

  if (rRes.error && rRes.error.code !== 'PGRST202') console.warn('Mon espace : RPE indisponible', rRes.error.message);
  phRpe = rRes.data || [];
  phRpeOn = !rRes.error;   // sans lmfc_v29.sql : pas de carte
  document.getElementById('homeAttn').addEventListener('click', openRpeFromCard);
  renderAttention(vRes.data || [], sRes.data || [], nRes.data || [], eRes.error ? null : (eRes.data || []));
  renderStats(mRes.data || [], tRes.data || [], player.hidden_sections || []);
})();

/* RPE : la séance à noter (la plus récente sans réponse), sinon la dernière notée. */
let phRpe = [], phRpeOn = false;
const phDay = (iso) => { const d = Math.round((new Date(new Date().toDateString()) - new Date(`${iso}T00:00`)) / 864e5);
  return d === 0 ? 'aujourd’hui' : d === 1 ? 'hier' : `il y a ${d} jours`; };
function rpeCardHtml() {
  const todo = phRpe.filter(s => s.rpe == null), s = todo[0] || phRpe[0];
  // Toujours là : le joueur sait où noter même quand aucune séance n'attend.
  if (!s) return phCard({ href: 'calendrier.html', icon: 'activity', tone: 'calm', value: '—', label: 'Ton effort (RPE)',
    detail: `Rien à noter. Après chaque séance, ton effort se note ici (jusqu’à ${RPE_DAYS} jours après).` });
  return `<a class="home-attn-card${todo.length ? ' is-urgent' : ' is-calm'}" href="calendrier.html" data-rpe="${s.session_id}">
    <span class="home-attn-head"><strong>${todo.length ? 'Note ton effort' : 'Ton effort'}</strong>${phIc('activity')}</span>
    <span class="home-attn-value">${s.rpe ?? '?'}<small class="rpe-of">/10</small></span>
    <small>${escapeHtml(s.titre)} · ${phDay(s.date_seance)}${todo.length > 1 ? ` · ${todo.length} séances à noter` : ''}</small>
  </a>`;
}
function openRpeFromCard(e) {
  const a = e.target.closest('[data-rpe]');
  const s = a && phRpe.find(x => x.session_id === Number(a.dataset.rpe));
  if (!s) return;
  e.preventDefault();
  openRpeSheet({ session: { id: s.session_id, titre: s.titre, date: s.date_seance }, value: s.rpe, onSaved: (v) => {
    s.rpe = v;
    a.outerHTML = rpeCardHtml();
  } });
}

function renderAttention(videos, seqs, notes, exercises) {
  const cards = [];
  if (phRpeOn) cards.push(rpeCardHtml());
  const fresh = videos.filter(v => daysAgo(v.created_at) <= 7);
  cards.push(phCard({ href: 'mes-videos.html', icon: 'video', tone: fresh.length ? 'urgent' : (videos.length ? '' : 'calm'),
    value: fresh.length || videos.length, label: fresh.length ? 'Nouvelles vidéos' : 'Vidéos du staff',
    detail: videos.length ? escapeHtml(videos[0].titre || 'Vidéo') : '' }));

  const answered = seqs.filter(s => s.staff_feedback).sort((a, b) => String(b.feedback_at || '').localeCompare(String(a.feedback_at || '')));
  const waiting = seqs.filter(s => s.submitted_at && !s.staff_feedback);
  const quote = (t) => `« ${escapeHtml(t.length > 50 ? `${t.slice(0, 47)}…` : t)} »`;
  cards.push(answered.length
    ? phCard({ href: 'mes-videos.html?tab=seqs', icon: 'chat', tone: daysAgo(answered[0].feedback_at || 0) <= 7 ? 'urgent' : '',
        value: answered.length, label: 'Retours du staff', detail: quote(answered[0].staff_feedback) })
    : phCard({ href: 'mes-videos.html?tab=seqs', icon: 'chat', tone: 'calm', value: waiting.length,
        label: 'Séquences envoyées', detail: waiting.length ? 'En attente de retour' : '' }));

  const active = notes.filter(n => (n.kind === 'objective' || n.kind === 'prevention') && (n.status || 'active') === 'active');
  const prev = active.filter(n => n.kind === 'prevention').length;
  cards.push(phCard({ href: 'mon-programme.html', icon: 'target', tone: active.length ? '' : 'calm',
    value: active.length, label: 'Objectifs en cours', detail: prev ? `dont ${prev} ${plural(prev, 'prévention')}` : '' }));

  if (exercises?.length) {
    const todo = exercises.filter(e => !e.done_at).length;
    cards.push(phCard({ href: 'mon-programme.html#exercices', icon: 'check', tone: todo ? '' : 'calm',
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
    ? stats.map(([label, r, val, when]) => `<a class="home-stat" href="player-performance.html">
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
      + (u.new_email ? ` · en attente de confirmation : ${u.new_email}` : '');
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
