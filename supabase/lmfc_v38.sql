/* ============================================================
   LMFC Performance — lmfc_v38.sql (n° 56) : RPE après le match
   À exécuter APRÈS lmfc_v37.sql. Rejouable, transactionnelle.

   Le joueur note l'effort d'un match comme celui d'une séance (lmfc_v29.sql,
   lmfc_v37.sql) : 1 à 10, du jour du match à J+14 (rpe_open), une seule
   réponse, que seul le staff corrige.
   - match_rpe : le RPE, qui l'a saisi, et corrige_par quand le staff l'a
     corrigé ou saisi à la place du joueur.
   - Qui note (player_match_rpe_ok) : sans feuille de match, tout le groupe
     (player_match_ok, lmfc_v36.sql), pour ne pas dépendre d'un coach qui la
     remplit ; avec une feuille, ceux qui ont joué. Minutes renseignées :
     plus de zéro ; sinon, tous ceux qui ne sont pas notés « non entré ».
   - Lecture : le joueur, le sien ; le staff qui suit le joueur et lit le
     match ; ni les autres joueurs, ni le lecteur.
   - Écriture : seulement par match_rpe_set() (aucun droit direct) :
       joueur : pour lui, une seule fois, dans le délai ;
       staff  : correction ou effacement avec player_level =
                'modification' sur le joueur, match lisible.
   - my_rpe_matches() : les matchs que le joueur peut noter (accueil,
     calendrier). rpe_history() les ajoute aux séances (session_id vide).
   Rien que des ajouts : le site d'avant continue de fonctionner.

   Retour arrière :
     drop function if exists public.match_rpe_set(bigint, integer, bigint), public.my_rpe_matches(), public.player_match_rpe_ok(bigint, bigint);
     drop table if exists public.match_rpe;
     repasser la fin de lmfc_v37.sql (rpe_history), après ce retour.
   ============================================================ */
begin;

create table if not exists public.match_rpe (
  id          bigint generated always as identity primary key,
  club_id     bigint not null references public.clubs on delete cascade,
  match_id    bigint not null references public.matches on delete cascade,
  player_id   bigint not null references public.players on delete cascade,
  rpe         smallint not null check (rpe between 1 and 10),
  saisi_par   uuid references auth.users on delete set null,
  corrige_par uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (match_id, player_id)
);
create index if not exists match_rpe_player_idx on public.match_rpe (player_id);

-- Ce joueur doit-il noter ce match ? Même règle que rpeOnSheet (rpe-stats.js).
create or replace function public.player_match_rpe_ok(p_player bigint, p_match bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select public.player_match_ok(p_player, p_match) and (
    not exists (select 1 from public.match_players mp where mp.match_id = p_match)
    or exists (select 1 from public.match_players mp where mp.match_id = p_match and mp.player_id = p_player
                and coalesce(mp.minutes > 0, mp.statut is distinct from 'non_entre')));
$$;
-- Interne : dirait à n'importe quel compte qui a joué quel match.
revoke all on function public.player_match_rpe_ok(bigint, bigint) from public, anon, authenticated;

alter table public.match_rpe enable row level security;
drop policy if exists match_rpe_read on public.match_rpe;
create policy match_rpe_read on public.match_rpe for select using (
  club_id = (select public.my_club_id()) and (
    exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
    or ((select public.has_role('admin', 'coach', 'prepa'))
        and public.player_level(player_id) <> 'aucun'
        and exists (select 1 from public.matches m where m.id = match_id))));   -- règles du match (lmfc_v19.sql)

-- Lecteur : aucune écriture (lmfc_v22.sql) ; de toute façon, aucun droit direct d'écriture.
drop policy if exists lecteur_no_insert on public.match_rpe;
drop policy if exists lecteur_no_update on public.match_rpe;
drop policy if exists lecteur_no_delete on public.match_rpe;
create policy lecteur_no_insert on public.match_rpe as restrictive for insert to authenticated
  with check (not (select public.is_lecteur()));
create policy lecteur_no_update on public.match_rpe as restrictive for update to authenticated
  using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()));
create policy lecteur_no_delete on public.match_rpe as restrictive for delete to authenticated
  using (not (select public.is_lecteur()));
revoke all on public.match_rpe from anon, authenticated;
grant select on public.match_rpe to authenticated;

-- Enregistre un RPE de match. p_player vide : le joueur connecté, pour lui-même.
-- p_player donné : correction du staff (p_rpe vide = effacer).
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

-- Matchs que le joueur connecté peut noter maintenant (mêmes colonnes que my_rpe_sessions).
create or replace function public.my_rpe_matches()
returns table (match_id bigint, date_seance date, heure time, titre text, rpe smallint, corrige boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.date_match, m.heure, 'Match contre ' || m.adversaire, r.rpe, r.corrige_par is not null
    from public.players p
    join public.matches m on m.club_id = p.club_id and public.rpe_open(m.date_match)
    left join public.match_rpe r on r.match_id = m.id and r.player_id = p.id
   where p.auth_user_id = auth.uid() and public.has_role('joueur') and public.player_match_rpe_ok(p.id, m.id)
   order by m.date_match desc, m.heure desc nulls last;
$$;

-- Évolution du RPE d'un joueur, séances et matchs, de la plus récente à la plus ancienne (100 au plus).
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

do $$
declare f text;
begin
  foreach f in array array['match_rpe_set(bigint, integer, bigint)', 'my_rpe_matches()', 'rpe_history(bigint, integer)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Corbeille : le RPE revient avec son match ou son joueur.
do $$
begin
  if to_regprocedure('public.trash_capture()') is not null then
    drop trigger if exists trash_capture on public.match_rpe;
    create trigger trash_capture before delete on public.match_rpe
      for each row execute function public.trash_capture('child', 'matches:match_id|players:player_id');
  end if;
end $$;

commit;
