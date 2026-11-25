/* ============================================================
   LMFC Performance — match-video.js (Retours de match)
   Rubrique « Vidéo et analyse » d'un match enregistré (lmfc_v74.sql, lmfc_v75.sql) :
     - « Envoyer la vidéo du match » : le fichier part une fois sur R2, rangé
       sous un joueur de la feuille (de l'équipe du match d'abord) ; chaque
       joueur de la feuille reçoit sa ligne player_videos sur ce même fichier,
       reliée au match (match_id) : il la voit dans « Mes vidéos » ;
     - une vidéo par fichier, avec le nombre de joueurs qui l'ont ; « Donner à
       toute la feuille » : ceux ajoutés depuis la reçoivent aussi ;
     - « Importer un XML Sportscode » : la fenêtre de l'Analyse (analyse-import-ui.js),
       chaque ligne du XML reliée à un joueur, ses séquences sur sa ligne de vidéo.
   Staff vidéo seulement (admin, coach, analyste) ; la base décide joueur par
   joueur (RLS de player_videos) : un refus est compté, le reste passe.
   Dépend de matchs-page.js (editing, myProfile, clubPlayers, playerOf, playerName),
   supabase-client.js (uploadVideoFile), video-status.js (fileThumb), app.js.
   ============================================================ */

const MV = { match: null, videos: [], busy: false };
const mvCan = () => ['admin', 'coach', 'analyste'].includes(myProfile?.role);
const mvExt = (name) => (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] || 'mp4').toLowerCase();
const mvSheet = () => [...(editing?.rows?.keys() || [])];
const mvTitle = (m) => `Match contre ${m.adversaire || 'adversaire'} – ${fmtDateFr(m.date_match)}`;

/* À l'ouverture d'un match (openMatch) : ses vidéos, ou rien pour un nouveau match. */
async function mvShow(m) {
  const box = document.getElementById('mvBox');
  MV.match = m?.id ? m : null;
  box.classList.toggle('hidden', !MV.match || !mvCan());
  if (MV.match && mvCan()) await mvLoad();
}

async function mvLoad() {
  const list = document.getElementById('mvList'), id = MV.match?.id;
  const { data, error } = await sb.from('player_videos').select('id, club_id, player_id, storage_path, titre, description, lieu, thumb, match_id, created_at')
    .eq('match_id', id).order('created_at');
  if (id !== MV.match?.id) return;   // un autre match a été ouvert entre-temps
  if (error) {
    console.error('Vidéos du match illisibles', error);
    list.innerHTML = `<p class="text-muted">${escapeHtml(['42703', 'PGRST204'].includes(error.code) ? 'Passez lmfc_v75.sql dans Supabase pour relier une vidéo à un match.' : error.message)}</p>`;
    return;
  }
  const by = new Map();
  (data || []).forEach(v => by.set(v.storage_path, [...(by.get(v.storage_path) || []), v]));
  MV.videos = [...by.values()];
  mvDraw();
}

function mvDraw() {
  const sheet = mvSheet();
  document.getElementById('mvList').innerHTML = MV.videos.length ? MV.videos.map((rows, i) => {
    const missing = sheet.filter(pid => !rows.some(r => r.player_id === pid)).length;
    return `<article class="mv-item">
      <div class="mv-what"><b>${escapeHtml(rows[0].titre)}</b><small>${rows.length} joueur${rows.length > 1 ? 's' : ''} la voi${rows.length > 1 ? 'ent' : 't'}</small></div>
      <div class="mv-acts"><button type="button" class="btn btn-sm btn-primary" data-mv-xml="${i}">Importer un XML Sportscode</button>
        ${missing ? `<button type="button" class="btn btn-sm" data-mv-give="${i}">La donner aussi à ${missing} joueur${missing > 1 ? 's' : ''} de la feuille</button>` : ''}</div>
    </article>`;
  }).join('') : '<p class="text-muted mv-empty">Aucune vidéo pour ce match. Envoyez-la une fois : chaque joueur de la feuille la reçoit.</p>';
}

