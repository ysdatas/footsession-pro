/* ============================================================
   LMFC Performance — lmfc_v27.sql : matchs importés de la FFF
   À exécuter APRÈS lmfc_v26.sql. Rejouable, transactionnelle.

   La FFF n'ouvre pas d'API aux clubs : le staff colle dans
   « Retours de match » le calendrier copié depuis epreuves.fff.fr
   (matchs-fff.js). Ici, seulement ce qu'il faut pour le ranger :
   - heure et stade d'un match (saisis ou importés) ;
   - ext_source / ext_id : la rencontre côté source, une seule fois
     par club (index unique : deux imports simultanés ne doublent
     rien ; les matchs saisis à la main, sans ext_id, ne sont pas
     concernés) ;
   - ext_data : la dernière valeur importée de chaque champ. Un champ
     modifié par le staff n'est plus remplacé par l'import suivant ;
     commentaire, informations, à retenir et joueurs ne le sont jamais ;
   - ext_synced_at : date du dernier import.
   Droits inchangés (lmfc_v19.sql) : mêmes règles que tout le match.
   ============================================================ */
begin;

alter table public.matches add column if not exists heure time;
alter table public.matches add column if not exists stade text;
alter table public.matches add column if not exists ext_source text;
alter table public.matches add column if not exists ext_id text;
alter table public.matches add column if not exists ext_data jsonb;
alter table public.matches add column if not exists ext_synced_at timestamptz;

alter table public.matches drop constraint if exists matches_stade_len;
alter table public.matches add constraint matches_stade_len check (char_length(stade) <= 120);
alter table public.matches drop constraint if exists matches_ext_check;
alter table public.matches add constraint matches_ext_check check (
  (ext_source is null and ext_id is null)
  or (ext_source is not null and ext_id is not null and ext_source in ('fff') and char_length(ext_id) between 1 and 300));

-- Les ext_id vides (matchs saisis) sont distincts entre eux : seule une même rencontre importée est refusée deux fois.
create unique index if not exists matches_ext_idx on public.matches (club_id, ext_source, ext_id);

commit;
