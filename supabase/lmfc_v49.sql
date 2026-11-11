/* ============================================================
   LMFC Performance — lmfc_v49.sql : timeline de codage (onglet Analyse)
   À exécuter après lmfc_v48.sql. Rejouable et transactionnelle.

   - video_sequences.staff_only : un clip créé depuis l'Analyse est réservé au
     staff. Une règle RESTRICTIVE le retire au joueur par toutes les voies
     (lecture, création, modification, suppression) ; elle s'ajoute aux règles
     existantes sans les réécrire. Les séquences déjà là restent visibles
     (staff_only = false par défaut). La vidéo source, elle, reste celle du
     joueur : c'est le découpage et son codage qui lui sont cachés ;
   - sequence_codes.minute_match : minute du match quand elle est connue
     (le minutage de la séquence, lui, est un temps de la vidéo) ;
   - sequence_descriptors : catalogue des descripteurs du club (nom, catégorie,
     couleur, archivage). Un descripteur EST un tag (sequence_codes.tags) : le
     catalogue le range et le colore, il n'entre dans aucun calcul. Archivé, il
     n'est plus proposé mais reste sur les clips ;
   - écritures en UNE transaction, avec les droits de la personne (RLS) :
       save_sequence_code          crée le clip ET son codage (toujours
                                   réservé au staff), ou modifie découpage
                                   et codage ensemble, sans toucher à la
                                   visibilité d'une séquence existante ;
       bulk_update_sequence_codes  plusieurs clips d'un coup : tags ajoutés ou
                                   retirés, champs communs ; l'action d'un clip
                                   déjà codé n'est jamais changée ; un seul
                                   refus et rien n'est modifié ;
       undo_sequence_changes       défait une opération groupée sans écraser ce
                                   qui a changé depuis (champ par champ, tag
                                   par tag) ;
     rename_sequence_tag tient aussi le catalogue à jour.
   Retour arrière : lmfc_v49_retour.sql (refusé s'il existe un clip réservé au
   staff, un descripteur ou une minute de match).
   ============================================================ */
begin;

-- 1) Clips réservés au staff ------------------------------------------------
alter table public.video_sequences add column if not exists staff_only boolean not null default false;

-- Restrictive, tous rôles, toutes commandes : un joueur ne lit, ne crée, ne
-- modifie ni ne supprime un clip réservé au staff, et ne peut pas le démasquer.
drop policy if exists video_sequences_staff_only on public.video_sequences;
create policy video_sequences_staff_only on public.video_sequences as restrictive for all
  using (not staff_only or (select public.can_read_videos()))
  with check (not staff_only or public.can_manage_player_videos());

-- 2) Minute du match ---------------------------------------------------------
alter table public.sequence_codes
  add column if not exists minute_match smallint check (minute_match between 0 and 150);

-- 3) Catalogue des descripteurs ----------------------------------------------
create table if not exists public.sequence_descriptors (
  id          bigint generated always as identity primary key,
  club_id     bigint not null default public.my_club_id() references public.clubs on delete cascade,
  nom         text not null check (nom = btrim(nom) and char_length(nom) between 1 and 40),
  categorie   text not null default 'autre'
              check (categorie in ('technique', 'tactique', 'comportement', 'defensif', 'offensif', 'autre')),
  couleur     text check (couleur ~ '^#[0-9a-f]{6}$'),
  archived_at timestamptz,
  unique (club_id, nom)
);
alter table public.sequence_descriptors enable row level security;

drop policy if exists sequence_descriptors_read on public.sequence_descriptors;
create policy sequence_descriptors_read on public.sequence_descriptors for select using (
  (select public.can_read_videos()) and club_id = (select public.my_club_id()));
drop policy if exists sequence_descriptors_insert on public.sequence_descriptors;
create policy sequence_descriptors_insert on public.sequence_descriptors for insert with check (
  public.can_manage_player_videos() and club_id = public.my_club_id());
drop policy if exists sequence_descriptors_update on public.sequence_descriptors;
create policy sequence_descriptors_update on public.sequence_descriptors for update using (
  public.can_manage_player_videos() and club_id = public.my_club_id())
with check (public.can_manage_player_videos() and club_id = public.my_club_id());
drop policy if exists sequence_descriptors_delete on public.sequence_descriptors;
create policy sequence_descriptors_delete on public.sequence_descriptors for delete using (
  public.can_manage_player_videos() and club_id = public.my_club_id());

