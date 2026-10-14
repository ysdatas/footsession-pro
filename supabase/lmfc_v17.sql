/* ============================================================
   LMFC Performance — migration 36 : version des schémas tactiques.
   À exécuter APRÈS lmfc_v16.sql. Idempotent (rejouable) et
   transactionnel : en cas d'erreur, rien n'est appliqué.

   tactical_schemas.updated_at suit chaque écriture du schéma (dessin,
   image importée, brouillon rattaché). La page séance l'ajoute à
   l'adresse de l'image : après un nouvel enregistrement, aucun cache
   ne peut plus montrer l'ancienne image (ou un cadre vide).
   ============================================================ */
begin;

alter table public.tactical_schemas add column if not exists updated_at timestamptz default now();
-- Même déclencheur que la séance (lmfc_v13.sql) : updated_at := l'heure de l'écriture.
drop trigger if exists trg_touch_tactical_schema on public.tactical_schemas;
create trigger trg_touch_tactical_schema before insert or update on public.tactical_schemas
  for each row execute function public.touch_session();

commit;
