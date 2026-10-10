/* ============================================================
   LMFC Performance — player-videos.js (staff)
   Les vidéos d'UN joueur, rangées pour qu'on s'y retrouve :
     1. « À traiter » : les séquences que le joueur vous a envoyées
        et qui attendent votre retour ;
     2. chaque vidéo envoyée au joueur, avec SOUS elle ses séquences,
        chacune marquée « Joueur » ou « Staff » (qui l'a créée) et,
        pour celles du joueur, son statut (Brouillon, À traiter, Vu,
        Répondu, Modifié).
   Le circuit est rappelé en tête (« Comment ça marche ? »).
   Utilisé par la fiche joueur (onglet Vidéos) et par la page Vidéos
   joueurs (videos-page.js) :
     mountPlayerVideos(root, { player, profile, onChange, upload })
     openVideoWorkspace({ video, url, player, profile, seqId, onChange })
     openVideoUpload({ players, playerId, profile, onDone })
   Dépend de app.js, video-status.js, video-workspace.js, video-compile.js.
   Sécurité : RLS (player_videos, video_sequences, video_views).
   ============================================================ */

const PV = {
  root: null, player: null, profile: null, onChange: null,
  token: 0,   // change à chaque montage : un chargement en retard ne redessine pas une autre vue
  videos: [], seqs: [], urls: new Map(), signError: null,
  // Sélection : séquences (compiler, supprimer) ou vidéos (supprimer, télécharger).
  // ids dans l'ordre des clics : c'est l'ordre de compilation.
  pick: { on: false, kind: 'seqs', ids: [] },
};
const pvPlural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const pvName = playerFullName;   // app.js
const pvDay = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
/* Créée par le joueur (son compte) ou par le staff. */
const pvByPlayer = (s) => !!PV.player?.auth_user_id && s.created_by === PV.player.auth_user_id;

async function mountPlayerVideos(root, { player, profile, onChange = null, upload = true }) {
  Object.assign(PV, { root, player, profile, onChange, upload, token: PV.token + 1 });
  PV.pick = { on: false, kind: 'seqs', ids: [] };
  ensureVideoModals();
  if (!root.dataset.pvBound) {
    root.dataset.pvBound = '1';
    root.addEventListener('click', pvClick);
  }
  await pvLoad();
}

/* La page quitte la vue du joueur (retour à la liste) : plus rien à redessiner. */
function unmountPlayerVideos() { PV.token++; PV.pick.on = false; }

async function pvLoad() {
  const box = PV.root, token = PV.token;
  try {
    const [vRes, sRes] = await Promise.all([
      sb.from('player_videos')
        .select('*, video_views(watched_seconds, max_position_seconds, last_heartbeat_at)')
        .eq('player_id', PV.player.id).order('created_at', { ascending: false }),
      sb.from('video_sequences').select('*').eq('player_id', PV.player.id).order('start_sec'),
    ]);
    if (vRes.error) throw vRes.error;
    if (sRes.error) console.warn('Séquences indisponibles (platform_v2.sql non passée ?) :', sRes.error.message);
    await pvSign(vRes.data || []);
    if (token !== PV.token) return;
    PV.videos = vRes.data || [];
    PV.seqs = sRes.data || [];
    pvRender();
    PV.onChange?.({ videos: PV.videos, seqs: PV.seqs });
  } catch (e) {
    console.error('Vidéos du joueur illisibles', e);
    if (token === PV.token) box.innerHTML = `<p class="text-danger">${escapeHtml(e.message)}</p>`;
  }
}

/* Liens de lecture, en une requête (miniatures et lecture). */
async function pvSign(videos) {
  const missing = videos.filter(v => !PV.urls.has(v.id));
  if (!missing.length) return;
  try {
    const urls = await videoUrls(missing.map(v => v.storage_path));
    missing.forEach(v => urls.has(v.storage_path) && PV.urls.set(v.id, urls.get(v.storage_path)));
    PV.signError = null;
  } catch (e) { PV.signError = e; console.warn('Liens de lecture indisponibles', e); }
}

