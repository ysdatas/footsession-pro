/* ============================================================
   LMFC Performance — lmfc_v25.sql : bibliothèque vidéo (2/2)
   Tags, recherche, séances, suppression. À exécuter APRÈS
   lmfc_v24.sql. Rejouable, transactionnelle.

   - Tags partagés du club : jamais deux tags de même clé (casse,
     accents, espaces, « # ») ; renommer, fusionner, supprimer (un tag
     utilisé seulement en confirmant le nombre de procédés touchés).
   - Recherche : texte (titre, description, tags) et tags, « tous » ou
     « au moins un », par pages.
   - Séance : un procédé de séance garde la VERSION utilisée
     (procedures.library_version_id) et le titre du moment. Le lien est
     refusé si une personne qui voit la séance ne peut pas lire la vidéo :
     l'accès à la séance ne donne jamais accès à la vidéo. Le lien public
     d'une séance ne montre rien de la bibliothèque.
   - Suppression définitive refusée tant qu'une séance, ou la corbeille,
     utilise le procédé ou la version.
   ============================================================ */
begin;

-- ------------------------------------------------------------
-- 1) Procédé de séance → version de la bibliothèque
-- ------------------------------------------------------------
alter table public.procedures add column if not exists library_item_id bigint references public.library_items;
alter table public.procedures add column if not exists library_version_id bigint references public.library_versions;
alter table public.procedures add column if not exists library_titre text;
create index if not exists procedures_library_item_idx on public.procedures (library_item_id) where library_item_id is not null;
create index if not exists procedures_library_version_idx on public.procedures (library_version_id) where library_version_id is not null;

-- ------------------------------------------------------------
-- 2) Tags
-- ------------------------------------------------------------
create or replace function public.library_tag_clean(p text)
returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '^\s*#+', ''), '\s+', ' ', 'g'));
$$;

