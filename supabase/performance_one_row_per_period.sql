-- ============================================================
--  FootSession Pro — Une seule ligne par joueur, saison et période
--
--  À exécuter après player_profile_career.sql. Idempotent.
--
--  Problème corrigé : la clé d'unicité des mesures et des tests
--  contenait le NOM DU FICHIER source. Chaque source différente
--  créait donc sa propre ligne pour le même mois :
--    Excel « Tests_Physiques_N2-5.xlsx », saisie manuelle, nouvelle
--    version de l'Excel sous un autre nom…
--  d'où des mois en double dans le suivi physique, et une mise à jour
--  de l'Excel incapable d'écraser les anciennes valeurs.
--
--  Nouveau modèle :
--    mesures : une ligne par (club, joueur, saison, mois)
--    tests   : une ligne par (club, joueur, saison, session)
--  La source (fichier ou saisie) reste enregistrée, mais n'est plus
--  une clé. Les doublons existants sont FUSIONNÉS champ par champ —
--  la valeur la plus récente de chaque champ est conservée, aucune
--  valeur renseignée n'est perdue.
-- ============================================================
begin;

-- ------------------------------------------------------------
-- 1) Saison : « 2026-2027 », selon le début de saison du club
--    (août par défaut quand le club ne l'a pas renseigné).
-- ------------------------------------------------------------
create or replace function public.season_key_for(p_date date, p_club_id bigint)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when extract(month from d) >= coalesce(extract(month from c.saison_start), 8)
      then extract(year from d)::int || '-' || (extract(year from d)::int + 1)
    else (extract(year from d)::int - 1) || '-' || extract(year from d)::int
  end
  from (select coalesce(p_date, current_date) as d) x
  left join public.clubs c on c.id = p_club_id;
$$;

revoke all on function public.season_key_for(date, bigint) from public, anon;
grant execute on function public.season_key_for(date, bigint) to authenticated;

alter table public.player_physical_tests add column if not exists season_key text;

-- Toute écriture sans saison en reçoit une : un ancien onglet resté
-- ouvert, ou un client qui ne l'envoie pas, ne peut plus créer de
-- ligne orpheline.
create or replace function public.fill_performance_season()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.season_key is null or new.season_key !~ '^\d{4}-\d{4}$' then
    if tg_table_name = 'player_physical_measurements' then
      new.season_key := public.season_key_for(coalesce(new.measured_at, current_date), new.club_id);
    else
      new.season_key := public.season_key_for(coalesce(new.tested_at, current_date), new.club_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fill_season_measurements on public.player_physical_measurements;
create trigger trg_fill_season_measurements
before insert or update on public.player_physical_measurements
for each row execute function public.fill_performance_season();

drop trigger if exists trg_fill_season_tests on public.player_physical_tests;
create trigger trg_fill_season_tests
before insert or update on public.player_physical_tests
for each row execute function public.fill_performance_season();

-- Reprise : un ancien import stockait le NOM DE FICHIER dans season_key.
update public.player_physical_measurements
  set season_key = public.season_key_for(coalesce(measured_at, created_at::date), club_id)
  where season_key is null or season_key !~ '^\d{4}-\d{4}$';

update public.player_physical_tests
  set season_key = public.season_key_for(coalesce(tested_at, created_at::date), club_id)
  where season_key is null or season_key !~ '^\d{4}-\d{4}$';

-- ------------------------------------------------------------
-- 2) Fusion des doublons de MESURES
--    La ligne gardée est la plus récente ; chaque champ y reçoit la
--    valeur renseignée la plus récente du groupe.
-- ------------------------------------------------------------
drop index if exists public.player_physical_measurements_import_uq;

update public.player_physical_measurements k set
  measured_at        = g.measured_at,
  age_at_measurement = g.age_at_measurement,
  height_cm          = g.height_cm,
  weight_kg          = g.weight_kg,
  body_fat_pct       = g.body_fat_pct,
  biceps_mm          = g.biceps_mm,
  triceps_mm         = g.triceps_mm,
  subscapular_mm     = g.subscapular_mm,
  suprailiac_mm      = g.suprailiac_mm,
  skinfold_sum_4_mm  = g.skinfold_sum_4_mm,
  source             = g.source,
  source_file_name   = g.source_file_name
from (
  select
    (array_agg(id order by updated_at desc, id desc))[1] as keeper_id,
    (array_agg(measured_at        order by updated_at desc, id desc) filter (where measured_at        is not null))[1] as measured_at,
    (array_agg(age_at_measurement order by updated_at desc, id desc) filter (where age_at_measurement is not null))[1] as age_at_measurement,
    (array_agg(height_cm          order by updated_at desc, id desc) filter (where height_cm          is not null))[1] as height_cm,
    (array_agg(weight_kg          order by updated_at desc, id desc) filter (where weight_kg          is not null))[1] as weight_kg,
    (array_agg(body_fat_pct       order by updated_at desc, id desc) filter (where body_fat_pct       is not null))[1] as body_fat_pct,
    (array_agg(biceps_mm          order by updated_at desc, id desc) filter (where biceps_mm          is not null))[1] as biceps_mm,
    (array_agg(triceps_mm         order by updated_at desc, id desc) filter (where triceps_mm         is not null))[1] as triceps_mm,
    (array_agg(subscapular_mm     order by updated_at desc, id desc) filter (where subscapular_mm     is not null))[1] as subscapular_mm,
    (array_agg(suprailiac_mm      order by updated_at desc, id desc) filter (where suprailiac_mm      is not null))[1] as suprailiac_mm,
    (array_agg(skinfold_sum_4_mm  order by updated_at desc, id desc) filter (where skinfold_sum_4_mm  is not null))[1] as skinfold_sum_4_mm,
    case when bool_or(source = 'import_excel') then 'import_excel'
         else (array_agg(source order by updated_at desc, id desc))[1] end as source,
    coalesce((array_agg(source_file_name order by updated_at desc, id desc)
              filter (where coalesce(source_file_name, '') <> ''))[1], '') as source_file_name
  from public.player_physical_measurements
  group by club_id, player_id, season_key, month_label
  having count(*) > 1
) g
where k.id = g.keeper_id;

delete from public.player_physical_measurements m
using (
  select id, row_number() over (
    partition by club_id, player_id, season_key, month_label
    order by updated_at desc, id desc) as rn
  from public.player_physical_measurements
) r
where m.id = r.id and r.rn > 1;

-- ------------------------------------------------------------
-- 3) Fusion des doublons de TESTS (même principe)
--    Une source Excel dans le groupe fait foi pour le Profil /10 :
--    la ligne fusionnée reste marquée import_excel, et le recalcul
--    de groupe ne remplace donc pas ses scores.
-- ------------------------------------------------------------
drop index if exists public.player_physical_tests_import_uq;

