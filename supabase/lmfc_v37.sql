/* ============================================================
   LMFC Performance — lmfc_v37.sql (n° 55)
   À exécuter APRÈS lmfc_v36.sql. Rejouable, transactionnelle.

   1) Mon club : réattribuer une fiche joueur à un compte. club_link_player
      refusait un compte déjà lié à une autre fiche (« Ce compte est déjà
      associé… ») alors que la suite était écrite pour déplacer le lien.
      Désormais, au choix de l'admin : le compte quitte son ancienne
      fiche ; une fiche liée à un autre compte le quitte (l'écran demande
      confirmation). Un compte = une fiche, une fiche = un compte (unique).
   2) Retours de match : joueurs hors plateforme d'un match
      (matches.hors_plateforme : [{ nom, numero, statut, minutes, buts,
      cartons_jaunes, carton_rouge }], 30 au plus). Un joueur de passage
      (un pro qui descend) figure sur la feuille du match sans fiche ni
      compte : il ne compte dans aucune statistique de joueur. Droits et
      corbeille : ceux du match.
   3) Schémas enregistrés (exercise_templates) : chacun a son créateur
      (created_by, posé par la base) et reste à lui, sauf s'il le partage
      avec le club (partage). Lecture : son créateur, tout le staff s'il
      est partagé, l'admin toujours ; modification et suppression : son
      créateur ou l'admin ; seul l'admin attribue un schéma à quelqu'un.
      Les anciens schémas n'ont jamais eu de créateur enregistré : ils
      restent partagés avec le club jusqu'à ce que l'admin les attribue.
      Le joueur et le lecteur ne les lisent plus.
   4) Calendrier : autant de séances qu'on veut dans la journée. calendar_add
      sautait une date où l'équipe avait déjà une séance, et l'index
      sessions_serie_date_uq refusait deux séances d'une même série le même
      jour (déplacer une séance sur un jour déjà occupé). Seul un double
      envoi (même série, même date) ne crée rien de plus.
   5) RPE : le joueur peut noter avec du retard, jusqu'à 14 jours après la
      séance (rpe_open, seul endroit où ce délai est fixé ; RPE_DAYS dans
      rpe.js), mais une seule fois : sa réponse est définitive, le staff
      seul la corrige (rpe_set). rpe_history donne l'heure de la séance :
      deux séances le même jour se distinguent.

   Retour arrière (3) :
     drop trigger if exists guard_template_owner on public.exercise_templates;
     drop function if exists public.guard_template_owner();
     alter table public.exercise_templates drop column if exists partage;
     -- puis les règles templates_read / templates_write de schema.sql.
   ============================================================ */
begin;

-- ------------------------------------------------------------
-- 1) Fiche joueur ↔ compte
-- ------------------------------------------------------------
create or replace function public.club_link_player(p_profile_id uuid, p_player_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_club_id bigint;
begin
  if auth.uid() is null then raise exception 'Vous devez être connecté.'; end if;
  select club_id into v_club_id from public.profiles
    where id = auth.uid() and role = 'admin';
  if v_club_id is null then raise exception 'Action réservée à l’administrateur du club.'; end if;
  if p_profile_id = auth.uid() then raise exception 'Vous ne pouvez pas vous associer vous-même comme joueur.'; end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and club_id = v_club_id) then
    raise exception 'Ce membre ne fait pas partie de votre club.';
  end if;
  if not exists (select 1 from public.players where id = p_player_id and club_id = v_club_id) then
    raise exception 'Cette fiche joueur ne fait pas partie de votre club.';
  end if;
  -- Réattribuer : l'ancienne fiche du compte est libérée d'abord (auth_user_id est unique) ;
  -- une fiche liée à un autre compte passe à celui-ci.
  update public.players set auth_user_id = null where auth_user_id = p_profile_id and id <> p_player_id;
  update public.players set auth_user_id = p_profile_id where id = p_player_id;
  update public.profiles set role = 'joueur' where id = p_profile_id and club_id = v_club_id;
end; $$;
revoke all on function public.club_link_player(uuid, bigint) from public, anon;
grant execute on function public.club_link_player(uuid, bigint) to authenticated;

