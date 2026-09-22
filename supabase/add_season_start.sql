-- ============================================================
--  FootSession Pro — Début de saison (numérotation des semaines)
--
--  Sert à numéroter les « dossiers » de la liste des séances :
--  la semaine contenant cette date devient la Semaine 1.
--
--  Volontairement porté par le CLUB et non par le profil : la base
--  est partagée par tout le staff, et deux coachs qui parlent de la
--  « semaine 3 » doivent désigner la même semaine.
--
--  Laissé vide, l'application retombe sur le lundi de la séance la
--  plus ancienne, ce qui donne une numérotation correcte sans réglage.
--
--  À exécuter dans Supabase → SQL Editor. Sûr à relancer.
-- ============================================================

alter table public.clubs
  add column if not exists saison_start date;
