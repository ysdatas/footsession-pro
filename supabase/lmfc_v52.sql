/* ============================================================
   LMFC Performance — lmfc_v52.sql (n° 70) : fusionner deux séances
   À exécuter après lmfc_v51.sql. Rejouable et transactionnelle.
   Retour arrière : lmfc_v52_retour.sql (refusé tant qu'une fusion est en place).

   Deux séances saisies chacune de leur côté (U15 et U14 le même jour) n'en
   font qu'une, à la demande et jamais d'office :
     session_merge(source, cible, false) : récapitulatif, rien n'est modifié ;
     session_merge(source, cible, true)  : la fusion, en une transaction.
   Il faut pouvoir modifier les deux séances.

   Ce que reçoit la séance cible (celle qu'on garde) :
     - les équipes de la source, en équipes associées (lmfc_v51.sql) : leur
       staff et leurs joueurs gardent la séance ;
     - présences, bilans, RPE et droits nominatifs de la source, pour les
       joueurs (ou membres du staff) qu'elle n'a pas déjà ; pour les autres,
       la ligne de la cible reste et celle de la source est mise de côté dans
       le journal (rien ne compte deux fois) ;
     - tous les commentaires, les procédés (à la suite des siens, avec leurs
       schémas), les relances RPE, les courbatures et imports GPS rattachés,
       les réponses aux questions ajoutées (sauf doublon) ;
     - l'heure, le lieu, le principe de jeu, la RPE attendue et le commentaire
       général de la source, seulement là où les siens sont vides.
   La séance source n'est jamais supprimée : elle reste, vide, marquée
   « fusionnée dans » (sessions.fusionnee_dans, fusionnee_le), hors des listes
   des joueurs, du calendrier et des statistiques. La supprimer reste un geste
   à part (corbeille).

   session_merge_undo(source) défait la fusion : les lignes déplacées
   reviennent (avec ce qui a été modifié depuis), les lignes mises de côté
   sont recréées, les équipes et champs ajoutés à la cible sont retirés s'ils
   n'ont pas changé. Ce qui a été ajouté à la cible après la fusion y reste.
   Dans l'ordre inverse des fusions : une séance cible elle-même fusionnée
   ensuite doit d'abord être défaite.

   session_merges : le journal (qui, quand, quoi). Écrit et lu par ces deux
   fonctions ; l'admin du club peut le lire. sessions.fusionnee_dans et
   fusionnee_le ne s'écrivent que par elles (guard_session_access).
   ============================================================ */
begin;

alter table public.sessions add column if not exists fusionnee_dans bigint;
alter table public.sessions add column if not exists fusionnee_le timestamptz;
alter table public.sessions drop constraint if exists sessions_fusion_check;
alter table public.sessions add constraint sessions_fusion_check
  check (fusionnee_dans is distinct from id and (fusionnee_dans is null) = (fusionnee_le is null));

create table if not exists public.session_merges (
  id         bigint generated always as identity primary key,
  club_id    bigint not null references public.clubs on delete cascade,
  source_id  bigint not null references public.sessions on delete cascade,
  target_id  bigint not null,   -- sans clé étrangère : la cible peut passer par la corbeille et revenir
  merged_by  uuid not null,
  merged_at  timestamptz not null default now(),
  undone_by  uuid,
  undone_at  timestamptz,
  plan       jsonb not null     -- moved (lignes déplacées), kept (mises de côté), filled, teams, team_id, offset
);
create unique index if not exists session_merges_active_uq on public.session_merges (source_id) where undone_at is null;
alter table public.session_merges enable row level security;
drop policy if exists session_merges_admin_read on public.session_merges;
create policy session_merges_admin_read on public.session_merges for select
  using (club_id = (select public.my_club_id()) and (select public.is_club_admin()));
drop policy if exists lecteur_no_insert on public.session_merges;
drop policy if exists lecteur_no_update on public.session_merges;
drop policy if exists lecteur_no_delete on public.session_merges;
create policy lecteur_no_insert on public.session_merges as restrictive for insert to authenticated
  with check (not (select public.is_lecteur()));
create policy lecteur_no_update on public.session_merges as restrictive for update to authenticated
  using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()));
create policy lecteur_no_delete on public.session_merges as restrictive for delete to authenticated
  using (not (select public.is_lecteur()));

-- ------------------------------------------------------------
-- Garde de la séance (lmfc_v51.sql) : la marque de fusion ne s'écrit que par les fonctions.
-- ------------------------------------------------------------
create or replace function public.guard_session_access()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_old  bigint[] := '{}';
  v_new  bigint[] := array_remove(array[new.team_id] || coalesce(new.other_team_ids, '{}'), null);
  v_team bigint;
