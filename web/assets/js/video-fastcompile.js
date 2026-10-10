/* ============================================================
   LMFC Performance — video-fastcompile.js
   Génération RAPIDE d'une compilation (video-compile.js) : les
   séquences ne sont plus rejouées en temps réel. Chaque fichier
   source (95 Mo au plus) est lu d'un bloc et ouvert par mp4box.js ;
   ses images sont décodées, habillées sur le canvas puis réencodées
   (WebCodecs) ; le son est décodé (decodeAudioData) puis réencodé ;
   mp4-muxer écrit le MP4. La durée dépend de la machine, plus de la
   longueur des séquences, et l'onglet peut passer en arrière-plan.
   Au moindre manque (navigateur sans WebCodecs, codec ou son
   illisible), fastCompile() renvoie null : video-compile.js repasse
   en temps réel, qui marche partout.

   fastCompile(items, opts) → Blob MP4 | null
     items : [{ seq, src }] ; opts : ceux de renderCompilation.
   ============================================================ */

// Versions figées + empreinte (SRI) : le CDN ne peut rien glisser d'autre.
const FAST_LIBS = [
  ['https://cdn.jsdelivr.net/npm/mp4box@0.5.3/dist/mp4box.all.min.js',
    'sha384-RyFQqcBUUqiEfdv75igp1ok8+h4+91qRkmfKJKyQZkPUoJql/dyMfnO5BRJAEMQd', 'MP4Box'],
  ['https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.js',
    'sha384-wr0AQH9RBAKio/g7bHM5245MBCU5B/b0Y9u42cTxRYQQJXKEijZvWEJKL9JG26hs', 'Mp4Muxer'],
];
const FAST_FPS = 30;              // cartons de titre et arrêts sur image
const FAST_KEY_US = 2e6;          // une image clé toutes les 2 s
const FAST_RATE = 48000;          // son produit : 48 kHz stéréo
const FAST_AUDIO_STEP = 4800;     // morceaux de 100 ms

const fastSupported = () => ['VideoDecoder', 'VideoEncoder', 'VideoFrame', 'EncodedVideoChunk',
  'AudioEncoder', 'AudioData', 'OfflineAudioContext'].every(k => k in window);

// loadScriptOnce : app.js.
/* Attente courte sans minuterie : pas ralentie quand l'onglet est caché. */
const fastYield = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

async function pickConfig(Codec, configs) {
  for (const c of configs) {
    try { if ((await Codec.isConfigSupported(c)).supported) return c; } catch { /* config refusée : suivante */ }
  }
  return null;
}

/* Piste vidéo d'un MP4 / MOV : réglages du décodeur, images (ordre de
   décodage), décalage de la liste d'édition, rotation (vidéo de téléphone). */
function fastDemux(buf) {
  const file = MP4Box.createFile();
  let info = null, error = null;
  const samples = [];
  file.onError = (e) => { error = e; };
  file.onReady = (i) => {
    info = i;
    const t = i.videoTracks[0];
    if (!t) return;
    file.setExtractionOptions(t.id, null, { nbSamples: 1e9 });
    file.start();
  };
  file.onSamples = (id, user, list) => { samples.push(...list); };
  buf.fileStart = 0;
  file.appendBuffer(buf);
  file.flush();
  const track = info?.videoTracks[0];
  if (error || !track || !samples.length) throw new Error(`MP4 illisible (${error || 'pas d’images'})`);
  const trak = file.getTrackById(track.id);
  const entry = trak.mdia.minf.stbl.stsd.entries[0];
  const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
  let description;
  if (box) {
    const ds = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
    box.write(ds);
    description = new Uint8Array(ds.buffer, 8);   // sans l'en-tête de la boîte
  }
  const edit = trak.edts?.elst?.entries?.find(e => e.media_time >= 0);
  const [a, b] = track.matrix || [65536, 0];
  return {
    config: { codec: track.codec, codedWidth: track.video.width, codedHeight: track.video.height, ...(description ? { description } : {}) },
    width: track.video.width, height: track.video.height,
    timescale: track.timescale,
    shift: (edit?.media_time || 0) / track.timescale,   // temps de la balise <video> = cts − décalage
    rotation: ((Math.round(Math.atan2(b, a) / (Math.PI / 2)) * 90) % 360 + 360) % 360,
    samples,
    hasAudio: info.audioTracks.length > 0,
  };
}