/* ---------- Rendu ---------- */
const pvVideoOf = (s) => PV.videos.find(v => v.id === s.video_id);
const pvToSee = () => PV.seqs.filter(seqToSee).sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
function pvViews(v) {
  const views = v.video_views || [];
  if (!views.length) return 'Pas encore vue par le joueur';
  const posMax = views.reduce((m, x) => Math.max(m, x.max_position_seconds || 0), 0);
  const pct = v.duree_sec ? Math.min(100, Math.round(posMax / v.duree_sec * 100)) : null;
  return `Vue ${views.length}×${pct !== null ? ` · ${pct} %` : ''} par le joueur`;
}

/* Une séquence : miniature, titre, qui l'a créée, statut, durée, note du joueur. */
function pvSeq(s, { withVideo = false } = {}) {
  const len = s.end_sec - s.start_sec, mine = pvByPlayer(s), note = (s.player_note || '').trim();
  const n = (s.drawings || []).length;
  const meta = [withVideo ? (pvVideoOf(s)?.titre || 'Vidéo') : null, fmtDur(len),
    n ? pvPlural(n, 'annotation', 'annotations') : null,
    s.submitted_at && mine ? `envoyée le ${pvDay(s.submitted_at)}` : null].filter(Boolean).join(' · ');
  const rank = PV.pick.on && PV.pick.kind === 'seqs' ? PV.pick.ids.indexOf(s.id) + 1 : 0;
  const pickable = PV.pick.on && PV.pick.kind === 'seqs';
  const attrs = pickable ? `data-pv-pick="${s.id}" aria-pressed="${!!rank}"` : `data-pv-open="${s.video_id}" data-pv-seq="${s.id}"`;
  return `<button type="button" class="pvx-seq${pickable ? ' is-pickable' : ''}${rank ? ' is-picked' : ''}" ${attrs}>
    ${pickable ? `<span class="vp-pick" aria-hidden="true">${rank || ''}</span>` : ''}
    ${thumbHtml(PV.urls.get(s.video_id), s.start_sec, fmtDur(len))}
    <span class="pvx-seq-body">
      <span class="pvx-seq-top"><strong>${escapeHtml(s.label || 'Séquence')}</strong>
        <span class="pvx-who ${mine ? 'is-player' : 'is-staff'}">${mine ? 'Joueur' : 'Staff'}</span>
        ${mine ? statusPill(s, 'staff') : ''}</span>
      <span class="pvx-seq-meta">${escapeHtml(meta)}</span>
      ${note ? `<em>« ${escapeHtml(note.length > 90 ? `${note.slice(0, 87)}…` : note)} »</em>` : ''}
    </span>
  </button>`;
}

function pvVideo(v) {
  const seqs = PV.seqs.filter(s => s.video_id === v.id)
    .sort((a, b) => (pvByPlayer(b) - pvByPlayer(a)) || (a.start_sec - b.start_sec));
  const ofPlayer = seqs.filter(pvByPlayer).length;
  const pickVideos = PV.pick.on && PV.pick.kind === 'videos';
  const on = pickVideos && PV.pick.ids.includes(v.id);
  const manage = canManageVideos(PV.profile.role);
  const count = seqs.length
    ? `${pvPlural(seqs.length, 'séquence', 'séquences')}${ofPlayer ? ` dont ${ofPlayer} du joueur` : ''}`
    : 'Pas encore de séquence';
  return `<article class="pvx-video${on ? ' is-picked' : ''}">
    <div class="pvx-video-head">
      <button type="button" class="pvx-video-open${pickVideos ? ' is-pickable' : ''}" ${pickVideos
        ? `data-pv-pick="${v.id}" aria-pressed="${on}"` : `data-pv-open="${v.id}"`}>
        ${pickVideos ? `<span class="vp-pick" aria-hidden="true">${on ? '✓' : ''}</span>` : ''}
        ${thumbHtml(PV.urls.get(v.id), 1, 'Vidéo')}
        <span class="pvx-video-body">
          <strong>${escapeHtml(v.titre || 'Vidéo')}</strong>
          <span class="pvx-seq-meta">Envoyée le ${escapeHtml(pvDay(v.created_at))} · ${escapeHtml(pvViews(v))}</span>
          <span class="pvx-seq-meta">${escapeHtml(count)}</span>
        </span>
      </button>
      ${manage && !PV.pick.on ? `<button class="vp-card-del" type="button" data-pv-del="${v.id}" aria-label="Supprimer la vidéo « ${escapeHtml(v.titre)} »" title="Supprimer la vidéo">✕</button>` : ''}
    </div>
    ${pickVideos ? '' : `<div class="pvx-seqs">${seqs.length ? seqs.map(s => pvSeq(s)).join('')
      : '<p class="pvx-noseq">Ouvrez la vidéo, puis « Sélectionner une portion » pour en créer une. Le joueur peut aussi le faire de son côté.</p>'}</div>`}
  </article>`;
}

