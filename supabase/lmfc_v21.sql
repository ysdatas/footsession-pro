/* ============================================================
   LMFC Performance — lmfc_v21.sql : règles de lecture plus rapides
   Mêmes droits que lmfc_v19.sql. Les règles de lecture appelaient
   player_level(), can_edit(), my_club_id()… pour CHAQUE ligne lue.
   Elles s'appuient maintenant sur deux listes calculées une fois par
   requête : les joueurs visibles du compte (my_visible_players) et la
   fiche du joueur connecté (my_player_ids), et sur les fonctions de rôle
   évaluées une seule fois (« (select …) »).
   Mesuré (PGlite, 2 041 séquences, 66 joueurs) : 133 ms → 14 ms pour
   les séquences, mêmes lignes renvoyées pour chaque compte.
   tests/rights-sql.test.mjs rejoue toute la matrice des droits sur ces
   règles. Rejouable, transactionnelle. Seules les lectures changent ;
   les écritures (une ligne à la fois) restent celles de lmfc_v19.sql.
   ============================================================ */
begin;

-- Joueurs que le compte peut lire (même règle que player_level <> 'aucun').
create or replace function public.my_visible_players()
returns setof bigint language sql stable security definer set search_path = public as $$
  select p.id from public.players p
  where p.club_id = public.my_club_id() and public.player_level(p.id) <> 'aucun';
$$;
-- Fiche(s) du joueur connecté : ses propres lignes.
create or replace function public.my_player_ids()
returns setof bigint language sql stable security definer set search_path = public as $$
  select p.id from public.players p where p.auth_user_id = auth.uid();
$$;
do $$
declare f text;
begin
  foreach f in array array['my_visible_players()', 'my_player_ids()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

drop policy if exists "players_read" on public.players;
create policy "players_read" on public.players for select
  using (id in (select public.my_visible_players()));

drop policy if exists "videos_read_staff" on public.player_videos;
create policy "videos_read_staff" on public.player_videos for select
  using ((select public.can_edit()) and club_id = (select public.my_club_id())
         and player_id in (select public.my_visible_players()));

drop policy if exists video_sequences_read on public.video_sequences;
create policy video_sequences_read on public.video_sequences for select using (
  player_id in (select public.my_player_ids())
  or ((select public.can_edit()) and club_id = (select public.my_club_id())
      and player_id in (select public.my_visible_players())));

drop policy if exists views_read_staff_only on public.video_views;
create policy views_read_staff_only on public.video_views for select using (
  (select public.is_video_stats_staff()) and exists (select 1 from public.player_videos v
    where v.id = video_id and v.club_id = (select public.my_club_id())
      and v.player_id in (select public.my_visible_players())));

drop policy if exists player_video_selections_read on public.player_video_selections;
create policy player_video_selections_read on public.player_video_selections for select using (
  player_id in (select public.my_player_ids())
  or ((select public.can_edit()) and club_id = (select public.my_club_id())
      and player_id in (select public.my_visible_players())));

drop policy if exists performance_tests_read on public.player_physical_tests;
create policy performance_tests_read on public.player_physical_tests for select
  using ((select public.can_view_performance()) and club_id = (select public.my_club_id())
         and player_id in (select public.my_visible_players()));

drop policy if exists performance_measurements_read on public.player_physical_measurements;
create policy performance_measurements_read on public.player_physical_measurements for select
  using ((select public.can_view_performance()) and club_id = (select public.my_club_id())
         and player_id in (select public.my_visible_players()));

drop policy if exists performance_notes_read on public.player_performance_notes;
create policy performance_notes_read on public.player_performance_notes for select using (
  player_id in (select public.my_player_ids())
  or ((select public.can_view_performance()) and club_id = (select public.my_club_id())
      and player_id in (select public.my_visible_players())));

drop policy if exists performance_media_read on public.player_performance_media;
create policy performance_media_read on public.player_performance_media for select using (
  player_id in (select public.my_player_ids())
  or ((select public.can_view_performance()) and club_id = (select public.my_club_id())
      and player_id in (select public.my_visible_players())));

drop policy if exists player_programs_read on public.player_programs;
create policy player_programs_read on public.player_programs for select using (
  (visible_to_player and player_id in (select public.my_player_ids()))
  or ((select public.is_staff()) and club_id = (select public.my_club_id())
      and player_id in (select public.my_visible_players())));

drop policy if exists program_exercises_read on public.program_exercises;
create policy program_exercises_read on public.program_exercises for select using (
  player_id in (select public.my_player_ids())
  or ((select public.is_staff()) and club_id = (select public.my_club_id())
      and player_id in (select public.my_visible_players())));

drop policy if exists player_career_read on public.player_career;
create policy player_career_read on public.player_career for select using (
  player_id in (select public.my_player_ids())
  or ((select public.is_staff()) and club_id = (select public.my_club_id())
      and player_id in (select public.my_visible_players())));

commit;
