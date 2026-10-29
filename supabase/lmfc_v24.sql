/* ============================================================
   LMFC Performance — lmfc_v24.sql : bibliothèque vidéo (1/2)
   Tables, droits et règles. À exécuter APRÈS lmfc_v23.sql, puis
   lmfc_v25.sql (tags, recherche, séances). Rejouable, transactionnelle.

   Séparé : le fichier (library_files, dans R2 sous r2/<club>/lib/…),
   le procédé (library_items), ses versions (library_versions : une
   vidéo remplacée garde l'ancienne, que les séances continuent de lire),
   les tags du club (library_tags, library_item_tags) et les exceptions
   nominatives (library_access).

   Niveau d'un compte sur un procédé (library_level_for) :
     lecteur, joueur, autre club        → aucun
     admin                              → gestion
     créateur (coach)                   → gestion
     exception nominative               → aucun / lecture / modification
                                          (modification : admin ou coach)
     rôle dans acces_roles et équipe     → acces_niveau (modification :
       dans acces_teams (vide = club)      coach seulement), sinon aucun
   gestion = archiver, retirer, régler l'accès, supprimer ; modification
   = infos, tags, nouvelle version. Hors admin, on n'ouvre une vidéo qu'à
   ses propres équipes (jamais à tout le club, sauf club sans équipes).
   ============================================================ */
begin;

-- ------------------------------------------------------------
-- 1) Clés de recherche : minuscules, sans accents ni ponctuation.
--    Tag : sans espaces non plus (« #Ré-versibilité » = « reversibilite »).
--    Même règle côté navigateur : libTextKey / libTagKey (library.js).
-- ------------------------------------------------------------
create or replace function public.library_text_key(p text)
returns text language sql immutable parallel safe set search_path = public as $$
  select btrim(regexp_replace(
    translate(replace(replace(replace(lower(coalesce(p, '')), 'œ', 'oe'), 'æ', 'ae'), 'ß', 'ss'),
              'àâäáãåāçćčéèêëēęěíìîïīñńňóòôöõøōúùûüūůýÿžźżšśř',
              'aaaaaaaccceeeeeeeiiiiinnnooooooouuuuuuyyzzzssr'),
    '[^a-z0-9]+', ' ', 'g'));
$$;
create or replace function public.library_tag_key(p text)
returns text language sql immutable parallel safe set search_path = public as $$
  select replace(public.library_text_key(p), ' ', '');
$$;

-- ------------------------------------------------------------
-- 2) Tables
-- ------------------------------------------------------------
create table if not exists public.library_files (
  id           bigint generated always as identity primary key,
  club_id      bigint not null references public.clubs on delete cascade,
  storage_path text not null unique,
  sha256       text,
  size_bytes   bigint,
  mime         text,
  duree_sec    numeric,
  thumb        text,
  created_by   uuid default auth.uid() references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  constraint library_files_path_check check (storage_path ~ ('^r2/' || club_id::text || '/lib/[0-9]+\.[a-zA-Z0-9]{1,8}$')),
  constraint library_files_sha_check check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint library_files_thumb_check check (thumb is null or (thumb like 'data:image/jpeg;base64,%' and length(thumb) <= 60000))
);
-- Un même fichier n'entre qu'une fois par club.
create unique index if not exists library_files_sha_idx on public.library_files (club_id, sha256) where sha256 is not null;

