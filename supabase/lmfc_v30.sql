/* ============================================================
   LMFC Performance — lmfc_v30.sql : séries, participants, notifications
   À exécuter APRÈS lmfc_v29.sql. Rejouable, transactionnelle.

   Calendrier :
   - sessions.serie_id, club_events.serie_id : occurrences d'une même
     série ; index uniques (série, date) : jamais deux occurrences le même
     jour, un double envoi ne crée rien de plus ; sessions.lieu ;
   - attendance.statut 'non_concerne' : joueur retiré d'une séance de son
     équipe (il ne la voit plus, pas de RPE) ;
   - club_event_players(event, joueur, inclus) : joueur ajouté (inclus)
     ou retiré (pas inclus) d'un événement, sans changer d'équipe ;
       lecture : le staff qui voit l'événement ; écriture : les droits de
       l'événement ; joueur et lecteur : rien ;
   - my_event_ok(event, équipe) : l'événement concerne-t-il le joueur
     connecté ? Règle de lecture joueur de club_events (le serveur décide,
     même en appel direct) et my_calendar ;
   - my_calendar : 'non_concerne' exclu, exceptions appliquées, match
     visible du joueur inscrit sur sa feuille ; player_session_ok :
     'non_concerne' exclu (RPE refusé) ;
   - calendar_add(kind, rows, players) : une série et ses exceptions en
     une transaction, droits de l'appelant ; une date où l'équipe a déjà
     une séance est sautée ; club_event_set_players(events, players).
   Notifications (joueurs) :
   - calendar_notifs : file d'attente, une ligne par joueur et par
     changement, remplie par déclencheurs (ajout, modification, annulation
     d'un événement ou d'une séance de série, à partir d'aujourd'hui) ;
     aucune lecture directe ;
   - calendar_notifs_take(max) : les changements faits par l'utilisateur
     connecté, un message par joueur (une série = un message), avec ses
     appareils ; appelée par le Worker (/api/push/calendar). Plus d'un
     jour d'attente : abandonné.

   Retour arrière (à la main, dans cet ordre) :
     drop function if exists public.calendar_notifs_take(integer), public.calendar_notif_title(text, text, integer),
       public.cal_fr_day(date), public.calendar_add(text, jsonb, jsonb), public.club_event_set_players(bigint[], jsonb) cascade;
     drop trigger if exists calendar_notify_ins on public.club_events; (idem _upd, _del, et sur public.sessions)
     drop function if exists public.calendar_notify(), public.calendar_recipients(text, bigint, bigint, bigint);
     drop table if exists public.calendar_notifs, public.club_event_players;
     repasser lmfc_v28.sql (my_calendar, club_events_read) et lmfc_v29.sql (player_session_ok) ;
     les colonnes serie_id / lieu et le statut 'non_concerne' peuvent rester (inutilisés).
   ============================================================ */
begin;

-- ------------------------------------------------------------
-- 1) Séries, lieu d'une séance, statut « Non concerné »
-- ------------------------------------------------------------
alter table public.sessions add column if not exists serie_id uuid;
alter table public.sessions add column if not exists lieu text;
alter table public.sessions drop constraint if exists sessions_lieu_len;
alter table public.sessions add constraint sessions_lieu_len check (char_length(lieu) <= 120);
alter table public.club_events add column if not exists serie_id uuid;
create unique index if not exists sessions_serie_date_uq on public.sessions (serie_id, date_seance) where serie_id is not null;
create unique index if not exists club_events_serie_date_uq on public.club_events (serie_id, date_event) where serie_id is not null;

alter table public.attendance drop constraint if exists attendance_statut_check;
alter table public.attendance add constraint attendance_statut_check check (statut is null
  or statut in ('present', 'reprise', 'retard', 'absent', 'excuse', 'blesse', 'malade', 'selection', 'groupe_pro', 'autre', 'non_concerne'));

-- ------------------------------------------------------------
-- 2) Joueurs ajoutés ou retirés d'un événement
-- ------------------------------------------------------------
create table if not exists public.club_event_players (
  id         bigint generated always as identity primary key,
  club_id    bigint not null references public.clubs on delete cascade,
  event_id   bigint not null references public.club_events on delete cascade,
  player_id  bigint not null references public.players on delete cascade,
  inclus     boolean not null,
  unique (event_id, player_id)
);
create index if not exists club_event_players_player_idx on public.club_event_players (player_id);

