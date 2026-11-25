/* ============================================================
   LMFC Performance — analyse-import-ui.js
   Fenêtre « Importer un XML Sportscode » de la timeline d'Analyse (vue « Une
   vidéo ») : la vidéo du match ouverte, son XML, et chaque ligne du XML
   reliée à une fiche joueur (analyse-import.js pour la lecture et le plan).
     - Joueurs : une ligne par joueur reconnu (« Tigane BRENNER »), à changer
       ou à ne pas importer ; une ligne qui ne nomme personne se relie à la main ;
     - Actions : chaque action cochée ou non, et ce qu'elle devient (Passe, Tir…
       ou « À coder ») ; choix retenu sur cet appareil (lmfc.sc.map) ;
     - la vidéo n'est envoyée qu'une fois : chaque autre joueur reçoit une ligne
       de vidéo qui pointe sur le même fichier (player_videos.storage_path), le
       fichier n'est retiré du stockage que quand plus aucune ligne ne s'en sert
       (video_path_in_use, lmfc_v74.sql) ;
     - « Visibles par les joueurs » : chacun voit le match et SES séquences, pas
       celles des autres (RLS de video_sequences : son joueur seulement) ; sinon
       elles restent réservées au staff (staff_only).
   Écriture : player_videos (insert), save_sequence_code une séquence à la fois,
   puis staff_only = false ; tout passe par la RLS (staff vidéo, joueur modifiable).
   ⌘Z retire l'import quand il ne touche que le joueur ouvert.
   ============================================================ */

const SC_MAX = 20 * 1024 * 1024;   // un export XML de match pèse quelques centaines de Ko
const SC = { plan: null, assign: {}, picks: {}, players: null, busy: false, done: false, file: '' };
const scMapLoad = () => { try { return JSON.parse(localStorage.getItem('lmfc.sc.map')) || {}; } catch { return {}; } };
function scMapSave() {
  const map = scMapLoad();
  Object.entries(SC.picks).forEach(([t, p]) => { map[scNorm(t)] = p; });
  try { localStorage.setItem('lmfc.sc.map', JSON.stringify(map)); } catch { /* sans stockage : deviné la prochaine fois */ }
}
const scName = (id) => playerFullName(SC.players.find(p => p.id === Number(id)) || {});
const scVideo = () => AN.videos.find(x => x.id === AN.tl.video);

function scEnsure() {
  if (document.getElementById('scImport')) return;
  document.body.insertAdjacentHTML('beforeend', `<input type="file" id="scFile" accept=".xml,text/xml,application/xml" hidden>
    <div class="modal-backdrop" id="scImport"><div class="modal sc-modal" role="dialog" aria-modal="true" aria-labelledby="scTitle">
      <button type="button" class="modal-x" data-close="scImport" aria-label="Fermer"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      <h2 class="as-h3" id="scTitle">Importer un XML Sportscode</h2>
      <p class="sc-sub" id="scSub"></p>
      <h3 class="as-h4 sc-sec">Joueurs du XML</h3><div class="sc-groups" id="scRows"></div>
      <h3 class="as-h4 sc-sec">Actions</h3><div class="sc-groups" id="scTypes"></div>
      <label class="sc-check" for="scVisible"><input type="checkbox" id="scVisible" checked> Visibles par les joueurs
        <small>chacun voit le match et ses séquences, jamais celles des autres</small></label>
      <label class="sc-off" for="scOff">Décalage <input type="number" id="scOff" step="0.1" value="0"> s
        <small>si la vidéo envoyée ne commence pas au même moment que celle de Sportscode</small></label>
      <p class="sc-status" id="scStatus" role="status" aria-live="polite"></p>
      <div class="modal-actions"><button type="button" class="btn" data-close="scImport">Annuler</button>
        <button type="button" class="btn btn-primary" id="scGo">Créer</button></div>
    </div></div>`);
  document.getElementById('scFile').addEventListener('change', scFileChosen);
  const box = document.getElementById('scImport');
  box.addEventListener('change', (e) => {
    const who = e.target.closest('[data-sc-who]'), on = e.target.closest('[data-sc-on]'), act = e.target.closest('[data-sc-act]');
    if (who) SC.assign[who.dataset.scWho] = who.value;
    if (on) SC.picks[on.dataset.scOn].on = on.checked;
    if (act) Object.assign(SC.picks[act.dataset.scAct], { action: act.value, on: true });
    if (who || on || act) scDraw();
  });
  box.addEventListener('input', (e) => { if (e.target.id === 'scOff') scCount(); });
  document.getElementById('scGo').addEventListener('click', scCreate);
}

