/* Retour arrière de lmfc_v59.sql (relances RPE, avis et vidéos). Rejouable.
   Efface du journal les relances d'avis et de vidéos (elles n'ont pas de place dans
   le journal d'avant) et l'heure d'ouverture des notifications ; les relances RPE
   restent. rpe_remind_take reprend sa définition de lmfc_v50.sql, à l'identique. */
begin;
drop function if exists public.remind_take(text, bigint, bigint[], boolean);
drop function if exists public.remind_opened(bigint);
drop function if exists public.rpe_remind_take(text, bigint, bigint[], boolean);
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rpe_reminders' and column_name = 'kind') then
    execute 'delete from public.rpe_reminders where kind <> ''rpe''';
  end if;
end $$;
CREATE OR REPLACE FUNCTION public.rpe_remind_take(p_kind text, p_id bigint, p_players bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club bigint; v_team bigint; v_by uuid; v_date date; v_heure time; v_titre text;
  v_p bigint; v_user uuid; v_subs jsonb; v_rid bigint; v_why text;
  v_msgs jsonb := '[]'; v_skip jsonb := '[]';
begin
  if p_kind not in ('seance', 'match') then raise exception 'Type inconnu.' using errcode = '22023'; end if;
  if coalesce(cardinality(p_players), 0) not between 1 and 12 then
    raise exception 'De 1 à 12 joueurs par envoi.' using errcode = '22023';
  end if;
  if not public.has_role('admin', 'coach', 'prepa', 'analyste') or public.is_lecteur() then
    raise exception 'Relance réservée au staff.' using errcode = '42501';
  end if;
  if p_kind = 'seance' then
    select s.club_id, s.date_seance, s.heure, s.titre into v_club, v_date, v_heure, v_titre from public.sessions s where s.id = p_id;
    if v_club is distinct from public.my_club_id() or public.session_access_level(p_id) = 'aucun' then
      raise exception 'Séance introuvable.' using errcode = '42501';
    end if;
  else
    select m.club_id, m.team_id, m.created_by, m.date_match, m.heure, 'Match – ' || m.adversaire
      into v_club, v_team, v_by, v_date, v_heure, v_titre from public.matches m where m.id = p_id;
    if v_club is distinct from public.my_club_id() or not (public.team_level(v_team) <> 'aucun' or v_by = auth.uid()) then
      raise exception 'Match introuvable.' using errcode = '42501';
    end if;
  end if;
  if not public.rpe_open(v_date) then
    raise exception 'La saisie est fermée (jusqu’à 14 jours après) : le joueur ne peut plus répondre.' using errcode = '22023';
  end if;
  -- Deux envois simultanés pour la même séance passent l'un après l'autre : pas de doublon.
  perform pg_advisory_xact_lock(hashtext('rpe_remind:' || p_kind || ':' || p_id));

  foreach v_p in array (select array_agg(distinct x) from unnest(p_players) x) loop
    select p.auth_user_id into v_user from public.players p where p.id = v_p and p.club_id = v_club;
    v_why := case
      when public.player_level(v_p) <> 'modification' then 'non_suivi'
      when not (case p_kind when 'seance' then public.player_session_ok(v_p, p_id) else public.player_match_rpe_ok(v_p, p_id) end) then 'non_concerne'
      when exists (select 1 from public.session_rpe r where p_kind = 'seance' and r.session_id = p_id and r.player_id = v_p)
        or exists (select 1 from public.match_rpe r where p_kind = 'match' and r.match_id = p_id and r.player_id = v_p) then 'deja_repondu'
      when v_user is null then 'sans_compte'
      when exists (select 1 from public.rpe_reminders r
                    where r.player_id = v_p and r.sent_at > now() - interval '12 hours' and coalesce(r.delivered, 1) > 0
                      and (case p_kind when 'seance' then r.session_id else r.match_id end) = p_id) then 'deja_relance'
    end;
    if v_why is null then
      select jsonb_agg(jsonb_build_object('id', ps.id, 'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth))
        into v_subs
        from (select * from public.push_subscriptions ps where ps.user_id = v_user order by ps.created_at desc limit 3) ps;
      if v_subs is null then v_why := 'sans_appareil'; end if;
    end if;
    if v_why is not null then
      v_skip := v_skip || jsonb_build_object('player_id', v_p, 'reason', v_why);
      continue;
    end if;
    insert into public.rpe_reminders (club_id, session_id, match_id, player_id, sent_by, devices)
    values (v_club, case when p_kind = 'seance' then p_id end, case when p_kind = 'match' then p_id end, v_p, auth.uid(), jsonb_array_length(v_subs))
    returning id into v_rid;
    v_msgs := v_msgs || jsonb_build_object('reminder', v_rid, 'player_id', v_p, 'subs', v_subs,
      'title', 'Note ton effort (RPE)',
      'body', left(v_titre || ' du ' || to_char(v_date, 'DD/MM') || coalesce(' à ' || to_char(v_heure, 'HH24:MI'), '')
                   || ' : ton RPE n’est pas encore renseigné. Touche pour répondre.', 300),
      'url', 'mon-espace.html?rpe=' || case p_kind when 'seance' then 's' else 'm' end || p_id);
  end loop;
  return jsonb_build_object('messages', v_msgs, 'skipped', v_skip);
end $function$
;
revoke all on function public.rpe_remind_take(text, bigint, bigint[]) from public, anon;
grant execute on function public.rpe_remind_take(text, bigint, bigint[]) to authenticated;

alter table public.rpe_reminders drop constraint if exists rpe_reminders_one_target;
alter table public.rpe_reminders drop constraint if exists rpe_reminders_kind_check;
drop index if exists public.rpe_reminders_kind_idx;
alter table public.rpe_reminders drop column if exists opened_at;
alter table public.rpe_reminders drop column if exists kind;
alter table public.rpe_reminders add constraint rpe_reminders_one_target check (num_nonnulls(session_id, match_id) = 1);
commit;
