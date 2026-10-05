/* ============================================================
   LMFC Performance — migration 25 : programme terrain par point.
   À exécuter APRÈS lmfc_v5.sql. Idempotent (rejouable) et
   transactionnel : en cas d'erreur, rien n'est appliqué.

   Un point fort ou un axe d'amélioration (player_performance_notes)
   porte désormais :
     - video_id     : une vidéo du joueur (player_videos), montrée à
                      côté de la description ;
     - exercise_ids : ses exercices (program_exercises), dans l'ordre
                      choisi (Exo 1, Exo 2…).
   Pas de clé étrangère, volontairement : la corbeille restaure une
   ligne avec ses identifiants d'origine. Une vidéo ou un exercice
   supprimé puis restauré retrouve donc tout seul sa place dans le
   point, et un point restauré retrouve ses liens. Un identifiant
   orphelin (élément supprimé pour de bon) est simplement ignoré par
   les pages.
   Contrôle à l'écriture : une vidéo ou un exercice d'un AUTRE joueur
   est refusé. Un identifiant introuvable est accepté : c'est le cas
   pendant une restauration, où le point peut revenir avant ses
   exercices.
   ============================================================ */
begin;

alter table public.player_performance_notes add column if not exists video_id bigint;
alter table public.player_performance_notes add column if not exists exercise_ids bigint[] not null default '{}';

create or replace function public.guard_note_links()
returns trigger language plpgsql set search_path = public as $$
begin
  new.exercise_ids := coalesce(new.exercise_ids, '{}');
  if exists (select 1 from public.player_videos v
              where v.id = new.video_id and v.player_id <> new.player_id) then
    raise exception 'Cette vidéo n''appartient pas à ce joueur.';
  end if;
  if exists (select 1 from public.program_exercises e
              where e.id = any(new.exercise_ids) and e.player_id <> new.player_id) then
    raise exception 'Ces exercices n''appartiennent pas à ce joueur.';
  end if;
  return new;
end; $$;

drop trigger if exists guard_note_links on public.player_performance_notes;
create trigger guard_note_links
  before insert or update of video_id, exercise_ids on public.player_performance_notes
  for each row execute function public.guard_note_links();

commit;
