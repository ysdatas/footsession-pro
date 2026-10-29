/* ============================================================
   LMFC Performance — lmfc_v29.sql : RPE après la séance
   À exécuter APRÈS lmfc_v28.sql. Rejouable, transactionnelle.

   Le RPE est la perception de l'effort par le joueur (1 à 10, échelle
   CR-10). Une seule évaluation par joueur et par séance.
   - session_rpe : le RPE, qui l'a saisi, et corrige_par quand le staff
     l'a corrigé (ou saisi à la place du joueur). Séparé des bilans du
     staff (session_bilans) : ce n'est pas une appréciation du staff.
   - Lecture : le joueur, le sien seulement ; le staff (admin, coach,
     préparateur) qui voit le joueur (player_level) et la séance
     (session_access_level). Ni les autres joueurs, ni le lecteur.
   - Écriture : seulement par rpe_set() (aucun droit direct) :
       joueur : pour lui, une séance de son équipe ou où il est invité,
                du jour de la séance à J+2 (rpe_open) ; plus rien une
                fois le RPE corrigé par le staff ;
       staff  : correction (ou effacement) avec player_level =
                'modification' sur le joueur, séance visible.
   - my_rpe_sessions() : les séances que le joueur peut noter (accueil).
   - rpe_history(joueur) : l'évolution, pour le joueur ou le staff.
   Aucun calcul de charge ni alerte : le staff en fixera les règles.
   ============================================================ */
begin;

create table if not exists public.session_rpe (
  id          bigint generated always as identity primary key,
  club_id     bigint not null references public.clubs on delete cascade,
  session_id  bigint not null references public.sessions on delete cascade,
  player_id   bigint not null references public.players on delete cascade,
  rpe         smallint not null check (rpe between 1 and 10),
  saisi_par   uuid references auth.users on delete set null,
  corrige_par uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (session_id, player_id)
);
create index if not exists session_rpe_player_idx on public.session_rpe (player_id);

-- Saisie ouverte du jour de la séance à J+2 (le seul endroit où ce délai est fixé).
create or replace function public.rpe_open(p_date date)
returns boolean language sql stable set search_path = public as $$
  select p_date between current_date - 2 and current_date;
$$;

-- La séance concerne ce joueur : son équipe (principale ou « joue aussi en »),
-- une invitation, ou un club sans équipe.
create or replace function public.player_session_ok(p_player bigint, p_session bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sessions s join public.players p on p.id = p_player and p.club_id = s.club_id
     where s.id = p_session
       and (s.team_id = p.team_id or s.team_id = any(coalesce(p.other_team_ids, '{}'))
            or exists (select 1 from public.attendance a where a.session_id = s.id and a.player_id = p.id and a.invite)
            or (s.team_id is null and not exists (select 1 from public.teams t where t.club_id = s.club_id))));
$$;

alter table public.session_rpe enable row level security;
drop policy if exists session_rpe_read on public.session_rpe;
create policy session_rpe_read on public.session_rpe for select using (
  club_id = (select public.my_club_id()) and (
    exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
    or ((select public.has_role('admin', 'coach', 'prepa'))
        and public.player_level(player_id) <> 'aucun' and public.session_access_level(session_id) <> 'aucun')));

-- Lecteur : aucune écriture (lmfc_v22.sql) ; de toute façon, aucun droit direct d'écriture.
drop policy if exists lecteur_no_insert on public.session_rpe;
drop policy if exists lecteur_no_update on public.session_rpe;
drop policy if exists lecteur_no_delete on public.session_rpe;
create policy lecteur_no_insert on public.session_rpe as restrictive for insert to authenticated
  with check (not (select public.is_lecteur()));
create policy lecteur_no_update on public.session_rpe as restrictive for update to authenticated
  using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()));
create policy lecteur_no_delete on public.session_rpe as restrictive for delete to authenticated
  using (not (select public.is_lecteur()));
revoke all on public.session_rpe from anon, authenticated;
grant select on public.session_rpe to authenticated;

-- Enregistre un RPE. p_player vide : le joueur connecté, pour lui-même.
-- p_player donné : correction du staff (p_rpe vide = effacer).
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
      raise exception 'La saisie est fermée (jusqu’à 2 jours après la séance) : demande au staff de la faire.' using errcode = '42501';
    end if;
    if exists (select 1 from public.session_rpe r where r.session_id = p_session and r.player_id = v_me and r.corrige_par is not null) then
      raise exception 'Le staff a corrigé ce RPE : demande-lui pour le changer.' using errcode = '42501';
    end if;
    insert into public.session_rpe (club_id, session_id, player_id, rpe, saisi_par)
    values (v_club, p_session, v_me, p_rpe, auth.uid())
    on conflict (session_id, player_id) do update set rpe = excluded.rpe, saisi_par = excluded.saisi_par, updated_at = now()
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

-- Séances que le joueur connecté peut noter maintenant (accueil, calendrier).
create or replace function public.my_rpe_sessions()
returns table (session_id bigint, date_seance date, heure time, titre text, rpe smallint, corrige boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.date_seance, s.heure, s.titre, r.rpe, r.corrige_par is not null
    from public.players p
    join public.sessions s on s.club_id = p.club_id and public.rpe_open(s.date_seance)
    left join public.session_rpe r on r.session_id = s.id and r.player_id = p.id
   where p.auth_user_id = auth.uid() and public.has_role('joueur') and public.player_session_ok(p.id, s.id)
   order by s.date_seance desc, s.heure desc nulls last;
$$;

-- Évolution du RPE d'un joueur, de la plus récente à la plus ancienne (100 au plus).
create or replace function public.rpe_history(p_player bigint, p_limit integer default 30)
returns table (session_id bigint, date_seance date, titre text, rpe smallint, corrige boolean)
language sql stable security definer set search_path = public as $$
  select r.session_id, s.date_seance, s.titre, r.rpe, r.corrige_par is not null
    from public.session_rpe r join public.sessions s on s.id = r.session_id
   where r.player_id = p_player and r.club_id = public.my_club_id()
     and (exists (select 1 from public.players p where p.id = p_player and p.auth_user_id = auth.uid() and public.has_role('joueur'))
          or (public.has_role('admin', 'coach', 'prepa') and public.player_level(p_player) <> 'aucun'
              and public.session_access_level(s.id) <> 'aucun'))
   order by s.date_seance desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

do $$
declare f text;
begin
  foreach f in array array['rpe_set(bigint, integer, bigint)', 'my_rpe_sessions()', 'rpe_history(bigint, integer)', 'rpe_open(date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- Interne : dirait à n'importe quel compte quelles séances concernent quel joueur.
  revoke all on function public.player_session_ok(bigint, bigint) from public, anon, authenticated;
end $$;

-- Corbeille : le RPE revient avec sa séance ou son joueur.
do $$
begin
  if to_regprocedure('public.trash_capture()') is not null then
    drop trigger if exists trash_capture on public.session_rpe;
    create trigger trash_capture before delete on public.session_rpe
      for each row execute function public.trash_capture('child', 'sessions:session_id|players:player_id');
  end if;
end $$;

commit;
