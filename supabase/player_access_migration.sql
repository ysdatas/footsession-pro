-- FootSession Pro : comptes joueurs, liaison aux fiches et confidentialité vidéo.
-- À exécuter dans Supabase SQL Editor après sauvegarde/revue de la base.
begin;

-- Rôle joueur
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','coach','analyste','prepa','viewer','joueur'));

-- Liaison de compte à la fiche joueur
alter table public.players add column if not exists player_code text
  unique default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
alter table public.players add column if not exists auth_user_id uuid unique
  references auth.users(id) on delete set null;

-- Un utilisateur ne peut pas altérer son propre rôle/club via une mise à jour directe.
-- Les RPC contrôlées ci-dessous s'exécutent sous leur propriétaire SECURITY DEFINER.
create or replace function public.guard_profile_membership_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = old.id and current_user = 'authenticated' then
    new.role := old.role;
    new.club_id := old.club_id;
  end if;
  return new;
end; $$;

drop trigger if exists guard_profile_membership_changes on public.profiles;
create trigger guard_profile_membership_changes
before update on public.profiles
for each row execute function public.guard_profile_membership_changes();

-- L'administrateur lie un compte membre à une fiche joueur de SON club.
create or replace function public.club_link_player(p_profile_id uuid, p_player_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_club_id bigint;
begin
  if auth.uid() is null then raise exception 'Vous devez être connecté.'; end if;
  select club_id into v_club_id from public.profiles
    where id = auth.uid() and role = 'admin';
  if v_club_id is null then raise exception 'Action réservée à l’administrateur du club.'; end if;
  if p_profile_id = auth.uid() then raise exception 'Vous ne pouvez pas vous associer vous-même comme joueur.'; end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and club_id = v_club_id) then
    raise exception 'Ce membre ne fait pas partie de votre club.';
  end if;
  if not exists (select 1 from public.players where id = p_player_id and club_id = v_club_id) then
    raise exception 'Cette fiche joueur ne fait pas partie de votre club.';
  end if;
  if exists (select 1 from public.players where auth_user_id = p_profile_id and id <> p_player_id) then
    raise exception 'Ce compte est déjà associé à une autre fiche joueur.';
  end if;
  if exists (select 1 from public.players where id = p_player_id and auth_user_id is not null and auth_user_id <> p_profile_id) then
    raise exception 'Cette fiche joueur est déjà associée à un autre compte.';
  end if;

  update public.players set auth_user_id = null
    where auth_user_id = p_profile_id and id <> p_player_id;
  update public.players set auth_user_id = p_profile_id where id = p_player_id;
  update public.profiles set role = 'joueur' where id = p_profile_id and club_id = v_club_id;
end; $$;

create or replace function public.club_set_member_role(p_profile_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_club_id bigint;
begin
  if auth.uid() is null then raise exception 'Vous devez être connecté.'; end if;
  select club_id into v_club_id from public.profiles
    where id = auth.uid() and role = 'admin';
  if v_club_id is null then raise exception 'Action réservée à l’administrateur du club.'; end if;
  if p_profile_id = auth.uid() then raise exception 'Vous ne pouvez pas modifier votre propre rôle.'; end if;
  if p_role not in ('admin','coach','analyste','prepa','viewer') then
    raise exception 'Rôle invalide. Pour le rôle Joueur, associez une fiche joueur.';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and club_id = v_club_id) then
    raise exception 'Ce membre ne fait pas partie de votre club.';
  end if;
  update public.players set auth_user_id = null where auth_user_id = p_profile_id;
  update public.profiles set role = p_role where id = p_profile_id and club_id = v_club_id;
end; $$;

