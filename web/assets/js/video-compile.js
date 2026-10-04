/* ============================================================
   LMFC Performance — video-compile.js
   Compilation : plusieurs séquences d'un joueur, dans l'ordre choisi,
   réunies en UNE vidéo, avec leur habillage incrusté (flèches, zones,
   projecteurs, textes, repères, arrêts sur image), comme à l'écran.

   Comment : l'habillage n'est pas dans le fichier vidéo, il est
   enregistré à part (video_sequences.drawings) et dessiné par-dessus
   à la lecture. Pour l'incruster, la page rejoue chaque séquence dans
   un <canvas> (image + annotations, paintInk de video-ink.js) et
   enregistre ce canvas avec le son (MediaRecorder). Aucun serveur :
   la génération dure le temps des séquences, onglet au premier plan.

   Fichiers : par défaut la compilation est seulement téléchargée,
   rien n'est stocké. « Ajouter aux vidéos du joueur » la range sur
   R2 dans le dossier de CE joueur (lui seul et le staff la voient).

   openCompileSheet({ player, seqs, videoOf, urlOf, onSaved })
   ============================================================ */

const COMPILE_W = 1280;            // vidéo produite en 720p
const COMPILE_TITLE_MS = 1600;     // carton de titre avant chaque séquence
const COMPILE_FPS = 30;

function compileMime() {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
  return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find(t => MediaRecorder.isTypeSupported(t)) || null;
}
const compileExt = (mime) => (mime.startsWith('video/mp4') ? 'mp4' : 'webm');
const compileSleep = (ms) => new Promise(r => setTimeout(r, ms));
const compileFrames = (seq) => (seq.drawings || [])
  .map(f => ({ ...f, t: Number(f.t) || 0, d: Number(f.d) > 0 ? Number(f.d) : 3, freeze: f.freeze !== false, shapes: f.shapes || [] }))
  .filter(f => f.t >= seq.start_sec - .05 && f.t < seq.end_sec)
  .sort((a, b) => a.t - b.t);

/* Durée prévue (s) : séquences + arrêts sur image + cartons. */
function compileDuration(items, { titles, ink }) {
  return items.reduce((sum, it) => sum + (it.seq.end_sec - it.seq.start_sec)
    + (ink ? compileFrames(it.seq).filter(f => f.freeze).reduce((a, f) => a + f.d, 0) : 0)
    + (titles ? COMPILE_TITLE_MS / 1000 : 0), 0);
}

function loadCompileVideo(src, host) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous'; v.preload = 'auto'; v.playsInline = true; v.setAttribute('playsinline', '');
    v.onloadedmetadata = () => resolve(v);
    v.onerror = () => reject(new Error('Une vidéo source est illisible (lien expiré ? rechargez la page).'));
    v.src = src;
    host.append(v);
  });
}
const seekTo = (v, t) => new Promise(resolve => {
  if (Math.abs(v.currentTime - t) < .01) return resolve();
  v.addEventListener('seeked', resolve, { once: true });
  v.currentTime = t;
});

let compileCrest = null;
function crestImage() {
  if (!compileCrest) { compileCrest = new Image(); compileCrest.src = baseUrl('assets/img/lmfc-logo.png'); }
  return compileCrest;
}

/* Rend la compilation. items : [{ seq, src }] dans l'ordre voulu.
   opts : { titles, ink, playerName, canvas, onProgress, isCancelled } → Blob. */
