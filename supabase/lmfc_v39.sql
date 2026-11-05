/* ============================================================
   LMFC Performance — lmfc_v39.sql (n° 57) : cloisons entre équipes
   À exécuter APRÈS lmfc_v38.sql. Rejouable, transactionnelle.
   Retour arrière : lmfc_v39_retour.sql (rend l'état d'avant, à l'identique).

   Chaque compte ne retrouve que ce qui correspond à ses équipes et à ses
   droits. Testé sur les migrations réelles : tests/access-matrix-sql.test.mjs.

   1. Joueur sans aucune équipe : l'administrateur seul le voit. Avant, tout
      compte ayant une équipe le modifiait. Une exception nominative
      (Mon club → Accès) l'ouvre toujours à quelqu'un.
   2. Lecteur : ses équipes cochées s'il en a, tout le club sinon. Attention :
      un lecteur à qui il reste des équipes (ancien coach) ne verra plus qu'elles.
   3. Anciennes séances ouvertes à tout le staff (acces = 'club', valeur posée
      par lmfc_v10) : celles qui ont une équipe passent au staff de l'équipe.
      Ce qui change est gardé dans lmfc_v39_acces_club pour le retour arrière ;
      la date de modification des séances ne bouge pas. Choisir « Tout le staff
      du club » sur une séance reste possible ; une séance sans équipe ne change pas.
   4. Séance : on ne la crée ou ne la déplace que dans une équipe où l'on a le
      droit de modifier (l'admin partout). Un réglage nominatif sur la séance
      reste valable, l'équipe n'y change rien tant qu'on ne la déplace pas.
   5. Fiche joueur : le compte lié ne se change que par les fonctions de Mon
      club ; un coach n'ajoute ou ne retire que ses propres équipes, et ne crée
      plus de joueur sans équipe.
   6. Corbeille : un match suit son équipe, un schéma privé son créateur, un
      procédé sa séance ; même règle pour lire, restaurer et purger.
   7. Stockage logos et schemas : lecture et liste limitées à son club, et
      l'image d'un schéma privé cachée à ceux qui ne lisent pas le schéma. Le
      bucket schemas reste public (le lien de partage sans compte en dépend) :
      une adresse connue reste lisible, mais plus personne ne peut les lister.
   8. player_level_for et recompute_player_profile_scores ne s'appellent plus
      directement : seuls les fonctions et déclencheurs de la base s'en servent.
   ============================================================ */
begin;

