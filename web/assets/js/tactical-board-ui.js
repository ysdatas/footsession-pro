/* ============================================================
   LMFC Performance — tactical-board-ui.js
   Ce qui entoure le terrain :
     - barre de droite : un clic ouvre le panneau (Matériel,
       Terrain, Couleurs, Exporter, Vidéo), un second le ferme ;
     - vidéo liée : on associe une vidéo déjà sur la plateforme
       au procédé (tactical_schemas.video_id) ou à l'exercice
       (program_exercises.video_id), sans rien réimporter ;
     - fiche tactique PDF : titre, objectif, consignes, schéma
       (une image par étape) et vidéo liée.
   S'appuie sur l'état et les fonctions de tactical-board.js.
   ============================================================ */

let tbVideos = [];        // vidéos proposées
let tbLinkedVideo = null; // vidéo liée (ligne player_videos)

/* ---------- Panneaux ---------- */
function openPane(name) {
  const drawer = document.getElementById('tbDrawer');
  const same = !drawer.classList.contains('hidden') && drawer.dataset.pane === name;
  drawer.classList.toggle('hidden', same || !name);
  drawer.dataset.pane = same ? '' : (name || '');
  $$('.tb-pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== name || same));
  $$('.tb-railbtn').forEach(b => b.classList.toggle('active', !same && b.dataset.panel === name));
  if (!same && name === 'video') renderVideoList();
}
$$('.tb-railbtn').forEach(b => b.addEventListener('click', () => openPane(b.dataset.panel)));
document.getElementById('tbDrawer').addEventListener('click', (e) => { if (e.target.closest('[data-close-pane]')) openPane(null); });

document.getElementById('tbClose').addEventListener('click', () => {
  if (window.opener && !window.opener.closed) window.close();
  else if (history.length > 1) history.back();
  else location.href = 'dashboard.html';
});

/* ---------- Vidéo liée ---------- */
const videoOwner = (v) => `${v.players?.prenom || ''} ${v.players?.nom || ''}`.trim();

async function loadTbVideos() {
  // Exercice d'un joueur : seulement SES vidéos (le joueur doit pouvoir la voir).
  let q = sb.from('player_videos').select('id, titre, storage_path, created_at, player_id, players(nom, prenom)').order('created_at', { ascending: false });
  if (EXO_ROW) q = q.eq('player_id', EXO_ROW.player_id);
  const { data, error } = await q;
  if (error) console.error('Vidéos illisibles', error);
  tbVideos = data || [];
  const id = EXO_ROW ? EXO_ROW.video_id : PROC_SCHEMA?.video_id;
  tbLinkedVideo = tbVideos.find(v => v.id === id) || null;
  syncVideoChip();
}

function syncVideoChip() {
  const chip = document.getElementById('tbVideoChip');
  chip.classList.toggle('hidden', !tbLinkedVideo);
  if (tbLinkedVideo) chip.textContent = `▶ ${tbLinkedVideo.titre}`;
}

function renderVideoList() {
  const q = (document.getElementById('videoSearch').value || '').trim().toLowerCase();
  const list = tbVideos.filter(v => !q || `${v.titre} ${videoOwner(v)}`.toLowerCase().includes(q));
  document.getElementById('videoPaneHint').textContent = EXO_ROW
    ? 'Vidéos de ce joueur déjà sur la plateforme : il pourra la regarder depuis son exercice.'
    : 'Associez une vidéo déjà présente sur la plateforme : pas besoin de la réimporter.';
  document.getElementById('videoList').innerHTML = (tbLinkedVideo
    ? `<button class="tb-tool danger" type="button" data-unlink>Retirer la vidéo liée</button>` : '')
    + (list.length ? list.map(v => `
      <button type="button" class="tb-video${tbLinkedVideo?.id === v.id ? ' active' : ''}" data-link-video="${v.id}">
        <strong>${escapeHtml(v.titre)}</strong>
        <span>${escapeHtml([videoOwner(v), new Date(v.created_at).toLocaleDateString('fr-FR')].filter(Boolean).join(' · '))}</span>
      </button>`).join('') : '<p class="tb-card-hint">Aucune vidéo trouvée.</p>');
}
document.getElementById('videoSearch').addEventListener('input', renderVideoList);

async function linkVideo(videoId) {
  if (!CAN_EDIT) return;
  let error;
  if (EXO_ROW) {
    ({ error } = await sb.from('program_exercises').update({ video_id: videoId }).eq('id', EXO_ROW.id));
    if (!error) EXO_ROW.video_id = videoId;
  } else if (PROC) {
    ({ error } = await sb.from('tactical_schemas').upsert({ procedure_id: PROC, video_id: videoId }, { onConflict: 'procedure_id' }));
    if (!error) PROC_SCHEMA = { ...(PROC_SCHEMA || {}), video_id: videoId };
  }
  if (error) {
    console.error('Vidéo non liée', error);
    return toast(/video_id/.test(error.message) ? 'Base à mettre à jour : exécutez supabase/platform_v2.sql.' : error.message, 'error');
  }
  tbLinkedVideo = tbVideos.find(v => v.id === videoId) || null;
  syncVideoChip(); renderVideoList();
  toast(videoId ? 'Vidéo liée.' : 'Vidéo retirée.', 'success');
}
document.getElementById('videoList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-link-video]');
  if (b) return linkVideo(Number(b.dataset.linkVideo));
  if (e.target.closest('[data-unlink]')) linkVideo(null);
});

