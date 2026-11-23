/* ============================================================
   LMFC Performance — lmfc_v68.sql : courbatures, Fessiers et Psoas
   À exécuter après lmfc_v67.sql. Rejouable et transactionnelle.

   Le questionnaire de courbatures (lmfc_v35.sql) propose deux muscles de plus, au bas
   du corps : fessiers et psoas. Les dix d'avant restent (réponses et alertes intactes).
   - contrainte player_soreness_muscles_check : la liste des muscles connus ;
   - soreness_set() : même fonction, liste élargie ;
   - soreness_muscles() : la liste, témoin de la migration (API publique : 42501 si passée,
     PGRST202 sinon).
   Retour arrière : lmfc_v68_retour.sql (refusé tant qu'une réponse cite fessiers ou psoas).
   ============================================================ */
begin;

alter table public.player_soreness drop constraint if exists player_soreness_muscles_check;
alter table public.player_soreness add constraint player_soreness_muscles_check check (
  muscles <@ array['ischios', 'quadriceps', 'fessiers', 'adducteurs', 'abducteurs', 'mollets', 'psoas', 'pectoraux', 'dorsaux', 'abdominaux', 'biceps', 'triceps']
  and (niveau = 0) = (cardinality(muscles) = 0));

create or replace function public.soreness_set(p_niveau integer, p_muscles text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me bigint; v_club bigint; v_session bigint; v_muscles text[]; v_alert text[];
  v_ok constant text[] := array['ischios', 'quadriceps', 'fessiers', 'adducteurs', 'abducteurs', 'mollets', 'psoas', 'pectoraux', 'dorsaux', 'abdominaux', 'biceps', 'triceps'];
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

create or replace function public.soreness_muscles()
returns text[] language sql immutable set search_path = public as $$
  select array['ischios', 'quadriceps', 'fessiers', 'adducteurs', 'abducteurs', 'mollets', 'psoas', 'pectoraux', 'dorsaux', 'abdominaux', 'biceps', 'triceps']
$$;
revoke all on function public.soreness_muscles() from public, anon;
grant execute on function public.soreness_muscles() to authenticated;

commit;