-- ------------------------------------------------------------
-- 1 et 2) Niveau sur un joueur
-- ------------------------------------------------------------
create or replace function public.player_level_for(p_profile uuid, p_player bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when me.id is null or me.role = 'joueur' or pl.id is null or pl.club_id is distinct from me.club_id then 'aucun'
    when me.role = 'admin' then 'modification'
    when me.role = 'lecteur' then case
      when x.niveau = 'aucun' then 'aucun'
      when x.niveau is not null then 'lecture'
      when pl.team_id = any(me.team_ids) or coalesce(pl.other_team_ids, '{}') && me.team_ids then 'lecture'
      when cardinality(me.team_ids) > 0 then 'aucun'
      when pl.team_id is null and cardinality(coalesce(pl.other_team_ids, '{}')) = 0
           and exists (select 1 from public.teams t where t.club_id = me.club_id) then 'aucun'
      else 'lecture'
    end
    when x.niveau is not null then x.niveau
    when pl.team_id = any(me.team_ids) or coalesce(pl.other_team_ids, '{}') && me.team_ids then 'modification'
    when not exists (select 1 from public.teams t where t.club_id = me.club_id) then 'modification'
    when me.lecture_club and (pl.team_id is not null or cardinality(coalesce(pl.other_team_ids, '{}')) > 0) then 'lecture'
    else 'aucun'
  end
  from (select 1) d
  left join public.profiles me on me.id = p_profile
  left join public.players pl on pl.id = p_player
  left join public.staff_player_access x on x.profile_id = p_profile and x.player_id = p_player;
$$;

-- ------------------------------------------------------------
-- 3) Anciennes séances : une seule fois, au premier passage
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.lmfc_v39_acces_club') is not null then return; end if;
  create table public.lmfc_v39_acces_club (
    source text   not null check (source in ('sessions', 'trash')),
    id     bigint not null,
    primary key (source, id)
  );
  alter table public.lmfc_v39_acces_club enable row level security;
  revoke all on public.lmfc_v39_acces_club from public, anon, authenticated;
  create policy lecteur_no_insert on public.lmfc_v39_acces_club as restrictive for insert to authenticated
    with check (not (select public.is_lecteur()));
  create policy lecteur_no_update on public.lmfc_v39_acces_club as restrictive for update to authenticated
    using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()));
  create policy lecteur_no_delete on public.lmfc_v39_acces_club as restrictive for delete to authenticated
    using (not (select public.is_lecteur()));

  insert into public.lmfc_v39_acces_club (source, id)
    select 'sessions', s.id from public.sessions s where s.acces = 'club' and s.team_id is not null;
  -- Une séance à la corbeille reviendrait avec ses anciens droits.
  insert into public.lmfc_v39_acces_club (source, id)
    select 'trash', t.id from public.trash t
     where t.tbl = 'sessions' and coalesce(t.data->>'acces', 'club') = 'club' and nullif(t.data->>'team_id', '') is not null;

  alter table public.sessions disable trigger trg_touch_session;
  update public.sessions s set acces = 'equipe'
    from public.lmfc_v39_acces_club b where b.source = 'sessions' and b.id = s.id;
  alter table public.sessions enable trigger trg_touch_session;
  update public.trash t set data = jsonb_set(t.data, '{acces}', '"equipe"')
    from public.lmfc_v39_acces_club b where b.source = 'trash' and b.id = t.id;
end $$;

-- ------------------------------------------------------------
-- 4) Séances : l'équipe où on les range
-- ------------------------------------------------------------
drop policy if exists "sessions_insert" on public.sessions;
create policy "sessions_insert" on public.sessions for insert
  with check (club_id = public.my_club_id() and public.can_edit()
    and (team_id is null or public.team_level(team_id) = 'modification'));

-- Déplacer se contrôle ici et pas dans la règle : un réglage nominatif donne le
-- droit de modifier la séance d'une autre équipe, sans changer son équipe.
create or replace function public.guard_session_access()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- SQL Editor, tâches serveur
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    return new;
  end if;
  if (new.acces is distinct from old.acces or new.created_by is distinct from old.created_by)
     and not (old.created_by = auth.uid() or public.is_club_admin()) then
    new.acces := old.acces;
    new.created_by := old.created_by;
  end if;
  if new.team_id is distinct from old.team_id and new.team_id is not null
     and current_user = 'authenticated' and public.team_level(new.team_id) <> 'modification' then
    raise exception 'Cette séance ne peut être rangée que dans une de vos équipes.' using errcode = '42501';
  end if;
  return new;
end; $$;

-- ------------------------------------------------------------
-- 5) Fiche joueur : compte lié et équipes
-- ------------------------------------------------------------
drop policy if exists "players_insert" on public.players;
create policy "players_insert" on public.players for insert
  with check (club_id = public.my_club_id() and public.can_edit()
    and (public.is_club_admin()
         or team_id = any(coalesce((select pr.team_ids from public.profiles pr where pr.id = auth.uid()), '{}'))
         or (team_id is null and not exists (select 1 from public.teams t where t.club_id = public.my_club_id()))));