/* Image décodée → canvas, tournée comme à l'écran, centrée. Renvoie le
   cadre de la vidéo (repère des annotations). */
function fastDrawFrame(ctx, frame, W, H, rotation) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const fw = frame.displayWidth, fh = frame.displayHeight, side = rotation % 180 !== 0;
  const vw = side ? fh : fw, vh = side ? fw : fh;
  const k = Math.min(W / vw, H / vh), w = vw * k, h = vh * k, x = (W - w) / 2, y = (H - h) / 2;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(rotation * Math.PI / 180);
  ctx.drawImage(frame, -(side ? h : w) / 2, -(side ? w : h) / 2, side ? h : w, side ? w : h);
  ctx.restore();
  return { x, y, w, h };
}

/* Décode les images de [a, b[ (temps de la balise <video>) et les passe
   une à une à onFrame(frame, t), dans l'ordre d'affichage. */
async function fastDecodeRange(src, a, b, onFrame) {
  const { samples, timescale, shift } = src;
  const time = (s, k = 'cts') => s[k] / timescale - shift;
  let from = 0;   // dernière image clé avant le début
  samples.forEach((s, k) => { if (s.is_sync && time(s) <= a + 1e-3) from = k; });
  const queue = [];
  let wake = null, done = false, failure = null;
  const dec = new VideoDecoder({ output: (f) => { queue.push(f); wake?.(); }, error: (e) => { failure ||= e; wake?.(); } });
  dec.configure(src.config);
  const feed = (async () => {
    try {
      for (let k = from; k < samples.length && !failure; k++) {
        const s = samples[k];
        if (time(s, 'dts') > b + 1) break;   // marge : images réordonnées (images B)
        while (!failure && (dec.decodeQueueSize > 4 || queue.length > 6)) await fastYield();
        if (failure) break;
        dec.decode(new EncodedVideoChunk({ type: s.is_sync ? 'key' : 'delta', data: s.data,
          timestamp: Math.round(s.cts * 1e6 / timescale), duration: Math.round(s.duration * 1e6 / timescale) }));
      }
      if (!failure) await dec.flush();
    } catch (e) { failure ||= e; } finally { done = true; wake?.(); }
  })();
  try {
    for (;;) {
      if (failure) throw failure;
      const f = queue.shift();
      if (!f) {
        if (done) break;
        await new Promise(r => { wake = r; });
        wake = null;
        continue;
      }
      const t = f.timestamp / 1e6 - shift;
      try { if (t >= a - 1e-3 && t < b) await onFrame(f, t); } finally { f.close(); }
    }
  } catch (e) {
    failure ||= e;
    throw e;
  } finally {
    queue.splice(0).forEach(f => f.close());
    if (dec.state !== 'closed') dec.close();
    await feed;
  }
}

/* Son produit : PCM des séquences et silences (cartons, arrêts), horodaté
   en échantillons pour rester calé sur l'image. */
function fastAudioWriter(enc) {
  let n = 0;
  const write = (len, fill) => {
    for (let i = 0; i < len; i += FAST_AUDIO_STEP) {
      const k = Math.min(FAST_AUDIO_STEP, len - i), data = new Float32Array(k * 2);
      fill?.(data, i, k);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: FAST_RATE, numberOfFrames: k, numberOfChannels: 2,
        timestamp: Math.round(n * 1e6 / FAST_RATE), data });
      enc.encode(ad); ad.close();
      n += k;
    }
  };
  return {
    padTo(sec) { const target = Math.round(sec * FAST_RATE); if (target > n) write(target - n); },
    pcm(buffer, a, b) {
      const from = Math.round(a * FAST_RATE), len = Math.max(0, Math.round(b * FAST_RATE) - from);
      if (!buffer) return write(len);
      const ch = [0, 1].map(c => buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)));
      write(len, (data, i, k) => ch.forEach((d, c) => data.set(d.subarray(from + i, from + i + k), c * k)));
    },
  };
}

