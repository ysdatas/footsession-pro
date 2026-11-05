/* Retour arrière de lmfc_v41.sql.
   Refuse de supprimer le rôle tant qu'un profil ou une invitation l'utilise.
   Réattribuer ces comptes depuis Mon club et annuler les invitations en
   attente avant d'exécuter ce fichier. Aucune donnée joueur n'est supprimée. */
begin;

do $$
begin
  if exists (select 1 from public.profiles where role = 'analyste')
     or exists (select 1 from public.club_access where role = 'analyste') then
    raise exception 'Retour arrière refusé : réattribuez les profils Analyste vidéo et annulez leurs invitations en attente.';
  end if;
end $$;

-- Les politiques retrouvent leurs helpers d'origine (avec les contrôles de
-- portée de joueur conservés sur les nouvelles lignes après une modification).
drop policy if exists "players_update" on public.players;
create policy "players_update" on public.players for update
  using (club_id = public.my_club_id() and public.can_edit() and public.player_level(id) = 'modification')
  with check (club_id = public.my_club_id() and public.can_edit() and public.player_level(id) = 'modification');

drop policy if exists "players_insert" on public.players;
create policy "players_insert" on public.players for insert
  with check (club_id = public.my_club_id() and public.can_edit()
    and (public.is_club_admin()
         or team_id = any(coalesce((select pr.team_ids from public.profiles pr where pr.id = auth.uid()), '{}'))
         or (team_id is null and not exists (select 1 from public.teams t where t.club_id = public.my_club_id()))));

