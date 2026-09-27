/* FootSession Pro — player-performance-page.js
   Dossier individuel performance + radar + import Excel + médias. */

let ctxProfile = null;
let player = null;
let measurements = [];
let tests = [];
let notes = [];
let media = [];
let stage = 'pre';
let canEditPerformance = false;
let importState = { rows: null, fileName: '', mappings: {}, unresolved: [] };

const MONTHS = ['Août','Septembre','Octobre','Novembre','Décembre','Janvier','Février','Mars','Avril','Mai','Juin'];
const STAGES = [
  { key: 'pre', label: 'Pré-saison' },
  { key: 'mid', label: 'Mi-saison' },
  { key: 'end', label: 'Fin de saison' },
];
const SCORE_LABELS = [
  ['profile_start', 'Démarrage'],
  ['profile_agility', 'Agilité'],
  ['profile_speed', 'Vitesse'],
  ['profile_endurance', 'Endurance'],
  ['profile_core', 'Core'],
];

function esc(s) {
  return String(s ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function fmt(n, digits = 1) {
  return n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(digits).replace('.', ',');
}
function normalizeName(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function nameKeyOptions(value) {
  const n = normalizeName(value);
  const parts = n.split(' ').filter(Boolean);
  return [...new Set([n, parts.slice().reverse().join(' ')])];
}
function notify(message, type = 'info') {
  const el = document.getElementById('pageToast');
  if (!el) return;
  el.textContent = message;
  el.className = `perf-toast show ${type}`;
  clearTimeout(notify._timer);
  notify._timer = setTimeout(() => { el.className = 'perf-toast'; }, 3200);
}
function openPerfModal(id) {
  document.getElementById(id)?.classList.add('open');
}
function closePerfModal(id) {
  document.getElementById(id)?.classList.remove('open');
}
function latestMeasurement() {
  if (!measurements.length) return null;
  const rank = m => MONTHS.indexOf(m.month_label);
  return [...measurements].sort((a,b) => (rank(a.month_label) - rank(b.month_label)) || ((a.id||0) - (b.id||0))).at(-1);
}
function scoreValue(t, key) {
  const v = t?.[key];
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
}
function stageRows() {
  return tests.filter(t => t.stage === stage).sort((a,b) => (a.id||0) - (b.id||0));
}
function currentTest() {
  const rows = stageRows();
  return rows.length ? rows[rows.length - 1] : null;
}

function radarSvg(test) {
  const values = SCORE_LABELS.map(([key]) => scoreValue(test, key));
  const W = 420, H = 420, cx = 210, cy = 207, R = 135;
  const pts = values.map((v,i) => {
    const a = -Math.PI/2 + i * 2*Math.PI/5;
    const rr = R * ((v === null ? 0 : Math.max(0, Math.min(10,v))) / 10);
    return [cx + Math.cos(a)*rr, cy + Math.sin(a)*rr];
  });
  const outer = [];
  for (let i=0;i<5;i++) {
    const a = -Math.PI/2 + i * 2*Math.PI/5;
    outer.push([cx + Math.cos(a)*R, cy + Math.sin(a)*R]);
  }
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Radar performance">`;
  [2,4,6,8,10].forEach(level => {
    const p = [];
    for (let i=0;i<5;i++) {
      const a=-Math.PI/2+i*2*Math.PI/5, rr=R*level/10;
      p.push(`${cx+Math.cos(a)*rr},${cy+Math.sin(a)*rr}`);
    }
    svg += `<polygon points="${p.join(' ')}" fill="none" stroke="currentColor" opacity=".14"/>`;
    svg += `<text x="${cx+6}" y="${cy-R*level/10+4}" class="radar-scale">${level}</text>`;
  });
  outer.forEach(p => { svg += `<line x1="${cx}" y1="${cy}" x2="${p[0]}" y2="${p[1]}" stroke="currentColor" opacity=".16"/>`; });
  values.forEach((v,i) => {
    const a=-Math.PI/2+i*2*Math.PI/5;
    const x=cx+Math.cos(a)*(R+28), y=cy+Math.sin(a)*(R+28);
    svg += `<text x="${x}" y="${y}" class="radar-label" text-anchor="middle" dominant-baseline="middle">${esc(SCORE_LABELS[i][1])}</text>`;
  });
  const valid = pts.filter((_,i)=>values[i] !== null);
  if (valid.length >= 3) svg += `<polygon points="${pts.map(p=>p.join(',')).join(' ')}" class="radar-area"/>`;
  pts.forEach((p,i) => {
    if (values[i] !== null) svg += `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" class="radar-dot"/>`;
  });
  svg += `<circle cx="${cx}" cy="${cy}" r="3" class="radar-center"/>`;
  svg += `</svg>`;
  return svg;
}

function renderRadar() {
  const test = currentTest();
  const scores = SCORE_LABELS.map(([key,label]) => ({ key,label,value:scoreValue(test,key) }));
  document.getElementById('radarWrap').innerHTML = test
    ? `${radarSvg(test)}<div class="radar-caption">${esc(STAGES.find(s=>s.key===stage)?.label || '')}</div>`
    : `<div class="empty">Aucun test pour cette session.</div>`;
  document.getElementById('scoreCards').innerHTML = scores.map(s =>
    `<div class="score-card">
      <span>${esc(s.label)}</span>
      <strong>${s.value === null ? '—' : fmt(s.value,1)}<small>/10</small></strong>
    </div>`
  ).join('');
  renderTestSummary(test);
}

function renderTestSummary(test) {
  const box = document.getElementById('testSummary');
  if (!test) { box.innerHTML = ''; return; }
  const rows = [
    ['Sprint 10 m', test.sprint10_sec, 's'],
    ['505 moyenne', test.five05_avg_sec, 's'],
    ['Asymétrie 505', test.five05_asymmetry_pct, '%'],
    ['Sprint 40 m', test.sprint40_sec, 's'],
    ['30-15 VIFT', test.vift_kmh, 'km/h'],
    ['Shirado', test.shirado_sec, 's'],
    ['Sorensen', test.sorensen_sec, 's'],
    ['Ratio Shirado / Sorensen', test.core_ratio, ''],
  ];
  box.innerHTML = `<div class="test-values">${rows.map(([l,v,u]) =>
    `<div><span>${esc(l)}</span><strong>${fmt(v, u === 'km/h' ? 1 : 2)}${v !== null && v !== undefined && u ? ` ${u}` : ''}</strong></div>`
  ).join('')}</div>`;
}

function renderMeasurements() {
  const wrap = document.getElementById('measurementHistory');
  if (!measurements.length) {
    wrap.innerHTML = `<div class="empty">Aucune mesure enregistrée.</div>`;
    return;
  }
  const ordered = [...measurements].sort((a,b) => {
    const da=MONTHS.indexOf(a.month_label), db=MONTHS.indexOf(b.month_label);
    return da-db || ((a.id||0)-(b.id||0));
  });
  const latest = latestMeasurement();
  document.getElementById('metricHeight').textContent = latest?.height_cm != null ? `${fmt(latest.height_cm,0)} cm` : '—';
  document.getElementById('metricWeight').textContent = latest?.weight_kg != null ? `${fmt(latest.weight_kg,1)} kg` : '—';
  document.getElementById('metricBodyFat').textContent = latest?.body_fat_pct != null ? `${fmt(latest.body_fat_pct,1)} %` : '—';

  wrap.innerHTML = `<div class="measurement-table">
    <div class="measurement-row header"><span>Mois</span><span>Taille</span><span>Poids</span><span>MG</span></div>
    ${ordered.map(m => `<div class="measurement-row">
      <span>${esc(m.month_label || '—')}</span>
      <span>${m.height_cm != null ? `${fmt(m.height_cm,0)} cm` : '—'}</span>
      <span>${m.weight_kg != null ? `${fmt(m.weight_kg,1)} kg` : '—'}</span>
      <span>${m.body_fat_pct != null ? `${fmt(m.body_fat_pct,1)} %` : '—'}</span>
    </div>`).join('')}
  </div>`;
}

function renderNotes() {
  const renderList = (kind, id) => {
    const list = notes.filter(n => n.kind === kind).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0) || (a.id-b.id));
    document.getElementById(id).innerHTML = list.length
      ? list.map(n => {
          const imgs = media.filter(m => m.note_id === n.id);
          return `<article class="note-card">
            <div class="note-card-head">
              <span class="badge ${kind === 'strength' ? 'badge-success' : (kind === 'objective' ? 'badge-gold' : 'badge-gold')}">${kind === 'strength' ? 'Point fort' : (kind === 'objective' ? 'Objectif' : 'Amélioration')}</span>
              ${canEditPerformance ? `<button class="btn btn-sm btn-danger note-delete" type="button" data-note="${n.id}">Suppr.</button>` : ''}
            </div>
            <h3>${esc(n.title)}</h3>
            ${n.body ? `<p>${esc(n.body).replace(/\n/g,'<br>')}</p>` : ''}
            ${imgs.length ? `<div class="media-grid">${imgs.map(m => `<figure><img src="${esc(m.signed_url || '')}" alt="${esc(m.caption || '')}"><figcaption>${esc(m.caption || '')}</figcaption></figure>`).join('')}</div>` : ''}
          </article>`;
        }).join('')
      : `<div class="empty">Aucun ${kind === 'strength' ? 'point fort' : (kind === 'objective' ? 'objectif' : 'point d’amélioration')}.</div>`;
  };
  renderList('strength', 'strengthList');
  renderList('improvement', 'improvementList');
  renderList('objective', 'objectiveList');

  document.querySelectorAll('.note-delete').forEach(btn => btn.addEventListener('click', () => deleteNote(Number(btn.dataset.note))));
}

async function signMedia() {
  const signed = await Promise.all(media.map(async m => {
    const { data } = await sb.storage.from('player-performance-media').createSignedUrl(m.storage_path, 3600);
    return { ...m, signed_url: data?.signedUrl || '' };
  }));
  media = signed;
  renderNotes();
}

async function loadPage() {
  const ctx = await requireAuth();
  if (!ctx) return;
  ctxProfile = ctx.profile;

  const params = new URLSearchParams(location.search);
  let playerId = Number(params.get('id') || 0) || null;

  if (ctxProfile.role === 'joueur') {
    const { data: linked } = await sb.from('players')
      .select('id').eq('auth_user_id', ctx.user.id).maybeSingle();
    if (!linked) {
      window.location.href = 'player-join.html';
      return;
    }
    playerId = linked.id;
  }
  if (!playerId) {
    document.getElementById('playerName').textContent = 'Joueur introuvable';
    return;
  }

  canEditPerformance = ['admin','prepa'].includes(ctxProfile.role);
  document.getElementById('perfRoleLabel').textContent =
    ctxProfile.role === 'joueur' ? 'Espace joueur' : 'Staff · dossier individuel';
  document.querySelectorAll('.perf-editor-only').forEach(el => el.classList.toggle('hidden', !canEditPerformance));

  if (ctxProfile.role === 'joueur') {
    document.getElementById('backPlayers').classList.add('hidden');
    document.getElementById('videoPlayerLink').href = 'mes-videos.html';
    document.getElementById('videoPlayerLink').textContent = 'Mes vidéos';
  } else {
    document.getElementById('videoPlayerLink').href = `videos.html?player=${playerId}`;
  }

  const { data: p, error } = await sb.from('players')
    .select('id, nom, prenom, numero, poste, club_id, auth_user_id, photo_path')
    .eq('id', playerId).maybeSingle();
  if (error || !p) {
    document.getElementById('playerName').textContent = 'Joueur introuvable';
    return;
  }
  player = p;

  const [mRes, tRes, nRes, mediaRes] = await Promise.all([
    sb.from('player_physical_measurements').select('*').eq('player_id', player.id).order('id', {ascending:true}),
    sb.from('player_physical_tests').select('*').eq('player_id', player.id).order('id', {ascending:true}),
    sb.from('player_performance_notes').select('*').eq('player_id', player.id).order('sort_order').order('id'),
    sb.from('player_performance_media').select('*').eq('player_id', player.id).order('sort_order').order('id'),
  ]);
  if (mRes.error) notify(mRes.error.message,'error');
  measurements = mRes.data || [];
  tests = tRes.data || [];
  notes = nRes.data || [];
  media = mediaRes.data || [];

  const fullName = `${player.prenom || ''} ${player.nom || ''}`.trim();
  document.getElementById('playerName').textContent = fullName || 'Joueur';
  document.getElementById('playerMeta').textContent =
    `${player.poste || 'Poste non renseigné'}${player.numero != null ? ` · #${player.numero}` : ''}`;
  document.getElementById('playerInitials').textContent =
    ((player.prenom || player.nom || '?')[0] + (player.nom || '')[0] || '?').toUpperCase();

  if (player.photo_path) {
    const { data } = await sb.storage.from('player-photos').createSignedUrl(player.photo_path, 3600);
    if (data?.signedUrl) {
      document.getElementById('playerPhoto').src = data.signedUrl;
      document.getElementById('playerPhoto').classList.remove('hidden');
      document.getElementById('playerInitials').classList.add('hidden');
    }
  }

  const availableStages = STAGES.filter(s => tests.some(t => t.stage === s.key)).map(s=>s.key);
  stage = availableStages.includes('pre') ? 'pre' : (availableStages[0] || 'pre');
  document.getElementById('stageSelect').value = stage;

  renderMeasurements();
  renderRadar();
  await signMedia();
  renderNotes();
}

async function saveMeasurement() {
  const body = {
    club_id: player.club_id,
    player_id: player.id,
    measured_at: document.getElementById('m-date').value || null,
    month_label: document.getElementById('m-month').value,
    height_cm: num(document.getElementById('m-height').value),
    weight_kg: num(document.getElementById('m-weight').value),
    body_fat_pct: num(document.getElementById('m-fat').value),
    source: 'manual',
    created_by: ctxProfile.id,
  };
  if ([body.height_cm,body.weight_kg,body.body_fat_pct].every(v=>v===null)) return notify('Renseigne au moins une donnée physique.','error');
  const { error } = await sb.from('player_physical_measurements').insert(body);
  if (error) return notify(error.message,'error');
  notify('Mesure enregistrée.','success');
  document.getElementById('manualMeasurementBox').classList.add('hidden');
  await reloadData();
}

async function saveTest() {
  const body = {
    club_id: player.club_id,
    player_id: player.id,
    stage: document.getElementById('manualStage').value,
    tested_at: document.getElementById('manualTestDate').value || null,
    sprint10_sec: num(document.getElementById('t-sprint10').value),
    five05_left_sec: num(document.getElementById('t-505g').value),
    five05_right_sec: num(document.getElementById('t-505d').value),
    sprint40_sec: num(document.getElementById('t-sprint40').value),
    vift_kmh: num(document.getElementById('t-vift').value),
    shirado_sec: num(document.getElementById('t-shirado').value),
    sorensen_sec: num(document.getElementById('t-sorensen').value),
    source: 'manual',
    created_by: ctxProfile.id,
  };
  if (Object.entries(body).slice(4,11).every(([,v])=>v===null)) return notify('Renseigne au moins un test.','error');
  const { error } = await sb.from('player_physical_tests').upsert(body, { onConflict:'club_id,player_id,stage,source_file_name' });
  if (error) {
    const insertRes = await sb.from('player_physical_tests').insert(body);
    if (insertRes.error) return notify(insertRes.error.message,'error');
  }
  notify('Session de tests enregistrée.','success');
  await reloadData();
}

async function reloadData() {
  const [mRes, tRes, nRes, mediaRes, pRes] = await Promise.all([
    sb.from('player_physical_measurements').select('*').eq('player_id', player.id).order('id'),
    sb.from('player_physical_tests').select('*').eq('player_id', player.id).order('id'),
    sb.from('player_performance_notes').select('*').eq('player_id', player.id).order('sort_order').order('id'),
    sb.from('player_performance_media').select('*').eq('player_id', player.id).order('sort_order').order('id'),
    sb.from('players').select('photo_path').eq('id',player.id).single(),
  ]);
  measurements=mRes.data||[];
  tests=tRes.data||[];
  notes=nRes.data||[];
  media=mediaRes.data||[];
  if (pRes.data) player.photo_path=pRes.data.photo_path;
  const availableStages=STAGES.filter(s=>tests.some(t=>t.stage===s.key)).map(s=>s.key);
  if (!availableStages.includes(stage)) stage=availableStages[0]||'pre';
  document.getElementById('stageSelect').value=stage;
  renderMeasurements(); renderRadar();
  await signMedia(); renderNotes();
}

async function uploadPhoto(file) {
  if (!file || !canEditPerformance) return;
  if (file.size > 5 * 1024 * 1024) return notify('Photo trop volumineuse (max 5 Mo).','error');
  const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
  const path=`${player.club_id}/${player.id}/${Date.now()}.${ext}`;
  const { error: upErr } = await sb.storage.from('player-photos').upload(path,file,{contentType:file.type||'image/jpeg'});
  if (upErr) return notify(upErr.message,'error');
  const old=player.photo_path;
  const { error } = await sb.from('players').update({photo_path:path}).eq('id',player.id);
  if (error) {
    await sb.storage.from('player-photos').remove([path]);
    return notify(error.message,'error');
  }
  player.photo_path=path;
  const { data } = await sb.storage.from('player-photos').createSignedUrl(path,3600);
  if (data?.signedUrl) {
    document.getElementById('playerPhoto').src=data.signedUrl;
    document.getElementById('playerPhoto').classList.remove('hidden');
    document.getElementById('playerInitials').classList.add('hidden');
  }
  if (old) await sb.storage.from('player-photos').remove([old]);
  notify('Photo du joueur mise à jour.','success');
}

async function saveNote() {
  const kind=document.getElementById('noteKind').value;
  const title=document.getElementById('noteTitle').value.trim();
  const body=document.getElementById('noteBody').value.trim()||null;
  const files=[...document.getElementById('noteFiles').files];
  if (!title) return notify('Le titre est obligatoire.','error');
  if (files.some(f=>f.size>5*1024*1024)) return notify('Chaque image doit faire 5 Mo maximum.','error');

  const { data: note, error } = await sb.from('player_performance_notes').insert({
    club_id:player.club_id, player_id:player.id, kind, title, body, created_by:ctxProfile.id
  }).select().single();
  if (error) return notify(error.message,'error');

  for (const [index,file] of files.entries()) {
    const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
    const path=`${player.club_id}/${player.id}/${note.id}/${Date.now()}-${index}.${ext}`;
    const up=await sb.storage.from('player-performance-media').upload(path,file,{contentType:file.type||'image/jpeg'});
    if (up.error) {
      notify(`Note créée mais une image n’a pas été envoyée : ${up.error.message}`,'error');
      continue;
    }
    await sb.from('player_performance_media').insert({
      club_id:player.club_id, player_id:player.id, note_id:note.id,
      storage_path:path, caption:file.name, sort_order:index, created_by:ctxProfile.id
    });
  }
  closePerfModal('noteModal');
  document.getElementById('noteTitle').value='';
  document.getElementById('noteBody').value='';
  document.getElementById('noteFiles').value='';
  notify('Point enregistré.','success');
  await reloadData();
}

async function deleteNote(id) {
  if (!canEditPerformance || !confirm('Supprimer ce point et ses images ?')) return;
  const files=media.filter(m=>m.note_id===id).map(m=>m.storage_path);
  if (files.length) await sb.storage.from('player-performance-media').remove(files);
  const { error }=await sb.from('player_performance_notes').delete().eq('id',id);
  if (error) return notify(error.message,'error');
  notify('Point supprimé.','success');
  await reloadData();
}

function workbookRows(name) {
  const ws = importState.workbook?.Sheets?.[name];
  return ws ? XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: null
  }) : [];
}

