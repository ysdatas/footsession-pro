-- ============================================================
--  FootSession Pro — Données PRIVÉES PAR UTILISATEUR
--                    + SUPERVISION ADMIN
--
--  Règle appliquée :
--    • un membre (coach / analyste / prépa / viewer) ne voit et ne
--      modifie QUE ce qu'il a créé ;
--    • un ADMIN du club voit et modifie TOUT ce qui appartient à
--      son club (supervision) ;
--    • aucun accès entre clubs différents.
--
--  Le club sert désormais à : l'identité (nom, logo, couleur),
--  le regroupement du staff, et le périmètre de supervision admin.
--
--  Le lien de partage public (share_token) continue de fonctionner :
--  il passe par une fonction SECURITY DEFINER, non soumise au RLS.
--
--  À exécuter dans Supabase → SQL Editor. Sûr à relancer (idempotent).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Colonne propriétaire, remplie automatiquement à l'insertion
-- ------------------------------------------------------------
alter table public.sessions
  alter column created_by set default auth.uid();

alter table public.players
  add column if not exists created_by uuid references auth.users on delete cascade;
alter table public.players
  alter column created_by set default auth.uid();

alter table public.exercise_templates
  alter column created_by set default auth.uid();

-- ------------------------------------------------------------
-- 2) Rattacher les données existantes (sinon elles deviendraient
--    invisibles). On les attribue au créateur du club.
-- ------------------------------------------------------------
update public.sessions s
   set created_by = c.created_by
  from public.clubs c
 where s.club_id = c.id and s.created_by is null and c.created_by is not null;

update public.players p
   set created_by = c.created_by
  from public.clubs c
 where p.club_id = c.id and p.created_by is null and c.created_by is not null;

update public.exercise_templates t
   set created_by = c.created_by
  from public.clubs c
 where t.club_id = c.id and t.created_by is null and c.created_by is not null;

-- ------------------------------------------------------------
-- 3) Helper : « je suis le propriétaire » OU « je suis admin du club »
--    (SECURITY DEFINER → pas de récursion RLS)
-- ------------------------------------------------------------
create or replace function public.owns_or_admin(p_owner uuid, p_club bigint)
returns boolean language sql security definer stable set search_path = public as $$
  select p_owner = auth.uid()
      or (public.is_club_admin() and p_club = public.my_club_id());
$$;
grant execute on function public.owns_or_admin(uuid, bigint) to authenticated;

-- ------------------------------------------------------------
-- 4) Politiques : propriétaire, ou admin du même club
--    (on supprime d'abord toutes les variantes précédentes)
-- ------------------------------------------------------------
drop policy if exists "sessions_read"  on public.sessions;
drop policy if exists "sessions_write" on public.sessions;
drop policy if exists "sessions_owner" on public.sessions;
create policy "sessions_owner" on public.sessions for all
  using (public.owns_or_admin(created_by, club_id))
  with check (public.owns_or_admin(created_by, club_id) and club_id = public.my_club_id());

drop policy if exists "players_read"  on public.players;
drop policy if exists "players_write" on public.players;
drop policy if exists "players_owner" on public.players;
create policy "players_owner" on public.players for all
  using (public.owns_or_admin(created_by, club_id))
  with check (public.owns_or_admin(created_by, club_id) and club_id = public.my_club_id());

drop policy if exists "templates_read"  on public.exercise_templates;
drop policy if exists "templates_write" on public.exercise_templates;
drop policy if exists "templates_owner" on public.exercise_templates;
create policy "templates_owner" on public.exercise_templates for all
  using (public.owns_or_admin(created_by, club_id))
  with check (public.owns_or_admin(created_by, club_id) and club_id = public.my_club_id());

-- ------------------------------------------------------------
-- 5) Tables enfant : on remonte au propriétaire via la séance
-- ------------------------------------------------------------
drop policy if exists "procedures_read"  on public.procedures;
drop policy if exists "procedures_write" on public.procedures;
drop policy if exists "procedures_owner" on public.procedures;
create policy "procedures_owner" on public.procedures for all
  using (exists (select 1 from public.sessions s
                 where s.id = session_id and public.owns_or_admin(s.created_by, s.club_id)))
  with check (exists (select 1 from public.sessions s
                 where s.id = session_id and public.owns_or_admin(s.created_by, s.club_id)));

drop policy if exists "schemas_read"  on public.tactical_schemas;
drop policy if exists "schemas_write" on public.tactical_schemas;
drop policy if exists "schemas_owner" on public.tactical_schemas;
create policy "schemas_owner" on public.tactical_schemas for all
  using (exists (select 1 from public.procedures p join public.sessions s on s.id = p.session_id
                 where p.id = procedure_id and public.owns_or_admin(s.created_by, s.club_id)))
  with check (exists (select 1 from public.procedures p join public.sessions s on s.id = p.session_id
                 where p.id = procedure_id and public.owns_or_admin(s.created_by, s.club_id)));

drop policy if exists "attendance_read"  on public.attendance;
drop policy if exists "attendance_write" on public.attendance;
drop policy if exists "attendance_owner" on public.attendance;
create policy "attendance_owner" on public.attendance for all
  using (exists (select 1 from public.sessions s
                 where s.id = session_id and public.owns_or_admin(s.created_by, s.club_id)))
  with check (exists (select 1 from public.sessions s
                 where s.id = session_id and public.owns_or_admin(s.created_by, s.club_id)));

drop policy if exists "comments_read"   on public.session_comments;
drop policy if exists "comments_write"  on public.session_comments;
drop policy if exists "comments_delete" on public.session_comments;
create policy "comments_read" on public.session_comments for select
  using (exists (select 1 from public.sessions s
                 where s.id = session_id and public.owns_or_admin(s.created_by, s.club_id)));
create policy "comments_write" on public.session_comments for insert
  with check (exists (select 1 from public.sessions s
                 where s.id = session_id and public.owns_or_admin(s.created_by, s.club_id)));
create policy "comments_delete" on public.session_comments for delete
  using (user_id = auth.uid() or public.is_club_admin());
