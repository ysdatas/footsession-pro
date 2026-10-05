/* ============================================================
   LMFC Performance — player-page.js (fiche joueur)
   Point central d'un joueur côté staff. L'essentiel tient à côté du
   nom (taille — poids — poste, puis équipe, âge, pied, statut) ;
   « Modifier » ouvre la fiche en fenêtre. Dessous : derniers relevés
   physiques, parcours, objectifs et préventions (statut, suppression
   sur place) et programme terrain, avec des accès vers Performance
   et Vidéos.
   Réservée au staff (nav.js) ; la RLS ne renvoie de toute façon
   que les joueurs du club de l'utilisateur.
   ============================================================ */

const playerId = Number(new URLSearchParams(location.search).get('id'));
let ficheProfile = null;
let fichePlayer = null;
let ficheLatest = {};   // dernière taille et dernier poids connus (Suivi physique)

const IDENTITY_FIELDS = [
  ['prenom', 'Prénom'], ['nom', 'Nom'], ['poste', 'Poste'], ['ligne', 'Ligne'],
  ['team_id', 'Équipe'], ['date_naissance', 'Date de naissance'],
  ['pied_fort', 'Pied fort'], ['statut', 'Statut'],
];

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  ficheProfile = ctx.profile;
  document.getElementById('uName').textContent = ficheProfile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[ficheProfile.role] || ficheProfile.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (ficheProfile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  if (!playerId) { document.getElementById('ficheName').textContent = 'Joueur introuvable'; return; }

  const perfUrl = `player-performance.html?id=${playerId}`;
  for (const id of ['linkPerformance', 'physLink', 'careerLink']) document.getElementById(id).href = perfUrl;
  if (canManageVideos(ficheProfile.role)) {
    const v = document.getElementById('linkVideos');
    v.href = `videos.html?player=${playerId}`;
    v.classList.remove('hidden');
  }

  // select('*') : les colonnes d'identité et team_id n'existent qu'après
  // leurs migrations ; une liste explicite ferait échouer toute la fiche.
  const { data, error } = await sb.from('players').select('*').eq('id', playerId).maybeSingle();
  if (error || !data) {
    document.getElementById('ficheName').textContent = 'Joueur introuvable';
    if (error) toast(error.message, 'error');
    return;
  }
  fichePlayer = data;
  renderHeader();
  setupInfo();
  const staffCanPlan = canManagePlans(ficheProfile.role);
  document.querySelectorAll('.plans-only').forEach(b => b.classList.toggle('hidden', !staffCanPlan));
  document.getElementById('btnAddStrength').addEventListener('click', () => openNoteModal('strength'));
  document.getElementById('btnAddImprovement').addEventListener('click', () => openNoteModal('improvement'));
  document.getElementById('btnAddObjective').addEventListener('click', () => openNoteModal('objective'));
  document.getElementById('btnAddPrevention').addEventListener('click', () => openNoteModal('prevention'));
  document.getElementById('objAllLink').href = `comparaison.html?tab=objectifs&player=${fichePlayer.id}`;
  setupPhoto();
  await Promise.all([loadPhysical(), loadCareer(), loadPhoto(), initProgramEditor(fichePlayer, ficheProfile),
    initNotes({ player: fichePlayer, canEdit: staffCanPlan, userId: ficheProfile.id,
      lists: { objective: 'objectiveList', prevention: 'preventionList', strength: 'strengthList', improvement: 'improvementList' } })]);
})();

const fullName = (p) => `${p.prenom || ''} ${p.nom || ''}`.trim();
const fmtNum = (v, d) => v === null || v === undefined ? '—' : Number(v).toFixed(d).replace('.', ',');
const frDateShort = (iso) => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';

function ageFrom(iso) {
  if (!iso) return null;
  const b = new Date(`${String(iso).slice(0, 10)}T00:00:00`), now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
  return Number.isFinite(age) && age >= 0 && age < 100 ? age : null;
}

