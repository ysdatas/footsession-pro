/* ============================================================
   FootSession Pro — migration 21 : statuts des séquences vidéo
   À exécuter APRÈS platform_v2.sql. Idempotent.

   Le joueur et le staff lisent le même statut :
     Brouillon → Prêt → Envoyé → Vu → Retour
                          ↘ Modifié (changé depuis l'envoi : à renvoyer)

   - seen_at   : le staff a ouvert la séquence envoyée (posé par le staff).
   - edited_at : dernière modification du CONTENU par le joueur
                 (nom, début, fin, analyse, annotations).
   Toutes les dates sont posées par le serveur (now()), jamais par le
   navigateur : une horloge de téléphone en retard ne doit pas afficher
   « Modifié » juste après un envoi.
   ============================================================ */
begin;

alter table public.video_sequences
  add column if not exists seen_at   timestamptz,
  add column if not exists edited_at timestamptz;

create or replace function public.guard_video_sequence()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.can_manage_videos() then
    -- Staff : découpage, retour et « vu ». Jamais le travail du joueur.
    if tg_op = 'UPDATE' then
      new.selected := old.selected;
      new.player_note := old.player_note;
      new.drawings := old.drawings;
      new.submitted_at := old.submitted_at;
      new.edited_at := old.edited_at;
      if new.staff_feedback is distinct from old.staff_feedback then
        new.feedback_by := auth.uid();
        new.feedback_at := now();
      else
        new.feedback_by := old.feedback_by;
        new.feedback_at := old.feedback_at;
      end if;
      if new.seen_at is distinct from old.seen_at then
        new.seen_at := case when new.seen_at is null then null else now() end;
      end if;
    else
      new.edited_at := null;
    end if;
  else
    -- Joueur : sa sélection, son analyse, ses annotations et l'envoi.
    if tg_op = 'INSERT' then
      new.staff_feedback := null; new.feedback_by := null; new.feedback_at := null;
      new.seen_at := null;
      new.created_by := auth.uid();
      new.edited_at := now();
      if new.submitted_at is not null then new.submitted_at := now(); end if;
    else
      new.club_id := old.club_id; new.player_id := old.player_id; new.video_id := old.video_id;
      new.staff_feedback := old.staff_feedback;
      new.feedback_by := old.feedback_by; new.feedback_at := old.feedback_at;
      new.created_by := old.created_by;
      new.seen_at := old.seen_at;
      if (new.label, new.start_sec, new.end_sec, new.player_note, new.drawings)
         is distinct from (old.label, old.start_sec, old.end_sec, old.player_note, old.drawings) then
        new.edited_at := now();
      else
        new.edited_at := old.edited_at;
      end if;
      if new.submitted_at is distinct from old.submitted_at and new.submitted_at is not null then
        new.submitted_at := now();
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists guard_video_sequence on public.video_sequences;
create trigger guard_video_sequence before insert or update on public.video_sequences
  for each row execute function public.guard_video_sequence();

commit;
