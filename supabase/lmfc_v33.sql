/* ============================================================
   LMFC Performance — lmfc_v33.sql : cartons et feuille de match
   À exécuter APRÈS lmfc_v32.sql (indépendante : peut passer seule après
   lmfc_v27.sql). Rejouable, transactionnelle.

   Retours de match, feuille collée depuis epreuves.fff.fr (match-sheet.js) :
   - match_players.cartons_jaunes (0 à 2) et carton_rouge ;
   - match_players.ext_data : les valeurs lues sur la feuille au moment de
     l'import ; une valeur corrigée à la main en diffère et s'affiche
     « modifié » (même règle que matches.ext_data, lmfc_v27.sql).
   Droits inchangés (lmfc_v19.sql) : l'écriture reste celle du match.

   Retour arrière : alter table public.match_players drop column if exists cartons_jaunes,
     drop column if exists carton_rouge, drop column if exists ext_data;
   ============================================================ */
begin;

alter table public.match_players add column if not exists cartons_jaunes smallint;
alter table public.match_players add column if not exists carton_rouge boolean;
alter table public.match_players add column if not exists ext_data jsonb;
alter table public.match_players drop constraint if exists match_players_cartons_check;
alter table public.match_players add constraint match_players_cartons_check check (cartons_jaunes between 0 and 2);
alter table public.match_players drop constraint if exists match_players_ext_data_check;
alter table public.match_players add constraint match_players_ext_data_check
  check (ext_data is null or (jsonb_typeof(ext_data) = 'object' and length(ext_data::text) <= 2000));

commit;