async function fastLoadSources(items, opts) {
  const sources = new Map(), urls = [...new Set(items.map(it => it.src))];
  for (const [i, url] of urls.entries()) {
    opts.onStatus?.(`Lecture ${urls.length > 1 ? `des vidéos (${i + 1}/${urls.length})` : 'de la vidéo'}…`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Vidéo source illisible (${res.status})`);
    const buf = await res.arrayBuffer();
    if (opts.isCancelled?.()) throw new Error('Compilation annulée.');
    const src = fastDemux(buf);
    if (!(await pickConfig(VideoDecoder, [src.config]))) { console.info('Génération rapide : codec non pris en charge', src.config.codec); return null; }
    src.audio = null;
    if (src.hasAudio) {
      // Le son est gardé : s'il est illisible ici, le temps réel le garde.
      try { src.audio = await new OfflineAudioContext(2, 1, FAST_RATE).decodeAudioData(buf.slice(0)); } catch (e) {
        console.info('Génération rapide : son illisible', e); return null;
      }
    }
    sources.set(url, src);
  }
  return sources;
}

async function fastCompile(items, opts) {
  if (!fastSupported()) return null;
  try {
    for (const lib of FAST_LIBS) await loadScriptOnce(...lib);
  } catch (e) { console.warn('Génération rapide indisponible', e); return null; }
  // mp4box signale en rouge des boîtes QuickTime qu'il saute sans dommage (.mov d'iPhone).
  if (window.Log) { Log.setLogLevel(Log.error); Log.error = (where, msg) => console.info('mp4box :', where, msg); }

  const sources = await fastLoadSources(items, opts);
  if (!sources) return null;
  const first = sources.get(items[0].src);
  const side = first.rotation % 180 !== 0;
  const sw = side ? first.height : first.width, sh = side ? first.width : first.height;
  const W = sw >= sh ? COMPILE_W : even(COMPILE_W * sw / sh), H = sw >= sh ? even(COMPILE_W * sh / sw) : COMPILE_W;
  const vcfg = await pickConfig(VideoEncoder, ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42e01f']
    .map(codec => ({ codec, width: W, height: H, bitrate: 5_000_000, framerate: FAST_FPS, avc: { format: 'avc' } })));
  const withAudio = [...sources.values()].some(s => s.audio);
  const acfg = withAudio ? await pickConfig(AudioEncoder, ['mp4a.40.2', 'opus']
    .map(codec => ({ codec, sampleRate: FAST_RATE, numberOfChannels: 2, bitrate: 128000 }))) : null;
  if (!vcfg || (withAudio && !acfg)) { console.info('Génération rapide : encodeur indisponible'); return null; }

  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    ...(acfg ? { audio: { codec: acfg.codec === 'opus' ? 'opus' : 'aac', numberOfChannels: 2, sampleRate: FAST_RATE } } : {}),
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let failure = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { failure ||= e; } });
  const aenc = acfg && new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { failure ||= e; } });
  try {
    venc.configure(vcfg);
    aenc?.configure(acfg);
    const audio = aenc && fastAudioWriter(aenc);
    const canvas = opts.canvas, ctx = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;
    const crest = crestImage();
    await crest.decode().catch(() => { /* carton sans blason */ });

    const total = Math.max(1, compileDuration(items, opts));
    let outT = 0, lastTs = -1, lastKey = -Infinity;
    const check = () => {
      if (failure) throw failure;
      if (opts.isCancelled?.()) throw new Error('Compilation annulée.');
      opts.onProgress?.(Math.min(.99, outT / total));
    };
    const encode = async (sec, dur, key = false) => {
      while (venc.encodeQueueSize > 4) { check(); await fastYield(); }
      const ts = Math.max(Math.round(sec * 1e6), lastTs + 1);
      const keyFrame = key || ts - lastKey >= FAST_KEY_US;
      if (keyFrame) lastKey = ts;
      lastTs = ts;
      const vf = new VideoFrame(canvas, { timestamp: ts, duration: Math.max(1, Math.round(dur * 1e6)) });
      venc.encode(vf, { keyFrame });
      vf.close();
    };
    const still = async (sec) => {   // l'image du canvas, tenue sec secondes
      const n = Math.max(1, Math.round(sec * FAST_FPS));
      for (let k = 0; k < n; k++) await encode(outT + k / FAST_FPS, 1 / FAST_FPS, k === 0);
      outT += sec;
      audio?.padTo(outT);
      check();
    };

    opts.onStatus?.('Génération rapide en cours…');
    for (const [i, it] of items.entries()) {
      const seq = it.seq, src = sources.get(it.src), label = seq.label || 'Séquence';
      const caption = `${i + 1} / ${items.length} · ${label}`;
      if (opts.titles) {
        drawTitleCard(ctx, W, H, { index: i + 1, count: items.length, label, player: opts.playerName, dur: seq.end_sec - seq.start_sec });
        await still(COMPILE_TITLE_MS / 1000);
      }
      const frames = opts.ink ? compileFrames(seq) : [];
      const holds = frames.filter(f => f.freeze), done = new Set();
      const base = outT;
      let held = 0, soundFrom = seq.start_sec, last = null, lastT = seq.start_sec - .01;
      const sound = (to) => { if (audio && to > soundFrom) { audio.padTo(base + (soundFrom - seq.start_sec) + held); audio.pcm(src.audio, soundFrom, to); } soundFrom = Math.max(soundFrom, to); };
      const hold = async (h, frame, t) => {   // arrêt sur image, avec son habillage
        done.add(h);
        sound(t);
        const r = fastDrawFrame(ctx, frame, W, H, src.rotation);
        ctx.save(); ctx.translate(r.x, r.y); paintInk(ctx, h.shapes, { w: r.w, h: r.h }); ctx.restore();
        drawCaption(ctx, W, H, caption);
        outT = base + (t - seq.start_sec) + held;
        await still(h.d);
        held += h.d;
      };
      await fastDecodeRange(src, seq.start_sec, seq.end_sec, async (frame, t) => {
        for (const h of holds) if (!done.has(h) && lastT < h.t && h.t <= t + .04) await hold(h, frame, t);
        const r = fastDrawFrame(ctx, frame, W, H, src.rotation);
        const shapes = frames.filter(f => !f.freeze && t >= f.t - .05 && t < f.t + f.d).flatMap(f => f.shapes);
        if (shapes.length) { ctx.save(); ctx.translate(r.x, r.y); paintInk(ctx, shapes, { w: r.w, h: r.h }); ctx.restore(); }
        drawCaption(ctx, W, H, caption);
        outT = base + (t - seq.start_sec) + held;
        await encode(outT, (frame.duration || 1e6 / FAST_FPS) / 1e6, lastT < seq.start_sec);
        lastT = t;
        last?.close(); last = frame.clone();
        check();
      });
      // Arrêt sur image posé tout à la fin de la séquence : sur la dernière image.
      for (const h of holds) if (!done.has(h) && last && h.t <= seq.end_sec + .05) await hold(h, last, lastT);
      last?.close();
      sound(seq.end_sec);
      outT = base + (seq.end_sec - seq.start_sec) + held;
      audio?.padTo(outT);
    }
    await venc.flush();
    await aenc?.flush();
    if (failure) throw failure;
    muxer.finalize();
    opts.onProgress?.(1);
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  } finally {
    [venc, aenc].forEach(c => { if (c && c.state !== 'closed') c.close(); });
  }
}
