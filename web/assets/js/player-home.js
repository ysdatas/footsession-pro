/* ============================================================
   LMFC Performance — player-home.js (mon-espace.html)
   Accueil du joueur, même signature que l'accueil du staff :
     - « Bonjour, Prénom », date, club · poste · équipe ;
     - « Pour toi en ce moment » : vidéos reçues, retours du staff,
       objectifs et préventions en cours, exercices à faire ;
     - « Mes derniers chiffres » : poids, masse grasse, dernière
       session de tests (RPC my_physical_* : jamais les indicateurs
       réservés au staff) ;
     - accès à Performance, Vidéos, Objectifs.
   Tout est en lecture seule : la RLS ne renvoie que SES données.
   ============================================================ */

const PH_IC = {
  video: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.41V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  check: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
};
const phIc = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${PH_IC[k]}</svg>`;
const phCard = ({ href, icon, value, label, detail, tone = '' }) => `
  <a class="home-attn-card${tone ? ` is-${tone}` : ''}" href="${href}">
    <span class="home-attn-ic">${phIc(icon)}</span>
    <span class="home-attn-body">
      ${value != null ? `<span class="home-attn-value">${value}</span>` : ''}
      <strong>${label}</strong>
      ${detail ? `<small>${detail}</small>` : ''}
    </span>
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

  document.getElementById('homeDate').textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('greeting').textContent = `Bonjour${player.prenom ? `, ${player.prenom}` : ''}`;
  document.getElementById('homeTiles').innerHTML = [
    ['player-performance.html', 'activity', 'Ma performance', 'Tests, radar, poids et masse grasse'],
    ['mes-videos.html', 'video', 'Mes vidéos', 'Vidéos du staff, mes séquences'],
    ['mon-programme.html', 'target', 'Objectifs & préventions', 'Objectifs, préventions, exercices'],
  ].map(([href, ic, label, desc]) => `<a class="home-tile" href="${href}">
      <span class="home-tile-ic">${phIc(ic)}</span>
      <span class="home-tile-text"><strong>${label}</strong><small>${desc}</small></span></a>`).join('');

  const [teamRes, vRes, sRes, nRes, eRes, mRes, tRes] = await Promise.all([
    player.team_id ? sb.from('teams').select('nom').eq('id', player.team_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('player_videos').select('id, titre, created_at').eq('player_id', player.id).order('created_at', { ascending: false }),
    sb.from('video_sequences').select('id, label, staff_feedback, feedback_at, submitted_at').eq('player_id', player.id),
    sb.from('player_performance_notes').select('id, kind, status').eq('player_id', player.id),
    sb.from('program_exercises').select('id, done_at').eq('player_id', player.id),
    sb.rpc('my_physical_measurements'),
    sb.rpc('my_physical_tests'),
  ]);
  [vRes, sRes, nRes, eRes, mRes, tRes].forEach(r => { if (r.error) console.warn('Mon espace : donnée indisponible', r.error.message); });

  document.getElementById('clubLine').textContent =
    [window.PLAYER_CLUB || 'Le Mans FC', player.poste, teamRes.data?.nom].filter(Boolean).join(' · ');

  renderAttention(vRes.data || [], sRes.data || [], nRes.data || [], eRes.error ? null : (eRes.data || []));
  renderStats(mRes.data || [], tRes.data || [], player.hidden_sections || []);
})();