-- Seules les écritures de l'API sont gardées : les fonctions de Mon club et la
-- corbeille (security definer), le SQL Editor et les migrations passent.
create or replace function public.guard_player_links()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_mine bigint[];
  v_old  bigint[] := '{}';
  v_new  bigint[] := array_remove(array[new.team_id] || coalesce(new.other_team_ids, '{}'), null);
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'UPDATE' then v_old := array_remove(array[old.team_id] || coalesce(old.other_team_ids, '{}'), null); end if;
  if new.auth_user_id is distinct from (case when tg_op = 'UPDATE' then old.auth_user_id end) then
    raise exception 'Le compte lié à une fiche se règle dans Mon club, par l’administrateur.' using errcode = '42501';
  end if;
  if public.is_club_admin() then return new; end if;
  select coalesce(pr.team_ids, '{}') into v_mine from public.profiles pr where pr.id = auth.uid();
  if exists (select 1 from unnest(v_new) t where t <> all(v_old) and t <> all(coalesce(v_mine, '{}')))
     or exists (select 1 from unnest(v_old) t where t <> all(v_new) and t <> all(coalesce(v_mine, '{}'))) then
    raise exception 'Seul l’administrateur rattache un joueur à une équipe qui n’est pas la vôtre, ou l’en retire.' using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists guard_player_links on public.players;
create trigger guard_player_links before insert or update of auth_user_id, team_id, other_team_ids on public.players
  for each row execute function public.guard_player_links();

-- ------------------------------------------------------------
-- 6) Corbeille
-- ------------------------------------------------------------
-- Séance : celle du staff de l'équipe si elle était ouverte, sinon la personne
-- qui l'a supprimée et l'admin (corbeille discrète, lmfc_v10.sql).
create or replace function public.trash_session_visible(p_root bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select r.deleted_by = auth.uid() or public.is_club_admin()
                          or (coalesce(r.data->>'acces', 'club') = 'club'
                              and public.team_level(nullif(r.data->>'team_id', '')::bigint) <> 'aucun')
                     from public.trash r where r.id = p_root and r.tbl = 'sessions'), true);
$$;

-- Ce qui a été supprimé suit la règle de lecture de ce qu'il était.
create or replace function public.trash_root_visible(p_root bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select public.is_club_admin() or r.deleted_by = auth.uid() or case r.tbl
      when 'matches' then r.data->>'created_by' = auth.uid()::text
        or public.team_level(nullif(r.data->>'team_id', '')::bigint) <> 'aucun'
      when 'exercise_templates' then r.data->>'created_by' = auth.uid()::text or r.data->>'created_by' is null
        or coalesce((r.data->>'partage')::boolean, false)
      when 'procedures' then public.session_access_level((r.data->>'session_id')::bigint) <> 'aucun'
      else true
    end
    from public.trash r where r.id = p_root), true);
$$;
revoke all on function public.trash_root_visible(bigint) from public, anon;
grant execute on function public.trash_root_visible(bigint) to authenticated;
drop policy if exists trash_root_scope on public.trash;
create policy trash_root_scope on public.trash as restrictive for all
  using (public.trash_root_visible(coalesce(root_id, id)));

create or replace function public.trash_restore(p_ids bigint[])
returns integer language plpgsql security definer set search_path = public as $body$
declare
  r          record;
  v_club     bigint := public.my_club_id();
  v_done     integer := 0;
  v_pending  bigint[];
  v_all      bigint[];
  v_next     bigint[];
  v_progress boolean;