document.getElementById('tbVideoChip').addEventListener('click', async () => {
  if (!tbLinkedVideo) return;
  const src = await videoUrl(tbLinkedVideo.storage_path).catch(e => { console.warn('Vidéo liée', e); return null; });
  if (!src) return toast('Vidéo introuvable dans le stockage.', 'error');
  openLightbox({ title: tbLinkedVideo.titre, text: videoOwner(tbLinkedVideo), items: [{ type: 'video', src }] });
});

/* ---------- Fiche tactique PDF ---------- */
const TB_HTML2PDF_URL = 'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js';
function tbLoadHtml2pdf() {
  if (window.html2pdf) return Promise.resolve(window.html2pdf);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TB_HTML2PDF_URL;
    script.onload = () => resolve(window.html2pdf);
    script.onerror = () => reject(new Error('Générateur PDF indisponible (connexion ?)'));
    document.head.append(script);
  });
}

function openSheet() {
  const title = EXO_ROW?.title || PROC_ROW?.nom || '';
  const goal = PROC_ROW?.objectif || (EXO_ROW?.dosage ? `Dosage : ${EXO_ROW.dosage}` : '');
  const text = EXO_ROW?.instructions || [PROC_ROW?.consignes,
    PROC_ROW?.effectif ? `Effectif : ${PROC_ROW.effectif}` : '',
    PROC_ROW?.taille_terrain ? `Terrain : ${PROC_ROW.taille_terrain}` : '',
    PROC_ROW?.duree_min ? `Durée : ${PROC_ROW.duree_min} min` : ''].filter(Boolean).join('\n');
  document.getElementById('sheetTitle').value = title;
  document.getElementById('sheetGoal').value = goal;
  document.getElementById('sheetText').value = text;
  openModal('sheetModal');
  setTimeout(() => document.getElementById('sheetTitle').focus(), 50);
}

/* Une image par étape (ou l'image affichée s'il n'y a pas d'étapes). */
function sheetImages() {
  if (state.steps.length < 2) return [exportClean()];
  recordStep();
  const keep = state.curStep;
  const imgs = state.steps.map(step => { applySnapshot(step); return exportClean(); });
  if (keep !== null) applySnapshot(state.steps[keep]);
  render();
  return imgs;
}

async function runSheet() {
  const btn = document.getElementById('sheetRun');
  btn.disabled = true; btn.textContent = 'Génération…';
  try {
    const title = document.getElementById('sheetTitle').value.trim() || 'Fiche tactique';
    const goal = document.getElementById('sheetGoal').value.trim();
    const text = document.getElementById('sheetText').value.trim();
    const imgs = sheetImages();
    const club = window.CURRENT_PROFILE?.clubs?.nom || 'LMFC Performance';
    const para = (t) => escapeHtml(t).replace(/\n/g, '<br>');
    const sheet = document.createElement('div');
    sheet.className = 'tb-sheet';
    sheet.innerHTML = `
      <header><div class="tb-sheet-eyebrow">${escapeHtml(club)} · Fiche tactique · ${escapeHtml(new Date().toLocaleDateString('fr-FR'))}</div>
        <h1>${escapeHtml(title)}</h1></header>
      ${goal ? `<section><h2>Objectif</h2><p>${para(goal)}</p></section>` : ''}
      ${text ? `<section><h2>Consignes</h2><p>${para(text)}</p></section>` : ''}
      <section><h2>Schéma${imgs.length > 1 ? ` — ${imgs.length} étapes` : ''}</h2>
        <div class="tb-sheet-imgs${imgs.length > 1 ? ' is-steps' : ''}">${imgs.map((src, i) => `
          <figure><img src="${src}" alt="">${imgs.length > 1 ? `<figcaption>Étape ${i + 1}</figcaption>` : ''}</figure>`).join('')}</div>
      </section>
      ${tbLinkedVideo ? `<section><h2>Vidéo</h2><p>${escapeHtml(tbLinkedVideo.titre)}${videoOwner(tbLinkedVideo) ? ` — ${escapeHtml(videoOwner(tbLinkedVideo))}` : ''} (à voir sur LMFC Performance)</p></section>` : ''}`;
    // Feuille hors écran dans un conteneur : html2pdf la clone telle quelle.
    const holder = el('div', { class: 'tb-sheet-holder', 'aria-hidden': 'true' }, sheet);
    document.body.append(holder);
    await Promise.all([...sheet.querySelectorAll('img')].map(img => img.complete ? null
      : new Promise(r => { img.onload = img.onerror = r; })));
    const html2pdf = await tbLoadHtml2pdf();
    const file = `fiche-${title.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tactique'}.pdf`;
    await html2pdf().set({
      margin: [10, 10, 12, 10], filename: file,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['figure', 'section'] },
    }).from(sheet).save();
    closeModal('sheetModal');
    toast('Fiche tactique téléchargée.', 'success');
  } catch (e) {
    console.error('Fiche tactique non générée', e);
    toast(e.message || 'Génération impossible.', 'error');
  } finally {
    document.querySelectorAll('.tb-sheet-holder').forEach(n => n.remove());
    btn.disabled = false; btn.textContent = 'Générer le PDF';
  }
}
document.getElementById('exportSheet').addEventListener('click', openSheet);
document.getElementById('sheetRun').addEventListener('click', runSheet);

/* ---------- Démarrage ---------- */
BOOTED.then(async () => {
  const linkable = CAN_EDIT && (PROC || EXO_ROW);
  document.getElementById('railVideo').classList.toggle('hidden', !linkable);
  if (PROC || EXO_ROW) await loadTbVideos();
}).catch(e => console.error('tactical-board-ui', e));
