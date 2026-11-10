/* ============================================================
   LMFC Performance — analyse-data.js
   Onglet Analyse : lecture et écriture Supabase (lmfc_v48.sql).
   Sécurité : RLS (player_videos, video_sequences, sequence_codes) ;
   l'interface ne fait que masquer ce que la base refuserait.
   ============================================================ */

const AN_CODE_FIELDS = ['action', 'resultat', 'periode', 'ligne', 'nb_attaquants', 'pression', 'direction', 'touches', 'distance', 'pied', 'couloir',
  'intervention', 'lignes', 'zone_depart', 'zone_arrivee', 'tiers_depart', 'tiers_arrivee', 'x1', 'y1', 'x2', 'y2', 'categorie', 'tags'];

function anDbError(context, err) {
  console.error(`Analyse : ${context}`, err);
  const missing = /sequence_codes|column .*(poste|lieu|pied|couloir|intervention|lignes)|rename_sequence_tag/i.test(err?.message || '') || ['42P01', '42703', 'PGRST205', 'PGRST202'].includes(err?.code);
  return new Error(missing ? 'La migration lmfc_v48.sql n’est pas passée dans Supabase, ou pas dans sa dernière version : la (re)passer.' : (err?.message || 'Erreur inconnue.'));
}

/* Vidéos, séquences et codages du joueur, lus ensemble. */
async function anFetch(playerId) {
  const [v, s, c] = await Promise.all([
    sb.from('player_videos').select('*').eq('player_id', playerId).order('created_at', { ascending: false }),
    sb.from('video_sequences').select('id, video_id, club_id, label, start_sec, end_sec').eq('player_id', playerId).order('start_sec'),
    sb.from('sequence_codes').select('*').eq('player_id', playerId),
  ]);
  const err = v.error || s.error || c.error;
  if (err) throw anDbError('lecture impossible', err);
  return { videos: v.data, clips: anMerge(v.data, s.data, c.data) };
}

/* Enregistre le codage d'un clip (création ou mise à jour). Les champs que
   l'action ne porte pas sont vidés (anFields) : la base refuserait le mélange. */
async function anSaveCode(clip, draft, playerId) {
  const row = { sequence_id: clip.id, player_id: playerId, club_id: clip.club_id }, keep = anFields(draft.action);
  for (const k of AN_CODE_FIELDS) row[k] = keep.includes(k) ? draft[k] ?? null : null;
  row.tags = draft.tags ?? [];
  const { data, error } = await sb.from('sequence_codes').upsert(row, { onConflict: 'sequence_id' }).select('sequence_id');
  if (error) throw anDbError(`codage du clip ${clip.id} refusé`, error);
  if (!data?.length) throw new Error('Codage refusé : vous n’avez pas le droit de modifier ce joueur.');
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
