-- ============================================================
--  FootSession Pro — Références d'équipe pour la fiche Performance
--
--  À exécuter après fix_audit_2026_09.sql. Idempotent.
--
--  La fiche compare le joueur à la moyenne de son club (radar et
--  colonne « Moyenne club »).
--
--  Le staff lit directement les lignes de son club et calcule la
--  moyenne côté client. Un joueur n'a pas ce droit : il passe par
--  cette RPC, qui ne renvoie QUE des agrégats, jamais une valeur
--  individuelle.
--
--  Les deux chemins appliquent les MÊMES règles :
--    - une valeur hors des bornes physiologiques attendues est
--      exclue de la moyenne (c'est presque toujours une saisie dans
--      la mauvaise colonne : un Shirado de 240 s dans la colonne
--      VIFT suffit à rendre la référence du groupe absurde) ;
--    - une moyenne portant sur moins de 3 joueurs n'est pas
--      renvoyée : elle reviendrait à divulguer une valeur
--      individuelle, et n'aurait de toute façon pas de sens.
--
--  ⚠ Les bornes ci-dessous doivent rester identiques à celles de
--    web/assets/js/perf-metrics.js, qui en est la référence.
-- ============================================================
begin;

-- Les colonnes renvoyées ont changé d'une version à l'autre : PostgreSQL
-- refuse de modifier le type de retour avec « create or replace ».
drop function if exists public.club_test_averages(text);
create function public.club_test_averages(p_stage text)
returns table (
  n_players integer,
  sprint10_sec numeric,
  five05_left_sec numeric,
  five05_right_sec numeric,
  five05_avg_sec numeric,
  five05_asymmetry_pct numeric,
  sprint40_sec numeric,
  vift_kmh numeric,
  shirado_sec numeric,
  sorensen_sec numeric,
  core_ratio numeric,
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
    -- Une seule ligne par joueur : la plus récente de la session.
    select distinct on (t.player_id) t.*
    from public.player_physical_tests t
    where t.stage = p_stage
      and auth.uid() is not null
      and t.club_id = (select club_id from public.profiles where id = auth.uid())
    order by t.player_id, t.id desc
  ),
  -- Hors bornes => NULL, donc ignoré par avg() comme par count().
  bounded as (
    select
      case when sprint10_sec         between 1.2 and 2.6  then sprint10_sec         end as sprint10_sec,
      case when five05_left_sec      between 1.8 and 3.6  then five05_left_sec      end as five05_left_sec,
      case when five05_right_sec     between 1.8 and 3.6  then five05_right_sec     end as five05_right_sec,
      case when five05_avg_sec       between 1.8 and 3.6  then five05_avg_sec       end as five05_avg_sec,
      case when five05_asymmetry_pct between 0   and 40   then five05_asymmetry_pct end as five05_asymmetry_pct,
      case when sprint40_sec         between 4.0 and 8.0  then sprint40_sec         end as sprint40_sec,
      case when vift_kmh             between 12  and 25   then vift_kmh             end as vift_kmh,
      case when shirado_sec          between 5   and 600  then shirado_sec          end as shirado_sec,
      case when sorensen_sec         between 5   and 600  then sorensen_sec         end as sorensen_sec,
      case when core_ratio           between 0.1 and 6    then core_ratio           end as core_ratio,
      case when profile_start        between 0   and 10   then profile_start        end as profile_start,
      case when profile_agility      between 0   and 10   then profile_agility      end as profile_agility,
      case when profile_speed        between 0   and 10   then profile_speed        end as profile_speed,
      case when profile_endurance    between 0   and 10   then profile_endurance    end as profile_endurance,
      case when profile_core         between 0   and 10   then profile_core         end as profile_core
    from scope
  )
  select
    count(*)::integer,
    case when count(sprint10_sec)         >= 3 then avg(sprint10_sec)         end,
    case when count(five05_left_sec)      >= 3 then avg(five05_left_sec)      end,
    case when count(five05_right_sec)     >= 3 then avg(five05_right_sec)     end,
    case when count(five05_avg_sec)       >= 3 then avg(five05_avg_sec)       end,
    case when count(five05_asymmetry_pct) >= 3 then avg(five05_asymmetry_pct) end,
    case when count(sprint40_sec)         >= 3 then avg(sprint40_sec)         end,
    case when count(vift_kmh)             >= 3 then avg(vift_kmh)             end,
    case when count(shirado_sec)          >= 3 then avg(shirado_sec)          end,
    case when count(sorensen_sec)         >= 3 then avg(sorensen_sec)         end,
    case when count(core_ratio)           >= 3 then avg(core_ratio)           end,
    case when count(profile_start)        >= 3 then avg(profile_start)        end,
    case when count(profile_agility)      >= 3 then avg(profile_agility)      end,
    case when count(profile_speed)        >= 3 then avg(profile_speed)        end,
    case when count(profile_endurance)    >= 3 then avg(profile_endurance)    end,
    case when count(profile_core)         >= 3 then avg(profile_core)         end
  from bounded;
$$;

revoke all on function public.club_test_averages(text) from public, anon;
grant execute on function public.club_test_averages(text) to authenticated;

commit;