create table if not exists public.library_items (
  id                 bigint generated always as identity primary key,
  club_id            bigint not null references public.clubs on delete cascade,
  titre              text not null check (length(btrim(titre)) between 1 and 200),
  description        text check (description is null or length(description) <= 5000),
  statut             text not null default 'actif' check (statut in ('actif', 'archive', 'retire')),
  current_version_id bigint,
  acces_roles        text[] not null default '{coach,prepa}' check (acces_roles <@ array['coach', 'prepa']),
  acces_teams        bigint[] not null default '{}',
  acces_niveau       text not null default 'lecture' check (acces_niveau in ('lecture', 'modification')),
  search_key         text generated always as (public.library_text_key(titre || ' ' || coalesce(description, ''))) stored,
  created_by         uuid default auth.uid() references auth.users on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists library_items_club_idx on public.library_items (club_id, statut, updated_at desc, id desc);

create table if not exists public.library_versions (
  id         bigint generated always as identity primary key,
  item_id    bigint not null references public.library_items on delete cascade,
  file_id    bigint not null references public.library_files,   -- un fichier encore utilisé ne part pas
  version_no int not null,
  note       text,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (item_id, version_no)
);
create index if not exists library_versions_file_idx on public.library_versions (file_id);
alter table public.library_items drop constraint if exists library_items_current_fk;
alter table public.library_items add constraint library_items_current_fk
  foreign key (current_version_id) references public.library_versions on delete set null;

create table if not exists public.library_tags (
  id         bigint generated always as identity primary key,
  club_id    bigint not null references public.clubs on delete cascade,
  label      text not null check (length(btrim(label)) between 1 and 40),
  key        text generated always as (public.library_tag_key(label)) stored,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  constraint library_tags_key_check check (key <> '')
);
create unique index if not exists library_tags_key_idx on public.library_tags (club_id, key);

create table if not exists public.library_item_tags (
  item_id bigint not null references public.library_items on delete cascade,
  tag_id  bigint not null references public.library_tags on delete cascade,
  primary key (item_id, tag_id)
);
create index if not exists library_item_tags_tag_idx on public.library_item_tags (tag_id, item_id);

create table if not exists public.library_access (
  id         bigint generated always as identity primary key,
  item_id    bigint not null references public.library_items on delete cascade,
  profile_id uuid not null references public.profiles on delete cascade,
  niveau     text not null check (niveau in ('aucun', 'lecture', 'modification')),
  unique (item_id, profile_id)
);
create index if not exists library_access_profile_idx on public.library_access (profile_id);

-- ------------------------------------------------------------
-- 3) Niveaux
-- ------------------------------------------------------------
create or replace function public.library_level_for(p_profile uuid, p_item bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when me.id is null or i.id is null or i.club_id is distinct from me.club_id
      or me.role not in ('admin', 'coach', 'prepa') then 'aucun'
    when me.role = 'admin' then 'gestion'
    when i.created_by = me.id then case when me.role = 'coach' then 'gestion' else 'lecture' end
    when x.niveau = 'modification' and me.role <> 'coach' then 'lecture'
    when x.niveau is not null then x.niveau
    when me.role = any(i.acces_roles) and (cardinality(i.acces_teams) = 0 or i.acces_teams && me.team_ids)
      then case when i.acces_niveau = 'modification' and me.role = 'coach' then 'modification' else 'lecture' end
    else 'aucun'
  end
  from (select 1) d
  left join public.profiles me on me.id = p_profile
  left join public.library_items i on i.id = p_item
  left join public.library_access x on x.item_id = p_item and x.profile_id = p_profile;
$$;
create or replace function public.library_level(p_item bigint)
returns text language sql stable security definer set search_path = public as $$
  select public.library_level_for(auth.uid(), p_item);
$$;

-- Procédés lisibles par le compte (même règle que library_level <> 'aucun'),
-- calculés une fois par requête pour les règles de lecture (cf. lmfc_v21.sql).
create or replace function public.my_library_items()
returns setof bigint language sql stable security definer set search_path = public as $$
  select i.id from public.library_items i
  join public.profiles me on me.id = auth.uid()
  left join public.library_access x on x.item_id = i.id and x.profile_id = me.id
  where i.club_id = me.club_id and me.role in ('admin', 'coach', 'prepa')
    and (me.role = 'admin' or i.created_by = me.id
         or (x.niveau is not null and x.niveau <> 'aucun')
         or (x.niveau is null and me.role = any(i.acces_roles)
             and (cardinality(i.acces_teams) = 0 or i.acces_teams && me.team_ids)));
$$;
-- Fichiers lisibles : les siens, et ceux d'une version d'un procédé lisible.
create or replace function public.my_library_files()
returns setof bigint language sql stable security definer set search_path = public as $$
  select f.id from public.library_files f
  where f.club_id = public.my_club_id() and f.created_by = auth.uid() and public.can_manage_videos()
  union
  select v.file_id from public.library_versions v where v.item_id in (select public.my_library_items());
$$;

-- ------------------------------------------------------------
-- 4) Garde du procédé : créateur, statut et accès, dans les limites
--    de l'auteur de la modification.
-- ------------------------------------------------------------
create or replace function public.guard_library_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me          public.profiles;
  v_old_teams bigint[] := '{}';
  v_old_club  boolean := false;   -- déjà ouvert à tout le club
