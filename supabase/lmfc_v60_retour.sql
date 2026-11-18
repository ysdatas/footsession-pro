/* ============================================================
   LMFC Performance — lmfc_v60_retour.sql : retour arrière de lmfc_v60.sql
   Les tests et mesures physiques redeviennent réservés à l'admin, au préparateur
   et à l'analyste vidéo (is_performance_editor(), règles de lmfc_v19.sql et
   lmfc_v41.sql). Aucune donnée n'est supprimée : ce que les coachs ont saisi reste.
   Rejouable et transactionnel.
   ============================================================ */
begin;

drop policy if exists performance_tests_write on public.player_physical_tests;
create policy performance_tests_write on public.player_physical_tests for insert
  with check (public.is_performance_editor() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');
drop policy if exists performance_tests_update on public.player_physical_tests;
create policy performance_tests_update on public.player_physical_tests for update
  using (public.is_performance_editor() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification')
  with check (public.is_performance_editor() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification');
drop policy if exists performance_tests_delete on public.player_physical_tests;
create policy performance_tests_delete on public.player_physical_tests for delete
  using (public.is_performance_editor() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');

drop policy if exists performance_measurements_write on public.player_physical_measurements;
create policy performance_measurements_write on public.player_physical_measurements for insert
  with check (public.is_performance_editor() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');
drop policy if exists performance_measurements_update on public.player_physical_measurements;
create policy performance_measurements_update on public.player_physical_measurements for update
  using (public.is_performance_editor() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification')
  with check (public.is_performance_editor() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification');
drop policy if exists performance_measurements_delete on public.player_physical_measurements;
create policy performance_measurements_delete on public.player_physical_measurements for delete
  using (public.is_performance_editor() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');

drop function if exists public.can_edit_physical();

commit;
