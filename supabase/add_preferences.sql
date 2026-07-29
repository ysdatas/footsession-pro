-- ============================================================
--  FootSession Pro — Préférences utilisateur
--  Ajoute une colonne JSON au profil pour stocker les réglages
--  personnels (couleurs des pions, taille des éléments, police,
--  vue de terrain par défaut…).
--  À exécuter dans Supabase → SQL Editor.
-- ============================================================

alter table public.profiles
  add column if not exists prefs jsonb not null default '{}'::jsonb;

-- Chacun peut lire et modifier ses propres préférences : déjà couvert par
-- les politiques existantes "profiles_read" (select) et "profiles_self" (update).