function pvRender() {
  const box = PV.root, p = PV.player;
  const todo = pvToSee();
  const manage = canManageVideos(PV.profile.role);
  const k = PV.pick;
  if (k.on && ((k.kind === 'seqs' && !PV.seqs.length) || (k.kind === 'videos' && !(manage && PV.videos.length)))) {
    k.on = false; k.ids = [];
  }
  const pool = k.kind === 'videos' ? PV.videos : PV.seqs;
  k.ids = k.ids.filter(id => pool.some(x => x.id === id));
  const chosenByPlayer = PV.seqs.filter(s => s.selected).length;
  const bar = !k.on ? '' : bulkBarHtml({
    n: k.ids.length, total: pool.length,
    noun: k.kind === 'videos' ? ['vidéo', 'vidéos', true] : ['séquence', 'séquences', true],
    extra: k.kind === 'seqs' && chosenByPlayer ? `<button class="btn btn-sm" type="button" data-bulk="player" title="Les séquences que le joueur a sélectionnées">Sélection du joueur (${chosenByPlayer})</button>` : '',
    actions: k.kind === 'videos'
      ? [{ key: 'dl', label: 'Télécharger les originaux' }, { key: 'del-videos', label: 'Supprimer', danger: true }]
      : [{ key: 'compile', label: 'Compiler', primary: true }, ...(manage ? [{ key: 'del-seqs', label: 'Supprimer', danger: true }] : [])],
  });
  const tools = k.on ? '' : `
    ${PV.seqs.length ? '<button class="btn btn-sm" type="button" data-pv-pick-start="seqs" title="Compiler ou supprimer plusieurs séquences">Sélectionner des séquences</button>' : ''}
    ${manage && PV.videos.length ? '<button class="btn btn-sm" type="button" data-pv-pick-start="videos" title="Supprimer ou télécharger plusieurs vidéos">Sélectionner des vidéos</button>' : ''}
    ${manage && PV.upload ? '<button class="btn btn-sm btn-primary" type="button" data-pv-upload>+ Envoyer des vidéos</button>' : ''}`;

  box.innerHTML = `
    <details class="pvx-flow"${PV.seqs.length ? '' : ' open'}>
      <summary>Comment ça marche ?</summary>
      <ol>
        <li><strong>Vous envoyez une vidéo</strong> au joueur (match, entraînement).</li>
        <li><strong>Il la découpe en séquences</strong> et les annote (flèches, zones, son analyse).</li>
        <li><strong>Il vous les envoie</strong> : elles arrivent dans « À traiter ».</li>
        <li><strong>Vous répondez</strong> dans la séquence ; il voit votre retour.</li>
      </ol>
      <p>Vous pouvez aussi créer vos propres séquences (marquées « Staff ») pour les montrer au joueur ou les compiler.</p>
    </details>

    <section class="vp-section" aria-labelledby="pvxTodo">
      <h2 id="pvxTodo">À traiter ${todo.length ? `<span class="vw-status is-sent">${todo.length}</span>` : ''}</h2>
      ${todo.length
        ? `<p class="pvx-lead">Séquences envoyées par ${escapeHtml(pvName(p))}, en attente de votre retour.</p>
           <div class="pvx-seqs is-todo">${todo.map(s => pvSeq(s, { withVideo: true })).join('')}</div>`
        : '<p class="vp-empty">Rien à traiter : quand le joueur vous enverra une séquence, elle apparaîtra ici.</p>'}
    </section>

    <section class="vp-section" aria-labelledby="pvxVideos">
      <div class="vp-section-head pvx-head">
        <h2 id="pvxVideos">Vidéos envoyées${PV.videos.length ? ` <span class="pvx-count">${PV.videos.length}</span>` : ''}</h2>
        <div class="pvx-tools">${tools}</div>
      </div>
      ${bar}
      ${PV.videos.length ? `<div class="pvx-videos">${PV.videos.map(pvVideo).join('')}</div>`
        : `<p class="vp-empty">Aucune vidéo envoyée à ${escapeHtml(pvName(p))}.${manage ? ' « + Envoyer des vidéos » pour commencer.' : ''}</p>`}
    </section>`;
  loadThumbs(box);
}

