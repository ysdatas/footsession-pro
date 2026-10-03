/* ============================================================
   LMFC Performance — migration 22 : objectifs, principe de jeu,
   stockage des schémas et des logos.
   À exécuter APRÈS video_status.sql. Idempotent (rejouable).

   1. Objectifs : un statut — En cours, Atteint, Non atteint.
   2. Un point (objectif, point fort, axe) reste sur SON joueur :
      joueur et club ne changent plus après la création, et une
      image ne s'attache qu'à un point du même joueur. Un objectif
      ne peut donc jamais apparaître sur la fiche d'un autre.
   3. Principe de jeu : une seule fois par séance
      (sessions.principes_jeu). Les séances existantes le reprennent
      de leurs procédés ; la colonne des procédés reste, en lecture,
      pour les anciennes données.
   4. Buckets « schemas » et « logos » : seul le staff (admin, coach)
      écrit, modifie ou supprime, et seulement dans le dossier de son
      club. Avant : n'importe quel compte connecté le pouvait.
   ============================================================ */
begin;

-- ------------------------------------------------------------
-- 1) Statut des objectifs
-- ------------------------------------------------------------
alter table public.player_performance_notes
  add column if not exists status text not null default 'active';
alter table public.player_performance_notes
  drop constraint if exists player_performance_notes_status_check;
alter table public.player_performance_notes
  add constraint player_performance_notes_status_check
  check (status in ('active', 'achieved', 'missed'));

create index if not exists player_performance_notes_club_kind_idx
  on public.player_performance_notes(club_id, kind, status);

-- ------------------------------------------------------------
-- 2) Un point reste attaché à son joueur
-- ------------------------------------------------------------
create or replace function public.guard_performance_note()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.player_id is distinct from old.player_id or new.club_id is distinct from old.club_id then
    raise exception 'Un objectif ou un point reste attaché à son joueur : supprimez-le, puis recréez-le pour l''autre joueur.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists guard_performance_note on public.player_performance_notes;
create trigger guard_performance_note
  before update on public.player_performance_notes
  for each row execute function public.guard_performance_note();

create or replace function public.guard_performance_media()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.note_id is not null and not exists (
    select 1 from public.player_performance_notes n
    where n.id = new.note_id and n.player_id = new.player_id and n.club_id = new.club_id
  ) then
    raise exception 'Cette image doit appartenir au même joueur que son objectif.';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_performance_media on public.player_performance_media;
create trigger guard_performance_media
  before insert or update on public.player_performance_media
  for each row execute function public.guard_performance_media();

-- ------------------------------------------------------------
-- 3) Principe de jeu de la séance
-- ------------------------------------------------------------
alter table public.sessions add column if not exists principes_jeu text;

-- Séances existantes : principes distincts de leurs procédés, dans
-- l'ordre des procédés. Une séance déjà renseignée n'est pas touchée.
update public.sessions s
set principes_jeu = x.txt
from (
  select session_id, string_agg(pj, ' · ' order by first_ordre) as txt
  from (
    select session_id, btrim(principes_jeu) as pj, min(ordre) as first_ordre
    from public.procedures
    where nullif(btrim(principes_jeu), '') is not null
    group by session_id, btrim(principes_jeu)
  ) d
  group by session_id
) x
where x.session_id = s.id and nullif(btrim(s.principes_jeu), '') is null;

-- ------------------------------------------------------------
-- 4) Stockage « schemas » et « logos » : staff du club seulement
-- ------------------------------------------------------------
drop policy if exists "logos_schemas_write"  on storage.objects;
drop policy if exists "logos_schemas_update" on storage.objects;
drop policy if exists "logos_schemas_delete" on storage.objects;
create policy "logos_schemas_write" on storage.objects for insert
  with check (bucket_id in ('logos', 'schemas') and public.can_edit()
    and (storage.foldername(name))[1] = public.my_club_id()::text);
create policy "logos_schemas_update" on storage.objects for update
  using (bucket_id in ('logos', 'schemas') and public.can_edit()
    and (storage.foldername(name))[1] = public.my_club_id()::text)
  with check (bucket_id in ('logos', 'schemas') and public.can_edit()
    and (storage.foldername(name))[1] = public.my_club_id()::text);
create policy "logos_schemas_delete" on storage.objects for delete
  using (bucket_id in ('logos', 'schemas') and public.can_edit()
    and (storage.foldername(name))[1] = public.my_club_id()::text);

commit;
