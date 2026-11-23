/* ============================================================
   LMFC Performance — lmfc_v66.sql : championnats du club
   À exécuter après lmfc_v65.sql. Rejouable et transactionnelle.

   - competitions : les championnats créés par le club (nom unique dans le club) et les
     libellés FFF qui y renvoient (libelles_fff), pour reconnaître les prochains imports ;
   - matches.competition_id : le championnat du match. Le texte matches.competition reste
     tel quel (libellé FFF ou saisie) : l'import FFF continue de le comparer ;
   - lecture : le staff du club (lecteur compris) ; écriture : admin, coach, analyste
     (can_edit_team_content, comme les matchs) ; un lecteur n'écrit jamais (lmfc_v22.sql) ;
   - supprimer un championnat ne supprime aucun match : ils redeviennent « à classer ».
   Retour arrière : lmfc_v66_retour.sql (championnats et classement des matchs perdus).
   ============================================================ */
begin;

create table if not exists public.competitions (
  id           bigint generated always as identity primary key,
  club_id      bigint not null references public.clubs on delete cascade,
  nom          text not null check (length(btrim(nom)) between 1 and 80),
  libelles_fff text[] not null default '{}' check (cardinality(libelles_fff) <= 30),
  created_by   uuid references auth.users on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create unique index if not exists competitions_club_nom_idx on public.competitions (club_id, lower(btrim(nom)));

alter table public.matches add column if not exists competition_id bigint references public.competitions on delete set null;
create index if not exists matches_competition_idx on public.matches (competition_id) where competition_id is not null;

-- Un match ne prend qu'un championnat de son club.
create or replace function public.match_competition_club()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.competition_id is not null and not exists (
       select 1 from public.competitions c where c.id = new.competition_id and c.club_id = new.club_id) then
    raise exception 'Ce championnat n’appartient pas au club du match.' using errcode = '23503';
  end if;
  return new;
end $$;
drop trigger if exists match_competition_club on public.matches;
create trigger match_competition_club before insert or update of competition_id, club_id on public.matches
  for each row execute function public.match_competition_club();

alter table public.competitions enable row level security;
drop policy if exists competitions_read on public.competitions;
create policy competitions_read on public.competitions for select to authenticated
  using (club_id = public.my_club_id() and public.is_staff());
drop policy if exists competitions_write on public.competitions;
create policy competitions_write on public.competitions for all to authenticated
  using (club_id = public.my_club_id() and public.can_edit_team_content())
  with check (club_id = public.my_club_id() and public.can_edit_team_content());
-- Lecteur : jamais d'écriture (règle des tables RLS, lmfc_v22.sql).
drop policy if exists lecteur_no_insert on public.competitions;
create policy lecteur_no_insert on public.competitions as restrictive for insert to authenticated
  with check (not (select public.is_lecteur()));
drop policy if exists lecteur_no_update on public.competitions;
create policy lecteur_no_update on public.competitions as restrictive for update to authenticated
  using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()));
drop policy if exists lecteur_no_delete on public.competitions;
create policy lecteur_no_delete on public.competitions as restrictive for delete to authenticated
  using (not (select public.is_lecteur()));

revoke all on table public.competitions from anon;
revoke all on function public.match_competition_club() from public, anon, authenticated;

commit;