begin
  new.acces_teams := array(select distinct t from unnest(new.acces_teams) t order by t);
  if auth.uid() is null then return new; end if;   -- SQL Editor, tâches serveur
  select * into me from public.profiles where id = auth.uid();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.statut := 'actif';
    new.current_version_id := null;   -- les versions passent par library_create_item / library_add_version
    -- Par défaut : le staff des équipes du créateur (tout le club pour l'admin ou un club sans équipes).
    if me.role <> 'admin' and cardinality(new.acces_teams) = 0 and cardinality(new.acces_roles) > 0
       and exists (select 1 from public.teams t where t.club_id = me.club_id) then
      if cardinality(me.team_ids) > 0 then new.acces_teams := me.team_ids; else new.acces_roles := '{}'; end if;
    end if;
  else
    new.club_id := old.club_id; new.created_by := old.created_by; new.created_at := old.created_at;
    new.updated_at := now();
    if (new.statut, new.acces_roles, new.acces_teams, new.acces_niveau)
       is distinct from (old.statut, old.acces_roles, old.acces_teams, old.acces_niveau)
       and public.library_level(old.id) <> 'gestion' then
      raise exception 'Seuls le créateur et l’administrateur règlent l’accès et le statut de ce procédé.' using errcode = '42501';
    end if;
    -- Version courante : une version de ce procédé (vide seulement avant une suppression définitive).
    if new.current_version_id is distinct from old.current_version_id
       and not exists (select 1 from public.library_versions v where v.id = new.current_version_id and v.item_id = old.id)
       and not (new.current_version_id is null and public.library_level(old.id) = 'gestion') then
      raise exception 'Version inconnue pour ce procédé.';
    end if;
    v_old_teams := old.acces_teams;
    v_old_club := cardinality(old.acces_roles) > 0 and cardinality(old.acces_teams) = 0;
  end if;
  if exists (select 1 from unnest(new.acces_teams) t
             where not exists (select 1 from public.teams x where x.id = t and x.club_id = new.club_id)) then
    raise exception 'Équipe inconnue dans ce club.';
  end if;
  if me.role <> 'admin' and exists (select 1 from public.teams t where t.club_id = me.club_id) then
    if cardinality(new.acces_roles) > 0 and cardinality(new.acces_teams) = 0 and not v_old_club then
      raise exception 'Seul l’administrateur ouvre une vidéo à tout le club.' using errcode = '42501';
    end if;
    if exists (select unnest(new.acces_teams) except select unnest(v_old_teams) except select unnest(me.team_ids)) then
      raise exception 'Vous ne pouvez ouvrir une vidéo qu’à vos propres équipes.' using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists guard_library_item on public.library_items;
create trigger guard_library_item before insert or update on public.library_items
  for each row execute function public.guard_library_item();

-- Exception nominative possible : staff du club, modification pour un admin ou un coach.
create or replace function public.library_grantee_ok(p_item bigint, p_profile uuid, p_niveau text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles pr join public.library_items i on i.id = p_item
                 where pr.id = p_profile and pr.club_id = i.club_id and pr.role in ('admin', 'coach', 'prepa')
                   and pr.id is distinct from i.created_by
                   and (p_niveau <> 'modification' or pr.role in ('admin', 'coach')));
$$;

-- ------------------------------------------------------------
-- 5) Règles. Procédés et versions ne se créent que par les fonctions
--    ci-dessous ; un fichier ne s'efface que par library_file_release
--    (Worker) ou une suppression définitive (lmfc_v25.sql).
-- ------------------------------------------------------------
alter table public.library_files enable row level security;
alter table public.library_items enable row level security;
alter table public.library_versions enable row level security;
alter table public.library_tags enable row level security;
alter table public.library_item_tags enable row level security;
alter table public.library_access enable row level security;

drop policy if exists library_files_read on public.library_files;
drop policy if exists library_files_insert on public.library_files;
-- Le créateur en clair aussi : la ligne qu'il vient d'envoyer (insert … returning) est lisible tout de suite.
create policy library_files_read on public.library_files for select using (
  (created_by = auth.uid() and (select public.can_manage_videos())) or id in (select public.my_library_files()));
