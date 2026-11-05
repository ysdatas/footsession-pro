/* Retour arrière de lmfc_v43.sql.
   Supprime uniquement la RPC ajoutée pour les résumés du calendrier. */
begin;

drop function if exists public.calendar_summary_update(text, bigint, jsonb, jsonb);

commit;