/* Bouton de la timeline (vue « Une vidéo ») : choisir le fichier. */
function scPick() {
  if (AN.tl.mode !== 'video' || !scVideo()) return toast('Choisissez d’abord la vue « Une vidéo » et la vidéo du match.', 'error');
  scEnsure();
  const input = document.getElementById('scFile');
  input.value = '';
  input.click();
}

async function scFileChosen(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > SC_MAX) return toast('Fichier trop lourd pour un export XML de Sportscode (20 Mo au plus).', 'error');
  try {
    if (!SC.players) {   // les joueurs que ce compte voit (RLS) : on ne relie qu'à eux
      const { data, error } = await sb.from('players').select('id, nom, prenom, team_id').order('nom');
      if (error) throw error;
      SC.players = data || [];
    }
    SC.plan = scPlan(scRead(await file.text()), SC.players);
  } catch (err) {
    console.error('Import Sportscode : lecture impossible', err);
    return toast(err.message, 'error');
  }
  Object.assign(SC, { file: file.name, done: false });
  SC.assign = Object.fromEntries(SC.plan.rows.map(r => [r.key, r.player_id ?? '']));
  const map = scMapLoad();
  SC.picks = Object.fromEntries(scTypes(SC.plan, Object.fromEntries(SC.plan.rows.map(r => [r.key, 1])))
    .map(([t]) => [t, map[scNorm(t)] || { action: scGuess(t), on: true }]));
  document.getElementById('scOff').value = '0';
  scDraw();
  openModal('scImport');
}

