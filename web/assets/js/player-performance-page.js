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
  return ws ? XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null}) : [];
}
function isAggregateName(name) {
  const k = normalizeName(name);
  return k === 'moyenne' || k === 'ecart type' || k === 'n joueurs testes' || k === 'n joueurs testes';
}
function parseExcel(file, workbook) {
  const anth=workbookRows('Anthropométrie');
  const folds=workbookRows('Plis cutanés');
  const raw=workbookRows('Tests bruts');
  const measurementsRows=[];
  const testRows=[];
  const playersFound=new Set();

  const rowCount=Math.max(anth.length,folds.length,raw.length);
  for(let r=4;r<rowCount;r++){
    const name=anth[r]?.[1] || folds[r]?.[1] || raw[r]?.[1];
    if(name && !isAggregateName(name)) playersFound.add(String(name));
  }
  for(let r=4;r<rowCount;r++){
    const name=String(anth[r]?.[1] || folds[r]?.[1] || raw[r]?.[1] || '').trim();
    if(!name || isAggregateName(name)) continue;
    const age=num(folds[r]?.[2]);
    const anthRow=anth[r]||[], foldRow=folds[r]||[];
    MONTHS.forEach((month,mi)=>{
      const h=num(anthRow[2+mi]), w=num(anthRow[13+mi]), mgFromAnth=num(anthRow[24+mi]);
      const fs=3+mi*6;
      const b=num(foldRow[fs]), tr=num(foldRow[fs+1]), ss=num(foldRow[fs+2]), si=num(foldRow[fs+3]);
      const sum = num(foldRow[fs+4]) ?? ([b,tr,ss,si].every(v=>v!==null)?b+tr+ss+si:null);
      let mg=mgFromAnth ?? num(foldRow[fs+5]);
      if(mg===null && age!==null && sum!==null && sum>0){
        const d = age >= 20 ? 1.1631 - 0.0632 * Math.log10(sum) : 1.1620 - 0.0630 * Math.log10(sum);
        mg = (495/d)-450;
      }
      if([h,w,mg,b,tr,ss,si,sum].some(v=>v!==null)){
        measurementsRows.push({
          name,month_label:month,age_at_measurement:age,height_cm:h,weight_kg:w,body_fat_pct:mg,
          biceps_mm:b,triceps_mm:tr,subscapular_mm:ss,suprailiac_mm:si,skinfold_sum_4_mm:sum
        });
      }
    });

    const rr=raw[r]||[];
    STAGES.forEach((s,si)=>{
      const c=2+si*9;
      const vals=[
        num(rr[c]),num(rr[c+1]),num(rr[c+2]),num(rr[c+5]),num(rr[c+6]),num(rr[c+7]),num(rr[c+8])
      ];
      if(!vals.some(v=>v!==null)) return;
      const fiveG=vals[1], fiveD=vals[2];
      const avg = fiveG!==null && fiveD!==null ? (fiveG+fiveD)/2 : null;
      const asym = fiveG!==null && fiveD!==null && Math.max(fiveG,fiveD)>0
        ? Math.abs(fiveG-fiveD)/Math.max(fiveG,fiveD)*100 : null;
      const shir=vals[5], sor=vals[6];
      testRows.push({
        name, stage:s.key,
        sprint10_sec:vals[0], five05_left_sec:fiveG, five05_right_sec:fiveD,
        five05_avg_sec:avg, five05_asymmetry_pct:asym,
        sprint40_sec:vals[3], vift_kmh:vals[4],
        shirado_sec:shir, sorensen_sec:sor,
        core_ratio:shir!==null && sor!==null && sor>0 ? shir/sor : null
      });
    });
  }
  return {
    fileName:file.name,
    sourceFile:file.name,
    measurements:measurementsRows,
    tests:testRows,
    names:[...playersFound]
  };
}

