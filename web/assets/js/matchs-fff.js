/* ============================================================
   LMFC Performance — matchs-fff.js (matchs.html)
   « Importer depuis la FFF » : équipe → calendrier collé → aperçu →
   import. Lecture et règles : fff-import.js ; colonnes : lmfc_v27.sql.
     - aperçu par compétition, cases à cocher ; les compétitions
       retenues pour une équipe sont proposées la fois suivante (cet
       appareil seulement) ;
     - état de chaque rencontre : Nouveau, Mis à jour (champs), À jour,
       et ce que le staff a modifié à la main (gardé) ;
     - rien n'est écrit sans validation ; commentaire, informations,
       à retenir et joueurs ne sont jamais touchés ; la saisie manuelle
       reste possible quoi qu'il arrive à la FFF.
   Dépend de matchs-page.js (myProfile, loadMatches, openMatch).
   ============================================================ */

const FFF = { rows: [], existing: new Map() };
const FFF_MEMO = 'lmfc-fff-competitions';
const FFF_LABEL = { date_match: 'date', heure: 'heure', competition: 'compétition', adversaire: 'adversaire',
  lieu: 'lieu', stade: 'stade', score_pour: 'score', score_contre: 'score' };
const fffLabels = (fields) => [...new Set(fields.map(f => FFF_LABEL[f]))].join(', ');

/* Compétitions retenues pour une équipe, sur cet appareil (confort seulement). */
function fffMemo(teamId, comps) {
  try {
    const all = JSON.parse(localStorage.getItem(FFF_MEMO) || '{}');
    if (comps) { all[teamId || 0] = comps; localStorage.setItem(FFF_MEMO, JSON.stringify(all)); }
    return all[teamId || 0] || [];
  } catch { return []; }
}
const fffTeam = () => Number(document.getElementById('fffTeam').value) || null;

function openFffImport() {
  const teams = window.CLUB_TEAMS || [];
  const mine = myProfile.role === 'admin' || !(myProfile.team_ids || []).length ? teams
    : teams.filter(t => myProfile.team_ids.includes(t.id));
  const sel = document.getElementById('fffTeam');
  sel.innerHTML = (mine.length ? '' : '<option value="">Sans équipe</option>')
    + mine.map(t => `<option value="${t.id}">${escapeHtml(t.nom)}</option>`).join('');
  if (mine.some(t => t.id === currentTeamId())) sel.value = currentTeamId();
  document.getElementById('fffTeamField').classList.toggle('hidden', !teams.length);
  document.getElementById('fffText').value = '';
  FFF.rows = [];
  renderFff();
  openModal('fffModal');
}

async function fffAnalyse() {
  const status = document.getElementById('fffStatus');
  const { matches, skipped } = fffParse(document.getElementById('fffText').value);
  FFF.rows = [];
  if (!matches.length) {
    renderFff();
    status.innerHTML = '<span class="text-danger">Aucune rencontre reconnue dans ce texte.</span> Sur la page du club, '
      + 'sélectionnez tout (Ctrl+A ou ⌘A), copiez, puis collez ici. Si rien n’y fait, la FFF a peut-être changé sa page : '
      + 'créez le match à la main (« + Nouveau match »).';
    return;
  }
  status.textContent = 'Recherche des matchs déjà importés…';
  const sides = fffOurSides(matches);
  const memo = new Set(fffMemo(fffTeam()));
  FFF.rows = matches.map((m, i) => ({ m, side: sides[i], key: fffKey(m), on: memo.has(m.competition) && !!sides[i] }));
  const { data, error } = await sb.from('matches')
    .select('id, team_id, date_match, heure, competition, adversaire, lieu, stade, score_pour, score_contre, ext_id, ext_data')
    .eq('ext_source', 'fff').in('ext_id', FFF.rows.map(r => r.key));
  if (error) {
    console.error('Import FFF : matchs existants illisibles', error);
    FFF.rows = [];
    renderFff();
    status.innerHTML = `<span class="text-danger">${escapeHtml(error.code === '42703'
      ? 'L’import FFF n’est pas encore installé : passez lmfc_v27.sql dans Supabase.' : error.message)}</span>`;
    return;
  }
  FFF.existing = new Map((data || []).map(r => [r.ext_id, r]));
  FFF.skipped = skipped;
  renderFff();
}

