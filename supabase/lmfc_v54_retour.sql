/* Retour arrière de lmfc_v54.sql (joueurs extérieurs). Rejouable.
   Refusé tant qu'une fiche de joueur extérieur existe : la rattacher à une fiche du club,
   lui donner une équipe, ou la supprimer d'abord (sinon elle deviendrait un joueur sans
   équipe, réservé à l'admin, avec ses présences et feuilles de match).
   player_level_for reprend sa définition de lmfc_v41.sql, à l'identique. */
begin;
do $$
declare v_n integer;
begin
  -- Deux temps : la colonne n'existe plus si le retour a déjà été passé.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'players' and column_name = 'exterieur') then
    select count(*) into v_n from public.players where exterieur;
    if v_n > 0 then
      raise exception 'Retour refusé : % joueur(s) extérieur(s). Rattachez-les, donnez-leur une équipe ou supprimez-les d''abord.', v_n;
    end if;
  end if;
end $$;

drop function if exists public.player_exterieur_attach(bigint, bigint, boolean);
drop function if exists public.player_exterieur_create(text, text, date, text, text);
drop trigger if exists trg_players_exterieur on public.players;
drop function if exists public.players_exterieur_flag();

CREATE OR REPLACE FUNCTION public.player_level_for(p_profile uuid, p_player bigint)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when me.id is null or me.role = 'joueur' or pl.id is null or pl.club_id is distinct from me.club_id then 'aucun'
    when me.role = 'admin' then 'modification'
    when me.role = 'lecteur' then case
      when x.niveau = 'aucun' then 'aucun'
      when x.niveau is not null then 'lecture'
      when pl.team_id = any(me.team_ids) or coalesce(pl.other_team_ids, '{}') && me.team_ids then 'lecture'
      when cardinality(me.team_ids) > 0 then 'aucun'
      when pl.team_id is null and cardinality(coalesce(pl.other_team_ids, '{}')) = 0
           and exists (select 1 from public.teams t where t.club_id = me.club_id) then 'aucun'
      else 'lecture'
    end
    when me.role = 'analyste' then case
      when x.niveau = 'aucun' then 'aucun'
      when x.niveau is not null then x.niveau
      when pl.team_id = any(me.team_ids) or coalesce(pl.other_team_ids, '{}') && me.team_ids then 'modification'
      else 'aucun'
    end
    when x.niveau is not null then x.niveau
    when pl.team_id = any(me.team_ids) or coalesce(pl.other_team_ids, '{}') && me.team_ids then 'modification'
    when not exists (select 1 from public.teams t where t.club_id = me.club_id) then 'modification'
    when me.lecture_club and (pl.team_id is not null or cardinality(coalesce(pl.other_team_ids, '{}')) > 0) then 'lecture'
    else 'aucun'
  end
  from (select 1) d
  left join public.profiles me on me.id = p_profile
  left join public.players pl on pl.id = p_player
  left join public.staff_player_access x on x.profile_id = p_profile and x.player_id = p_player;
$function$
;

alter table public.players drop constraint if exists players_exterieur_check;
alter table public.players drop column if exists exterieur_infos;
alter table public.players drop column if exists origine;
alter table public.players drop column if exists exterieur;
commit;
