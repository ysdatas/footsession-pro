/* ============================================================
   LMFC Performance — migration 38 : droits par équipe et par joueur.
   À exécuter APRÈS lmfc_v18.sql. Idempotent (rejouable) et
   transactionnel : en cas d'erreur, rien n'est appliqué.

   Jusqu'ici, tout le staff du club lisait tous les joueurs, vidéos et
   données : le filtre par équipe n'existait que dans l'interface. Les
   droits sont maintenant appliqués par la base.

   Pour un joueur, player_level() vaut, dans cet ordre :
     1. administrateur                                 → modification
     2. exception réglée par l'admin pour ce joueur   → son niveau
        (staff_player_access : aucun / lecture / modification)
     3. joueur d'une de ses équipes (principale ou « joue aussi en »)
                                                       → modification
     4. joueur sans équipe, et le compte a au moins une équipe
                                                       → modification
     5. club sans aucune équipe                        → modification
     6. « Lecture sur toutes les équipes » (profiles.lecture_club)
                                                       → lecture
     7. sinon                                          → aucun
   Le rôle borne toujours ce que « modification » permet : un préparateur
   modifie le physique, un coach les fiches et les vidéos (fonctions
   can_edit, can_manage_videos… inchangées). Un coach sans équipe, sans
   exception ni lecture club ne voit rien (Mon club le signale).

   Séances (session_level) et matchs : par l'équipe (team_level).
     - coach de l'équipe → modification (avant : lecture) ;
     - préparateur de l'équipe, lecture club → lecture ;
     - sans équipe : lecture pour le staff qui a au moins une équipe ;
     - créateur et admin → modification ; réglage nominatif de la
       séance (session_access) → c'est lui qui s'applique.
   Vidéos envoyées par un joueur : vues par ceux qui ont accès au joueur
   (admins, coachs de son équipe, exceptions) ; sequence_recipients()
   donne leurs noms à la feuille « Envoyer au staff ».
   ============================================================ */
begin;

-- ------------------------------------------------------------
-- 1) Modèle
-- ------------------------------------------------------------
alter table public.profiles add column if not exists lecture_club boolean not null default false;

create table if not exists public.staff_player_access (
  profile_id uuid   not null references public.profiles(id) on delete cascade,
  player_id  bigint not null references public.players(id) on delete cascade,
  club_id    bigint not null references public.clubs on delete cascade,
  niveau     text   not null check (niveau in ('aucun', 'lecture', 'modification')),
  updated_at timestamptz not null default now(),
  primary key (profile_id, player_id)
);
create index if not exists staff_player_access_player_idx on public.staff_player_access (player_id);
alter table public.staff_player_access enable row level security;
drop policy if exists staff_player_access_admin on public.staff_player_access;
create policy staff_player_access_admin on public.staff_player_access for all
  using (club_id = public.my_club_id() and public.is_club_admin())
  with check (club_id = public.my_club_id() and public.is_club_admin()
    and exists (select 1 from public.profiles pr where pr.id = profile_id and pr.club_id = public.my_club_id() and pr.role <> 'joueur')
    and exists (select 1 from public.players p where p.id = player_id and p.club_id = public.my_club_id()));
revoke all on public.staff_player_access from anon;
grant select, insert, update, delete on public.staff_player_access to authenticated;

-- Garde des profils (lmfc_v14.sql) : la lecture club suit les mêmes règles
-- que les équipes (jamais par soi-même, remise à zéro en quittant le club).
create or replace function public.guard_profile_membership_changes()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() = old.id and current_user = 'authenticated' then
    new.role := old.role;
    new.club_id := old.club_id;
    new.team_id := old.team_id;
    new.team_ids := old.team_ids;
    new.lecture_club := old.lecture_club;
  end if;
  if new.club_id is distinct from old.club_id then new.team_ids := '{}'; new.lecture_club := false; end if;
  new.team_ids := coalesce((select array_agg(distinct x order by x) from unnest(new.team_ids) x
    where exists (select 1 from public.teams t where t.id = x and t.club_id = new.club_id)), '{}');
  new.team_id := new.team_ids[1];
  return new;