-- Le lecteur ne modifie rien (lmfc_v22.sql).
drop policy if exists lecteur_no_insert on public.sequence_descriptors;
drop policy if exists lecteur_no_update on public.sequence_descriptors;
drop policy if exists lecteur_no_delete on public.sequence_descriptors;
create policy lecteur_no_insert on public.sequence_descriptors as restrictive for insert to authenticated
  with check (not (select public.is_lecteur()));
create policy lecteur_no_update on public.sequence_descriptors as restrictive for update to authenticated
  using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()));
create policy lecteur_no_delete on public.sequence_descriptors as restrictive for delete to authenticated
  using (not (select public.is_lecteur()));

-- 4) Écrire dans un codage ---------------------------------------------------
-- La seule liste des colonnes codées : toutes les écritures passent par ici.
-- p_patch = { colonne: valeur } : une colonne absente garde sa valeur, une
-- colonne à null est vidée ; toute autre clé (joueur, club…) est ignorée.
-- Rend faux si la ligne n'existe pas ou si la RLS refuse de la modifier.
create or replace function public.sequence_code_patch(p_sequence_id bigint, p_patch jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  update public.sequence_codes c
     set (action, resultat, periode, ligne, nb_attaquants, pression, direction, touches, distance, pied, couloir, intervention, lignes,
          zone_depart, zone_arrivee, tiers_depart, tiers_arrivee, x1, y1, x2, y2, categorie, minute_match, tags)
       = (select n.action, n.resultat, n.periode, n.ligne, n.nb_attaquants, n.pression, n.direction, n.touches, n.distance, n.pied, n.couloir,
                 n.intervention, n.lignes, n.zone_depart, n.zone_arrivee, n.tiers_depart, n.tiers_arrivee, n.x1, n.y1, n.x2, n.y2, n.categorie,
                 n.minute_match, coalesce(n.tags, '{}')
            from jsonb_populate_record(c, coalesce(p_patch, '{}'::jsonb)) n)
   where c.sequence_id = p_sequence_id;
  return found;
end; $$;

-- 5) Créer ou modifier un clip et son codage, ensemble -----------------------
-- p_sequence_id null : nouveau clip d'analyse. Club et joueur viennent de la
-- vidéo, jamais du navigateur ; il est TOUJOURS réservé au staff. Sur une
-- séquence existante, la visibilité n'est pas touchée (ni dans un sens ni dans l'autre).
-- Un refus (droits, valeur hors liste) annule tout : jamais de clip sans codage.
drop function if exists public.save_sequence_code(bigint, bigint, text, numeric, numeric, boolean, jsonb);   -- première version de ce fichier
create or replace function public.save_sequence_code(p_sequence_id bigint, p_video_id bigint, p_label text, p_start numeric, p_end numeric,
  p_code jsonb)
returns bigint language plpgsql security invoker set search_path = public as $$
declare
  s public.video_sequences;
begin
  if p_sequence_id is null then
    insert into public.video_sequences (club_id, player_id, video_id, label, start_sec, end_sec, staff_only)
      select v.club_id, v.player_id, v.id, nullif(btrim(coalesce(p_label, '')), ''), p_start, p_end, true
        from public.player_videos v where v.id = p_video_id
      returning * into s;
    if not found then raise exception 'Vidéo introuvable : le clip n''est pas créé.'; end if;
  else
    select * into s from public.video_sequences where id = p_sequence_id;
    if not found then raise exception 'Séquence introuvable.'; end if;
    if (coalesce(p_start, s.start_sec), coalesce(p_end, s.end_sec)) is distinct from (s.start_sec, s.end_sec) then
      update public.video_sequences set start_sec = coalesce(p_start, start_sec), end_sec = coalesce(p_end, end_sec)
       where id = p_sequence_id returning * into s;
      if not found then raise exception 'Vous n''avez pas le droit de modifier cette séquence.'; end if;
    end if;
  end if;
  insert into public.sequence_codes (sequence_id, player_id, club_id) values (s.id, s.player_id, s.club_id)
    on conflict (sequence_id) do nothing;
  if not public.sequence_code_patch(s.id, p_code) then raise exception 'Vous n''avez pas le droit de coder cette séquence.'; end if;
  return s.id;
end; $$;