async function renderCompilation(items, opts) {
  const mime = compileMime();
  if (!mime) throw new Error('Ce navigateur ne sait pas enregistrer de vidéo : utilisez Chrome, Edge ou Safari à jour.');
  const host = el('div', { class: 'vc-hidden', 'aria-hidden': 'true' });
  document.body.append(host);
  const videos = new Map();   // une seule balise <video> par fichier source
  let ac = null, raf = 0, recorder = null, stream = null;
  try {
    for (const it of items) if (!videos.has(it.src)) videos.set(it.src, await loadCompileVideo(it.src, host));
    const v0 = videos.get(items[0].src);
    const W = COMPILE_W, H = Math.round(W * (v0.videoHeight || 9) / (v0.videoWidth || 16) / 2) * 2;
    const out = opts.canvas;
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    stream = out.captureStream(COMPILE_FPS);
    // Son des séquences : chaque vidéo passe par la même sortie audio (rien dans les haut-parleurs).
    try {
      ac = new AudioContext();
      const dest = ac.createMediaStreamDestination();
      videos.forEach(v => ac.createMediaElementSource(v).connect(dest));
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
      await ac.resume();
    } catch (e) { console.warn('Compilation sans le son', e); }

    let scene = { kind: 'black' };
    const draw = () => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      if (scene.kind === 'title') drawTitleCard(ctx, W, H, scene);
      else if (scene.v) {
        const v = scene.v, k = Math.min(W / v.videoWidth, H / v.videoHeight);
        const w = v.videoWidth * k, h = v.videoHeight * k, x = (W - w) / 2, y = (H - h) / 2;
        ctx.drawImage(v, x, y, w, h);
        const t = v.currentTime;
        const shapes = !opts.ink ? []
          : scene.kind === 'hold' ? scene.shapes
          : scene.frames.filter(f => !f.freeze && t >= f.t - .05 && t < f.t + f.d).flatMap(f => f.shapes);
        if (shapes.length) { ctx.save(); ctx.translate(x, y); paintInk(ctx, shapes, { w, h }); ctx.restore(); }
        drawCaption(ctx, W, H, scene.caption);
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    const chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise(r => { recorder.onstop = r; });
    recorder.start(1000);

    const total = compileDuration(items, opts), t0 = performance.now();
    const tick = () => opts.onProgress?.(Math.min(.99, (performance.now() - t0) / 1000 / Math.max(1, total)));
    const check = () => { if (opts.isCancelled?.()) throw new Error('Compilation annulée.'); tick(); };

    for (const [i, it] of items.entries()) {
      const seq = it.seq, v = videos.get(it.src);
      const caption = `${i + 1} / ${items.length} · ${seq.label || 'Séquence'}`;
      await seekTo(v, seq.start_sec);
      if (opts.titles) {
        scene = { kind: 'title', index: i + 1, count: items.length, label: seq.label || 'Séquence', player: opts.playerName, dur: seq.end_sec - seq.start_sec };
        await compileSleep(COMPILE_TITLE_MS); check();
      }
      const frames = opts.ink ? compileFrames(seq) : [];
      scene = { kind: 'clip', v, frames, caption };
      let lastT = seq.start_sec - .01;
      await v.play();
      while (true) {
        await compileSleep(12); check();
        const t = v.currentTime;
        const hold = frames.find(f => f.freeze && lastT < f.t && f.t <= t + .04);
        if (hold) {
          v.pause(); await seekTo(v, hold.t);
          scene = { kind: 'hold', v, shapes: hold.shapes, caption };
          const until = performance.now() + hold.d * 1000;
          while (performance.now() < until) { await compileSleep(40); check(); }
          scene = { kind: 'clip', v, frames, caption };
          lastT = hold.t;
          if (hold.t >= seq.end_sec - .05) break;
          await v.play();
          continue;
        }
        if (t >= seq.end_sec || v.ended) { v.pause(); break; }
        lastT = t;
      }
    }
    scene = { kind: 'black' };
    await compileSleep(250);
    recorder.stop();
    await stopped;
    opts.onProgress?.(1);
    return new Blob(chunks, { type: mime.split(';')[0] });
  } finally {
    cancelAnimationFrame(raf);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream?.getTracks().forEach(t => t.stop());
    videos.forEach(v => { v.pause(); v.removeAttribute('src'); v.load(); });
    host.remove();
    ac?.close().catch(e => console.warn('Fermeture audio', e));
  }
}

function drawTitleCard(ctx, W, H, s) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#141414'); g.addColorStop(1, '#2a0a10');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#C8102E'; ctx.fillRect(0, 0, W * .62, 8);
  ctx.fillStyle = '#E8B20E'; ctx.fillRect(W * .62, 0, W * .38, 8);
  const crest = crestImage();
  if (crest.complete && crest.naturalWidth) ctx.drawImage(crest, W / 2 - 60, H * .16, 120, 120);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#E8B20E'; ctx.font = '700 30px Inter, Arial, sans-serif';
  ctx.fillText(`SÉQUENCE ${s.index} / ${s.count}`, W / 2, H * .56);
  ctx.fillStyle = '#F5F5F5'; ctx.font = '800 54px Inter, Arial, sans-serif';
  ctx.fillText(s.label.length > 38 ? `${s.label.slice(0, 37)}…` : s.label, W / 2, H * .67);
  ctx.fillStyle = '#9A9A9A'; ctx.font = '500 28px Inter, Arial, sans-serif';
  ctx.fillText([s.player, fmtDur(s.dur)].filter(Boolean).join(' · '), W / 2, H * .77);
}
function drawCaption(ctx, W, H, text) {
  if (!text) return;
  ctx.save();
  ctx.font = '600 22px Inter, Arial, sans-serif';
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(10,10,10,.62)';
  ctx.fillRect(18, H - 54, tw + 28, 36);
  ctx.fillStyle = '#C8102E'; ctx.fillRect(18, H - 54, 4, 36);
  ctx.fillStyle = '#F5F5F5'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, H - 36);
  ctx.restore();
}

