/* ============================================================
   LMFC Performance — lmfc_v31.sql : dossiers de la bibliothèque vidéo
   À exécuter APRÈS lmfc_v30.sql (indépendante : peut passer seule après
   lmfc_v26.sql). Rejouable, transactionnelle.

   - library_folders : les dossiers du club (« Rondo », « Transitions »…),
     sans doublon d'écriture (même clé que les tags : « Rondo » = « rondo ») ;
     archivés plutôt que perdus ;
       lecture : les comptes qui lisent la bibliothèque (admin, coachs,
       préparateurs ; ni lecteur ni joueur) ; créer, renommer, archiver,
       supprimer : admin et coachs ;
   - library_items.folder_id : le dossier d'une vidéo (un seul ; les tags
     restent pour chercher autrement). Supprimer un dossier ne supprime
     aucune vidéo : elles passent « Sans dossier ». Déplacer une vidéo :
     son niveau modification ou gestion (règle actuelle des procédés) ;
     les séances gardent leurs liens (procédé + version), rien n'est copié ;
   - library_search(…, p_folder) : null = tous, 0 = sans dossier ;
     library_create_item(…, p_folder) ; library_folders_list() avec le
     nombre de vidéos visibles par dossier.

   Retour arrière (à la main) :
     drop function if exists public.library_folders_list();
     alter table public.library_items drop column if exists folder_id;
     drop table if exists public.library_folders;
     repasser lmfc_v24.sql et lmfc_v25.sql (library_create_item, library_search).
   ============================================================ */
begin;

create table if not exists public.library_folders (
  id          bigint generated always as identity primary key,
  club_id     bigint not null references public.clubs on delete cascade,
  nom         text not null check (char_length(btrim(nom)) between 1 and 60),
  key         text generated always as (public.library_tag_key(nom)) stored,
  archived_at timestamptz,
  created_by  uuid default auth.uid() references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  unique (club_id, key)
);
alter table public.library_items add column if not exists folder_id bigint references public.library_folders on delete set null;
create index if not exists library_items_folder_idx on public.library_items (folder_id);

-- Un dossier du même club, jamais celui d'un autre.
create or replace function public.guard_library_item_folder()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.folder_id is not null and not exists (select 1 from public.library_folders f where f.id = new.folder_id and f.club_id = new.club_id) then
    raise exception 'Dossier inconnu pour ce club.' using errcode = '23503';
  end if;
  return new;
end; $$;
revoke all on function public.guard_library_item_folder() from public, anon, authenticated;
drop trigger if exists trg_library_item_folder on public.library_items;
create trigger trg_library_item_folder before insert or update of folder_id on public.library_items
  for each row execute function public.guard_library_item_folder();

alter table public.library_folders enable row level security;
drop policy if exists library_folders_read on public.library_folders;
drop policy if exists library_folders_write on public.library_folders;
create policy library_folders_read on public.library_folders for select using (
  club_id = (select public.my_club_id()) and (select public.has_role('admin', 'coach', 'prepa')));
create policy library_folders_write on public.library_folders for all
  using (club_id = (select public.my_club_id()) and (select public.can_edit()))
  with check (club_id = (select public.my_club_id()) and (select public.can_edit()));
drop policy if exists lecteur_no_insert on public.library_folders;
drop policy if exists lecteur_no_update on public.library_folders;
drop policy if exists lecteur_no_delete on public.library_folders;
create policy lecteur_no_insert on public.library_folders as restrictive for insert to authenticated
  with check (not (select public.is_lecteur()));
create policy lecteur_no_update on public.library_folders as restrictive for update to authenticated
  using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()));
create policy lecteur_no_delete on public.library_folders as restrictive for delete to authenticated
  using (not (select public.is_lecteur()));
revoke all on public.library_folders from anon, authenticated;
grant select, insert, delete on public.library_folders to authenticated;
grant update (nom, archived_at) on public.library_folders to authenticated;
grant update (folder_id) on public.library_items to authenticated;

-- ------------------------------------------------------------
-- Recherche et création avec le dossier (anciennes signatures retirées : sinon PGRST203)
-- ------------------------------------------------------------
drop function if exists public.library_search(text, bigint[], text, text, integer, integer);
create or replace function public.library_search(p_q text default '', p_tags bigint[] default '{}',
  p_mode text default 'all', p_statut text default 'actif', p_limit integer default 48, p_offset integer default 0, p_folder bigint default null)