create policy library_files_insert on public.library_files for insert with check (
  (select public.can_manage_videos()) and club_id = (select public.my_club_id()) and created_by = auth.uid());

drop policy if exists library_items_read on public.library_items;
drop policy if exists library_items_update on public.library_items;
create policy library_items_read on public.library_items for select using (id in (select public.my_library_items()));
create policy library_items_update on public.library_items for update
  using (public.library_level(id) in ('modification', 'gestion')) with check (club_id = (select public.my_club_id()));

drop policy if exists library_versions_read on public.library_versions;
create policy library_versions_read on public.library_versions for select using (item_id in (select public.my_library_items()));

drop policy if exists library_tags_read on public.library_tags;
create policy library_tags_read on public.library_tags for select
  using (club_id = (select public.my_club_id()) and (select public.has_role('admin', 'coach', 'prepa')));

drop policy if exists library_item_tags_read on public.library_item_tags;
drop policy if exists library_item_tags_insert on public.library_item_tags;
drop policy if exists library_item_tags_delete on public.library_item_tags;
create policy library_item_tags_read on public.library_item_tags for select using (item_id in (select public.my_library_items()));
create policy library_item_tags_insert on public.library_item_tags for insert with check (
  public.library_level(item_id) in ('modification', 'gestion')
  and exists (select 1 from public.library_tags t where t.id = tag_id and t.club_id = (select public.my_club_id())));
create policy library_item_tags_delete on public.library_item_tags for delete
  using (public.library_level(item_id) in ('modification', 'gestion'));

drop policy if exists library_access_read on public.library_access;
drop policy if exists library_access_write on public.library_access;
create policy library_access_read on public.library_access for select
  using (profile_id = auth.uid() or public.library_level(item_id) = 'gestion');
create policy library_access_write on public.library_access for all
  using (public.library_level(item_id) = 'gestion')
  with check (public.library_level(item_id) = 'gestion' and public.library_grantee_ok(item_id, profile_id, niveau));

revoke all on public.library_files, public.library_items, public.library_versions, public.library_tags,
  public.library_item_tags, public.library_access from anon;
grant select on public.library_files, public.library_items, public.library_versions, public.library_tags,
  public.library_item_tags, public.library_access to authenticated;
grant insert on public.library_files to authenticated;
grant update (titre, description, statut, current_version_id, acces_roles, acces_teams, acces_niveau)
  on public.library_items to authenticated;
grant insert, delete on public.library_item_tags to authenticated;
grant insert, update, delete on public.library_access to authenticated;

