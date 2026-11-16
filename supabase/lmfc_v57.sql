/* ============================================================
   LMFC Performance — lmfc_v57.sql (n° 75) : prénoms et noms écrits de la même façon
   À exécuter après lmfc_v56.sql. Rejouable et transactionnelle.
   Avant : lancer lmfc_v57_apercu.sql (lecture seule) pour voir chaque nom qui changera.
   Retour arrière : lmfc_v57_retour.sql (rend les noms d'avant, sauf ceux modifiés depuis).

   Fiches joueurs (players, joueurs extérieurs compris) :
     - prénom : chaque partie avec une majuscule, le reste en minuscules
       (« adnane » → « Adnane », « jean-pierre » → « Jean-Pierre », « n'golo » → « N'Golo ») ;
     - nom : en majuscules, accents gardés (« kharroubi » → « KHARROUBI »,
       « kanté » → « KANTÉ », « de la fuente » → « DE LA FUENTE ») ;
     - espaces en trop retirés ; traits d'union et apostrophes gardés.
   À chaque création ou modification, quelle qu'en soit la source (fiche, import
   Excel, joueur extérieur…) : déclencheur trg_players_names (fmt_prenom, fmt_nom).
   Les fiches déjà en base sont mises en forme une fois ; leurs noms d'avant sont
   gardés dans lmfc_v57_noms_avant (lu par le SQL Editor seulement) pour le retour.
   La migration s'arrête sans rien changer si la base ne met pas les lettres
   accentuées en majuscules (réglage de langue).
   La recherche ne dépend pas de la casse ni des accents (côté pages, inchangé).
   ============================================================ */
begin;

do $$
begin
  if upper('é') <> 'É' or lower('À') <> 'à' then
    raise exception 'La base ne met pas les lettres accentuées en majuscules (réglage de langue) : migration arrêtée, rien n''a changé.';
  end if;
end $$;

create or replace function public.fmt_prenom(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(initcap(lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'))), '');
$$;
create or replace function public.fmt_nom(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(upper(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')), '');
$$;

create or replace function public.players_names()
returns trigger language plpgsql set search_path = public as $$
begin
  new.nom := coalesce(public.fmt_nom(new.nom), new.nom);   -- nom obligatoire : jamais vidé ici
  new.prenom := public.fmt_prenom(new.prenom);
  return new;
end; $$;
revoke all on function public.players_names() from public, anon, authenticated;
drop trigger if exists trg_players_names on public.players;
create trigger trg_players_names before insert or update of nom, prenom on public.players
  for each row execute function public.players_names();

-- Noms d'avant : gardés une fois (rejouer la migration ne les écrase pas).
create table if not exists public.lmfc_v57_noms_avant (
  player_id bigint primary key,
  nom       text,
  prenom    text
);
alter table public.lmfc_v57_noms_avant enable row level security;
revoke all on public.lmfc_v57_noms_avant from public, anon, authenticated;
drop policy if exists lecteur_no_insert on public.lmfc_v57_noms_avant;
drop policy if exists lecteur_no_update on public.lmfc_v57_noms_avant;
drop policy if exists lecteur_no_delete on public.lmfc_v57_noms_avant;
create policy lecteur_no_insert on public.lmfc_v57_noms_avant as restrictive for insert to authenticated
  with check (not (select public.is_lecteur()));
create policy lecteur_no_update on public.lmfc_v57_noms_avant as restrictive for update to authenticated
  using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()));
create policy lecteur_no_delete on public.lmfc_v57_noms_avant as restrictive for delete to authenticated
  using (not (select public.is_lecteur()));

insert into public.lmfc_v57_noms_avant (player_id, nom, prenom)
  select p.id, p.nom, p.prenom from public.players p
   where p.nom is distinct from coalesce(public.fmt_nom(p.nom), p.nom) or p.prenom is distinct from public.fmt_prenom(p.prenom)
  on conflict (player_id) do nothing;
-- Le déclencheur met en forme ; « set nom = nom » suffit à le faire passer.
update public.players p set nom = p.nom, prenom = p.prenom
 where p.nom is distinct from coalesce(public.fmt_nom(p.nom), p.nom) or p.prenom is distinct from public.fmt_prenom(p.prenom);

commit;
