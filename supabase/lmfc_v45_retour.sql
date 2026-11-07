/* Retour arrière de lmfc_v45.sql. Refusé si une réponse serait perdue. */
begin;

do $$
begin
  if to_regclass('public.custom_form_responses') is not null
     and (exists (select 1 from public.custom_form_responses)
          or exists (select 1 from public.trash where tbl = 'custom_form_responses')) then
    raise exception 'Retour arrière refusé : des réponses de joueurs existent.';
  end if;
end $$;

drop function if exists public.custom_forms_my_pending();
drop function if exists public.custom_forms_my_history(integer, integer);
drop function if exists public.custom_form_submit(bigint, jsonb);
drop table if exists public.custom_form_responses;
drop function if exists public.custom_form_response_can_read(bigint, bigint, bigint);

commit;
