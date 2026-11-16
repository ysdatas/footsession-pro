/* ============================================================
   LMFC Performance — lmfc_v59.sql (n° 77) : relances du staff, RPE, avis et vidéos
   À exécuter après lmfc_v58.sql. Rejouable et transactionnelle.
   Retour arrière : lmfc_v59_retour.sql (efface les relances d'avis et de vidéos du journal).

   Le journal des relances RPE (rpe_reminders, lmfc_v50.sql) sert à toutes les relances :
     - rpe_reminders.kind : 'rpe' (séance ou match), 'avis' (avis après le match),
       'video' (vidéos envoyées pas encore regardées) ;
     - rpe_reminders.opened_at : le joueur a ouvert la notification (remind_opened,
       appelé par la page que la notification ouvre : lien « &rappel=… ») ;
     - statut de délivrance : delivered (appareils atteints, Worker) ; null = en
       cours, 0 = non livrée. Une relance arrivée nulle part ne bloque pas la suivante.
   remind_take(sorte, id, joueurs, apercu) : relances d'avis (id = le match) et de
   vidéos (id = null), comme rpe_remind_take :
     - la base choisit : joueur suivi, concerné (avis : sur la feuille et entré en
       jeu, ou de l'équipe sans feuille ; jour du match à 30 jours après), pas déjà à
       jour (avis donné, toutes les vidéos regardées : video_watch_status), compte
       lié, appareil abonné, pas déjà relancé pour la même chose depuis 12 h ;
     - apercu = true : rien n'est écrit ni envoyé ; rend les joueurs qui seraient
       relancés (ready) et pourquoi les autres ne le seraient pas (skipped) : le
       nombre de destinataires s'affiche avant l'envoi groupé (300 joueurs au plus) ;
     - sinon : trace chaque relance et rend les messages avec les appareils du
       joueur (3 au plus), pour le Worker (/api/push/remind, 12 joueurs par appel).
   rpe_remind_take ne compte que les relances RPE pour éviter un doublon, met
   aussi l'identifiant de la relance dans le lien, et a le même aperçu.
   ============================================================ */
begin;

alter table public.rpe_reminders add column if not exists kind text not null default 'rpe';
alter table public.rpe_reminders add column if not exists opened_at timestamptz;
alter table public.rpe_reminders drop constraint if exists rpe_reminders_kind_check;
alter table public.rpe_reminders add constraint rpe_reminders_kind_check check (kind in ('rpe', 'avis', 'video'));
alter table public.rpe_reminders drop constraint if exists rpe_reminders_one_target;
alter table public.rpe_reminders add constraint rpe_reminders_one_target check (
  (kind = 'rpe' and num_nonnulls(session_id, match_id) = 1)
  or (kind = 'avis' and session_id is null and match_id is not null)
  or (kind = 'video' and session_id is null and match_id is null));
create index if not exists rpe_reminders_kind_idx on public.rpe_reminders (kind, player_id, sent_at desc);