function isAggregateName(name) {
  const k = normalizeName(name);
  return [
    'moyenne',
    'ecart type',
    'n joueurs testes'
  ].includes(k);
}

function rowMatchesPlayer(value) {
  if (!value || !player) return false;

  const firstName = normalizeName(player.prenom || '');
  const lastName = normalizeName(player.nom || '');

  if (!lastName) return false;

  const candidate = normalizeName(value);
  if (!candidate) return false;

  const parts = candidate.split(' ').filter(Boolean);

  return parts.includes(lastName) &&
    (!firstName || parts.includes(firstName) || parts.includes(lastName));
}

function findPlayerRow(rows) {
  if (!player) return null;

  const firstName = normalizeName(player.prenom || '');
  const lastName = normalizeName(player.nom || '');

  if (!lastName) return null;

  let surnameOnlyMatch = null;

  for (let r = 4; r < rows.length; r++) {
    const row = rows[r] || [];

    let hasLastName = false;
    let hasFirstName = false;
    let matchedText = '';

    for (const value of row) {
      if (value === null || value === undefined) continue;

      const text = String(value).trim();
      if (!text) continue;

      if (/^[+-]?\d+(?:[.,]\d+)?$/.test(text)) continue;
      if (isAggregateName(text)) continue;

      const normalized = normalizeName(text);
      const parts = normalized.split(' ').filter(Boolean);

      if (parts.includes(lastName)) {
        hasLastName = true;
        if (!matchedText) matchedText = text;
      }

      if (firstName && parts.includes(firstName)) {
        hasFirstName = true;
      }
    }

    if (!hasLastName) continue;

    if (hasFirstName) {
      return {
        index: r,
        name: matchedText || `${player.prenom || ''} ${player.nom || ''}`.trim()
      };
    }

    if (!surnameOnlyMatch) {
      surnameOnlyMatch = {
        index: r,
        name: matchedText || String(player.nom || '').trim()
      };
    }
  }

  return surnameOnlyMatch;
}

