/* ============================================================
   LMFC Performance — lmfc_v66_retour.sql : retour arrière de lmfc_v66.sql
   Retire les championnats et le classement des matchs (matches.competition_id).
   Les matchs restent, avec leur texte de compétition. Rejouable et transactionnel.
   ============================================================ */
begin;

drop trigger if exists match_competition_club on public.matches;
drop function if exists public.match_competition_club();
drop index if exists public.matches_competition_idx;
alter table public.matches drop column if exists competition_id;
drop table if exists public.competitions;

commit;
