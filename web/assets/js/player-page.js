/* ============================================================
   FootSession Pro — player-page.js (fiche joueur)
   Point central d'un joueur côté staff : identité (modifiable),
   derniers relevés physiques, profil /10 et parcours,
   avec des accès vers Performance et Vidéos.
   Réservée au staff (nav.js) ; la RLS ne renvoie de toute façon
   que les joueurs du club de l'utilisateur.
   ============================================================ */

const playerId = Number(new URLSearchParams(location.search).get('id'));
let ficheProfile = null;
let fichePlayer = null;

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
  await Promise.all([loadPhysical(), loadCareer(), loadPhoto(), initProgramEditor(fichePlayer, ficheProfile)]);
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
  document.title = `FootSession Pro — ${fullName(p)}`;
  document.getElementById('ficheName').textContent = fullName(p);
  document.getElementById('ficheAvatar').textContent =
    (((p.prenom || p.nom || '')[0] || '') + ((p.nom || '')[0] || '')).toUpperCase() || '?';
  const line = lineOf(p);
  document.getElementById('ficheSub').textContent =
    [p.poste || (line ? LINE_SINGULAR[line] : null), teamName(p.team_id)].filter(Boolean).join(' · ');
  const age = ageFrom(p.date_naissance);
  const facts = [
    age !== null ? `${age} ans` : null,
    p.pied_fort ? `Pied ${p.pied_fort === 'Les deux' ? 'droit et gauche' : p.pied_fort.toLowerCase()}` : null,
    p.statut,
  ].filter(Boolean);
  document.getElementById('ficheFacts').innerHTML = facts.map(f => `<span>${escapeHtml(f)}</span>`).join('');
}

async function loadPhoto() {
  if (!fichePlayer.photo_path) return;
  const { data } = await sb.storage.from('player-photos').createSignedUrl(fichePlayer.photo_path, 3600);
  if (!data?.signedUrl) return;
  document.getElementById('ficheAvatar').replaceWith(el('img', { class: 'fiche-photo', src: data.signedUrl, alt: '' }));
}

/* ---------- Informations : lecture, puis édition sur demande ---------- */
/* Champs réellement présents en base (une colonne absente n'est ni
   affichée ni envoyée), et Équipe seulement si le club en a. */
function availableFields() {
  return IDENTITY_FIELDS.filter(([k]) => k in fichePlayer
    && (k !== 'team_id' || (window.CLUB_TEAMS || []).length));
}

function displayValue(key, v) {
  if (key === 'ligne') {
    const l = lineOf(fichePlayer);
    return l ? `${LINE_SINGULAR[l]}${v ? '' : ' (selon le poste)'}` : '—';
  }
  if (v === null || v === undefined || v === '') return '—';
  if (key === 'team_id') return teamName(v) || '—';
  if (key === 'date_naissance') { const a = ageFrom(v); return `${frDateShort(v)}${a !== null ? ` (${a} ans)` : ''}`; }
  return String(v);
}

function renderInfoView() {
  document.getElementById('infoView').innerHTML = availableFields()
    .map(([k, label]) => `<dt>${label}</dt><dd>${escapeHtml(displayValue(k, fichePlayer[k]))}</dd>`).join('');
}

function setupInfo() {
  renderInfoView();
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

  const edit = document.getElementById('btnEditInfo');
  edit.classList.remove('hidden');
  const toggle = (editing) => {
    form.classList.toggle('hidden', !editing);
    document.getElementById('infoView').classList.toggle('hidden', editing);
    edit.classList.toggle('hidden', editing);
  };
  edit.addEventListener('click', () => {
    for (const k of keys) form[k].value = fichePlayer[k] ?? '';
    toggle(true);
    form.prenom.focus();
  });
  document.getElementById('btnCancelInfo').addEventListener('click', () => toggle(false));
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
      renderInfoView();
      toggle(false);
      toast('Fiche mise à jour', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; }
  });
}

/* ---------- Suivi physique + profil /10 ---------- */
async function loadPhysical() {
  const [{ data: ms, error: e1 }, { data: ts, error: e2 }] = await Promise.all([
    sb.from('player_physical_measurements').select('*').eq('player_id', playerId),
    sb.from('player_physical_tests').select('*').eq('player_id', playerId),
  ]);
  renderPhysical(ms || [], e1);
  renderProfile(ts || [], e2);
}

function renderPhysical(rows, error) {
  const box = document.getElementById('physBox');
  if (error) { box.innerHTML = `<p class="text-danger">${escapeHtml(error.message)}</p>`; return; }
  const season = latestSeasonOf(rows);
  const scoped = rows.filter(r => !season || r.season_key === season)
    .sort((a, b) => (MONTHS.indexOf(a.month_label) - MONTHS.indexOf(b.month_label))
      || String(a.measured_at || '').localeCompare(String(b.measured_at || '')) || a.id - b.id);
  const last = (key) => scoped.filter(r => num(r[key]) !== null).at(-1);
  box.innerHTML = `<div class="phys-grid">${MORPHO_METRICS.map(m => {
    const r = last(m.key);
    return `<div class="phys-cell"><span>${m.label}</span>
      <strong>${r ? `${fmtNum(r[m.key], m.digits)} ${m.unit}` : '—'}</strong>
      <small>${r ? escapeHtml(r.month_label) : '&nbsp;'}</small></div>`;
  }).join('')}</div>
  ${season ? `<p class="phys-season">Saison ${escapeHtml(season)}</p>` : ''}`;
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
  if (!test) { box.innerHTML = '<p class="text-muted">Aucune note sur 10 pour l’instant.</p>'; return; }
  document.getElementById('profileWhen').textContent =
    `${STAGES.find(s => s.key === test.stage)?.label || ''}${season ? ' · ' + season : ''}`;
  box.innerHTML = `<div class="score-bars">${SCORE_AXES.map(a => {
    const v = num(test[a.key]);
    return `<div class="score-bar"><span>${a.label}</span>
      <span class="track"><span class="fill" style="width:${v === null ? 0 : Math.max(0, Math.min(10, v)) * 10}%"></span></span>
      <strong>${v === null ? '—' : fmtNum(v, 1)}</strong></div>`;
  }).join('')}</div>`;
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