-- Le tag de cette clé s'il existe déjà, sinon un nouveau : { id, label, created }.
create or replace function public.library_tag_ensure(p_label text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_label text := public.library_tag_clean(p_label); t public.library_tags;
begin
  if not public.can_manage_videos() or public.is_lecteur() then
    raise exception 'Création de tags réservée aux administrateurs et aux coachs.' using errcode = '42501';
  end if;
  if public.library_tag_key(v_label) = '' or length(v_label) > 40 then
    raise exception 'Tag vide ou trop long (40 caractères au plus).';
  end if;
  select * into t from public.library_tags where club_id = public.my_club_id() and key = public.library_tag_key(v_label);
  if t.id is not null then return jsonb_build_object('id', t.id, 'label', t.label, 'created', false); end if;
  insert into public.library_tags (club_id, label) values (public.my_club_id(), v_label) on conflict do nothing returning * into t;
  if t.id is null then   -- créé au même instant par quelqu'un d'autre
    select * into t from public.library_tags where club_id = public.my_club_id() and key = public.library_tag_key(v_label);
    return jsonb_build_object('id', t.id, 'label', t.label, 'created', false);
  end if;
  return jsonb_build_object('id', t.id, 'label', t.label, 'created', true);
end; $$;

-- Renommer, fusionner, supprimer : l'admin, ou le créateur du tag (coach)
-- si tous les procédés qui le portent lui sont modifiables.
create or replace function public.library_tag_manageable(p_tag bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.library_tags t
    where t.id = p_tag and t.club_id = public.my_club_id()
      and (public.is_club_admin()
           or (t.created_by = auth.uid() and public.has_role('coach')
               and not exists (select 1 from public.library_item_tags it where it.tag_id = t.id
                               and public.library_level(it.item_id) not in ('modification', 'gestion')))));
$$;

create or replace function public.library_tag_rename(p_tag bigint, p_label text)
returns void language plpgsql security definer set search_path = public as $$
declare v_label text := public.library_tag_clean(p_label); v_other text;
begin
  if not public.library_tag_manageable(p_tag) then raise exception 'Vous ne pouvez pas renommer ce tag.' using errcode = '42501'; end if;
  if public.library_tag_key(v_label) = '' or length(v_label) > 40 then raise exception 'Tag vide ou trop long (40 caractères au plus).'; end if;
  select label into v_other from public.library_tags
   where club_id = public.my_club_id() and key = public.library_tag_key(v_label) and id <> p_tag;
  if v_other is not null then
    raise exception 'Le tag #% existe déjà : fusionnez les deux.', v_other using errcode = '23505';
  end if;
  update public.library_tags set label = v_label where id = p_tag;
end; $$;

-- Les procédés de p_from passent sur p_into, puis p_from disparaît. Renvoie le nombre de procédés repris.
create or replace function public.library_tag_merge(p_from bigint, p_into bigint)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_from = p_into or not public.library_tag_manageable(p_from)
     or not exists (select 1 from public.library_tags where id = p_into and club_id = public.my_club_id()) then
    raise exception 'Fusion impossible.' using errcode = '42501';
  end if;
  select count(*) into n from public.library_item_tags where tag_id = p_from;
  insert into public.library_item_tags (item_id, tag_id)
  select item_id, p_into from public.library_item_tags where tag_id = p_from on conflict do nothing;
  delete from public.library_tags where id = p_from;
  return n;
end; $$;

-- p_expected : nombre de procédés qui portent le tag, tel qu'affiché à la
-- personne. Différent (ou absent) alors que le tag est utilisé : refus.
create or replace function public.library_tag_delete(p_tag bigint, p_expected integer default 0)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.library_tag_manageable(p_tag) then raise exception 'Vous ne pouvez pas supprimer ce tag.' using errcode = '42501'; end if;
  select count(*) into n from public.library_item_tags where tag_id = p_tag;
  if n > 0 and n is distinct from p_expected then
    raise exception 'Ce tag est utilisé par % procédé(s) : confirmez ce nombre pour le leur retirer.', n using errcode = 'P0001';
  end if;
  delete from public.library_tags where id = p_tag;
  return n;
end; $$;

-- Tags du club, avec le nombre de procédés visibles qui les portent.
create or replace function public.library_tags_list()
returns table (id bigint, label text, key text, uses integer, manageable boolean)
language sql stable security invoker set search_path = public as $$
  select t.id, t.label, t.key, coalesce(c.n, 0)::int, public.library_tag_manageable(t.id)
  from public.library_tags t
  left join (select it.tag_id, count(*) as n from public.library_item_tags it group by it.tag_id) c on c.tag_id = t.id
  order by coalesce(c.n, 0) desc, t.key;
$$;

-- ------------------------------------------------------------
-- 3) Recherche (sans miniatures : la page les lit pour les cartes affichées)
-- ------------------------------------------------------------
create or replace function public.library_search(p_q text default '', p_tags bigint[] default '{}',
  p_mode text default 'all', p_statut text default 'actif', p_limit integer default 48, p_offset integer default 0)
returns table (id bigint, titre text, description text, statut text, created_by uuid, updated_at timestamptz,
  version_id bigint, version_no integer, file_id bigint, storage_path text, duree_sec numeric, tag_ids bigint[], total bigint)