begin
  if v_club is null then raise exception 'Connexion requise.'; end if;
  -- Seulement ce que la personne voit dans sa corbeille (séances, joueurs : lmfc_v10, lmfc_v19 ; le reste : lmfc_v39).
  select coalesce(array_agg(t.id order by t.id), '{}') into v_pending
    from public.trash t
   where (t.id = any(p_ids) or t.root_id = any(p_ids))
     and t.club_id = v_club and public.trash_right(t.root_tbl)
     and (t.root_tbl <> 'sessions' or public.trash_session_visible(coalesce(t.root_id, t.id)))
     and public.trash_root_visible(coalesce(t.root_id, t.id))
     and public.trash_player_visible(t.tbl, t.row_id, t.root_tbl, t.data);
  v_all := v_pending;
  loop
    v_next := '{}'; v_progress := false;
    for r in select t.* from public.trash t where t.id = any(v_pending) order by t.id loop
      -- Restaurable : une table du schéma public équipée du déclencheur de corbeille.
      if not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
                       join pg_namespace n on n.oid = c.relnamespace
                      where g.tgname = 'trash_capture' and n.nspname = 'public' and c.relname = r.tbl) then
        raise exception 'Élément non restaurable (%).', r.tbl;
      end if;
      begin
        execute format('insert into public.%I overriding system value select * from jsonb_populate_record(null::public.%I, $1)',
                       r.tbl, r.tbl) using r.data;
        v_progress := true;
        if r.root_id is null then v_done := v_done + 1; end if;
        if r.tbl = 'teams' and r.extra is not null then
          update public.players  set team_id = r.row_id
           where club_id = v_club and team_id is null and id in (select (jsonb_array_elements_text(r.extra->'players'))::bigint);
          update public.sessions set team_id = r.row_id
           where club_id = v_club and team_id is null and id in (select (jsonb_array_elements_text(r.extra->'sessions'))::bigint);
        elsif r.tbl = 'player_videos' and r.extra is not null then
          update public.program_exercises set video_id = r.row_id
           where club_id = v_club and video_id is null
             and id in (select (jsonb_array_elements_text(r.extra->'program_exercises'))::bigint);
          update public.tactical_schemas set video_id = r.row_id
           where video_id is null
             and id in (select (jsonb_array_elements_text(coalesce(r.extra->'tactical_schemas', '[]')))::bigint)
             and exists (select 1 from public.procedures pr join public.sessions s on s.id = pr.session_id
                          where pr.id = tactical_schemas.procedure_id and s.club_id = v_club);
        end if;
      exception
        when unique_violation then
          if r.root_id is null then
            raise exception 'Restauration impossible : un élément identique existe déjà (même nom ?). Renommez-le, puis réessayez.';
          end if;
          v_progress := true;
        when foreign_key_violation then
          v_next := v_next || r.id;
      end;
    end loop;
    exit when cardinality(v_next) = 0 or not v_progress;
    v_pending := v_next;
  end loop;
  if exists (select 1 from public.trash t where t.id = any(v_next) and t.root_id is null) then
    raise exception 'Restauration impossible : ce qui contenait cet élément (joueur, séance, vidéo) n''existe plus. Restaurez-le d''abord.';
  end if;
  delete from public.trash t where t.id = any(v_all);
  return v_done;
end; $body$;

-- ------------------------------------------------------------
-- 7) Stockage logos et schemas
-- ------------------------------------------------------------
-- Vrai si un schéma porte cette image et que le compte ne le lit pas. Une image
-- qu'aucun schéma ne porte encore (envoi en cours) reste visible de son club.
create or replace function public.template_image_hidden(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.exercise_templates t where t.image_path = p_path
    and not (t.club_id = public.my_club_id() and public.has_role('admin', 'coach', 'prepa')
             and (t.created_by = auth.uid() or t.partage or public.is_club_admin())));
$$;
revoke all on function public.template_image_hidden(text) from public, anon;
grant execute on function public.template_image_hidden(text) to authenticated;

drop policy if exists "logos_schemas_read" on storage.objects;
create policy "logos_schemas_read" on storage.objects for select to authenticated
  using (bucket_id in ('logos', 'schemas')
    and (storage.foldername(name))[1] = public.my_club_id()::text
    and not public.template_image_hidden(name));

-- ------------------------------------------------------------
-- 8) Appels directs
-- ------------------------------------------------------------
revoke all on function public.player_level_for(uuid, bigint) from public, anon, authenticated;
revoke all on function public.recompute_player_profile_scores(bigint, text, text, bigint) from public, anon, authenticated;

commit;
