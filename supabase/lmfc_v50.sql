/* ============================================================
   LMFC Performance — lmfc_v50.sql : relances RPE (Suivi RPE).
   Le staff relance un joueur, ou toute l'équipe, qui n'a pas encore
   noté son effort d'une séance ou d'un match. La base décide de tout ;
   le Worker (/api/push/rpe) ne fait que livrer :
     - rpe_remind_take(kind, id, joueurs) : droits de l'appelant (ceux
       de la correction : rpe_set, match_rpe_set), joueur concerné
       (player_session_ok, player_match_rpe_ok), saisie encore ouverte
       (rpe_open), pas déjà répondu, compte lié, pas déjà relancé depuis
       12 h ; trace chaque relance et rend les messages avec les
       appareils du joueur (3 au plus) ;
     - rpe_remind_done(lignes) : le Worker note combien d'appareils ont
       reçu. Une relance arrivée nulle part (0) ne bloque pas la suivante.
   rpe_reminders : qui a relancé qui, quand, pour quelle séance ou quel
   match ; lu par le staff qui suit le joueur, jamais écrit directement.
   Journal seulement : supprimé avec sa séance, son match ou son joueur.
   Après lmfc_v42.sql (analyste). Rejouable. Retour : lmfc_v50_retour.sql.
   ============================================================ */
begin;

create table if not exists public.rpe_reminders (
  id         bigint generated always as identity primary key,
  club_id    bigint not null references public.clubs on delete cascade,
  session_id bigint references public.sessions on delete cascade,
  match_id   bigint references public.matches on delete cascade,
  player_id  bigint not null references public.players on delete cascade,
  sent_by    uuid not null,
  sent_at    timestamptz not null default now(),
  devices    integer not null,   -- appareils visés
  delivered  integer,            -- appareils atteints (Worker) ; null : livraison en cours
  constraint rpe_reminders_one_target check (num_nonnulls(session_id, match_id) = 1)
);
create index if not exists rpe_reminders_session_idx on public.rpe_reminders (session_id, player_id) where session_id is not null;
create index if not exists rpe_reminders_match_idx on public.rpe_reminders (match_id, player_id) where match_id is not null;

alter table public.rpe_reminders enable row level security;
drop policy if exists rpe_reminders_read on public.rpe_reminders;
create policy rpe_reminders_read on public.rpe_reminders for select using (
  club_id = (select public.my_club_id())
  and (select public.has_role('admin', 'coach', 'prepa', 'analyste'))
  and public.player_level(player_id) <> 'aucun');
-- Lecteur : aucune écriture (lmfc_v22.sql) ; de toute façon, aucun droit direct d'écriture.
drop policy if exists lecteur_no_insert on public.rpe_reminders;
drop policy if exists lecteur_no_update on public.rpe_reminders;
drop policy if exists lecteur_no_delete on public.rpe_reminders;
create policy lecteur_no_insert on public.rpe_reminders as restrictive for insert to authenticated
  with check (not (select public.is_lecteur()));
create policy lecteur_no_update on public.rpe_reminders as restrictive for update to authenticated
  using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()));
create policy lecteur_no_delete on public.rpe_reminders as restrictive for delete to authenticated
  using (not (select public.is_lecteur()));
revoke all on public.rpe_reminders from anon, authenticated;
grant select on public.rpe_reminders to authenticated;

/* p_kind : 'seance' | 'match' ; p_players : 12 au plus par appel (limite du Worker gratuit).
   → { messages: [{ reminder, player_id, title, body, url, subs }], skipped: [{ player_id, reason }] }
   reason : non_suivi | non_concerne | deja_repondu | sans_compte | deja_relance | sans_appareil */
create or replace function public.rpe_remind_take(p_kind text, p_id bigint, p_players bigint[])
returns jsonb language plpgsql security definer set search_path = public as $$
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
end $$;

/* p_rows : [{ id, delivered }] ; seulement ses relances encore en cours. */
create or replace function public.rpe_remind_done(p_rows jsonb)
returns void language sql security definer set search_path = public as $$
  update public.rpe_reminders r set delivered = greatest(0, (x->>'delivered')::int)
    from jsonb_array_elements(coalesce(p_rows, '[]')) x
   where r.id = (x->>'id')::bigint and r.sent_by = auth.uid() and r.delivered is null;
$$;

revoke all on function public.rpe_remind_take(text, bigint, bigint[]) from public, anon;
revoke all on function public.rpe_remind_done(jsonb) from public, anon;
grant execute on function public.rpe_remind_take(text, bigint, bigint[]) to authenticated;
grant execute on function public.rpe_remind_done(jsonb) to authenticated;

commit;
