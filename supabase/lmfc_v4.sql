/* ============================================================
   LMFC Performance — migration 23 : préparateur physique,
   préventions, titre facultatif.
   À exécuter APRÈS lmfc_v3.sql. Idempotent (rejouable) et
   transactionnel : en cas d'erreur, rien n'est appliqué.

   1. Quatre rôles : admin, coach, prepa (préparateur physique),
      joueur.
        admin  : tout.
        coach  : séances, joueurs, vidéos, objectifs ; CONSULTE la
                 performance mais ne modifie plus les données
                 physiques ni les tests (ni l'import Excel).
        prepa  : données physiques, tests, import Excel, objectifs
                 et préventions. Pas de vidéos, pas de séances.
        joueur : lecture seule de ses données (inchangé).
      ⚠️ Un coach qui saisissait les données physiques doit passer
      « Préparateur physique » (Mon club → Membres).
   2. Préventions : un nouveau type de point joueur (kind
      'prevention'), avec statut et images, comme un objectif.
      Les préventions de l'ancienne rubrique (table player_programs,
      visibles par le joueur) sont reprises une fois ; la table reste.
   3. Le titre d'un objectif / d'une prévention devient facultatif.
   ============================================================ */
begin;

-- ------------------------------------------------------------
-- 1) Rôle « prepa »
-- ------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'coach', 'prepa', 'joueur'));

alter table public.club_access drop constraint if exists club_access_role_check;
alter table public.club_access add constraint club_access_role_check
  check (role in ('admin', 'coach', 'prepa', 'joueur'));

-- can_edit() (séances, fiches joueurs, schémas, logos) : inchangé, admin + coach.
create or replace function public.is_performance_editor()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'prepa');
$$;
create or replace function public.can_view_performance()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach', 'prepa');
$$;
create or replace function public.can_manage_videos()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach');
$$;
create or replace function public.can_manage_plans()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach', 'prepa');
$$;
create or replace function public.is_video_stats_staff()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach');
$$;

create or replace function public.club_set_member_role(p_profile_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_club_id bigint;
begin
  select club_id into v_club_id from public.profiles where id = auth.uid() and role = 'admin';
  if v_club_id is null then raise exception 'Action réservée à l’administrateur du club.'; end if;
  if p_profile_id = auth.uid() then raise exception 'Vous ne pouvez pas modifier votre propre rôle.'; end if;
  if p_role not in ('admin', 'coach', 'prepa') then
    raise exception 'Rôle invalide. Pour le rôle Joueur, associez une fiche joueur.';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and club_id = v_club_id) then
    raise exception 'Ce membre ne fait pas partie de votre club.';
  end if;
  update public.players set auth_user_id = null where auth_user_id = p_profile_id;
  update public.profiles set role = p_role where id = p_profile_id and club_id = v_club_id;
end; $$;
revoke all on function public.club_set_member_role(uuid, text) from public, anon;
grant execute on function public.club_set_member_role(uuid, text) to authenticated;

-- Photo d'un joueur : c'est de l'identité, pas une donnée physique.
-- Le coach (fiche joueur) et le préparateur (fiche Performance) la changent.
drop policy if exists player_photos_write  on storage.objects;
drop policy if exists player_photos_update on storage.objects;
drop policy if exists player_photos_delete on storage.objects;
create policy player_photos_write on storage.objects for insert with check (
  bucket_id = 'player-photos' and (public.can_edit() or public.is_performance_editor())
  and (storage.foldername(name))[1] = public.my_club_id()::text
);
create policy player_photos_update on storage.objects for update
  using (bucket_id = 'player-photos' and (public.can_edit() or public.is_performance_editor())
    and (storage.foldername(name))[1] = public.my_club_id()::text)
  with check (bucket_id = 'player-photos' and (public.can_edit() or public.is_performance_editor())
    and (storage.foldername(name))[1] = public.my_club_id()::text);
create policy player_photos_delete on storage.objects for delete using (
  bucket_id = 'player-photos' and (public.can_edit() or public.is_performance_editor())
  and (storage.foldername(name))[1] = public.my_club_id()::text
);

-- Le préparateur enregistre le chemin de la photo sur la fiche, et
-- seulement cette colonne : le reste de la fiche reste au staff (can_edit).
create or replace function public.set_player_photo(p_player_id bigint, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.can_edit() or public.is_performance_editor()) then
    raise exception 'Action réservée au staff.';
  end if;
  if p_path is not null and split_part(p_path, '/', 1) <> public.my_club_id()::text then
    raise exception 'Photo hors du dossier du club.';
  end if;
  update public.players set photo_path = p_path
   where id = p_player_id and club_id = public.my_club_id();
  if not found then raise exception 'Joueur introuvable dans votre club.'; end if;
end; $$;
revoke all on function public.set_player_photo(bigint, text) from public, anon;
grant execute on function public.set_player_photo(bigint, text) to authenticated;

-- ------------------------------------------------------------
-- 2) Préventions et 3) titre facultatif
-- ------------------------------------------------------------
alter table public.player_performance_notes
  drop constraint if exists player_performance_notes_kind_check;
alter table public.player_performance_notes
  add constraint player_performance_notes_kind_check
  check (kind in ('strength', 'improvement', 'objective', 'prevention'));
alter table public.player_performance_notes alter column title drop not null;

-- Reprise de l'ancienne rubrique Préventions (une seule fois : une ligne
-- déjà reprise a le même joueur, le même type et la même date de création).
-- Seules les préventions visibles par le joueur sont reprises : un point
-- est toujours visible par son joueur, ce que « staff uniquement » interdit.
do $$
begin
  if to_regclass('public.player_programs') is not null then
    insert into public.player_performance_notes
      (club_id, player_id, kind, title, body, status, sort_order, created_by, created_at, updated_at)
    select pp.club_id, pp.player_id, 'prevention', nullif(btrim(pp.title), ''),
           nullif(concat_ws(E'\n\n',
             nullif(btrim(pp.body), ''),
             case when nullif(btrim(pp.dosage), '') is not null then 'Dosage : ' || btrim(pp.dosage) end,
             case when pp.start_date is not null or pp.end_date is not null then
               'Période : ' || coalesce(to_char(pp.start_date, 'DD/MM/YYYY'), '…') || ' → ' || coalesce(to_char(pp.end_date, 'DD/MM/YYYY'), '…') end,
             case when nullif(btrim(pp.progress_note), '') is not null then 'Suivi : ' || btrim(pp.progress_note) end
           ), ''),
           case pp.status when 'termine' then 'achieved' else 'active' end,
           0, pp.created_by, pp.created_at, pp.updated_at
    from public.player_programs pp
    where pp.visible_to_player
      and not exists (select 1 from public.player_performance_notes n
                      where n.player_id = pp.player_id and n.kind = 'prevention' and n.created_at = pp.created_at);
  end if;
end $$;

commit;
