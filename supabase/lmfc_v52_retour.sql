/* Retour arrière de lmfc_v52.sql (fusion de séances). Rejouable.
   Refusé tant qu'une fusion est en place : l'annuler d'abord (bouton « Annuler la
   fusion » de la séance fusionnée), sinon ses lignes resteraient dans la séance
   cible sans moyen de les rendre. Le journal des fusions annulées est effacé.
   Les fonctions reprennent leur définition de lmfc_v51.sql, à l'identique. */
begin;
do $$
declare v_n integer;
begin
  -- Deux temps : la colonne n'existe plus si le retour a déjà été passé.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = 'fusionnee_dans') then
    select count(*) into v_n from public.sessions where fusionnee_dans is not null;
    if v_n > 0 then
      raise exception 'Retour refusé : % séance(s) sont fusionnées. Annulez d''abord ces fusions.', v_n;
    end if;
  end if;
end $$;

drop function if exists public.session_merge(bigint, bigint, boolean);
drop function if exists public.session_merge_undo(bigint);
drop table if exists public.session_merges;

CREATE OR REPLACE FUNCTION public.guard_session_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_old  bigint[] := '{}';
  v_new  bigint[] := array_remove(array[new.team_id] || coalesce(new.other_team_ids, '{}'), null);
  v_team bigint;
begin
  if auth.uid() is null then return new; end if;   -- SQL Editor, tâches serveur
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    if (new.acces is distinct from old.acces or new.created_by is distinct from old.created_by)
       and not (old.created_by = auth.uid() or public.is_club_admin()) then
      new.acces := old.acces;
      new.created_by := old.created_by;
    end if;
    v_old := array_remove(array[old.team_id] || coalesce(old.other_team_ids, '{}'), null);
  end if;
  if public.has_role('analyste') then new.acces := 'equipe'; end if;
  -- Corbeille, suppression d'une équipe : les fonctions de la base passent.
  if current_user <> 'authenticated' then return new; end if;
  foreach v_team in array v_new loop
    if not v_team = any(v_old) and public.team_level(v_team) <> 'modification' then
      raise exception 'Cette séance ne peut être rangée que dans une de vos équipes.' using errcode = '42501';
    end if;
  end loop;
  if tg_op = 'UPDATE' and not (old.created_by = auth.uid() or public.is_club_admin()) then
    foreach v_team in array v_old loop
      if not v_team = any(v_new) and public.team_level(v_team) <> 'modification' then
        raise exception 'Seul le staff de l''équipe « % » peut la retirer de cette séance.',
          (select t.nom from public.teams t where t.id = v_team) using errcode = '42501';
      end if;
    end loop;
  end if;
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.player_session_ok(p_player bigint, p_session bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.sessions s join public.players p on p.id = p_player and p.club_id = s.club_id
     where s.id = p_session
       and (array_remove(array[s.team_id] || s.other_team_ids, null) && array_remove(array[p.team_id] || coalesce(p.other_team_ids, '{}'), null)
            or exists (select 1 from public.attendance a where a.session_id = s.id and a.player_id = p.id and a.invite)
            or (s.team_id is null and not exists (select 1 from public.teams t where t.club_id = s.club_id))))
    and not exists (select 1 from public.attendance a where a.session_id = p_session and a.player_id = p_player and a.statut = 'non_concerne');
$function$;

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
     and (array_remove(array[s.team_id] || s.other_team_ids, null) && me.teams or (me.no_teams and s.team_id is null)
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
$function$;

CREATE OR REPLACE FUNCTION public.my_editable_sessions(p_limit integer DEFAULT 40)
 RETURNS TABLE(id bigint, titre text, date_seance date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select s.id, s.titre, s.date_seance from public.sessions s
  where s.club_id = public.my_club_id()
    and public.session_level(s.id, s.club_id, s.created_by, s.acces, s.team_id) = 'modification'
  order by s.date_seance desc, s.id desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$function$;

alter table public.sessions drop constraint if exists sessions_fusion_check;
alter table public.sessions drop column if exists fusionnee_dans;
alter table public.sessions drop column if exists fusionnee_le;
commit;