function pvClick(e) {
  if (e.currentTarget !== PV.root) return;
  const k = PV.pick;
  const picked = e.target.closest('[data-pv-pick]');
  if (picked) {
    const id = Number(picked.dataset.pvPick);
    k.ids = k.ids.includes(id) ? k.ids.filter(x => x !== id) : [...k.ids, id];
    return pvRender();
  }
  const start = e.target.closest('[data-pv-pick-start]');
  if (start) { Object.assign(k, { on: true, kind: start.dataset.pvPickStart, ids: [] }); return pvRender(); }
  const pool = k.kind === 'videos' ? PV.videos : PV.seqs;
  const bulk = e.target.closest('[data-bulk]')?.dataset.bulk;
  if (bulk === 'all') { k.ids = [...k.ids, ...pool.map(x => x.id).filter(id => !k.ids.includes(id))]; return pvRender(); }
  if (bulk === 'player') { k.ids = PV.seqs.filter(s => s.selected).map(s => s.id); return pvRender(); }
  if (bulk === 'none') { k.ids = []; return pvRender(); }
  if (bulk === 'done') { k.on = false; k.ids = []; return pvRender(); }
  if (bulk === 'compile') return pvCompile();
  if (bulk === 'del-seqs') return pvDeleteSeqs();
  if (bulk === 'del-videos') return pvDeleteVideos(k.ids);
  if (bulk === 'dl') return pvDownload();
  if (e.target.closest('[data-pv-upload]')) {
    return openVideoUpload({ players: [PV.player], playerId: PV.player.id, profile: PV.profile, onDone: pvLoad });
  }
  const del = e.target.closest('[data-pv-del]');
  if (del) return pvDeleteVideos([Number(del.dataset.pvDel)]);
  const open = e.target.closest('[data-pv-open]');
  if (open) {
    const v = PV.videos.find(x => x.id === Number(open.dataset.pvOpen));
    if (v) openVideoWorkspace({ video: v, url: PV.urls.get(v.id), player: PV.player, profile: PV.profile,
      seqId: Number(open.dataset.pvSeq) || null, onChange: pvLoad });
  }
}

