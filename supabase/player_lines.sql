-- ============================================================
--  FootSession Pro — Ligne de jeu du joueur
--
--  À exécuter après roles_teams_preventions.sql. Idempotent.
--
--  La page Joueurs range l'effectif en Gardiens / Défenseurs /
--  Milieux / Attaquants. Par défaut la ligne est déduite du poste
--  (GB, DC, MC, BU…) ; glisser une carte dans une autre rubrique
--  enregistre ici un choix explicite, qui prime sur le poste.
--  Vide = déduite du poste.
-- ============================================================
alter table public.players add column if not exists ligne text;

alter table public.players drop constraint if exists players_ligne_check;
alter table public.players add constraint players_ligne_check
  check (ligne is null or ligne in ('gardien', 'defenseur', 'milieu', 'attaquant'));
