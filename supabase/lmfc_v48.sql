/* ============================================================
   LMFC Performance — lmfc_v48.sql : codage des séquences (onglet Analyse)
   À exécuter après lmfc_v47.sql. Rejouable et transactionnelle.

   - player_videos : poste (DC … LD) et lieu (domicile / extérieur) de la
     vidéo, repris par toutes ses séquences ;
   - sequence_codes : le codage d'une séquence, une ligne au plus par
     séquence : action (passe, tir, centre, duel terrestre, duel aérien,
     récupération), résultat, contexte, zones, tiers, points x/y (0 à 100 de
     gauche à droite ; on attaque vers la gauche, comme sur le schéma des zones
     du club : notre but est à x = 100), tags, et les champs propres à l'action :
     sens, type, touches, pied, lignes adverses cassées (passe) ; zone de tir,
     pied, touches (tir) ; couloir, pied, type (centre) ; type de duel
     (terrestre) ; contexte et intervention (aérien). « categorie » porte la
     sous-famille de l'action : zone de tir, type de centre, type de duel
     terrestre, contexte du duel aérien.
     Zones (clé = nom du schéma) : initiation = Arrière, base = Zone 1,
     carre = Zone 2, couloir_droit = Large droite, couloir_gauche = Large gauche,
     axe = Profondeur axiale ; profondeur_droite et profondeur_gauche inchangées.
     Une information absente reste inconnue (null) : rien n'est déduit ici ;
   - rename_sequence_tag : renommer ou supprimer un tag partout où l'on a le
     droit de modifier le codage.

   Lecture : comme les vidéos pour le staff (admin, coach, analyste, lecteur,
   sur les joueurs qu'il voit). Écriture : admin, coach, analyste avec le
   niveau « modification » sur le joueur. Le joueur n'y a pas accès.
   Une séquence supprimée part à la corbeille avec son codage et revient avec.
   Retour arrière : lmfc_v48_retour.sql (refusé si des séquences sont codées).
   Déjà passée dans une version précédente (passe et duels seulement) : la repasser
   telle quelle, elle ajoute les colonnes et remplace les règles sans toucher aux données.
   ============================================================ */
begin;

-- 1) Poste et lieu de la vidéo -------------------------------------------
alter table public.player_videos
  add column if not exists poste text,
  add column if not exists lieu  text;
alter table public.player_videos drop constraint if exists player_videos_poste_check;
alter table public.player_videos add constraint player_videos_poste_check
  check (poste in ('DC', 'DD', 'DG', 'MC', 'MR', 'MOC', 'BU', 'AID', 'AIG', 'LG', 'LD'));
alter table public.player_videos drop constraint if exists player_videos_lieu_check;
alter table public.player_videos add constraint player_videos_lieu_check
  check (lieu in ('domicile', 'exterieur'));

-- 2) Codage d'une séquence -----------------------------------------------
-- Le codage porte le joueur et le club de SA séquence : clé composée.
create unique index if not exists video_sequences_id_player_club_idx
  on public.video_sequences (id, player_id, club_id);

create table if not exists public.sequence_codes (
  id            bigint generated always as identity primary key,
  sequence_id   bigint not null unique,
  player_id     bigint not null,
  club_id       bigint not null,
  action        text,
  resultat      text,
  periode       smallint check (periode in (1, 2)),
  ligne         smallint check (ligne between 1 and 4),
  nb_attaquants smallint check (nb_attaquants between 1 and 3),
  pression      boolean,
  direction     text check (direction in ('horizontale', 'verticale', 'retrait')),
  touches       smallint check (touches between 1 and 3),
  distance      text check (distance in ('courte', 'longue', 'profondeur')),
  zone_depart   text check (zone_depart in ('initiation', 'base', 'carre', 'couloir_droit', 'couloir_gauche', 'profondeur_droite', 'profondeur_gauche', 'axe')),
  zone_arrivee  text check (zone_arrivee in ('initiation', 'base', 'carre', 'couloir_droit', 'couloir_gauche', 'profondeur_droite', 'profondeur_gauche', 'axe')),
  tiers_depart  smallint check (tiers_depart between 1 and 3),
  tiers_arrivee smallint check (tiers_arrivee between 1 and 3),
  x1 real check (x1 between 0 and 100), y1 real check (y1 between 0 and 100),
  x2 real check (x2 between 0 and 100), y2 real check (y2 between 0 and 100),
  categorie     text,
  tags          text[] not null default '{}',
  updated_by    uuid,
  updated_at    timestamptz not null default now(),
  foreign key (sequence_id, player_id, club_id)
    references public.video_sequences (id, player_id, club_id) on delete cascade,
  constraint sequence_codes_point_check check ((x1 is null) = (y1 is null) and (x2 is null) = (y2 is null)),
  constraint sequence_codes_tags_check check (cardinality(tags) <= 20 and array_position(tags, null) is null
    and array_position(tags, '') is null and char_length(array_to_string(tags, '|')) <= 800)
);

-- Colonnes et règles par action. Rejouées à chaque passage : la table peut
-- venir d'une version précédente de ce fichier (passe et duels seulement).
alter table public.sequence_codes
  add column if not exists pied         text check (pied in ('droit', 'gauche')),
  add column if not exists couloir      text check (couloir in ('droit', 'gauche')),
  add column if not exists intervention text check (intervention in ('marquage', 'couverture', 'anticipation', 'interception')),
  add column if not exists lignes       text check (lignes in ('aucune', 'premiere', 'mediane', 'derniere', 'plusieurs'));