/* ---------- Actions groupées ---------- */
function pvCompile() {
  const seqs = PV.pick.ids.map(id => PV.seqs.find(s => s.id === id)).filter(Boolean);
  if (!seqs.length) return;
  openCompileSheet({ player: PV.player, seqs, videoOf: pvVideoOf, urlOf: (s) => PV.urls.get(s.video_id), onSaved: pvLoad, profile: PV.profile });
}
async function pvDeleteVideos(ids) {
  const list = PV.videos.filter(v => ids.includes(v.id));
  if (!list.length) return;
  if (!confirm(`Supprimer ${list.length > 1 ? `ces ${list.length} vidéos` : `« ${list[0].titre} »`} ?${list.length > 1 ? `\n\n${namesList(list.map(v => v.titre))}` : ''}\n\nLe joueur n’y aura plus accès, leurs séquences partent avec elles.${await trashNote()}`)) return;
  try {
    const { error } = await sb.from('player_videos').delete().in('id', list.map(v => v.id));
    if (error) throw error;
    // Corbeille : les fichiers restent jusqu'à la suppression définitive.
    if (!(await trashReady())) {
      await Promise.all(list.map(v => removeVideoFile(v.storage_path).catch(err => console.warn('Suppression du fichier vidéo :', v.storage_path, err))));
    }
    toast(`${list.length} vidéo${list.length > 1 ? 's supprimées' : ' supprimée'}.`, 'success');
    PV.pick.ids = [];
    await pvLoad();
  } catch (err) { console.error('Suppression des vidéos impossible', err); toast(err.message, 'error'); }
}
async function pvDeleteSeqs() {
  const list = PV.seqs.filter(s => PV.pick.ids.includes(s.id));
  if (!list.length) return;
  if (!confirm(`Supprimer ${list.length > 1 ? `ces ${list.length} séquences` : 'cette séquence'} ?\n\n${namesList(list.map(s => s.label || 'Séquence'))}${await trashNote()}`)) return;
  try {
    const { error } = await sb.from('video_sequences').delete().in('id', list.map(s => s.id));
    if (error) throw error;
    toast(`${list.length} séquence${list.length > 1 ? 's supprimées' : ' supprimée'}.`, 'success');
    PV.pick.ids = [];
    await pvLoad();
  } catch (err) { console.error('Suppression des séquences impossible', err); toast(err.message, 'error'); }
}
/* Fichiers d'origine, tels qu'envoyés : l'un après l'autre (le navigateur
   peut demander d'autoriser les téléchargements multiples). */
async function pvDownload() {
  const list = PV.videos.filter(v => PV.pick.ids.includes(v.id));
  await pvSign(list);
  let missing = 0;
  for (const v of list) {
    const u = PV.urls.get(v.id);
    if (!u) { missing++; continue; }
    const name = (v.titre || 'video').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').slice(0, 60);
    const a = el('a', { href: u.startsWith('/api/videos/') ? `${u}&dl=1&n=${encodeURIComponent(name)}` : u, download: '' });
    document.body.append(a); a.click(); a.remove();
    await new Promise(r => setTimeout(r, 700));
  }
  if (missing) toast(PV.signError ? `Lecture impossible : ${PV.signError.message}` : `${missing} vidéo${missing > 1 ? 's' : ''} introuvable${missing > 1 ? 's' : ''}.`, 'error');
}