create or replace function public.join_as_player(p_code text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_player public.players%rowtype; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Vous devez être connecté.'; end if;
  if exists (select 1 from public.profiles where id = v_uid and club_id is not null) then
    raise exception 'Votre compte appartient déjà à un club.';
  end if;
  select * into v_player from public.players
    where upper(player_code) = upper(regexp_replace(coalesce(p_code,''), '\s+', '', 'g'))
      and auth_user_id is null
    limit 1;
  if v_player.id is null then raise exception 'Code joueur invalide ou déjà utilisé.'; end if;
  update public.players set auth_user_id = v_uid where id = v_player.id;
  update public.profiles set club_id = v_player.club_id, role = 'joueur' where id = v_uid;
  return v_player.id;
end; $$;

revoke all on function public.club_link_player(uuid,bigint) from public, anon;
revoke all on function public.club_set_member_role(uuid,text) from public, anon;
revoke all on function public.join_as_player(text) from public, anon;
grant execute on function public.club_link_player(uuid,bigint) to authenticated;
grant execute on function public.club_set_member_role(uuid,text) to authenticated;
grant execute on function public.join_as_player(text) to authenticated;

-- Recréer proprement les politiques : un joueur ne lit que ses propres vidéos.
create table if not exists public.player_videos (
  id bigint generated always as identity primary key,
  club_id bigint not null references public.clubs on delete cascade,
  player_id bigint not null references public.players on delete cascade,
  created_by uuid references auth.users on delete set null,
  titre text not null,
  description text,
  storage_path text not null,
  duree_sec int,
  created_at timestamptz default now()
);
create table if not exists public.video_views (
  id bigint generated always as identity primary key,
  video_id bigint not null references public.player_videos on delete cascade,
  player_id bigint not null references public.players on delete cascade,
  started_at timestamptz default now(),
  last_heartbeat_at timestamptz,
  watched_seconds int not null default 0,
  max_position_seconds int not null default 0,
  completed boolean not null default false
);
alter table public.player_videos enable row level security;
alter table public.video_views enable row level security;

drop policy if exists videos_read_player on public.player_videos;
drop policy if exists videos_read_staff on public.player_videos;
drop policy if exists videos_write_staff on public.player_videos;
drop policy if exists videos_update_staff on public.player_videos;
drop policy if exists videos_delete_staff on public.player_videos;
create policy videos_read_player on public.player_videos for select
  using (exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid()));
create policy videos_read_staff on public.player_videos for select
  using (public.can_edit() and club_id = public.my_club_id());
create policy videos_write_staff on public.player_videos for insert
  with check (public.can_edit() and club_id = public.my_club_id()
    and exists (select 1 from public.players p where p.id = player_id and p.club_id = public.player_videos.club_id));
create policy videos_update_staff on public.player_videos for update
  using (public.can_edit() and club_id = public.my_club_id())
  with check (public.can_edit() and club_id = public.my_club_id());
create policy videos_delete_staff on public.player_videos for delete
  using (public.can_edit() and club_id = public.my_club_id());

drop policy if exists views_insert_player on public.video_views;
drop policy if exists views_update_player on public.video_views;
drop policy if exists views_read_player on public.video_views;
drop policy if exists views_read_staff on public.video_views;
create policy views_insert_player on public.video_views for insert
  with check (exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
    and exists (select 1 from public.player_videos v where v.id = video_id and v.player_id = player_id));
create policy views_update_player on public.video_views for update
  using (exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid()))
  with check (exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid()));
create policy views_read_player on public.video_views for select
  using (exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid()));
create policy views_read_staff on public.video_views for select
  using (public.can_edit() and exists (select 1 from public.player_videos v where v.id = video_id and v.club_id = public.my_club_id()));

-- Bucket privé, avec accès joueur uniquement à son dossier et staff éditeur du club.
insert into storage.buckets (id, name, public)
values ('player-videos', 'player-videos', false)
on conflict (id) do nothing;

drop policy if exists player_videos_read on storage.objects;
drop policy if exists player_videos_write on storage.objects;
drop policy if exists player_videos_delete on storage.objects;
create policy player_videos_read on storage.objects for select using (
  bucket_id = 'player-videos' and (
    exists (select 1 from public.players p
      where p.id::text = (storage.foldername(name))[2] and p.auth_user_id = auth.uid())
    or (public.can_edit() and (storage.foldername(name))[1] = public.my_club_id()::text)
  )
);
create policy player_videos_write on storage.objects for insert with check (
  bucket_id = 'player-videos' and public.can_edit()
  and (storage.foldername(name))[1] = public.my_club_id()::text
);
create policy player_videos_delete on storage.objects for delete using (
  bucket_id = 'player-videos' and public.can_edit()
  and (storage.foldername(name))[1] = public.my_club_id()::text
);

commit;
