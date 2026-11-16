/* Retour arrière de lmfc_v55.sql (accès préparés). Rejouable.
   Efface le nom, la responsabilité, les équipes et la lecture club préparés sur les
   invitations en attente, et la responsabilité des membres : les comptes gardent leur
   rôle et leurs équipes (profiles.team_ids, lecture_club existaient avant).
   claim_club_access reprend sa définition de lmfc_v41.sql, à l'identique : une invitation
   du staff s'active de nouveau sans équipe (un lecteur sans équipe lit alors tout le club). */
begin;
CREATE OR REPLACE FUNCTION public.claim_club_access()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_acc public.club_access%rowtype;
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
  if v_acc.role = 'analyste' then
    v_pro_team := public.analyste_default_team(v_acc.club_id);
    if v_pro_team is not null then
      update public.profiles set team_ids = array[v_pro_team]
       where id = v_uid and club_id = v_acc.club_id and cardinality(coalesce(team_ids, '{}')) = 0;
    end if;
  end if;
  update public.club_access set claimed_by = v_uid, claimed_at = now() where id = v_acc.id;
  return v_acc.role;
end; $function$
;

CREATE OR REPLACE FUNCTION public.guard_profile_membership_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() = old.id and current_user = 'authenticated' then
    new.role := old.role;
    new.club_id := old.club_id;
    new.team_id := old.team_id;
    new.team_ids := old.team_ids;
    new.lecture_club := old.lecture_club;
  end if;
  if new.club_id is distinct from old.club_id then new.team_ids := '{}'; new.lecture_club := false; end if;
  new.team_ids := coalesce((select array_agg(distinct x order by x) from unnest(new.team_ids) x
    where exists (select 1 from public.teams t where t.id = x and t.club_id = new.club_id)), '{}');
  new.team_id := new.team_ids[1];
  return new;
end; $function$
;

alter table public.profiles drop constraint if exists profiles_responsabilite_check;
alter table public.club_access drop constraint if exists club_access_perimetre_check;
alter table public.club_access drop constraint if exists club_access_v55_check;
alter table public.profiles drop column if exists responsabilite;
alter table public.club_access drop column if exists lecture_club;
alter table public.club_access drop column if exists team_ids;
alter table public.club_access drop column if exists responsabilite;
alter table public.club_access drop column if exists nom;
commit;
