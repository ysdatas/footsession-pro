/* ============================================================
   LMFC Performance — lmfc_v75_retour.sql : retour arrière de lmfc_v75.sql
   Le lien entre une vidéo et son match est oublié ; les vidéos et leurs
   séquences restent aux joueurs. Rejouable et transactionnel.
   ============================================================ */
begin;
drop function if exists public.match_videos_ok();
drop index if exists public.player_videos_match_idx;
alter table public.player_videos drop column if exists match_id;
commit;