function findPlayerSheet(workbook) {
  if (!player) return null;

  const wantedLastName = normalizeName(player.nom || '')
    .replace(/[^a-z0-9]/g, '');

  if (!wantedLastName) return null;

  const sheetNames = workbook?.SheetNames || [];

  return sheetNames.find(sheetName => {
    const normalized = normalizeName(sheetName)
      .replace(/[^a-z0-9]/g, '');

    return normalized === wantedLastName;
  }) || null;
}

function parsePlayerSheet(workbook) {
  const sheetName = findPlayerSheet(workbook);

  if (!sheetName) return null;

  const rows = workbookRows(sheetName);

  const result = {
    sheetName,
    ratioByStage: {}
  };

  // Onglet individuel :
  // ligne 17 = Ratio Shirado / Sorensen
  // colonnes C/D/E = Pré-saison / Mi-saison / Fin de saison
  const ratioRow = rows[16] || [];

  STAGES.forEach((s, index) => {
    result.ratioByStage[s.key] = num(ratioRow[2 + index]);
  });

  return result;
}

function parseExcel(file, workbook) {
  const anth = workbookRows('Anthropométrie');
  const folds = workbookRows('Plis cutanés');
  const raw = workbookRows('Tests bruts');
  const profile = workbookRows('Profil sur 10');

  const anthMatch = findPlayerRow(anth);
  const foldsMatch = findPlayerRow(folds);
  const rawMatch = findPlayerRow(raw);
  const profileMatch = findPlayerRow(profile);

  const playerSheet = parsePlayerSheet(workbook);

  if (!anthMatch && !foldsMatch && !rawMatch && !profileMatch) {
    throw new Error(
      `Le joueur « ${`${player.prenom || ''} ${player.nom || ''}`.trim()} » n’a pas été trouvé dans cet Excel.`
    );
  }

  const measurementsRows = [];
  const testRows = [];

  /*
   * ============================================================
   * ANTHROPOMÉTRIE + PLIS CUTANÉS
   * ============================================================
   *
   * On lit UNIQUEMENT la ligne correspondant au joueur courant.
   *
   * Important :
   * - aucune masse grasse n'est recalculée ;
   * - si Excel contient une valeur => on l'importe ;
   * - si Excel est vide => on conserve null.
   */

  const anthRow = anthMatch ? (anth[anthMatch.index] || []) : [];
  const foldRow = foldsMatch ? (folds[foldsMatch.index] || []) : [];

  const age = num(foldRow[2]);

  MONTHS.forEach((month, mi) => {
    const height = num(anthRow[2 + mi]);
    const weight = num(anthRow[13 + mi]);
    const mgFromAnth = num(anthRow[24 + mi]);

    // Plis cutanés :
    // Août commence colonne D (index 3)
    // puis 6 colonnes par mois.
    const fs = 3 + mi * 6;

    const biceps = num(foldRow[fs]);
    const triceps = num(foldRow[fs + 1]);
    const subscapular = num(foldRow[fs + 2]);
    const suprailiac = num(foldRow[fs + 3]);
    const skinfoldSum = num(foldRow[fs + 4]);
    const mgFromFolds = num(foldRow[fs + 5]);

    // PRIORITÉ À LA VALEUR DÉJÀ PRÉSENTE DANS EXCEL.
    const bodyFat = mgFromAnth ?? mgFromFolds;

    if ([
      height,
      weight,
      bodyFat,
      biceps,
      triceps,
      subscapular,
      suprailiac,
      skinfoldSum
    ].some(v => v !== null)) {
      measurementsRows.push({
        name: anthMatch?.name || foldsMatch?.name || `${player.prenom || ''} ${player.nom || ''}`.trim(),
        month_label: month,
        age_at_measurement: age,
        height_cm: height,
        weight_kg: weight,
        body_fat_pct: bodyFat,
        biceps_mm: biceps,
        triceps_mm: triceps,
        subscapular_mm: subscapular,
        suprailiac_mm: suprailiac,
        skinfold_sum_4_mm: skinfoldSum
      });
    }
  });

  /*
   * ============================================================
   * TESTS BRUTS
   * ============================================================
   *
   * Les colonnes "505 moyenne" et "Asymétrie" sont déjà calculées
   * dans Excel : on les reprend directement.
   */

  const rawRow = rawMatch ? (raw[rawMatch.index] || []) : [];

  STAGES.forEach((s, si) => {
    const c = 2 + si * 9;

    const sprint10 = num(rawRow[c]);
    const five05Left = num(rawRow[c + 1]);
    const five05Right = num(rawRow[c + 2]);
    const five05Avg = num(rawRow[c + 3]);
    const five05Asym = num(rawRow[c + 4]);
    const sprint40 = num(rawRow[c + 5]);
    const vift = num(rawRow[c + 6]);
    const shirado = num(rawRow[c + 7]);
    const sorensen = num(rawRow[c + 8]);

    const ratio = playerSheet?.ratioByStage?.[s.key] ?? null;

    if ([
      sprint10,
      five05Left,
      five05Right,
      five05Avg,
      five05Asym,
      sprint40,
      vift,
      shirado,
      sorensen,
      ratio
    ].some(v => v !== null)) {
      testRows.push({
        name: rawMatch?.name || `${player.prenom || ''} ${player.nom || ''}`.trim(),
        stage: s.key,

        sprint10_sec: sprint10,
        five05_left_sec: five05Left,
        five05_right_sec: five05Right,
        five05_avg_sec: five05Avg,
        five05_asymmetry_pct: five05Asym,
        sprint40_sec: sprint40,
        vift_kmh: vift,
        shirado_sec: shirado,
        sorensen_sec: sorensen,
        core_ratio: ratio
      });
    }
  });

  /*
   * ============================================================
   * PROFIL /10
   * ============================================================
   *
   * Ces scores existent déjà dans "Profil sur 10".
   * On les importe tels quels pour alimenter le radar.
   */

  const profileRow = profileMatch ? (profile[profileMatch.index] || []) : [];

  STAGES.forEach((s, si) => {
    const c = 2 + si * 5;

    const profileStart = num(profileRow[c]);
    const profileAgility = num(profileRow[c + 1]);
    const profileSpeed = num(profileRow[c + 2]);
    const profileEndurance = num(profileRow[c + 3]);
    const profileCore = num(profileRow[c + 4]);

    const test = testRows.find(t => t.stage === s.key);

    const hasProfile = [
      profileStart,
      profileAgility,
      profileSpeed,
      profileEndurance,
      profileCore
    ].some(v => v !== null);

    if (hasProfile) {
      if (test) {
        test.profile_start = profileStart;
        test.profile_agility = profileAgility;
        test.profile_speed = profileSpeed;
        test.profile_endurance = profileEndurance;
        test.profile_core = profileCore;
      } else {
        testRows.push({
          name: profileMatch?.name || `${player.prenom || ''} ${player.nom || ''}`.trim(),
          stage: s.key,

          sprint10_sec: null,
          five05_left_sec: null,
          five05_right_sec: null,
          five05_avg_sec: null,
          five05_asymmetry_pct: null,
          sprint40_sec: null,
          vift_kmh: null,
          shirado_sec: null,
          sorensen_sec: null,
          core_ratio: null,

          profile_start: profileStart,
          profile_agility: profileAgility,
          profile_speed: profileSpeed,
          profile_endurance: profileEndurance,
          profile_core: profileCore
        });
      }
    }
  });

  return {
    fileName: file.name,
    sourceFile: file.name,

    targetPlayerId: player.id,

    targetName: `${player.prenom || ''} ${player.nom || ''}`.trim(),

    excelNames: [
      anthMatch?.name,
      foldsMatch?.name,
      rawMatch?.name,
      profileMatch?.name
    ].filter(Boolean),

    measurements: measurementsRows,
    tests: testRows,

    individualSheet: playerSheet?.sheetName || null
  };
}

