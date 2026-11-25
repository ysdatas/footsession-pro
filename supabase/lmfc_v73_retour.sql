/* ============================================================
   LMFC Performance — lmfc_v73_retour.sql : retour arrière de lmfc_v73.sql
   Plus de statut « Groupe <équipe> » : chaque ligne « groupe » devient
   « Autre » avec le motif « Groupe Espoirs » (rien n'est perdu à l'écran) ;
   les présences renvoyées restent des présences ordinaires ;
   player_session_ok reprend sa version de lmfc_v52.sql. Rejouable et transactionnel.
   ============================================================ */
begin;

drop trigger if exists trg_sessions_groupe_after on public.sessions;
drop trigger if exists trg_attendance_groupe_after on public.attendance;
drop trigger if exists trg_attendance_groupe_check on public.attendance;
drop function if exists public.sessions_groupe_after();
drop function if exists public.attendance_groupe_after();
drop function if exists public.attendance_groupe_apply(bigint, bigint);
drop function if exists public.attendance_groupe_targets(bigint, bigint);
drop function if exists public.attendance_groupe_check();
drop function if exists public.attendance_groupes();

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'attendance' and column_name = 'groupe_team_id') then
    update public.attendance a
       set statut = 'autre', present = false,
           statut_libre = left('Groupe ' || coalesce((select t.nom from public.teams t where t.id = a.groupe_team_id), 'autre équipe'), 40)
     where a.statut = 'groupe';
  end if;
end $$;

alter table public.attendance drop column if exists groupe_de;
alter table public.attendance drop column if exists groupe_team_id;
alter table public.attendance drop constraint if exists attendance_statut_check;
alter table public.attendance add constraint attendance_statut_check check (statut is null
  or statut in ('present', 'reprise', 'retard', 'absent', 'excuse', 'blesse', 'malade', 'selection', 'groupe_pro', 'autre', 'non_concerne'));

-- player_session_ok, telle que lmfc_v52.sql
create or replace function public.player_session_ok(p_player bigint, p_session bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sessions s join public.players p on p.id = p_player and p.club_id = s.club_id
     where s.id = p_session and s.fusionnee_dans is null
       and (array_remove(array[s.team_id] || s.other_team_ids, null) && array_remove(array[p.team_id] || coalesce(p.other_team_ids, '{}'), null)
            or exists (select 1 from public.attendance a where a.session_id = s.id and a.player_id = p.id and a.invite)
            or (s.team_id is null and not exists (select 1 from public.teams t where t.club_id = s.club_id))))
    and not exists (select 1 from public.attendance a where a.session_id = p_session and a.player_id = p_player and a.statut = 'non_concerne');
$$;
revoke all on function public.player_session_ok(bigint, bigint) from public, anon, authenticated;

commit;