function resolvePlayer(name, roster) {
  const keys=nameKeyOptions(name);
  return roster.find(p => {
    const opts=nameKeyOptions(`${p.prenom||''} ${p.nom||''}`);
    return keys.some(k=>opts.includes(k));
  }) || null;
}
function renderImportSummary(data, roster) {
  importState.rows=data;
  const mappings={};
  const unresolved=[];
  data.names.forEach(name=>{
    const found=resolvePlayer(name,roster);
    if(found) mappings[name]=found.id; else unresolved.push(name);
  });
  importState.mappings=mappings;
  importState.unresolved=unresolved;
  document.getElementById('importSummary').innerHTML = `
    <div><strong>${data.measurements.length}</strong> mesures physiques détectées</div>
    <div><strong>${data.tests.length}</strong> sessions de tests détectées</div>
    <div><strong>${data.names.length}</strong> joueurs détectés · <strong>${unresolved.length}</strong> correspondance(s) à confirmer</div>`;
  const mapBox=document.getElementById('mappingBox');
  if(!unresolved.length){
    mapBox.innerHTML='<div class="mapping-ok">Toutes les correspondances joueurs ont été trouvées automatiquement.</div>';
    document.getElementById('btnConfirmImport').disabled=false;
    return;
  }
  mapBox.innerHTML = unresolved.map((name,i)=>`
    <div class="mapping-row">
      <span>${esc(name)}</span>
      <select data-map-name="${esc(name)}">
        <option value="">— Choisir la fiche —</option>
        ${roster.map(p=>`<option value="${p.id}">${esc(`${p.prenom||''} ${p.nom||''}`.trim())}${p.numero!=null?` #${p.numero}`:''}</option>`).join('')}
      </select>
    </div>`).join('');
  mapBox.querySelectorAll('select').forEach(sel=>sel.addEventListener('change',e=>{
    importState.mappings[e.target.dataset.mapName]=Number(e.target.value)||null;
    const allResolved=importState.unresolved.every(n=>importState.mappings[n]);
    document.getElementById('btnConfirmImport').disabled=!allResolved;
  }));
  document.getElementById('btnConfirmImport').disabled=true;
}

async function startExcelImport(file) {
  if(!file || !canEditPerformance) return;
  try{
    const buf=await file.arrayBuffer();
    const wbX=XLSX.read(buf,{type:'array',cellDates:true});
    importState.workbook=wbX;
    const data=parseExcel(file,wbX);
    const {data:roster,error}=await sb.from('players').select('id,nom,prenom,numero').order('nom');
    if(error) throw error;
    renderImportSummary(data,roster||[]);
  }catch(e){
    notify(`Lecture Excel impossible : ${e.message}`,'error');
  }
}

async function confirmExcelImport() {
  if(!importState.rows || !canEditPerformance) return;
  const {measurements:mRows,tests:tRows,fileName}=importState.rows;
  const source=fileName;
  const clubId=player.club_id;
  const userId=ctxProfile.id;

  const mPayload=mRows.map(r=>({
    club_id:clubId,player_id:importState.mappings[r.name],month_label:r.month_label,
    season_key:source,age_at_measurement:r.age_at_measurement,height_cm:r.height_cm,
    weight_kg:r.weight_kg,body_fat_pct:r.body_fat_pct,biceps_mm:r.biceps_mm,
    triceps_mm:r.triceps_mm,subscapular_mm:r.subscapular_mm,suprailiac_mm:r.suprailiac_mm,
    skinfold_sum_4_mm:r.skinfold_sum_4_mm,source:'import_excel',source_file_name:source,
    source_sheet:'Anthropométrie + Plis cutanés',created_by:userId
  })).filter(r=>r.player_id);
  const tPayload=tRows.map(r=>({
    club_id:clubId,player_id:importState.mappings[r.name],stage:r.stage,
    sprint10_sec:r.sprint10_sec,five05_left_sec:r.five05_left_sec,five05_right_sec:r.five05_right_sec,
    five05_avg_sec:r.five05_avg_sec,five05_asymmetry_pct:r.five05_asymmetry_pct,
    sprint40_sec:r.sprint40_sec,vift_kmh:r.vift_kmh,shirado_sec:r.shirado_sec,sorensen_sec:r.sorensen_sec,
    core_ratio:r.core_ratio,source:'import_excel',source_file_name:source,
    source_sheet:'Tests bruts',created_by:userId
  })).filter(r=>r.player_id);

  try{
    if(mPayload.length){
      const mr=await sb.from('player_physical_measurements').upsert(mPayload,{onConflict:'club_id,player_id,month_label,source_file_name'});
      if(mr.error) throw mr.error;
    }
    if(tPayload.length){
      const tr=await sb.from('player_physical_tests').upsert(tPayload,{onConflict:'club_id,player_id,stage,source_file_name'});
      if(tr.error) throw tr.error;
    }
    closePerfModal('importModal');
    notify(`Import terminé : ${mPayload.length} mesures et ${tPayload.length} sessions de tests. Le radar a été recalculé.`, 'success');
    importState={rows:null,fileName:'',mappings:{},unresolved:[]};
    document.getElementById('excelFile').value='';
    await reloadData();
  }catch(e){
    notify(`Import non effectué : ${e.message}`,'error');
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

loadPage();