alter table public.club_event_players enable row level security;
drop policy if exists club_event_players_read on public.club_event_players;
drop policy if exists club_event_players_write on public.club_event_players;
create policy club_event_players_read on public.club_event_players for select using (
  club_id = (select public.my_club_id()) and (select public.has_role('admin', 'coach', 'prepa'))
  and exists (select 1 from public.club_events e where e.id = club_event_players.event_id));
create policy club_event_players_write on public.club_event_players for all
  using (club_id = (select public.my_club_id()) and (select public.can_edit())
    and exists (select 1 from public.club_events e where e.id = club_event_players.event_id and public.team_level(e.team_id) = 'modification'))
  with check (club_id = (select public.my_club_id()) and (select public.can_edit())
    and exists (select 1 from public.club_events e where e.id = club_event_players.event_id
                  and e.club_id = club_event_players.club_id and public.team_level(e.team_id) = 'modification')
    and exists (select 1 from public.players p where p.id = club_event_players.player_id and p.club_id = club_event_players.club_id));
drop policy if exists lecteur_no_insert on public.club_event_players;
drop policy if exists lecteur_no_update on public.club_event_players;
drop policy if exists lecteur_no_delete on public.club_event_players;
create policy lecteur_no_insert on public.club_event_players as restrictive for insert to authenticated
  with check (not (select public.is_lecteur()));
create policy lecteur_no_update on public.club_event_players as restrictive for update to authenticated
  using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()));
create policy lecteur_no_delete on public.club_event_players as restrictive for delete to authenticated
  using (not (select public.is_lecteur()));
revoke all on public.club_event_players from anon;
grant select, insert, update, delete on public.club_event_players to authenticated;

do $$
begin
  if to_regprocedure('public.trash_capture()') is not null then
    drop trigger if exists trash_capture on public.club_event_players;
    create trigger trash_capture before delete on public.club_event_players
      for each row execute function public.trash_capture('child', 'club_events:event_id');
  end if;
end $$;

-- ------------------------------------------------------------
-- 3) Ce que voit le joueur : le serveur décide
-- ------------------------------------------------------------
-- Inclus ou retiré nommément : c'est décidé ; sinon son équipe (ou tout le club).
create or replace function public.my_event_ok(p_event bigint, p_team bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select x.inclus from public.club_event_players x join public.players p on p.id = x.player_id
      where x.event_id = p_event and p.auth_user_id = auth.uid() limit 1),
    p_team is null or p_team = any(public.my_player_teams()));
$$;
revoke all on function public.my_event_ok(bigint, bigint) from public, anon;
grant execute on function public.my_event_ok(bigint, bigint) to authenticated;

drop policy if exists club_events_read on public.club_events;
create policy club_events_read on public.club_events for select using (
  club_id = (select public.my_club_id()) and not (select public.is_lecteur()) and (
    ((select public.has_role('admin', 'coach', 'prepa')) and (team_id is null or public.team_level(team_id) <> 'aucun'))
    or ((select public.has_role('joueur')) and public.my_event_ok(id, team_id))));

create or replace function public.my_calendar(p_from date, p_to date)
returns table (kind text, id bigint, date_cal date, heure time, titre text, team_id bigint,
  lieu text, stade text, score_pour int, score_contre int, notes text)
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
$$;
revoke all on function public.my_calendar(date, date) from public, anon;
grant execute on function public.my_calendar(date, date) to authenticated;

-- RPE (lmfc_v29.sql) : un joueur « non concerné » n'a pas de RPE à donner.
create or replace function public.player_session_ok(p_player bigint, p_session bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sessions s join public.players p on p.id = p_player and p.club_id = s.club_id
     where s.id = p_session
       and (s.team_id = p.team_id or s.team_id = any(coalesce(p.other_team_ids, '{}'))
            or exists (select 1 from public.attendance a where a.session_id = s.id and a.player_id = p.id and a.invite)
            or (s.team_id is null and not exists (select 1 from public.teams t where t.club_id = s.club_id))))
    and not exists (select 1 from public.attendance a where a.session_id = p_session and a.player_id = p_player and a.statut = 'non_concerne');