/* ---------- Fenêtre : ordre, options, génération, téléchargement ---------- */
function openCompileSheet({ player, seqs, videoOf, urlOf, onSaved }) {
  document.getElementById('vcModal')?.remove();
  const name = `${player.prenom || ''} ${player.nom || ''}`.trim() || 'Joueur';
  const mime = compileMime();
  const st = { order: seqs.map(s => s.id), running: false, cancel: false, blob: null, url: null };
  const byId = (id) => seqs.find(s => s.id === id);
  /* Fichier d'origine : tel qu'envoyé, sans réencodage ni copie dans le
     stockage. Le Worker le sert en téléchargement (dl=1, nom lisible). */
  const origUrl = (s) => {
    const u = s && urlOf(s);
    if (!u) return null;
    if (!u.startsWith('/api/videos/')) return u;
    const title = (videoOf(s)?.titre || 'video').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '-').slice(0, 60);
    return `${u}&dl=1&n=${encodeURIComponent(title)}`;
  };
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-backdrop open" id="vcModal">
    <div class="modal modal-wide vc-modal" role="dialog" aria-modal="true" aria-labelledby="vcTitle">
      <h3 id="vcTitle">Compilation — ${escapeHtml(name)}</h3>
      <p class="text-muted vc-lead">Glissez les séquences dans l’ordre voulu. Elles seront mises bout à bout dans une seule vidéo.</p>
      <ol class="vc-list" id="vcList"></ol>
      <button class="btn btn-sm vc-orig" type="button" id="vcOrig"></button>
      <div class="vc-options">
        <label><input type="checkbox" id="vcInk" checked> Incruster l’habillage (annotations, arrêts sur image)</label>
        <label><input type="checkbox" id="vcTitles" checked> Carton de titre avant chaque séquence</label>
      </div>
      <p class="vc-time" id="vcTime"></p>
      ${mime ? '' : '<p class="text-danger">Ce navigateur ne sait pas enregistrer de vidéo : ouvrez cette page dans Chrome, Edge ou Safari à jour.</p>'}
      <div class="vc-stage hidden" id="vcStage">
        <canvas id="vcCanvas"></canvas>
        <div class="vc-bar"><span id="vcBar"></span></div>
        <p class="text-muted vc-note" id="vcNote">Génération en direct : gardez cet onglet ouvert et au premier plan.</p>
      </div>
      <div class="vc-done hidden" id="vcDone"></div>
      <div class="modal-actions">
        <button class="btn" type="button" id="vcClose">Fermer</button>
        <button class="btn btn-primary" type="button" id="vcGo" ${mime ? '' : 'disabled'}>Générer la compilation</button>
      </div>
    </div>
  </div>`);
  const $c = (sel) => document.querySelector(`#vcModal ${sel}`);
  const opts = () => ({ ink: $c('#vcInk').checked, titles: $c('#vcTitles').checked });
  const renderList = () => {
    const sources = [...new Set(st.order.map(id => byId(id).video_id))];
    $c('#vcList').innerHTML = st.order.map((id, i) => {
      const s = byId(id), len = s.end_sec - s.start_sec, n = (s.drawings || []).length;
      return `<li data-id="${id}">
        ${dragHandle(s.label || 'Séquence')}
        <span class="vc-num">${i + 1}</span>
        ${thumbHtml(urlOf(s), s.start_sec, fmtDur(len))}
        <span class="vc-body"><strong>${escapeHtml(s.label || 'Séquence')}</strong>
          <small>${escapeHtml(videoOf(s)?.titre || 'Vidéo')} · ${n ? `${n} annotation${n > 1 ? 's' : ''}` : 'sans habillage'}</small></span>
        <span class="vc-actions">
          <button class="btn btn-sm" type="button" data-one="${id}" title="Générer et télécharger cette séquence seule, habillage compris">Séquence</button>
          ${sources.length > 1 && origUrl(s) ? `<a class="btn btn-sm" href="${escapeHtml(origUrl(s))}" download title="Vidéo source complète, telle qu’elle a été envoyée (sans habillage)">Vidéo d’origine</a>` : ''}
          <button class="btn btn-sm vc-remove" type="button" data-remove="${id}" aria-label="Retirer de la compilation">✕</button>
        </span>
      </li>`;
    }).join('');
    $c('#vcOrig').textContent = `Télécharger ${sources.length > 1 ? `les ${sources.length} vidéos` : 'la vidéo'} d’origine`;
    $c('#vcOrig').classList.toggle('hidden', !sources.some(v => origUrl(seqs.find(s => s.video_id === v))));
    loadThumbs($c('#vcList'));
    const secs = Math.round(compileDuration(st.order.map(id => ({ seq: byId(id) })), opts()));
    $c('#vcTime').textContent = `${st.order.length} séquence${st.order.length > 1 ? 's' : ''} · environ ${fmtDur(secs)} de vidéo (et autant de temps de génération).`;
    $c('#vcGo').disabled = !mime || !st.order.length || st.running;
  };
  makeSortable($c('#vcList'), { onChange: () => { st.order = [...$c('#vcList').children].map(li => Number(li.dataset.id)); renderList(); } });
  renderList();
  ['#vcInk', '#vcTitles'].forEach(id => $c(id).addEventListener('change', renderList));

  const close = () => {
    if (st.running && !confirm('Arrêter la génération en cours ?')) return;
    st.cancel = true;
    if (st.url) URL.revokeObjectURL(st.url);
    document.getElementById('vcModal')?.remove();
  };
  $c('#vcClose').addEventListener('click', close);
  document.getElementById('vcModal').addEventListener('click', (e) => { if (e.target.id === 'vcModal') close(); });

  const fileName = (ids) => `${ids.length > 1 ? 'compilation' : 'sequence'}-${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.${compileExt(mime)}`;
  async function generate(ids) {
    if (st.running || !ids.length) return;
    st.running = true; st.cancel = false;
    if (st.url) { URL.revokeObjectURL(st.url); st.url = null; }
    $c('#vcDone').classList.add('hidden');
    $c('#vcStage').classList.remove('hidden');
    $c('#vcGo').disabled = true;
    $c('#vcList').querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const items = ids.map(id => ({ seq: byId(id), src: urlOf(byId(id)) }));
      if (items.some(it => !it.src)) throw new Error('Une vidéo source est introuvable dans le stockage.');
      const blob = await renderCompilation(items, {
        ...opts(), playerName: name, canvas: $c('#vcCanvas'),
        onProgress: (p) => { $c('#vcBar').style.width = `${Math.round(p * 100)}%`; },
        isCancelled: () => st.cancel,
      });
      st.blob = new File([blob], fileName(ids), { type: blob.type });
      st.url = URL.createObjectURL(st.blob);
      const mb = st.blob.size / 1048576;
      $c('#vcDone').innerHTML = `
        <p><strong>${ids.length > 1 ? 'Compilation prête' : 'Séquence prête'}</strong> · ${mb.toFixed(1).replace('.', ',')} Mo · ${escapeHtml(compileExt(mime).toUpperCase())}</p>
        <div class="vc-done-actions">
          <a class="btn btn-primary" href="${st.url}" download="${escapeHtml(st.blob.name)}">Télécharger</a>
          ${ids.length > 1 && canManageVideos(myProfile.role) ? `<button class="btn" type="button" id="vcSave" ${st.blob.size > VIDEO_MAX_BYTES ? 'disabled title="Trop volumineuse pour être ajoutée"' : ''}>Ajouter aux vidéos de ${escapeHtml(name)}</button>` : ''}
        </div>
        <small class="text-muted">Téléchargée seulement, rien n’est stocké. « Ajouter aux vidéos » la range dans l’espace de ce joueur : lui seul et le staff la voient.</small>`;
      $c('#vcDone').classList.remove('hidden');
      $c('#vcSave')?.addEventListener('click', () => saveToPlayer(ids));
    } catch (e) {
      if (!st.cancel) { console.error('Compilation impossible', e); toast(e.message || 'Compilation impossible.', 'error'); }
    } finally {
      st.running = false;
      if (document.getElementById('vcModal')) {
        $c('#vcStage').classList.add('hidden');
        $c('#vcList').querySelectorAll('button').forEach(b => { b.disabled = false; });
        renderList();
      }
    }
  }
  async function saveToPlayer(ids) {
    const btn = $c('#vcSave'); if (!btn || !st.blob) return;
    btn.disabled = true; btn.textContent = 'Envoi…';
    const path = `r2/${myProfile.club_id}/${player.id}/${Date.now()}.${compileExt(mime)}`;
    try {
      await uploadVideoFile(path, st.blob);
      const labels = ids.map(id => byId(id).label || 'Séquence');
      const { error } = await sb.from('player_videos').insert({
        club_id: myProfile.club_id, player_id: player.id, storage_path: path,
        titre: `Compilation — ${new Date().toLocaleDateString('fr-FR')}`,
        description: `Séquences : ${labels.join(' · ')}`.slice(0, 900),
      });
      if (error) {
        await removeVideoFile(path).catch(err => console.warn('Fichier orphelin', path, err));
        throw error;
      }
      btn.textContent = 'Ajoutée aux vidéos ✓';
      toast(`Compilation ajoutée aux vidéos de ${name}.`, 'success');
      onSaved?.();
    } catch (e) {
      console.error('Compilation non enregistrée', e);
      btn.disabled = false; btn.textContent = `Ajouter aux vidéos de ${name}`;
      toast(e.message, 'error');
    }
  }
  $c('#vcGo').addEventListener('click', () => generate(st.order));
  // Toutes les vidéos d'origine, l'une après l'autre (le navigateur peut
  // demander d'autoriser les téléchargements multiples).
  $c('#vcOrig').addEventListener('click', async () => {
    const done = new Set();
    for (const id of st.order) {
      const s = byId(id), u = origUrl(s);
      if (!u || done.has(s.video_id)) continue;
      done.add(s.video_id);
      const a = el('a', { href: u, download: '' });
      document.body.append(a); a.click(); a.remove();
      await compileSleep(700);
    }
  });
  $c('#vcList').addEventListener('click', (e) => {
    const one = e.target.closest('[data-one]');
    if (one) return generate([Number(one.dataset.one)]);
    const rm = e.target.closest('[data-remove]');
    if (rm && !st.running) { st.order = st.order.filter(id => id !== Number(rm.dataset.remove)); renderList(); }
  });
}
