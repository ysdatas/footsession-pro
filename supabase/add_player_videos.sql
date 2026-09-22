-- ============================================================
--  FootSession Pro — Vidéos joueurs (Chemin B / Supabase)
--  Comptes joueurs liés à auth.users · vidéos individuelles ·
--  suivi de visionnage · bucket Storage dédié.
--  À coller dans Supabase → SQL Editor → Run.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Nouveau rôle "joueur" dans profiles.role
-- ------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','coach','analyste','prepa','viewer','joueur'));

-- ------------------------------------------------------------
-- 2) Lien joueur <-> compte Supabase Auth
--    player_code : code que le coach communique au joueur pour
--    qu'il lie lui-même son compte (même principe que club.join_code).
-- ------------------------------------------------------------
alter table public.players
  add column if not exists player_code text
  unique default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

alter table public.players
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

-- Un joueur connecté doit pouvoir lire SA propre fiche joueur, même avant
-- d'avoir rejoint un club côté profil (my_club_id() dépend de profiles.club_id).
drop policy if exists "players_read_self" on public.players;
create policy "players_read_self" on public.players for select
  using (auth_user_id = auth.uid());

-- ------------------------------------------------------------
-- 3) Lier son compte à une fiche joueur via un code
--    Appelée depuis web/player-join.html : sb.rpc('join_as_player', { p_code })
-- ------------------------------------------------------------
create or replace function public.join_as_player(p_code text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_player record;
begin
  select * into v_player from public.players
    where player_code = upper(p_code) and auth_user_id is null;

  if v_player.id is null then
    raise exception 'Code joueur invalide ou déjà utilisé.';
  end if;

  update public.players set auth_user_id = auth.uid() where id = v_player.id;
  update public.profiles set club_id = v_player.club_id, role = 'joueur' where id = auth.uid();

  return v_player.id;
end; $$;

grant execute on function public.join_as_player(text) to authenticated;

-- ------------------------------------------------------------
-- 4) Vidéos individuelles (une vidéo = un joueur destinataire exclusif)
-- ------------------------------------------------------------
create table if not exists public.player_videos (
  id           bigint generated always as identity primary key,
  club_id      bigint not null references public.clubs on delete cascade,
  player_id    bigint not null references public.players on delete cascade,
  created_by   uuid references auth.users on delete set null,
  titre        text not null,
  description  text,
  storage_path text not null,          -- chemin dans le bucket "player-videos"
  duree_sec    int,                    -- renseignée côté client au premier visionnage
  created_at   timestamptz default now()
);

-- ------------------------------------------------------------
-- 5) Suivi du visionnage (une ligne = une session de lecture)
-- ------------------------------------------------------------
create table if not exists public.video_views (
  id                    bigint generated always as identity primary key,
  video_id              bigint not null references public.player_videos on delete cascade,
  player_id             bigint not null references public.players on delete cascade,
  started_at            timestamptz default now(),
  last_heartbeat_at     timestamptz,
  watched_seconds       int not null default 0,
  max_position_seconds  int not null default 0,
  completed             boolean not null default false
);

-- ------------------------------------------------------------
-- 6) Row Level Security
-- ------------------------------------------------------------
alter table public.player_videos enable row level security;
alter table public.video_views   enable row level security;

-- Vidéos : lecture par le joueur propriétaire, OU par un membre du club
-- (même logique que players_read / sessions_read : lecture club-wide,
-- écriture réservée aux éditeurs). Resserre "videos_read_staff" si tu
-- veux réserver la lecture aux seuls éditeurs.
create policy "videos_read_player" on public.player_videos for select
  using (exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid()));
create policy "videos_read_staff" on public.player_videos for select
  using (club_id = public.my_club_id());

create policy "videos_write_staff" on public.player_videos for insert
  with check (public.can_edit() and club_id = public.my_club_id());
create policy "videos_update_staff" on public.player_videos for update
  using (public.can_edit() and club_id = public.my_club_id());
create policy "videos_delete_staff" on public.player_videos for delete
  using (public.can_edit() and club_id = public.my_club_id());

-- Suivi de visionnage : le joueur crée/maj SES sessions de lecture ;
-- le staff du club peut les consulter (statistiques), pas les modifier.
create policy "views_insert_player" on public.video_views for insert
  with check (exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid()));
create policy "views_update_player" on public.video_views for update
  using (exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid()));
create policy "views_read_player" on public.video_views for select
  using (exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid()));
create policy "views_read_staff" on public.video_views for select
  using (exists (select 1 from public.player_videos v where v.id = video_id and v.club_id = public.my_club_id()));

-- ------------------------------------------------------------
-- 7) Storage : bucket privé + politiques par dossier
--    Convention de chemin : {club_id}/{player_id}/{timestamp}-{filename}
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('player-videos', 'player-videos', false)
on conflict (id) do nothing;

-- Lecture : le joueur propriétaire du dossier {player_id} (2e segment du chemin),
-- ou un éditeur du club {club_id} (1er segment).
create policy "player_videos_read" on storage.objects for select
  using (
    bucket_id = 'player-videos'
    and (
      exists (
        select 1 from public.players p
        where p.id::text = (storage.foldername(name))[2]
          and p.auth_user_id = auth.uid()
      )
      or (
        public.can_edit()
        and (storage.foldername(name))[1] = public.my_club_id()::text
      )
    )
  );

create policy "player_videos_write" on storage.objects for insert
  with check (
    bucket_id = 'player-videos'
    and public.can_edit()
    and (storage.foldername(name))[1] = public.my_club_id()::text
  );

create policy "player_videos_delete" on storage.objects for delete
  using (
    bucket_id = 'player-videos'
    and public.can_edit()
    and (storage.foldername(name))[1] = public.my_club_id()::text
  );