end; $$;

-- Compte qui quitte le club ou devient joueur : ses exceptions disparaissent.
create or replace function public.profiles_forget_access()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.staff_player_access where profile_id = new.id;
  return new;
end; $$;
drop trigger if exists trg_profiles_forget_access on public.profiles;
create trigger trg_profiles_forget_access after update of club_id, role on public.profiles
  for each row when (new.club_id is distinct from old.club_id or (new.role = 'joueur' and old.role <> 'joueur'))
  execute function public.profiles_forget_access();

-- ------------------------------------------------------------
-- 2) Niveaux
-- ------------------------------------------------------------
create or replace function public.player_level_for(p_profile uuid, p_player bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when me.id is null or me.role = 'joueur' or pl.id is null or pl.club_id is distinct from me.club_id then 'aucun'
    when me.role = 'admin' then 'modification'
    when x.niveau is not null then x.niveau
    when pl.team_id = any(me.team_ids) or coalesce(pl.other_team_ids, '{}') && me.team_ids then 'modification'
    when pl.team_id is null and cardinality(me.team_ids) > 0 then 'modification'
    when not exists (select 1 from public.teams t where t.club_id = me.club_id) then 'modification'
    when me.lecture_club then 'lecture'
    else 'aucun'
  end
  from (select 1) d
  left join public.profiles me on me.id = p_profile
  left join public.players pl on pl.id = p_player
  left join public.staff_player_access x on x.profile_id = p_profile and x.player_id = p_player;
$$;
create or replace function public.player_level(p_player bigint)
returns text language sql stable security definer set search_path = public as $$
  select public.player_level_for(auth.uid(), p_player);
$$;
-- Chemin de stockage « club/joueur/… » : niveau sur le joueur du dossier.
create or replace function public.player_level_path(p_name text)
returns text language sql stable security definer set search_path = public as $$
  select case when split_part(p_name, '/', 2) ~ '^[0-9]{1,18}$'
              then public.player_level(split_part(p_name, '/', 2)::bigint) else 'aucun' end;
$$;
-- Joueurs visibles par le compte et son niveau sur chacun (interface : lecture seule).
create or replace function public.my_player_levels()
returns table (player_id bigint, niveau text) language sql stable security definer set search_path = public as $$
  select p.id, public.player_level(p.id) from public.players p
  where p.club_id = public.my_club_id() and public.player_level(p.id) <> 'aucun';
$$;

-- Équipe (séances, matchs) : coach de l'équipe en modification,
-- préparateur de l'équipe et lecture club en lecture.
create or replace function public.team_level(p_team bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when me.id is null or me.role = 'joueur' then 'aucun'
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

do $$
declare f text;
begin
  foreach f in array array['player_level_for(uuid, bigint)', 'player_level(bigint)', 'player_level_path(text)',
                           'my_player_levels()', 'team_level(bigint)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Séances (lmfc_v10 / v14) : l'équipe décide après le créateur et les réglages nominatifs.
create or replace function public.session_level(p_id bigint, p_club bigint, p_created_by uuid, p_acces text, p_team bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_club is distinct from public.my_club_id() or me.role is null or me.role = 'joueur' then 'aucun'
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

-- Noms et rôles du staff (lmfc_v14.sql), avec la lecture club.
drop function if exists public.club_staff();
create function public.club_staff()
returns table (id uuid, nom text, role text, team_ids bigint[], lecture_club boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.nom, p.role, p.team_ids, p.lecture_club from public.profiles p
  where p.club_id = public.my_club_id() and p.role <> 'joueur' and public.is_staff()
  order by p.nom;
$$;
revoke all on function public.club_staff() from public, anon;
grant execute on function public.club_staff() to authenticated;

-- Destinataires d'une séquence envoyée : admins et coachs qui ont accès au joueur.
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

-- ------------------------------------------------------------
-- 3) Règles des tables liées à un joueur
--    lecture : le joueur lui-même, ou player_level <> 'aucun'
--    écriture : le droit du rôle ET player_level = 'modification'
-- ------------------------------------------------------------
drop policy if exists "players_read" on public.players;
create policy "players_read" on public.players for select
  using (club_id = public.my_club_id() and public.player_level(id) <> 'aucun');
drop policy if exists "players_update" on public.players;
create policy "players_update" on public.players for update
  using (club_id = public.my_club_id() and public.can_edit() and public.player_level(id) = 'modification')
  with check (club_id = public.my_club_id() and public.can_edit());
drop policy if exists "players_insert" on public.players;
create policy "players_insert" on public.players for insert
  with check (club_id = public.my_club_id() and public.can_edit()
    and (public.is_club_admin() or team_id is null
         or team_id = any(coalesce((select pr.team_ids from public.profiles pr where pr.id = auth.uid()), '{}'))));

drop policy if exists "videos_read_staff" on public.player_videos;
create policy "videos_read_staff" on public.player_videos for select
  using (public.can_edit() and club_id = public.my_club_id() and public.player_level(player_id) <> 'aucun');
drop policy if exists "videos_write_staff" on public.player_videos;
create policy "videos_write_staff" on public.player_videos for insert
  with check (public.can_manage_videos() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');
drop policy if exists "videos_update_staff" on public.player_videos;
create policy "videos_update_staff" on public.player_videos for update
  using (public.can_manage_videos() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification')
  with check (public.can_manage_videos() and club_id = public.my_club_id());
drop policy if exists "videos_delete_staff" on public.player_videos;
create policy "videos_delete_staff" on public.player_videos for delete
  using (public.can_manage_videos() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');

-- Séquences : un joueur les envoie au staff qui a accès à lui (admins, coachs de son équipe).
drop policy if exists video_sequences_read on public.video_sequences;
create policy video_sequences_read on public.video_sequences for select using (
  exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
  or (public.can_edit() and club_id = public.my_club_id() and public.player_level(player_id) <> 'aucun'));
drop policy if exists video_sequences_insert on public.video_sequences;
create policy video_sequences_insert on public.video_sequences for insert with check (
  exists (select 1 from public.player_videos v
          where v.id = video_id and v.player_id = video_sequences.player_id and v.club_id = video_sequences.club_id)
  and (exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
       or (public.can_manage_videos() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification')));
drop policy if exists video_sequences_update on public.video_sequences;
create policy video_sequences_update on public.video_sequences for update using (
  exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
  or (public.can_manage_videos() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification'))
with check (
  exists (select 1 from public.player_videos v
          where v.id = video_id and v.player_id = video_sequences.player_id and v.club_id = video_sequences.club_id));
drop policy if exists video_sequences_delete on public.video_sequences;
create policy video_sequences_delete on public.video_sequences for delete using (
  (public.can_manage_videos() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification')
  or (created_by = auth.uid() and exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())));

drop policy if exists views_read_staff_only on public.video_views;
create policy views_read_staff_only on public.video_views for select using (
  public.is_video_stats_staff() and exists (select 1 from public.player_videos v
    where v.id = video_id and v.club_id = public.my_club_id() and public.player_level(v.player_id) <> 'aucun'));

drop policy if exists player_video_selections_read on public.player_video_selections;
create policy player_video_selections_read on public.player_video_selections for select using (
  exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
  or (public.can_edit() and club_id = public.my_club_id() and public.player_level(player_id) <> 'aucun'));

-- Tests et mesures physiques
drop policy if exists performance_tests_read on public.player_physical_tests;
create policy performance_tests_read on public.player_physical_tests for select
  using (public.can_view_performance() and club_id = public.my_club_id() and public.player_level(player_id) <> 'aucun');
drop policy if exists performance_tests_write on public.player_physical_tests;
create policy performance_tests_write on public.player_physical_tests for insert
  with check (public.is_performance_editor() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');
drop policy if exists performance_tests_update on public.player_physical_tests;
create policy performance_tests_update on public.player_physical_tests for update
  using (public.is_performance_editor() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification')
  with check (public.is_performance_editor() and club_id = public.my_club_id());
drop policy if exists performance_tests_delete on public.player_physical_tests;
create policy performance_tests_delete on public.player_physical_tests for delete
  using (public.is_performance_editor() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');

drop policy if exists performance_measurements_read on public.player_physical_measurements;
create policy performance_measurements_read on public.player_physical_measurements for select
  using (public.can_view_performance() and club_id = public.my_club_id() and public.player_level(player_id) <> 'aucun');
drop policy if exists performance_measurements_write on public.player_physical_measurements;
create policy performance_measurements_write on public.player_physical_measurements for insert
  with check (public.is_performance_editor() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');
drop policy if exists performance_measurements_update on public.player_physical_measurements;
create policy performance_measurements_update on public.player_physical_measurements for update
  using (public.is_performance_editor() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification')
  with check (public.is_performance_editor() and club_id = public.my_club_id());
drop policy if exists performance_measurements_delete on public.player_physical_measurements;
create policy performance_measurements_delete on public.player_physical_measurements for delete
  using (public.is_performance_editor() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');

-- Points (objectifs, préventions…) et leurs médias
drop policy if exists performance_notes_read on public.player_performance_notes;
create policy performance_notes_read on public.player_performance_notes for select using (
  exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
  or (public.can_view_performance() and club_id = public.my_club_id() and public.player_level(player_id) <> 'aucun'));
drop policy if exists performance_notes_write on public.player_performance_notes;
create policy performance_notes_write on public.player_performance_notes for insert
  with check (public.can_manage_plans() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');
drop policy if exists performance_notes_update on public.player_performance_notes;
create policy performance_notes_update on public.player_performance_notes for update
  using (public.can_manage_plans() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification')
  with check (public.can_manage_plans() and club_id = public.my_club_id());
drop policy if exists performance_notes_delete on public.player_performance_notes;
create policy performance_notes_delete on public.player_performance_notes for delete
  using (public.can_manage_plans() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');

drop policy if exists performance_media_read on public.player_performance_media;
create policy performance_media_read on public.player_performance_media for select using (
  exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
  or (public.can_view_performance() and club_id = public.my_club_id() and public.player_level(player_id) <> 'aucun'));
drop policy if exists performance_media_write on public.player_performance_media;
create policy performance_media_write on public.player_performance_media for insert
  with check (public.can_manage_plans() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');
drop policy if exists performance_media_update on public.player_performance_media;
create policy performance_media_update on public.player_performance_media for update
  using (public.can_manage_plans() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification')
  with check (public.can_manage_plans() and club_id = public.my_club_id());
drop policy if exists performance_media_delete on public.player_performance_media;
create policy performance_media_delete on public.player_performance_media for delete
  using (public.can_manage_plans() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');

-- Programme individuel
drop policy if exists player_programs_read on public.player_programs;
create policy player_programs_read on public.player_programs for select using (
  (visible_to_player and exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid()))
  or (public.is_staff() and club_id = public.my_club_id() and public.player_level(player_id) <> 'aucun'));
drop policy if exists player_programs_write on public.player_programs;
create policy player_programs_write on public.player_programs for all
  using (public.can_manage_plans() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification')
  with check (public.can_manage_plans() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');

drop policy if exists program_exercises_read on public.program_exercises;
create policy program_exercises_read on public.program_exercises for select using (
  exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
  or (public.is_staff() and club_id = public.my_club_id() and public.player_level(player_id) <> 'aucun'));
drop policy if exists program_exercises_write on public.program_exercises;
create policy program_exercises_write on public.program_exercises for all
  using (public.can_manage_plans() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification')
  with check (public.can_manage_plans() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification'
    and (video_id is null or exists (select 1 from public.player_videos v where v.id = video_id and v.player_id = program_exercises.player_id)));

-- Parcours
drop policy if exists player_career_read on public.player_career;
create policy player_career_read on public.player_career for select using (
  exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
  or (public.is_staff() and club_id = public.my_club_id() and public.player_level(player_id) <> 'aucun'));
drop policy if exists player_career_write on public.player_career;
create policy player_career_write on public.player_career for all
  using (public.can_edit() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification')
  with check (public.can_edit() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');

-- ------------------------------------------------------------
-- 4) Matchs : par l'équipe du match (comme les séances)
-- ------------------------------------------------------------
drop policy if exists matches_read on public.matches;
create policy matches_read on public.matches for select using (
  club_id = public.my_club_id() and (public.team_level(team_id) <> 'aucun' or created_by = auth.uid()));
drop policy if exists matches_write on public.matches;
create policy matches_write on public.matches for all
  using (public.can_edit() and club_id = public.my_club_id()
         and (public.team_level(team_id) = 'modification' or created_by = auth.uid()))
  with check (public.can_edit() and club_id = public.my_club_id()
    and (team_id is null or exists (select 1 from public.teams t where t.id = team_id and t.club_id = public.my_club_id()))
    and (public.team_level(team_id) = 'modification' or (team_id is null and created_by = auth.uid())));

drop policy if exists match_players_read on public.match_players;
create policy match_players_read on public.match_players for select using (
  club_id = public.my_club_id() and exists (select 1 from public.matches m where m.id = match_id));
drop policy if exists match_players_write on public.match_players;
create policy match_players_write on public.match_players for all
  using (public.can_edit() and club_id = public.my_club_id() and exists (select 1 from public.matches m where m.id = match_id
         and (public.team_level(m.team_id) = 'modification' or m.created_by = auth.uid())))
  with check (public.can_edit() and club_id = public.my_club_id()
    and exists (select 1 from public.matches m where m.id = match_id and m.club_id = public.my_club_id()
                and (public.team_level(m.team_id) = 'modification' or m.created_by = auth.uid()))
    and exists (select 1 from public.players p where p.id = player_id and p.club_id = public.my_club_id()));

-- ------------------------------------------------------------
-- 5) Fonctions qui écrivent sur un joueur
-- ------------------------------------------------------------
create or replace function public.set_player_photo(p_player_id bigint, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.can_edit() or public.is_performance_editor()) or public.player_level(p_player_id) <> 'modification' then
    raise exception 'Action réservée au staff de ce joueur.';
  end if;
  if p_path is not null and split_part(p_path, '/', 1) <> public.my_club_id()::text then
    raise exception 'Photo hors du dossier du club.';
  end if;
  update public.players set photo_path = p_path
   where id = p_player_id and club_id = public.my_club_id();
  if not found then raise exception 'Joueur introuvable dans votre club.'; end if;
end; $$;

create or replace function public.set_player_hidden_sections(p_player_ids bigint[], p_sections text[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not public.can_manage_plans() then
    raise exception 'Réservé à l’administrateur, au coach et au préparateur.';
  end if;
  update public.players
     set hidden_sections = coalesce((select array_agg(distinct s order by s) from unnest(p_sections) s), '{}')
   where id = any(p_player_ids) and club_id = public.my_club_id() and public.player_level(id) = 'modification';
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

-- ------------------------------------------------------------
-- 6) Stockage : photos, médias de performance, anciennes vidéos
--    (dossier « club/joueur/… »)
-- ------------------------------------------------------------
drop policy if exists "player_photos_read" on storage.objects;
create policy "player_photos_read" on storage.objects for select using (
  bucket_id = 'player-photos' and (
    exists (select 1 from public.players p where p.id::text = (storage.foldername(name))[2] and p.auth_user_id = auth.uid())
    or (public.can_view_performance() and (storage.foldername(name))[1] = public.my_club_id()::text
        and public.player_level_path(name) <> 'aucun')));
drop policy if exists "player_photos_write" on storage.objects;
create policy "player_photos_write" on storage.objects for insert with check (
  bucket_id = 'player-photos' and (public.can_edit() or public.is_performance_editor())
  and (storage.foldername(name))[1] = public.my_club_id()::text and public.player_level_path(name) = 'modification');
drop policy if exists "player_photos_update" on storage.objects;
create policy "player_photos_update" on storage.objects for update
  using (bucket_id = 'player-photos' and (public.can_edit() or public.is_performance_editor())
         and (storage.foldername(name))[1] = public.my_club_id()::text and public.player_level_path(name) = 'modification')
  with check (bucket_id = 'player-photos' and (public.can_edit() or public.is_performance_editor())
         and (storage.foldername(name))[1] = public.my_club_id()::text and public.player_level_path(name) = 'modification');
drop policy if exists "player_photos_delete" on storage.objects;
create policy "player_photos_delete" on storage.objects for delete using (
  bucket_id = 'player-photos' and (public.can_edit() or public.is_performance_editor())
  and (storage.foldername(name))[1] = public.my_club_id()::text and public.player_level_path(name) = 'modification');

drop policy if exists "player_perf_media_read" on storage.objects;
create policy "player_perf_media_read" on storage.objects for select using (
  bucket_id = 'player-performance-media' and (
    exists (select 1 from public.players p where p.id::text = (storage.foldername(name))[2] and p.auth_user_id = auth.uid())
    or (public.can_view_performance() and (storage.foldername(name))[1] = public.my_club_id()::text
        and public.player_level_path(name) <> 'aucun')));
drop policy if exists "player_perf_media_write" on storage.objects;
create policy "player_perf_media_write" on storage.objects for insert with check (
  bucket_id = 'player-performance-media' and public.can_manage_plans()
  and (storage.foldername(name))[1] = public.my_club_id()::text and public.player_level_path(name) = 'modification');
drop policy if exists "player_perf_media_update" on storage.objects;
create policy "player_perf_media_update" on storage.objects for update
  using (bucket_id = 'player-performance-media' and public.can_manage_plans()
         and (storage.foldername(name))[1] = public.my_club_id()::text and public.player_level_path(name) = 'modification')
  with check (bucket_id = 'player-performance-media' and public.can_manage_plans()
         and (storage.foldername(name))[1] = public.my_club_id()::text and public.player_level_path(name) = 'modification');
drop policy if exists "player_perf_media_delete" on storage.objects;
create policy "player_perf_media_delete" on storage.objects for delete using (
  bucket_id = 'player-performance-media' and public.can_manage_plans()
  and (storage.foldername(name))[1] = public.my_club_id()::text and public.player_level_path(name) = 'modification');

drop policy if exists "player_videos_read" on storage.objects;
create policy "player_videos_read" on storage.objects for select using (
  bucket_id = 'player-videos' and (
    exists (select 1 from public.players p where p.id::text = (storage.foldername(name))[2] and p.auth_user_id = auth.uid())
    or (public.can_edit() and (storage.foldername(name))[1] = public.my_club_id()::text
        and public.player_level_path(name) <> 'aucun')));
drop policy if exists "player_videos_write" on storage.objects;
create policy "player_videos_write" on storage.objects for insert with check (
  bucket_id = 'player-videos' and public.can_manage_videos()
  and (storage.foldername(name))[1] = public.my_club_id()::text and public.player_level_path(name) = 'modification');
drop policy if exists "player_videos_delete" on storage.objects;
create policy "player_videos_delete" on storage.objects for delete using (
  bucket_id = 'player-videos' and public.can_manage_videos()
  and (storage.foldername(name))[1] = public.my_club_id()::text and public.player_level_path(name) = 'modification');

-- ------------------------------------------------------------
-- 7) Corbeille : un élément d'un joueur n'est vu (et restauré) que par
--    ceux qui ont accès au joueur ; l'admin voit tout.
-- ------------------------------------------------------------
create or replace function public.trash_player_visible(p_tbl text, p_row bigint, p_root_tbl text, p_data jsonb)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_club_admin() or case
    when p_root_tbl in ('sessions', 'matches', 'teams', 'exercise_templates') then true
    when p_tbl = 'players' then public.player_level(p_row) <> 'aucun'
    when p_data ? 'player_id' and (p_data->>'player_id') ~ '^[0-9]{1,18}$'
      then public.player_level((p_data->>'player_id')::bigint) <> 'aucun'
    else true
  end;
$$;
revoke all on function public.trash_player_visible(text, bigint, text, jsonb) from public, anon;
grant execute on function public.trash_player_visible(text, bigint, text, jsonb) to authenticated;
drop policy if exists trash_player_scope on public.trash;
create policy trash_player_scope on public.trash as restrictive for all
  using (public.trash_player_visible(tbl, row_id, root_tbl, data));

create or replace function public.trash_restore(p_ids bigint[])
returns integer language plpgsql security definer set search_path = public as $body$
declare
  r          record;
  v_club     bigint := public.my_club_id();
  v_done     integer := 0;
  v_pending  bigint[];
  v_all      bigint[];
  v_next     bigint[];
  v_progress boolean;
begin
  if v_club is null then raise exception 'Connexion requise.'; end if;
  -- Seulement ce que la personne voit dans sa corbeille (séances, joueurs : lmfc_v10, lmfc_v19).
  select coalesce(array_agg(t.id order by t.id), '{}') into v_pending
    from public.trash t
   where (t.id = any(p_ids) or t.root_id = any(p_ids))
     and t.club_id = v_club and public.trash_right(t.root_tbl)
     and (t.root_tbl <> 'sessions' or public.trash_session_visible(coalesce(t.root_id, t.id)))
     and public.trash_player_visible(t.tbl, t.row_id, t.root_tbl, t.data);
  v_all := v_pending;
  loop
    v_next := '{}'; v_progress := false;
    for r in select t.* from public.trash t where t.id = any(v_pending) order by t.id loop
      -- Restaurable : une table du schéma public équipée du déclencheur de corbeille.
      if not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
                       join pg_namespace n on n.oid = c.relnamespace
                      where g.tgname = 'trash_capture' and n.nspname = 'public' and c.relname = r.tbl) then
        raise exception 'Élément non restaurable (%).', r.tbl;
      end if;
      begin
        execute format('insert into public.%I overriding system value select * from jsonb_populate_record(null::public.%I, $1)',
                       r.tbl, r.tbl) using r.data;
        v_progress := true;
        if r.root_id is null then v_done := v_done + 1; end if;
        if r.tbl = 'teams' and r.extra is not null then
          update public.players  set team_id = r.row_id
           where club_id = v_club and team_id is null and id in (select (jsonb_array_elements_text(r.extra->'players'))::bigint);
          update public.sessions set team_id = r.row_id
           where club_id = v_club and team_id is null and id in (select (jsonb_array_elements_text(r.extra->'sessions'))::bigint);
        elsif r.tbl = 'player_videos' and r.extra is not null then
          update public.program_exercises set video_id = r.row_id
           where club_id = v_club and video_id is null
             and id in (select (jsonb_array_elements_text(r.extra->'program_exercises'))::bigint);
          update public.tactical_schemas set video_id = r.row_id
           where video_id is null
             and id in (select (jsonb_array_elements_text(coalesce(r.extra->'tactical_schemas', '[]')))::bigint)
             and exists (select 1 from public.procedures pr join public.sessions s on s.id = pr.session_id
                          where pr.id = tactical_schemas.procedure_id and s.club_id = v_club);
        end if;
      exception
        when unique_violation then
          if r.root_id is null then
            raise exception 'Restauration impossible : un élément identique existe déjà (même nom ?). Renommez-le, puis réessayez.';
          end if;
          v_progress := true;
        when foreign_key_violation then
          v_next := v_next || r.id;
      end;
    end loop;
    exit when cardinality(v_next) = 0 or not v_progress;
    v_pending := v_next;
  end loop;
  if exists (select 1 from public.trash t where t.id = any(v_next) and t.root_id is null) then
    raise exception 'Restauration impossible : ce qui contenait cet élément (joueur, séance, vidéo) n''existe plus. Restaurez-le d''abord.';
  end if;
  delete from public.trash t where t.id = any(v_all);
  return v_done;
end; $body$;

commit;
