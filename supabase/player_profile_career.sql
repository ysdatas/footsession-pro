-- ============================================================
--  FootSession Pro — Identité du joueur et parcours en club
--
--  À exécuter après perf_dashboard.sql. Idempotent.
--
--  1) Champs d'identité affichés à droite du nom dans la fiche :
--     date de naissance (l'âge en est calculé, jamais stocké),
--     nationalité, pied fort, statut, fin de contrat.
--     Tous facultatifs : un champ vide n'est simplement pas affiché.
--
--  2) Parcours : les clubs précédents du joueur, avec les dates.
--     Lecture : le joueur concerné + le staff du club.
--     Écriture : les éditeurs du club (mêmes droits que la fiche
--     joueur elle-même, can_edit()).
-- ============================================================
begin;

-- ------------------------------------------------------------
-- 1) Identité
-- ------------------------------------------------------------
alter table public.players add column if not exists date_naissance date;
alter table public.players add column if not exists nationalite   text;
alter table public.players add column if not exists pied_fort     text;
alter table public.players add column if not exists statut        text;
alter table public.players add column if not exists contrat_fin   date;

alter table public.players drop constraint if exists players_pied_fort_check;
alter table public.players add constraint players_pied_fort_check
  check (pied_fort is null or pied_fort in ('Droit', 'Gauche', 'Les deux'));

-- ------------------------------------------------------------
-- 2) Parcours
-- ------------------------------------------------------------
create table if not exists public.player_career (
  id          bigint generated always as identity primary key,
  club_id     bigint not null references public.clubs(id) on delete cascade,
  player_id   bigint not null references public.players(id) on delete cascade,
  club_name   text not null,
  categorie   text,                 -- ex. U17 Nationaux, N2, Réserve
  date_debut  date,
  date_fin    date,                 -- null = en cours
  notes       text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint player_career_dates_check
    check (date_fin is null or date_debut is null or date_fin >= date_debut)
);

create index if not exists player_career_player_idx
  on public.player_career(player_id, date_debut desc nulls last);

alter table public.player_career enable row level security;

drop policy if exists player_career_read on public.player_career;
create policy player_career_read on public.player_career for select
using (
  exists (
    select 1 from public.players p
    where p.id = player_id and p.auth_user_id = auth.uid()
  )
  or (public.is_staff() and club_id = public.my_club_id())
);

drop policy if exists player_career_write on public.player_career;
create policy player_career_write on public.player_career for all
using (public.can_edit() and club_id = public.my_club_id())
with check (
  public.can_edit()
  and club_id = public.my_club_id()
  and exists (
    select 1 from public.players p
    where p.id = player_id and p.club_id = public.my_club_id()
  )
);

grant select, insert, update, delete on public.player_career to authenticated;

commit;
