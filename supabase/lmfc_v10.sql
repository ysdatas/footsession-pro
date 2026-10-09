/* ============================================================
   LMFC Performance — migration 29 : droits d'accès par séance.
   À exécuter APRÈS lmfc_v9.sql. Idempotent (rejouable) et
   transactionnel : en cas d'erreur, rien n'est appliqué.

   Niveau d'un compte sur une séance (session_access_level) :
     1. administrateur du club           → modification
     2. créateur de la séance            → modification
     3. réglage nominatif (session_access) → aucun / lecture / modification
        (« modification » ne vaut que pour un compte admin ou coach)
     4. séance « club » (toutes les séances d'avant) : comme avant,
        le club lit, admin et coachs modifient
     5. séance « equipe » (défaut des nouvelles) : le staff de l'équipe
        de la séance lit, ainsi que le staff sans équipe fixe
   Les tables de la séance (procédés, schémas, présences, commentaires,
   bilans) suivent ce niveau ; les exports aussi (mêmes requêtes).
   Seuls le créateur et l'administrateur changent les droits.
   ============================================================ */
begin;

-- ------------------------------------------------------------
-- 1) Colonnes
-- ------------------------------------------------------------
alter table public.sessions alter column created_by set default auth.uid();
alter table public.sessions add column if not exists acces text not null default 'club';
alter table public.sessions drop constraint if exists sessions_acces_check;
alter table public.sessions add constraint sessions_acces_check check (acces in ('club', 'equipe'));
alter table public.sessions alter column acces set default 'equipe';   -- les séances existantes restent « club »

create table if not exists public.session_access (
  id         bigint generated always as identity primary key,   -- la corbeille repère les lignes par id
  session_id bigint not null references public.sessions on delete cascade,
  profile_id uuid not null references public.profiles on delete cascade,
  niveau     text not null check (niveau in ('aucun', 'lecture', 'modification')),
  unique (session_id, profile_id)
);
create index if not exists session_access_profile_idx on public.session_access (profile_id);

-- ------------------------------------------------------------
-- 2) Niveau d'accès (SECURITY DEFINER : lit séance et réglages sans RLS)
-- ------------------------------------------------------------
-- À partir des champs de la séance : utilisable sur une ligne qui vient
-- d'être créée (insert … returning), encore invisible par son id.
create or replace function public.session_level(p_id bigint, p_club bigint, p_created_by uuid, p_acces text, p_team bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_club is distinct from public.my_club_id() then 'aucun'
    when public.is_club_admin() then 'modification'
    when p_created_by = auth.uid() then 'modification'
    when a.niveau = 'modification' and not public.can_edit() then 'lecture'
    when a.niveau is not null then a.niveau
    when p_acces = 'club' then case when public.can_edit() then 'modification' else 'lecture' end
    when public.is_staff() and (p_team is null or me.team_id is null or me.team_id = p_team) then 'lecture'
    else 'aucun'
  end
  from (select 1) x
  left join public.session_access a on a.session_id = p_id and a.profile_id = auth.uid()
  left join public.profiles me on me.id = auth.uid();
$$;
-- Par l'id : pour les tables de la séance et pour la page (rpc).
create or replace function public.session_access_level(p_session bigint)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select public.session_level(s.id, s.club_id, s.created_by, s.acces, s.team_id)
                     from public.sessions s where s.id = p_session), 'aucun');
$$;
revoke all on function public.session_level(bigint, bigint, uuid, text, bigint) from public, anon;
revoke all on function public.session_access_level(bigint) from public, anon;
grant execute on function public.session_level(bigint, bigint, uuid, text, bigint) to authenticated;
grant execute on function public.session_access_level(bigint) to authenticated;

-- ------------------------------------------------------------
-- 3) Garde : le créateur est celui qui crée ; seuls le créateur et
--    l'administrateur changent l'accès de base ou le créateur.
-- ------------------------------------------------------------
create or replace function public.guard_session_access()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- SQL Editor, tâches serveur
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  elsif (new.acces is distinct from old.acces or new.created_by is distinct from old.created_by)
        and not (old.created_by = auth.uid() or public.is_club_admin()) then
    new.acces := old.acces;
    new.created_by := old.created_by;
  end if;
  return new;
end; $$;
drop trigger if exists trg_guard_session_access on public.sessions;
create trigger trg_guard_session_access before insert or update on public.sessions
  for each row execute function public.guard_session_access();

-- ------------------------------------------------------------
-- 4) Politiques : la séance et tout ce qui lui appartient
-- ------------------------------------------------------------
drop policy if exists "sessions_read"   on public.sessions;
drop policy if exists "sessions_write"  on public.sessions;
drop policy if exists "sessions_insert" on public.sessions;
drop policy if exists "sessions_update" on public.sessions;
drop policy if exists "sessions_delete" on public.sessions;
create policy "sessions_read" on public.sessions for select
  using (public.session_level(id, club_id, created_by, acces, team_id) <> 'aucun');
create policy "sessions_insert" on public.sessions for insert
  with check (club_id = public.my_club_id() and public.can_edit());