function renderAttention(videos, seqs, notes, exercises) {
  const cards = [];
  const fresh = videos.filter(v => daysAgo(v.created_at) <= 7);
  cards.push(videos.length
    ? phCard({ href: 'mes-videos.html', icon: 'video', tone: fresh.length ? 'urgent' : '',
        value: fresh.length || videos.length,
        label: fresh.length ? `${plural(fresh.length, 'Nouvelle vidéo', 'Nouvelles vidéos')} cette semaine` : `${plural(videos.length, 'Vidéo')} du staff`,
        detail: `Dernière : ${escapeHtml(videos[0].titre || 'Vidéo')}` })
    : phCard({ href: 'mes-videos.html', icon: 'video', tone: 'calm', label: 'Aucune vidéo pour l’instant',
        detail: 'Les vidéos de ton staff arriveront ici.' }));

  const answered = seqs.filter(s => s.staff_feedback).sort((a, b) => String(b.feedback_at || '').localeCompare(String(a.feedback_at || '')));
  const waiting = seqs.filter(s => s.submitted_at && !s.staff_feedback);
  cards.push(answered.length
    ? phCard({ href: 'mes-videos.html?tab=seqs', icon: 'chat', tone: daysAgo(answered[0].feedback_at || 0) <= 7 ? 'urgent' : '',
        value: answered.length, label: `${plural(answered.length, 'Retour')} du staff`,
        detail: `« ${escapeHtml(answered[0].staff_feedback.length > 70 ? `${answered[0].staff_feedback.slice(0, 67)}…` : answered[0].staff_feedback)} »` })
    : phCard({ href: 'mes-videos.html?tab=seqs', icon: 'chat', tone: 'calm', value: waiting.length || null,
        label: waiting.length ? plural(waiting.length, 'Séquence envoyée', 'Séquences envoyées') : 'Aucun retour pour l’instant',
        detail: waiting.length ? 'En attente du retour de ton staff.' : 'Sélectionne tes séquences et envoie-les au staff.' }));

  const active = notes.filter(n => (n.kind === 'objective' || n.kind === 'prevention') && (n.status || 'active') === 'active');
  const prev = active.filter(n => n.kind === 'prevention').length;
  cards.push(phCard({ href: 'mon-programme.html', icon: 'target', tone: active.length ? '' : 'calm',
    value: active.length || null,
    label: active.length ? `${plural(active.length, 'Objectif')} en cours` : 'Aucun objectif en cours',
    detail: active.length ? (prev ? `Dont ${prev} ${plural(prev, 'prévention')}.` : 'Fixés par ton staff.') : 'Tes objectifs et préventions apparaîtront ici.' }));

  if (exercises?.length) {
    const todo = exercises.filter(e => !e.done_at).length;
    cards.push(phCard({ href: 'mon-programme.html#exercices', icon: 'check', tone: todo ? '' : 'calm',
      value: todo || null, label: todo ? `${plural(todo, 'Exercice')} à faire` : 'Programme à jour',
      detail: `${exercises.length - todo} fait${exercises.length - todo > 1 ? 's' : ''} sur ${exercises.length}.` }));
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
  const suivi = !hidden.includes('suivi');
  const stats = [
    suivi && ['Poids', last('weight_kg'), (r) => `${fmt(r.weight_kg, 1)} kg`, (r) => r.month_label],
    suivi && ['Masse grasse', last('body_fat_pct'), (r) => `${fmt(r.body_fat_pct, 1)} %`, (r) => r.month_label],
    suivi && ['Taille', last('height_cm'), (r) => `${fmt(r.height_cm / 100, 2)} m`, (r) => r.month_label],
    !hidden.includes('tests') && ['Derniers tests', lastTest, (r) => stageLabel(r.stage), (r) => r.season_key],
  ].filter(Boolean);
  document.getElementById('homeStats').closest('section').hidden = !stats.length;
  document.getElementById('homeStats').innerHTML = stats.some(([, r]) => r)
    ? stats.map(([label, r, val, when]) => `<a class="home-stat" href="player-performance.html">
        <span>${label}</span><strong>${r ? escapeHtml(val(r)) : '—'}</strong><small>${r ? escapeHtml(when(r) || '') : 'Pas encore mesuré'}</small></a>`).join('')
    : '<p class="text-muted">Aucune mesure pour l’instant : ton préparateur physique les ajoutera.</p>';
}
