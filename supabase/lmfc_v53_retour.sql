/* Retour arrière de lmfc_v53.sql (« Ce n'est pas un doublon »). Rejouable.
   Efface les décisions : les matchs qu'elles déclaraient distincts sont de nouveau
   signalés comme doublons possibles. Rien d'autre n'en dépend. */
begin;
drop table if exists public.match_not_duplicates;
commit;
