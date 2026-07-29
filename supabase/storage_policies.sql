-- ============================================================
--  FootSession Pro — Storage : création des buckets + politiques
--  À exécuter dans Supabase → SQL Editor (une seule fois).
--  Crée directement les buckets "schemas" et "logos" (pas besoin
--  de les créer manuellement dans l'interface Storage).
--
--  Simplification assumée : tout utilisateur connecté peut lire/écrire
--  dans ces 2 buckets (les images ne sont pas sensibles en elles-mêmes ;
--  ce qui est protégé par le RLS des tables, c'est le LIEN vers l'image
--  — un membre d'un autre club ne peut pas savoir quel fichier chercher).
-- ============================================================

insert into storage.buckets (id, name, public)
values ('schemas', 'schemas', false), ('logos', 'logos', false)
on conflict (id) do nothing;

create policy "logos_schemas_read" on storage.objects for select
  using (bucket_id in ('logos', 'schemas') and auth.role() = 'authenticated');

create policy "logos_schemas_write" on storage.objects for insert
  with check (bucket_id in ('logos', 'schemas') and auth.role() = 'authenticated');

create policy "logos_schemas_update" on storage.objects for update
  using (bucket_id in ('logos', 'schemas') and auth.role() = 'authenticated');

create policy "logos_schemas_delete" on storage.objects for delete
  using (bucket_id in ('logos', 'schemas') and auth.role() = 'authenticated');
