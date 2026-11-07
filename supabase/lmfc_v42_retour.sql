/* Annule les droits d'équipe de lmfc_v42.sql sans retirer le rôle créé en v41.
   Les comptes Analyste conservent joueurs, performance et vidéos joueurs. */
begin;

drop policy if exists analyst_sessions_scope on public.sessions;
drop policy if exists analyst_attendance_scope on public.attendance;
drop policy if exists analyst_session_bilans_scope on public.session_bilans;
drop policy if exists analyst_match_players_scope on public.match_players;
drop policy if exists analyst_schemas_read on storage.objects;
drop policy if exists analyst_event_players_scope on public.club_event_players;

create or replace function public.session_level(p_id bigint, p_club bigint, p_created_by uuid, p_acces text, p_team bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_club is distinct from public.my_club_id() or me.role is null or me.role in ('joueur', 'lecteur') then 'aucun'
    when me.role = 'admin' then 'modification'
    when me.role = 'analyste' then case
      when p_team is not null and public.team_level(p_team) = 'modification' then 'lecture'
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
$$;

drop policy if exists "sessions_insert" on public.sessions;
create policy "sessions_insert" on public.sessions for insert
  with check (club_id = public.my_club_id() and public.can_edit()
    and (team_id is null or public.team_level(team_id) = 'modification'));

create or replace function public.guard_session_access()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- SQL Editor, tâches serveur
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    return new;
  end if;
  if (new.acces is distinct from old.acces or new.created_by is distinct from old.created_by)
     and not (old.created_by = auth.uid() or public.is_club_admin()) then
    new.acces := old.acces;
    new.created_by := old.created_by;
  end if;
  if new.team_id is distinct from old.team_id and new.team_id is not null
     and current_user = 'authenticated' and public.team_level(new.team_id) <> 'modification' then
    raise exception 'Cette séance ne peut être rangée que dans une de vos équipes.' using errcode = '42501';
  end if;
  return new;
end; $$;

drop policy if exists matches_write on public.matches;
create policy matches_write on public.matches for all
  using (public.can_edit() and club_id = public.my_club_id()
    and (public.team_level(team_id) = 'modification' or created_by = auth.uid()))
  with check (public.can_edit() and club_id = public.my_club_id()
    and (team_id is null or exists (select 1 from public.teams t where t.id = team_id and t.club_id = public.my_club_id()))
    and (public.team_level(team_id) = 'modification' or (team_id is null and created_by = auth.uid())));
drop policy if exists match_players_write on public.match_players;
create policy match_players_write on public.match_players for all
  using (public.can_edit() and club_id = public.my_club_id() and exists (select 1 from public.matches m where m.id = match_id
    and (public.team_level(m.team_id) = 'modification' or m.created_by = auth.uid())))
  with check (public.can_edit() and club_id = public.my_club_id()
    and exists (select 1 from public.matches m where m.id = match_id and m.club_id = public.my_club_id()
      and (public.team_level(m.team_id) = 'modification' or m.created_by = auth.uid()))
    and exists (select 1 from public.players p where p.id = player_id and p.club_id = public.my_club_id()));

drop policy if exists club_events_read on public.club_events;
create policy club_events_read on public.club_events for select using (
  club_id = (select public.my_club_id()) and not (select public.is_lecteur()) and (
    ((select public.has_role('admin', 'coach', 'prepa')) and (team_id is null or public.team_level(team_id) <> 'aucun'))
    or ((select public.has_role('joueur')) and public.my_event_ok(id, team_id))));
drop policy if exists club_events_write on public.club_events;
create policy club_events_write on public.club_events for all
  using (club_id = (select public.my_club_id()) and (select public.can_edit()) and public.team_level(team_id) = 'modification')
  with check (club_id = (select public.my_club_id()) and (select public.can_edit()) and public.team_level(team_id) = 'modification'
    and (team_id is null or exists (select 1 from public.teams t where t.id = team_id and t.club_id = (select public.my_club_id()))));

drop policy if exists club_event_players_read on public.club_event_players;
create policy club_event_players_read on public.club_event_players for select using (
  club_id = (select public.my_club_id()) and (select public.has_role('admin', 'coach', 'prepa'))
  and exists (select 1 from public.club_events e where e.id = event_id));
drop policy if exists club_event_players_write on public.club_event_players;
create policy club_event_players_write on public.club_event_players for all
  using (club_id = (select public.my_club_id()) and (select public.can_edit())
    and exists (select 1 from public.club_events e where e.id = event_id and public.team_level(e.team_id) = 'modification'))
  with check (club_id = (select public.my_club_id()) and (select public.can_edit())
    and exists (select 1 from public.club_events e where e.id = event_id and e.club_id = club_event_players.club_id
      and public.team_level(e.team_id) = 'modification')
    and exists (select 1 from public.players p where p.id = player_id and p.club_id = club_event_players.club_id));

-- Les RPC remplacées par v42 reprennent ici leur version de v37/v30.
create or replace function public.calendar_add(p_kind text, p_rows jsonb, p_players jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_club    bigint := public.my_club_id();
  v_add     bigint[] := coalesce((select array_agg(x::bigint) from jsonb_array_elements_text(coalesce(p_players->'add', '[]')) x), '{}');
  v_remove  bigint[] := coalesce((select array_agg(x::bigint) from jsonb_array_elements_text(coalesce(p_players->'remove', '[]')) x), '{}');
  v_row     jsonb;
  v_team    bigint;
  v_date    date;
  v_id      bigint;
  v_created jsonb := '[]';
  v_skipped jsonb := '[]';
begin
  if p_kind not in ('seance', 'evenement') then raise exception 'Type inconnu : %', p_kind using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 120 then
    raise exception 'Une série compte de 1 à 120 dates.' using errcode = '22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_team := nullif(v_row->>'team_id', '')::bigint;
    v_date := (v_row->>'date')::date;
    v_id := null;
    if not public.can_edit() or public.team_level(v_team) <> 'modification' then
      raise exception 'Vous ne pouvez rien créer pour cette équipe.' using errcode = '42501';
    end if;
    if p_kind = 'seance' then
      if v_team is null and exists (select 1 from public.teams t where t.club_id = v_club) then
        raise exception 'Une séance appartient à une équipe.' using errcode = '22023';
      end if;
      -- Autant de séances qu'on veut dans la journée ; même série, même date : un double envoi.
      if not exists (select 1 from public.sessions s where s.serie_id = nullif(v_row->>'serie_id', '')::uuid and s.date_seance = v_date) then
        insert into public.sessions (club_id, team_id, titre, date_seance, heure, lieu, duree_min, serie_id)
        values (v_club, v_team, v_row->>'titre', v_date, nullif(v_row->>'heure', '')::time, nullif(v_row->>'lieu', ''),
                coalesce(nullif(v_row->>'duree_min', '')::numeric, 90), nullif(v_row->>'serie_id', '')::uuid)
        returning id into v_id;
      end if;
      if v_id is not null then
        insert into public.attendance (player_id, session_id, invite, statut)
          select pid, v_id, true, null from unnest(v_add) pid
          union all select pid, v_id, false, 'non_concerne' from unnest(v_remove) pid
        on conflict (player_id, session_id) do nothing;
      end if;
    else
      insert into public.club_events (club_id, team_id, titre, date_event, heure, lieu, notes, serie_id)
      values (v_club, v_team, v_row->>'titre', v_date, nullif(v_row->>'heure', '')::time, nullif(v_row->>'lieu', ''),
              nullif(v_row->>'notes', ''), nullif(v_row->>'serie_id', '')::uuid)
      on conflict (serie_id, date_event) where serie_id is not null do nothing
      returning id into v_id;
      if v_id is not null then
        insert into public.club_event_players (club_id, event_id, player_id, inclus)
          select v_club, v_id, pid, true from unnest(v_add) pid
          union all select v_club, v_id, pid, false from unnest(v_remove) pid
        on conflict (event_id, player_id) do nothing;
      end if;
    end if;
    if v_id is null then v_skipped := v_skipped || to_jsonb(v_date);   -- déjà créée (double envoi)
    else v_created := v_created || jsonb_build_object('id', v_id, 'date', v_date); end if;
  end loop;
  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end; $$;
create or replace function public.club_event_set_players(p_events bigint[], p_players jsonb)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  v_add    bigint[] := coalesce((select array_agg(x::bigint) from jsonb_array_elements_text(coalesce(p_players->'add', '[]')) x), '{}');
  v_remove bigint[] := coalesce((select array_agg(x::bigint) from jsonb_array_elements_text(coalesce(p_players->'remove', '[]')) x), '{}');
  v_n      integer;
begin
  delete from public.club_event_players where event_id = any(p_events);
  insert into public.club_event_players (club_id, event_id, player_id, inclus)
    select e.club_id, e.id, x.pid, x.inclus
      from public.club_events e
     cross join (select unnest(v_add) as pid, true as inclus union all select unnest(v_remove), false) x
     where e.id = any(p_events)
  on conflict (event_id, player_id) do update set inclus = excluded.inclus;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

create or replace function public.can_manage_plans()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach', 'prepa');
$$;
revoke all on function public.can_manage_plans() from public, anon;
grant execute on function public.can_manage_plans() to authenticated;

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

create or replace function public.guard_template_owner()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  elsif new.created_by is distinct from old.created_by and not public.is_club_admin() then
    new.created_by := old.created_by;
  end if;
  return new;
end $$;

drop policy if exists templates_read on public.exercise_templates;
create policy templates_read on public.exercise_templates for select using (
  club_id = (select public.my_club_id()) and (select public.has_role('admin', 'coach', 'prepa'))
  and (created_by = auth.uid() or partage or (select public.is_club_admin())));
drop policy if exists templates_insert on public.exercise_templates;
create policy templates_insert on public.exercise_templates for insert with check (
  club_id = (select public.my_club_id()) and (select public.can_edit()));
drop policy if exists templates_update on public.exercise_templates;
create policy templates_update on public.exercise_templates for update
  using (club_id = (select public.my_club_id()) and (select public.can_edit())
    and (created_by = auth.uid() or (select public.is_club_admin())))
  with check (club_id = (select public.my_club_id()) and (select public.can_edit()));
drop policy if exists templates_delete on public.exercise_templates;
create policy templates_delete on public.exercise_templates for delete
  using (club_id = (select public.my_club_id()) and (select public.can_edit())
    and (created_by = auth.uid() or (select public.is_club_admin())));

drop policy if exists exercise_template_tags_read on public.exercise_template_tags;
create policy exercise_template_tags_read on public.exercise_template_tags for select using (
  (select public.has_role('admin', 'coach', 'prepa'))
  and exists (select 1 from public.exercise_templates t where t.id = template_id and t.club_id = (select public.my_club_id())));
drop policy if exists exercise_template_tags_insert on public.exercise_template_tags;
create policy exercise_template_tags_insert on public.exercise_template_tags for insert with check (
  (select public.can_edit())
  and exists (select 1 from public.exercise_templates t where t.id = template_id and t.club_id = (select public.my_club_id()))
  and exists (select 1 from public.library_tags g where g.id = tag_id and g.club_id = (select public.my_club_id())));
drop policy if exists exercise_template_tags_delete on public.exercise_template_tags;
create policy exercise_template_tags_delete on public.exercise_template_tags for delete using (
  (select public.can_edit())
  and exists (select 1 from public.exercise_templates t where t.id = template_id and t.club_id = (select public.my_club_id())));

drop policy if exists session_rpe_read on public.session_rpe;
create policy session_rpe_read on public.session_rpe for select using (
  club_id = (select public.my_club_id()) and (
    exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
    or ((select public.has_role('admin', 'coach', 'prepa'))
        and public.player_level(player_id) <> 'aucun' and public.session_access_level(session_id) <> 'aucun')));
drop policy if exists match_rpe_read on public.match_rpe;
create policy match_rpe_read on public.match_rpe for select using (
  club_id = (select public.my_club_id()) and (
    exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
    or ((select public.has_role('admin', 'coach', 'prepa'))
        and public.player_level(player_id) <> 'aucun'
        and exists (select 1 from public.matches m where m.id = match_id))));

drop policy if exists performance_notes_update on public.player_performance_notes;
create policy performance_notes_update on public.player_performance_notes for update
  using (public.can_manage_plans() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification')
  with check (public.can_manage_plans() and club_id = public.my_club_id());
drop policy if exists performance_media_update on public.player_performance_media;
create policy performance_media_update on public.player_performance_media for update
  using (public.can_manage_plans() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification')
  with check (public.can_manage_plans() and club_id = public.my_club_id());

create or replace function public.rpe_set(p_session bigint, p_rpe integer, p_player bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_date date; v_club bigint; v_me bigint; v_row public.session_rpe;
begin
  if p_rpe is not null and p_rpe not between 1 and 10 then
    raise exception 'Le RPE va de 1 à 10.' using errcode = '22023';
  end if;
  select s.date_seance, s.club_id into v_date, v_club from public.sessions s where s.id = p_session;
  if v_club is null or v_club is distinct from public.my_club_id() then
    raise exception 'Séance introuvable.' using errcode = '42501';
  end if;

  if p_player is null then
    select p.id into v_me from public.players p
     where p.auth_user_id = auth.uid() and p.club_id = v_club and public.has_role('joueur') limit 1;
    if v_me is null or not public.player_session_ok(v_me, p_session) then
      raise exception 'Cette séance ne te concerne pas.' using errcode = '42501';
    end if;
    if p_rpe is null then raise exception 'Choisis une valeur de 1 à 10.' using errcode = '22023'; end if;
    if not public.rpe_open(v_date) then
      raise exception 'La saisie est fermée (jusqu’à 14 jours après la séance) : demande au staff de la faire.' using errcode = '42501';
    end if;
    if exists (select 1 from public.session_rpe r where r.session_id = p_session and r.player_id = v_me) then
      raise exception 'Ton RPE de cette séance est déjà enregistré : demande au staff pour le changer.' using errcode = '42501';
    end if;
    insert into public.session_rpe (club_id, session_id, player_id, rpe, saisi_par)
    values (v_club, p_session, v_me, p_rpe, auth.uid())
    returning * into v_row;
  else
    if not public.has_role('admin', 'coach', 'prepa') or public.is_lecteur()
       or public.player_level(p_player) <> 'modification' or public.session_access_level(p_session) = 'aucun'
       or not public.player_session_ok(p_player, p_session) then
      raise exception 'Correction réservée au staff qui suit ce joueur sur cette séance.' using errcode = '42501';
    end if;
    if p_rpe is null then
      delete from public.session_rpe r where r.session_id = p_session and r.player_id = p_player;
      return null;
    end if;
    insert into public.session_rpe (club_id, session_id, player_id, rpe, saisi_par, corrige_par)
    values (v_club, p_session, p_player, p_rpe, auth.uid(), auth.uid())
    on conflict (session_id, player_id) do update set rpe = excluded.rpe, corrige_par = auth.uid(), updated_at = now()
    returning * into v_row;
  end if;
  return jsonb_build_object('rpe', v_row.rpe, 'corrige', v_row.corrige_par is not null);
end; $$;

create or replace function public.match_rpe_set(p_match bigint, p_rpe integer, p_player bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m public.matches; v_me bigint; v_row public.match_rpe;
begin
  if p_rpe is not null and p_rpe not between 1 and 10 then
    raise exception 'Le RPE va de 1 à 10.' using errcode = '22023';
  end if;
  select * into v_m from public.matches m where m.id = p_match;
  if v_m.club_id is null or v_m.club_id is distinct from public.my_club_id() then
    raise exception 'Match introuvable.' using errcode = '42501';
  end if;

  if p_player is null then
    select p.id into v_me from public.players p
     where p.auth_user_id = auth.uid() and p.club_id = v_m.club_id and public.has_role('joueur') limit 1;
    if v_me is null or not public.player_match_rpe_ok(v_me, p_match) then
      raise exception 'Ce match ne te concerne pas : si la feuille de match est fausse, demande au staff.' using errcode = '42501';
    end if;
    if p_rpe is null then raise exception 'Choisis une valeur de 1 à 10.' using errcode = '22023'; end if;
    if not public.rpe_open(v_m.date_match) then
      raise exception 'La saisie est fermée (jusqu’à 14 jours après le match) : demande au staff de la faire.' using errcode = '42501';
    end if;
    if exists (select 1 from public.match_rpe r where r.match_id = p_match and r.player_id = v_me) then
      raise exception 'Ton RPE de ce match est déjà enregistré : demande au staff pour le changer.' using errcode = '42501';
    end if;
    insert into public.match_rpe (club_id, match_id, player_id, rpe, saisi_par)
    values (v_m.club_id, p_match, v_me, p_rpe, auth.uid())
    returning * into v_row;
  else
    if not public.has_role('admin', 'coach', 'prepa') or public.is_lecteur()
       or public.player_level(p_player) <> 'modification'
       or not (public.team_level(v_m.team_id) <> 'aucun' or v_m.created_by = auth.uid())   -- règles du match (lmfc_v19.sql)
       or not public.player_match_ok(p_player, p_match) then
      raise exception 'Correction réservée au staff qui suit ce joueur sur ce match.' using errcode = '42501';
    end if;
    if p_rpe is null then
      delete from public.match_rpe r where r.match_id = p_match and r.player_id = p_player;
      return null;
    end if;
    insert into public.match_rpe (club_id, match_id, player_id, rpe, saisi_par, corrige_par)
    values (v_m.club_id, p_match, p_player, p_rpe, auth.uid(), auth.uid())
    on conflict (match_id, player_id) do update set rpe = excluded.rpe, corrige_par = auth.uid(), updated_at = now()
    returning * into v_row;
  end if;
  return jsonb_build_object('rpe', v_row.rpe, 'corrige', v_row.corrige_par is not null);
end; $$;

create or replace function public.rpe_history(p_player bigint, p_limit integer default 30)
returns table (session_id bigint, date_seance date, heure time, titre text, rpe smallint, corrige boolean)
language sql stable security definer set search_path = public as $$
  with droit as (
    select exists (select 1 from public.players p where p.id = p_player and p.auth_user_id = auth.uid() and public.has_role('joueur')) as lui,
           public.has_role('admin', 'coach', 'prepa') and public.player_level(p_player) <> 'aucun' as staff)
  select r.session_id, s.date_seance, s.heure, s.titre, r.rpe, r.corrige_par is not null
    from public.session_rpe r join public.sessions s on s.id = r.session_id, droit
   where r.player_id = p_player and r.club_id = public.my_club_id()
     and (droit.lui or (droit.staff and public.session_access_level(s.id) <> 'aucun'))
  union all
  select null, m.date_match, m.heure, 'Match contre ' || m.adversaire, r.rpe, r.corrige_par is not null
    from public.match_rpe r join public.matches m on m.id = r.match_id, droit
   where r.player_id = p_player and r.club_id = public.my_club_id()
     and (droit.lui or (droit.staff and (public.team_level(m.team_id) <> 'aucun' or m.created_by = auth.uid())))
   order by 2 desc, 3 desc nulls last
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

create or replace function public.soreness_alert_seen(p_alert bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_player bigint;
begin
  select a.player_id into v_player from public.soreness_alerts a where a.id = p_alert and a.club_id = public.my_club_id();
  if v_player is null or public.is_lecteur() or not public.has_role('admin', 'coach', 'prepa') or public.player_level(v_player) = 'aucun' then
    raise exception 'Alerte réservée au staff qui suit ce joueur.' using errcode = '42501';
  end if;
  update public.soreness_alerts set vu_par = auth.uid(), vu_at = now() where id = p_alert and vu_at is null;
  return true;
end $$;

create or replace function public.soreness_can_read(p_player bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.players p where p.id = p_player and p.auth_user_id = auth.uid())
      or (public.has_role('admin', 'coach', 'prepa') and public.player_level(p_player) <> 'aucun');
$$;

create or replace function public.soreness_notifs_take()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_out jsonb;
begin
  with mine as (
    update public.soreness_alerts a set pushed_at = now()
      from public.players p
     where p.id = a.player_id and p.auth_user_id = auth.uid() and public.has_role('joueur')
       and a.pushed_at is null and a.jour = current_date
     returning a.player_id, a.club_id, a.muscles, p.prenom, p.nom)
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', left('Courbatures : ' || trim(coalesce(m.prenom, '') || ' ' || m.nom), 80),
           'body', left('3 jours de suite : ' || (select string_agg(case x when 'ischios' then 'ischio-jambiers' else x end, ', ') from unnest(m.muscles) x) || '.', 300),
           'url', 'suivi-rpe.html?vue=courbatures', 'subs', s.subs)), '[]'::jsonb)
    into v_out
    from mine m
    join lateral (select jsonb_agg(jsonb_build_object('id', ps.id, 'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)) as subs
                    from (select ps.* from public.push_subscriptions ps
                            join public.profiles pr on pr.id = ps.user_id
                           where pr.club_id = m.club_id and pr.role in ('admin', 'coach', 'prepa')
                             and public.player_level_for(pr.id, m.player_id) <> 'aucun'
                           order by ps.created_at desc limit 40) ps) s on s.subs is not null;
  return jsonb_build_object('messages', v_out);
end $$;

create or replace function public.trash_right(p_tbl text)
returns boolean language sql security definer stable set search_path = public as $$
      select case p_tbl
        when 'teams'                    then public.is_club_admin()
        when 'players'                  then public.is_club_admin()
        when 'sessions'                 then public.can_edit()
        when 'procedures'               then public.can_edit()
        when 'exercise_templates'       then public.can_edit()
        when 'player_career'            then public.can_edit()
        when 'matches'                  then public.can_edit()
        when 'player_videos'            then public.can_manage_videos()
        when 'video_sequences'          then public.can_manage_videos()
        when 'player_performance_notes' then public.can_manage_plans()
        when 'program_exercises'        then public.can_manage_plans()
        else false
      end;
    $$;
revoke all on function public.trash_right(text) from public, anon;
grant execute on function public.trash_right(text) to authenticated;

create or replace function public.template_image_hidden(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.exercise_templates t where t.image_path = p_path
    and not (t.club_id = public.my_club_id() and public.has_role('admin', 'coach', 'prepa')
             and (t.created_by = auth.uid() or t.partage or public.is_club_admin())));
$$;
revoke all on function public.template_image_hidden(text) from public, anon;
grant execute on function public.template_image_hidden(text) to authenticated;

drop policy if exists "logos_schemas_write" on storage.objects;
drop policy if exists "logos_schemas_update" on storage.objects;
drop policy if exists "logos_schemas_delete" on storage.objects;
create policy "logos_schemas_write" on storage.objects for insert
  with check (bucket_id in ('logos', 'schemas') and public.can_edit() and (storage.foldername(name))[1] = public.my_club_id()::text);
create policy "logos_schemas_update" on storage.objects for update
  using (bucket_id in ('logos', 'schemas') and public.can_edit() and (storage.foldername(name))[1] = public.my_club_id()::text)
  with check (bucket_id in ('logos', 'schemas') and public.can_edit() and (storage.foldername(name))[1] = public.my_club_id()::text);
create policy "logos_schemas_delete" on storage.objects for delete
  using (bucket_id in ('logos', 'schemas') and public.can_edit() and (storage.foldername(name))[1] = public.my_club_id()::text);

drop function if exists public.analyst_schema_path_write(text);
drop function if exists public.analyst_schema_path_read(text);
drop function if exists public.can_edit_team_content();
-- GPS et avis de match : les règles de lmfc_v32.sql et lmfc_v36.sql.
drop policy if exists gps_imports_read on public.gps_imports;
drop policy if exists gps_imports_insert on public.gps_imports;
drop policy if exists gps_imports_cancel on public.gps_imports;
create policy gps_imports_read on public.gps_imports for select using (
  club_id = (select public.my_club_id()) and (select public.has_role('admin', 'coach', 'prepa'))
  and (team_id is null or public.team_level(team_id) <> 'aucun'));
create policy gps_imports_insert on public.gps_imports for insert with check (
  club_id = (select public.my_club_id()) and (select public.has_role('admin', 'prepa')) and importe_par = auth.uid()
  and (team_id is null or exists (select 1 from public.teams t where t.id = gps_imports.team_id and t.club_id = gps_imports.club_id)));
create policy gps_imports_cancel on public.gps_imports for update
  using (club_id = (select public.my_club_id()) and (select public.has_role('admin', 'prepa')))
  with check (club_id = (select public.my_club_id()) and (select public.has_role('admin', 'prepa')));

drop policy if exists gps_rows_read on public.gps_rows;
drop policy if exists gps_rows_insert on public.gps_rows;
create policy gps_rows_read on public.gps_rows for select using (
  club_id = (select public.my_club_id()) and (select public.has_role('admin', 'coach', 'prepa')) and public.player_level(player_id) <> 'aucun');
create policy gps_rows_insert on public.gps_rows for insert with check (
  club_id = (select public.my_club_id()) and (select public.has_role('admin', 'prepa')) and public.player_level(player_id) = 'modification'
  and exists (select 1 from public.gps_imports i where i.id = gps_rows.import_id and i.club_id = gps_rows.club_id and i.annule_at is null));

drop policy if exists gps_aliases_read on public.gps_player_aliases;
drop policy if exists gps_aliases_write on public.gps_player_aliases;
create policy gps_aliases_read on public.gps_player_aliases for select using (
  club_id = (select public.my_club_id()) and (select public.has_role('admin', 'coach', 'prepa')));
create policy gps_aliases_write on public.gps_player_aliases for all
  using (club_id = (select public.my_club_id()) and (select public.has_role('admin', 'prepa')))
  with check (club_id = (select public.my_club_id()) and (select public.has_role('admin', 'prepa'))
    and exists (select 1 from public.players p where p.id = gps_player_aliases.player_id and p.club_id = gps_player_aliases.club_id));

drop policy if exists gps_settings_read on public.gps_settings;
create policy gps_settings_read on public.gps_settings for select using (
  club_id = (select public.my_club_id()) and (select public.has_role('admin', 'coach', 'prepa')));

drop policy if exists match_feedback_read on public.match_feedback;
create policy match_feedback_read on public.match_feedback for select using (
  club_id = (select public.my_club_id()) and (
    exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
    or ((select public.has_role('admin', 'coach', 'prepa'))
        and public.player_level(player_id) <> 'aucun'
        and exists (select 1 from public.matches m where m.id = match_id))));   -- règles du match (lmfc_v19.sql)

commit;
