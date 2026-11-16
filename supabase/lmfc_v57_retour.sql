/* Retour arrière de lmfc_v57.sql (prénoms et noms mis en forme). Rejouable.
   Rend à chaque fiche son prénom et son nom d'avant (lmfc_v57_noms_avant), sauf si
   on l'a modifiée depuis : elle garde alors ce qui a été saisi. Les fiches créées
   depuis gardent leur nom mis en forme. Plus aucune mise en forme ensuite. */
begin;
drop trigger if exists trg_players_names on public.players;
do $$
begin
  if to_regclass('public.lmfc_v57_noms_avant') is not null then
    update public.players p set nom = b.nom, prenom = b.prenom
      from public.lmfc_v57_noms_avant b
     where b.player_id = p.id
       and p.nom = coalesce(public.fmt_nom(b.nom), b.nom) and p.prenom is not distinct from public.fmt_prenom(b.prenom);
  end if;
end $$;
drop table if exists public.lmfc_v57_noms_avant;
drop function if exists public.players_names();
drop function if exists public.fmt_nom(text);
drop function if exists public.fmt_prenom(text);
commit;
