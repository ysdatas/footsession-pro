/* ============================================================
   LMFC Performance — lmfc_v60.sql (n° 78) : les coachs saisissent les tests et les mesures physiques
   À exécuter après lmfc_v59.sql. Rejouable et transactionnelle.
   Retour arrière : lmfc_v60_retour.sql (rend la saisie au préparateur, à l'analyste et à l'admin).

   Jusqu'ici, un coach consultait les tests physiques et les mesures (taille, poids,
   masse grasse) sans pouvoir les saisir : seuls l'admin, le préparateur et
   l'analyste vidéo écrivaient (is_performance_editor(), lmfc_v41.sql).
   can_edit_physical() ajoute le coach, pour ces deux tables seulement :
     - ajouter, modifier, supprimer un test ou une mesure, et importer le classeur
       Excel du préparateur, qui écrit dans ces deux tables ;
     - toujours borné au joueur : player_level() = 'modification', donc les joueurs
       de ses équipes (principale ou « joue aussi en ») et les exceptions de Mon club ;
     - le lecteur et le joueur n'écrivent toujours rien (règles restrictives de
       lmfc_v22.sql, inchangées) ; la lecture ne change pas.
   is_performance_editor() reste tel quel : il garde la photo du joueur, où le
   coach passe déjà par can_edit().
   ============================================================ */
begin;

create or replace function public.can_edit_physical()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'prepa', 'analyste', 'coach');
$$;
revoke all on function public.can_edit_physical() from public, anon;
grant execute on function public.can_edit_physical() to authenticated;

-- Tests physiques
drop policy if exists performance_tests_write on public.player_physical_tests;
create policy performance_tests_write on public.player_physical_tests for insert
  with check (public.can_edit_physical() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification');
drop policy if exists performance_tests_update on public.player_physical_tests;
create policy performance_tests_update on public.player_physical_tests for update
  using (public.can_edit_physical() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification')
  with check (public.can_edit_physical() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification');
drop policy if exists performance_tests_delete on public.player_physical_tests;
create policy performance_tests_delete on public.player_physical_tests for delete
  using (public.can_edit_physical() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification');

-- Mesures physiques (taille, poids, masse grasse)
drop policy if exists performance_measurements_write on public.player_physical_measurements;
create policy performance_measurements_write on public.player_physical_measurements for insert
  with check (public.can_edit_physical() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification');
drop policy if exists performance_measurements_update on public.player_physical_measurements;
create policy performance_measurements_update on public.player_physical_measurements for update
  using (public.can_edit_physical() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification')
  with check (public.can_edit_physical() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification');
drop policy if exists performance_measurements_delete on public.player_physical_measurements;
create policy performance_measurements_delete on public.player_physical_measurements for delete
  using (public.can_edit_physical() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification');

commit;
