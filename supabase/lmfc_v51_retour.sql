/* Retour arrière de lmfc_v51.sql (séances communes à plusieurs équipes). Rejouable.
   Refusé tant qu'une séance a des équipes associées : les retirer d'abord (éditeur de
   séance), sinon les joueurs et le staff de ces équipes la perdraient sans le savoir.
   Les fonctions reprennent leur définition d'avant lmfc_v51.sql, à l'identique. */
begin;
do $$
declare v_n integer;
begin
  -- Deux temps : la colonne n'existe plus si le retour a déjà été passé.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = 'other_team_ids') then
    select count(*) into v_n from public.sessions where cardinality(other_team_ids) > 0;
    if v_n > 0 then
      raise exception 'Retour refusé : % séance(s) ont des équipes associées. Retirez-les d''abord.', v_n;
    end if;
  end if;
end $$;

drop trigger if exists trg_clean_session_teams on public.sessions;
drop function if exists public.clean_session_other_teams();
drop function if exists public.calendar_recipients(text, bigint, bigint, bigint, bigint[]);

CREATE OR REPLACE FUNCTION public.session_level(p_id bigint, p_club bigint, p_created_by uuid, p_acces text, p_team bigint)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when p_club is distinct from public.my_club_id() or me.role is null or me.role in ('joueur', 'lecteur') then 'aucun'
    when me.role = 'admin' then 'modification'
    when me.role = 'analyste' then case
      when p_team is not null and public.team_level(p_team) = 'modification' then 'modification'
      else 'aucun'
    end
    when p_created_by = auth.uid() then 'modification'
    when a.niveau = 'modification' and me.role not in ('admin', 'coach') then 'lecture'
    when a.niveau is not null then a.niveau
    when p_acces = 'club' then case when me.role in ('admin', 'coach') then 'modification' else 'lecture' end
    else public.team_level(p_team)
  end
  from (select 1) x
  left join public.session_access a on a.session_id = p_id and a.profile_id = auth.uid()
  left join public.profiles me on me.id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.session_level_for(p_profile uuid, p_id bigint, p_club bigint, p_created_by uuid, p_acces text, p_team bigint)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when me.id is null or p_club is distinct from me.club_id or me.role in ('joueur', 'lecteur') then 'aucun'
    when me.role = 'admin' then 'modification'
    when p_created_by = me.id then 'modification'
    when a.niveau = 'modification' and me.role not in ('admin', 'coach') then 'lecture'
    when a.niveau is not null then a.niveau
    when p_acces = 'club' then case when me.role in ('admin', 'coach') then 'modification' else 'lecture' end
    when p_team is not null and p_team = any(me.team_ids) then case when me.role in ('coach', 'analyste') then 'modification' else 'lecture' end
    when p_team is null and cardinality(me.team_ids) > 0 then 'lecture'
    when not exists (select 1 from public.teams t where t.club_id = me.club_id)
      then case when me.role in ('coach', 'analyste') then 'modification' else 'lecture' end
    when me.lecture_club then 'lecture'
    else 'aucun'
  end
  from (select 1) x
  left join public.profiles me on me.id = p_profile
  left join public.session_access a on a.session_id = p_id and a.profile_id = p_profile;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_session_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if public.has_role('analyste') then new.acces := 'equipe'; end if;
    return new;
  end if;
  if (new.acces is distinct from old.acces or new.created_by is distinct from old.created_by)
     and not (old.created_by = auth.uid() or public.is_club_admin()) then
    new.acces := old.acces;
    new.created_by := old.created_by;
  end if;
  if public.has_role('analyste') then new.acces := 'equipe'; end if;
  if new.team_id is distinct from old.team_id and new.team_id is not null
     and current_user = 'authenticated' and public.team_level(new.team_id) <> 'modification' then
    raise exception 'Cette séance ne peut être rangée que dans une de vos équipes.' using errcode = '42501';
  end if;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.player_session_ok(p_player bigint, p_session bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.sessions s join public.players p on p.id = p_player and p.club_id = s.club_id
     where s.id = p_session
       and (s.team_id = p.team_id or s.team_id = any(coalesce(p.other_team_ids, '{}'))
            or exists (select 1 from public.attendance a where a.session_id = s.id and a.player_id = p.id and a.invite)
            or (s.team_id is null and not exists (select 1 from public.teams t where t.club_id = s.club_id))))
    and not exists (select 1 from public.attendance a where a.session_id = p_session and a.player_id = p_player and a.statut = 'non_concerne');
$function$
;