begin
  if auth.uid() is null then return new; end if;   -- SQL Editor, tâches serveur
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    if (new.acces is distinct from old.acces or new.created_by is distinct from old.created_by)
       and not (old.created_by = auth.uid() or public.is_club_admin()) then
      new.acces := old.acces;
      new.created_by := old.created_by;
    end if;
    v_old := array_remove(array[old.team_id] || coalesce(old.other_team_ids, '{}'), null);
  end if;
  if public.has_role('analyste') then new.acces := 'equipe'; end if;
  -- Corbeille, suppression d'une équipe, fusion : les fonctions de la base passent.
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    new.fusionnee_dans := null; new.fusionnee_le := null;
  else
    new.fusionnee_dans := old.fusionnee_dans; new.fusionnee_le := old.fusionnee_le;
  end if;
  foreach v_team in array v_new loop
    if not v_team = any(v_old) and public.team_level(v_team) <> 'modification' then
      raise exception 'Cette séance ne peut être rangée que dans une de vos équipes.' using errcode = '42501';
    end if;
  end loop;
  if tg_op = 'UPDATE' and not (old.created_by = auth.uid() or public.is_club_admin()) then
    foreach v_team in array v_old loop
      if not v_team = any(v_new) and public.team_level(v_team) <> 'modification' then
        raise exception 'Seul le staff de l''équipe « % » peut la retirer de cette séance.',
          (select t.nom from public.teams t where t.id = v_team) using errcode = '42501';
      end if;
    end loop;
  end if;
  return new;
end; $$;

-- ------------------------------------------------------------
-- Une séance fusionnée n'est plus proposée aux joueurs, ni à la modification.
-- ------------------------------------------------------------
create or replace function public.player_session_ok(p_player bigint, p_session bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sessions s join public.players p on p.id = p_player and p.club_id = s.club_id
     where s.id = p_session and s.fusionnee_dans is null
       and (array_remove(array[s.team_id] || s.other_team_ids, null) && array_remove(array[p.team_id] || coalesce(p.other_team_ids, '{}'), null)
            or exists (select 1 from public.attendance a where a.session_id = s.id and a.player_id = p.id and a.invite)
            or (s.team_id is null and not exists (select 1 from public.teams t where t.club_id = s.club_id))))
    and not exists (select 1 from public.attendance a where a.session_id = p_session and a.player_id = p_player and a.statut = 'non_concerne');
$$;
revoke all on function public.player_session_ok(bigint, bigint) from public, anon, authenticated;

create or replace function public.my_calendar(p_from date, p_to date)
returns table (kind text, id bigint, date_cal date, heure time, titre text, team_id bigint, lieu text, stade text,
               score_pour integer, score_contre integer, notes text)
language sql stable security definer set search_path = public as $$
  with me as (
    select p.id, p.club_id, array_remove(array[p.team_id] || coalesce(p.other_team_ids, '{}'), null) as teams,
           not exists (select 1 from public.teams t where t.club_id = p.club_id) as no_teams
      from public.players p
     where p.auth_user_id = auth.uid() and public.has_role('joueur') and p_to - p_from between 0 and 100
     limit 1)
  select 'seance', s.id, s.date_seance, s.heure, s.titre, s.team_id, s.lieu, null, null::int, null::int, null
    from public.sessions s, me
   where s.club_id = me.club_id and s.date_seance between p_from and p_to and s.fusionnee_dans is null
     and (array_remove(array[s.team_id] || s.other_team_ids, null) && me.teams or (me.no_teams and s.team_id is null)
          or exists (select 1 from public.attendance a where a.session_id = s.id and a.player_id = me.id and a.invite))
     and not exists (select 1 from public.attendance a where a.session_id = s.id and a.player_id = me.id and a.statut = 'non_concerne')
  union all
  select 'match', m.id, m.date_match, m.heure, m.adversaire, m.team_id, m.lieu, m.stade, m.score_pour, m.score_contre, null
    from public.matches m, me
   where m.club_id = me.club_id and m.date_match between p_from and p_to
     and (m.team_id = any(me.teams) or (me.no_teams and m.team_id is null)
          or exists (select 1 from public.match_players mp where mp.match_id = m.id and mp.player_id = me.id))
  union all
  select 'evenement', e.id, e.date_event, e.heure, e.titre, e.team_id, e.lieu, null, null, null, e.notes
    from public.club_events e, me
   where e.club_id = me.club_id and e.date_event between p_from and p_to and public.my_event_ok(e.id, e.team_id)
  order by 3, 4 nulls first, 1;