-- Filet du rôle lecteur (lmfc_v22.sql) sur chaque nouvelle table.
do $$
declare t text;
begin
  foreach t in array array['library_files', 'library_items', 'library_versions', 'library_tags',
                           'library_item_tags', 'library_access'] loop
    execute format('drop policy if exists lecteur_no_insert on public.%I', t);
    execute format('drop policy if exists lecteur_no_update on public.%I', t);
    execute format('drop policy if exists lecteur_no_delete on public.%I', t);
    execute format('create policy lecteur_no_insert on public.%I as restrictive for insert to authenticated
                      with check (not (select public.is_lecteur()))', t);
    execute format('create policy lecteur_no_update on public.%I as restrictive for update to authenticated
                      using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()))', t);
    execute format('create policy lecteur_no_delete on public.%I as restrictive for delete to authenticated
                      using (not (select public.is_lecteur()))', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 6) Fichiers et versions
-- ------------------------------------------------------------
-- Un fichier ne s'attache à un procédé que si l'on peut déjà le lire, ou si
-- l'on en donne l'empreinte (on a le fichier en main) : jamais par son seul id.
create or replace function public.library_check_file(p_file bigint, p_sha256 text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.library_files f
                 where f.id = p_file and f.club_id = public.my_club_id()
                   and (f.id in (select public.my_library_files()) or (p_sha256 is not null and f.sha256 = lower(p_sha256)))) then
    raise exception 'Fichier vidéo introuvable.' using errcode = 'P0002';
  end if;
end; $$;

-- Fichier déjà envoyé dans le club (même empreinte) : pas de second envoi.
-- Le procédé n'est nommé que s'il est lisible par le compte.
create or replace function public.library_file_by_hash(p_sha256 text)
returns table (file_id bigint, item_id bigint, titre text)
language sql stable security definer set search_path = public as $$
  select f.id, i.id, i.titre
  from public.library_files f
  left join lateral (select it.id, it.titre from public.library_items it
                     join public.library_versions v on v.id = it.current_version_id
                     where v.file_id = f.id and it.id in (select public.my_library_items())
                     order by it.statut <> 'actif', it.id limit 1) i on true
  where public.can_manage_videos() and f.club_id = public.my_club_id() and f.sha256 = lower(p_sha256);
$$;

create or replace function public.library_create_item(p_titre text, p_file bigint, p_sha256 text default null,
  p_description text default null, p_tags bigint[] default '{}')
returns bigint language plpgsql security definer set search_path = public as $$
declare v_item bigint; v_ver bigint;
begin
  if not public.can_manage_videos() or public.is_lecteur() then
    raise exception 'Ajout réservé aux administrateurs et aux coachs.' using errcode = '42501';
  end if;
  perform public.library_check_file(p_file, p_sha256);
  insert into public.library_items (club_id, titre, description)
  values (public.my_club_id(), btrim(p_titre), nullif(btrim(coalesce(p_description, '')), ''))
  returning id into v_item;
  insert into public.library_versions (item_id, file_id, version_no) values (v_item, p_file, 1) returning id into v_ver;
  update public.library_items set current_version_id = v_ver where id = v_item;
  insert into public.library_item_tags (item_id, tag_id)
  select v_item, t.id from public.library_tags t where t.id = any(coalesce(p_tags, '{}')) and t.club_id = public.my_club_id()
  on conflict do nothing;
  return v_item;
end; $$;

-- Nouvelle vidéo pour un procédé : la version courante avance, les séances
-- gardent celle qu'elles utilisent (procedures.library_version_id).
create or replace function public.library_add_version(p_item bigint, p_file bigint, p_sha256 text default null, p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_ver bigint;
begin
  if public.library_level(p_item) not in ('modification', 'gestion') then
    raise exception 'Vous ne pouvez pas modifier ce procédé.' using errcode = '42501';
  end if;
  perform public.library_check_file(p_file, p_sha256);
  perform 1 from public.library_items where id = p_item for update;   -- deux remplacements en même temps : numéros distincts
  insert into public.library_versions (item_id, file_id, version_no, note)
  select p_item, p_file, coalesce(max(v.version_no), 0) + 1, nullif(btrim(coalesce(p_note, '')), '')
  from public.library_versions v where v.item_id = p_item
  returning id into v_ver;
  update public.library_items set current_version_id = v_ver where id = p_item;
  return v_ver;
end; $$;

-- Le Worker l'appelle avant d'effacer un fichier R2 de la bibliothèque :
-- vrai si plus aucune version ne l'utilise (la ligne part alors) ou si
-- elle n'existe pas (envoi interrompu avant l'enregistrement).
create or replace function public.library_file_release(p_path text)
returns boolean language plpgsql security definer set search_path = public as $$
declare f public.library_files;
begin
  if not public.can_manage_videos() or public.is_lecteur()
     or p_path !~ ('^r2/' || public.my_club_id()::text || '/lib/[0-9]+\.[a-zA-Z0-9]{1,8}$') then
    return false;
  end if;
  select * into f from public.library_files where storage_path = p_path;
  if f.id is null then return true; end if;
  if exists (select 1 from public.library_versions v where v.file_id = f.id) then return false; end if;
  if not (f.created_by = auth.uid() or public.is_club_admin()) then return false; end if;
  delete from public.library_files where id = f.id;
  return true;
end; $$;

do $$
declare f text;
begin
  foreach f in array array['library_level(bigint)', 'my_library_items()', 'my_library_files()',
    'library_grantee_ok(bigint, uuid, text)', 'library_file_by_hash(text)',
    'library_create_item(text, bigint, text, text, bigint[])', 'library_add_version(bigint, bigint, text, text)',
    'library_file_release(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- Niveau d'un autre compte : seulement à l'intérieur des fonctions du serveur.
  foreach f in array array['library_level_for(uuid, bigint)', 'library_check_file(bigint, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

commit;