-- ------------------------------------------------------------
-- 2) Joueurs hors plateforme d'un match
-- ------------------------------------------------------------
alter table public.matches add column if not exists hors_plateforme jsonb not null default '[]'::jsonb;
alter table public.matches drop constraint if exists matches_hors_plateforme_check;
alter table public.matches add constraint matches_hors_plateforme_check
  check (jsonb_typeof(hors_plateforme) = 'array' and jsonb_array_length(hors_plateforme) <= 30);

-- ------------------------------------------------------------
-- 3) Schémas : créateur et partage
-- ------------------------------------------------------------
alter table public.exercise_templates alter column created_by set default auth.uid();
alter table public.exercise_templates add column if not exists partage boolean not null default false;
-- Anciens schémas, sans créateur connu : visibles de tout le club, comme avant.
update public.exercise_templates set partage = true where created_by is null and not partage;

-- Le créateur est celui qui enregistre ; seul l'admin le change (attribution).
-- Seules les écritures de l'API sont gardées : la corbeille (trash_restore, security
-- definer) rend un schéma à son créateur, le SQL Editor et les migrations passent.
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
drop trigger if exists guard_template_owner on public.exercise_templates;
create trigger guard_template_owner before insert or update on public.exercise_templates
  for each row execute function public.guard_template_owner();

alter table public.exercise_templates enable row level security;
drop policy if exists templates_read on public.exercise_templates;
drop policy if exists templates_write on public.exercise_templates;
drop policy if exists templates_insert on public.exercise_templates;
drop policy if exists templates_update on public.exercise_templates;
drop policy if exists templates_delete on public.exercise_templates;
create policy templates_read on public.exercise_templates for select using (
  club_id = (select public.my_club_id()) and (select public.has_role('admin', 'coach', 'prepa'))
  and (created_by = auth.uid() or partage or (select public.is_club_admin())));
create policy templates_insert on public.exercise_templates for insert with check (
  club_id = (select public.my_club_id()) and (select public.can_edit()));
create policy templates_update on public.exercise_templates for update
  using (club_id = (select public.my_club_id()) and (select public.can_edit())
         and (created_by = auth.uid() or (select public.is_club_admin())))
  with check (club_id = (select public.my_club_id()) and (select public.can_edit()));
create policy templates_delete on public.exercise_templates for delete
  using (club_id = (select public.my_club_id()) and (select public.can_edit())
         and (created_by = auth.uid() or (select public.is_club_admin())));

-- ------------------------------------------------------------
-- 4) Calendrier : plusieurs séances dans la journée
-- ------------------------------------------------------------
drop index if exists public.sessions_serie_date_uq;

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
revoke all on function public.calendar_add(text, jsonb, jsonb) from public, anon;
grant execute on function public.calendar_add(text, jsonb, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 5) RPE : avec du retard, une seule fois
-- ------------------------------------------------------------
create or replace function public.rpe_open(p_date date)
returns boolean language sql stable set search_path = public as $$
  select p_date between current_date - 14 and current_date;
$$;

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

-- Le type de retour change (heure) : la fonction est recréée.
drop function if exists public.rpe_history(bigint, integer);
create function public.rpe_history(p_player bigint, p_limit integer default 30)
returns table (session_id bigint, date_seance date, heure time, titre text, rpe smallint, corrige boolean)
language sql stable security definer set search_path = public as $$
  select r.session_id, s.date_seance, s.heure, s.titre, r.rpe, r.corrige_par is not null
    from public.session_rpe r join public.sessions s on s.id = r.session_id
   where r.player_id = p_player and r.club_id = public.my_club_id()
     and (exists (select 1 from public.players p where p.id = p_player and p.auth_user_id = auth.uid() and public.has_role('joueur'))
          or (public.has_role('admin', 'coach', 'prepa') and public.player_level(p_player) <> 'aucun'
              and public.session_access_level(s.id) <> 'aucun'))
   order by s.date_seance desc, s.heure desc nulls last
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;
revoke all on function public.rpe_history(bigint, integer) from public, anon;
grant execute on function public.rpe_history(bigint, integer) to authenticated;

commit;