$$;
revoke all on function public.my_calendar(date, date) from public, anon;
grant execute on function public.my_calendar(date, date) to authenticated;

create or replace function public.my_editable_sessions(p_limit integer default 40)
returns table (id bigint, titre text, date_seance date) language sql stable set search_path = public as $$
  select s.id, s.titre, s.date_seance from public.sessions s
  where s.club_id = public.my_club_id() and s.fusionnee_dans is null
    and public.session_level(s.id, s.club_id, s.created_by, s.acces, s.team_id) = 'modification'
  order by s.date_seance desc, s.id desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

-- ------------------------------------------------------------
-- Fusion
-- ------------------------------------------------------------
create or replace function public.session_merge(p_source bigint, p_target bigint, p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.sessions%rowtype;
  t public.sessions%rowtype;
  v_add    bigint[];
  v_fill   jsonb;
  v_moved  jsonb := '{}';
  v_kept   jsonb := '{}';
  v_count  jsonb := '{}';
  v_ids    bigint[];
  v_rows   jsonb;
  v_offset integer;
  v_spec   text;
  v_tbl    text;
  v_col    text;
  v_id     bigint;
  v_joueurs jsonb;
begin
  if auth.uid() is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  select * into s from public.sessions where id = p_source for update;
  select * into t from public.sessions where id = p_target for update;
  if s.id is null or t.id is null or s.club_id is distinct from public.my_club_id() or t.club_id <> s.club_id then
    raise exception 'Séance introuvable.' using errcode = 'P0002';
  end if;
  if s.id = t.id then raise exception 'Choisissez deux séances différentes.' using errcode = '22023'; end if;
  if public.session_access_level(s.id) <> 'modification' or public.session_access_level(t.id) <> 'modification' then
    raise exception 'Il faut pouvoir modifier les deux séances pour les fusionner.' using errcode = '42501';
  end if;
  if s.fusionnee_dans is not null or t.fusionnee_dans is not null then
    raise exception 'Une de ces séances est déjà fusionnée dans une autre.' using errcode = '22023';
  end if;

  -- Compté avant tout déplacement : le récapitulatif décrit l'état d'avant la fusion.
  v_joueurs := jsonb_build_object(
    'source', (select count(*) from public.attendance a where a.session_id = s.id),
    'cible',  (select count(*) from public.attendance a where a.session_id = t.id),
    'total',  (select count(distinct a.player_id) from public.attendance a where a.session_id in (s.id, t.id)));
  v_add := array(select x from unnest(array_remove(array[s.team_id] || s.other_team_ids, null)) x
                  where not x = any(array_remove(array[t.team_id] || t.other_team_ids, null)) order by x);
  v_fill := jsonb_strip_nulls(jsonb_build_object(
    'heure',         case when t.heure is null then s.heure end,
    'lieu',          case when nullif(t.lieu, '') is null then nullif(s.lieu, '') end,
    'principes_jeu', case when nullif(t.principes_jeu, '') is null then nullif(s.principes_jeu, '') end,
    'rpe_attendue',  case when t.rpe_attendue is null then s.rpe_attendue end,
    'notes',         case when nullif(t.notes, '') is null then nullif(s.notes, '') end));

  -- Une ligne par joueur (ou membre du staff) : celle de la cible reste, celle de la source est mise de côté.
  foreach v_spec in array array['attendance:player_id', 'session_bilans:player_id', 'session_rpe:player_id', 'session_access:profile_id'] loop
    v_tbl := split_part(v_spec, ':', 1); v_col := split_part(v_spec, ':', 2);
    execute format('select coalesce(array_agg(a.id order by a.id), ''{}'') from public.%I a where a.session_id = $1
                      and not exists (select 1 from public.%I b where b.session_id = $2 and b.%I = a.%I)', v_tbl, v_tbl, v_col, v_col)
      into v_ids using s.id, t.id;
    execute format('select coalesce(jsonb_agg(to_jsonb(a) order by a.id), ''[]'') from public.%I a where a.session_id = $1
                      and exists (select 1 from public.%I b where b.session_id = $2 and b.%I = a.%I)', v_tbl, v_tbl, v_col, v_col)
      into v_rows using s.id, t.id;
    v_count := v_count || jsonb_build_object(v_tbl, jsonb_build_object('deplacees', cardinality(v_ids), 'doublons', jsonb_array_length(v_rows)));
    if p_apply then
      execute format('delete from public.%I where session_id = $1 and id in (select (x->>''id'')::bigint from jsonb_array_elements($2) x)', v_tbl)
        using s.id, v_rows;
      execute format('update public.%I set session_id = $1 where id = any($2)', v_tbl) using t.id, v_ids;
      v_moved := v_moved || jsonb_build_object(v_tbl, to_jsonb(v_ids));
      v_kept := v_kept || jsonb_build_object(v_tbl, v_rows);
    end if;
  end loop;

  -- Sans doublon possible : tout passe.
  foreach v_tbl in array array['session_comments', 'rpe_reminders', 'player_soreness', 'gps_imports'] loop
    execute format('select coalesce(array_agg(id order by id), ''{}'') from public.%I where session_id = $1', v_tbl) into v_ids using s.id;
    v_count := v_count || jsonb_build_object(v_tbl, cardinality(v_ids));
    if p_apply then
      execute format('update public.%I set session_id = $1 where id = any($2)', v_tbl) using t.id, v_ids;
      v_moved := v_moved || jsonb_build_object(v_tbl, to_jsonb(v_ids));
    end if;
  end loop;

  -- Procédés : à la suite de ceux de la cible, avec leurs schémas.
  v_offset := coalesce((select max(p.ordre) + 1 from public.procedures p where p.session_id = t.id), 0);
  v_ids := array(select p.id from public.procedures p where p.session_id = s.id order by p.ordre, p.id);
  v_count := v_count || jsonb_build_object('procedures', cardinality(v_ids));
  if p_apply then
    update public.procedures set session_id = t.id, ordre = ordre + v_offset where id = any(v_ids);
    v_moved := v_moved || jsonb_build_object('procedures', to_jsonb(v_ids));
  end if;

  -- Réponses aux questions ajoutées (lmfc_v47.sql) : leur occurrence suit la séance, sauf doublon.
  v_ids := array(select r.id from public.custom_form_responses r where r.occurrence = 's' || s.id
                   and not exists (select 1 from public.custom_form_responses x where x.form_version_id = r.form_version_id
                                     and x.player_id = r.player_id and x.occurrence = 's' || t.id));
  if p_apply then
    update public.custom_form_responses set occurrence = 's' || t.id where id = any(v_ids);
    v_moved := v_moved || jsonb_build_object('custom_form_responses', to_jsonb(v_ids));
  end if;

  if p_apply then
    update public.sessions set
      other_team_ids = other_team_ids || v_add,
      heure          = coalesce(heure, (v_fill->>'heure')::time),
      lieu           = coalesce(nullif(lieu, ''), v_fill->>'lieu'),
      principes_jeu  = coalesce(nullif(principes_jeu, ''), v_fill->>'principes_jeu'),
      rpe_attendue   = coalesce(rpe_attendue, (v_fill->>'rpe_attendue')::smallint),
      notes          = coalesce(nullif(notes, ''), v_fill->>'notes')
     where id = t.id;
    update public.sessions set fusionnee_dans = t.id, fusionnee_le = now() where id = s.id;
    insert into public.session_merges (club_id, source_id, target_id, merged_by, plan)
    values (s.club_id, s.id, t.id, auth.uid(), jsonb_build_object('moved', v_moved, 'kept', v_kept, 'filled', v_fill,
            'teams', to_jsonb(v_add), 'team_id', t.team_id, 'offset', v_offset))
    returning id into v_id;
  end if;

  return jsonb_build_object(
    'applique', p_apply, 'fusion_id', v_id,
    'source', jsonb_build_object('id', s.id, 'titre', s.titre, 'date', s.date_seance, 'heure', s.heure,
                                 'equipes', (select coalesce(jsonb_agg(tm.nom order by array_position(array[s.team_id] || s.other_team_ids, tm.id)), '[]')
                                               from public.teams tm where tm.id = any(array[s.team_id] || s.other_team_ids))),
    'cible', jsonb_build_object('id', t.id, 'titre', t.titre, 'date', t.date_seance, 'heure', t.heure,
                                'equipes', (select coalesce(jsonb_agg(tm.nom order by array_position(array[t.team_id] || t.other_team_ids, tm.id)), '[]')
                                              from public.teams tm where tm.id = any(array[t.team_id] || t.other_team_ids))),
    'meme_date', s.date_seance = t.date_seance,
    'joueurs', v_joueurs,
    'equipes_ajoutees', (select coalesce(jsonb_agg(tm.nom order by tm.nom), '[]') from public.teams tm where tm.id = any(v_add)),
    'informations', (select coalesce(jsonb_agg(k order by k), '[]') from jsonb_object_keys(v_fill) k),
    'lignes', v_count);
end; $$;
revoke all on function public.session_merge(bigint, bigint, boolean) from public, anon;
grant execute on function public.session_merge(bigint, bigint, boolean) to authenticated;

-- ------------------------------------------------------------
-- Annulation
-- ------------------------------------------------------------
create or replace function public.session_merge_undo(p_source bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m public.session_merges%rowtype;
  s public.sessions%rowtype;
  t public.sessions%rowtype;
  v_tbl   text;
  v_ids   bigint[];
  v_back  integer := 0;
  v_n     integer;
  v_fill  jsonb;
  v_teams bigint[];
begin
  if auth.uid() is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  select * into m from public.session_merges where source_id = p_source and undone_at is null for update;
  select * into s from public.sessions where id = p_source for update;
  if m.id is null or s.club_id is distinct from public.my_club_id() then
    raise exception 'Aucune fusion à annuler pour cette séance.' using errcode = 'P0002';
  end if;
  select * into t from public.sessions where id = m.target_id for update;
  if t.id is null then
    raise exception 'La séance qui a reçu la fusion est supprimée : restaurez-la d''abord (corbeille).' using errcode = '22023';
  end if;
  if t.fusionnee_dans is not null then
    raise exception 'Annulez d''abord la fusion de « % » dans une autre séance.', t.titre using errcode = '22023';
  end if;
  if public.session_access_level(s.id) <> 'modification' or public.session_access_level(t.id) <> 'modification' then
    raise exception 'Il faut pouvoir modifier les deux séances pour annuler la fusion.' using errcode = '42501';
  end if;

  for v_tbl in select jsonb_object_keys(m.plan->'moved') loop
    v_ids := array(select jsonb_array_elements_text(m.plan->'moved'->v_tbl)::bigint);
    if v_tbl = 'custom_form_responses' then
      update public.custom_form_responses set occurrence = 's' || s.id where id = any(v_ids) and occurrence = 's' || t.id;
    elsif v_tbl = 'procedures' then
      update public.procedures set session_id = s.id, ordre = ordre - (m.plan->>'offset')::integer where id = any(v_ids) and session_id = t.id;
    elsif v_tbl in ('attendance', 'session_bilans', 'session_rpe', 'session_access', 'session_comments', 'rpe_reminders', 'player_soreness', 'gps_imports') then
      execute format('update public.%I set session_id = $1 where id = any($2) and session_id = $3', v_tbl) using s.id, v_ids, t.id;
    else
      continue;
    end if;
    get diagnostics v_n = row_count;
    v_back := v_back + v_n;
  end loop;
  for v_tbl in select jsonb_object_keys(m.plan->'kept') loop
    continue when v_tbl not in ('attendance', 'session_bilans', 'session_rpe', 'session_access');
    execute format('insert into public.%I overriding system value select * from jsonb_populate_recordset(null::public.%I, $1) on conflict do nothing',
                   v_tbl, v_tbl) using m.plan->'kept'->v_tbl;
  end loop;

  -- Équipes et champs ajoutés à la cible : retirés, s'ils n'ont pas changé depuis.
  v_teams := array(select jsonb_array_elements_text(coalesce(m.plan->'teams', '[]'))::bigint);
  v_fill := coalesce(m.plan->'filled', '{}');
  update public.sessions set
    team_id        = case when m.plan->>'team_id' is null and team_id = any(v_teams) then null else team_id end,
    other_team_ids = array(select x from unnest(other_team_ids) x where not x = any(v_teams)),
    heure          = case when heure = (v_fill->>'heure')::time then null else heure end,
    lieu           = case when lieu = v_fill->>'lieu' then null else lieu end,
    principes_jeu  = case when principes_jeu = v_fill->>'principes_jeu' then null else principes_jeu end,
    rpe_attendue   = case when rpe_attendue = (v_fill->>'rpe_attendue')::smallint then null else rpe_attendue end,
    notes          = case when notes = v_fill->>'notes' then null else notes end
   where id = t.id;
  update public.sessions set fusionnee_dans = null, fusionnee_le = null where id = s.id;
  update public.session_merges set undone_at = now(), undone_by = auth.uid() where id = m.id;
  return jsonb_build_object('source', s.id, 'cible', t.id, 'revenues', v_back);
end; $$;
revoke all on function public.session_merge_undo(bigint) from public, anon;
grant execute on function public.session_merge_undo(bigint) to authenticated;

commit;
