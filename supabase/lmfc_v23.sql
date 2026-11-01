/* ============================================================
   LMFC Performance — lmfc_v23.sql : mesures physiques fermées au lecteur
   À exécuter APRÈS lmfc_v22.sql. Rejouable, transactionnelle.

   Taille, poids, masse grasse et plis cutanés sont des données de santé
   (CNIL : le poids croisé avec la taille en est une). Le scout n'en a pas
   besoin : une règle RESTRICTIVE lui refuse la lecture de
   player_physical_measurements, quelles que soient les règles de lecture
   actuelles ou futures. Tests, radar et chronos restent lisibles.
   Staff (admin, coach, prépa) et joueur (ses mesures, par
   my_physical_measurements()) : inchangés.
   ============================================================ */
begin;

drop policy if exists lecteur_no_measurements_read on public.player_physical_measurements;
create policy lecteur_no_measurements_read on public.player_physical_measurements
  as restrictive for select to authenticated
  using (not (select public.is_lecteur()));

commit;