function renderImportSummary(data) {
  importState.rows = data;
  importState.mappings = {
    [data.targetName]: player.id
  };
  importState.unresolved = [];

  const stagesWithTests = data.tests.filter(t =>
    [
      t.sprint10_sec,
      t.five05_left_sec,
      t.five05_right_sec,
      t.five05_avg_sec,
      t.five05_asymmetry_pct,
      t.sprint40_sec,
      t.vift_kmh,
      t.shirado_sec,
      t.sorensen_sec,
      t.profile_start,
      t.profile_agility,
      t.profile_speed,
      t.profile_endurance,
      t.profile_core
    ].some(v => v !== null)
  ).length;

  document.getElementById('importSummary').innerHTML = `
    <div>
      <strong>${data.measurements.length}</strong>
      mesures physiques détectées
    </div>

    <div>
      <strong>${stagesWithTests}</strong>
      sessions de tests détectées
    </div>

    <div>
      Joueur ciblé :
      <strong>${esc(data.targetName)}</strong>
    </div>
  `;

  const mapBox = document.getElementById('mappingBox');

  const excelNames = [...new Set(data.excelNames)];

  mapBox.innerHTML = `
    <div class="mapping-ok">
      <strong>Import ciblé sur ${esc(data.targetName)}</strong><br>
      Les données des autres joueurs de l'Excel ne seront pas importées.
      ${excelNames.length
        ? `<br><span class="text-muted">Nom(s) trouvé(s) dans Excel : ${excelNames.map(esc).join(' · ')}</span>`
        : ''
      }
      ${data.individualSheet
        ? `<br><span class="text-muted">Onglet individuel utilisé : ${esc(data.individualSheet)}</span>`
        : ''
      }
    </div>
  `;

  document.getElementById('btnConfirmImport').disabled =
    !data.measurements.length && !data.tests.length;
}