CREATE OR REPLACE FUNCTION public.my_calendar(p_from date, p_to date)
 RETURNS TABLE(kind text, id bigint, date_cal date, heure time without time zone, titre text, team_id bigint, lieu text, stade text, score_pour integer, score_contre integer, notes text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (
    select p.id, p.club_id, array_remove(array[p.team_id] || coalesce(p.other_team_ids, '{}'), null) as teams,
           not exists (select 1 from public.teams t where t.club_id = p.club_id) as no_teams
      from public.players p
     where p.auth_user_id = auth.uid() and public.has_role('joueur') and p_to - p_from between 0 and 100
     limit 1)
  select 'seance', s.id, s.date_seance, s.heure, s.titre, s.team_id, s.lieu, null, null::int, null::int, null
    from public.sessions s, me
   where s.club_id = me.club_id and s.date_seance between p_from and p_to
     and (s.team_id = any(me.teams) or (me.no_teams and s.team_id is null)
          or exists (select 1 from public.attendance a where a.session_id = s.id and a.player_id = me.id and a.invite))
     and not exists (select 1 from public.attendance a where a.session_id = s.id and a.player_id = me.id and a.statut = 'non_concerne')
  union all
  select 'match', m.id, m.date_match, m.heure, m.adversaire, m.team_id, m.lieu, m.stade, m.score_pour, m.score_contre, null
    from public.matches m, me
   where m.club_id = me.club_id and m.date_match between p_from and p_to
     and (m.team_id = any(me.teams) or (me.no_teams and m.team_id is null)
          or exists (select 1 from public.match_players mp where mp.match_id = m.id and mp.player_id = me.id))
  union all
  select 'evenement', e.id, e.date_event, e.heure, e.titre, e.team_id, e.lieu, null, null, null, e.notes
    from public.club_events e, me
   where e.club_id = me.club_id and e.date_event between p_from and p_to and public.my_event_ok(e.id, e.team_id)
  order by 3, 4 nulls first, 1;
$function$
;

CREATE OR REPLACE FUNCTION public.calendar_recipients(p_kind text, p_item bigint, p_team bigint, p_club bigint)
 RETURNS SETOF bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id from public.players p
   where p.club_id = p_club and p.auth_user_id is not null
     and case when p_kind = 'evenement' then
           coalesce((select x.inclus from public.club_event_players x where x.event_id = p_item and x.player_id = p.id),
                    p_team is null or p.team_id = p_team or p_team = any(coalesce(p.other_team_ids, '{}')))
         else
           not exists (select 1 from public.attendance a where a.session_id = p_item and a.player_id = p.id and a.statut = 'non_concerne')
           and (p.team_id = p_team or p_team = any(coalesce(p.other_team_ids, '{}'))
                or exists (select 1 from public.attendance a where a.session_id = p_item and a.player_id = p.id and a.invite)
                or (p_team is null and not exists (select 1 from public.teams t where t.club_id = p_club)))
         end;
$function$
;

CREATE OR REPLACE FUNCTION public.calendar_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_kind   text := case tg_table_name when 'sessions' then 'seance' else 'evenement' end;
  v_j      jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_date   date := coalesce(v_j->>'date_seance', v_j->>'date_event')::date;
  v_old    date;
  v_action text := case tg_op when 'INSERT' then 'ajout' when 'UPDATE' then 'modif' else 'annul' end;
begin
  if tg_op = 'UPDATE' then
    v_old := coalesce(to_jsonb(old)->>'date_seance', to_jsonb(old)->>'date_event')::date;
  end if;
  if auth.uid() is null or greatest(v_date, v_old) < current_date then
    return case when tg_op = 'DELETE' then old else null end;
  end if;
  -- Créé puis supprimé dans la même transaction : rien à annoncer.
  if tg_op <> 'DELETE' and not (case v_kind when 'seance' then exists (select 1 from public.sessions s where s.id = (v_j->>'id')::bigint)
                                               else exists (select 1 from public.club_events e where e.id = (v_j->>'id')::bigint) end) then
    return null;
  end if;
  insert into public.calendar_notifs (club_id, created_by, player_id, action, kind, item_id, serie_id, titre, date_cal, heure)
  select (v_j->>'club_id')::bigint, auth.uid(), pid, v_action, v_kind, (v_j->>'id')::bigint, nullif(v_j->>'serie_id', '')::uuid,
         coalesce(v_j->>'titre', ''), v_date, nullif(v_j->>'heure', '')::time
    from public.calendar_recipients(v_kind, (v_j->>'id')::bigint, nullif(v_j->>'team_id', '')::bigint, (v_j->>'club_id')::bigint) pid;
  return case when tg_op = 'DELETE' then old else null end;
end; $function$
;

CREATE OR REPLACE FUNCTION public.trash_session_visible(p_root bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select r.deleted_by = auth.uid() or public.is_club_admin()
                          or (coalesce(r.data->>'acces', 'club') = 'club'
                              and public.team_level(nullif(r.data->>'team_id', '')::bigint) <> 'aucun')
                     from public.trash r where r.id = p_root and r.tbl = 'sessions'), true);
$function$
;

CREATE OR REPLACE FUNCTION public.teams_forget_in_profiles()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.profiles set team_ids = array_remove(team_ids, old.id) where old.id = any(team_ids);
  return old;
end; $function$
;

revoke all on function public.calendar_recipients(text, bigint, bigint, bigint) from public, anon, authenticated;
drop function if exists public.session_team_level(bigint, bigint);
alter table public.sessions drop column if exists other_team_ids;
commit;
