/* ============================================================
   FootSession Pro — player-page.js (fiche joueur synthétique)
   Point central d'un joueur côté staff : informations modifiables,
   présence, derniers relevés physiques, profil /10 et préventions
   en cours, avec des accès vers Performance, Vidéos et Préventions.
   Réservée au staff (nav.js) ; la RLS ne renvoie de toute façon
   que les joueurs du club de l'utilisateur.
   ============================================================ */

const playerId = Number(new URLSearchParams(location.search).get('id'));
let ficheProfile = null;
let fichePlayer = null;

const IDENTITY_FIELDS = ['prenom', 'nom', 'numero', 'poste', 'team_id', 'date_naissance',
  'nationalite', 'pied_fort', 'statut', 'contrat_fin'];

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  ficheProfile = ctx.profile;
  document.getElementById('uName').textContent = ficheProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[ficheProfile.role] || ficheProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (ficheProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  if (!playerId) { document.getElementById('ficheName').textContent = 'Joueur introuvable'; return; }

  document.getElementById('linkPerformance').href = `player-performance.html?id=${playerId}`;
  document.getElementById('physLink').href = `player-performance.html?id=${playerId}`;
  document.getElementById('linkPreventions').href = `preventions.html?player=${playerId}`;
  document.getElementById('progLink').href = `preventions.html?player=${playerId}`;
  if (canManageVideos(ficheProfile.role)) {
    const v = document.getElementById('linkVideos');
    v.href = `videos.html?player=${playerId}`;
    v.classList.remove('hidden');
  }

  // select('*') : les colonnes d'identité n'existent qu'après la
  // migration player_profile_career.sql, et une liste explicite ferait
  // échouer toute la fiche tant qu'elle n'est pas passée.
  const { data, error } = await sb.from('players').select('*').eq('id', playerId).maybeSingle();
  if (error || !data) {
    document.getElementById('ficheName').textContent = 'Joueur introuvable';
    if (error) toast(error.message, 'error');
    return;
  }
  fichePlayer = data;
  renderHeader();
  renderInfoForm();
  await Promise.all([loadAttendance(), loadPhysical(), loadPrograms(), loadPhoto()]);
})();

const fullName = (p) => `${p.prenom || ''} ${p.nom || ''}`.trim();
const fmtNum = (v, d) => v === null || v === undefined ? '—' : Number(v).toFixed(d).replace('.', ',');

function renderHeader() {
  const p = fichePlayer;
  document.title = `FootSession Pro — ${fullName(p)}`;
  document.getElementById('ficheName').textContent = fullName(p);
  document.getElementById('ficheAvatar').textContent =
    (((p.prenom || p.nom || '')[0] || '') + ((p.nom || '')[0] || '')).toUpperCase() || '?';
  document.getElementById('ficheSub').textContent =
    [p.poste, p.numero != null ? `#${p.numero}` : null, teamName(p.team_id)].filter(Boolean).join(' · ');
}

async function loadPhoto() {
  if (!fichePlayer.photo_path) return;
  const { data } = await sb.storage.from('player-photos').createSignedUrl(fichePlayer.photo_path, 3600);
  if (!data?.signedUrl) return;
  const img = el('img', { class: 'fiche-photo', src: data.signedUrl, alt: '' });
  document.getElementById('ficheAvatar').replaceWith(img);
}

/* ---------- Informations (modifiables sur place) ---------- */
function renderInfoForm() {
  const form = document.getElementById('infoForm');
  const editable = canEdit(ficheProfile.role);
  const teams = window.CLUB_TEAMS || [];
  if (teams.length && 'team_id' in fichePlayer) {
    document.getElementById('teamField').classList.remove('hidden');
    form.team_id.innerHTML = '<option value="">Sans équipe</option>'
      + teams.map(t => `<option value="${t.id}">${escapeHtml(t.nom)}</option>`).join('');
  }
  for (const name of IDENTITY_FIELDS) {
    const input = form[name];
    if (!input) continue;
    // Colonne absente (migration non passée) : champ masqué, jamais envoyé.
    if (!(name in fichePlayer)) { input.closest('label').classList.add('hidden'); continue; }
    input.value = fichePlayer[name] ?? '';
    input.disabled = !editable;
  }
  document.getElementById('infoActions').classList.toggle('hidden', !editable);
  document.getElementById('infoHint').textContent = editable ? 'Modifiable directement' : '';
  form.addEventListener('submit', saveInfo);
}

async function saveInfo(e) {
  e.preventDefault();
  const form = e.target;
  const body = {};
  for (const name of IDENTITY_FIELDS) {
    const input = form[name];
    if (!input || !(name in fichePlayer) || input.closest('label').classList.contains('hidden')) continue;
    const v = input.value.trim();
    body[name] = v === '' ? null : (['numero', 'team_id'].includes(name) ? Number(v) : v);
  }
  if (!body.nom) return toast('Le nom est obligatoire.', 'error');
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const { error } = await sb.from('players').update(body).eq('id', playerId);
    if (error) throw error;
    Object.assign(fichePlayer, body);
    renderHeader();
    toast('Fiche mise à jour', 'success');
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; }
}