-- 6) Plusieurs clips d'un coup -----------------------------------------------
-- p_set : champs à écrire (liste fermée, sans points ni tags) ; p_add_tags et
-- p_remove_tags : descripteurs ajoutés (sans doublon, les autres restent) ou
-- retirés. « action » n'est écrite que sur un clip qui n'en a pas.
-- Rend, pour chaque clip réellement modifié, { sequence_id, before, after }
-- (les seuls champs changés) : c'est ce qui permet de défaire l'opération.
create or replace function public.bulk_update_sequence_codes(p_ids bigint[], p_set jsonb, p_add_tags text[], p_remove_tags text[])
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_fields constant text[] := array['action', 'resultat', 'periode', 'ligne', 'nb_attaquants', 'pression', 'direction', 'touches', 'distance',
    'pied', 'couloir', 'intervention', 'lignes', 'zone_depart', 'zone_arrivee', 'tiers_depart', 'tiers_arrivee', 'categorie', 'minute_match'];
  v_ids    bigint[] := array(select distinct i from unnest(p_ids) i where i is not null order by i);
  v_set    jsonb := coalesce(p_set, '{}'::jsonb);
  v_add    text[] := array(select btrim(t) from unnest(coalesce(p_add_tags, '{}')) t where btrim(coalesce(t, '')) <> '');
  v_del    text[] := coalesce(p_remove_tags, '{}');
  v_out    jsonb := '[]'::jsonb;
  v_n      integer := 0;
  c        public.sequence_codes;
  v_patch  jsonb;
  v_old    jsonb;
  v_new    jsonb;
  v_before jsonb;
  v_after  jsonb;
begin
  if cardinality(v_ids) = 0 then raise exception 'Aucune séquence sélectionnée.'; end if;
  if exists (select 1 from jsonb_object_keys(v_set) k where k <> all (v_fields)) then
    raise exception 'Ce champ ne se modifie pas en groupe.';
  end if;
  -- Une séquence pas encore codée reçoit sa ligne de codage, vide.
  insert into public.sequence_codes (sequence_id, player_id, club_id)
    select s.id, s.player_id, s.club_id from public.video_sequences s where s.id = any (v_ids)
    on conflict (sequence_id) do nothing;
  for c in select * from public.sequence_codes where sequence_id = any (v_ids) order by sequence_id for update loop
    v_n := v_n + 1;
    v_patch := (case when c.action is null then v_set else v_set - 'action' end) || jsonb_build_object('tags', to_jsonb(array(
      select t from unnest(c.tags || v_add) with ordinality u(t, o) where t <> all (v_del) group by t order by min(o))));
    begin
      if not public.sequence_code_patch(c.sequence_id, v_patch) then raise exception 'modification refusée'; end if;
    exception when check_violation then
      raise exception 'Séquence % : valeur incompatible avec ce clip (%). Rien n''a été modifié.', c.sequence_id, sqlerrm;
    end;
    v_old := to_jsonb(c);
    select to_jsonb(x) into v_new from public.sequence_codes x where x.sequence_id = c.sequence_id;
    select jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k) into v_before, v_after
      from jsonb_object_keys(v_patch) k where v_old -> k is distinct from v_new -> k;
    if v_after is not null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('sequence_id', c.sequence_id, 'before', v_before, 'after', v_after));
    end if;
  end loop;
  if v_n <> cardinality(v_ids) then
    raise exception '% séquence(s) sur % introuvable(s) ou non modifiable(s) : rien n''a été modifié.', cardinality(v_ids) - v_n, cardinality(v_ids);
  end if;
  return v_out;
end; $$;

