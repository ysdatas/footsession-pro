/* Retour arrière de lmfc_v48.sql. Rejouable.
   Refusé si une séquence est codée, si un codage attend dans la corbeille ou si
   une vidéo a un poste ou un lieu : ce travail serait perdu. */
begin;

do $$
begin
  if to_regclass('public.sequence_codes') is not null then
    if exists (select 1 from public.sequence_codes) or exists (select 1 from public.trash where tbl = 'sequence_codes') then
      raise exception 'Retour arrière refusé : des séquences sont codées (onglet Analyse).';
    end if;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'player_videos' and column_name = 'poste') then
    if exists (select 1 from public.player_videos where poste is not null or lieu is not null) then
      raise exception 'Retour arrière refusé : des vidéos ont un poste ou un lieu.';
    end if;
  end if;
end $$;

drop function if exists public.rename_sequence_tag(text, text);
drop table if exists public.sequence_codes;
drop function if exists public.sequence_codes_stamp();
drop index if exists public.video_sequences_id_player_club_idx;
alter table public.player_videos drop constraint if exists player_videos_poste_check;
alter table public.player_videos drop constraint if exists player_videos_lieu_check;
alter table public.player_videos drop column if exists poste;
alter table public.player_videos drop column if exists lieu;

commit;
