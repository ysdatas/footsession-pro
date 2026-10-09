/* ============================================================
   LMFC Performance — trash-page.js (trash.html)
   Corbeille : chaque élément supprimé (séance, vidéo, objectif…)
   avec ce qui est parti avec lui. Restaurer le remet tel quel ;
   supprimer définitivement efface aussi ses fichiers (vidéo,
   images). Chacun ne voit que ce qu'il avait le droit de supprimer
   (RLS : trash_right dans supabase/lmfc_v5.sql).
   ============================================================ */

const clip = (t, n) => { t = String(t || '').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const TRASH_TYPES = {
  players:                  { label: 'Joueur',              name: (d) => `${d.prenom || ''} ${d.nom || ''}`.trim() || 'Joueur' },
  sessions:                 { label: 'Séance',              name: (d) => `${d.titre || 'Séance'}${d.date_seance ? ` · ${fmtDate(d.date_seance)}` : ''}` },
  procedures:               { label: 'Exercice de séance',  name: (d) => d.nom || 'Procédé' },
  player_videos:            { label: 'Vidéo',               name: (d) => d.titre || 'Vidéo' },
  video_sequences:          { label: 'Séquence',            name: (d) => d.label || 'Séquence' },
  player_performance_notes: { label: 'Objectif',            name: (d) => d.title || clip(d.body, 70) || 'Sans titre' },
  program_exercises:        { label: 'Exercice du programme', name: (d) => d.title || 'Exercice' },
  player_career:            { label: 'Parcours',            name: (d) => [d.club_name, d.categorie].filter(Boolean).join(' · ') || 'Club' },
  exercise_templates:       { label: 'Modèle d’exercice',   name: (d) => d.nom || 'Modèle' },
  teams:                    { label: 'Équipe',              name: (d) => d.nom || 'Équipe' },
  matches:                  { label: 'Match',               name: (d) => `${d.adversaire || 'Match'}${d.date_match ? ` · ${fmtDate(d.date_match)}` : ''}` },
};
const NOTE_KIND_LABELS = { objective: 'Objectif', prevention: 'Prévention', strength: 'Point fort', improvement: 'Axe d’amélioration' };
const typeLabel = (row) => (row.tbl === 'player_performance_notes' ? NOTE_KIND_LABELS[row.data.kind] || 'Objectif'
  : TRASH_TYPES[row.tbl]?.label || row.tbl);
/* Lignes liées, dites simplement (« 3 exercices, 2 présences »). */
const CHILD_WORDS = {
  procedures: ['exercice', 'exercices'], tactical_schemas: ['schéma', 'schémas'], attendance: ['présence', 'présences'],
  session_comments: ['commentaire', 'commentaires'], match_players: ['joueur du match', 'joueurs du match'], session_access: ['droit d’accès', 'droits d’accès'], video_sequences: ['séquence', 'séquences'], video_views: ['visionnage', 'visionnages'],
  player_video_selections: ['sélection', 'sélections'], player_performance_media: ['image', 'images'], session_bilans: ['bilan', 'bilans'],
  player_videos: ['vidéo', 'vidéos'], player_performance_notes: ['objectif ou prévention', 'objectifs et préventions'],
  player_physical_measurements: ['mesure', 'mesures'], player_physical_tests: ['session de tests', 'sessions de tests'],
  program_exercises: ['exercice du programme', 'exercices du programme'], player_career: ['club du parcours', 'clubs du parcours'],
  player_programs: ['ancienne prévention', 'anciennes préventions'], club_access: ['accès en attente', 'accès en attente'],
};

const trash = { roots: [], kids: new Map(), players: new Map(), people: new Map(), picked: new Set() };

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });
  if (!isStaffRole(ctx.profile.role)) return showEmpty('La corbeille est réservée au staff.');
  if (!(await trashReady())) {
    return showEmpty('La corbeille n’est pas encore activée : l’administrateur doit exécuter supabase/lmfc_v5.sql dans Supabase. D’ici là, une suppression reste définitive.');
  }
  bindTrash();
  await loadTrash();
})();

function showEmpty(msg) {
  document.getElementById('trashToolbar').hidden = true;
  document.getElementById('trashList').innerHTML = `<div class="trash-empty">${escapeHtml(msg)}</div>`;
}

