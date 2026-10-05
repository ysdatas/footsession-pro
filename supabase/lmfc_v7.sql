/* ============================================================
   LMFC Performance — migration 26 : sécurité des profils, équipes
   des comptes et des joueurs, ce que voit le joueur.
   À exécuter APRÈS lmfc_v6.sql. Idempotent (rejouable) et
   transactionnel : en cas d'erreur, rien n'est appliqué.

   1) SÉCURITÉ — un compte ne change plus lui-même son rôle, son club
      ni son équipe. La garde existante ne s'appliquait jamais : elle
      était SECURITY DEFINER, donc current_user y valait toujours son
      propriétaire et jamais « authenticated ». N'importe quel compte
      connecté pouvait se donner le rôle admin d'un club. Elle tourne
      désormais avec les droits de l'appelant : une mise à jour faite
      depuis le site est bloquée, celle des fonctions du serveur
      (create_club, claim_club_access, club_set_member_role…) passe.
   2) Compte du staff rattaché à une équipe (profiles.team_id).
      Vide = toutes les équipes. Rempli : le coach ou le préparateur
      ne voit que cette équipe (ses joueurs, ses séances, partagées
      par tout le staff de l'équipe). Seul l'administrateur le change
      (Mon club → Membres).
   3) Joueur dans plusieurs équipes : players.team_id reste l'équipe
      principale (moyennes « équipe » du radar et des tests),
      players.other_team_ids liste les autres. Son compte joueur suit
      sa fiche.
   4) Ce que voit le joueur : players.hidden_sections liste les
      rubriques de sa page Performance masquées dans son espace
      ('radar', 'tests', 'suivi'). Réglé par admin, coach, préparateur.
   ============================================================ */
begin;

-- ------------------------------------------------------------
-- 1) + 2) Profils : équipe du compte, garde corrigée
-- ------------------------------------------------------------
alter table public.profiles add column if not exists team_id bigint references public.teams(id) on delete set null;

create or replace function public.guard_profile_membership_changes()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() = old.id and current_user = 'authenticated' then
    new.role := old.role;
    new.club_id := old.club_id;
    new.team_id := old.team_id;
  end if;
  if new.team_id is not null and not exists (
    select 1 from public.teams t where t.id = new.team_id and t.club_id = new.club_id
  ) then
    raise exception 'Équipe inconnue pour ce club.';
  end if;
  return new;
end; $$;

drop trigger if exists guard_profile_membership_changes on public.profiles;
create trigger guard_profile_membership_changes
  before update on public.profiles
  for each row execute function public.guard_profile_membership_changes();

-- ------------------------------------------------------------
-- 3) Joueurs : autres équipes
-- ------------------------------------------------------------
alter table public.players add column if not exists other_team_ids bigint[] not null default '{}';

-- Garde les seules équipes du club du joueur, sans doublon ni
-- l'équipe principale. Une équipe supprimée (corbeille) reste listée
-- tant que la fiche n'est pas modifiée : restaurée, elle revient.
create or replace function public.clean_player_other_teams()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.other_team_ids := coalesce((
    select array_agg(distinct x order by x) from unnest(new.other_team_ids) x
    where x is distinct from new.team_id
      and exists (select 1 from public.teams t where t.id = x and t.club_id = new.club_id)
  ), '{}');
  return new;
end; $$;

drop trigger if exists trg_players_other_teams on public.players;
create trigger trg_players_other_teams
  before insert or update of other_team_ids, team_id, club_id on public.players
  for each row execute function public.clean_player_other_teams();

create index if not exists players_other_teams_idx on public.players using gin (other_team_ids);

-- ------------------------------------------------------------
-- 4) Ce que voit le joueur
-- ------------------------------------------------------------
alter table public.players add column if not exists hidden_sections text[] not null default '{}';
alter table public.players drop constraint if exists players_hidden_sections_check;
alter table public.players add constraint players_hidden_sections_check
  check (hidden_sections <@ array['radar', 'tests', 'suivi']::text[]);

-- Le préparateur ne modifie pas la fiche (players_update : admin,
-- coach) : il règle cette colonne, et seulement elle, par ici.
create or replace function public.set_player_hidden_sections(p_player_ids bigint[], p_sections text[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not public.can_manage_plans() then
    raise exception 'Réservé à l’administrateur, au coach et au préparateur.';
  end if;
  update public.players
     set hidden_sections = coalesce((select array_agg(distinct s order by s) from unnest(p_sections) s), '{}')
   where id = any(p_player_ids) and club_id = public.my_club_id();
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
revoke all on function public.set_player_hidden_sections(bigint[], text[]) from public, anon;
grant execute on function public.set_player_hidden_sections(bigint[], text[]) to authenticated;

commit;