language sql stable security invoker set search_path = public as $$
  with w as (
    select distinct x as word from unnest(string_to_array(public.library_text_key(p_q), ' ')) x where x <> ''
  ), tagged as (
    select it.item_id from public.library_item_tags it
    where it.tag_id = any(coalesce(p_tags, '{}'))
    group by it.item_id
    having p_mode = 'any' or count(*) = cardinality(p_tags)
  ), hits as (
    select i.id, i.titre, i.description, i.statut, i.created_by, i.updated_at, i.current_version_id, count(*) over () as n
    from public.library_items i
    where i.club_id = public.my_club_id()
      and i.statut = coalesce(p_statut, 'actif')
      and (coalesce(p_statut, 'actif') <> 'retire' or public.library_level(i.id) = 'gestion')
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
         h.n
  from hits h
  left join public.library_versions v on v.id = h.current_version_id
  left join public.library_files f on f.id = v.file_id
  order by h.updated_at desc, h.id desc;
$$;

-- ------------------------------------------------------------
-- 4) Séance et vidéo : qui voit l'une sans l'autre
-- ------------------------------------------------------------
-- Même règle que session_level (lmfc_v22.sql), pour un compte donné.
-- tests/library-sql.test.mjs vérifie qu'elles répondent pareil.
create or replace function public.session_level_for(p_profile uuid, p_id bigint, p_club bigint, p_created_by uuid, p_acces text, p_team bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when me.id is null or p_club is distinct from me.club_id or me.role in ('joueur', 'lecteur') then 'aucun'
    when me.role = 'admin' then 'modification'
    when p_created_by = me.id then 'modification'
    when a.niveau = 'modification' and me.role not in ('admin', 'coach') then 'lecture'
    when a.niveau is not null then a.niveau
    when p_acces = 'club' then case when me.role in ('admin', 'coach') then 'modification' else 'lecture' end
    when p_team is not null and p_team = any(me.team_ids) then case when me.role in ('coach', 'analyste') then 'modification' else 'lecture' end
    when p_team is null and cardinality(me.team_ids) > 0 then 'lecture'
    when not exists (select 1 from public.teams t where t.club_id = me.club_id)
      then case when me.role in ('coach', 'analyste') then 'modification' else 'lecture' end
    when me.lecture_club then 'lecture'
    else 'aucun'
  end
  from (select 1) x
  left join public.profiles me on me.id = p_profile
  left join public.session_access a on a.session_id = p_id and a.profile_id = p_profile;
$$;

create or replace function public.library_gaps_internal(p_session bigint, p_item bigint)
returns table (profile_id uuid, nom text, role text)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.nom, pr.role
  from public.sessions s join public.profiles pr on pr.club_id = s.club_id
  where s.id = p_session and pr.role in ('admin', 'coach', 'prepa')
    and public.session_level_for(pr.id, s.id, s.club_id, s.created_by, s.acces, s.team_id) <> 'aucun'
    and public.library_level_for(pr.id, p_item) = 'aucun'
  order by pr.nom;
$$;
-- Avant d'ajouter une vidéo : les personnes qui voient la séance sans pouvoir la lire.
create or replace function public.library_session_gaps(p_session bigint, p_item bigint)
returns table (profile_id uuid, nom text, role text)
language sql stable security definer set search_path = public as $$
  select g.profile_id, g.nom, g.role from public.library_gaps_internal(p_session, p_item) g
  where public.session_access_level(p_session) <> 'aucun' and public.library_level(p_item) <> 'aucun';
$$;
-- Séance ouverte : pour chaque vidéo déjà liée, qui ne peut plus la lire (accès changés depuis).
create or replace function public.library_session_check(p_session bigint)
returns table (procedure_id bigint, profile_id uuid, nom text)
language sql stable security definer set search_path = public as $$
  select p.id, g.profile_id, g.nom from public.procedures p
  cross join lateral public.library_gaps_internal(p.session_id, p.library_item_id) g
  where p.session_id = p_session and p.library_item_id is not null
    and public.session_access_level(p_session) <> 'aucun';
$$;

-- Procédés de la corbeille (séance ou procédé supprimés) qui utilisent ce procédé ou cette version.
create or replace function public.library_trash_uses(p_item bigint, p_version bigint)
returns integer language plpgsql stable security definer set search_path = public as $$
declare n integer;
begin
  if to_regclass('public.trash') is null then return 0; end if;
  execute $q$select count(*)::int from public.trash t where t.tbl = 'procedures'
    and (t.data->>'library_item_id' = $1::text or t.data->>'library_version_id' = $2::text)$q$
    into n using p_item, p_version;
  return n;
end; $$;

-- Garde du lien, appliquée à toute écriture (page, API directe).
create or replace function public.guard_procedure_library()
returns trigger language plpgsql security definer set search_path = public as $$
declare v record; v_club bigint; v_names text; v_n integer;
begin
  if tg_op = 'UPDATE' and new.library_version_id is not distinct from old.library_version_id then
    new.library_item_id := old.library_item_id; new.library_titre := old.library_titre;   -- titre figé : jamais réécrit à la main
    return new;
  end if;
  if new.library_version_id is null then
    new.library_item_id := null; new.library_titre := null;
    return new;
  end if;
  if auth.uid() is null then return new; end if;   -- SQL Editor, tâches serveur
  -- Procédé qui revient de la corbeille : il reprend sa vidéo telle quelle.
  if tg_op = 'INSERT' and public.library_trash_uses(null, new.library_version_id) > 0 then
    if exists (select 1 from public.trash t where t.tbl = 'procedures' and t.row_id = new.id
               and t.data->>'library_version_id' = new.library_version_id::text) then
      return new;
    end if;
  end if;
  select lv.id, lv.item_id, i.titre, i.statut, i.club_id into v
    from public.library_versions lv join public.library_items i on i.id = lv.item_id
   where lv.id = new.library_version_id;
  select club_id into v_club from public.sessions where id = new.session_id;
  if v.id is null or v.club_id is distinct from v_club then
    raise exception 'Vidéo de la bibliothèque introuvable.' using errcode = 'P0002';
  end if;
  if public.library_level(v.item_id) = 'aucun' then
    raise exception 'Vous n’avez pas accès à cette vidéo de la bibliothèque.' using errcode = '42501';
  end if;
  if v.statut <> 'actif' and (tg_op = 'INSERT' or old.library_item_id is distinct from v.item_id) then
    raise exception 'Procédé archivé ou retiré de la bibliothèque : il ne peut plus être ajouté à une séance.';
  end if;
  select string_agg(g.nom, ', '), count(*) into v_names, v_n from public.library_gaps_internal(new.session_id, v.item_id) g;
  if v_n > 0 then
    raise exception 'Vidéo non partageable : % % cette séance sans avoir accès à cette vidéo.',
      v_names, case when v_n > 1 then 'voient' else 'voit' end
      using errcode = 'P0001', hint = 'library_gaps';
  end if;
  new.library_item_id := v.item_id;
  if tg_op = 'INSERT' or old.library_item_id is distinct from v.item_id then new.library_titre := v.titre;
  else new.library_titre := old.library_titre; end if;
  return new;
end; $$;
drop trigger if exists guard_procedure_library on public.procedures;
create trigger guard_procedure_library before insert or update of library_version_id, library_item_id, library_titre
  on public.procedures for each row execute function public.guard_procedure_library();

-- Lier (ou délier : p_version null) la vidéo d'un procédé de séance. Hors de la
-- sauvegarde automatique : un refus ne bloque jamais le reste de la séance.
create or replace function public.library_link_procedure(p_procedure bigint, p_version bigint)
returns table (item_id bigint, version_id bigint, titre text)
language plpgsql security invoker set search_path = public as $$
begin
  return query update public.procedures p set library_version_id = p_version where p.id = p_procedure
    returning p.library_item_id, p.library_version_id, p.library_titre;
  if not found then raise exception 'Procédé introuvable ou séance en lecture seule.' using errcode = '42501'; end if;
end; $$;

-- Séances qui utilisent un procédé : celles que le compte peut voir…
create or replace function public.library_usages(p_item bigint)
returns table (session_id bigint, titre text, date_seance date, procedure_id bigint, procedure_nom text, version_no integer)
language sql stable security invoker set search_path = public as $$
  select s.id, s.titre, s.date_seance, p.id, p.nom, v.version_no
  from public.procedures p join public.sessions s on s.id = p.session_id
  left join public.library_versions v on v.id = p.library_version_id
  where p.library_item_id = p_item and public.library_level(p_item) <> 'aucun'
  order by s.date_seance desc, p.ordre;
$$;
-- … et le total, séances invisibles et corbeille comprises.
create or replace function public.library_usage_count(p_item bigint)
returns table (seances integer, corbeille integer)
language sql stable security definer set search_path = public as $$
  select (select count(distinct p.session_id)::int from public.procedures p where p.library_item_id = p_item),
         public.library_trash_uses(p_item, null)
  where public.library_level(p_item) <> 'aucun';
$$;

-- Séances où le compte peut ajouter une vidéo (« Ajouter à une séance »).
create or replace function public.my_editable_sessions(p_limit integer default 40)
returns table (id bigint, titre text, date_seance date)
language sql stable security invoker set search_path = public as $$
  select s.id, s.titre, s.date_seance from public.sessions s
  where s.club_id = public.my_club_id()
    and public.session_level(s.id, s.club_id, s.created_by, s.acces, s.team_id) = 'modification'
  order by s.date_seance desc, s.id desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

-- Lien public de la séance (lmfc_v9.sql) : rien de la bibliothèque.
create or replace function public.get_shared_session(p_token text)
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'session', to_jsonb(s) - 'share_token' - 'notes' - 'created_by',
    'club', (select jsonb_build_object('nom', c.nom, 'logo_path', c.logo_path, 'color', c.color) from public.clubs c where c.id = s.club_id),
    'procedures', coalesce((select jsonb_agg(to_jsonb(p) - 'library_item_id' - 'library_version_id' - 'library_titre'
        || jsonb_build_object('image_path', (select t.image_path from public.tactical_schemas t where t.procedure_id = p.id))
        order by p.ordre)
      from public.procedures p where p.session_id = s.id), '[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pl.id, 'nom', pl.nom, 'prenom', pl.prenom, 'numero', pl.numero,
        'present', coalesce(a.present, false), 'invite', a.invite)
        order by pl.nom, pl.prenom)
      from public.attendance a join public.players pl on pl.id = a.player_id
      where a.session_id = s.id), '[]'::jsonb)
  )
  from public.sessions s where s.share_token = p_token limit 1;