update public.player_physical_tests k set
  tested_at            = g.tested_at,
  sprint10_sec         = g.sprint10_sec,
  five05_left_sec      = g.five05_left_sec,
  five05_right_sec     = g.five05_right_sec,
  five05_avg_sec       = g.five05_avg_sec,
  five05_asymmetry_pct = g.five05_asymmetry_pct,
  sprint40_sec         = g.sprint40_sec,
  vift_kmh             = g.vift_kmh,
  shirado_sec          = g.shirado_sec,
  sorensen_sec         = g.sorensen_sec,
  core_ratio           = g.core_ratio,
  profile_start        = g.profile_start,
  profile_agility      = g.profile_agility,
  profile_speed        = g.profile_speed,
  profile_endurance    = g.profile_endurance,
  profile_core         = g.profile_core,
  source               = g.source,
  source_file_name     = g.source_file_name
from (
  select
    (array_agg(id order by updated_at desc, id desc))[1] as keeper_id,
    (array_agg(tested_at            order by updated_at desc, id desc) filter (where tested_at            is not null))[1] as tested_at,
    (array_agg(sprint10_sec         order by updated_at desc, id desc) filter (where sprint10_sec         is not null))[1] as sprint10_sec,
    (array_agg(five05_left_sec      order by updated_at desc, id desc) filter (where five05_left_sec      is not null))[1] as five05_left_sec,
    (array_agg(five05_right_sec     order by updated_at desc, id desc) filter (where five05_right_sec     is not null))[1] as five05_right_sec,
    (array_agg(five05_avg_sec       order by updated_at desc, id desc) filter (where five05_avg_sec       is not null))[1] as five05_avg_sec,
    (array_agg(five05_asymmetry_pct order by updated_at desc, id desc) filter (where five05_asymmetry_pct is not null))[1] as five05_asymmetry_pct,
    (array_agg(sprint40_sec         order by updated_at desc, id desc) filter (where sprint40_sec         is not null))[1] as sprint40_sec,
    (array_agg(vift_kmh             order by updated_at desc, id desc) filter (where vift_kmh             is not null))[1] as vift_kmh,
    (array_agg(shirado_sec          order by updated_at desc, id desc) filter (where shirado_sec          is not null))[1] as shirado_sec,
    (array_agg(sorensen_sec         order by updated_at desc, id desc) filter (where sorensen_sec         is not null))[1] as sorensen_sec,
    (array_agg(core_ratio           order by updated_at desc, id desc) filter (where core_ratio           is not null))[1] as core_ratio,
    (array_agg(profile_start        order by updated_at desc, id desc) filter (where profile_start        is not null))[1] as profile_start,
    (array_agg(profile_agility      order by updated_at desc, id desc) filter (where profile_agility      is not null))[1] as profile_agility,
    (array_agg(profile_speed        order by updated_at desc, id desc) filter (where profile_speed        is not null))[1] as profile_speed,
    (array_agg(profile_endurance    order by updated_at desc, id desc) filter (where profile_endurance    is not null))[1] as profile_endurance,
    (array_agg(profile_core         order by updated_at desc, id desc) filter (where profile_core         is not null))[1] as profile_core,
    case when bool_or(source = 'import_excel') then 'import_excel'
         else (array_agg(source order by updated_at desc, id desc))[1] end as source,
    coalesce((array_agg(source_file_name order by updated_at desc, id desc)
              filter (where coalesce(source_file_name, '') <> ''))[1], '') as source_file_name
  from public.player_physical_tests
  group by club_id, player_id, season_key, stage
  having count(*) > 1
) g
where k.id = g.keeper_id;

