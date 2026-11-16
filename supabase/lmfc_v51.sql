/* ============================================================
   LMFC Performance — lmfc_v51.sql (n° 69) : séances communes à plusieurs équipes
   À exécuter après lmfc_v50.sql. Rejouable et transactionnelle.
   Retour arrière : lmfc_v51_retour.sql (refusé tant qu'une séance a des équipes associées).

   - sessions.other_team_ids : équipes associées à la séance, en plus de son
     équipe principale (team_id), sur le modèle de players.other_team_ids
     (lmfc_v7.sql). Exemple : séance U15, associée aux U14.
     La base range la liste : sans doublon, triée, sans l'équipe principale,
     seulement des équipes du club. Une séance sans équipe principale prend
     la première équipe associée (c'est aussi ce qui arrive quand on supprime
     son équipe principale).
   - Droits du staff : le staff de chaque équipe de la séance a, sur elle,
     les droits qu'il a sur son équipe (session_level, session_level_for).
     Un réglage nominatif, le créateur et « Tout le staff du club » restent
     valables comme avant.
   - Ranger la séance (guard_session_access) : on n'y ajoute que ses propres
     équipes (l'admin, toutes). On ne retire une équipe qu'avec le droit de
     modifier cette équipe : le créateur et l'admin font exception. Avant, la
     personne qui avait le droit de modifier une séance pouvait la sortir de
     son équipe sans en faire partie : ce n'est plus possible.
   - Joueurs : un joueur de n'importe laquelle des équipes de la séance est
     concerné, sans doublon (player_session_ok : RPE, courbatures, relances ;
     my_calendar : son calendrier ; calendar_recipients : ses notifications).
   - Les formulaires (RPE, courbatures) restent ceux de l'équipe principale
     (custom_form_for, lmfc_v47.sql) : un seul formulaire par séance.
   - Corbeille : une séance supprimée reste visible du staff de ses équipes
     associées. Une équipe supprimée sort des listes des séances ; la
     restaurer ne l'y remet pas.
   ============================================================ */
begin;

-- ------------------------------------------------------------
-- 1) La colonne et son rangement
-- ------------------------------------------------------------
alter table public.sessions add column if not exists other_team_ids bigint[] not null default '{}';

create or replace function public.clean_session_other_teams()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.other_team_ids := coalesce((
    select array_agg(distinct x order by x) from unnest(new.other_team_ids) x
     where x is distinct from new.team_id
       and exists (select 1 from public.teams t where t.id = x and t.club_id = new.club_id)), '{}');
  -- Une équipe associée suppose une équipe principale : la première le devient.
  if new.team_id is null and cardinality(new.other_team_ids) > 0 then
    new.team_id := new.other_team_ids[1];
    new.other_team_ids := new.other_team_ids[2:];
  end if;
  return new;
end; $$;
revoke all on function public.clean_session_other_teams() from public, anon, authenticated;
-- « trg_clean » passe avant « trg_guard » (ordre alphabétique) : la garde voit la liste rangée.
drop trigger if exists trg_clean_session_teams on public.sessions;
create trigger trg_clean_session_teams before insert or update of team_id, other_team_ids on public.sessions
  for each row execute function public.clean_session_other_teams();

-- ------------------------------------------------------------
-- 2) Droits du staff
-- ------------------------------------------------------------
-- Meilleur niveau de l'appelant sur les équipes de la séance. Sans équipe
-- principale : team_level(null), comme avant.
create or replace function public.session_team_level(p_id bigint, p_team bigint)
returns text language sql stable security definer set search_path = public as $$
  select case max(case public.team_level(t) when 'modification' then 2 when 'lecture' then 1 else 0 end)
           when 2 then 'modification' when 1 then 'lecture' else 'aucun' end
    from unnest(array[p_team] || coalesce((select s.other_team_ids from public.sessions s
                                            where s.id = p_id and p_team is not null), '{}')) t;
$$;
revoke all on function public.session_team_level(bigint, bigint) from public, anon, authenticated;

