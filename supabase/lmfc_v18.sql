/* ============================================================
   LMFC Performance — migration 37 : miniatures des vidéos.
   À exécuter APRÈS lmfc_v17.sql. Idempotent (rejouable) et
   transactionnel : en cas d'erreur, rien n'est appliqué.

   Mesure (lot 2) : 8 miniatures de « À traiter » téléchargeaient
   15 Mo de vidéo (chacune un <video> qui lit l'index et des images de
   la source). Chaque séquence et chaque vidéo garde désormais une
   petite image fixe (JPEG 320 px, ~15 Ko), prise une fois :
     - vidéo : sur le fichier, au moment de l'envoi (rien ne transite) ;
     - séquence : la première fois qu'elle est affichée dans le lecteur
       (joueur ou staff) ; recalculée après un nouveau découpage.
   Une image manquante retombe sur l'ancien affichage.
   Le déclencheur guard_video_sequence ne regarde pas thumb : ajouter
   une miniature ne fait pas passer une séquence en « Modifié ».
   ============================================================ */
begin;

alter table public.video_sequences add column if not exists thumb text;
alter table public.player_videos add column if not exists thumb text;
alter table public.video_sequences drop constraint if exists video_sequences_thumb_check;
alter table public.video_sequences add constraint video_sequences_thumb_check
  check (thumb is null or (thumb like 'data:image/jpeg;base64,%' and length(thumb) <= 60000));
alter table public.player_videos drop constraint if exists player_videos_thumb_check;
alter table public.player_videos add constraint player_videos_thumb_check
  check (thumb is null or (thumb like 'data:image/jpeg;base64,%' and length(thumb) <= 60000));

commit;
