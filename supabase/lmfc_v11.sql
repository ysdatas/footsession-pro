/* ============================================================
   LMFC Performance — migration 30 : retours de match.
   À exécuter APRÈS lmfc_v10.sql. Idempotent (rejouable) et
   transactionnel : en cas d'erreur, rien n'est appliqué.

   - matches : une rencontre (adversaire, date, compétition, lieu,
     score, informations, commentaire général, points à retenir),
     rattachée à une équipe du club ;
   - match_players : les joueurs concernés (titulaire, remplaçant,
     non entré ; minutes, buts, passes ; + / = / − ; commentaire),
     d'où l'historique de chaque joueur au fil des matchs.
   Le staff du club lit ; administrateur et coachs écrivent ; le
   joueur n'y a pas accès. Un match supprimé passe par la corbeille
   avec ses joueurs.
   ============================================================ */
begin;

create table if not exists public.matches (
  id           bigint generated always as identity primary key,
  club_id      bigint not null references public.clubs on delete cascade,
  team_id      bigint references public.teams on delete set null,
  adversaire   text not null check (char_length(btrim(adversaire)) between 1 and 120),
  date_match   date not null,
  competition  text,
  lieu         text check (lieu in ('domicile', 'exterieur', 'neutre')),
  score_pour   int check (score_pour between 0 and 99),
  score_contre int check (score_contre between 0 and 99),
  infos        text,
  commentaire  text,
  a_retenir    text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists matches_club_date_idx on public.matches (club_id, date_match desc);

create table if not exists public.match_players (
  id          bigint generated always as identity primary key,
  club_id     bigint not null references public.clubs on delete cascade,
  match_id    bigint not null references public.matches on delete cascade,
  player_id   bigint not null references public.players on delete cascade,
  statut      text check (statut in ('titulaire', 'remplacant', 'non_entre')),
  minutes     int check (minutes between 0 and 130),
  buts        int check (buts between 0 and 20),
  passes      int check (passes between 0 and 20),
  note        text check (note in ('plus', 'egal', 'moins')),
  commentaire text check (char_length(commentaire) <= 500),
  unique (match_id, player_id)
);
create index if not exists match_players_player_idx on public.match_players (player_id);

create or replace function public.touch_match()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists trg_touch_match on public.matches;
create trigger trg_touch_match before update on public.matches for each row execute function public.touch_match();

-- ------------------------------------------------------------
-- Droits : staff du club en lecture, admin et coachs en écriture.
-- Équipe, match et joueur appartiennent au club.
-- ------------------------------------------------------------
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
drop policy if exists matches_read  on public.matches;
drop policy if exists matches_write on public.matches;
create policy matches_read on public.matches for select using (public.is_staff() and club_id = public.my_club_id());
create policy matches_write on public.matches for all
  using (public.can_edit() and club_id = public.my_club_id())
  with check (public.can_edit() and club_id = public.my_club_id()
    and (team_id is null or exists (select 1 from public.teams t where t.id = team_id and t.club_id = public.my_club_id())));
drop policy if exists match_players_read  on public.match_players;
drop policy if exists match_players_write on public.match_players;
create policy match_players_read on public.match_players for select using (public.is_staff() and club_id = public.my_club_id());
create policy match_players_write on public.match_players for all
  using (public.can_edit() and club_id = public.my_club_id())
  with check (public.can_edit() and club_id = public.my_club_id()
    and exists (select 1 from public.matches m where m.id = match_id and m.club_id = public.my_club_id())
    and exists (select 1 from public.players p where p.id = player_id and p.club_id = public.my_club_id()));
revoke all on public.matches, public.match_players from anon;
grant select, insert, update, delete on public.matches, public.match_players to authenticated;

-- ------------------------------------------------------------
-- Corbeille : le match part (et revient) avec ses joueurs.
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.trash') is null then return; end if;
  execute $f$
    create or replace function public.trash_right(p_tbl text)
    returns boolean language sql security definer stable set search_path = public as $b$
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
    $b$;
  $f$;
  drop trigger if exists trash_capture on public.matches;
  create trigger trash_capture before delete on public.matches
    for each row execute function public.trash_capture('root', '');
  drop trigger if exists trash_capture on public.match_players;
  create trigger trash_capture before delete on public.match_players
    for each row execute function public.trash_capture('child', 'matches:match_id|players:player_id');
end $$;

commit;
