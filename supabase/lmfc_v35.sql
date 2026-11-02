/* ============================================================
   LMFC Performance — lmfc_v35.sql (n° 53) : courbatures avant la séance
   À exécuter APRÈS lmfc_v34.sql. Rejouable, transactionnelle.

   Questionnaire du joueur, le jour d'une séance qui le concerne
   (player_session_ok, lmfc_v29.sql), une réponse par jour, modifiable
   le jour même :
     - niveau de courbature au réveil, 0 à 10 ; 0 : fin du questionnaire ;
     - de 1 à 10 : les muscles courbaturés (au moins un), bas du corps
       (ischios, quadriceps, adducteurs, abducteurs, mollets) ou haut du
       corps (pectoraux, dorsaux, abdominaux, biceps, triceps).
   Alerte : un même muscle déclaré aujourd'hui, hier et avant-hier (3 jours
   de calendrier ; un jour sans réponse remet à zéro). Une alerte par joueur
   et par jour, créée ici, au moment de la réponse. Le staff la voit (Suivi
   RPE, accueil) et la marque « Vu » ; le Worker l'envoie sur le téléphone du
   staff qui suit le joueur (/api/push/soreness, soreness_notifs_take).
   Données de santé : le joueur (les siennes) et le staff qui le suit
   (admin, coach, prépa, player_level ≠ « aucun ») ; jamais le lecteur.
   Aucune écriture directe : les fonctions seulement.

   Retour arrière :
     drop function if exists public.soreness_set(integer, text[]), public.my_soreness_today(),
       public.soreness_alert_seen(bigint), public.soreness_notifs_take(), public.soreness_can_read(bigint);
     drop table if exists public.soreness_alerts, public.player_soreness;
   ============================================================ */
begin;

create table if not exists public.player_soreness (
  id          bigint generated always as identity primary key,
  club_id     bigint not null references public.clubs on delete cascade,
  player_id   bigint not null references public.players on delete cascade,
  jour        date not null,
  niveau      smallint not null check (niveau between 0 and 10),
  muscles     text[] not null default '{}',
  session_id  bigint references public.sessions on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (player_id, jour)
);
alter table public.player_soreness drop constraint if exists player_soreness_muscles_check;
alter table public.player_soreness add constraint player_soreness_muscles_check check (
  muscles <@ array['ischios', 'quadriceps', 'adducteurs', 'abducteurs', 'mollets', 'pectoraux', 'dorsaux', 'abdominaux', 'biceps', 'triceps']
  and (niveau = 0) = (cardinality(muscles) = 0));
create index if not exists player_soreness_club_jour_idx on public.player_soreness (club_id, jour);

create table if not exists public.soreness_alerts (
  id          bigint generated always as identity primary key,
  club_id     bigint not null references public.clubs on delete cascade,
  player_id   bigint not null references public.players on delete cascade,
  jour        date not null,
  muscles     text[] not null,
  created_at  timestamptz not null default now(),
  pushed_at   timestamptz,
  vu_par      uuid references auth.users on delete set null,
  vu_at       timestamptz,
  unique (player_id, jour)
);
create index if not exists soreness_alerts_open_idx on public.soreness_alerts (club_id) where vu_at is null;

