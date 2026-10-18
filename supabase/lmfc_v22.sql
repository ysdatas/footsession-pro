/* ============================================================
   LMFC Performance — lmfc_v22.sql : rôle « lecteur » (scout)
   À exécuter APRÈS lmfc_v21.sql. Rejouable, transactionnelle.

   Un lecteur consulte tout le club, sans jamais rien modifier :
     - joueurs et fiches (identité, parcours, objectifs, préventions,
       programme terrain) de toutes les équipes, sauf un joueur que
       l'admin lui masque (exception « aucun », Mon club → Accès) ;
     - données physiques, tests, radar, médias, photos ;
     - vidéos, séquences, sélections, statistiques de visionnage ;
     - ni séances, ni matchs (team_level / session_level : aucun).
   Il n'a aucun des droits d'écriture (can_edit, can_manage_videos,
   is_performance_editor, can_manage_plans). Comme is_staff() vaut
   vrai pour tout compte non joueur, un filet s'ajoute : trois règles
   RESTRICTIVES par table refusent toute écriture d'un lecteur, quelles
   que soient les règles actuelles ou futures. Seuls son profil (nom,
   menu, équipe affichée ; la garde de lmfc_v19 bloque rôle, club et
   équipes) et ses abonnements aux notifications restent ouverts.
   Toute nouvelle table doit recevoir ces trois règles (README).
   ============================================================ */
begin;

-- ------------------------------------------------------------
-- 1) Le rôle
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 2) Fonctions de rôle (les deux dernières ne servent qu'en lecture)
-- ------------------------------------------------------------
create or replace function public.is_lecteur()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('lecteur');
$$;
create or replace function public.can_read_videos()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach', 'lecteur');
$$;
create or replace function public.can_view_performance()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach', 'prepa', 'lecteur');
$$;
create or replace function public.is_video_stats_staff()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach', 'lecteur');
$$;
do $$
declare f text;
begin
  foreach f in array array['is_lecteur()', 'can_read_videos()', 'club_set_member_role(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3) Niveaux (lmfc_v19.sql, plus la ligne « lecteur »)
-- ------------------------------------------------------------
-- Joueur : lecture sur tout le club, jamais modification ; « aucun » le masque.
create or replace function public.player_level_for(p_profile uuid, p_player bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when me.id is null or me.role = 'joueur' or pl.id is null or pl.club_id is distinct from me.club_id then 'aucun'
    when me.role = 'admin' then 'modification'
    when me.role = 'lecteur' then case when x.niveau = 'aucun' then 'aucun' else 'lecture' end
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

-- Équipe (matchs, séances) : rien pour un lecteur.
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

-- Séance : rien pour un lecteur, même avec un réglage nominatif ou une séance « club ».
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

-- Noms du staff (séances, auteurs, corbeille) : le lecteur n'en fait pas partie.
create or replace function public.club_staff()
returns table (id uuid, nom text, role text, team_ids bigint[], lecture_club boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.nom, p.role, p.team_ids, p.lecture_club from public.profiles p
  where p.club_id = public.my_club_id() and p.role not in ('joueur', 'lecteur') and public.is_staff()
  order by p.nom;
$$;

-- ------------------------------------------------------------
-- 4) Vidéos : lues par admin, coach et lecteur (forme de lmfc_v21.sql)
-- ------------------------------------------------------------
drop policy if exists "videos_read_staff" on public.player_videos;
create policy "videos_read_staff" on public.player_videos for select
  using ((select public.can_read_videos()) and club_id = (select public.my_club_id())
         and player_id in (select public.my_visible_players()));

drop policy if exists video_sequences_read on public.video_sequences;
create policy video_sequences_read on public.video_sequences for select using (
  player_id in (select public.my_player_ids())
  or ((select public.can_read_videos()) and club_id = (select public.my_club_id())
      and player_id in (select public.my_visible_players())));

drop policy if exists player_video_selections_read on public.player_video_selections;
create policy player_video_selections_read on public.player_video_selections for select using (
  player_id in (select public.my_player_ids())
  or ((select public.can_read_videos()) and club_id = (select public.my_club_id())
      and player_id in (select public.my_visible_players())));

drop policy if exists "player_videos_read" on storage.objects;
create policy "player_videos_read" on storage.objects for select using (
  bucket_id = 'player-videos' and (
    exists (select 1 from public.players p where p.id::text = (storage.foldername(name))[2] and p.auth_user_id = auth.uid())
    or (public.can_read_videos() and (storage.foldername(name))[1] = public.my_club_id()::text
        and public.player_level_path(name) <> 'aucun')));

-- ------------------------------------------------------------
-- 5) Filet : un lecteur n'écrit nulle part
-- ------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select n.nspname as sch, c.relname as tbl from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and c.relrowsecurity
      and ((n.nspname = 'public' and c.relname not in ('profiles', 'push_subscriptions'))
           or (n.nspname = 'storage' and c.relname = 'objects'))
  loop
    execute format('drop policy if exists lecteur_no_insert on %I.%I', t.sch, t.tbl);
    execute format('drop policy if exists lecteur_no_update on %I.%I', t.sch, t.tbl);
    execute format('drop policy if exists lecteur_no_delete on %I.%I', t.sch, t.tbl);
    execute format('create policy lecteur_no_insert on %I.%I as restrictive for insert to authenticated
                      with check (not (select public.is_lecteur()))', t.sch, t.tbl);
    execute format('create policy lecteur_no_update on %I.%I as restrictive for update to authenticated
                      using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()))', t.sch, t.tbl);
    execute format('create policy lecteur_no_delete on %I.%I as restrictive for delete to authenticated
                      using (not (select public.is_lecteur()))', t.sch, t.tbl);
  end loop;
end $$;

commit;