create policy "sessions_update" on public.sessions for update
  using (public.session_level(id, club_id, created_by, acces, team_id) = 'modification') with check (club_id = public.my_club_id());
create policy "sessions_delete" on public.sessions for delete
  using (public.session_level(id, club_id, created_by, acces, team_id) = 'modification');

drop policy if exists "procedures_read"  on public.procedures;
drop policy if exists "procedures_write" on public.procedures;
create policy "procedures_read" on public.procedures for select using (public.session_access_level(session_id) <> 'aucun');
create policy "procedures_write" on public.procedures for all
  using (public.session_access_level(session_id) = 'modification')
  with check (public.session_access_level(session_id) = 'modification');

drop policy if exists "schemas_read"  on public.tactical_schemas;
drop policy if exists "schemas_write" on public.tactical_schemas;
create policy "schemas_read" on public.tactical_schemas for select using (
  public.session_access_level((select p.session_id from public.procedures p where p.id = procedure_id)) <> 'aucun');
create policy "schemas_write" on public.tactical_schemas for all
  using (public.session_access_level((select p.session_id from public.procedures p where p.id = procedure_id)) = 'modification')
  with check (public.session_access_level((select p.session_id from public.procedures p where p.id = procedure_id)) = 'modification');

drop policy if exists "attendance_read"  on public.attendance;
drop policy if exists "attendance_write" on public.attendance;
create policy "attendance_read" on public.attendance for select
  using (public.is_staff() and public.session_access_level(session_id) <> 'aucun');
create policy "attendance_write" on public.attendance for all
  using (public.session_access_level(session_id) = 'modification')
  with check (public.session_access_level(session_id) = 'modification'
    and exists (select 1 from public.players p where p.id = player_id and p.club_id = public.my_club_id()));
-- attendance_read_self (le joueur lit ses présences) est conservée.

drop policy if exists "comments_read"   on public.session_comments;
drop policy if exists "comments_write"  on public.session_comments;
create policy "comments_read" on public.session_comments for select using (public.session_access_level(session_id) <> 'aucun');
create policy "comments_write" on public.session_comments for insert with check (public.session_access_level(session_id) = 'modification');
-- comments_delete (son commentaire, ou l'administrateur) est conservée.

drop policy if exists session_bilans_read  on public.session_bilans;
drop policy if exists session_bilans_write on public.session_bilans;
create policy session_bilans_read on public.session_bilans for select
  using (public.is_staff() and public.session_access_level(session_id) <> 'aucun');
create policy session_bilans_write on public.session_bilans for all
  using (public.session_access_level(session_id) = 'modification')
  with check (public.session_access_level(session_id) = 'modification'
    and exists (select 1 from public.players p where p.id = player_id and p.club_id = public.my_club_id()));

-- Réglages nominatifs : visibles par ceux qui voient la séance ; écrits par
-- son créateur ou l'administrateur, pour un membre du staff du club ;
-- « modification » seulement pour un compte admin ou coach.
alter table public.session_access enable row level security;
drop policy if exists session_access_read  on public.session_access;
drop policy if exists session_access_write on public.session_access;
create policy session_access_read on public.session_access for select using (public.session_access_level(session_id) <> 'aucun');
create policy session_access_write on public.session_access for all
  using (exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id()
                  and (s.created_by = auth.uid() or public.is_club_admin())))
  with check (
    exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id()
             and (s.created_by = auth.uid() or public.is_club_admin()))
    and exists (select 1 from public.profiles pr where pr.id = profile_id and pr.club_id = public.my_club_id()
                 and pr.role <> 'joueur' and (niveau <> 'modification' or pr.role in ('admin', 'coach'))));
revoke all on public.session_access from anon;
grant select, insert, update, delete on public.session_access to authenticated;

-- ------------------------------------------------------------
-- 5) Corbeille : une séance supprimée reste aussi discrète qu'avant
--    (accès « equipe » : seuls l'administrateur et l'auteur de la
--    suppression la voient). Les réglages partent et reviennent avec elle.
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.trash') is null then return; end if;
  execute $f$
    create or replace function public.trash_session_visible(p_root bigint)
    returns boolean language sql stable security definer set search_path = public as $b$
      select coalesce((select coalesce(r.data->>'acces', 'club') = 'club' or r.deleted_by = auth.uid() or public.is_club_admin()
                         from public.trash r where r.id = p_root and r.tbl = 'sessions'), true);
    $b$;
  $f$;
  revoke all on function public.trash_session_visible(bigint) from public, anon;
  grant execute on function public.trash_session_visible(bigint) to authenticated;
  drop policy if exists trash_session_scope on public.trash;
  create policy trash_session_scope on public.trash as restrictive for all
    using (root_tbl <> 'sessions' or public.trash_session_visible(coalesce(root_id, id)));
  if to_regprocedure('public.trash_capture()') is not null then
    drop trigger if exists trash_capture on public.session_access;
    create trigger trash_capture before delete on public.session_access
      for each row execute function public.trash_capture('child', 'sessions:session_id');
  end if;
end $$;

commit;