delete from public.player_physical_tests t
using (
  select id, row_number() over (
    partition by club_id, player_id, season_key, stage
    order by updated_at desc, id desc) as rn
  from public.player_physical_tests
) r
where t.id = r.id and r.rn > 1;

-- ------------------------------------------------------------
-- 4) Nouvelles clés d'unicité
-- ------------------------------------------------------------
alter table public.player_physical_measurements alter column season_key set not null;
alter table public.player_physical_tests        alter column season_key set not null;

create unique index if not exists player_physical_measurements_period_uq
  on public.player_physical_measurements(club_id, player_id, season_key, month_label);
create unique index if not exists player_physical_tests_period_uq
  on public.player_physical_tests(club_id, player_id, season_key, stage);

-- ------------------------------------------------------------
-- 5) Moyennes du club : saison la plus récente de la session.
--    Remplace la version de perf_dashboard.sql, qui mélangeait les
--    saisons.
-- ------------------------------------------------------------
create or replace function public.club_test_averages(p_stage text)
returns table (
  n_players integer,
  sprint10_sec numeric, five05_left_sec numeric, five05_right_sec numeric,
  five05_avg_sec numeric, five05_asymmetry_pct numeric, sprint40_sec numeric,
  vift_kmh numeric, shirado_sec numeric, sorensen_sec numeric, core_ratio numeric,
  profile_start numeric, profile_agility numeric, profile_speed numeric,
  profile_endurance numeric, profile_core numeric
)
language sql
security definer
stable
set search_path = public
as $$
  with club as (
    select club_id from public.profiles where id = auth.uid()
  ),
  season as (
    select max(t.season_key) as s from public.player_physical_tests t, club
    where t.club_id = club.club_id and t.stage = p_stage
  ),
  scope as (
    select distinct on (t.player_id) t.*
    from public.player_physical_tests t, club, season
    where auth.uid() is not null
      and t.club_id = club.club_id
      and t.stage = p_stage
      and t.season_key = season.s
    order by t.player_id, t.id desc
  ),
  -- Mêmes bornes que web/assets/js/perf-metrics.js.
  bounded as (
    select
      case when sprint10_sec         between 1.2 and 2.6 then sprint10_sec         end as sprint10_sec,
      case when five05_left_sec      between 1.8 and 3.6 then five05_left_sec      end as five05_left_sec,
      case when five05_right_sec     between 1.8 and 3.6 then five05_right_sec     end as five05_right_sec,
      case when five05_avg_sec       between 1.8 and 3.6 then five05_avg_sec       end as five05_avg_sec,
      case when five05_asymmetry_pct between 0   and 40  then five05_asymmetry_pct end as five05_asymmetry_pct,
      case when sprint40_sec         between 4.0 and 8.0 then sprint40_sec         end as sprint40_sec,
      case when vift_kmh             between 12  and 25  then vift_kmh             end as vift_kmh,
      case when shirado_sec          between 5   and 600 then shirado_sec          end as shirado_sec,
      case when sorensen_sec         between 5   and 600 then sorensen_sec         end as sorensen_sec,
      case when core_ratio           between 0.1 and 6   then core_ratio           end as core_ratio,
      case when profile_start        between 0   and 10  then profile_start        end as profile_start,
      case when profile_agility      between 0   and 10  then profile_agility      end as profile_agility,
      case when profile_speed        between 0   and 10  then profile_speed        end as profile_speed,
      case when profile_endurance    between 0   and 10  then profile_endurance    end as profile_endurance,
      case when profile_core         between 0   and 10  then profile_core         end as profile_core
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