function scDraw() {
  const linked = SC.plan.rows.filter(r => r.player_id != null).length;
  document.getElementById('scSub').textContent = `${SC.plan.total} actions dans « ${SC.file} » : ${anPlural(linked, 'joueur reconnu', 'joueurs reconnus')}`
    + `${SC.plan.rows.length > linked ? `, ${SC.plan.rows.length - linked} ligne${SC.plan.rows.length - linked > 1 ? 's' : ''} à relier` : ''}. Vidéo « ${scVideo()?.titre || ''} ».`;
  const team = (p) => (window.CLUB_TEAMS || []).find(t => t.id === p.team_id)?.nom;
  const people = SC.players.map(p => [p.id, `${playerFullName(p)}${team(p) ? ` – ${team(p)}` : ''}`]);
  document.getElementById('scRows').innerHTML = SC.plan.rows.map(r => `<div class="sc-row${SC.assign[r.key] ? '' : ' is-off'}">
      <span class="sc-pick"><b>${esc(r.name)}</b><small>${r.items.length}</small></span>
      <select data-sc-who="${esc(r.key)}" aria-label="Fiche joueur pour « ${esc(r.name)} »"><option value="">Ne pas importer</option>${people.map(([id, l]) =>
        `<option value="${id}"${String(id) === String(SC.assign[r.key]) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`).join('');
  const opts = [['', 'À coder'], ...Object.entries(AN_ACTIONS).map(([a, A]) => [a, A.one])];
  const types = scTypes(SC.plan, SC.assign);
  types.forEach(([t]) => { SC.picks[t] ??= { action: scGuess(t), on: true }; });
  document.getElementById('scTypes').innerHTML = types.length ? types.map(([t, n]) => `<div class="sc-row${SC.picks[t].on ? '' : ' is-off'}">
      <label class="sc-pick"><input type="checkbox" data-sc-on="${esc(t)}"${SC.picks[t].on ? ' checked' : ''}><b>${esc(t)}</b><small>${n}</small></label>
      <select data-sc-act="${esc(t)}" aria-label="Action de l’Analyse pour « ${esc(t)} »">${opts.map(([v, l]) =>
        `<option value="${v}"${v === SC.picks[t].action ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`).join('')
    : '<p class="sc-none">Reliez au moins une ligne à un joueur.</p>';
  scCount();
}

const scOff = () => Number(document.getElementById('scOff').value) || 0;
const scDur = () => (AN.tl.loaded === AN.tl.video ? AN.tl.dur : 0);
/* Séquences par joueur choisi : { pid: items }. */
function scByPlayer() {
  const by = new Map();
  SC.plan.rows.forEach(r => { const pid = Number(SC.assign[r.key]); if (pid) by.set(pid, [...(by.get(pid) || []), ...r.items]); });
  return by;
}
function scCount() {
  const v = scVideo(), by = scByPlayer();
  let n = 0;
  by.forEach((items, pid) => { n += scDrafts(items, SC.picks, pid === v.player_id ? AN.clips.filter(c => c.video_id === v.id) : [], { off: scOff(), dur: scDur() }).out.length; });
  const go = document.getElementById('scGo');
  go.textContent = n ? `Créer ${anPlural(n, 'séquence')}${by.size > 1 ? ` pour ${by.size} joueurs` : ''}` : 'Rien à créer';
  go.disabled = !n || SC.busy;
  document.getElementById('scStatus').textContent = '';
}

/* La même vidéo pour chaque joueur choisi : la sienne si elle existe déjà (même fichier), sinon une ligne créée. Rend Map pid → video_id. */
async function scVideos(v, pids, errors) {
  const vids = new Map([[v.player_id, v.id]]), others = pids.filter(p => p !== v.player_id);
  if (!others.length) return vids;
  const { data, error } = await sb.from('player_videos').select('id, player_id').eq('storage_path', v.storage_path).in('player_id', others);
  if (error) throw error;
  (data || []).forEach(h => vids.set(h.player_id, h.id));
  for (const pid of others.filter(p => !vids.has(p))) {
    const row = { club_id: v.club_id, player_id: pid, storage_path: v.storage_path, titre: v.titre, description: v.description ?? null, lieu: v.lieu ?? null, ...(v.thumb ? { thumb: v.thumb } : {}) };
    const { data: got, error: err } = await sb.from('player_videos').insert(row).select('id').single();
    if (err) errors.push(`${scName(pid)} : ${err.message}`); else vids.set(pid, got.id);
  }
  return vids;
}

async function scCreate() {
  if (SC.done) return closeModal('scImport');
  if (SC.busy) return;
  const v = scVideo(), by = scByPlayer(), go = document.getElementById('scGo'), status = document.getElementById('scStatus');
  const visible = document.getElementById('scVisible').checked, made = [], errors = [];
  SC.busy = true;
  go.disabled = true;
  scMapSave();
  try {
    const vids = await scVideos(v, [...by.keys()], errors);
    const { data: have, error } = await sb.from('video_sequences').select('video_id, start_sec, end_sec').in('video_id', [...vids.values()]);
    if (error) throw error;
    const jobs = [...by].filter(([pid]) => vids.has(pid)).flatMap(([pid, items]) =>
      scDrafts(items, SC.picks, (have || []).filter(c => c.video_id === vids.get(pid)), { off: scOff(), dur: scDur() }).out.map(x => ({ ...x, pid, vid: vids.get(pid) })));
    for (const [i, j] of jobs.entries()) {
      go.textContent = `Création… ${i + 1} / ${jobs.length}`;
      try { made.push({ id: Number(await anSaveCode({ video_id: j.vid, label: j.label }, j.draft)), code: anCodePayload(j.draft), pid: j.pid }); }
      catch (err) { errors.push(`${scName(j.pid)} : ${err.message}`); }
    }
    // Visibles : chacun les siennes (la RLS ne montre à un joueur que les séquences de son joueur).
    for (let k = 0; visible && k < made.length; k += 200) {
      const { error: e2 } = await sb.from('video_sequences').update({ staff_only: false }).in('id', made.slice(k, k + 200).map(x => x.id));
      if (e2) errors.push(`visibilité : ${e2.message}`);
    }
  } catch (err) {
    console.error('Import Sportscode : arrêt', err);
    errors.push(err.message);
  } finally {
    SC.busy = false;
  }
  if (made.length && made.every(x => x.pid === v.player_id)) anTlCreatedUndo(`import Sportscode (${made.length})`, made);
  if (errors.length) {
    console.warn('Import Sportscode : refus', errors);
    status.textContent = `${made.length} créée${made.length > 1 ? 's' : ''}. Refusé : ${errors.slice(0, 3).join(' ; ')}${errors.length > 3 ? ` (et ${errors.length - 3} autres)` : ''}`;
    Object.assign(go, { textContent: 'Fermer', disabled: false });
    SC.done = true;   // le bouton ferme : rien n'est recréé
  } else closeModal('scImport');
  await anReload();
  if (made.length) toast(`${anPlural(made.length, 'séquence créée', 'séquences créées')} pour ${anPlural(new Set(made.map(x => x.pid)).size, 'joueur')}${visible ? ', visibles par chacun' : ''}.`, 'success');
}
