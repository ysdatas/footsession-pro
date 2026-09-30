-- ============================================================
--  FootSession Pro — Plateforme v2
--
--  À exécuter après player_program.sql. Idempotent et
--  transactionnel : en cas d'erreur, rien n'est appliqué.
--
--  1) Trois rôles seulement : admin, coach, joueur.
--     Les comptes analyste, prépa et lecture seule deviennent coach.
--     Le coach fait tout le travail du staff ; l'admin gère en plus
--     le club (membres, accès, équipes, suppression de fiches).
--  2) Plus de codes (ni code joueur, ni code club) : l'admin
--     enregistre « adresse e-mail + fonction (+ fiche joueur) ».
--     À la première connexion avec cette adresse (confirmée), le
--     compte est rattaché au club, avec son rôle et sa fiche.
--  3) Séquences vidéo : découpage d'une vidéo en séquences,
--     sélection et annotation (dessins + note) par le joueur,
--     envoi au staff, retour du staff.
--  4) Un schéma tactique (procédé de séance) peut pointer vers une
--     vidéo déjà présente sur la plateforme.
-- ============================================================
begin;

-- ------------------------------------------------------------
-- 1) Trois rôles
-- ------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'coach' where role not in ('admin', 'coach', 'joueur');
alter table public.profiles alter column role set default 'coach';
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'coach', 'joueur'));

create or replace function public.can_edit()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach');
$$;
create or replace function public.is_performance_editor()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach');
$$;
create or replace function public.can_view_performance()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach');
$$;
create or replace function public.can_manage_videos()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach');
$$;
create or replace function public.can_manage_plans()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach');
$$;
create or replace function public.is_video_stats_staff()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('admin', 'coach');
$$;

-- Un utilisateur ne change ni son rôle ni son club par une mise à jour
-- directe ; seules les RPC SECURITY DEFINER ci-dessous le peuvent.
create or replace function public.guard_profile_membership_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = old.id and current_user = 'authenticated' then
    new.role := old.role;
    new.club_id := old.club_id;
  end if;
  return new;
end; $$;

create or replace function public.club_set_member_role(p_profile_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_club_id bigint;
begin
  select club_id into v_club_id from public.profiles where id = auth.uid() and role = 'admin';
  if v_club_id is null then raise exception 'Action réservée à l’administrateur du club.'; end if;
  if p_profile_id = auth.uid() then raise exception 'Vous ne pouvez pas modifier votre propre rôle.'; end if;
  if p_role not in ('admin', 'coach') then
    raise exception 'Rôle invalide. Pour le rôle Joueur, associez une fiche joueur.';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and club_id = v_club_id) then
    raise exception 'Ce membre ne fait pas partie de votre club.';
  end if;
  update public.players set auth_user_id = null where auth_user_id = p_profile_id;
  update public.profiles set role = p_role where id = p_profile_id and club_id = v_club_id;
end; $$;

-- Retirer un membre du club (départ d'un joueur ou d'un coach).
create or replace function public.club_remove_member(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_club_id bigint;
begin
  select club_id into v_club_id from public.profiles where id = auth.uid() and role = 'admin';
  if v_club_id is null then raise exception 'Action réservée à l’administrateur du club.'; end if;
  if p_profile_id = auth.uid() then raise exception 'Vous ne pouvez pas vous retirer vous-même.'; end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and club_id = v_club_id) then
    raise exception 'Ce membre ne fait pas partie de votre club.';
  end if;
  update public.players set auth_user_id = null where auth_user_id = p_profile_id and club_id = v_club_id;
  delete from public.club_access where claimed_by = p_profile_id and club_id = v_club_id;
  update public.profiles set club_id = null, role = 'coach' where id = p_profile_id and club_id = v_club_id;
end; $$;

-- ------------------------------------------------------------
-- 2) Accès par adresse e-mail (remplace les codes)
-- ------------------------------------------------------------
drop function if exists public.join_as_player(text);
drop function if exists public.join_club(text);
alter table public.players drop column if exists player_code;

create table if not exists public.club_access (
  id          bigint generated always as identity primary key,
  club_id     bigint not null references public.clubs on delete cascade,
  email       text not null check (email = lower(btrim(email)) and email like '_%@_%'),
  role        text not null check (role in ('admin', 'coach', 'joueur')),
  player_id   bigint references public.players on delete cascade,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  claimed_by  uuid references auth.users on delete set null,
  claimed_at  timestamptz,
  unique (club_id, email),
  check ((role = 'joueur') = (player_id is not null))
);
create unique index if not exists club_access_player_uniq on public.club_access(player_id) where player_id is not null;

alter table public.club_access enable row level security;
drop policy if exists club_access_admin on public.club_access;
create policy club_access_admin on public.club_access for all
  using (public.is_club_admin() and club_id = public.my_club_id())
  with check (public.is_club_admin() and club_id = public.my_club_id()
    and (player_id is null or exists (select 1 from public.players p
      where p.id = player_id and p.club_id = public.my_club_id())));
grant select, insert, update, delete on public.club_access to authenticated;

/* Appelée après chaque connexion. Adresse confirmée uniquement : sinon
   n'importe qui pourrait s'inscrire avec l'adresse d'un joueur. Un compte
   déjà membre d'un AUTRE club n'est jamais déplacé en silence. */