$$;
grant execute on function public.get_shared_session(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 5) Suppression définitive (renvoie les fichiers R2 à effacer)
-- ------------------------------------------------------------
create or replace function public.library_purge_item(p_item bigint)
returns text[] language plpgsql security definer set search_path = public as $$
declare v_files bigint[]; v_paths text[]; n_live integer; n_trash integer;
begin
  if public.library_level(p_item) <> 'gestion' or public.is_lecteur() then
    raise exception 'Suppression réservée au créateur et à l’administrateur.' using errcode = '42501';
  end if;
  select count(*) into n_live from public.procedures where library_item_id = p_item;
  n_trash := public.library_trash_uses(p_item, null);
  if n_live + n_trash > 0 then
    raise exception 'Procédé utilisé par % procédé(s) de séance (dont % dans la corbeille) : archivez-le ou retirez-le plutôt.',
      n_live + n_trash, n_trash using errcode = 'P0001';
  end if;
  select array_agg(distinct file_id) into v_files from public.library_versions where item_id = p_item;
  update public.library_items set current_version_id = null where id = p_item;
  delete from public.library_items where id = p_item;
  with d as (delete from public.library_files f where f.id = any(coalesce(v_files, '{}'))
               and not exists (select 1 from public.library_versions v where v.file_id = f.id) returning f.storage_path)
  select coalesce(array_agg(storage_path), '{}') into v_paths from d;
  return v_paths;