async function loadTrash() {
  const [tRes, pRes, mRes] = await Promise.all([
    sb.from('trash').select('id, tbl, row_id, root_id, root_tbl, data, deleted_by, deleted_at').order('deleted_at', { ascending: false }).limit(1000),
    sb.from('players').select('id, prenom, nom'),
    sb.from('profiles').select('id, nom'),
  ]);
  if (tRes.error) {
    console.error('Corbeille illisible', tRes.error);
    return showEmpty(`Lecture impossible : ${tRes.error.message}`);
  }
  if (mRes.error) console.warn('Auteurs des suppressions indisponibles', mRes.error.message);
  trash.players = new Map((pRes.data || []).map(p => [p.id, `${p.prenom || ''} ${p.nom || ''}`.trim()]));
  trash.people = new Map((mRes.data || []).map(p => [p.id, p.nom]));
  const rows = tRes.data || [];
  trash.roots = rows.filter(r => !r.root_id);
  trash.kids = new Map();
  rows.filter(r => r.root_id).forEach(r => trash.kids.set(r.root_id, [...(trash.kids.get(r.root_id) || []), r]));
  trash.picked = new Set([...trash.picked].filter(id => trash.roots.some(r => r.id === id)));

  const types = [...new Set(trash.roots.map(typeLabel))].sort((a, b) => a.localeCompare(b, 'fr'));
  const sel = document.getElementById('trashType');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Tous les éléments</option>' + types.map(t => `<option>${escapeHtml(t)}</option>`).join('');
  sel.value = types.includes(cur) ? cur : '';
  restoreRemembered(sel.parentElement);
  render();
}

