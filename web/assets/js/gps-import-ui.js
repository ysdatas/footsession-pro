/* ============================================================
   LMFC Performance — gps-import-ui.js (comparaison.html, onglet GPS)
   « Importer des données GPS » : fichier → date, équipe, séance →
   Analyser (gps-import.js) → aperçu → Valider (gps_import_save, une
   transaction, lmfc_v32.sql).
     - le même fichier (empreinte SHA-256) n'est importé qu'une fois ;
     - un joueur déjà mesuré ce jour-là par un autre import est signalé ;
     - un nom seul ou incertain n'est jamais attribué sans le staff ;
       les associations validées sont mémorisées (gps_player_aliases) ;
     - une colonne inconnue n'est gardée que cochée, sous son nom.
   Dépend de gps-import.js, gps-page.js (GPS, render), comparaison-page.js
   (myProfile), app.js (loadLib), perf-metrics.js (normalizeName).
   ============================================================ */

const GI = { file: null, hash: '', rows: null, a: null, match: [], club: null, aliases: new Map(), dup: null, overlap: [] };
const GI_ST = { alias: ['Reconnu (déjà validé)', 'is-new'], ok: ['Reconnu', 'is-new'], confirm: ['À confirmer', 'is-warn'], choose: ['À choisir', 'is-warn'], none: ['Non reconnu', ''] };
const giEl = (id) => document.getElementById(id);