async function startExcelImport(file) {
  if (!file || !canEditPerformance) return;

  try {
    const buf = await file.arrayBuffer();

    const wbX = XLSX.read(buf, {
      type: 'array',
      cellDates: true
    });

    importState.workbook = wbX;

    const data = parseExcel(file, wbX);

    renderImportSummary(data);

  } catch (e) {
    document.getElementById('btnConfirmImport').disabled = true;

    notify(`Lecture Excel impossible : ${e.message}`, 'error');
  }
}

async function confirmExcelImport() {
  if (!importState.rows || !canEditPerformance) return;

  const {
    measurements: mRows,
    tests: tRows,
    fileName
  } = importState.rows;

  const source = fileName;
  const clubId = player.club_id;
  const userId = ctxProfile.id;

  const mPayload = mRows.map(r => ({
    club_id: clubId,
    player_id: player.id,
    month_label: r.month_label,

    season_key: source,
    age_at_measurement: r.age_at_measurement,

    height_cm: r.height_cm,
    weight_kg: r.weight_kg,
    body_fat_pct: r.body_fat_pct,

    biceps_mm: r.biceps_mm,
    triceps_mm: r.triceps_mm,
    subscapular_mm: r.subscapular_mm,
    suprailiac_mm: r.suprailiac_mm,
    skinfold_sum_4_mm: r.skinfold_sum_4_mm,

    source: 'import_excel',
    source_file_name: source,
    source_sheet: 'Anthropométrie + Plis cutanés',
    created_by: userId
  }));

  const tPayload = tRows.map(r => ({
    club_id: clubId,
    player_id: player.id,
    stage: r.stage,

    sprint10_sec: r.sprint10_sec,
    five05_left_sec: r.five05_left_sec,
    five05_right_sec: r.five05_right_sec,
    five05_avg_sec: r.five05_avg_sec,
    five05_asymmetry_pct: r.five05_asymmetry_pct,

    sprint40_sec: r.sprint40_sec,
    vift_kmh: r.vift_kmh,
    shirado_sec: r.shirado_sec,
    sorensen_sec: r.sorensen_sec,
    core_ratio: r.core_ratio,

    profile_start: r.profile_start ?? null,
    profile_agility: r.profile_agility ?? null,
    profile_speed: r.profile_speed ?? null,
    profile_endurance: r.profile_endurance ?? null,
    profile_core: r.profile_core ?? null,

    source: 'import_excel',
    source_file_name: source,
    source_sheet: 'Tests bruts + Profil sur 10',
    created_by: userId
  }));

  try {
    if (mPayload.length) {
      const mr = await sb
        .from('player_physical_measurements')
        .upsert(
          mPayload,
          {
            onConflict: 'club_id,player_id,month_label,source_file_name'
          }
        );

      if (mr.error) throw mr.error;
    }

    if (tPayload.length) {
      const tr = await sb
        .from('player_physical_tests')
        .upsert(
          tPayload,
          {
            onConflict: 'club_id,player_id,stage,source_file_name'
          }
        );

      if (tr.error) throw tr.error;
    }

    closePerfModal('importModal');

    notify(
      `Import terminé pour ${`${player.prenom || ''} ${player.nom || ''}`.trim()} : ${mPayload.length} mesures et ${tPayload.length} sessions de tests.`,
      'success'
    );

    importState = {
      rows: null,
      fileName: '',
      mappings: {},
      unresolved: []
    };

    document.getElementById('excelFile').value = '';

    await reloadData();

  } catch (e) {
    notify(`Import non effectué : ${e.message}`, 'error');
  }
}