function render() {
  const filter = document.getElementById('trashType').value;
  const shown = trash.roots.filter(r => !filter || typeLabel(r) === filter);
  const n = trash.roots.length;
  document.getElementById('trashSub').textContent = n
    ? `${n} élément${n > 1 ? 's' : ''} supprimé${n > 1 ? 's' : ''}. Restaurez-les tels qu’ils étaient, ou supprimez-les pour de bon.`
    : 'Rien dans la corbeille.';
  document.getElementById('trashToolbar').hidden = !n;
  const list = document.getElementById('trashList');
  if (!n) { list.innerHTML = '<div class="trash-empty">Rien dans la corbeille. Un élément supprimé apparaît ici et peut être restauré.</div>'; return syncBulk(); }
  list.innerHTML = shown.map(r => {
    const kids = trash.kids.get(r.id) || [];
    const counts = Object.entries(kids.reduce((m, k) => ({ ...m, [k.tbl]: (m[k.tbl] || 0) + 1 }), {}))
      .filter(([t]) => CHILD_WORDS[t])
      .map(([t, c]) => `${c} ${CHILD_WORDS[t][c > 1 ? 1 : 0]}`);
    const who = trash.players.get(Number(r.data.player_id));
    const by = trash.people.get(r.deleted_by);
    const when = new Date(r.deleted_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    const name = TRASH_TYPES[r.tbl]?.name(r.data) || '—';
    return `<label class="trash-row">
      <input type="checkbox" data-id="${r.id}" ${trash.picked.has(r.id) ? 'checked' : ''} aria-label="Choisir ${escapeHtml(name)}">
      <span class="trash-main">
        <span class="trash-type">${escapeHtml(typeLabel(r))}</span>
        <strong>${escapeHtml(name)}</strong>
        <small>${escapeHtml(capFirst([who, counts.length ? `avec ${counts.join(', ')}` : '', `supprimé le ${when}`, by ? `par ${by}` : ''].filter(Boolean).join(' · ')))}</small>
      </span>
      <span class="trash-actions">
        <button class="btn btn-sm" type="button" data-restore="${r.id}">Restaurer</button>
        <button class="btn btn-sm btn-danger" type="button" data-purge="${r.id}" aria-label="Supprimer définitivement">Supprimer</button>
      </span>
    </label>`;
  }).join('') || '<div class="trash-empty">Aucun élément de ce type.</div>';
  syncBulk();
}

function syncBulk() {
  const k = trash.picked.size;
  document.getElementById('trashCount').textContent = k ? `${k} sélectionné${k > 1 ? 's' : ''}` : '';
  document.getElementById('trashRestore').disabled = !k;
  document.getElementById('trashPurge').disabled = !k;
}

function bindTrash() {
  document.getElementById('trashType').addEventListener('change', render);
  const list = document.getElementById('trashList');
  list.addEventListener('change', (e) => {
    const id = Number(e.target.dataset?.id);
    if (!id) return;
    if (e.target.checked) trash.picked.add(id); else trash.picked.delete(id);
    syncBulk();
  });
  list.addEventListener('click', (e) => {
    const r = e.target.closest('[data-restore]'), p = e.target.closest('[data-purge]');
    if (!r && !p) return;
    e.preventDefault();   // dans un <label> : ne pas cocher la case
    if (r) restore([Number(r.dataset.restore)]);
    else purge([Number(p.dataset.purge)]);
  });
  document.getElementById('trashRestore').addEventListener('click', () => restore([...trash.picked]));
  document.getElementById('trashPurge').addEventListener('click', () => purge([...trash.picked]));
}

async function restore(ids) {
  if (!ids.length) return;
  setBusy(true);
  try {
    const { data, error } = await sb.rpc('trash_restore', { p_ids: ids });
    if (error) throw error;
    ids.forEach(id => trash.picked.delete(id));
    toast(`${data || ids.length} élément${(data || ids.length) > 1 ? 's' : ''} restauré${(data || ids.length) > 1 ? 's' : ''}.`, 'success');
  } catch (e) {
    console.error('Restauration impossible', e);
    toast(e.message, 'error');
  } finally { setBusy(false); }
  await loadTrash();
}

/* Suppression définitive : les fichiers d'abord (vidéo sur R2 ou
   Supabase, images), puis les lignes de la corbeille. Un fichier déjà
   absent n'empêche rien. */
async function purge(ids) {
  if (!ids.length) return;
  const roots = trash.roots.filter(r => ids.includes(r.id));
  const label = roots.length === 1 ? `« ${TRASH_TYPES[roots[0].tbl]?.name(roots[0].data) || 'cet élément'} »` : `ces ${roots.length} éléments`;
  if (!confirm(`Supprimer définitivement ${label} ? Fichiers compris, plus aucune restauration possible.`)) return;
  setBusy(true);
  try {
    const rows = roots.flatMap(r => [r, ...(trash.kids.get(r.id) || [])]);
    const videos = rows.filter(r => r.tbl === 'player_videos').map(r => r.data.storage_path).filter(Boolean);
    const media = rows.flatMap(r => (r.tbl === 'player_performance_media' ? [r.data.storage_path]
      : r.tbl === 'program_exercises' ? [r.data.image_path, r.data.schema_path] : [])).filter(Boolean);
    const schemas = rows.filter(r => r.tbl === 'tactical_schemas').map(r => r.data.image_path).filter(Boolean);
    const photos = rows.filter(r => r.tbl === 'players').map(r => r.data.photo_path).filter(Boolean);
    const fileErrors = [];
    await Promise.all([
      ...videos.map(p => removeVideoFile(p).catch(e => fileErrors.push(`${p} : ${e.message}`))),
      media.length && sb.storage.from('player-performance-media').remove(media).then(({ error }) => error && fileErrors.push(error.message)),
      schemas.length && sb.storage.from('schemas').remove(schemas).then(({ error }) => error && fileErrors.push(error.message)),
      photos.length && sb.storage.from('player-photos').remove(photos).then(({ error }) => error && fileErrors.push(error.message)),
    ]);
    if (fileErrors.length) console.warn('Fichiers non retirés du stockage (orphelins)', fileErrors);
    const { error } = await sb.from('trash').delete().or(`id.in.(${ids.join(',')}),root_id.in.(${ids.join(',')})`);
    if (error) throw error;
    ids.forEach(id => trash.picked.delete(id));
    toast(roots.length > 1 ? `${roots.length} éléments supprimés définitivement.` : 'Supprimé définitivement.', 'success');
  } catch (e) {
    console.error('Suppression définitive impossible', e);
    toast(e.message, 'error');
  } finally { setBusy(false); }
  await loadTrash();
}

function setBusy(on) {
  document.querySelectorAll('#trashList button, #trashToolbar button').forEach(b => { b.disabled = on; });
  if (!on) syncBulk();
}
