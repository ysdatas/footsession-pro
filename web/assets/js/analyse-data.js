/* ============================================================
   LMFC Performance — analyse-data.js
   Onglet Analyse : lecture et écriture Supabase (lmfc_v48.sql, lmfc_v49.sql).
   Sécurité : RLS (player_videos, video_sequences, sequence_codes,
   sequence_descriptors) ; l'interface ne fait que masquer ce que la base
   refuserait. Un clip et son codage s'écrivent en UNE transaction
   (save_sequence_code), plusieurs clips aussi (bulk_update_sequence_codes).
   ============================================================ */

/* Table, colonne ou fonction absente : la migration manque, on dit laquelle. Tout autre refus
   (droits, valeur hors liste, message d'une fonction) est rendu tel quel. */
function anDbError(context, err) {
  console.error(`Analyse : ${context}`, err);
  const msg = err?.message || '';
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(err?.code)) {
    const v49 = /staff_only|minute_match|sequence_descriptors|save_sequence_code|bulk_update_sequence_codes|undo_sequence_changes/i.test(msg);
    return new Error(`La migration ${v49 ? 'lmfc_v49.sql' : 'lmfc_v48.sql'} n’est pas passée dans Supabase, ou pas dans sa dernière version.`);
  }
  return new Error(msg || 'Erreur inconnue.');
}

/* Vidéos, séquences, codages du joueur et catalogue des descripteurs du club, lus ensemble. */
async function anFetch(playerId) {
  const [v, s, c, d] = await Promise.all([
    sb.from('player_videos').select('*').eq('player_id', playerId).order('created_at', { ascending: false }),
    sb.from('video_sequences').select('id, video_id, club_id, label, start_sec, end_sec').eq('player_id', playerId).order('start_sec'),
    sb.from('sequence_codes').select('*').eq('player_id', playerId),
    sb.from('sequence_descriptors').select('*').order('nom'),
  ]);
  const err = v.error || s.error || c.error || d.error;
  if (err) throw anDbError('lecture impossible', err);
  return { videos: v.data, clips: anMerge(v.data, s.data, c.data), descs: d.data };
}

async function anRpc(context, fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw anDbError(context, error);
  return data;
}

/* Enregistre un clip et son codage ensemble ; clip.id absent : le clip est créé, toujours
   réservé au staff (la base le pose elle-même). Les champs que l'action ne porte pas sont vidés (anFields).
   Rend l'identifiant de la séquence. Un refus ne laisse rien derrière lui. */
function anCodePayload(draft) {
  const keep = anFields(draft.action), code = { tags: draft.tags ?? [] };
  for (const k of AN_CODE_FIELDS) if (k !== 'tags') code[k] = keep.includes(k) ? draft[k] ?? null : null;
  return code;
}
function anSaveCode(clip, draft) {
  return anRpc(`clip ${clip.id ?? 'nouveau'} refusé`, 'save_sequence_code', { p_sequence_id: clip.id ?? null, p_video_id: clip.video_id,
    p_label: clip.label ?? null, p_start: draft.start_sec, p_end: draft.end_sec, p_code: anCodePayload(draft) });
}

/* Copie d'un clip : une NOUVELLE séquence sur la même vidéo (le fichier n'est pas copié), même découpage,
   réservée au staff comme tout clip créé ici ; avec son codage et ses tags, ou à coder. Rend l'id de la copie.
   at : { start_sec, end_sec, code } pour la poser ailleurs dans la vidéo ou avec un autre codage (⌥ + glisser). */
function anDuplicate(clip, withCode, at = {}) {
  return anRpc(`copie du clip ${clip.id} refusée`, 'save_sequence_code', { p_sequence_id: null, p_video_id: clip.video_id,
    p_label: `${clip.label || 'Séquence'} (copie)`, p_start: at.start_sec ?? clip.start_sec, p_end: at.end_sec ?? clip.end_sec,
    p_code: at.code ?? (withCode ? anCodePayload(clip) : {}) });
}

/* Retire des séquences (corbeille du club, comme l'onglet Vidéos). Rend le nombre réellement retiré (la RLS peut en refuser). */
async function anDeleteClips(ids) {
  const { data, error } = await sb.from('video_sequences').delete().in('id', ids).select('id');
  if (error) throw anDbError('suppression refusée', error);
  return data?.length ?? 0;
}

/* Découpage seul (bord d'un clip tiré sur la timeline) : même transaction, codage intact. */
function anSaveTimes(clip, { start_sec, end_sec }) {
  return anRpc(`découpage du clip ${clip.id} refusé`, 'save_sequence_code', { p_sequence_id: clip.id, p_video_id: clip.video_id, p_label: null,
    p_start: start_sec, p_end: end_sec, p_code: {} });
}

/* Plusieurs clips en une transaction : tout passe ou rien. Rend ce qui a réellement changé
   ([{ sequence_id, before, after }]) : c'est ce que anUndo sait défaire. */
function anBulk(ids, { set = {}, add = null, remove = null }) {
  return anRpc('modification groupée refusée', 'bulk_update_sequence_codes', { p_ids: ids, p_set: set, p_add_tags: add, p_remove_tags: remove });
}
/* Défait une opération groupée sans écraser ce qui a changé depuis. Rend { restored, kept }. */
function anUndo(changes) { return anRpc('annulation refusée', 'undo_sequence_changes', { p_changes: changes }); }

/* Catalogue : crée (sans id) ou modifie un descripteur ; son renommage passe par anRenameTag (clips + catalogue). */
async function anDescSave({ id, ...row }) {
  const q = id ? sb.from('sequence_descriptors').update(row).eq('id', id) : sb.from('sequence_descriptors').insert(row);
  const { data, error } = await q.select('id');
  if (error) throw anDbError('descripteur non enregistré', error);
  if (!data?.length) throw new Error('Descripteur refusé : vous n’avez pas le droit de modifier le catalogue.');
}
/* Bibliothèque de départ : les noms déjà au catalogue sont laissés tels quels. */
async function anDescSeed(rows) {
  const { error } = await sb.from('sequence_descriptors').upsert(rows, { onConflict: 'club_id,nom', ignoreDuplicates: true });
  if (error) throw anDbError('bibliothèque de départ refusée', error);
}
/* Nombre de clips du club qui portent ce tag (ceux que la personne peut lire). */
async function anTagUses(tag) {
  const { count, error } = await sb.from('sequence_codes').select('sequence_id', { count: 'exact', head: true }).contains('tags', [tag]);
  if (error) throw anDbError(`comptage du tag « ${tag} » impossible`, error);
  return count ?? 0;
}

/* Poste ou lieu d'une vidéo, repris par tous ses clips. */
async function anSaveVideo(videoId, patch) {
  const { data, error } = await sb.from('player_videos').update(patch).eq('id', videoId).select('id');
  if (error) throw anDbError(`vidéo ${videoId} non modifiée`, error);
  if (!data?.length) throw new Error('Modification refusée : vous n’avez pas le droit de modifier cette vidéo.');
}

/* Renomme un tag partout (nouveau nom vide : le supprime). Rend le nombre de clips changés. */
async function anRenameTag(oldTag, newTag) {
  const { data, error } = await sb.rpc('rename_sequence_tag', { p_old: oldTag, p_new: newTag });
  if (error) throw anDbError(`tag « ${oldTag} » non renommé`, error);
  return data;
}