document.querySelectorAll('[data-close]').forEach(btn=>{
  btn.addEventListener('click',()=>closePerfModal(btn.dataset.close));
});
document.getElementById('stageSelect').addEventListener('change',e=>{
  stage=e.target.value; renderRadar();
});
document.getElementById('btnAddMeasurement').addEventListener('click',()=>{
  document.getElementById('manualMeasurementBox').classList.toggle('hidden');
});
document.getElementById('btnSaveMeasurement').addEventListener('click',saveMeasurement);
document.getElementById('btnSaveTest').addEventListener('click',saveTest);
document.getElementById('btnAddStrength').addEventListener('click',()=>{
  document.getElementById('noteKind').value='strength';
  document.getElementById('noteModalTitle').textContent='Ajouter un point fort';
  openPerfModal('noteModal');
});
document.getElementById('btnAddImprovement').addEventListener('click',()=>{
  document.getElementById('noteKind').value='improvement';
  document.getElementById('noteModalTitle').textContent='Ajouter un point d’amélioration';
  openPerfModal('noteModal');
});
document.getElementById('btnAddObjective').addEventListener('click',()=>{
  document.getElementById('noteKind').value='objective';
  document.getElementById('noteModalTitle').textContent='Ajouter un objectif';
  openPerfModal('noteModal');
});
document.getElementById('btnSaveNote').addEventListener('click',saveNote);
document.getElementById('btnAddPhoto').addEventListener('click',()=>document.getElementById('photoFile').click());
document.getElementById('photoFile').addEventListener('change',e=>uploadPhoto(e.target.files[0]));
document.getElementById('btnImportExcel').addEventListener('click',()=>openPerfModal('importModal'));
document.getElementById('excelFile').addEventListener('change',e=>startExcelImport(e.target.files[0]));
document.getElementById('btnConfirmImport').addEventListener('click',confirmExcelImport);

loadPage()
  .then(() => initFmPerformanceUpgrade())
  .catch(e => console.error('FM performance upgrade:', e));

/* ============================================================
   FootSession Pro — upgrade visuel FM + sélection vidéos joueur
   ============================================================ */

let fpFmVideos = [];
let fpFmSelections = new Map();
let fpFmFilter = 'all';

function fpFmEnsureStyle() {
  if (document.querySelector('link[data-player-performance-fm]')) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'assets/css/player-performance-fm.css';
  link.dataset.playerPerformanceFm = '1';
  document.head.appendChild(link);
}

function fpFmCategory(video) {
  const text = normalizeName(`${video?.titre || ''} ${video?.description || ''}`);

  if (/(but|buts|goal|goals|finition|frappe|tir)/.test(text)) return 'buts';
  if (/(pass|passe|passes|assist|assistance)/.test(text)) return 'passes';
  if (/(defens|defense|tacle|intercept|duel|pressing)/.test(text)) return 'defense';
  return 'travail';
}

function fpFmCategoryLabel(key) {
  return {
    all: 'Toutes',
    buts: 'Buts',
    passes: 'Passes',
    defense: 'Actions défensives',
    travail: 'Séquences à travailler',
    selection: 'Ma sélection'
  }[key] || 'Toutes';
}

function fpFmDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('fr-FR');
  } catch {
    return '—';
  }
}