/* ---------- Fenêtres : poste de travail et envoi (posées une seule fois) ---------- */
function ensureVideoModals() {
  if (document.getElementById('wsModal')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-backdrop" id="videoModal">
    <div class="modal modal-upl">
      <h3>Envoyer des vidéos</h3>
      <div class="field">
        <label for="v-player">Joueur destinataire</label>
        <select id="v-player" required><option value="">— Choisir —</option></select>
      </div>
      <div class="field">
        <label>Fichiers vidéo (MP4 conseillé)</label>
        <label class="file-pick"><input type="file" id="v-file" accept="video/*" multiple>
          <span class="btn btn-sm">+ Choisir des vidéos</span></label>
        <p class="field-hint">Sélectionnez-en plusieurs d’un coup dans vos fichiers. Le titre de chaque vidéo reprend le nom du fichier : modifiable avant l’envoi.</p>
      </div>
      <div class="upl-list" id="v-files"></div>
      <div class="field"><label for="v-desc">Description <span class="label-opt">(facultative, commune aux vidéos)</span></label><textarea id="v-desc" rows="2"></textarea></div>
      <p class="field-hint">Vidéos brutes : le joueur et vous pourrez ensuite les découper en séquences.</p>
      <div class="upl-total hidden" id="v-total" role="status" aria-live="polite"></div>
      <div class="modal-actions">
        <button class="btn" type="button" id="v-cancel">Annuler</button>
        <button class="btn btn-primary" id="v-submit" type="button">Envoyer</button>
      </div>
    </div>
  </div>
  <div class="modal-backdrop" id="wsModal">
    <div class="modal modal-xl">
      <div class="ws-head"><span class="ws-who" id="wsTitle">Joueur</span><button class="btn btn-sm" type="button" data-close="wsModal">Fermer</button></div>
      <div id="wsRoot"></div>
    </div>
  </div>`);
  document.getElementById('v-submit').addEventListener('click', uploadVideos);
  // Fermeture du poste de travail (bouton, Échap, clic à côté) : on coupe
  // la vidéo et on rafraîchit la liste si quelque chose a changé.
  new MutationObserver(() => {
    if (document.getElementById('wsModal').classList.contains('open')) return;
    document.getElementById('wsRoot').innerHTML = '';
    if (pvWs.dirty) { pvWs.dirty = false; pvWs.after?.(); }
  }).observe(document.getElementById('wsModal'), { attributes: true, attributeFilter: ['class'] });
}

const pvWs = { dirty: false, after: null };
async function openVideoWorkspace({ video, url, player, profile, seqId = null, onChange = null }) {
  ensureVideoModals();
  if (!url) {
    try { url = await videoUrl(video.storage_path); } catch (e) { console.warn('Lien de lecture indisponible', e); }
  }
  if (!url) return toast(PV.signError ? `Lecture impossible : ${PV.signError.message}` : 'Vidéo introuvable dans le stockage.', 'error');
  pvWs.dirty = false; pvWs.after = onChange;
  document.getElementById('wsTitle').textContent = pvName(player);
  openModal('wsModal');
  await mountVideoWorkspace(document.getElementById('wsRoot'), {
    video, src: url, player, mode: 'staff', userId: profile.id, focusSeq: seqId,
    onChange: () => { pvWs.dirty = true; },
  });
}

/* ---------- Envoi de vidéos ----------
   Plusieurs fichiers d'un coup, envoyés l'un après l'autre (la connexion
   est le goulot : en parallèle, chacun irait moins vite). Chaque ligne
   montre son pourcentage, la ligne du bas l'avancement global. Un échec
   n'arrête pas les suivants ; « Réessayer » ne renvoie que les échecs. */
const upl = { items: [], ctrl: null, stamp: 0, profile: null, onDone: null };   // item : { file, title, state, pct, err }
const $up = (id) => document.getElementById(id);
/* « match_vs_laval.mp4 » → « Match vs laval » */
const titleFromFile = (name) => {
  const t = name.replace(/\.[^.]+$/, '').replace(/[_\s]+/g, ' ').trim() || 'Vidéo';
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const fileExt = (name) => (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] || 'mp4').toLowerCase();
const pctText = (p) => `${Math.floor(p * 100)} %`;
const fmtMo = (bytes) => `${Math.round(bytes / (1024 * 1024))} Mo`;
const fmtSize = (b) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} Ko`
  : `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace('.', ',')} Mo`);

function openVideoUpload({ players, playerId = null, profile, onDone = null }) {
  ensureVideoModals();
  if (upl.ctrl) return openModal('videoModal');   // envoi en cours : on le retrouve tel quel
  upl.profile = profile; upl.onDone = onDone;
  const sel = $up('v-player');
  sel.innerHTML = '<option value="">— Choisir un joueur —</option>'
    + players.map(p => `<option value="${p.id}">${escapeHtml(pvName(p))}</option>`).join('');
  sel.dataset.players = JSON.stringify(players.map(p => p.id));
  if (playerId) sel.value = String(playerId);
  $up('v-desc').value = '';
  $up('v-file').value = '';
  upl.items = [];
  renderUploads();
  openModal('videoModal');
}

function renderUploads() {
  const busy = !!upl.ctrl;
  const box = $up('v-files');
  box.innerHTML = upl.items.map((it, i) => {
    const status = {
      big: `<span class="upl-err">Trop volumineuse : ${fmtMo(it.file.size)}, ${fmtMo(VIDEO_MAX_BYTES)} au maximum</span>`,
      sending: `<span class="upl-pct" data-pct>${it.pct >= 1 ? 'Finalisation…' : pctText(it.pct)}</span>`,
      done: '<span class="upl-ok">Envoyée ✓</span>',
      error: `<span class="upl-err">${escapeHtml(it.err)}</span>`,
    }[it.state] || `<span class="upl-size">${fmtSize(it.file.size)}</span>`;
    const locked = busy || it.state === 'done';
    return `
      <div class="upl-row is-${it.state}" data-i="${i}">
        <input class="upl-title" value="${escapeHtml(it.title)}" maxlength="140" aria-label="Titre de la vidéo ${i + 1}" ${locked ? 'disabled' : ''}>
        ${status}
        <button type="button" class="upl-x" data-upl-remove="${i}" aria-label="Retirer ${escapeHtml(it.title)}" ${locked ? 'disabled' : ''}>×</button>
        <div class="upl-bar"><span style="width:${it.state === 'done' ? 100 : Math.round(it.pct * 100)}%"></span></div>
      </div>`;
  }).join('');
  box.classList.toggle('hidden', !upl.items.length);
  const todo = upl.items.filter(it => it.state === 'ready' || it.state === 'error');
  const btn = $up('v-submit');
  if (!busy) {
    btn.disabled = !todo.length;
    btn.textContent = upl.items.some(it => it.state === 'error') ? 'Réessayer'
      : todo.length > 1 ? `Envoyer les ${todo.length} vidéos` : 'Envoyer';
  }
  $up('v-cancel').textContent = busy ? 'Arrêter l’envoi' : upl.items.some(it => it.state === 'done') ? 'Fermer' : 'Annuler';
  $up('v-player').disabled = busy;
  $up('v-file').disabled = busy;
  $up('v-desc').disabled = busy;
  $up('v-file').nextElementSibling.textContent = upl.items.length ? '+ Ajouter d’autres vidéos' : '+ Choisir des vidéos';
  $up('videoModal').toggleAttribute('data-busy', busy);   // ni Échap ni clic à côté ne ferment
}

/* Avancement : mis à jour sur place, sans redessiner les champs. */
function showUploadProgress(it, done, total) {
  const row = $up('v-files').querySelector(`[data-i="${upl.items.indexOf(it)}"]`);
  if (row) {
    row.querySelector('.upl-bar > span').style.width = `${Math.round(it.pct * 100)}%`;
    const pct = row.querySelector('[data-pct]');
    if (pct) pct.textContent = it.pct >= 1 ? 'Finalisation…' : pctText(it.pct);
  }
  const all = (done + it.pct * it.file.size) / total.bytes;
  const n = total.list.indexOf(it) + 1;
  $up('v-total').textContent = total.list.length > 1
    ? `Vidéo ${n} sur ${total.list.length} — ${pctText(all)} au total` : `Envoi : ${pctText(all)}`;
  $up('v-submit').textContent = `Envoi… ${pctText(all)}`;
}

document.addEventListener('change', (e) => {
  if (e.target.id !== 'v-file') return;
  const known = new Set(upl.items.map(it => `${it.file.name}|${it.file.size}|${it.file.lastModified}`));
  [...e.target.files].forEach(file => {
    if (known.has(`${file.name}|${file.size}|${file.lastModified}`)) return;
    upl.items.push({ file, title: titleFromFile(file.name), state: file.size > VIDEO_MAX_BYTES ? 'big' : 'ready', pct: 0 });
  });
  e.target.value = '';   // un second choix s'ajoute au premier
  renderUploads();
});
document.addEventListener('input', (e) => {
  const row = e.target.classList.contains('upl-title') && e.target.closest('.upl-row');
  if (row) upl.items[Number(row.dataset.i)].title = e.target.value;
});
document.addEventListener('click', (e) => {
  const rm = e.target.closest('[data-upl-remove]');
  if (rm && !upl.ctrl) { upl.items.splice(Number(rm.dataset.uplRemove), 1); renderUploads(); return; }
  if (e.target.id !== 'v-cancel') return;
  if (!upl.ctrl) return closeModal('videoModal');
  if (confirm('Arrêter l’envoi ?\n\nLes vidéos déjà envoyées sont gardées.')) upl.ctrl.abort();
});
window.addEventListener('beforeunload', (e) => { if (upl.ctrl) e.preventDefault(); });

async function uploadVideos() {
  const playerId = Number($up('v-player').value);
  const allowed = JSON.parse($up('v-player').dataset.players || '[]');
  if (!allowed.includes(playerId)) { toast('Choisissez le joueur destinataire.', 'error'); return; }
  const list = upl.items.filter(it => it.state === 'ready' || it.state === 'error');
  if (!list.length) { toast('Ajoutez au moins une vidéo.', 'error'); return; }
  const clubId = upl.profile.club_id;
  const description = $up('v-desc').value.trim() || null;
  const total = { list, bytes: list.reduce((s, it) => s + it.file.size, 0) || 1 };
  let done = 0, sent = 0, failed = 0;
  upl.ctrl = new AbortController();
  list.forEach(it => { it.state = 'ready'; it.pct = 0; it.err = ''; });
  $up('v-submit').disabled = true;
  $up('v-total').classList.remove('hidden');
  renderUploads();
  for (const it of list) {
    if (upl.ctrl.signal.aborted) break;
    it.state = 'sending'; renderUploads(); showUploadProgress(it, done, total);
    upl.stamp = Math.max(Date.now(), upl.stamp + 1);   // chemins distincts, même envoyés dans la même milliseconde
    const path = `r2/${clubId}/${playerId}/${upl.stamp}.${fileExt(it.file.name)}`;
    try {
      await uploadVideoFile(path, it.file, {
        signal: upl.ctrl.signal,
        onProgress: (p) => { it.pct = p; showUploadProgress(it, done, total); },
      });
      const { error } = await sb.from('player_videos').insert({
        club_id: clubId, player_id: playerId, storage_path: path,
        titre: it.title.trim() || titleFromFile(it.file.name), description,
      });
      if (error) {
        await removeVideoFile(path).catch(err => console.warn('Fichier orphelin', path, err));
        throw error;
      }
      it.state = 'done'; sent++;
    } catch (err) {
      if (err.name === 'AbortError') { it.state = 'ready'; it.pct = 0; break; }
      console.error('Envoi vidéo', it.file.name, err);
      it.state = 'error'; it.err = err.message || 'Échec de l’envoi.'; failed++;
    }
    done += it.file.size;
  }
  const stopped = upl.ctrl.signal.aborted;
  upl.ctrl = null;
  $up('v-total').classList.add('hidden');
  renderUploads();
  if (sent) await upl.onDone?.();
  const sentTxt = `${sent} vidéo${sent > 1 ? 's envoyées' : ' envoyée'}`;
  if (!failed && !stopped) {
    closeModal('videoModal');
    toast(`${sentTxt}. ${sent > 1 ? 'Elles apparaissent' : 'Elle apparaît'} dans l’espace du joueur.`, 'success');
  } else if (stopped) {
    toast(sent ? `Envoi arrêté : ${sentTxt}.` : 'Envoi arrêté.', 'info');
  } else {
    toast(`${sent ? `${sentTxt}, ` : ''}${failed} en échec : corrigez ou réessayez.`, 'error');
  }
}
