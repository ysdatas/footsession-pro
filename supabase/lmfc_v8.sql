/* ============================================================
   LMFC Performance — migration 27 : ce que voit le joueur, en détail.
   À exécuter APRÈS lmfc_v7.sql. Idempotent (rejouable) et
   transactionnel : en cas d'erreur, rien n'est appliqué.

   players.hidden_sections accepte, en plus des blocs entiers
   ('radar', 'tests', 'suivi'), un test ou une mesure précis :
     'test:sprint10_sec', 'test:five05_left_sec'…  (colonnes de
       player_physical_tests)
     'mesure:weight_kg', 'mesure:body_fat_pct', 'mesure:height_cm'
   Le staff ne montre ainsi que les sprints, que le 505, ou tout.
   ============================================================ */
begin;

-- Fonction pure (aucune donnée lue) : sert à la contrainte ci-dessous.
create or replace function public.valid_hidden_sections(p text[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce(bool_and(s ~ '^(radar|tests|suivi)$' or s ~ '^(test|mesure):[a-z0-9_]{1,40}$'), true)
  from unnest(p) s;
$$;

alter table public.players drop constraint if exists players_hidden_sections_check;
alter table public.players add constraint players_hidden_sections_check
  check (public.valid_hidden_sections(hidden_sections));

commit;