function fpFmDuration(sec) {
  const n = Number(sec || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return m ? `${m}:${String(s).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`;
}

function fpFmSelected(videoId) {
  return fpFmSelections.get(Number(videoId))?.selected === true;
}

function fpFmValidated(videoId) {
  return !!fpFmSelections.get(Number(videoId))?.validated_at &&
    fpFmSelections.get(Number(videoId))?.selected === true;
}

function fpFmCounts() {
  const counts = {
    all: fpFmVideos.length,
    buts: 0,
    passes: 0,
    defense: 0,
    travail: 0,
    selection: 0
  };

  fpFmVideos.forEach(video => {
    const cat = fpFmCategory(video);
    counts[cat] += 1;

    const isSelectedForPlayer =
      ctxProfile?.role === 'joueur'
        ? fpFmSelected(video.id)
        : fpFmValidated(video.id);

    if (isSelectedForPlayer) counts.selection += 1;
  });

  return counts;
}

function fpFmPositionPercent() {
  const poste = normalizeName(player?.poste || '');

  if (/gardien|goalkeeper/.test(poste)) return { x: 50, y: 88 };
  if (/defenseur|defensif|defenseur central|lateral/.test(poste)) return { x: 50, y: 70 };
  if (/milieu/.test(poste)) return { x: 50, y: 52 };
  if (/ailier|extreme/.test(poste)) return { x: 25, y: 38 };
  if (/attaquant|buteur/.test(poste)) return { x: 50, y: 20 };

  return { x: 50, y: 50 };
}

function fpFmBuildSidebar() {
  const dash = document.querySelector('.dash-grid');
  if (!dash || document.getElementById('fpFmShell')) return;

  const shell = document.createElement('div');
  shell.id = 'fpFmShell';
  shell.className = 'fp-fm-shell';

  const sidebar = document.createElement('aside');
  sidebar.className = 'fp-fm-sidebar';

  const fullName = `${player?.prenom || ''} ${player?.nom || ''}`.trim() || 'Joueur';
  const poste = player?.poste || 'Poste non renseigné';
  const number = player?.numero != null ? `#${player.numero}` : '—';
  const photo = document.getElementById('playerPhoto')?.src || '';
  const initials = document.getElementById('playerInitials')?.textContent || '??';
  const position = fpFmPositionPercent();

  sidebar.innerHTML = `
    <div class="fp-fm-side-player">
      ${
        photo && !photo.endsWith('/')
          ? `<img class="fp-fm-side-photo" src="${esc(photo)}" alt="${esc(fullName)}">`
          : `<div class="fp-fm-side-initials">${esc(initials)}</div>`
      }
      <div class="fp-fm-side-name">${esc(fullName)}</div>
      <div class="fp-fm-side-meta">${esc(poste)} · ${esc(number)}</div>
    </div>

    <div class="fp-fm-side-block">
      <div class="fp-fm-side-title">Poste</div>
      <div class="fp-mini-pitch">
        <span
          class="fp-mini-pitch-dot"
          style="left:${position.x}%;top:${position.y}%"
          aria-hidden="true"></span>
      </div>
      <div class="fp-fm-side-meta" style="margin-top:8px;text-align:center;">
        ${esc(poste)}
      </div>
    </div>

    <div class="fp-fm-side-block">
      <div class="fp-fm-side-title">Informations</div>
      <div class="fp-fm-info-row">
        <span>Numéro</span><strong>${esc(number)}</strong>
      </div>
      <div class="fp-fm-info-row">
        <span>Rôle</span><strong>${ctxProfile?.role === 'joueur' ? 'Joueur' : 'Staff'}</strong>
      </div>
      <div class="fp-fm-info-row">
        <span>Accès vidéos</span><strong>${fpFmVideos.length}</strong>
      </div>
    </div>

    <div class="fp-fm-side-block">
      <div class="fp-fm-side-title">Accès rapide</div>
      <div class="fp-fm-quick">
        <a href="#radarWrap">
          <span>Performance</span><strong>→</strong>
        </a>
        <a href="#fpVideoSelectionPanel">
          <span>Vidéos</span><strong>→</strong>
        </a>
        ${
          document.getElementById('videoPlayerLink')
            ? `<a href="${esc(document.getElementById('videoPlayerLink').href)}">
                 <span>Bibliothèque vidéos</span><strong>→</strong>
               </a>`
            : ''
        }
      </div>
    </div>
  `;

  dash.parentNode.insertBefore(shell, dash);
  shell.appendChild(sidebar);
  shell.appendChild(dash);
}

function fpFmEnhanceCards() {
  const radarCard = document.getElementById('radarWrap')?.closest('.card');
  const testCard = document.getElementById('testSummary')?.closest('.card');
  const measurementCard = document.getElementById('measurementHistory')?.closest('.card');

  radarCard?.classList.add('fp-fm-radar-card');
  testCard?.classList.add('fp-fm-tests-card');
  measurementCard?.classList.add('fp-fm-history-card');
}

async function fpFmLoadVideos() {
  if (!player?.id) return;

  const panel = document.getElementById('fpVideoSelectionPanel');
  if (panel) {
    panel.innerHTML = `<div class="fp-video-empty">Chargement des séquences…</div>`;
  }

  const [videoRes, selectionRes] = await Promise.all([
    sb.from('player_videos')
      .select('id,titre,description,storage_path,duree_sec,created_at')
      .eq('player_id', player.id)
      .order('created_at', { ascending: true }),

    sb.from('player_video_selections')
      .select('video_id,selected,validated_at,updated_at')
      .eq('player_id', player.id)
  ]);

  if (videoRes.error) {
    throw videoRes.error;
  }

  if (selectionRes.error) {
    if (panel) {
      panel.innerHTML = `
        <div class="fp-video-migration">
          Le système de sélection vidéo n'est pas encore activé côté Supabase.<br>
          Exécute <strong>supabase/player_video_selections.sql</strong> dans le SQL Editor Supabase.
        </div>
      `;
    }
    fpFmVideos = [];
    fpFmSelections = new Map();
    return;
  }

  const signedVideos = await Promise.all(
    (videoRes.data || []).map(async video => {
      const { data, error } =
        await sb.storage.from('player-videos').createSignedUrl(video.storage_path, 3600);

      return {
        ...video,
        category: fpFmCategory(video),
        signed_url: error ? '' : (data?.signedUrl || '')
      };
    })
  );

  fpFmVideos = signedVideos;
  fpFmSelections = new Map(
    (selectionRes.data || []).map(row => [Number(row.video_id), row])
  );

  fpFmRenderVideoPanel();
}

function fpFmMatchesFilter(video) {
  if (fpFmFilter === 'all') return true;

  if (fpFmFilter === 'selection') {
    return ctxProfile?.role === 'joueur'
      ? fpFmSelected(video.id)
      : fpFmValidated(video.id);
  }

  return fpFmCategory(video) === fpFmFilter;
}

function fpFmRenderVideoPanel() {
  const panel = document.getElementById('fpVideoSelectionPanel');
  if (!panel) return;

  const counts = fpFmCounts();
  const isPlayer = ctxProfile?.role === 'joueur';

  const selectedCount = fpFmVideos.filter(video =>
    isPlayer ? fpFmSelected(video.id) : fpFmValidated(video.id)
  ).length;

  const validatedCount = fpFmVideos.filter(video => fpFmValidated(video.id)).length;

  const buttons = [
    ['all', `Toutes (${counts.all})`],
    ['buts', `Buts (${counts.buts})`],
    ['passes', `Passes (${counts.passes})`],
    ['defense', `Actions défensives (${counts.defense})`],
    ['travail', `Séquences à travailler (${counts.travail})`],
    ['selection', `${isPlayer ? 'Ma sélection' : 'Sélection joueur'} (${counts.selection})`]
  ];

  const filtered = fpFmVideos.filter(fpFmMatchesFilter);

  panel.innerHTML = `
    <div class="fp-video-head">
      <div class="fp-video-title">
        <h2>Vidéos du joueur</h2>
        <p>
          ${
            isPlayer
              ? 'Sélectionne les séquences que tu souhaites travailler avec ton staff.'
              : 'Séquences mises à disposition et choix validés par le joueur.'
          }
        </p>
      </div>

      <div class="fp-video-actions">
        <div class="fp-video-status">
          ${isPlayer
            ? `${selectedCount} sélectionnée${selectedCount > 1 ? 's' : ''}`
            : `${validatedCount} validée${validatedCount > 1 ? 's' : ''} par le joueur`}
        </div>

        ${
          isPlayer
            ? `<button
                 id="fpValidateVideoSelection"
                 class="fp-video-validate"
                 type="button"
                 ${selectedCount ? '' : 'disabled'}>
                 Valider ma sélection (${selectedCount})
               </button>`
            : ''
        }
      </div>
    </div>

    <div class="fp-video-filters">
      ${buttons.map(([key, label]) => `
        <button
          type="button"
          class="fp-filter-btn ${fpFmFilter === key ? 'active' : ''}"
          data-fp-video-filter="${key}">
          ${esc(label)}
        </button>
      `).join('')}
    </div>

    ${
      filtered.length
        ? `<div class="fp-video-grid">
            ${filtered.map((video, index) => {
              const selected = fpFmSelected(video.id);
              const validated = fpFmValidated(video.id);
              const catLabel = fpFmCategoryLabel(fpFmCategory(video));

              return `
                <article class="fp-video-card ${selected && isPlayer ? 'selected' : ''} ${validated ? 'validated' : ''}">
                  ${
                    isPlayer
                      ? `<label class="fp-video-check" title="Sélectionner cette vidéo">
                           <input
                             type="checkbox"
                             class="fp-video-checkbox"
                             data-video-id="${video.id}"
                             ${selected ? 'checked' : ''}>
                         </label>`
                      : validated
                        ? `<div class="fp-video-selected-badge">✓ SÉLECTIONNÉE</div>`
                        : ''
                  }

                  <div class="fp-video-media">
                    ${
                      video.signed_url
                        ? `<video
                             preload="metadata"
                             muted
                             playsinline
                             src="${esc(video.signed_url)}">
                           </video>`
                        : `<div class="fp-video-empty" style="height:100%;display:grid;place-items:center;">
                             Vidéo indisponible
                           </div>`
                    }

                    ${
                      video.signed_url
                        ? `<button
                             type="button"
                             class="fp-video-play"
                             data-video-play="${video.id}"
                             aria-label="Lire la vidéo">▶</button>`
                        : ''
                    }

                    ${
                      video.duree_sec
                        ? `<span class="fp-video-duration">${fpFmDuration(video.duree_sec)}</span>`
                        : ''
                    }
                  </div>

                  <div class="fp-video-body">
                    <h3>#${index + 1} · ${esc(video.titre || 'Séquence')}</h3>
                    <div class="fp-video-meta">
                      <span>${esc(catLabel)}</span>
                      <span>${esc(fpFmDate(video.created_at))}</span>
                    </div>

                    ${
                      !isPlayer && validated
                        ? `<div class="fp-video-staff-selected">
                             À travailler en séance
                           </div>`
                        : ''
                    }
                  </div>
                </article>
              `;
            }).join('')}
          </div>`
        : `<div class="fp-video-empty">
             Aucune vidéo dans cette catégorie.
           </div>`
    }
  `;

  panel.querySelectorAll('[data-fp-video-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      fpFmFilter = btn.dataset.fpVideoFilter || 'all';
      fpFmRenderVideoPanel();
    });
  });

  panel.querySelectorAll('.fp-video-checkbox').forEach(input => {
    input.addEventListener('change', async event => {
      event.stopPropagation();
      await fpFmSetSelection(
        Number(input.dataset.videoId),
        input.checked
      );
    });
  });

  panel.querySelectorAll('[data-video-play]').forEach(button => {
    button.addEventListener('click', () => {
      const card = button.closest('.fp-video-card');
      const video = card?.querySelector('video');
      if (!video) return;

      if (video.paused) {
        panel.querySelectorAll('video').forEach(v => {
          if (v !== video) v.pause();
        });
        video.play().catch(() => {});
        button.textContent = '❚❚';
      } else {
        video.pause();
        button.textContent = '▶';
      }
    });
  });

  const validate = document.getElementById('fpValidateVideoSelection');
  if (validate) {
    validate.addEventListener('click', fpFmValidateSelection);
  }
}

