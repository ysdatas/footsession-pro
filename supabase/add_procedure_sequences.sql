-- ============================================================
--  FootSession Pro — Type de procédé et structure des séquences
--
--  Ajoute de quoi décrire précisément un procédé :
--    • type_procede       : « Jeu », « Exercice » ou « Situation »
--    • nb_sequences       : nombre de répétitions (ex. 3)
--    • duree_sequence_min : durée d'une séquence (ex. 4 min)
--
--  Combiné à temps_recup_min (déjà présent), cela permet d'écrire
--  « 3 × 4' avec 1' de récup » et de distinguer le temps de travail
--  (ballon) du temps total (travail + récupérations).
--
--  Rien n'est supprimé : sessions.categorie reste en place, elle
--  n'est simplement plus lue ni écrite par l'application.
--
--  À exécuter dans Supabase → SQL Editor. Sûr à relancer.
-- ============================================================

alter table public.procedures
  add column if not exists type_procede       text,
  add column if not exists nb_sequences       int,
  add column if not exists duree_sequence_min numeric(5,1);

-- Garde-fous : des valeurs négatives n'auraient aucun sens et
-- fausseraient les totaux affichés sur la fiche de séance.
alter table public.procedures
  drop constraint if exists procedures_nb_sequences_check;
alter table public.procedures
  add  constraint procedures_nb_sequences_check
  check (nb_sequences is null or nb_sequences > 0);

alter table public.procedures
  drop constraint if exists procedures_duree_sequence_check;
alter table public.procedures
  add  constraint procedures_duree_sequence_check
  check (duree_sequence_min is null or duree_sequence_min > 0);
