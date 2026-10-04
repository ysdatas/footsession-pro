/* ============================================================
   LMFC Performance — migration 24 : corbeille.
   À exécuter APRÈS lmfc_v4.sql. Idempotent (rejouable) et
   transactionnel : en cas d'erreur, rien n'est appliqué.

   Une suppression n'efface plus rien pour de bon : juste avant
   qu'une ligne disparaisse, un déclencheur en garde une copie
   (public.trash), avec tout ce qui part avec elle en cascade
   (une séance emporte ses exercices et leurs schémas, une vidéo
   ses séquences, un objectif ses images…). Les pages continuent
   de supprimer comme avant : rien d'autre ne change pour elles.

   Corbeille (page « Corbeille ») :
     - restaurer : trash_restore(ids), l'élément et ses lignes
       liées reviennent tels quels (mêmes identifiants) ;
     - supprimer définitivement : delete sur trash (les fichiers,
       vidéos et images, sont retirés par la page au même moment).
   Droits : ceux de la suppression d'origine (trash_right) :
     équipes                                → administrateur
     séances, exercices, modèles, parcours  → admin, coach (can_edit)
     vidéos, séquences                      → admin, coach (can_manage_videos)
     objectifs, préventions, programme      → admin, coach, préparateur (can_manage_plans)
   Le joueur ne voit pas la corbeille.
   ============================================================ */
begin;

