/* Retour arrière de lmfc_v44.sql.
   Refusé dès qu'un formulaire a été créé : son contenu doit rester conservé.
   Exporter/archiver ces définitions avant de retirer ce schéma. */
begin;

do $$
begin
  if to_regclass('public.custom_forms') is not null
     and exists (select 1 from public.custom_forms) then
    raise exception 'Retour arrière refusé : des formulaires existent. Exportez leurs définitions avant de poursuivre.';
  end if;
end $$;

drop function if exists public.custom_form_save(bigint, text, text, jsonb, bigint[], boolean, integer);
drop table if exists public.custom_form_teams;
drop table if exists public.custom_form_versions;
drop table if exists public.custom_forms;
drop function if exists public.custom_form_can_read(bigint);
drop function if exists public.custom_form_can_manage_team(bigint);

commit;
