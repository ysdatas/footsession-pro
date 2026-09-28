-- ============================================================
--  FootSession Pro — Références d'équipe pour la fiche Performance
--
--  À exécuter après fix_audit_2026_09.sql.
--
--  La fiche compare le joueur à la moyenne de son club (radar et
--  colonne « Référence »). Un joueur n'a pas le droit de lire les
--  lignes des autres joueurs : cette RPC ne renvoie donc QUE des
--  agrégats, jamais une valeur individuelle, et seulement quand
--  l'effectif testé est suffisant pour que la moyenne ne désigne
--  personne.
-- ============================================================
begin;

-- En dessous de ce nombre de joueurs testés sur une métrique, la
-- moyenne est tue : avec un ou deux joueurs elle revient à divulguer
-- une valeur individuelle, et elle n'a de toute façon aucun sens.
create or replace function public.club_test_averages(p_stage text)
returns table (
  n_players integer,
  sprint10_sec numeric,
  five05_left_sec numeric,
  five05_right_sec numeric,
  five05_avg_sec numeric,
  sprint40_sec numeric,
  vift_kmh numeric,
  shirado_sec numeric,
  sorensen_sec numeric,
  profile_start numeric,
  profile_agility numeric,
  profile_speed numeric,
  profile_endurance numeric,
  profile_core numeric
)
language sql
security definer
stable
set search_path = public
as $$
  with scope as (
    select t.*
    from public.player_physical_tests t
    where t.stage = p_stage
      and t.club_id = (select club_id from public.profiles where id = auth.uid())
      and auth.uid() is not null
  ),
  -- Une moyenne n'est renvoyée que si au moins 3 joueurs ont la mesure.
  agg as (
    select
      count(*)::integer as n_players,
      case when count(sprint10_sec)     >= 3 then avg(sprint10_sec)     end as sprint10_sec,
      case when count(five05_left_sec)  >= 3 then avg(five05_left_sec)  end as five05_left_sec,
      case when count(five05_right_sec) >= 3 then avg(five05_right_sec) end as five05_right_sec,
      case when count(five05_avg_sec)   >= 3 then avg(five05_avg_sec)   end as five05_avg_sec,
      case when count(sprint40_sec)     >= 3 then avg(sprint40_sec)     end as sprint40_sec,
      case when count(vift_kmh)         >= 3 then avg(vift_kmh)         end as vift_kmh,
      case when count(shirado_sec)      >= 3 then avg(shirado_sec)      end as shirado_sec,
      case when count(sorensen_sec)     >= 3 then avg(sorensen_sec)     end as sorensen_sec,
      case when count(profile_start)    >= 3 then avg(profile_start)    end as profile_start,
      case when count(profile_agility)  >= 3 then avg(profile_agility)  end as profile_agility,
      case when count(profile_speed)    >= 3 then avg(profile_speed)    end as profile_speed,
      case when count(profile_endurance)>= 3 then avg(profile_endurance)end as profile_endurance,
      case when count(profile_core)     >= 3 then avg(profile_core)     end as profile_core
    from scope
  )
  select * from agg;
$$;

revoke all on function public.club_test_averages(text) from public, anon;
grant execute on function public.club_test_averages(text) to authenticated;

commit;