/* État d'une rencontre pour l'équipe choisie : à écrire ou non, et pourquoi. */
function fffState(r) {
  if (!r.side) return { todo: false, html: '<span class="fff-st is-warn">Choisissez notre équipe</span>' };
  const ex = FFF.existing.get(r.key);
  const other = ex && ex.team_id !== fffTeam() ? ` · rangé en ${escapeHtml(teamName(ex.team_id) || 'sans équipe')}` : '';
  if (!ex) return { todo: true, html: '<span class="fff-st is-new">Nouveau</span>' };
  const { changed, kept } = fffMerge(ex, fffIncoming(r.m, r.side));
  const keptHtml = kept.length ? ` <span class="fff-st is-warn">Gardé (modifié à la main) : ${fffLabels(kept)}</span>` : '';
  if (changed.length) return { todo: true, ex, html: `<span class="fff-st is-upd">Mis à jour : ${fffLabels(changed)}</span>${keptHtml}${other}` };
  return { todo: kept.length > 0, ex, html: `<span class="fff-st">À jour</span>${keptHtml}${other}` };
}

function fffRowHtml(r, i) {
  const { m, side } = r, st = fffState(r);
  const name = (n, s) => (side === s ? `<strong>${escapeHtml(n)}</strong>` : escapeHtml(n));
  const mid = m.score_home != null ? `${m.score_home} – ${m.score_away}` : m.heure || '–';
  return `<div class="fff-row${r.on ? '' : ' is-off'}">
    <input type="checkbox" id="fffr-${i}" data-fff-row="${i}"${r.on ? ' checked' : ''}${side ? '' : ' disabled'}>
    <label for="fffr-${i}" class="fff-what">
      <span class="fff-date">${fmtDateFr(m.date)}${m.heure ? ` · ${m.heure}` : ''}${m.journee ? ` · ${escapeHtml(m.journee)}` : ''}</span>
      <span class="fff-teams">${name(m.home, 'home')} <span class="fff-mid">${escapeHtml(mid)}</span> ${name(m.away, 'away')}</span>
      ${m.statut ? `<span class="fff-st is-warn">${escapeHtml(m.statut)}</span>` : ''}
    </label>
    <span class="fff-state">${st.html}${side ? '' : `<span class="segmented" role="group" aria-label="Notre équipe">
      <button type="button" data-fff-side="home" data-i="${i}">${escapeHtml(m.home)}</button>
      <button type="button" data-fff-side="away" data-i="${i}">${escapeHtml(m.away)}</button></span>`}</span>
  </div>`;
}

function renderFff() {
  const box = document.getElementById('fffPreview'), go = document.getElementById('fffGo');
  const status = document.getElementById('fffStatus'), keep = document.activeElement?.id;
  if (!FFF.rows.length) { box.innerHTML = ''; status.textContent = ''; go.classList.add('hidden'); return; }
  // En tête : les compétitions déjà retenues ou importées pour cette équipe (le texte en compte souvent plus de 20).
  const memo = new Set(fffMemo(fffTeam())), team = fffTeam();
  const mine = (comp) => memo.has(comp) || FFF.rows.some(r => r.m.competition === comp && FFF.existing.get(r.key)?.team_id === team);
  const groups = new Map();
  FFF.rows.forEach((r, i) => { const g = groups.get(r.m.competition) || []; g.push(i); groups.set(r.m.competition, g); });
  const ordered = [...groups].sort(([a], [b]) => mine(b) - mine(a));
  box.innerHTML = ordered.map(([comp, idx], g) => {
    const on = idx.filter(i => FFF.rows[i].on).length;
    return `<fieldset class="fff-group">
      <legend><label><input type="checkbox" id="fffg-${g}" data-fff-group="${g}"${on && on === idx.length ? ' checked' : ''}>
        ${escapeHtml(comp)} <span class="fff-n">${idx.length} rencontre${idx.length > 1 ? 's' : ''}</span></label></legend>
      ${idx.map(i => fffRowHtml(FFF.rows[i], i)).join('')}
    </fieldset>`;
  }).join('');
  FFF.groups = ordered.map(([, idx]) => idx);
  const todo = FFF.rows.filter(r => r.on && fffState(r).todo).length;
  const picked = FFF.rows.filter(r => r.on).length;
  status.textContent = `${FFF.rows.length} rencontres reconnues${FFF.skipped ? `, ${FFF.skipped} illisible${FFF.skipped > 1 ? 's' : ''} (ignorée${FFF.skipped > 1 ? 's' : ''})` : ''}. `
    + (picked ? `${picked} cochée${picked > 1 ? 's' : ''}, ${todo} à enregistrer.` : 'Cochez les compétitions de l’équipe.');
  go.textContent = todo ? `Importer (${todo})` : 'Importer';
  go.disabled = !todo;
  go.classList.remove('hidden');
  if (keep?.startsWith('fff')) document.getElementById(keep)?.focus();   // la case cochée garde le focus
}

