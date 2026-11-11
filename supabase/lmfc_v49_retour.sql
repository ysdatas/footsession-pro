/* Retour arrière de lmfc_v49.sql. Rejouable.
   Refusé s'il existe un clip réservé au staff (il redeviendrait visible du
   joueur), un descripteur au catalogue ou une minute de match : ce travail
   serait perdu ou exposé. rename_sequence_tag reprend sa version de lmfc_v48.sql. */
begin;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'video_sequences' and column_name = 'staff_only') then
    if exists (select 1 from public.video_sequences where staff_only) then
      raise exception 'Retour arrière refusé : des clips sont réservés au staff (ils redeviendraient visibles des joueurs).';
    end if;
  end if;
  if to_regclass('public.sequence_descriptors') is not null then
    if exists (select 1 from public.sequence_descriptors) then
      raise exception 'Retour arrière refusé : le catalogue des descripteurs n''est pas vide.';
    end if;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'sequence_codes' and column_name = 'minute_match') then
    if exists (select 1 from public.sequence_codes where minute_match is not null) then
      raise exception 'Retour arrière refusé : des minutes de match sont renseignées.';
    end if;
  end if;
end $$;

drop function if exists public.undo_sequence_changes(jsonb);
drop function if exists public.bulk_update_sequence_codes(bigint[], jsonb, text[], text[]);
drop function if exists public.save_sequence_code(bigint, bigint, text, numeric, numeric, jsonb);
drop function if exists public.save_sequence_code(bigint, bigint, text, numeric, numeric, boolean, jsonb);
drop function if exists public.sequence_code_patch(bigint, jsonb);
drop table if exists public.sequence_descriptors;
drop policy if exists video_sequences_staff_only on public.video_sequences;
alter table public.video_sequences drop column if exists staff_only;
alter table public.sequence_codes drop column if exists minute_match;

create or replace function public.rename_sequence_tag(p_old text, p_new text)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  v_new   text := nullif(btrim(coalesce(p_new, '')), '');
  v_count integer;
begin
  if nullif(btrim(coalesce(p_old, '')), '') is null then raise exception 'Tag à renommer manquant.'; end if;
  if char_length(v_new) > 40 then raise exception 'Tag trop long : 40 caractères au plus.'; end if;
  update public.sequence_codes c
     set tags = array(select distinct t from unnest(array_replace(c.tags, p_old, v_new)) t where t is not null order by t)
   where c.tags @> array[p_old] and c.club_id = public.my_club_id();
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
revoke all on function public.rename_sequence_tag(text, text) from public, anon;
grant execute on function public.rename_sequence_tag(text, text) to authenticated;

commit;