-- Qui lit : le joueur (ses réponses), le staff qui le suit. Pas le lecteur (has_role l'exclut).
create or replace function public.soreness_can_read(p_player bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.players p where p.id = p_player and p.auth_user_id = auth.uid())
      or (public.has_role('admin', 'coach', 'prepa') and public.player_level(p_player) <> 'aucun');
$$;
revoke all on function public.soreness_can_read(bigint) from public, anon;
grant execute on function public.soreness_can_read(bigint) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['player_soreness', 'soreness_alerts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (club_id = (select public.my_club_id()) and public.soreness_can_read(player_id))', t || '_read', t);
    -- Lecteur (lmfc_v22.sql) : aucune écriture ; et ni lecture, données de santé (comme lmfc_v23.sql).
    execute format('drop policy if exists lecteur_no_read on public.%I', t);
    execute format('create policy lecteur_no_read on public.%I as restrictive for select to authenticated using (not (select public.is_lecteur()))', t);
    execute format('drop policy if exists lecteur_no_insert on public.%I', t);
    execute format('create policy lecteur_no_insert on public.%I as restrictive for insert to authenticated with check (not (select public.is_lecteur()))', t);
    execute format('drop policy if exists lecteur_no_update on public.%I', t);
    execute format('create policy lecteur_no_update on public.%I as restrictive for update to authenticated using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()))', t);
    execute format('drop policy if exists lecteur_no_delete on public.%I', t);
    execute format('create policy lecteur_no_delete on public.%I as restrictive for delete to authenticated using (not (select public.is_lecteur()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Réponse du joueur connecté, pour aujourd'hui. Renvoie { niveau, muscles, alerte }.
create or replace function public.soreness_set(p_niveau integer, p_muscles text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me bigint; v_club bigint; v_session bigint; v_muscles text[]; v_alert text[];
  v_ok constant text[] := array['ischios', 'quadriceps', 'adducteurs', 'abducteurs', 'mollets', 'pectoraux', 'dorsaux', 'abdominaux', 'biceps', 'triceps'];
begin
  if p_niveau is null or p_niveau not between 0 and 10 then
    raise exception 'Le niveau de courbature va de 0 à 10.' using errcode = '22023';
  end if;
  select p.id, p.club_id into v_me, v_club from public.players p
   where p.auth_user_id = auth.uid() and public.has_role('joueur') limit 1;
  if v_me is null then raise exception 'Questionnaire réservé aux joueurs.' using errcode = '42501'; end if;
  select s.id into v_session from public.sessions s
   where s.club_id = v_club and s.date_seance = current_date and public.player_session_ok(v_me, s.id)
   order by s.heure nulls last limit 1;
  if v_session is null then
    raise exception 'Pas de séance aujourd’hui : le questionnaire s’ouvre les jours de séance.' using errcode = '42501';
  end if;
  v_muscles := case when p_niveau = 0 then '{}'::text[]
    else (select coalesce(array_agg(distinct m order by m), '{}') from unnest(coalesce(p_muscles, '{}')) m) end;
  if not v_muscles <@ v_ok then raise exception 'Muscle inconnu.' using errcode = '22023'; end if;
  if p_niveau > 0 and cardinality(v_muscles) = 0 then
    raise exception 'Indique au moins un muscle courbaturé.' using errcode = '22023';
  end if;

  insert into public.player_soreness (club_id, player_id, jour, niveau, muscles, session_id)
  values (v_club, v_me, current_date, p_niveau, v_muscles, v_session)
  on conflict (player_id, jour) do update
    set niveau = excluded.niveau, muscles = excluded.muscles, session_id = excluded.session_id, updated_at = now();

  -- Série de 3 jours de calendrier : le muscle aussi hier et avant-hier.
  select array_agg(m order by m) into v_alert from unnest(v_muscles) m
   where exists (select 1 from public.player_soreness x where x.player_id = v_me and x.jour = current_date - 1 and m = any(x.muscles))
     and exists (select 1 from public.player_soreness x where x.player_id = v_me and x.jour = current_date - 2 and m = any(x.muscles));
  if v_alert is not null then
    insert into public.soreness_alerts (club_id, player_id, jour, muscles) values (v_club, v_me, current_date, v_alert)
    on conflict (player_id, jour) do update set muscles = excluded.muscles;
  else
    -- Réponse corrigée le jour même : l'alerte pas encore vue disparaît.
    delete from public.soreness_alerts where player_id = v_me and jour = current_date and vu_at is null;
  end if;
  return jsonb_build_object('niveau', p_niveau, 'muscles', to_jsonb(v_muscles), 'alerte', v_alert is not null);
end $$;
revoke all on function public.soreness_set(integer, text[]) from public, anon;
grant execute on function public.soreness_set(integer, text[]) to authenticated;

-- Accueil du joueur : la séance du jour (s'il y en a une) et sa réponse.
create or replace function public.my_soreness_today()
returns table (session_id bigint, titre text, heure time, niveau smallint, muscles text[])
language sql stable security definer set search_path = public as $$
  select s.id, s.titre, s.heure, ps.niveau, ps.muscles
    from public.players p
    join lateral (select x.id, x.titre, x.heure from public.sessions x
                   where x.club_id = p.club_id and x.date_seance = current_date and public.player_session_ok(p.id, x.id)
                   order by x.heure nulls last limit 1) s on true
    left join public.player_soreness ps on ps.player_id = p.id and ps.jour = current_date
   where p.auth_user_id = auth.uid() and public.has_role('joueur')
   limit 1;
$$;
revoke all on function public.my_soreness_today() from public, anon;
grant execute on function public.my_soreness_today() to authenticated;

-- Le staff qui suit le joueur marque l'alerte « Vu ».
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
revoke all on function public.soreness_alert_seen(bigint) from public, anon;
grant execute on function public.soreness_alert_seen(bigint) to authenticated;

-- Appelée par le Worker avec le jeton du joueur : ses alertes du jour pas encore envoyées,
-- avec les appareils du staff qui le suit (admin, coachs, prépas), marquées envoyées.
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
revoke all on function public.soreness_notifs_take() from public, anon;
grant execute on function public.soreness_notifs_take() to authenticated;

commit;