function renderHeader() {
  const p = fichePlayer;
  document.title = `LMFC Performance — ${fullName(p)}`;
  document.getElementById('ficheName').textContent = fullName(p);
  document.getElementById('ficheAvatar').textContent =
    (((p.prenom || p.nom || '')[0] || '') + ((p.nom || '')[0] || '')).toUpperCase() || '?';
  document.getElementById('ficheKicker').textContent =
    [ficheProfile.clubs?.nom || 'Le Mans FC', 'Fiche joueur'].join(' · ');
  // À côté du nom : taille — poids — poste. Une valeur absente n'apparaît pas.
  const line = lineOf(p);
  const { height_cm: h, weight_kg: w } = ficheLatest;
  const key = [
    num(h) !== null ? `${fmtNum(h / 100, 2)} m` : null,
    num(w) !== null ? `${fmtNum(w, 1)} kg` : null,
    p.poste || (line ? LINE_SINGULAR[line] : null),
  ].filter(Boolean);
  document.getElementById('ficheKey').innerHTML = key.map(f => `<span>${escapeHtml(f)}</span>`).join('');
  const age = ageFrom(p.date_naissance);
  const facts = [
    teamName(p.team_id) || null,
    p.poste && line ? LINE_SINGULAR[line] : null,
    age !== null ? `${age} ans` : null,
    p.pied_fort ? `Pied ${p.pied_fort === 'Les deux' ? 'droit et gauche' : p.pied_fort.toLowerCase()}` : null,
    p.statut,
  ].filter(Boolean);
  document.getElementById('ficheFacts').innerHTML = facts.map(f => `<span>${escapeHtml(f)}</span>`).join('');
  if (age !== null) document.getElementById('ficheFacts').title = `Né le ${frDateShort(p.date_naissance)}`;
}

async function loadPhoto() {
  if (!fichePlayer.photo_path) return;
  const { data } = await sb.storage.from('player-photos').createSignedUrl(fichePlayer.photo_path, 3600);
  if (data?.signedUrl) showPhoto(data.signedUrl);
}

function showPhoto(src) {
  const old = document.getElementById('ficheAvatar');
  old.replaceWith(el('img', { id: 'ficheAvatar', class: 'fiche-photo', src, alt: '' }));
}

