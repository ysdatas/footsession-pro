/* ============================================================
   LMFC Performance — lmfc_v74_retour.sql : retour arrière de lmfc_v74.sql
   video_path_in_use() est retirée : le site retire de nouveau le fichier à la
   suppression de chaque ligne de vidéo (une vidéo partagée entre plusieurs
   joueurs perdrait alors son fichier). Rejouable et transactionnel.
   ============================================================ */
begin;
drop function if exists public.video_path_in_use(text);
commit;
