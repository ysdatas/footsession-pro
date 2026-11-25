/* ============================================================
   LMFC Performance — lmfc_v74.sql : une vidéo de match pour plusieurs joueurs
   À exécuter après lmfc_v73.sql. Rejouable et transactionnelle.

   Import XML Sportscode (Analyse, analyse-import-ui.js) : la vidéo du match est
   envoyée une fois ; chaque joueur relié à une ligne du XML reçoit sa propre
   ligne player_videos qui pointe sur le MÊME fichier (storage_path), avec ses
   séquences. Chacun voit le match et ses séquences, pas celles des autres :
   les règles existantes suffisent (video_sequences : son joueur seulement).
     - video_path_in_use(chemin) : une ligne de vidéo du club se sert-elle
       encore de ce fichier ? Le site (removeVideoFile) ne le retire du
       stockage qu'à la dernière ligne supprimée. Réservée au staff vidéo
       (security definer : un coach voit aussi les lignes des joueurs d'autres
       équipes, sans lire leur contenu).

   Témoin : video_path_in_use (API publique : 42501 si la migration est passée).
   Retour arrière : lmfc_v74_retour.sql.
   ============================================================ */
begin;

create or replace function public.video_path_in_use(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_player_videos()
     and exists (select 1 from public.player_videos v where v.storage_path = p_path and v.club_id = public.my_club_id());
$$;
revoke all on function public.video_path_in_use(text) from public, anon;
grant execute on function public.video_path_in_use(text) to authenticated;

commit;
