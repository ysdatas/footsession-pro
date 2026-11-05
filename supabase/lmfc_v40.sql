/* ============================================================
   LMFC Performance — lmfc_v40.sql (n° 58) : garder l'accès du coach aux joueurs
   À exécuter après lmfc_v39.sql. Rejouable et sans changement de données.

   Un coach ne peut pas retirer son dernier rattachement d'équipe d'une fiche
   qu'il voit grâce à cette équipe. Sinon, la fiche sort de son périmètre RLS.
   L'administrateur conserve la gestion libre. Une exception nominative qui
   modifie une fiche déjà sans équipe reste utilisable si ses équipes ne changent pas.
   ============================================================ */
begin;

create or replace function public.guard_player_links()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_mine bigint[];
  v_old  bigint[] := '{}';
  v_new  bigint[] := array_remove(array[new.team_id] || coalesce(new.other_team_ids, '{}'), null);
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'UPDATE' then v_old := array_remove(array[old.team_id] || coalesce(old.other_team_ids, '{}'), null); end if;
  if new.auth_user_id is distinct from (case when tg_op = 'UPDATE' then old.auth_user_id end) then
    raise exception 'Le compte lié à une fiche se règle dans Mon club, par l’administrateur.' using errcode = '42501';
  end if;
  if public.is_club_admin() then return new; end if;

  select coalesce(pr.team_ids, '{}') into v_mine from public.profiles pr where pr.id = auth.uid();

  if tg_op = 'INSERT' and cardinality(v_new) = 0
     and exists (select 1 from public.teams t where t.club_id = new.club_id) then
    raise exception 'Choisissez une équipe pour cette fiche.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and v_old && coalesce(v_mine, '{}')
     and not (v_new && coalesce(v_mine, '{}')) then
    raise exception 'Vous ne pouvez pas retirer votre dernier rattachement d’équipe à cette fiche.' using errcode = '42501';
  end if;

  if exists (select 1 from unnest(v_new) t where t <> all(v_old) and t <> all(coalesce(v_mine, '{}')))
     or exists (select 1 from unnest(v_old) t where t <> all(v_new) and t <> all(coalesce(v_mine, '{}'))) then
    raise exception 'Seul l’administrateur rattache un joueur à une équipe qui n’est pas la vôtre, ou l’en retire.' using errcode = '42501';
  end if;
  return new;
end; $$;

commit;