end; $$;

create or replace function public.library_purge_version(p_version bigint)
returns text[] language plpgsql security definer set search_path = public as $$
declare v record; v_paths text[];
begin
  select lv.id, lv.item_id, lv.file_id, i.current_version_id as cur into v
    from public.library_versions lv join public.library_items i on i.id = lv.item_id where lv.id = p_version;
  if v.id is null or public.library_level(v.item_id) <> 'gestion' or public.is_lecteur() then
    raise exception 'Suppression réservée au créateur et à l’administrateur.' using errcode = '42501';
  end if;
  if v.cur = v.id then raise exception 'La version en cours ne se supprime pas : remplacez d’abord la vidéo.'; end if;
  if exists (select 1 from public.procedures where library_version_id = p_version)
     or public.library_trash_uses(null, p_version) > 0 then
    raise exception 'Cette version est utilisée par une séance (ou la corbeille) : elle est conservée.' using errcode = 'P0001';
  end if;
  delete from public.library_versions where id = p_version;
  with d as (delete from public.library_files f where f.id = v.file_id
               and not exists (select 1 from public.library_versions x where x.file_id = f.id) returning f.storage_path)
  select coalesce(array_agg(storage_path), '{}') into v_paths from d;
  return v_paths;
end; $$;

do $$
declare f text;
begin
  foreach f in array array['library_tag_ensure(text)', 'library_tag_manageable(bigint)', 'library_tag_rename(bigint, text)',
    'library_tag_merge(bigint, bigint)', 'library_tag_delete(bigint, integer)', 'library_tags_list()',
    'library_search(text, bigint[], text, text, integer, integer)', 'library_session_gaps(bigint, bigint)',
    'library_session_check(bigint)', 'library_link_procedure(bigint, bigint)', 'library_usages(bigint)',
    'library_usage_count(bigint)', 'my_editable_sessions(integer)', 'library_purge_item(bigint)',
    'library_purge_version(bigint)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['session_level_for(uuid, bigint, bigint, uuid, text, bigint)',
    'library_gaps_internal(bigint, bigint)', 'library_trash_uses(bigint, bigint)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

commit;
