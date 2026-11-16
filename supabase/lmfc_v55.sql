/* ============================================================
   LMFC Performance — lmfc_v55.sql (n° 73) : accès préparés avant la première connexion
   À exécuter après lmfc_v54.sql. Rejouable et transactionnelle.
   Retour arrière : lmfc_v55_retour.sql (les nouvelles colonnes sont effacées : nom,
   responsabilité, équipes et lecture club préparés sur les invitations en attente).

   Mon club → Accès : l'administrateur prépare tout avant la première connexion :
     - club_access.nom, responsabilite, team_ids (une ou plusieurs équipes) et
       lecture_club (« Lecture sur toutes les équipes ») ;
     - profiles.responsabilite : l'intitulé de la personne (directeur sportif,
       responsable de catégorie, entraîneur principal ou adjoint…). Il ne donne
       aucun droit : les droits viennent du rôle (admin, coach, prépa, analyste,
       lecteur), des équipes et des exceptions, comme avant.
   Aucun accès temporaire global : une invitation du staff (ni admin ni joueur)
   sans équipe ni « lecture club » n'est pas activée. claim_club_access répond
   alors 'en_attente' : le compte reste sans club tant que l'admin n'a pas choisi
   son périmètre (y compris pour les invitations faites avant cette migration).
   À la première connexion, le compte reçoit rôle, équipes, lecture club,
   responsabilité et nom (s'il n'en a pas) : il arrive dans son périmètre.
   ============================================================ */
begin;

alter table public.club_access add column if not exists nom text;
alter table public.club_access add column if not exists responsabilite text;
alter table public.club_access add column if not exists team_ids bigint[] not null default '{}';
alter table public.club_access add column if not exists lecture_club boolean not null default false;
alter table public.profiles add column if not exists responsabilite text;

alter table public.club_access drop constraint if exists club_access_v55_check;
alter table public.club_access add constraint club_access_v55_check check (
  char_length(nom) <= 120
  and (responsabilite is null or responsabilite in ('administrateur', 'directeur_sportif', 'responsable_categorie',
       'entraineur_principal', 'entraineur_adjoint', 'preparateur', 'analyste', 'scout')));
-- Périmètre obligatoire pour une invitation du staff. NOT VALID : les invitations déjà en
-- attente ne sont pas refusées par la migration ; elles restent en attente (claim_club_access).
alter table public.club_access drop constraint if exists club_access_perimetre_check;
alter table public.club_access add constraint club_access_perimetre_check
  check (role in ('admin', 'joueur') or cardinality(team_ids) > 0 or lecture_club) not valid;
alter table public.profiles drop constraint if exists profiles_responsabilite_check;
alter table public.profiles add constraint profiles_responsabilite_check check (
  responsabilite is null or responsabilite in ('administrateur', 'directeur_sportif', 'responsable_categorie',
  'entraineur_principal', 'entraineur_adjoint', 'preparateur', 'analyste', 'scout'));

-- Garde des profils (dernière définition) : la responsabilité, comme le rôle, ne se change que par l'admin.
create or replace function public.guard_profile_membership_changes()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() = old.id and current_user = 'authenticated' then
    new.role := old.role;
    new.club_id := old.club_id;
    new.team_id := old.team_id;
    new.team_ids := old.team_ids;
    new.lecture_club := old.lecture_club;
    new.responsabilite := old.responsabilite;
  end if;
  if new.club_id is distinct from old.club_id then new.team_ids := '{}'; new.lecture_club := false; end if;
  new.team_ids := coalesce((select array_agg(distinct x order by x) from unnest(new.team_ids) x
    where exists (select 1 from public.teams t where t.id = x and t.club_id = new.club_id)), '{}');
  new.team_id := new.team_ids[1];
  return new;
end; $$;

-- lmfc_v41.sql, avec le périmètre préparé. Les équipes sont relues dans le club (une équipe
-- supprimée depuis l'invitation est ignorée).
create or replace function public.claim_club_access()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_acc public.club_access%rowtype;
  v_teams bigint[];
  v_pro_team bigint;
begin
  if v_uid is null then return null; end if;
  select lower(u.email) into v_email from auth.users u
    where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then return null; end if;
  select * into v_acc from public.club_access
    where email = v_email and claimed_at is null
    order by created_at desc limit 1;
  if v_acc.id is null then return null; end if;
  if exists (select 1 from public.profiles where id = v_uid
             and club_id is not null and club_id <> v_acc.club_id) then
    return null;
  end if;
  v_teams := array(select t.id from public.teams t where t.id = any(v_acc.team_ids) and t.club_id = v_acc.club_id order by t.id);
  -- Staff sans périmètre : rien n'est activé (aucun accès temporaire global).
  if v_acc.role not in ('admin', 'joueur') and cardinality(v_teams) = 0 and not v_acc.lecture_club then
    return 'en_attente';
  end if;
  if v_acc.player_id is not null then
    if exists (select 1 from public.players where id = v_acc.player_id
               and auth_user_id is not null and auth_user_id <> v_uid) then
      raise exception 'Cette fiche joueur est déjà associée à un autre compte.';
    end if;
    update public.players set auth_user_id = null where auth_user_id = v_uid and id <> v_acc.player_id;
    update public.players set auth_user_id = v_uid where id = v_acc.player_id;
  else
    update public.players set auth_user_id = null where auth_user_id = v_uid;
  end if;

  update public.profiles set club_id = v_acc.club_id, role = v_acc.role where id = v_uid;
  -- En second : la garde des profils vide les équipes d'un compte qui change de club.
  update public.profiles set team_ids = v_teams, lecture_club = v_acc.lecture_club,
         responsabilite = coalesce(v_acc.responsabilite, responsabilite),
         nom = coalesce(nullif(btrim(nom), ''), nullif(btrim(v_acc.nom), ''), nom)
   where id = v_uid;
  if v_acc.role = 'analyste' then
    v_pro_team := public.analyste_default_team(v_acc.club_id);
    if v_pro_team is not null then
      update public.profiles set team_ids = array[v_pro_team]
       where id = v_uid and club_id = v_acc.club_id and cardinality(coalesce(team_ids, '{}')) = 0;
    end if;
  end if;
  update public.club_access set claimed_by = v_uid, claimed_at = now() where id = v_acc.id;
  return v_acc.role;
end; $$;
revoke all on function public.claim_club_access() from public, anon;
grant execute on function public.claim_club_access() to authenticated;

commit;
