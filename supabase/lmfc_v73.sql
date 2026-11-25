/* ============================================================
   LMFC Performance — lmfc_v73.sql : statut « Groupe <équipe> » à la séance
   À exécuter après lmfc_v72.sql. Rejouable et transactionnelle.

   Dans la liste de présence d'une séance, un joueur peut être noté « Groupe
   Espoirs », « Groupe Section »… : une des équipes du club (créer une équipe
   « Section » dans Club › Équipes suffit pour qu'elle soit proposée).
     - attendance.statut 'groupe' + attendance.groupe_team_id (l'équipe) ;
       il ne participe pas à cette séance (present = false) ;
     - renvoi : s'il y a une séance de ce groupe à la même demi-journée
       (rpe_slot, lmfc_v61.sql : matin avant 13 h, après-midi ensuite, une séance
       sans heure touche tout le jour), le joueur y est noté présent (invité s'il
       n'est pas de ses équipes), ligne marquée attendance.groupe_de = la séance
       d'où il vient. Une présence déjà notée là-bas (autre qu'« absent ») n'est
       pas touchée ;
     - le renvoi suit : statut changé ou retiré, séance du groupe créée,
       déplacée, changée d'équipe ou fusionnée ; une ligne renvoyée que le staff
       change devient la sienne (groupe_de vidé) ;
     - player_session_ok : la séance d'où il vient ne lui demande plus rien
       (RPE, questionnaires) quand le renvoi a eu lieu ; sinon, comme avant.
   La séance d'où il vient est écrite par le staff qui y a les droits (RLS) ; le
   renvoi, lui, est écrit par la base (security definer) : seulement ce joueur,
   seulement une séance du club, de ce groupe, de la même demi-journée.

   Témoin : attendance_groupes() (API publique : 42501 si la migration est passée).
   Retour arrière : lmfc_v73_retour.sql (« Groupe Espoirs » devient « Autre »
   avec ce motif ; les présences renvoyées restent).
   ============================================================ */
begin;

alter table public.attendance add column if not exists groupe_team_id bigint references public.teams on delete set null;
alter table public.attendance add column if not exists groupe_de bigint references public.sessions on delete cascade;
create index if not exists attendance_groupe_de_idx on public.attendance (groupe_de) where groupe_de is not null;

alter table public.attendance drop constraint if exists attendance_statut_check;
alter table public.attendance add constraint attendance_statut_check check (statut is null
  or statut in ('present', 'reprise', 'retard', 'absent', 'excuse', 'blesse', 'malade', 'selection', 'groupe_pro', 'autre', 'non_concerne', 'groupe'));

-- ------------------------------------------------------------
-- 1) Une ligne « groupe » : l'équipe du club, obligatoire ; groupe_de n'est écrit que par le renvoi
-- ------------------------------------------------------------
create or replace function public.attendance_groupe_check()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Réenregistrée sans son groupe (fiche du calendrier, lmfc_v43.sql : insert … on conflict) : le groupe noté reste.
  if tg_op = 'INSERT' and new.statut = 'groupe' and new.groupe_team_id is null then
    select a.groupe_team_id into new.groupe_team_id from public.attendance a
     where a.session_id = new.session_id and a.player_id = new.player_id and a.statut = 'groupe';
  end if;
  if new.statut is distinct from 'groupe' then
    new.groupe_team_id := null;
  elsif new.groupe_team_id is null then
    raise exception 'Choisissez le groupe du joueur.' using errcode = '23514';
  elsif tg_op = 'INSERT' or new.groupe_team_id is distinct from old.groupe_team_id then
    if not exists (select 1 from public.sessions s join public.teams t on t.club_id = s.club_id
                    where s.id = new.session_id and t.id = new.groupe_team_id) then
      raise exception 'Groupe inconnu dans ce club.' using errcode = '23514';
    end if;
  end if;
  if pg_trigger_depth() = 1 then   -- écriture du staff, pas du renvoi
    if tg_op = 'INSERT' then new.groupe_de := null;
    elsif new.statut is distinct from old.statut then new.groupe_de := null;   -- changée par le staff : elle devient la sienne
    else new.groupe_de := old.groupe_de;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists trg_attendance_groupe_check on public.attendance;
create trigger trg_attendance_groupe_check before insert or update on public.attendance
  for each row execute function public.attendance_groupe_check();

-- ------------------------------------------------------------
-- 2) Le renvoi : séances du groupe à la même demi-journée
-- ------------------------------------------------------------
create or replace function public.attendance_groupe_targets(p_session bigint, p_team bigint)
returns setof bigint language sql stable security definer set search_path = public as $$
  select o.id from public.sessions o
   where o.id in (select public.rpe_slot(p_session)) and o.id <> p_session and o.fusionnee_dans is null
     and (o.team_id = p_team or p_team = any(coalesce(o.other_team_ids, '{}')));