$$;
revoke all on function public.player_session_ok(bigint, bigint) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4) Une série en une fois (droits de l'appelant : la RLS s'applique)
-- ------------------------------------------------------------
-- p_rows : [{ titre, date, heure, team_id, lieu, notes, duree_min, serie_id }]
-- p_players : { add: [id…], remove: [id…] }. Renvoie { created: [{id, date}], skipped: [date…] }.
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
      if exists (select 1 from public.sessions s where s.club_id = v_club and s.team_id is not distinct from v_team and s.date_seance = v_date) then
        v_skipped := v_skipped || to_jsonb(v_date);
        continue;
      end if;
      insert into public.sessions (club_id, team_id, titre, date_seance, heure, lieu, duree_min, serie_id)
      values (v_club, v_team, v_row->>'titre', v_date, nullif(v_row->>'heure', '')::time, nullif(v_row->>'lieu', ''),
              coalesce(nullif(v_row->>'duree_min', '')::numeric, 90), nullif(v_row->>'serie_id', '')::uuid)
      on conflict (serie_id, date_seance) where serie_id is not null do nothing
      returning id into v_id;
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
revoke all on function public.calendar_add(text, jsonb, jsonb) from public, anon;
grant execute on function public.calendar_add(text, jsonb, jsonb) to authenticated;

-- Remplace d'un bloc les exceptions des événements visés (droits de l'appelant).
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
revoke all on function public.club_event_set_players(bigint[], jsonb) from public, anon;
grant execute on function public.club_event_set_players(bigint[], jsonb) to authenticated;

