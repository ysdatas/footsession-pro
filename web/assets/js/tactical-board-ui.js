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
    return toast(/video_id/.test(error.message) ? updateNeeded('platform_v2.sql') : error.message, 'error');
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
  let src = null;
  try { src = await videoUrl(tbLinkedVideo.storage_path); } catch (e) {
    console.warn('Vidéo liée', e);
    return toast(`Lecture impossible : ${e.message}`, 'error');
  }
  if (!src) return toast('Vidéo introuvable dans le stockage.', 'error');
  openLightbox({ title: tbLinkedVideo.titre, text: videoOwner(tbLinkedVideo), items: [{ type: 'video', src }] });
});

/* ---------- Fiche tactique PDF (mise en page commune : pdf-kit.js) ---------- */
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
    const club = window.CURRENT_PROFILE?.clubs?.nom || 'Le Mans FC';
    const k = await openPdf({ accent: window.CURRENT_PROFILE?.clubs?.color, runTitle: title, runRight: club });
    k.cover({
      kicker: `${club} · Fiche tactique`, title,
      subtitle: imgs.length > 1 ? `${imgs.length} étapes` : '',
      facts: [['Édité le', new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })]],
    });
    if (goal) { k.section('Objectif', { keep: 12 }); k.text(goal, { size: 9.6 }); k.y += 2; }
    if (text) { k.section('Consignes', { keep: 12 }); k.text(text, { size: 9.6 }); k.y += 2; }
    k.section(imgs.length > 1 ? 'Schéma, étape par étape' : 'Schéma', { keep: 60 });
    if (imgs.length > 1) await k.images(imgs.map((src, i) => ({ src, caption: `Étape ${i + 1}` })), { perRow: 2, maxH: 70 });
    else await k.images([{ src: imgs[0] }], { perRow: 1, maxH: k.bottom - k.y - 4 });
    if (tbLinkedVideo) {
      k.section('Vidéo', { keep: 10 });
      k.text(`${tbLinkedVideo.titre}${videoOwner(tbLinkedVideo) ? ` — ${videoOwner(tbLinkedVideo)}` : ''} (à voir sur LMFC Performance)`);
    }
    k.save(pdfFileName('fiche', title));
    closeModal('sheetModal');
    toast('Fiche tactique téléchargée.', 'success');
  } catch (e) {
    console.error('Fiche tactique non générée', e);
    toast(e.message || 'Génération impossible.', 'error');
  } finally {
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