async function fffImport() {
  const go = document.getElementById('fffGo'), teamId = fffTeam(), now = new Date().toISOString();
  const inserts = [], updates = [];
  for (const r of FFF.rows.filter(x => x.on && x.side)) {
    const inc = fffIncoming(r.m, r.side);
    const ext_data = { ...inc, journee: r.m.journee, home: r.m.home, away: r.m.away, statut: r.m.statut };
    const ex = FFF.existing.get(r.key);
    if (!ex) inserts.push({ club_id: myProfile.club_id, team_id: teamId, ...inc, ext_source: 'fff', ext_id: r.key, ext_data, ext_synced_at: now });
    else {
      const { patch, changed, kept } = fffMerge(ex, inc);
      if (changed.length || kept.length) updates.push({ id: ex.id, row: { ...patch, ext_data, ext_synced_at: now } });
    }
  }
  go.disabled = true;
  try {
    const [ins, ...ups] = await Promise.all([
      inserts.length ? sb.from('matches').insert(inserts).select('id') : { data: [] },
      ...updates.map(u => sb.from('matches').update(u.row).eq('id', u.id).select('id')),
    ]);
    if (ins.error) {
      throw new Error(ins.error.code === '23505' ? 'Une de ces rencontres vient d’être importée (par vous ou un collègue) : relancez « Analyser ».' : ins.error.message);
    }
    const refused = ups.filter(u => u.error || !u.data?.length).length;
    fffMemo(teamId, [...new Set(FFF.rows.filter(r => r.on).map(r => r.m.competition))]);
    closeModal('fffModal');
    toast([`${inserts.length} match${inserts.length > 1 ? 's' : ''} ajouté${inserts.length > 1 ? 's' : ''}`,
      `${updates.length - refused} mis à jour`, refused ? `${refused} refusé${refused > 1 ? 's' : ''} (droits)` : ''].filter(Boolean).join(', '),
    refused ? 'error' : 'success');
    await loadMatches();
    const ids = [...ins.data, ...ups.flatMap(u => u.data || [])].map(x => x.id);
    if (ids.length === 1) openMatch(matches.find(m => m.id === ids[0]));   // un seul : on complète la fiche tout de suite
  } catch (e) {
    console.error('Import FFF non enregistré', e);
    toast(e.message, 'error');
  } finally { go.disabled = false; }
}

function initFffImport() {
  const btn = document.getElementById('btnFff');
  btn.classList.remove('hidden');
  btn.addEventListener('click', openFffImport);
  document.getElementById('fffAnalyse').addEventListener('click', fffAnalyse);
  document.getElementById('fffGo').addEventListener('click', fffImport);
  document.getElementById('fffTeam').addEventListener('change', () => {
    const memo = new Set(fffMemo(fffTeam()));
    FFF.rows.forEach(r => { r.on = memo.has(r.m.competition) && !!r.side; });
    renderFff();
  });
  const box = document.getElementById('fffPreview');
  box.addEventListener('change', (e) => {
    const row = e.target.dataset.fffRow, group = e.target.dataset.fffGroup;
    if (row != null) FFF.rows[Number(row)].on = e.target.checked;
    if (group != null) FFF.groups[Number(group)].forEach(i => { FFF.rows[i].on = e.target.checked && !!FFF.rows[i].side; });
    renderFff();
  });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fff-side]');
    if (!b) return;
    const r = FFF.rows[Number(b.dataset.i)];
    r.side = b.dataset.fffSide;
    r.on = true;
    renderFff();
  });
}