/* Lignes de vidéo pour ces joueurs, sur le fichier de `from` ; rend le nombre de refus (RLS). */
async function mvGive(from, pids) {
  let refused = 0;
  for (const pid of pids) {
    const row = { club_id: from.club_id, player_id: pid, storage_path: from.storage_path, titre: from.titre, match_id: MV.match.id,
      ...(from.thumb ? { thumb: from.thumb } : {}), ...(from.lieu ? { lieu: from.lieu } : {}) };
    const { error } = await sb.from('player_videos').insert(row);
    if (error) { refused++; console.warn('Vidéo du match refusée pour', pid, error.message); }
  }
  return refused;
}

/* Envoi : rangé sous un joueur de la feuille, de l'équipe du match d'abord (le Worker vérifie qu'on peut le modifier). */
async function mvUpload(file) {
  const m = MV.match, sheet = mvSheet(), prog = document.getElementById('mvProg');
  if (!file.type.startsWith('video/')) return toast('Choisissez un fichier vidéo.', 'error');
  if (file.size > VIDEO_MAX_BYTES) return toast(`Vidéo trop lourde : ${VIDEO_MAX_BYTES / 1024 ** 3} Go au plus.`, 'error');
  if (!sheet.length) return toast('Ajoutez d’abord les joueurs du match (et enregistrez) : ce sont eux qui reçoivent la vidéo.', 'error');
  const owner = sheet.find(pid => m.team_id && playerInTeam(playerOf(pid) || {}, m.team_id)) ?? sheet[0];
  const path = `r2/${myProfile.club_id}/${owner}/${Date.now()}.${mvExt(file.name)}`, thumbP = fileThumb(file);
  MV.busy = true;
  prog.classList.remove('hidden');
  const show = (t) => { prog.querySelector('span').textContent = t; };
  try {
    await uploadVideoFile(path, file, { onProgress: (p) => { prog.querySelector('progress').value = Math.round(p * 100); show(`Envoi… ${Math.round(p * 100)} %`); } });
    show('Enregistrement…');
    const thumb = await thumbP, from = { club_id: myProfile.club_id, storage_path: path, titre: mvTitle(m), thumb };
    const { error } = await sb.from('player_videos').insert({ club_id: from.club_id, player_id: owner, storage_path: path, titre: from.titre, match_id: m.id, ...(thumb ? { thumb } : {}) });
    if (error) throw error;
    const refused = await mvGive(from, sheet.filter(pid => pid !== owner));
    toast(`Vidéo envoyée : ${sheet.length - refused} joueur${sheet.length - refused > 1 ? 's la voient' : ' la voit'}${refused ? ` (${refused} refusé${refused > 1 ? 's' : ''} : joueurs d’une équipe que vous ne gérez pas)` : ''}.`, refused ? 'info' : 'success');
  } catch (err) {
    console.error('Vidéo du match non envoyée', err);
    toast(err.message, 'error');
  } finally {
    MV.busy = false;
    prog.classList.add('hidden');
  }
  await mvLoad();
}

document.getElementById('mvBox')?.addEventListener('click', async (e) => {
  const xml = e.target.closest('[data-mv-xml]'), give = e.target.closest('[data-mv-give]');
  if (MV.busy || (!xml && !give)) return;
  const rows = MV.videos[Number((xml || give).dataset.mvXml ?? (xml || give).dataset.mvGive)];
  if (give) {
    give.disabled = true;
    const missing = mvSheet().filter(pid => !rows.some(r => r.player_id === pid)), refused = await mvGive(rows[0], missing);
    toast(refused ? `${missing.length - refused} de plus ; ${refused} refusé${refused > 1 ? 's' : ''}.` : `${missing.length} joueur${missing.length > 1 ? 's la reçoivent' : ' la reçoit'} aussi.`, refused ? 'info' : 'success');
    return mvLoad();
  }
  scOpen({ video: rows[0], clips: () => [], dur: () => 0, done: () => mvLoad() });   // analyse-import-ui.js
});
document.getElementById('mvFile')?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file && !MV.busy) mvUpload(file);
});
