/* ============================================================
   LMFC Performance — lmfc_v28.sql : calendrier commun
   À exécuter APRÈS lmfc_v27.sql. Rejouable, transactionnelle.

   Le calendrier (calendrier.html) ne recopie rien : il lit les séances
   et les matchs eux-mêmes ; une date changée dans sa rubrique se voit
   aussitôt, sans doublon possible. Ici :
   - sessions.heure : l'heure de la séance (facultative) ;
   - club_events : les autres événements (réunion, stage, tournoi…),
     d'une équipe ou de tout le club (team_id vide) ;
       lecture : staff selon l'équipe (team_level), événements du club
                 pour tout le staff ; joueur : ceux du club et de ses
                 équipes ; lecteur : rien ;
       écriture : admin partout ; coach pour les équipes qu'il modifie
                 (team_level = 'modification') ; un événement de tout le
                 club est réservé à l'admin (club sans équipe : coachs) ;
                 préparateur, joueur, lecteur : rien ;
   - my_calendar(du, au) : le calendrier d'un compte joueur (séances et
     matchs de ses équipes, séances où il est invité, événements). Date,
     heure, titre ou adversaire, lieu, score : jamais les notes de séance,
     les procédés, les commentaires ni les informations du match.
   ============================================================ */
begin;

alter table public.sessions add column if not exists heure time;

create table if not exists public.club_events (
  id          bigint generated always as identity primary key,
  club_id     bigint not null references public.clubs on delete cascade,
  team_id     bigint references public.teams on delete cascade,   -- vide : tout le club
  titre       text not null check (char_length(btrim(titre)) between 1 and 120),
  date_event  date not null,
  heure       time,
  lieu        text check (char_length(lieu) <= 120),
  notes       text check (char_length(notes) <= 1000),
  created_by  uuid default auth.uid() references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists club_events_club_date_idx on public.club_events (club_id, date_event);
drop trigger if exists trg_touch_club_event on public.club_events;
create trigger trg_touch_club_event before update on public.club_events for each row execute function public.touch_match();

-- Équipes du joueur connecté (principale et « joue aussi en »).
create or replace function public.my_player_teams()
returns bigint[] language sql stable security definer set search_path = public as $$
  select coalesce((select array_remove(array[p.team_id] || coalesce(p.other_team_ids, '{}'), null)
                     from public.players p where p.auth_user_id = auth.uid() limit 1), '{}');
$$;
revoke all on function public.my_player_teams() from public, anon;
grant execute on function public.my_player_teams() to authenticated;

alter table public.club_events enable row level security;
drop policy if exists club_events_read on public.club_events;
drop policy if exists club_events_write on public.club_events;
create policy club_events_read on public.club_events for select using (
  club_id = (select public.my_club_id()) and not (select public.is_lecteur()) and (
    ((select public.has_role('admin', 'coach', 'prepa')) and (team_id is null or public.team_level(team_id) <> 'aucun'))
    or ((select public.has_role('joueur')) and (team_id is null or team_id = any(public.my_player_teams())))));
create policy club_events_write on public.club_events for all
  using (club_id = (select public.my_club_id()) and (select public.can_edit()) and public.team_level(team_id) = 'modification')
  with check (club_id = (select public.my_club_id()) and (select public.can_edit()) and public.team_level(team_id) = 'modification'
    and (team_id is null or exists (select 1 from public.teams t where t.id = team_id and t.club_id = (select public.my_club_id()))));

-- Lecteur : aucune écriture (lmfc_v22.sql).
drop policy if exists lecteur_no_insert on public.club_events;
drop policy if exists lecteur_no_update on public.club_events;
drop policy if exists lecteur_no_delete on public.club_events;
create policy lecteur_no_insert on public.club_events as restrictive for insert to authenticated
  with check (not (select public.is_lecteur()));
create policy lecteur_no_update on public.club_events as restrictive for update to authenticated
  using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()));
create policy lecteur_no_delete on public.club_events as restrictive for delete to authenticated
  using (not (select public.is_lecteur()));

revoke all on public.club_events from anon;
grant select, insert, update, delete on public.club_events to authenticated;

-- Calendrier d'un compte joueur (100 jours au plus par appel).
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
  select 'seance', s.id, s.date_seance, s.heure, s.titre, s.team_id, null, null, null::int, null::int, null
    from public.sessions s, me
   where s.club_id = me.club_id and s.date_seance between p_from and p_to
     and (s.team_id = any(me.teams) or (me.no_teams and s.team_id is null)
          or exists (select 1 from public.attendance a where a.session_id = s.id and a.player_id = me.id and a.invite))
  union all
  select 'match', m.id, m.date_match, m.heure, m.adversaire, m.team_id, m.lieu, m.stade, m.score_pour, m.score_contre, null
    from public.matches m, me
   where m.club_id = me.club_id and m.date_match between p_from and p_to
     and (m.team_id = any(me.teams) or (me.no_teams and m.team_id is null))
  union all
  select 'evenement', e.id, e.date_event, e.heure, e.titre, e.team_id, e.lieu, null, null, null, e.notes
    from public.club_events e, me
   where e.club_id = me.club_id and e.date_event between p_from and p_to
     and (e.team_id is null or e.team_id = any(me.teams))
  order by 3, 4 nulls first, 1;
$$;
revoke all on function public.my_calendar(date, date) from public, anon;
grant execute on function public.my_calendar(date, date) to authenticated;

-- Corbeille : les événements d'une équipe supprimée reviennent avec elle.
do $$
begin
  if to_regprocedure('public.trash_capture()') is not null then
    drop trigger if exists trash_capture on public.club_events;
    create trigger trash_capture before delete on public.club_events
      for each row execute function public.trash_capture('child', 'teams:team_id');
  end if;
end $$;

commit;
