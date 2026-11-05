/* ============================================================
   LMFC Performance — lmfc_v39_retour.sql : retour arrière de lmfc_v39.sql
   À exécuter seulement pour annuler lmfc_v39. Rejouable, transactionnel.
   Rend l'état d'avant, à l'identique (vérifié par tests/v39-sql.test.mjs) :
   règles, fonctions, droits, et les séances qui étaient ouvertes à tout le
   staff (sauvegarde lmfc_v39_acces_club). Aucune donnée n'est perdue.
   Attention : les cloisons refermées par lmfc_v39 se rouvrent.
   ============================================================ */
begin;

-- Anciennes séances : ouvertes de nouveau à tout le staff, date de modification inchangée.
do $$
begin
  if to_regclass('public.lmfc_v39_acces_club') is null then return; end if;
  alter table public.sessions disable trigger trg_touch_session;
  update public.sessions s set acces = 'club'
    from public.lmfc_v39_acces_club b where b.source = 'sessions' and b.id = s.id;
  alter table public.sessions enable trigger trg_touch_session;
  update public.trash t set data = jsonb_set(t.data, '{acces}', '"club"')
    from public.lmfc_v39_acces_club b where b.source = 'trash' and b.id = t.id;
end $$;
drop table if exists public.lmfc_v39_acces_club;

-- Séances
drop policy if exists "sessions_insert" on public.sessions;
create policy "sessions_insert" on public.sessions for insert
  with check (club_id = public.my_club_id() and public.can_edit());

-- Fiche joueur
drop trigger if exists guard_player_links on public.players;
drop function if exists public.guard_player_links();
drop policy if exists "players_insert" on public.players;
create policy "players_insert" on public.players for insert
  with check (club_id = public.my_club_id() and public.can_edit()
    and (public.is_club_admin() or team_id is null
         or team_id = any(coalesce((select pr.team_ids from public.profiles pr where pr.id = auth.uid()), '{}'))));

-- Corbeille
drop policy if exists trash_root_scope on public.trash;
drop function if exists public.trash_root_visible(bigint);

-- Stockage
drop policy if exists "logos_schemas_read" on storage.objects;
create policy "logos_schemas_read" on storage.objects for select
  using (bucket_id in ('logos', 'schemas') and auth.role() = 'authenticated');
drop function if exists public.template_image_hidden(text);

-- Appels directs
grant execute on function public.player_level_for(uuid, bigint) to authenticated;
grant execute on function public.recompute_player_profile_scores(bigint, text, text, bigint) to authenticated;

-- Fonctions, telles qu'elles étaient
CREATE OR REPLACE FUNCTION public.player_level_for(p_profile uuid, p_player bigint)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when me.id is null or me.role = 'joueur' or pl.id is null or pl.club_id is distinct from me.club_id then 'aucun'
    when me.role = 'admin' then 'modification'
    when me.role = 'lecteur' then case when x.niveau = 'aucun' then 'aucun' else 'lecture' end
    when x.niveau is not null then x.niveau
    when pl.team_id = any(me.team_ids) or coalesce(pl.other_team_ids, '{}') && me.team_ids then 'modification'
    when pl.team_id is null and cardinality(me.team_ids) > 0 then 'modification'
    when not exists (select 1 from public.teams t where t.club_id = me.club_id) then 'modification'
    when me.lecture_club then 'lecture'
    else 'aucun'
  end
  from (select 1) d
  left join public.profiles me on me.id = p_profile
  left join public.players pl on pl.id = p_player
  left join public.staff_player_access x on x.profile_id = p_profile and x.player_id = p_player;
$function$;

CREATE OR REPLACE FUNCTION public.guard_session_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then return new; end if;   -- SQL Editor, tâches serveur
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  elsif (new.acces is distinct from old.acces or new.created_by is distinct from old.created_by)
        and not (old.created_by = auth.uid() or public.is_club_admin()) then
    new.acces := old.acces;
    new.created_by := old.created_by;
  end if;
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.trash_session_visible(p_root bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
      select coalesce((select coalesce(r.data->>'acces', 'club') = 'club' or r.deleted_by = auth.uid() or public.is_club_admin()
                         from public.trash r where r.id = p_root and r.tbl = 'sessions'), true);
    $function$;

CREATE OR REPLACE FUNCTION public.trash_restore(p_ids bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Seulement ce que la personne voit dans sa corbeille (séances, joueurs : lmfc_v10, lmfc_v19).
  select coalesce(array_agg(t.id order by t.id), '{}') into v_pending
    from public.trash t
   where (t.id = any(p_ids) or t.root_id = any(p_ids))
     and t.club_id = v_club and public.trash_right(t.root_tbl)
     and (t.root_tbl <> 'sessions' or public.trash_session_visible(coalesce(t.root_id, t.id)))
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
end; $function$;

commit;
