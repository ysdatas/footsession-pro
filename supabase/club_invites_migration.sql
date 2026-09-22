-- Migration FootSession Pro : correctifs club/invitations
begin;
alter table public.clubs add column if not exists saison_start date;

create or replace function public.guard_profile_membership_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = old.id then
    new.role := old.role;
    new.club_id := old.club_id;
  end if;
  return new;
end; $$;

drop trigger if exists guard_profile_membership_changes on public.profiles;
create trigger guard_profile_membership_changes
before update on public.profiles
for each row execute function public.guard_profile_membership_changes();

create or replace function public.create_club(p_nom text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_code text; v_nom text := nullif(trim(p_nom), ''); v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Vous devez être connecté.'; end if;
  if v_nom is null then raise exception 'Le nom du club est obligatoire.'; end if;
  if length(v_nom) > 120 then raise exception 'Nom du club trop long (120 caractères maximum).'; end if;
  if not exists (select 1 from public.profiles where id = v_user) then raise exception 'Profil utilisateur introuvable.'; end if;
  if exists (select 1 from public.profiles where id = v_user and club_id is not null) then raise exception 'Votre compte appartient déjà à un club.'; end if;
  loop
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 8));
    exit when not exists (select 1 from public.clubs where join_code = v_code);
  end loop;
  insert into public.clubs (nom, join_code, created_by) values (v_nom, v_code, v_user) returning id into v_id;
  update public.profiles set club_id = v_id, role = 'admin' where id = v_user;
  return v_id;
end; $$;

create or replace function public.join_club(p_code text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_user uuid := auth.uid(); v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g'));
begin
  if v_user is null then raise exception 'Vous devez être connecté.'; end if;
  if v_code = '' then raise exception 'Saisissez un code d’invitation.'; end if;
  if not exists (select 1 from public.profiles where id = v_user) then raise exception 'Profil utilisateur introuvable.'; end if;
  if exists (select 1 from public.profiles where id = v_user and club_id is not null) then raise exception 'Votre compte appartient déjà à un club.'; end if;
  select id into v_id from public.clubs where upper(join_code) = v_code;
  if v_id is null then raise exception 'Code de club invalide.'; end if;
  update public.profiles set club_id = v_id, role = 'viewer' where id = v_user;
  return v_id;
end; $$;

revoke all on function public.create_club(text) from public, anon;
revoke all on function public.join_club(text) from public, anon;
grant execute on function public.create_club(text) to authenticated;
grant execute on function public.join_club(text) to authenticated;
commit;