-- ------------------------------------------------------------
-- 5) Notifications : file d'attente remplie par la base
-- ------------------------------------------------------------
create table if not exists public.calendar_notifs (
  id          bigint generated always as identity primary key,
  club_id     bigint not null references public.clubs on delete cascade,
  created_by  uuid not null,
  player_id   bigint not null references public.players on delete cascade,
  action      text not null check (action in ('ajout', 'modif', 'annul')),
  kind        text not null check (kind in ('seance', 'evenement')),
  item_id     bigint not null,
  serie_id    uuid,
  titre       text not null,
  date_cal    date not null,
  heure       time,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists calendar_notifs_pending_idx on public.calendar_notifs (created_by, player_id) where sent_at is null;
alter table public.calendar_notifs enable row level security;   -- aucune règle : seules les fonctions y touchent
revoke all on public.calendar_notifs from anon, authenticated;

-- Joueurs (avec un compte) concernés par une séance ou un événement, exceptions comprises.
create or replace function public.calendar_recipients(p_kind text, p_item bigint, p_team bigint, p_club bigint)
returns setof bigint language sql stable security definer set search_path = public as $$
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
$$;
revoke all on function public.calendar_recipients(text, bigint, bigint, bigint) from public, anon, authenticated;

/* Ajout et modification : déclencheurs différés (fin de transaction), qui
   voient les exceptions créées dans la même transaction. Annulation :
   avant la suppression, tant que les exceptions existent encore. Rien
   pour le passé, ni hors d'une session utilisateur (SQL Editor). */
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
    from public.calendar_recipients(v_kind, (v_j->>'id')::bigint, nullif(v_j->>'team_id', '')::bigint, (v_j->>'club_id')::bigint) pid;
  return case when tg_op = 'DELETE' then old else null end;
end; $$;
revoke all on function public.calendar_notify() from public, anon, authenticated;

drop trigger if exists calendar_notify_ins on public.club_events;
drop trigger if exists calendar_notify_upd on public.club_events;
drop trigger if exists calendar_notify_del on public.club_events;
create constraint trigger calendar_notify_ins after insert on public.club_events
  deferrable initially deferred for each row execute function public.calendar_notify();
create constraint trigger calendar_notify_upd after update on public.club_events
  deferrable initially deferred for each row
  when (old.titre is distinct from new.titre or old.date_event is distinct from new.date_event or old.heure is distinct from new.heure
        or old.lieu is distinct from new.lieu or old.team_id is distinct from new.team_id)
  execute function public.calendar_notify();
create trigger calendar_notify_del before delete on public.club_events
  for each row execute function public.calendar_notify();

-- Séances : seulement celles d'une série (créées par le calendrier) ; pas les brouillons de l'éditeur.
drop trigger if exists calendar_notify_ins on public.sessions;
drop trigger if exists calendar_notify_upd on public.sessions;
drop trigger if exists calendar_notify_del on public.sessions;
create constraint trigger calendar_notify_ins after insert on public.sessions
  deferrable initially deferred for each row when (new.serie_id is not null) execute function public.calendar_notify();
create constraint trigger calendar_notify_upd after update on public.sessions
  deferrable initially deferred for each row
  when (new.serie_id is not null and (old.titre is distinct from new.titre or old.date_seance is distinct from new.date_seance
        or old.heure is distinct from new.heure or old.lieu is distinct from new.lieu))
  execute function public.calendar_notify();
create trigger calendar_notify_del before delete on public.sessions
  for each row when (old.serie_id is not null) execute function public.calendar_notify();

-- « jeu. 01/01 »
create or replace function public.cal_fr_day(p_date date)
returns text language sql immutable set search_path = public as $$
  select (array['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'])[extract(dow from p_date)::int + 1] || ' ' || to_char(p_date, 'DD/MM');
$$;
create or replace function public.calendar_notif_title(p_action text, p_kind text, p_n integer)
returns text language sql immutable set search_path = public as $$
  select case when p_n = 1 then
    case p_action when 'ajout' then case p_kind when 'seance' then 'Nouvelle séance' else 'Nouvel événement' end
                  when 'modif' then case p_kind when 'seance' then 'Séance modifiée' else 'Événement modifié' end
                  else case p_kind when 'seance' then 'Séance annulée' else 'Événement annulé' end end
  else p_n || ' ' || case p_kind
    when 'seance' then 'séances ' || case p_action when 'ajout' then 'ajoutées' when 'modif' then 'modifiées' else 'annulées' end
    else 'événements ' || case p_action when 'ajout' then 'ajoutés' when 'modif' then 'modifiés' else 'annulés' end end
  end;
$$;
revoke all on function public.cal_fr_day(date) from public, anon, authenticated;
revoke all on function public.calendar_notif_title(text, text, integer) from public, anon, authenticated;

/* Pour le Worker : les changements faits par l'utilisateur connecté, un
   message par joueur (au plus p_max joueurs, 3 appareils chacun), marqués
   envoyés. { messages: [{ title, body, url, subs: [{ id, endpoint, p256dh, auth }] }], more }. */
create or replace function public.calendar_notifs_take(p_max integer default 12)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me      uuid := auth.uid();
  v_players bigint[];
  v_more    boolean;
  v_out     jsonb;
begin
  if v_me is null then return jsonb_build_object('messages', '[]'::jsonb, 'more', false); end if;
  update public.calendar_notifs set sent_at = now()
   where created_by = v_me and sent_at is null and created_at < now() - interval '1 day';
  select array_agg(player_id) into v_players from (
    select distinct player_id from public.calendar_notifs where created_by = v_me and sent_at is null
     order by player_id limit greatest(1, least(coalesce(p_max, 12), 15))) x;
  if v_players is null then return jsonb_build_object('messages', '[]'::jsonb, 'more', false); end if;
  v_more := exists (select 1 from public.calendar_notifs
                     where created_by = v_me and sent_at is null and not (player_id = any(v_players)));
  with mine as (
    update public.calendar_notifs set sent_at = now()
     where created_by = v_me and sent_at is null and player_id = any(v_players)
     returning player_id, action, kind, item_id, serie_id, titre, date_cal, heure),
  grp as (   -- une série (ou un élément) et une action
    select player_id, action, kind, count(*)::int as n, min(date_cal) as d1, max(date_cal) as d2, min(titre) as titre, min(heure) as heure
      from mine group by player_id, action, kind, coalesce(serie_id::text, item_id::text)),
  txt as (
    select player_id, d1, public.calendar_notif_title(action, kind, n) as title,
           titre || ' · ' || case when n = 1 then public.cal_fr_day(d1) || coalesce(' à ' || to_char(heure, 'HH24"h"MI'), '')
                                  else 'du ' || public.cal_fr_day(d1) || ' au ' || public.cal_fr_day(d2) end as body
      from grp),
  per as (
    select player_id, count(*) as groups, (array_agg(title order by d1))[1] as title1, (array_agg(body order by d1))[1] as body1,
           string_agg(title, ' · ' order by d1) as titles
      from txt group by player_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', case when per.groups = 1 then per.title1 else 'Ton calendrier a changé' end,
           'body', left(case when per.groups = 1 then per.body1 else per.groups || ' changements : ' || per.titles end, 300),
           'url', 'calendrier.html', 'subs', s.subs)), '[]'::jsonb)
    into v_out
    from per join public.players p on p.id = per.player_id
    join lateral (select jsonb_agg(jsonb_build_object('id', ps.id, 'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)) as subs
                    from (select * from public.push_subscriptions where user_id = p.auth_user_id order by created_at desc limit 3) ps) s
      on s.subs is not null;
  return jsonb_build_object('messages', v_out, 'more', v_more);
end; $$;
revoke all on function public.calendar_notifs_take(integer) from public, anon;
grant execute on function public.calendar_notifs_take(integer) to authenticated;

commit;