-- Relance RPE (lmfc_v50.sql) : seulement ses relances RPE pour le doublon ; identifiant dans le lien ;
-- aperçu (p_preview) comme remind_take. Nouvelle signature : l'ancienne est retirée.
drop function if exists public.rpe_remind_take(text, bigint, bigint[]);
create or replace function public.rpe_remind_take(p_kind text, p_id bigint, p_players bigint[], p_preview boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_club bigint; v_team bigint; v_by uuid; v_date date; v_heure time; v_titre text;
  v_p bigint; v_user uuid; v_subs jsonb; v_rid bigint; v_why text;
  v_msgs jsonb := '[]'; v_skip jsonb := '[]'; v_ready jsonb := '[]';
begin
  if p_kind not in ('seance', 'match') then raise exception 'Type inconnu.' using errcode = '22023'; end if;
  if coalesce(cardinality(p_players), 0) not between 1 and (case when p_preview then 300 else 12 end) then
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
  if not p_preview then perform pg_advisory_xact_lock(hashtext('rpe_remind:' || p_kind || ':' || p_id)); end if;

  foreach v_p in array (select array_agg(distinct x) from unnest(p_players) x) loop
    select p.auth_user_id into v_user from public.players p where p.id = v_p and p.club_id = v_club;
    v_why := case
      when public.player_level(v_p) <> 'modification' then 'non_suivi'
      when not (case p_kind when 'seance' then public.player_session_ok(v_p, p_id) else public.player_match_rpe_ok(v_p, p_id) end) then 'non_concerne'
      when exists (select 1 from public.session_rpe r where p_kind = 'seance' and r.session_id = p_id and r.player_id = v_p)
        or exists (select 1 from public.match_rpe r where p_kind = 'match' and r.match_id = p_id and r.player_id = v_p) then 'deja_repondu'
      when v_user is null then 'sans_compte'
      when exists (select 1 from public.rpe_reminders r
                    where r.kind = 'rpe' and r.player_id = v_p and r.sent_at > now() - interval '12 hours' and coalesce(r.delivered, 1) > 0
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
    if p_preview then v_ready := v_ready || to_jsonb(v_p); continue; end if;
    insert into public.rpe_reminders (club_id, session_id, match_id, player_id, sent_by, devices)
    values (v_club, case when p_kind = 'seance' then p_id end, case when p_kind = 'match' then p_id end, v_p, auth.uid(), jsonb_array_length(v_subs))
    returning id into v_rid;
    v_msgs := v_msgs || jsonb_build_object('reminder', v_rid, 'player_id', v_p, 'subs', v_subs,
      'title', 'Note ton effort (RPE)',
      'body', left(v_titre || ' du ' || to_char(v_date, 'DD/MM') || coalesce(' à ' || to_char(v_heure, 'HH24:MI'), '')
                   || ' : ton RPE n’est pas encore renseigné. Touche pour répondre.', 300),
      'url', 'mon-espace.html?rpe=' || case p_kind when 'seance' then 's' else 'm' end || p_id || '&rappel=' || v_rid);
  end loop;
  return jsonb_build_object('messages', v_msgs, 'skipped', v_skip, 'ready', v_ready);
end $$;
revoke all on function public.rpe_remind_take(text, bigint, bigint[], boolean) from public, anon;
grant execute on function public.rpe_remind_take(text, bigint, bigint[], boolean) to authenticated;


/* p_kind : 'avis' (p_id : le match) | 'video' (p_id : null) ; p_players : 12 au plus par envoi, 300 en aperçu.
   → { messages: [{ reminder, player_id, title, body, url, subs }], skipped: [{ player_id, reason }], ready: [player_id] }
   reason : non_suivi | non_concerne | deja_repondu | a_jour | sans_compte | deja_relance | sans_appareil */
create or replace function public.remind_take(p_kind text, p_id bigint, p_players bigint[], p_preview boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_club bigint; v_team bigint; v_by uuid; v_date date; v_titre text;
  v_p bigint; v_user uuid; v_subs jsonb; v_rid bigint; v_why text; v_left integer;
  v_msgs jsonb := '[]'; v_skip jsonb := '[]'; v_ready jsonb := '[]';
begin
  if p_kind not in ('avis', 'video') then raise exception 'Type inconnu.' using errcode = '22023'; end if;
  if coalesce(cardinality(p_players), 0) not between 1 and (case when p_preview then 300 else 12 end) then
    raise exception 'De 1 à 12 joueurs par envoi.' using errcode = '22023';
  end if;
  if public.is_lecteur() or not (case p_kind when 'avis' then public.has_role('admin', 'coach', 'prepa', 'analyste')
                                              else public.has_role('admin', 'coach', 'analyste') end) then
    raise exception 'Relance réservée au staff.' using errcode = '42501';
  end if;
  if p_kind = 'avis' then
    select m.club_id, m.team_id, m.created_by, m.date_match, 'Match – ' || m.adversaire
      into v_club, v_team, v_by, v_date, v_titre from public.matches m where m.id = p_id;
    if v_club is distinct from public.my_club_id() or not (public.team_level(v_team) <> 'aucun' or v_by = auth.uid()) then
      raise exception 'Match introuvable.' using errcode = '42501';
    end if;
    if v_date > current_date or v_date < current_date - 30 then
      raise exception 'L’avis s’ouvre le jour du match et se ferme 30 jours après : le joueur ne peut pas répondre.' using errcode = '22023';
    end if;
  else
    if p_id is not null then raise exception 'Relance des vidéos : sans identifiant.' using errcode = '22023'; end if;
    v_club := public.my_club_id();
  end if;
  -- Deux envois simultanés pour la même chose passent l'un après l'autre : pas de doublon.
  if not p_preview then perform pg_advisory_xact_lock(hashtext('remind:' || p_kind || ':' || coalesce(p_id, 0))); end if;

  foreach v_p in array (select array_agg(distinct x) from unnest(p_players) x) loop
    select p.auth_user_id into v_user from public.players p where p.id = v_p and p.club_id = v_club;
    v_left := null;
    if p_kind = 'video' then
      select count(*) filter (where x.statut <> 'vue') into v_left from (
        select public.video_watch_status(coalesce(sum(w.watched_seconds), 0), v.duree_sec, bool_or(w.completed), count(w.id)::int) statut
          from public.player_videos v left join public.video_views w on w.video_id = v.id and w.player_id = v.player_id
         where v.player_id = v_p group by v.id) x;
    end if;
    v_why := case
      when public.player_level(v_p) <> 'modification' then 'non_suivi'
      when p_kind = 'avis' and not public.player_match_rpe_ok(v_p, p_id) then 'non_concerne'
      when p_kind = 'avis' and exists (select 1 from public.match_feedback f where f.match_id = p_id and f.player_id = v_p
                                          and (f.individuel is not null or f.collectif is not null)) then 'deja_repondu'
      when p_kind = 'video' and coalesce(v_left, 0) = 0 then 'a_jour'
      when v_user is null then 'sans_compte'
      when exists (select 1 from public.rpe_reminders r
                    where r.kind = p_kind and r.player_id = v_p and r.match_id is not distinct from (case when p_kind = 'avis' then p_id end)
                      and r.sent_at > now() - interval '12 hours' and coalesce(r.delivered, 1) > 0) then 'deja_relance'
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
    if p_preview then v_ready := v_ready || to_jsonb(v_p); continue; end if;
    insert into public.rpe_reminders (club_id, kind, match_id, player_id, sent_by, devices)
    values (v_club, p_kind, case when p_kind = 'avis' then p_id end, v_p, auth.uid(), jsonb_array_length(v_subs))
    returning id into v_rid;
    v_msgs := v_msgs || case p_kind
      when 'avis' then jsonb_build_object('reminder', v_rid, 'player_id', v_p, 'subs', v_subs,
        'title', 'Ton avis sur le match',
        'body', left(v_titre || ' du ' || to_char(v_date, 'DD/MM') || ' : ton avis n’est pas encore donné. Touche pour répondre.', 300),
        'url', 'mon-espace.html?avis=' || p_id || '&rappel=' || v_rid)
      else jsonb_build_object('reminder', v_rid, 'player_id', v_p, 'subs', v_subs,
        'title', 'Vidéos à regarder',
        'body', v_left || case when v_left > 1 then ' vidéos envoyées par le staff ne sont' else ' vidéo envoyée par le staff n’est' end
                || ' pas encore regardée' || case when v_left > 1 then 's' else '' end || '. Touche pour les voir.',
        'url', 'mes-videos.html?rappel=' || v_rid) end;
  end loop;
  return jsonb_build_object('messages', v_msgs, 'skipped', v_skip, 'ready', v_ready);
end $$;
revoke all on function public.remind_take(text, bigint, bigint[], boolean) from public, anon;
grant execute on function public.remind_take(text, bigint, bigint[], boolean) to authenticated;

-- Le joueur ouvre la notification : la page ouverte (lien « &rappel=… ») le note, pour ses relances seulement.
create or replace function public.remind_opened(p_id bigint)
returns void language sql security definer set search_path = public as $$
  update public.rpe_reminders r set opened_at = now()
   where r.id = p_id and r.opened_at is null
     and r.player_id in (select p.id from public.players p where p.auth_user_id = auth.uid());
$$;
revoke all on function public.remind_opened(bigint) from public, anon;
grant execute on function public.remind_opened(bigint) to authenticated;

commit;