create table if not exists public.trash (
  id          bigint generated always as identity primary key,
  batch       bigint not null,               -- transaction de la suppression
  club_id     bigint references public.clubs on delete cascade,
  tbl         text   not null,               -- table d'origine
  row_id      bigint,
  root_id     bigint,                        -- élément supprimé dont elle dépend (null : c'est lui)
  root_tbl    text   not null,
  data        jsonb  not null,               -- la ligne, colonne par colonne
  extra       jsonb,                         -- liens remis à zéro par la suppression (équipe, vidéo)
  deleted_by  uuid references auth.users on delete set null default auth.uid(),
  deleted_at  timestamptz not null default now()
);
create index if not exists trash_club_idx  on public.trash (club_id, deleted_at desc);
create index if not exists trash_root_idx  on public.trash (root_id);
create index if not exists trash_batch_idx on public.trash (batch, tbl, row_id);

create or replace function public.trash_right(p_tbl text)
returns boolean language sql security definer stable set search_path = public as $$
  select case p_tbl
    when 'teams'                    then public.is_club_admin()
    when 'sessions'                 then public.can_edit()
    when 'procedures'               then public.can_edit()
    when 'exercise_templates'       then public.can_edit()
    when 'player_career'            then public.can_edit()
    when 'player_videos'            then public.can_manage_videos()
    when 'video_sequences'          then public.can_manage_videos()
    when 'player_performance_notes' then public.can_manage_plans()
    when 'program_exercises'        then public.can_manage_plans()
    else false
  end;
$$;
revoke all on function public.trash_right(text) from public, anon;
grant execute on function public.trash_right(text) to authenticated;

alter table public.trash enable row level security;
drop policy if exists trash_read  on public.trash;
drop policy if exists trash_purge on public.trash;
create policy trash_read on public.trash for select
  using (club_id = public.my_club_id() and public.trash_right(root_tbl));
create policy trash_purge on public.trash for delete
  using (club_id = public.my_club_id() and public.trash_right(root_tbl));
-- Seuls les déclencheurs écrivent dans la corbeille.
revoke insert, update on public.trash from anon, authenticated;
grant select, delete on public.trash to authenticated;

/* Copie d'une ligne au moment de sa suppression.
   Arguments du déclencheur : mode ('root' : peut être supprimée
   seule et apparaît dans la corbeille ; 'child' : seulement quand
   elle part avec son parent), table parente, colonne vers le parent.
   pg_trigger_depth() > 1 : suppression en cascade. */
create or replace function public.trash_capture()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mode     text  := tg_argv[0];
  v_parent   text  := nullif(tg_argv[1], '');
  v_fk       text  := nullif(tg_argv[2], '');
  v_row      jsonb := to_jsonb(old);
  v_root_id  bigint;
  v_root_tbl text;
  v_club     bigint;
  v_extra    jsonb;
begin
  if pg_trigger_depth() > 1 and v_parent is not null and v_row ? v_fk then
    select coalesce(t.root_id, t.id), t.root_tbl, t.club_id
      into v_root_id, v_root_tbl, v_club
      from public.trash t
     where t.batch = txid_current() and t.tbl = v_parent and t.row_id = (v_row->>v_fk)::bigint
     order by t.id desc limit 1;
  end if;
  if v_root_id is null and v_mode <> 'root' then
    return old;   -- ligne annexe retirée seule (image enlevée d'un objectif, vue…)
  end if;
  v_club := coalesce((v_row->>'club_id')::bigint, v_club,
                     case when tg_table_name = 'procedures'
                          then (select s.club_id from public.sessions s where s.id = (v_row->>'session_id')::bigint) end,
                     public.my_club_id());
  if v_club is null or not exists (select 1 from public.clubs c where c.id = v_club) then
    return old;   -- le club lui-même est supprimé : rien à garder
  end if;

  if tg_table_name = 'teams' then
    v_extra := jsonb_build_object(
      'players',  (select coalesce(jsonb_agg(p.id), '[]') from public.players p  where p.team_id = old.id),
      'sessions', (select coalesce(jsonb_agg(s.id), '[]') from public.sessions s where s.team_id = old.id));
  elsif tg_table_name = 'player_videos' then
    v_extra := jsonb_build_object(
      'program_exercises', (select coalesce(jsonb_agg(e.id), '[]') from public.program_exercises e where e.video_id = old.id),
      'tactical_schemas',  (select coalesce(jsonb_agg(ts.id), '[]') from public.tactical_schemas ts where ts.video_id = old.id));
  end if;

  insert into public.trash (batch, club_id, tbl, row_id, root_id, root_tbl, data, extra)
  values (
    txid_current(), v_club, tg_table_name, (v_row->>'id')::bigint, v_root_id, coalesce(v_root_tbl, tg_table_name), v_row, v_extra);
  return old;
end; $$;

do $$
declare t record;
begin
  for t in select * from (values
      -- table,                     mode,    parent,                     colonne
      ('teams',                     'root',  '',                         ''),
      ('sessions',                  'root',  '',                         ''),
      ('procedures',                'root',  'sessions',                 'session_id'),
      ('tactical_schemas',          'child', 'procedures',               'procedure_id'),
      ('attendance',                'child', 'sessions',                 'session_id'),
      ('session_comments',          'child', 'sessions',                 'session_id'),
      ('exercise_templates',        'root',  '',                         ''),
      ('player_career',             'root',  '',                         ''),
      ('player_videos',             'root',  '',                         ''),
      ('video_sequences',           'root',  'player_videos',            'video_id'),
      ('video_views',               'child', 'player_videos',            'video_id'),
      ('player_video_selections',   'child', 'player_videos',            'video_id'),
      ('player_performance_notes',  'root',  '',                         ''),
      ('player_performance_media',  'child', 'player_performance_notes', 'note_id'),
      ('program_exercises',         'root',  '',                         '')
    ) as v(tbl, mode, parent, fk)
  loop
    if to_regclass('public.' || t.tbl) is null then continue; end if;   -- table d'une migration non passée
    execute format('drop trigger if exists trash_capture on public.%I', t.tbl);
    execute format('create trigger trash_capture before delete on public.%I for each row execute function public.trash_capture(%L, %L, %L)',
                   t.tbl, t.mode, t.parent, t.fk);
  end loop;
end $$;

/* Restaure des éléments de la corbeille (identifiants des lignes
   racines) avec toutes leurs lignes liées, dans l'ordre de leur
   suppression : le parent avant ses enfants. Renvoie le nombre
   d'éléments restaurés. */
create or replace function public.trash_restore(p_ids bigint[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  r      record;
  v_club bigint := public.my_club_id();
  v_done integer := 0;
begin
  if v_club is null then raise exception 'Connexion requise.'; end if;
  for r in
    select t.* from public.trash t
     where (t.id = any(p_ids) or t.root_id = any(p_ids))
       and t.club_id = v_club and public.trash_right(t.root_tbl)
     order by t.id
  loop
    if r.tbl not in ('teams', 'sessions', 'procedures', 'tactical_schemas', 'attendance', 'session_comments',
                     'exercise_templates', 'player_career', 'player_videos', 'video_sequences', 'video_views',
                     'player_video_selections', 'player_performance_notes', 'player_performance_media',
                     'program_exercises') then
      raise exception 'Élément non restaurable (%).', r.tbl;
    end if;
    begin
      execute format('insert into public.%I overriding system value select * from jsonb_populate_record(null::public.%I, $1)',
                     r.tbl, r.tbl) using r.data;
    exception
      when unique_violation then
        if r.root_id is null then
          raise exception 'Restauration impossible : un élément identique existe déjà (même nom ?). Renommez-le, puis réessayez.';
        end if;
        -- ligne liée déjà présente : rien à faire
      when foreign_key_violation then
        if r.root_id is null then
          raise exception 'Restauration impossible : ce qui contenait cet élément (joueur, séance, vidéo) n''existe plus. Restaurez-le d''abord.';
        end if;
        -- ligne liée dont l'autre bout a disparu depuis (ex. un joueur supprimé) : on la laisse
    end;
    if r.root_id is null then v_done := v_done + 1; end if;
    -- Liens remis à zéro par la suppression : rétablis s'ils sont encore vides.
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
  end loop;
  delete from public.trash t
   where (t.id = any(p_ids) or t.root_id = any(p_ids))
     and t.club_id = v_club and public.trash_right(t.root_tbl);
  return v_done;
end; $$;
revoke all on function public.trash_restore(bigint[]) from public, anon;
grant execute on function public.trash_restore(bigint[]) to authenticated;

commit;
