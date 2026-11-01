/* ============================================================
   LMFC Performance — lmfc_v34.sql : RPE attendue d'une séance
   À exécuter APRÈS lmfc_v33.sql (indépendante : peut passer seule après
   lmfc_v29.sql). Rejouable, transactionnelle.

   sessions.rpe_attendue (1 à 10, facultative) : l'intensité ressentie que
   le staff veut obtenir. Comparée à la moyenne des RPE déclarés (écart =
   moyenne − attendue) dans la séance, le Suivi RPE et son PDF.
   Indépendante de la durée et de la charge prévues.
   Le joueur ne la lit pas : depuis lmfc_v22.sql, session_level ne lui
   ouvre aucune séance ; son calendrier et son RPE passent par
   my_calendar et my_rpe_sessions, qui ne la renvoient pas.

   Retour arrière : alter table public.sessions drop column if exists rpe_attendue;
   ============================================================ */
begin;

alter table public.sessions add column if not exists rpe_attendue smallint;
alter table public.sessions drop constraint if exists sessions_rpe_attendue_check;
alter table public.sessions add constraint sessions_rpe_attendue_check check (rpe_attendue between 1 and 10);

commit;