create or replace function public.claim_club_access()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_acc public.club_access%rowtype;
begin
  if v_uid is null then return null; end if;
  select lower(u.email) into v_email from auth.users u
    where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then return null; end if;
  select * into v_acc from public.club_access
    where email = v_email and claimed_at is null
    order by created_at desc limit 1;
  if v_acc.id is null then return null; end if;
  if exists (select 1 from public.profiles where id = v_uid
             and club_id is not null and club_id <> v_acc.club_id) then
    return null;
  end if;
  if v_acc.player_id is not null then
    if exists (select 1 from public.players where id = v_acc.player_id
               and auth_user_id is not null and auth_user_id <> v_uid) then
      raise exception 'Cette fiche joueur est déjà associée à un autre compte.';
    end if;
    update public.players set auth_user_id = null where auth_user_id = v_uid and id <> v_acc.player_id;
    update public.players set auth_user_id = v_uid where id = v_acc.player_id;
  else
    update public.players set auth_user_id = null where auth_user_id = v_uid;
  end if;
  update public.profiles set club_id = v_acc.club_id, role = v_acc.role where id = v_uid;
  update public.club_access set claimed_by = v_uid, claimed_at = now() where id = v_acc.id;
  return v_acc.role;
end; $$;

revoke all on function public.claim_club_access() from public, anon;
revoke all on function public.club_remove_member(uuid) from public, anon;
revoke all on function public.club_set_member_role(uuid, text) from public, anon;
grant execute on function public.claim_club_access() to authenticated;
grant execute on function public.club_remove_member(uuid) to authenticated;
grant execute on function public.club_set_member_role(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 3) Séquences vidéo
--    drawings : [{ t: secondes, shapes: [{ type, color, x1, y1, x2, y2 }] }]
--    coordonnées relatives (0 à 1) à l'image de la vidéo.
-- ------------------------------------------------------------
create table if not exists public.video_sequences (
  id              bigint generated always as identity primary key,
  club_id         bigint not null references public.clubs on delete cascade,
  player_id       bigint not null references public.players on delete cascade,
  video_id        bigint not null references public.player_videos on delete cascade,
  label           text,
  start_sec       numeric(8,2) not null check (start_sec >= 0),
  end_sec         numeric(8,2) not null,
  selected        boolean not null default false,
  player_note     text,
  drawings        jsonb not null default '[]'::jsonb,
  submitted_at    timestamptz,
  staff_feedback  text,
  feedback_by     uuid references auth.users on delete set null,
  feedback_at     timestamptz,
  created_by      uuid references auth.users on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_sec > start_sec)
);
create index if not exists video_sequences_video_idx on public.video_sequences(video_id, start_sec);
create index if not exists video_sequences_player_idx on public.video_sequences(player_id);

/* Chacun écrit sa part : le joueur sa sélection, sa note et ses dessins ;
   le staff le découpage et son retour. */
create or replace function public.guard_video_sequence()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.can_manage_videos() then
    if tg_op = 'UPDATE' then
      new.selected := old.selected;
      new.player_note := old.player_note;
      new.drawings := old.drawings;
      new.submitted_at := old.submitted_at;
      if new.staff_feedback is distinct from old.staff_feedback then
        new.feedback_by := auth.uid();
        new.feedback_at := now();
      else
        new.feedback_by := old.feedback_by;
        new.feedback_at := old.feedback_at;
      end if;
    end if;
  else
    if tg_op = 'INSERT' then
      new.staff_feedback := null; new.feedback_by := null; new.feedback_at := null;
      new.created_by := auth.uid();
    else
      new.club_id := old.club_id; new.player_id := old.player_id; new.video_id := old.video_id;
      new.staff_feedback := old.staff_feedback;
      new.feedback_by := old.feedback_by; new.feedback_at := old.feedback_at;
      new.created_by := old.created_by;
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists guard_video_sequence on public.video_sequences;
create trigger guard_video_sequence before insert or update on public.video_sequences
  for each row execute function public.guard_video_sequence();

alter table public.video_sequences enable row level security;
drop policy if exists video_sequences_read   on public.video_sequences;
drop policy if exists video_sequences_insert on public.video_sequences;
drop policy if exists video_sequences_update on public.video_sequences;
drop policy if exists video_sequences_delete on public.video_sequences;

create policy video_sequences_read on public.video_sequences for select using (
  exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
  or (public.is_staff() and club_id = public.my_club_id())
);
create policy video_sequences_insert on public.video_sequences for insert with check (
  exists (select 1 from public.player_videos v
          where v.id = video_id and v.player_id = video_sequences.player_id and v.club_id = video_sequences.club_id)
  and (
    exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
    or (public.can_manage_videos() and club_id = public.my_club_id())
  )
);
create policy video_sequences_update on public.video_sequences for update using (
  exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
  or (public.can_manage_videos() and club_id = public.my_club_id())
) with check (
  exists (select 1 from public.player_videos v
          where v.id = video_id and v.player_id = video_sequences.player_id and v.club_id = video_sequences.club_id)
);
create policy video_sequences_delete on public.video_sequences for delete using (
  (public.can_manage_videos() and club_id = public.my_club_id())
  or (created_by = auth.uid()
      and exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid()))
);
grant select, insert, update, delete on public.video_sequences to authenticated;

-- ------------------------------------------------------------
-- 4) Vidéo liée à un schéma de procédé
-- ------------------------------------------------------------
alter table public.tactical_schemas
  add column if not exists video_id bigint references public.player_videos on delete set null;

create or replace function public.check_schema_video()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.video_id is not null and not exists (
    select 1 from public.player_videos v
      join public.procedures pr on pr.id = new.procedure_id
      join public.sessions s on s.id = pr.session_id
    where v.id = new.video_id and v.club_id = s.club_id
  ) then
    raise exception 'Vidéo introuvable dans ce club.';
  end if;
  return new;
end; $$;
drop trigger if exists check_schema_video on public.tactical_schemas;
create trigger check_schema_video before insert or update of video_id on public.tactical_schemas
  for each row execute function public.check_schema_video();

commit;