returns table (id bigint, titre text, description text, statut text, created_by uuid, updated_at timestamptz,
  version_id bigint, version_no integer, file_id bigint, storage_path text, duree_sec numeric, tag_ids bigint[], total bigint, folder_id bigint)
language sql stable security invoker set search_path = public as $$
  with w as (
    select distinct x as word from unnest(string_to_array(public.library_text_key(p_q), ' ')) x where x <> ''
  ), tagged as (
    select it.item_id from public.library_item_tags it
    where it.tag_id = any(coalesce(p_tags, '{}'))
    group by it.item_id
    having p_mode = 'any' or count(*) = cardinality(p_tags)
  ), hits as (
    select i.id, i.titre, i.description, i.statut, i.created_by, i.updated_at, i.current_version_id, i.folder_id, count(*) over () as n
    from public.library_items i
    where i.club_id = public.my_club_id()
      and i.statut = coalesce(p_statut, 'actif')
      and (coalesce(p_statut, 'actif') <> 'retire' or public.library_level(i.id) = 'gestion')
      and (p_folder is null or (p_folder = 0 and i.folder_id is null) or i.folder_id = p_folder)
      and (cardinality(coalesce(p_tags, '{}')) = 0 or i.id in (select item_id from tagged))
      and not exists (
        select 1 from w where position(w.word in i.search_key) = 0
          and not exists (select 1 from public.library_item_tags it join public.library_tags t on t.id = it.tag_id
                          where it.item_id = i.id and t.key like w.word || '%'))
    order by i.updated_at desc, i.id desc
    limit least(greatest(coalesce(p_limit, 48), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
  )
  select h.id, h.titre, h.description, h.statut, h.created_by, h.updated_at,
         v.id, v.version_no, f.id, f.storage_path, f.duree_sec,
         array(select it.tag_id from public.library_item_tags it where it.item_id = h.id order by it.tag_id),
         h.n, h.folder_id
  from hits h
  left join public.library_versions v on v.id = h.current_version_id
  left join public.library_files f on f.id = v.file_id
  order by h.updated_at desc, h.id desc;
$$;

drop function if exists public.library_create_item(text, bigint, text, text, bigint[]);
create or replace function public.library_create_item(p_titre text, p_file bigint, p_sha256 text default null,
  p_description text default null, p_tags bigint[] default '{}', p_folder bigint default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_item bigint; v_ver bigint;
begin
  if not public.can_manage_videos() or public.is_lecteur() then
    raise exception 'Ajout réservé aux administrateurs et aux coachs.' using errcode = '42501';
  end if;
  perform public.library_check_file(p_file, p_sha256);
  insert into public.library_items (club_id, titre, description, folder_id)
  values (public.my_club_id(), btrim(p_titre), nullif(btrim(coalesce(p_description, '')), ''),
          (select f.id from public.library_folders f where f.id = p_folder and f.club_id = public.my_club_id()))
  returning id into v_item;
  insert into public.library_versions (item_id, file_id, version_no) values (v_item, p_file, 1) returning id into v_ver;
  update public.library_items set current_version_id = v_ver where id = v_item;
  insert into public.library_item_tags (item_id, tag_id)
  select v_item, t.id from public.library_tags t where t.id = any(coalesce(p_tags, '{}')) and t.club_id = public.my_club_id()
  on conflict do nothing;
  return v_item;
end; $$;

-- Dossiers et nombre de vidéos visibles (actives), plus « Sans dossier » (id 0).
create or replace function public.library_folders_list()
returns table (id bigint, nom text, archived boolean, n bigint)
language sql stable security invoker set search_path = public as $$
  select * from (
    select f.id, f.nom, f.archived_at is not null as archived,
           (select count(*) from public.library_items i where i.folder_id = f.id and i.statut = 'actif') as n
      from public.library_folders f
    union all
    select 0, 'Sans dossier', false, (select count(*) from public.library_items i where i.folder_id is null and i.statut = 'actif' and i.club_id = public.my_club_id())
  ) x order by x.archived, x.id = 0, x.nom;
$$;

do $$
declare f text;
begin
  foreach f in array array['library_search(text, bigint[], text, text, integer, integer, bigint)',
    'library_create_item(text, bigint, text, text, bigint[], bigint)', 'library_folders_list()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
