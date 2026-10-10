/* ============================================================
   LMFC Performance — migration 33 : membres du club, plusieurs
   équipes par compte.
   À exécuter APRÈS lmfc_v13.sql. Idempotent (rejouable) et
   transactionnel : en cas d'erreur, rien n'est appliqué.

   1) Membres du club réservés à l'administrateur : un compte ne lit
      plus que son propre profil ; l'administrateur lit ceux du club.
      Ce dont le staff a besoin (noms du staff d'un procédé, droits
      d'accès d'une séance, auteurs dans la corbeille et les PDF)
      passe par club_staff() : id, nom, rôle et équipes des comptes
      staff seulement, rien pour un compte joueur.
   2) Plusieurs équipes par compte (profiles.team_ids) : un coach de
      N2, N3 et U19 a un seul compte. Vide = toutes les équipes.
      profiles.team_id reste la première, pour compatibilité. Seul
      l'administrateur les change (la garde existante l'impose).
   ============================================================ */
begin;

-- ------------------------------------------------------------
-- 1) Équipes du compte
-- ------------------------------------------------------------
alter table public.profiles add column if not exists team_ids bigint[] not null default '{}';
update public.profiles set team_ids = array[team_id] where team_id is not null and team_ids = '{}';

create or replace function public.guard_profile_membership_changes()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  -- Depuis le site, un compte ne change ni son rôle, ni son club, ni ses équipes.
  if auth.uid() = old.id and current_user = 'authenticated' then
    new.role := old.role;
    new.club_id := old.club_id;
    new.team_id := old.team_id;
    new.team_ids := old.team_ids;
  end if;
  -- Compte qui quitte le club (club_remove_member) : plus d'équipe.
  if new.club_id is distinct from old.club_id then new.team_ids := '{}'; end if;
  -- Seulement des équipes du club, sans doublon (une équipe supprimée disparaît de la liste).
  new.team_ids := coalesce((select array_agg(distinct x order by x) from unnest(new.team_ids) x
    where exists (select 1 from public.teams t where t.id = x and t.club_id = new.club_id)), '{}');
  new.team_id := new.team_ids[1];
  return new;
end; $$;

-- Équipe supprimée : elle sort de la liste des comptes qui l'avaient.
create or replace function public.teams_forget_in_profiles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set team_ids = array_remove(team_ids, old.id) where old.id = any(team_ids);
  return old;
end; $$;
drop trigger if exists trg_teams_forget_profiles on public.teams;
create trigger trg_teams_forget_profiles after delete on public.teams
  for each row execute function public.teams_forget_in_profiles();

-- ------------------------------------------------------------
-- 2) Profils : soi-même, ou tout le club pour l'administrateur.
--    Toute autre politique de lecture est retirée.
-- ------------------------------------------------------------
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT' loop
    execute format('drop policy %I on public.profiles', p.policyname);
  end loop;
end $$;
create policy "profiles_read" on public.profiles for select
  using (id = auth.uid() or (club_id = public.my_club_id() and public.is_club_admin()));

-- Staff du club, pour le staff : rien d'autre que ce qu'il faut afficher.
create or replace function public.club_staff()
returns table (id uuid, nom text, role text, team_ids bigint[])
language sql stable security definer set search_path = public as $$
  select p.id, p.nom, p.role, p.team_ids from public.profiles p
  where p.club_id = public.my_club_id() and p.role <> 'joueur' and public.is_staff()
  order by p.nom;
$$;
revoke all on function public.club_staff() from public, anon;
grant execute on function public.club_staff() to authenticated;

-- ------------------------------------------------------------
-- 3) Droits par séance (lmfc_v10.sql) avec plusieurs équipes
-- ------------------------------------------------------------
create or replace function public.session_level(p_id bigint, p_club bigint, p_created_by uuid, p_acces text, p_team bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_club is distinct from public.my_club_id() then 'aucun'
    when public.is_club_admin() then 'modification'
    when p_created_by = auth.uid() then 'modification'
    when a.niveau = 'modification' and not public.can_edit() then 'lecture'
    when a.niveau is not null then a.niveau
    when p_acces = 'club' then case when public.can_edit() then 'modification' else 'lecture' end
    when public.is_staff() and (p_team is null or cardinality(me.team_ids) = 0 or p_team = any(me.team_ids)) then 'lecture'
    else 'aucun'
  end
  from (select 1) x
  left join public.session_access a on a.session_id = p_id and a.profile_id = auth.uid()
  left join public.profiles me on me.id = auth.uid();
$$;

-- Réglage nominatif : la personne visée est du staff du club ; « modification »
-- seulement pour un compte admin ou coach. Lu sans RLS (les profils des autres
-- ne sont plus lisibles par le créateur de la séance).
create or replace function public.staff_can_receive(p_profile uuid, p_niveau text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles pr where pr.id = p_profile and pr.club_id = public.my_club_id()
                 and pr.role <> 'joueur' and (p_niveau <> 'modification' or pr.role in ('admin', 'coach')));
$$;
revoke all on function public.staff_can_receive(uuid, text) from public, anon;
grant execute on function public.staff_can_receive(uuid, text) to authenticated;

drop policy if exists session_access_write on public.session_access;
create policy session_access_write on public.session_access for all
  using (exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id()
                  and (s.created_by = auth.uid() or public.is_club_admin())))
  with check (
    exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id()
             and (s.created_by = auth.uid() or public.is_club_admin()))
    and public.staff_can_receive(profile_id, niveau));

commit;
