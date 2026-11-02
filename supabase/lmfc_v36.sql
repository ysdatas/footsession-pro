/* ============================================================
   LMFC Performance — lmfc_v36.sql (n° 54) : avis des joueurs après le match
   À exécuter APRÈS lmfc_v35.sql. Rejouable, transactionnelle.

   Deux questions, que le joueur retrouve à tout moment (calendrier,
   accueil) et complète quand il veut, sur le modèle du RPE (lmfc_v29.sql) :
     - individuel : « Que penses-tu de ta performance individuelle lors de
       ce match ? » ;
     - collectif : « Que penses-tu de la performance collective de l'équipe
       lors de ce match ? ».
   Un avis par joueur et par match, 2 000 caractères au plus par réponse.
   Le match doit le concerner (son équipe, « joue aussi en », la feuille de
   match, ou un club sans équipe : la règle de my_calendar, lmfc_v30.sql)
   et avoir eu lieu.
   Lecture : le joueur (les siennes, jamais celles des autres) ; le staff
   qui le suit (admin, coach, prépa, player_level ≠ « aucun ») et qui lit le
   match ; jamais le lecteur. Aucune écriture directe : match_feedback_set().
   Corbeille : l'avis revient avec son match ou son joueur.

   Retour arrière :
     drop function if exists public.match_feedback_set(bigint, text, text), public.player_match_ok(bigint, bigint);
     drop table if exists public.match_feedback;
   ============================================================ */
begin;

create table if not exists public.match_feedback (
  id          bigint generated always as identity primary key,
  club_id     bigint not null references public.clubs on delete cascade,
  match_id    bigint not null references public.matches on delete cascade,
  player_id   bigint not null references public.players on delete cascade,
  individuel  text check (char_length(individuel) <= 2000),
  collectif   text check (char_length(collectif) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (match_id, player_id)
);
create index if not exists match_feedback_player_idx on public.match_feedback (player_id);

-- Le match concerne ce joueur : la règle de my_calendar (lmfc_v30.sql).
create or replace function public.player_match_ok(p_player bigint, p_match bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.matches m join public.players p on p.id = p_player and p.club_id = m.club_id
     where m.id = p_match
       and (m.team_id = p.team_id or m.team_id = any(coalesce(p.other_team_ids, '{}'))
            or exists (select 1 from public.match_players mp where mp.match_id = m.id and mp.player_id = p.id)
            or (m.team_id is null and not exists (select 1 from public.teams t where t.club_id = m.club_id))));
$$;
-- Interne : dirait à n'importe quel compte quels matchs concernent quel joueur.
revoke all on function public.player_match_ok(bigint, bigint) from public, anon, authenticated;

alter table public.match_feedback enable row level security;
drop policy if exists match_feedback_read on public.match_feedback;
create policy match_feedback_read on public.match_feedback for select using (
  club_id = (select public.my_club_id()) and (
    exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
    or ((select public.has_role('admin', 'coach', 'prepa'))
        and public.player_level(player_id) <> 'aucun'
        and exists (select 1 from public.matches m where m.id = match_id))));   -- règles du match (lmfc_v19.sql)

-- Lecteur : aucune écriture (lmfc_v22.sql) ; de toute façon, aucun droit direct d'écriture.
drop policy if exists lecteur_no_insert on public.match_feedback;
drop policy if exists lecteur_no_update on public.match_feedback;
drop policy if exists lecteur_no_delete on public.match_feedback;
create policy lecteur_no_insert on public.match_feedback as restrictive for insert to authenticated
  with check (not (select public.is_lecteur()));
create policy lecteur_no_update on public.match_feedback as restrictive for update to authenticated
  using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()));
create policy lecteur_no_delete on public.match_feedback as restrictive for delete to authenticated
  using (not (select public.is_lecteur()));
revoke all on public.match_feedback from anon, authenticated;
grant select on public.match_feedback to authenticated;

-- Avis du joueur connecté sur un match passé qui le concerne ; il le reprend
-- quand il veut (même ligne). Réponse vide = rien. Renvoie { individuel, collectif }.
create or replace function public.match_feedback_set(p_match bigint, p_individuel text, p_collectif text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me bigint; v_club bigint; v_date date;
  v_ind text := nullif(btrim(coalesce(p_individuel, '')), '');
  v_col text := nullif(btrim(coalesce(p_collectif, '')), '');
begin
  select p.id, p.club_id into v_me, v_club from public.players p
   where p.auth_user_id = auth.uid() and public.has_role('joueur') limit 1;
  if v_me is null then raise exception 'Avis réservé aux joueurs.' using errcode = '42501'; end if;
  select m.date_match into v_date from public.matches m where m.id = p_match and m.club_id = v_club;
  if v_date is null or not public.player_match_ok(v_me, p_match) then
    raise exception 'Match introuvable.' using errcode = '42501';
  end if;
  if v_date > current_date then
    raise exception 'Le match n’a pas encore eu lieu : ton avis s’ouvre le jour du match.' using errcode = '22023';
  end if;
  if char_length(v_ind) > 2000 or char_length(v_col) > 2000 then
    raise exception '2 000 caractères au plus par réponse.' using errcode = '22023';
  end if;
  insert into public.match_feedback (club_id, match_id, player_id, individuel, collectif)
  values (v_club, p_match, v_me, v_ind, v_col)
  on conflict (match_id, player_id) do update
    set individuel = excluded.individuel, collectif = excluded.collectif, updated_at = now();
  return jsonb_build_object('individuel', v_ind, 'collectif', v_col);
end $$;
revoke all on function public.match_feedback_set(bigint, text, text) from public, anon;
grant execute on function public.match_feedback_set(bigint, text, text) to authenticated;

-- Corbeille : l'avis revient avec son match ou son joueur.
do $$
begin
  if to_regprocedure('public.trash_capture()') is not null then
    drop trigger if exists trash_capture on public.match_feedback;
    create trigger trash_capture before delete on public.match_feedback
      for each row execute function public.trash_capture('child', 'matches:match_id|players:player_id');
  end if;
end $$;

commit;