-- 7) Défaire une opération groupée -------------------------------------------
-- p_changes : ce que bulk_update_sequence_codes a rendu. Pour chaque clip :
--   - un champ ne reprend sa valeur d'avant que s'il vaut encore celle que
--     l'opération lui avait donnée ; modifié depuis, il n'est pas touché ;
--   - tags : on retire ceux que l'opération avait ajoutés, on remet ceux
--     qu'elle avait retirés ; les autres (ajoutés depuis) ne bougent pas.
-- Rend { restored, kept } : clips rétablis en entier, clips laissés en partie
-- ou en entier (modifiés depuis, introuvables, ou état d'avant devenu invalide).
create or replace function public.undo_sequence_changes(p_changes jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_fields constant text[] := array['action', 'resultat', 'periode', 'ligne', 'nb_attaquants', 'pression', 'direction', 'touches', 'distance',
    'pied', 'couloir', 'intervention', 'lignes', 'zone_depart', 'zone_arrivee', 'tiers_depart', 'tiers_arrivee', 'categorie', 'minute_match'];
  ch         jsonb;
  c          public.sequence_codes;
  k          text;
  v_cur      jsonb;
  v_patch    jsonb;
  v_was      text[];
  v_now      text[];
  v_clean    boolean;
  v_restored integer := 0;
  v_kept     integer := 0;
begin
  for ch in select * from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) loop
    select * into c from public.sequence_codes where sequence_id = (ch ->> 'sequence_id')::bigint for update;
    if not found then v_kept := v_kept + 1; continue; end if;
    v_cur := to_jsonb(c); v_patch := '{}'::jsonb; v_clean := true;
    for k in select jsonb_object_keys(ch -> 'after') loop
      if k = 'tags' then
        v_was := array(select jsonb_array_elements_text(coalesce(ch -> 'before' -> 'tags', '[]'::jsonb)));
        v_now := array(select jsonb_array_elements_text(coalesce(ch -> 'after' -> 'tags', '[]'::jsonb)));
        v_patch := v_patch || jsonb_build_object('tags', to_jsonb(array(
          select t from unnest(c.tags || v_was) with ordinality u(t, o)
           where not (t = any (v_now) and t <> all (v_was))                    -- ajouté par l'opération : retiré
             and (t = any (c.tags) or (t = any (v_was) and t <> all (v_now)))  -- présent, ou retiré par l'opération : remis
           group by t order by min(o))));
      elsif k <> all (v_fields) then
        raise exception 'Ce champ ne s''annule pas.';
      elsif v_cur -> k is not distinct from ch -> 'after' -> k then
        v_patch := v_patch || jsonb_build_object(k, ch -> 'before' -> k);
      else
        v_clean := false;   -- modifié depuis : on n'y touche pas
      end if;
    end loop;
    begin
      if v_patch <> '{}'::jsonb and not public.sequence_code_patch(c.sequence_id, v_patch) then v_clean := false; end if;
    exception when check_violation then
      v_clean := false;     -- l'état d'avant ne tient plus avec ce qui a été codé depuis
    end;
    if v_clean then v_restored := v_restored + 1; else v_kept := v_kept + 1; end if;
  end loop;
  return jsonb_build_object('restored', v_restored, 'kept', v_kept);
end; $$;

-- 8) Renommer (ou supprimer, nouveau nom vide) un tag : clips ET catalogue ----
create or replace function public.rename_sequence_tag(p_old text, p_new text)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  v_new   text := nullif(btrim(coalesce(p_new, '')), '');
  v_count integer;
begin
  if nullif(btrim(coalesce(p_old, '')), '') is null then raise exception 'Tag à renommer manquant.'; end if;
  if char_length(v_new) > 40 then raise exception 'Tag trop long : 40 caractères au plus.'; end if;
  update public.sequence_codes c
     set tags = array(select distinct t from unnest(array_replace(c.tags, p_old, v_new)) t where t is not null order by t)
   where c.tags @> array[p_old] and c.club_id = public.my_club_id();
  get diagnostics v_count = row_count;
  -- Catalogue : le nouveau nom existe déjà (fusion) ou il n'y en a pas (suppression) : l'ancien part.
  if v_new is null or exists (select 1 from public.sequence_descriptors where club_id = public.my_club_id() and nom = v_new) then
    delete from public.sequence_descriptors where club_id = public.my_club_id() and nom = p_old;
  else
    update public.sequence_descriptors set nom = v_new where club_id = public.my_club_id() and nom = p_old;
  end if;
  return v_count;
end; $$;

revoke all on function public.sequence_code_patch(bigint, jsonb) from public, anon;
revoke all on function public.save_sequence_code(bigint, bigint, text, numeric, numeric, jsonb) from public, anon;
revoke all on function public.bulk_update_sequence_codes(bigint[], jsonb, text[], text[]) from public, anon;
revoke all on function public.undo_sequence_changes(jsonb) from public, anon;
revoke all on function public.rename_sequence_tag(text, text) from public, anon;
grant execute on function public.sequence_code_patch(bigint, jsonb) to authenticated;
grant execute on function public.save_sequence_code(bigint, bigint, text, numeric, numeric, jsonb) to authenticated;
grant execute on function public.bulk_update_sequence_codes(bigint[], jsonb, text[], text[]) to authenticated;
grant execute on function public.undo_sequence_changes(jsonb) to authenticated;
grant execute on function public.rename_sequence_tag(text, text) to authenticated;

commit;
