/* ============================================================
   LMFC Performance — lmfc_v53.sql (n° 71) : « Ce n'est pas un doublon »
   À exécuter après lmfc_v52.sql. Rejouable et transactionnelle.
   Retour arrière : lmfc_v53_retour.sql (les décisions sont effacées : les
   alertes qu'elles taisaient reviennent).

   Deux matchs le même jour contre le même adversaire sont signalés comme
   doublon possible (Retours de match), sauf si leurs catégories diffèrent
   (U15 / U18, N2 / N3 : calcul dans la page, match-history.js). Quand le
   staff confirme que deux matchs signalés sont bien distincts, la décision
   est gardée ici, pour tout le club : l'alerte ne revient plus.

   match_not_duplicates : une paire de matchs (match_a < match_b), qui l'a
   décidé et quand. Lue par le staff du club ; écrite par un compte qui
   modifie le contenu des équipes et voit les deux matchs ; retirée par son
   auteur ou l'admin (l'alerte revient). Supprimée avec l'un des matchs.
   ============================================================ */
begin;

create table if not exists public.match_not_duplicates (
  id          bigint generated always as identity primary key,
  club_id     bigint not null references public.clubs on delete cascade,
  match_a     bigint not null references public.matches on delete cascade,
  match_b     bigint not null references public.matches on delete cascade,
  decided_by  uuid not null default auth.uid(),
  decided_at  timestamptz not null default now(),
  constraint match_not_duplicates_order check (match_a < match_b),
  constraint match_not_duplicates_pair unique (match_a, match_b)
);
create index if not exists match_not_duplicates_b_idx on public.match_not_duplicates (match_b);

alter table public.match_not_duplicates enable row level security;
drop policy if exists match_not_duplicates_read on public.match_not_duplicates;
create policy match_not_duplicates_read on public.match_not_duplicates for select
  using (club_id = (select public.my_club_id()) and (select public.is_staff()));
drop policy if exists match_not_duplicates_insert on public.match_not_duplicates;
create policy match_not_duplicates_insert on public.match_not_duplicates for insert
  with check (club_id = (select public.my_club_id()) and decided_by = auth.uid() and (select public.can_edit_team_content())
    -- Les deux matchs, du club et lisibles par l'appelant (la règle de lecture des matchs s'applique ici).
    and exists (select 1 from public.matches m where m.id = match_a and m.club_id = match_not_duplicates.club_id)
    and exists (select 1 from public.matches m where m.id = match_b and m.club_id = match_not_duplicates.club_id));
drop policy if exists match_not_duplicates_delete on public.match_not_duplicates;
create policy match_not_duplicates_delete on public.match_not_duplicates for delete
  using (club_id = (select public.my_club_id()) and (decided_by = auth.uid() or (select public.is_club_admin())));

drop policy if exists lecteur_no_insert on public.match_not_duplicates;
drop policy if exists lecteur_no_update on public.match_not_duplicates;
drop policy if exists lecteur_no_delete on public.match_not_duplicates;
create policy lecteur_no_insert on public.match_not_duplicates as restrictive for insert to authenticated
  with check (not (select public.is_lecteur()));
create policy lecteur_no_update on public.match_not_duplicates as restrictive for update to authenticated
  using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()));
create policy lecteur_no_delete on public.match_not_duplicates as restrictive for delete to authenticated
  using (not (select public.is_lecteur()));

commit;