/* Photo : un clic sur l'avatar pour l'ajouter ou la changer. */
function setupPhoto() {
  if (!canChangePlayerPhoto(ficheProfile.role)) return;
  const btn = document.getElementById('ficheAvatarBtn');
  const input = document.getElementById('fichePhotoFile');
  btn.disabled = false;
  btn.classList.add('is-editable');
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0]; input.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast('Photo trop volumineuse (5 Mo maximum).', 'error');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${fichePlayer.club_id}/${fichePlayer.id}/${Date.now()}.${ext}`;
    const up = await sb.storage.from('player-photos').upload(path, file, { contentType: file.type || 'image/jpeg' });
    if (up.error) return toast(up.error.message, 'error');
    const error = await savePlayerPhotoPath(fichePlayer.id, path);
    if (error) { await sb.storage.from('player-photos').remove([path]); return toast(error.message, 'error'); }
    const old = fichePlayer.photo_path;
    fichePlayer.photo_path = path;
    showPhoto(URL.createObjectURL(file));
    if (old) await sb.storage.from('player-photos').remove([old]);
    toast('Photo mise à jour', 'success');
  });
}

/* ---------- Informations : modifiables dans une fenêtre ---------- */
/* Champs réellement présents en base (une colonne absente n'est ni
   affichée ni envoyée), et Équipe seulement si le club en a. */
function availableFields() {
  return IDENTITY_FIELDS.filter(([k]) => k in fichePlayer
    && (k !== 'team_id' || (window.CLUB_TEAMS || []).length));
}

/* Suppression d'un joueur : sa fiche et tout ce qui en dépend (mesures,
   tests, vidéos, séquences, objectifs, programme, parcours, présences)
   partent ensemble dans la corbeille et reviennent ensemble. Sans la
   corbeille (lmfc_v5.sql non passée), on refuse : ce serait définitif. */
async function deletePlayer() {
  const name = `${fichePlayer.prenom || ''} ${fichePlayer.nom || ''}`.trim() || 'ce joueur';
  if (!(await trashReady())) {
    return toast('Activez d’abord la corbeille (supabase/lmfc_v5.sql) : la suppression d’un joueur doit rester récupérable.', 'error');
  }
  const account = fichePlayer.auth_user_id ? '\nSon compte joueur n’aura plus accès à son espace.' : '';
  if (!confirm(`Supprimer ${name} ?\n\nSa fiche part avec tout ce qui la concerne : mesures, tests, vidéos et séquences, objectifs et préventions, programme, parcours, présences.${account}\n\nRécupérable depuis la Corbeille.`)) return;
  const btn = document.getElementById('btnDeletePlayer');
  btn.disabled = true;
  try {
    const { data, error } = await sb.from('players').delete().eq('id', playerId).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Suppression réservée à l’administrateur du club.');
    toast(`${name} est dans la corbeille.`, 'success');
    setTimeout(() => { location.href = lastUrl('players') || 'players.html'; }, 600);
  } catch (e) {
    console.error('Suppression du joueur impossible', e);
    toast(e.message, 'error');
    btn.disabled = false;
  }
}

function setupInfo() {
  const form = document.getElementById('infoForm');
  const keys = availableFields().map(([k]) => k);
  for (const [k] of IDENTITY_FIELDS) {
    if (!keys.includes(k)) form[k]?.closest('label').classList.add('hidden');
  }
  if (keys.includes('team_id')) {
    document.getElementById('teamField').classList.remove('hidden');
    form.team_id.innerHTML = '<option value="">Sans équipe</option>'
      + window.CLUB_TEAMS.map(t => `<option value="${t.id}">${escapeHtml(t.nom)}</option>`).join('');
  }
  if (!canEdit(ficheProfile.role)) return;

  // Supprimer un joueur : administrateur seulement (RLS players_delete).
  if (ficheProfile.role === 'admin') {
    const del = document.getElementById('btnDeletePlayer');
    del.classList.remove('hidden');
    del.addEventListener('click', deletePlayer);
  }
  const edit = document.getElementById('btnEditInfo');
  edit.classList.remove('hidden');
  edit.addEventListener('click', () => {
    for (const k of keys) form[k].value = fichePlayer[k] ?? '';
    openModal('infoModal');
    setTimeout(() => form.prenom.focus(), 50);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    for (const k of keys) {
      const v = form[k].value.trim();
      body[k] = v === '' ? null : (k === 'team_id' ? Number(v) : v);
    }
    if (!body.nom) return toast('Le nom est obligatoire.', 'error');
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const { error } = await sb.from('players').update(body).eq('id', playerId);
      if (error) throw error;
      Object.assign(fichePlayer, body);
      renderHeader();
      closeModal('infoModal');
      toast('Fiche mise à jour', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; }
  });
}

/* ---------- Suivi physique (dernières mesures) ---------- */
async function loadPhysical() {
  const { data: ms, error: e1 } = await sb.from('player_physical_measurements').select('*').eq('player_id', playerId);
  renderPhysical(ms || [], e1);
}

function renderPhysical(rows, error) {
  const box = document.getElementById('physBox');
  if (error) { box.innerHTML = `<p class="text-danger">${escapeHtml(error.message)}</p>`; return; }
  const season = latestSeasonOf(rows);
  const scoped = rows.filter(r => !season || r.season_key === season)
    .sort((a, b) => (MONTHS.indexOf(a.month_label) - MONTHS.indexOf(b.month_label))
      || String(a.measured_at || '').localeCompare(String(b.measured_at || '')) || a.id - b.id);
  const last = (key) => scoped.filter(r => num(r[key]) !== null).at(-1);
  ficheLatest = { height_cm: last('height_cm')?.height_cm ?? null, weight_kg: last('weight_kg')?.weight_kg ?? null };
  renderHeader();
  box.innerHTML = `<div class="phys-grid">${MORPHO_METRICS.map(m => {
    const r = last(m.key);
    return `<div class="phys-cell"><span>${m.label}</span>
      <strong>${r ? `${fmtNum(r[m.key], m.digits)} ${m.unit}` : '—'}</strong>
      <small>${r ? escapeHtml(r.month_label) : '&nbsp;'}</small></div>`;
  }).join('')}</div>
  ${season ? `<p class="phys-season">Saison ${escapeHtml(season)}</p>` : ''}`;
}

/* ---------- Parcours (modifiable depuis la fiche Performance) ---------- */
async function loadCareer() {
  const box = document.getElementById('careerBox');
  const { data, error } = await sb.from('player_career').select('*').eq('player_id', playerId);
  if (error) {
    console.warn('Parcours indisponible :', error.message);
    box.innerHTML = '<p class="text-muted">Parcours indisponible.</p>';
    return;
  }
  const monthYear = (iso) => iso
    ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '';
  const list = (data || []).sort((a, b) => (a.date_fin ? 1 : 0) - (b.date_fin ? 1 : 0)
    || String(b.date_debut || '').localeCompare(String(a.date_debut || '')));
  box.innerHTML = list.length
    ? `<ul class="career-mini">${list.map(c => `<li class="${c.date_fin ? '' : 'is-current'}">
        <strong>${escapeHtml(c.club_name)}</strong>
        <span>${escapeHtml([c.categorie,
          c.date_debut ? `${monthYear(c.date_debut)} – ${c.date_fin ? monthYear(c.date_fin) : 'aujourd’hui'}` : null]
          .filter(Boolean).join(' · ') || '—')}</span>
      </li>`).join('')}</ul>`
    : '<p class="text-muted">Aucun club renseigné.</p>';
}

