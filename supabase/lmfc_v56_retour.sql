/* Retour arrière de lmfc_v56.sql (dernière connexion). Rejouable.
   Retire la fonction : Mon club n'affiche plus les connexions. Aucune donnée en dépend. */
begin;
drop function if exists public.club_member_logins(integer);
commit;