alter table public.sequence_codes
  drop constraint if exists sequence_codes_action_check,
  drop constraint if exists sequence_codes_resultat_check,
  drop constraint if exists sequence_codes_categorie_check,
  drop constraint if exists sequence_codes_passe_check,
  drop constraint if exists sequence_codes_champs_check;
-- coalesce : sans action, aucune de ces règles ne passe « par défaut » (null).
alter table public.sequence_codes
  add constraint sequence_codes_action_check check (action in ('passe', 'tir', 'centre', 'duel_sol', 'duel_air', 'recuperation')),
  add constraint sequence_codes_resultat_check check (resultat is null
    or (coalesce(action, '') = 'tir' and resultat in ('but', 'cadre', 'non_cadre', 'contre'))
    or (coalesce(action, '') in ('passe', 'centre', 'duel_sol', 'duel_air') and resultat in ('ok', 'ko'))),
  add constraint sequence_codes_categorie_check check (categorie is null
    or (coalesce(action, '') = 'tir' and categorie in ('surface', 'hors_surface', 'six_metres'))
    or (coalesce(action, '') = 'centre' and categorie in ('tendu', 'aerien', 'retrait'))
    or (coalesce(action, '') = 'duel_sol' and categorie in ('marquage', 'interception', '1c1', 'couverture', 'anticipation', 'retour_defensif'))
    or (coalesce(action, '') = 'duel_air' and categorie in ('cpa', 'relance_adverse', 'degagement', 'gestion_profondeur'))),
  -- Un champ propre à une action reste vide pour les autres.
  add constraint sequence_codes_champs_check check (
    (coalesce(action, '') = 'passe' or (direction is null and distance is null and zone_arrivee is null and tiers_arrivee is null and lignes is null))
    and (coalesce(action, '') in ('passe', 'centre') or (x2 is null and y2 is null))
    and (coalesce(action, '') in ('passe', 'tir') or touches is null)
    and (coalesce(action, '') in ('passe', 'tir', 'centre') or pied is null)
    and (coalesce(action, '') = 'centre' or couloir is null)
    and (coalesce(action, '') = 'duel_air' or intervention is null));

create index if not exists sequence_codes_player_idx on public.sequence_codes (player_id);
create index if not exists sequence_codes_tags_idx on public.sequence_codes using gin (tags);

-- Qui a codé et quand : posés par le serveur, jamais par le navigateur.
create or replace function public.sequence_codes_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end; $$;
drop trigger if exists sequence_codes_stamp on public.sequence_codes;
create trigger sequence_codes_stamp before insert or update on public.sequence_codes
  for each row execute function public.sequence_codes_stamp();

-- 3) Droits ----------------------------------------------------------------
alter table public.sequence_codes enable row level security;

drop policy if exists sequence_codes_read on public.sequence_codes;
create policy sequence_codes_read on public.sequence_codes for select using (
  (select public.can_read_videos()) and club_id = (select public.my_club_id())
  and player_id in (select public.my_visible_players()));
drop policy if exists sequence_codes_insert on public.sequence_codes;
create policy sequence_codes_insert on public.sequence_codes for insert with check (
  public.can_manage_player_videos() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');
drop policy if exists sequence_codes_update on public.sequence_codes;
create policy sequence_codes_update on public.sequence_codes for update using (
  public.can_manage_player_videos() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification')
with check (
  public.can_manage_player_videos() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');
drop policy if exists sequence_codes_delete on public.sequence_codes;
create policy sequence_codes_delete on public.sequence_codes for delete using (
  public.can_manage_player_videos() and club_id = public.my_club_id() and public.player_level(player_id) = 'modification');

-- Le lecteur ne modifie rien (lmfc_v22.sql).
drop policy if exists lecteur_no_insert on public.sequence_codes;
drop policy if exists lecteur_no_update on public.sequence_codes;
drop policy if exists lecteur_no_delete on public.sequence_codes;
create policy lecteur_no_insert on public.sequence_codes as restrictive for insert to authenticated
  with check (not (select public.is_lecteur()));
create policy lecteur_no_update on public.sequence_codes as restrictive for update to authenticated
  using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()));
create policy lecteur_no_delete on public.sequence_codes as restrictive for delete to authenticated
  using (not (select public.is_lecteur()));

-- 4) Corbeille : le codage suit sa séquence (lmfc_v5.sql) ---------------------
drop trigger if exists trash_capture on public.sequence_codes;
create trigger trash_capture before delete on public.sequence_codes for each row
  execute function public.trash_capture('child', 'video_sequences:sequence_id');

-- 5) Renommer (ou supprimer, nouveau nom vide) un tag ------------------------
-- Droits de la personne (security invoker) : seuls les codages qu'elle peut
-- modifier changent. Pas de doublon si le clip portait déjà le nouveau tag.
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
  return v_count;
end; $$;
revoke all on function public.rename_sequence_tag(text, text) from public, anon;
grant execute on function public.rename_sequence_tag(text, text) to authenticated;

commit;
