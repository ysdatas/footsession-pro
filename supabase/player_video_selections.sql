-- ============================================================
-- FootSession Pro — Sélection de vidéos par le joueur
-- Le joueur sélectionne des séquences puis valide sa sélection.
-- Le staff du club peut consulter les séquences validées.
-- ============================================================

create table if not exists public.player_video_selections (
  id bigint generated always as identity primary key,
  club_id bigint not null references public.clubs on delete cascade,
  player_id bigint not null references public.players on delete cascade,
  video_id bigint not null references public.player_videos on delete cascade,
  selected boolean not null default true,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, video_id)
);

create index if not exists idx_player_video_selections_player
  on public.player_video_selections(player_id);

create index if not exists idx_player_video_selections_video
  on public.player_video_selections(video_id);

create index if not exists idx_player_video_selections_validated
  on public.player_video_selections(player_id, validated_at);

alter table public.player_video_selections enable row level security;

drop policy if exists player_video_selections_read on public.player_video_selections;
drop policy if exists player_video_selections_insert on public.player_video_selections;
drop policy if exists player_video_selections_update on public.player_video_selections;
drop policy if exists player_video_selections_delete on public.player_video_selections;

create policy player_video_selections_read
on public.player_video_selections
for select
using (
  exists (
    select 1
    from public.players p
    where p.id = player_id
      and p.auth_user_id = auth.uid()
  )
  or (
    public.can_edit()
    and club_id = public.my_club_id()
  )
);

create policy player_video_selections_insert
on public.player_video_selections
for insert
with check (
  exists (
    select 1
    from public.players p
    where p.id = player_id
      and p.auth_user_id = auth.uid()
      and p.club_id = club_id
  )
  and exists (
    select 1
    from public.player_videos v
    where v.id = video_id
      and v.player_id = player_id
      and v.club_id = club_id
  )
);

create policy player_video_selections_update
on public.player_video_selections
for update
using (
  exists (
    select 1
    from public.players p
    where p.id = player_id
      and p.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.players p
    where p.id = player_id
      and p.auth_user_id = auth.uid()
      and p.club_id = club_id
  )
  and exists (
    select 1
    from public.player_videos v
    where v.id = video_id
      and v.player_id = player_id
      and v.club_id = club_id
  )
);

create policy player_video_selections_delete
on public.player_video_selections
for delete
using (
  exists (
    select 1
    from public.players p
    where p.id = player_id
      and p.auth_user_id = auth.uid()
  )
);

grant select, insert, update, delete
on public.player_video_selections
to authenticated;

grant usage, select
on sequence public.player_video_selections_id_seq
to authenticated;