drop policy if exists player_career_write on public.player_career;
create policy player_career_write on public.player_career for all
  using (public.can_edit() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification')
  with check (public.can_edit() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');

drop policy if exists "videos_write_staff" on public.player_videos;
create policy "videos_write_staff" on public.player_videos for insert
  with check (public.can_manage_videos() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification');
drop policy if exists "videos_update_staff" on public.player_videos;
create policy "videos_update_staff" on public.player_videos for update
  using (public.can_manage_videos() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification')
  with check (public.can_manage_videos() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification');
drop policy if exists "videos_delete_staff" on public.player_videos;
create policy "videos_delete_staff" on public.player_videos for delete
  using (public.can_manage_videos() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification');

drop policy if exists video_sequences_insert on public.video_sequences;
create policy video_sequences_insert on public.video_sequences for insert with check (
  exists (select 1 from public.player_videos v
          where v.id = video_id and v.player_id = video_sequences.player_id and v.club_id = video_sequences.club_id)
  and (exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
       or (public.can_manage_videos() and club_id = public.my_club_id()
           and public.player_level(player_id) = 'modification')));
drop policy if exists video_sequences_update on public.video_sequences;
create policy video_sequences_update on public.video_sequences for update using (
  exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
  or (public.can_manage_videos() and club_id = public.my_club_id()
      and public.player_level(player_id) = 'modification'))
with check (
  exists (select 1 from public.player_videos v
          where v.id = video_id and v.player_id = video_sequences.player_id and v.club_id = video_sequences.club_id)
  and (exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
       or (public.can_manage_videos() and club_id = public.my_club_id()
           and public.player_level(player_id) = 'modification')));
drop policy if exists video_sequences_delete on public.video_sequences;
create policy video_sequences_delete on public.video_sequences for delete using (
  (public.can_manage_videos() and club_id = public.my_club_id()
   and public.player_level(player_id) = 'modification')
  or (created_by = auth.uid() and exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())));

create or replace function public.guard_video_sequence()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.can_manage_videos() then
    if tg_op = 'UPDATE' then
      new.selected := old.selected;
      new.player_note := old.player_note;
      new.drawings := old.drawings;
      new.submitted_at := old.submitted_at;
      new.edited_at := old.edited_at;
      if new.staff_feedback is distinct from old.staff_feedback then
        new.feedback_by := auth.uid();
        new.feedback_at := now();
      else
        new.feedback_by := old.feedback_by;
        new.feedback_at := old.feedback_at;
      end if;
      if new.seen_at is distinct from old.seen_at then
        new.seen_at := case when new.seen_at is null then null else now() end;
      end if;
    else
      new.edited_at := null;
    end if;
  else
    if tg_op = 'INSERT' then
      new.staff_feedback := null; new.feedback_by := null; new.feedback_at := null;
      new.seen_at := null;
      new.created_by := auth.uid();
      new.edited_at := now();
      if new.submitted_at is not null then new.submitted_at := now(); end if;
    else
      new.club_id := old.club_id; new.player_id := old.player_id; new.video_id := old.video_id;
      new.staff_feedback := old.staff_feedback;
      new.feedback_by := old.feedback_by; new.feedback_at := old.feedback_at;
      new.created_by := old.created_by;
      new.seen_at := old.seen_at;
      if (new.label, new.start_sec, new.end_sec, new.player_note, new.drawings)
         is distinct from (old.label, old.start_sec, old.end_sec, old.player_note, old.drawings) then
        new.edited_at := now();
      else
        new.edited_at := old.edited_at;
      end if;
      if new.submitted_at is distinct from old.submitted_at and new.submitted_at is not null then
        new.submitted_at := now();
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;

drop policy if exists "player_videos_write" on storage.objects;
create policy "player_videos_write" on storage.objects for insert with check (
  bucket_id = 'player-videos' and public.can_manage_videos()
  and (storage.foldername(name))[1] = public.my_club_id()::text
  and public.player_level_path(name) = 'modification');
drop policy if exists "player_videos_delete" on storage.objects;
create policy "player_videos_delete" on storage.objects for delete using (
  bucket_id = 'player-videos' and public.can_manage_videos()
  and (storage.foldername(name))[1] = public.my_club_id()::text
  and public.player_level_path(name) = 'modification');

create or replace function public.sequence_recipients(p_player bigint)
returns table (nom text, role text) language sql stable security definer set search_path = public as $$
  select pr.nom, pr.role from public.profiles pr
  join public.players p on p.id = p_player and p.club_id = pr.club_id
  where pr.role in ('admin', 'coach')
    and public.player_level_for(pr.id, p_player) <> 'aucun'
    and (p.auth_user_id = auth.uid() or public.player_level(p_player) <> 'aucun')
  order by pr.role, pr.nom;
$$;
revoke all on function public.sequence_recipients(bigint) from public, anon;
grant execute on function public.sequence_recipients(bigint) to authenticated;

drop policy if exists performance_tests_update on public.player_physical_tests;
create policy performance_tests_update on public.player_physical_tests for update
  using (public.is_performance_editor() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification')
  with check (public.is_performance_editor() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification');
drop policy if exists performance_measurements_update on public.player_physical_measurements;
create policy performance_measurements_update on public.player_physical_measurements for update
  using (public.is_performance_editor() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification')
  with check (public.is_performance_editor() and club_id = public.my_club_id()
    and public.player_level(player_id) = 'modification');

-- Revenir aux listes de rôles de lmfc_v22.sql / roles_teams_preventions.sql.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'coach', 'prepa', 'lecteur', 'joueur'));
alter table public.club_access drop constraint if exists club_access_role_check;
alter table public.club_access add constraint club_access_role_check
  check (role in ('admin', 'coach', 'prepa', 'lecteur', 'joueur'));

create or replace function public.club_set_member_role(p_profile_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_club_id bigint;
begin
  select club_id into v_club_id from public.profiles where id = auth.uid() and role = 'admin';
  if v_club_id is null then raise exception 'Action réservée à l’administrateur du club.'; end if;
  if p_profile_id = auth.uid() then raise exception 'Vous ne pouvez pas modifier votre propre rôle.'; end if;
  if p_role not in ('admin', 'coach', 'prepa', 'lecteur') then
    raise exception 'Rôle invalide. Pour le rôle Joueur, associez une fiche joueur.';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and club_id = v_club_id) then
    raise exception 'Ce membre ne fait pas partie de votre club.';
  end if;
  update public.players set auth_user_id = null where auth_user_id = p_profile_id;
  update public.profiles set role = p_role where id = p_profile_id and club_id = v_club_id;
end; $$;

create or replace function public.claim_club_access()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_acc public.club_access%rowtype;
begin
  if v_uid is null then return null; end if;
  select lower(u.email) into v_email from auth.users u
    where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then return null; end if;
  select * into v_acc from public.club_access
    where email = v_email and claimed_at is null order by created_at desc limit 1;
  if v_acc.id is null then return null; end if;
  if exists (select 1 from public.profiles where id = v_uid and club_id is not null and club_id <> v_acc.club_id) then
    return null;
  end if;
  if v_acc.player_id is not null then
    if exists (select 1 from public.players where id = v_acc.player_id and auth_user_id is not null and auth_user_id <> v_uid) then
      raise exception 'Cette fiche joueur est déjà associée à un autre compte.';
    end if;
    update public.players set auth_user_id = null where auth_user_id = v_uid and id <> v_acc.player_id;
    update public.players set auth_user_id = v_uid where id = v_acc.player_id;
  else
    update public.players set auth_user_id = null where auth_user_id = v_uid;
  end if;
  update public.profiles set club_id = v_acc.club_id, role = v_acc.role where id = v_uid;
  update public.club_access set claimed_by = v_uid, claimed_at = now() where id = v_acc.id;
  return v_acc.role;
end; $$;

do $$
declare f text;
begin
  foreach f in array array['claim_club_access()', 'club_remove_member(uuid)', 'club_set_member_role(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

create or replace function public.player_level_for(p_profile uuid, p_player bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when me.id is null or me.role = 'joueur' or pl.id is null or pl.club_id is distinct from me.club_id then 'aucun'
    when me.role = 'admin' then 'modification'
    when me.role = 'lecteur' then case
      when x.niveau = 'aucun' then 'aucun'
      when x.niveau is not null then 'lecture'
      when pl.team_id = any(me.team_ids) or coalesce(pl.other_team_ids, '{}') && me.team_ids then 'lecture'
      when cardinality(me.team_ids) > 0 then 'aucun'
      when pl.team_id is null and cardinality(coalesce(pl.other_team_ids, '{}')) = 0
           and exists (select 1 from public.teams t where t.club_id = me.club_id) then 'aucun'
      else 'lecture'
    end
    when x.niveau is not null then x.niveau
    when pl.team_id = any(me.team_ids) or coalesce(pl.other_team_ids, '{}') && me.team_ids then 'modification'
    when not exists (select 1 from public.teams t where t.club_id = me.club_id) then 'modification'
    when me.lecture_club and (pl.team_id is not null or cardinality(coalesce(pl.other_team_ids, '{}')) > 0) then 'lecture'
    else 'aucun'
  end
  from (select 1) d
  left join public.profiles me on me.id = p_profile
  left join public.players pl on pl.id = p_player
  left join public.staff_player_access x on x.profile_id = p_profile and x.player_id = p_player;
$$;

create or replace function public.team_level(p_team bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when me.id is null or me.role in ('joueur', 'lecteur') then 'aucun'
    when me.role = 'admin' then 'modification'
    when p_team is not null and p_team = any(me.team_ids) then case when me.role in ('coach', 'analyste') then 'modification' else 'lecture' end
    when p_team is null and cardinality(me.team_ids) > 0 then 'lecture'
    when not exists (select 1 from public.teams t where t.club_id = me.club_id)
      then case when me.role in ('coach', 'analyste') then 'modification' else 'lecture' end
    when me.lecture_club then 'lecture'
    else 'aucun'
  end
  from (select 1) d left join public.profiles me on me.id = auth.uid();
$$;

create or replace function public.session_level(p_id bigint, p_club bigint, p_created_by uuid, p_acces text, p_team bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_club is distinct from public.my_club_id() or me.role is null or me.role in ('joueur', 'lecteur') then 'aucun'
    when me.role = 'admin' then 'modification'
    when p_created_by = auth.uid() then 'modification'
    when a.niveau = 'modification' and me.role not in ('admin', 'coach') then 'lecture'
    when a.niveau is not null then a.niveau
    when p_acces = 'club' then case when me.role in ('admin', 'coach') then 'modification' else 'lecture' end
    else public.team_level(p_team)
  end
  from (select 1) x
  left join public.session_access a on a.session_id = p_id and a.profile_id = auth.uid()
  left join public.profiles me on me.id = auth.uid();
$$;

create or replace function public.club_staff()
returns table (id uuid, nom text, role text, team_ids bigint[], lecture_club boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.nom, p.role, p.team_ids, p.lecture_club from public.profiles p
  where p.club_id = public.my_club_id() and p.role not in ('joueur', 'lecteur') and public.is_staff()
  order by p.nom;
$$;

create or replace function public.can_read_videos()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach', 'lecteur');
$$;
create or replace function public.can_view_performance()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach', 'prepa', 'lecteur');
$$;
create or replace function public.is_performance_editor()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'prepa');
$$;
create or replace function public.is_video_stats_staff()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach', 'lecteur');
$$;
drop function if exists public.can_edit_players();
drop function if exists public.can_manage_player_videos();
drop function if exists public.analyste_default_team(bigint);

commit;
