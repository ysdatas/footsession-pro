-- ============================================================
--  FootSession Pro — Programme individuel du joueur
--
--  À exécuter après roles_teams_preventions.sql. Idempotent et
--  transactionnel : en cas d'erreur, rien n'est appliqué.
--
--  Un programme = des exercices, regroupés par séance, chacun avec :
--    - consignes et dosage ;
--    - une image (photo de l'exercice) et sa légende ;
--    - un schéma dessiné dans le tableau tactique ;
--    - une vidéo du joueur (player_videos) à revoir.
--  Le staff (admin, coach, prépa) crée et modifie. Le joueur consulte
--  SES exercices, les marque « faits » et laisse un ressenti — il ne
--  peut rien modifier d'autre (RPC mark_program_exercise).
--
--  Images et schémas : bucket player-performance-media,
--  {club_id}/{player_id}/program/... (policies déjà en place : lecture
--  par le joueur concerné et le staff, écriture par can_manage_plans()).
-- ============================================================
begin;

create table if not exists public.program_exercises (
  id              bigint generated always as identity primary key,
  club_id         bigint not null references public.clubs(id) on delete cascade,
  player_id       bigint not null references public.players(id) on delete cascade,
  seance          text,              -- regroupement : « Séance 1 — Renforcement »…
  title           text not null,
  instructions    text,
  dosage          text,              -- ex. 3 × 10, 45 s d'effort / 15 s de repos
  sort_order      integer not null default 0,
  image_path      text,
  image_caption   text,
  schema_json     jsonb,             -- schéma du tableau tactique
  schema_path     text,              -- son image PNG
  video_id        bigint references public.player_videos(id) on delete set null,
  done_at         timestamptz,       -- renseigné par le joueur
  player_feedback text,              -- ressenti du joueur
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists program_exercises_player_idx
  on public.program_exercises(player_id, sort_order, id);

drop trigger if exists trg_touch_program_exercises on public.program_exercises;
create trigger trg_touch_program_exercises before update on public.program_exercises
  for each row execute function public.touch_player_performance_row();

alter table public.program_exercises enable row level security;

drop policy if exists program_exercises_read  on public.program_exercises;
drop policy if exists program_exercises_write on public.program_exercises;
create policy program_exercises_read on public.program_exercises for select using (
  exists (select 1 from public.players p where p.id = player_id and p.auth_user_id = auth.uid())
  or (public.is_staff() and club_id = public.my_club_id())
);
-- La vidéo liée doit appartenir au même joueur : un exercice ne peut pas
-- donner accès à la vidéo d'un autre.
create policy program_exercises_write on public.program_exercises for all
  using (public.can_manage_plans() and club_id = public.my_club_id())
  with check (
    public.can_manage_plans() and club_id = public.my_club_id()
    and exists (select 1 from public.players p where p.id = player_id and p.club_id = public.my_club_id())
    and (video_id is null or exists (
      select 1 from public.player_videos v where v.id = video_id and v.player_id = program_exercises.player_id))
  );
grant select, insert, update, delete on public.program_exercises to authenticated;

-- Le joueur marque un exercice fait (ou non) et laisse son ressenti.
-- Seuls ces deux champs, et seulement sur SES exercices.
create or replace function public.mark_program_exercise(p_id bigint, p_done boolean, p_feedback text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.program_exercises e
     set done_at = case when p_done then coalesce(e.done_at, now()) else null end,
         player_feedback = nullif(btrim(coalesce(p_feedback, '')), '')
   where e.id = p_id
     and exists (select 1 from public.players p where p.id = e.player_id and p.auth_user_id = auth.uid());
  if not found then
    raise exception 'Exercice introuvable pour ce joueur';
  end if;
end; $$;
revoke all on function public.mark_program_exercise(bigint, boolean, text) from public, anon;
grant execute on function public.mark_program_exercise(bigint, boolean, text) to authenticated;

commit;