$$;

create or replace function public.attendance_groupe_apply(p_session bigint, p_player bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_team bigint;
begin
  select a.groupe_team_id into v_team from public.attendance a
   where a.session_id = p_session and a.player_id = p_player and a.statut = 'groupe';
  -- Renvois qui ne valent plus : retirés (dans son équipe, il redevient « absent » par défaut).
  delete from public.attendance x
   where x.groupe_de = p_session and x.player_id = p_player
     and (v_team is null or x.session_id not in (select public.attendance_groupe_targets(p_session, v_team)));
  if v_team is null then return; end if;
  insert into public.attendance (player_id, session_id, statut, invite, groupe_de)
  select p.id, o.id, 'present',
         not (array_remove(array[o.team_id] || coalesce(o.other_team_ids, '{}'), null) && array_remove(array[p.team_id] || coalesce(p.other_team_ids, '{}'), null)),
         p_session
    from public.players p
    join public.sessions o on o.id in (select public.attendance_groupe_targets(p_session, v_team)) and o.club_id = p.club_id
   where p.id = p_player
  on conflict (player_id, session_id) do update set statut = 'present', groupe_de = excluded.groupe_de
   where public.attendance.statut is null or public.attendance.statut = 'absent' or public.attendance.groupe_de = excluded.groupe_de;
end; $$;
revoke all on function public.attendance_groupe_targets(bigint, bigint) from public, anon, authenticated;
revoke all on function public.attendance_groupe_apply(bigint, bigint) from public, anon, authenticated;

-- Après une écriture du staff dans la liste de présence (le renvoi lui-même ne relance rien).
create or replace function public.attendance_groupe_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then
    perform public.attendance_groupe_apply(old.session_id, old.player_id);
  elsif new.statut = 'groupe' or (tg_op = 'UPDATE' and old.statut = 'groupe') then
    perform public.attendance_groupe_apply(new.session_id, new.player_id);
  end if;
  return null;
end; $$;
drop trigger if exists trg_attendance_groupe_after on public.attendance;
create trigger trg_attendance_groupe_after after insert or update or delete on public.attendance
  for each row execute function public.attendance_groupe_after();

-- Séance créée, déplacée, changée d'équipe ou fusionnée : les renvois de sa demi-journée suivent.
create or replace function public.sessions_groupe_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  for r in
    select a.session_id, a.player_id from public.attendance a
     where a.statut = 'groupe' and a.session_id in (select public.rpe_slot(new.id))
    union
    select x.groupe_de, x.player_id from public.attendance x where x.session_id = new.id and x.groupe_de is not null
  loop
    perform public.attendance_groupe_apply(r.session_id, r.player_id);
  end loop;
  return null;
end; $$;
drop trigger if exists trg_sessions_groupe_after on public.sessions;
create trigger trg_sessions_groupe_after after insert or update of date_seance, heure, team_id, other_team_ids, fusionnee_dans on public.sessions
  for each row execute function public.sessions_groupe_after();

-- ------------------------------------------------------------
-- 3) La séance d'où il vient ne lui demande plus rien quand le renvoi a eu lieu
-- ------------------------------------------------------------
create or replace function public.player_session_ok(p_player bigint, p_session bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sessions s join public.players p on p.id = p_player and p.club_id = s.club_id
     where s.id = p_session and s.fusionnee_dans is null
       and (array_remove(array[s.team_id] || s.other_team_ids, null) && array_remove(array[p.team_id] || coalesce(p.other_team_ids, '{}'), null)
            or exists (select 1 from public.attendance a where a.session_id = s.id and a.player_id = p.id and a.invite)
            or (s.team_id is null and not exists (select 1 from public.teams t where t.club_id = s.club_id))))
    and not exists (select 1 from public.attendance a where a.session_id = p_session and a.player_id = p_player and a.statut = 'non_concerne')
    and not exists (select 1 from public.attendance a where a.session_id = p_session and a.player_id = p_player and a.statut = 'groupe'
                      and exists (select 1 from public.attendance x where x.groupe_de = p_session and x.player_id = p_player));
$$;
revoke all on function public.player_session_ok(bigint, bigint) from public, anon, authenticated;

-- Témoin
create or replace function public.attendance_groupes()
returns boolean language sql immutable set search_path = public as $$ select true $$;
revoke all on function public.attendance_groupes() from public, anon;
grant execute on function public.attendance_groupes() to authenticated;

commit;