async function fpFmSetSelection(videoId, selected) {
  const video = fpFmVideos.find(v => Number(v.id) === Number(videoId));
  if (!video || !player?.id || ctxProfile?.role !== 'joueur') return;

  const previous = fpFmSelections.get(Number(videoId));

  fpFmSelections.set(Number(videoId), {
    ...(previous || {}),
    video_id: videoId,
    selected,
    validated_at: null
  });

  fpFmRenderVideoPanel();

  const { data: userData } = await sb.auth.getUser();

  const payload = {
    club_id: player.club_id,
    player_id: player.id,
    video_id: videoId,
    selected,
    validated_at: null,
    updated_at: new Date().toISOString()
  };

  const { data, error } =
    await sb.from('player_video_selections')
      .upsert(payload, { onConflict: 'player_id,video_id' })
      .select('video_id,selected,validated_at,updated_at')
      .single();

  if (error) {
    if (previous) {
      fpFmSelections.set(Number(videoId), previous);
    } else {
      fpFmSelections.delete(Number(videoId));
    }

    fpFmRenderVideoPanel();
    notify(error.message, 'error');
    return;
  }

  if (data) {
    fpFmSelections.set(Number(videoId), data);
    fpFmRenderVideoPanel();
  }

  void userData;
}

async function fpFmValidateSelection() {
  if (ctxProfile?.role !== 'joueur' || !player?.id) return;

  const selectedVideos = fpFmVideos.filter(video => fpFmSelected(video.id));

  if (!selectedVideos.length) {
    notify('Sélectionne au moins une vidéo.', 'error');
    return;
  }

  const validatedAt = new Date().toISOString();

  const payload = fpFmVideos.map(video => ({
    club_id: player.club_id,
    player_id: player.id,
    video_id: video.id,
    selected: fpFmSelected(video.id),
    validated_at: fpFmSelected(video.id) ? validatedAt : null,
    updated_at: validatedAt
  }));

  const { error } =
    await sb.from('player_video_selections')
      .upsert(payload, { onConflict: 'player_id,video_id' });

  if (error) {
    notify(error.message, 'error');
    return;
  }

  payload.forEach(row => {
    fpFmSelections.set(Number(row.video_id), row);
  });

  notify(
    `${selectedVideos.length} séquence${selectedVideos.length > 1 ? 's' : ''} envoyée${selectedVideos.length > 1 ? 's' : ''} au staff.`,
    'success'
  );

  fpFmRenderVideoPanel();
}

function fpFmMountVideoPanel() {
  if (document.getElementById('fpVideoSelectionPanel')) return;

  const panel = document.createElement('section');
  panel.id = 'fpVideoSelectionPanel';
  panel.className = 'card fp-video-panel';

  const anchor =
    document.getElementById('strengthList')?.closest('.card') ||
    document.getElementById('improvementList')?.closest('.card') ||
    document.querySelector('.main .card:last-of-type');

  if (anchor?.parentNode) {
    anchor.parentNode.insertBefore(panel, anchor);
  } else {
    const root = document.querySelector('.main') || document.querySelector('main') || document.body;
    root.appendChild(panel);
  }

  panel.innerHTML = `<div class="fp-video-empty">Chargement des vidéos…</div>`;
}

async function initFmPerformanceUpgrade() {
  fpFmEnsureStyle();
  document.body.classList.add('fp-fm-page');

  fpFmBuildSidebar();
  fpFmEnhanceCards();
  fpFmMountVideoPanel();

  try {
    await fpFmLoadVideos();

    const sideCount =
      document.querySelector('.fp-fm-sidebar .fp-fm-side-block:nth-of-type(3) .fp-fm-info-row:last-child strong');

    if (sideCount) sideCount.textContent = String(fpFmVideos.length);
  } catch (error) {
    const panel = document.getElementById('fpVideoSelectionPanel');

    if (panel) {
      panel.innerHTML = `
        <div class="fp-video-empty">
          Impossible de charger les vidéos pour le moment.
          <br><span style="font-size:.72rem;">${esc(error?.message || 'Erreur inconnue')}</span>
        </div>
      `;
    }

    console.error('fpFmLoadVideos:', error);
  }
}
