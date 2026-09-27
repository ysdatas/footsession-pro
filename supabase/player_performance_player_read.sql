alter table public.player_physical_measurements enable row level security;
alter table public.player_physical_tests enable row level security;
alter table public.player_performance_notes enable row level security;
alter table public.player_performance_media enable row level security;

drop policy if exists player_read_physical_measurements on public.player_physical_measurements;
create policy player_read_physical_measurements
on public.player_physical_measurements
for select
using (
  exists (
    select 1 from public.players p
    where p.id = player_id
      and p.auth_user_id = auth.uid()
  )
);

drop policy if exists player_read_physical_tests on public.player_physical_tests;
create policy player_read_physical_tests
on public.player_physical_tests
for select
using (
  exists (
    select 1 from public.players p
    where p.id = player_id
      and p.auth_user_id = auth.uid()
  )
);

drop policy if exists player_read_performance_notes on public.player_performance_notes;
create policy player_read_performance_notes
on public.player_performance_notes
for select
using (
  exists (
    select 1 from public.players p
    where p.id = player_id
      and p.auth_user_id = auth.uid()
  )
);

drop policy if exists player_read_performance_media on public.player_performance_media;
create policy player_read_performance_media
on public.player_performance_media
for select
using (
  exists (
    select 1 from public.players p
    where p.id = player_id
      and p.auth_user_id = auth.uid()
  )
);