create or replace function public.session_level(p_id bigint, p_club bigint, p_created_by uuid, p_acces text, p_team bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_club is distinct from public.my_club_id() or me.role is null or me.role in ('joueur', 'lecteur') then 'aucun'
    when me.role = 'admin' then 'modification'
    when me.role = 'analyste' then case
      when p_team is not null and public.session_team_level(p_id, p_team) = 'modification' then 'modification'
      else 'aucun'
    end
    when p_created_by = auth.uid() then 'modification'
    when a.niveau = 'modification' and me.role not in ('admin', 'coach') then 'lecture'
    when a.niveau is not null then a.niveau
    when p_acces = 'club' then case when me.role in ('admin', 'coach') then 'modification' else 'lecture' end
    else public.session_team_level(p_id, p_team)
  end
  from (select 1) x
  left join public.session_access a on a.session_id = p_id and a.profile_id = auth.uid()
  left join public.profiles me on me.id = auth.uid();
$$;

-- Même règle, pour un autre compte (bibliothèque : qui peut voir une vidéo de séance).
create or replace function public.session_level_for(p_profile uuid, p_id bigint, p_club bigint, p_created_by uuid, p_acces text, p_team bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when me.id is null or p_club is distinct from me.club_id or me.role in ('joueur', 'lecteur') then 'aucun'
    when me.role = 'admin' then 'modification'
    when p_created_by = me.id then 'modification'
    when a.niveau = 'modification' and me.role not in ('admin', 'coach') then 'lecture'
    when a.niveau is not null then a.niveau
    when p_acces = 'club' then case when me.role in ('admin', 'coach') then 'modification' else 'lecture' end
    when p_team is not null and (array[p_team] || coalesce((select s.other_team_ids from public.sessions s where s.id = p_id), '{}')) && me.team_ids
      then case when me.role in ('coach', 'analyste') then 'modification' else 'lecture' end
    when p_team is null and cardinality(me.team_ids) > 0 then 'lecture'
    when not exists (select 1 from public.teams t where t.club_id = me.club_id)
      then case when me.role in ('coach', 'analyste') then 'modification' else 'lecture' end
    when me.lecture_club then 'lecture'
    else 'aucun'
  end
  from (select 1) x
  left join public.profiles me on me.id = p_profile
  left join public.session_access a on a.session_id = p_id and a.profile_id = p_profile;
$$;

-- ------------------------------------------------------------
-- 3) Ranger une séance : ajouter ou retirer une équipe
-- ------------------------------------------------------------
create or replace function public.guard_session_access()
returns trigger language plpgsql security invoker set search_path = public as $$
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
end; $$;

-- ------------------------------------------------------------
-- 4) Joueurs concernés
-- ------------------------------------------------------------
create or replace function public.player_session_ok(p_player bigint, p_session bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sessions s join public.players p on p.id = p_player and p.club_id = s.club_id
     where s.id = p_session
       and (array_remove(array[s.team_id] || s.other_team_ids, null) && array_remove(array[p.team_id] || coalesce(p.other_team_ids, '{}'), null)
            or exists (select 1 from public.attendance a where a.session_id = s.id and a.player_id = p.id and a.invite)
            or (s.team_id is null and not exists (select 1 from public.teams t where t.club_id = s.club_id))))
    and not exists (select 1 from public.attendance a where a.session_id = p_session and a.player_id = p_player and a.statut = 'non_concerne');
$$;
revoke all on function public.player_session_ok(bigint, bigint) from public, anon, authenticated;

create or replace function public.my_calendar(p_from date, p_to date)
returns table (kind text, id bigint, date_cal date, heure time, titre text, team_id bigint, lieu text, stade text,
               score_pour integer, score_contre integer, notes text)
language sql stable security definer set search_path = public as $$
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
$$;
revoke all on function public.my_calendar(date, date) from public, anon;
grant execute on function public.my_calendar(date, date) to authenticated;

-- Destinataires des annonces du calendrier : les joueurs des équipes associées aussi.
-- Nouvelle signature (p_others) : l'ancienne est retirée, sinon l'appel serait ambigu.
drop function if exists public.calendar_recipients(text, bigint, bigint, bigint);
create or replace function public.calendar_recipients(p_kind text, p_item bigint, p_team bigint, p_club bigint, p_others bigint[] default '{}')
returns setof bigint language sql stable security definer set search_path = public as $$
  select p.id from public.players p
   where p.club_id = p_club and p.auth_user_id is not null
     and case when p_kind = 'evenement' then
           coalesce((select x.inclus from public.club_event_players x where x.event_id = p_item and x.player_id = p.id),
                    p_team is null or p.team_id = p_team or p_team = any(coalesce(p.other_team_ids, '{}')))
         else
           not exists (select 1 from public.attendance a where a.session_id = p_item and a.player_id = p.id and a.statut = 'non_concerne')
           and (array_remove(array[p_team] || coalesce(p_others, '{}'), null) && array_remove(array[p.team_id] || coalesce(p.other_team_ids, '{}'), null)
                or exists (select 1 from public.attendance a where a.session_id = p_item and a.player_id = p.id and a.invite)
                or (p_team is null and not exists (select 1 from public.teams t where t.club_id = p_club)))
         end;
$$;
revoke all on function public.calendar_recipients(text, bigint, bigint, bigint, bigint[]) from public, anon, authenticated;

create or replace function public.calendar_notify()
returns trigger language plpgsql security definer set search_path = public as $$
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
    from public.calendar_recipients(v_kind, (v_j->>'id')::bigint, nullif(v_j->>'team_id', '')::bigint, (v_j->>'club_id')::bigint,
           coalesce((select array_agg(x::bigint) from jsonb_array_elements_text(coalesce(v_j->'other_team_ids', '[]')) x), '{}')) pid;
  return case when tg_op = 'DELETE' then old else null end;
end; $$;

-- ------------------------------------------------------------
-- 5) Corbeille et suppression d'une équipe
-- ------------------------------------------------------------
create or replace function public.trash_session_visible(p_root bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select r.deleted_by = auth.uid() or public.is_club_admin()
                          or (coalesce(r.data->>'acces', 'club') = 'club'
                              and (select bool_or(public.team_level(t) <> 'aucun')
                                     from unnest(array[nullif(r.data->>'team_id', '')::bigint]
                                       || coalesce((select array_agg(x::bigint) from jsonb_array_elements_text(coalesce(r.data->'other_team_ids', '[]')) x), '{}')) t))
                     from public.trash r where r.id = p_root and r.tbl = 'sessions'), true);
$$;

create or replace function public.teams_forget_in_profiles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set team_ids = array_remove(team_ids, old.id) where old.id = any(team_ids);
  update public.sessions set other_team_ids = array_remove(other_team_ids, old.id) where old.id = any(other_team_ids);
  return old;
end; $$;

commit;