function openGpsImport() {
  if (!giEl('gpsImportModal')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="gpsImportModal"><div class="modal gps-modal" role="dialog" aria-modal="true" aria-labelledby="giTitle">
      <h2 class="as-h3" id="giTitle">Importer des données GPS</h2>
      <p class="gps-help">L’export de la séance (Catapult : CSV ou Excel). Rien n’est enregistré avant « Valider l’import ».</p>
      <div class="field"><label for="giFile">Fichier</label><input id="giFile" type="file" accept=".csv,.txt,.xlsx,.xls"></div>
      <div class="field-row">
        <div class="field"><label for="giDate">Date de la séance</label><input id="giDate" type="date" required></div>
        <div class="field"><label for="giTeam">Équipe</label><select id="giTeam"></select></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="giSession">Séance de la plateforme</label><select id="giSession"><option value="">— Aucune —</option></select></div>
        <div class="field"><label for="giLabel">Libellé</label><input id="giLabel" maxlength="200"></div>
      </div>
      <button class="btn" type="button" id="giAnalyse">Analyser</button>
      <p class="gps-status" id="giStatus" role="status" aria-live="polite"></p>
      <div id="giPreview"></div>
      <div class="modal-actions"><button class="btn" type="button" data-close="gpsImportModal">Annuler</button>
        <button class="btn btn-primary hidden" type="button" id="giSave">Valider l’import</button></div>
    </div></div>`);
    giEl('giFile').addEventListener('change', (e) => giRead(e.target.files[0]));
    giEl('giDate').addEventListener('change', giSessions);
    giEl('giTeam').addEventListener('change', giSessions);
    giEl('giSession').addEventListener('change', () => { const o = giEl('giSession').selectedOptions[0]; if (o?.value && !giEl('giLabel').value) giEl('giLabel').value = o.textContent; });
    giEl('giAnalyse').addEventListener('click', giAnalyse);
    giEl('giSave').addEventListener('click', giSave);
    giEl('giPreview').addEventListener('change', giPreviewChange);
    giEl('giPreview').addEventListener('click', (e) => { if (e.target.closest('#giConfirmAll')) { GI.match.forEach(m => { if (m.status === 'confirm') Object.assign(m, { status: 'ok', on: true, validated: true }); }); giRender(); } });
  }
  const all = window.CLUB_TEAMS || [], mine = accountTeams(myProfile, all), teams = mine.length ? mine : all;
  giEl('giTeam').innerHTML = (teams.length ? '' : '<option value="">Sans équipe</option>') + teams.map(t => `<option value="${t.id}">${escapeHtml(t.nom)}</option>`).join('');
  giEl('giTeam').value = String(teams.find(t => t.id === currentTeamId())?.id ?? teams[0]?.id ?? '');
  Object.assign(GI, { file: null, rows: null, a: null, match: [] });
  ['giFile', 'giDate', 'giLabel'].forEach(id => { giEl(id).value = ''; });
  giEl('giStatus').textContent = ''; giEl('giPreview').innerHTML = ''; giEl('giSave').classList.add('hidden');
  openModal('gpsImportModal');
}

async function giRead(file) {
  if (!file) return;
  const buf = await file.arrayBuffer();
  GI.file = file;
  GI.hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
  try {
    if (/\.xlsx?$/i.test(file.name)) {
      await loadLib('xlsx');
      const wb = XLSX.read(buf, { type: 'array' });
      GI.rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    } else {
      let text = new TextDecoder('utf-8').decode(buf);
      if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);   // ancien export Windows
      GI.rows = gpsCsvRows(text);
    }
  } catch (e) { console.error('Fichier GPS illisible', e); giEl('giStatus').innerHTML = `<span class="text-danger">Fichier illisible : ${escapeHtml(e.message)}</span>`; return; }
  giEl('giLabel').value = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' · ');
  const d = gpsFileDate(file.name);
  if (d) giEl('giDate').value = d;
  giEl('giStatus').textContent = `${GI.rows.length - 1} ligne${GI.rows.length > 2 ? 's' : ''} lue${GI.rows.length > 2 ? 's' : ''}${d ? '' : ' · la date n’est pas dans le fichier : indiquez-la'}.`;
  giSessions();
}

async function giSessions() {
  const date = giEl('giDate').value, team = Number(giEl('giTeam').value) || null, sel = giEl('giSession');
  sel.innerHTML = '<option value="">— Aucune —</option>';
  if (!date) return;
  let q = sb.from('sessions').select('id, titre, heure').eq('date_seance', date);
  if (team) q = q.eq('team_id', team);
  const { data } = await q;
  sel.innerHTML += (data || []).map(s => `<option value="${s.id}">${escapeHtml(s.titre)}${s.heure ? ` · ${s.heure.slice(0, 5)}` : ''}</option>`).join('');
  if ((data || []).length === 1) sel.value = String(data[0].id);   // une seule séance ce jour-là : proposée
}

async function giAnalyse() {
  const status = giEl('giStatus'), date = giEl('giDate').value, team = Number(giEl('giTeam').value) || null;
  if (!GI.rows) return toast('Choisissez d’abord le fichier.', 'error');
  if (!date) return toast('Indiquez la date de la séance.', 'error');
  GI.a = gpsAnalyse(GI.rows);
  if (!GI.a.players.length) { status.innerHTML = '<span class="text-danger">Aucun joueur reconnu dans ce fichier (colonne « Player » ou noms introuvables).</span>'; return; }
  status.textContent = 'Rapprochement des joueurs…';
  const [pl, al, dup, day] = await Promise.all([
    GI.club ? { data: GI.club } : sb.from('players').select('id, nom, prenom, team_id, other_team_ids').order('nom'),
    sb.from('gps_player_aliases').select('nom_lu, player_id'),
    sb.from('gps_imports').select('id, date_seance, created_at').eq('file_hash', GI.hash).is('annule_at', null),
    sb.from('gps_imports').select('id, libelle, fichier, gps_rows(player_id)').eq('date_seance', date).is('annule_at', null),
  ]);
  const err = [pl, al, dup, day].find(r => r.error)?.error;
  if (err) { status.innerHTML = `<span class="text-danger">${escapeHtml(['42P01', 'PGRST205'].includes(err.code) ? 'Le GPS n’est pas encore installé : passez lmfc_v32.sql.' : err.message)}</span>`; return; }
  GI.club = pl.data;
  GI.aliases = new Map((al.data || []).map(a => [a.nom_lu, a.player_id]));
  GI.dup = dup.data?.[0] || null;
  GI.overlap = (day.data || []).flatMap(i => (i.gps_rows || []).map(r => ({ player_id: r.player_id, label: i.libelle || i.fichier })));
  GI.match = gpsMatch(GI.a.players.map(p => p.name), GI.club, team, GI.aliases).map(m => ({ ...m, on: m.status === 'ok' || m.status === 'alias' }));
  GI.keep = new Set();
  giRender();
}

function giRender() {
  const a = GI.a, cols = a.columns, team = Number(giEl('giTeam').value) || null;
  const known = cols.filter(c => c.status === 'known'), unknown = cols.filter(c => c.status === 'unknown'), text = cols.filter(c => c.status === 'text');
  const teamPlayers = GI.club.filter(p => !team || p.team_id === team || (p.other_team_ids || []).includes(team));
  const count = (s) => GI.match.filter(m => m.status === s).length, picked = GI.match.filter(m => m.on && m.player).length;
  const overlap = GI.match.filter(m => m.on && m.player && GI.overlap.some(o => o.player_id === m.player.id));
  giEl('giStatus').textContent = `${a.players.length} joueurs dans le fichier · ${count('ok') + count('alias')} reconnus · ${count('confirm')} à confirmer · ${count('choose')} à choisir · ${count('none')} non reconnus`;
  giEl('giPreview').innerHTML = `
    ${GI.dup ? `<p class="gps-warn is-bad">Ce fichier a déjà été importé (séance du ${gpsDate(GI.dup.date_seance)}, le ${gpsDate(GI.dup.created_at)}). Annulez cet import dans l’historique pour le remplacer.</p>` : ''}
    ${overlap.length ? `<p class="gps-warn">Déjà des données GPS ce jour-là pour ${overlap.map(m => escapeHtml(playerFullName(m.player))).join(', ')} (${escapeHtml([...new Set(GI.overlap.map(o => o.label))].join(', '))}). Rien ne sera écrasé : les deux imports compteront.</p>` : ''}
    <h3 class="as-h4">Indicateurs reconnus · ${known.length}</h3>
    <ul class="gi-cols">${known.map(c => `<li><span>${escapeHtml(c.header)}</span> → <strong>${escapeHtml(c.label)}</strong>${c.unit ? ` <small>${escapeHtml(c.unit)}${c.factor && c.factor !== 1 ? ` (converti ×${gpsFr(Math.round(c.factor * 1000) / 1000)})` : ''}</small>` : ' <small>sans unité</small>'}</li>`).join('')}</ul>
    ${a.checks.map(c => `<p class="gps-ok">✓ ${escapeHtml(c)}</p>`).join('')}${a.warnings.map(w => `<p class="gps-warn">⚠ ${escapeHtml(w)}</p>`).join('')}
    ${unknown.length ? `<h3 class="as-h4">Colonnes non reconnues · ${unknown.length}</h3><p class="gps-help">Aucune signification n’est devinée. Cochez pour les garder sous leur nom d’origine, sans unité.</p>
      <div class="gi-unknown">${unknown.map(c => `<label><input type="checkbox" data-gi-keep="${escapeHtml(c.key)}"${GI.keep.has(c.key) ? ' checked' : ''}> ${escapeHtml(c.header)}</label>`).join('')}</div>` : ''}
    ${text.length ? `<p class="gps-help">Colonnes de texte ignorées : ${escapeHtml(text.map(c => c.header).join(', '))}.</p>` : ''}
    ${a.excluded.length ? `<p class="gps-help">Lignes exclues : ${a.excluded.map(x => `${escapeHtml(x.name)} (${escapeHtml(x.reason)})`).join(', ')}.</p>` : ''}
    <h3 class="as-h4">Joueurs</h3>${count('confirm') ? '<button class="btn btn-sm" type="button" id="giConfirmAll">Tout confirmer</button>' : ''}
    <div class="cmp-table-wrap"><table class="cmp-table gi-table"><thead><tr><th><span class="sr-only">Importer</span></th><th class="p-name">Fichier</th><th>Fiche du club</th><th>État</th>
      <th>Temps</th><th>Distance</th><th>Vmax</th></tr></thead><tbody>${GI.match.map((m, i) => { const v = a.players[i].values; return `<tr class="${m.on ? '' : 'is-off'}">
        <td><input type="checkbox" data-gi-on="${i}" aria-label="Importer ${escapeHtml(m.name)}"${m.on ? ' checked' : ''}${m.player ? '' : ' disabled'}></td>
        <td class="p-name">${escapeHtml(m.name)}</td>
        <td><select data-gi-player="${i}" aria-label="Fiche du club pour ${escapeHtml(m.name)}"><option value="">— Ne pas importer —</option>
          ${[...m.candidates, ...teamPlayers.filter(p => !m.candidates.includes(p))].map(p => `<option value="${p.id}"${m.player?.id === p.id ? ' selected' : ''}>${escapeHtml(playerFullName(p))}</option>`).join('')}</select></td>
        <td><span class="fff-st ${GI_ST[m.status][1]}">${GI_ST[m.status][0]}</span></td>
        <td>${gpsNum(v.duree)}</td><td>${gpsNum(v.distance, 0)}</td><td>${gpsNum(v.vmax)}</td></tr>`; }).join('')}</tbody></table></div>`;
  giEl('giSave').classList.toggle('hidden', !!GI.dup || !picked);
  giEl('giSave').textContent = `Valider l’import (${picked} joueur${picked > 1 ? 's' : ''})`;
}

function giPreviewChange(e) {
  const on = e.target.dataset.giOn, pick = e.target.dataset.giPlayer, keep = e.target.dataset.giKeep;
  if (on != null) GI.match[Number(on)].on = e.target.checked;
  if (pick != null) {
    const m = GI.match[Number(pick)];
    m.player = GI.club.find(p => p.id === Number(e.target.value)) || null;
    Object.assign(m, { on: !!m.player, validated: !!m.player, status: m.player ? 'ok' : 'none' });
  }
  if (keep != null) GI.keep[e.target.checked ? 'add' : 'delete'](keep);
  giRender();
}

async function giSave() {
  const btn = giEl('giSave'), a = GI.a;
  const cols = a.columns.filter(c => c.status === 'known' || (c.status === 'unknown' && GI.keep.has(c.key)));
  const keys = new Set(cols.map(c => c.key));
  const rows = GI.match.map((m, i) => ({ m, p: a.players[i] })).filter(x => x.m.on && x.m.player).map(({ m, p }) => ({
    player_id: m.player.id, nom_lu: p.name, raw: p.raw, metrics: Object.fromEntries(Object.entries(p.values).filter(([k]) => keys.has(k))) }));
  const aliases = GI.match.filter(m => m.on && m.player && m.validated).map(m => ({ nom_lu: normalizeName(m.name), player_id: m.player.id }));
  btn.disabled = true;
  const { error } = await sb.rpc('gps_import_save', {
    p_import: { team_id: Number(giEl('giTeam').value) || null, session_id: Number(giEl('giSession').value) || null, date_seance: giEl('giDate').value,
      libelle: giEl('giLabel').value.trim() || null, fichier: GI.file.name.slice(0, 255), file_hash: GI.hash, fournisseur: 'catapult',
      colonnes: cols.map(({ header, key, label, unit, kind, factor, band, status }) => ({ header, key, label, unit, kind, factor, band, status })) },
    p_rows: rows, p_aliases: aliases });
  btn.disabled = false;
  if (error) {
    console.error('Import GPS refusé', error);
    return toast(error.code === '23505' ? 'Ce fichier a déjà été importé : annulez l’import existant pour le remplacer.'
      : error.code === '42501' || /row-level/.test(error.message) ? 'Droits insuffisants pour l’un de ces joueurs (préparateur : joueurs de vos équipes).' : error.message, 'error');
  }
  closeModal('gpsImportModal');
  toast(`${rows.length} joueur${rows.length > 1 ? 's' : ''} importé${rows.length > 1 ? 's' : ''}`, 'success');
  GPS.loaded = false;
  render();
}
