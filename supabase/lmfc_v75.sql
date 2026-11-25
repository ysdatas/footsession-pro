/* ============================================================
   LMFC Performance — lmfc_v75.sql : la vidéo d'un match
   À exécuter après lmfc_v74.sql. Rejouable et transactionnelle.

   Retours de match › un match › « Vidéo et analyse » (match-video.js) : la
   vidéo du match est envoyée une fois, depuis le match ; chaque joueur de la
   feuille reçoit sa ligne player_videos sur le même fichier (lmfc_v74.sql),
   reliée au match :
     - player_videos.match_id : le match de la vidéo (vidé si le match est
       supprimé : la vidéo reste au joueur) ;
     - les droits ne changent pas : lire, envoyer, supprimer suivent les
       règles de player_videos (staff vidéo, joueurs qu'il peut modifier ;
       le joueur, sa ligne seulement).

   Témoin : match_videos_ok() (API publique : 42501 si la migration est passée).
   Retour arrière : lmfc_v75_retour.sql (le lien au match est oublié, les
   vidéos restent aux joueurs).
   ============================================================ */
begin;

alter table public.player_videos add column if not exists match_id bigint references public.matches on delete set null;
create index if not exists player_videos_match_idx on public.player_videos (match_id) where match_id is not null;

create or replace function public.match_videos_ok()
returns boolean language sql immutable set search_path = public as $$ select true $$;
revoke all on function public.match_videos_ok() from public, anon;
grant execute on function public.match_videos_ok() to authenticated;

commit;