/* ---------- Présence ---------- */
async function loadAttendance() {
  const box = document.getElementById('attendanceBox');
  const { data, error } = await sb.from('attendance')
    .select('present, sessions(id, titre, date_seance)').eq('player_id', playerId);
  if (error) { box.innerHTML = `<p class="text-danger">${escapeHtml(error.message)}</p>`; return; }
  const rows = (data || []).filter(r => r.sessions)
    .sort((a, b) => String(b.sessions.date_seance).localeCompare(String(a.sessions.date_seance)));
  if (!rows.length) { box.innerHTML = '<p class="text-muted">Aucune présence enregistrée.</p>'; return; }
  const present = rows.filter(r => r.present).length;
  box.innerHTML = `
    <div class="stat-big">${Math.round(present / rows.length * 100)} %</div>
    <div class="stat-sub">${present} séance${present > 1 ? 's' : ''} sur ${rows.length}</div>
    <div class="mini-list">${rows.slice(0, 12).map(r => `
      <div class="mini-row"><a href="session-edit.html?id=${r.sessions.id}">${escapeHtml(r.sessions.titre || 'Séance')}
        <span class="text-muted">${escapeHtml(fmtDate(r.sessions.date_seance))}</span></a>
        <span class="${r.present ? 'text-success' : 'text-danger'}">${r.present ? 'Présent' : 'Absent'}</span></div>`).join('')}
    </div>`;
}

/* ---------- Suivi physique + profil /10 ---------- */
async function loadPhysical() {
  const [{ data: ms, error: e1 }, { data: ts, error: e2 }] = await Promise.all([
    sb.from('player_physical_measurements').select('*').eq('player_id', playerId),
    sb.from('player_physical_tests').select('*').eq('player_id', playerId),
  ]);
  renderPhysical(e1 ? null : ms || [], e1);
  renderProfile(e2 ? null : ts || [], e2);
}

function renderPhysical(rows, error) {
  const box = document.getElementById('physBox');
  if (error) { box.innerHTML = `<p class="text-danger">${escapeHtml(error.message)}</p>`; return; }
  const season = latestSeasonOf(rows);
  const scoped = rows.filter(r => !season || r.season_key === season)
    .sort((a, b) => (MONTHS.indexOf(a.month_label) - MONTHS.indexOf(b.month_label))
      || String(a.measured_at || '').localeCompare(String(b.measured_at || '')) || a.id - b.id);
  const last = (key) => scoped.filter(r => num(r[key]) !== null).at(-1);
  const cells = MORPHO_METRICS.map(m => {
    const r = last(m.key);
    return `<div class="phys-cell"><span>${m.label}</span>
      <strong>${r ? `${fmtNum(r[m.key], m.digits)} ${m.unit}` : '—'}</strong>
      <small>${r ? escapeHtml(r.month_label) : ''}</small></div>`;
  }).join('');
  box.innerHTML = `<div class="phys-grid">${cells}</div>
    ${season ? `<p class="text-muted" style="font-size:.78rem;margin:10px 0 0;">Saison ${escapeHtml(season)}</p>` : ''}`;
}

function renderProfile(rows, error) {
  const box = document.getElementById('profileBox');
  if (error) { box.innerHTML = `<p class="text-danger">${escapeHtml(error.message)}</p>`; return; }
  const season = latestSeasonOf(rows);
  const scoped = rows.filter(r => !season || r.season_key === season);
  // Session la plus avancée de la saison ayant au moins une note.
  const test = [...STAGES].reverse()
    .map(s => scoped.filter(r => r.stage === s.key && SCORE_AXES.some(a => num(r[a.key]) !== null)).at(-1))
    .find(Boolean);
  if (!test) { box.innerHTML = '<p class="text-muted">Aucun test sur 10 pour l’instant.</p>'; return; }
  document.getElementById('profileWhen').textContent =
    `${STAGES.find(s => s.key === test.stage)?.label || ''}${season ? ' · ' + season : ''}`;
  box.innerHTML = `<div class="score-bars">${SCORE_AXES.map(a => {
    const v = num(test[a.key]);
    return `<div class="score-bar"><span>${a.label}</span>
      <span class="track"><span class="fill" style="width:${v === null ? 0 : Math.max(0, Math.min(10, v)) * 10}%"></span></span>
      <strong>${v === null ? '—' : fmtNum(v, 1)}</strong></div>`;
  }).join('')}</div>`;
}

/* ---------- Préventions en cours ---------- */
async function loadPrograms() {
  const box = document.getElementById('programBox');
  const { data, error } = await sb.from('player_programs')
    .select('id, title, category, status, dosage').eq('player_id', playerId).neq('status', 'termine')
    .order('updated_at', { ascending: false });
  if (error) {
    console.warn('player_programs indisponible (migration roles_teams_preventions.sql ?) :', error.message);
    box.innerHTML = '<p class="text-muted">Rubrique indisponible.</p>';
    return;
  }
  box.innerHTML = data.length
    ? `<div class="mini-list">${data.map(p => `
        <div class="mini-row"><span>${escapeHtml(p.title)}${p.dosage ? ` <span class="text-muted">· ${escapeHtml(p.dosage)}</span>` : ''}</span>
          <span class="prog-chip">${escapeHtml(PROGRAM_CATEGORIES[p.category] || p.category)}</span></div>`).join('')}</div>`
    : '<p class="text-muted">Aucune prévention en cours.</p>';
}
