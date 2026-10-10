/* ============================================================
   LMFC Performance — migration 34 : terrain d'effectif.
   À exécuter APRÈS lmfc_v14.sql. Idempotent (rejouable) et
   transactionnel : en cas d'erreur, rien n'est appliqué.

   sessions.terrain : placement des joueurs sur le petit terrain de la
   séance (bloc Présences), { "id du joueur": [x %, y %] }, terrain
   vertical, but adverse en haut. Repris dans le PDF de la séance.
   ============================================================ */
begin;

alter table public.sessions add column if not exists terrain jsonb not null default '{}'::jsonb;
alter table public.sessions drop constraint if exists sessions_terrain_check;
alter table public.sessions add constraint sessions_terrain_check check (jsonb_typeof(terrain) = 'object');

commit;
