/* ============================================================
   LMFC Performance — migration 31 : durées à virgule, statuts.
   À exécuter APRÈS lmfc_v11.sql. Idempotent (rejouable) et
   transactionnel : en cas d'erreur, rien n'est appliqué.

   1) Durées : un procédé de 5 × 1,5' + 4 × 1' dure 11,5' ; une
      récupération peut durer 0,5'. Ces colonnes étaient des entiers
      (11,5 refusé à l'enregistrement) : elles passent en numeric.
   2) Présences :
      - « Groupe pro » : le joueur s'entraîne avec le groupe pro, il
        ne participe pas à la séance (comme « Sélection ») ;
      - « Autre » : motif libre (statut_libre) ; la case « participe »
        de l'écran donne present, que le déclencheur conserve ;
      - Retard, Excusé, Malade ne sont plus proposés mais restent
        valides : les anciennes séances les gardent.
   ============================================================ */
begin;

-- ------------------------------------------------------------
-- 1) Durées décimales
-- ------------------------------------------------------------
alter table public.procedures alter column duree_min type numeric(6,2);
alter table public.procedures alter column temps_recup_min type numeric(6,2);
alter table public.procedures alter column duree_sequence_min type numeric(6,2);
alter table public.sessions alter column duree_min type numeric(6,2);

-- ------------------------------------------------------------
-- 2) Statuts : groupe pro, motif libre
-- ------------------------------------------------------------
alter table public.attendance add column if not exists statut_libre text;
alter table public.attendance drop constraint if exists attendance_statut_libre_check;
alter table public.attendance add constraint attendance_statut_libre_check check (char_length(statut_libre) <= 40);
alter table public.attendance drop constraint if exists attendance_statut_check;
alter table public.attendance add constraint attendance_statut_check check (statut is null
  or statut in ('present', 'reprise', 'retard', 'absent', 'excuse', 'blesse', 'malade', 'selection', 'groupe_pro', 'autre'));

create or replace function public.attendance_sync_present()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Sans statut (anciennes séances) : present reste tel qu'enregistré.
  -- « Autre » : present vient de la case « participe » de l'écran.
  if new.statut is not null and new.statut <> 'autre' then new.present := new.statut in ('present', 'reprise', 'retard'); end if;
  if new.statut is distinct from 'autre' then new.statut_libre := null; end if;
  return new;
end; $$;

commit;
