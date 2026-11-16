/* Aperçu de lmfc_v57.sql (lecture seule, ne modifie rien) : chaque fiche joueur
   dont le prénom ou le nom changera, avant → après. À lancer dans le SQL Editor
   avant la migration. Aucune ligne : rien ne changera. */
select p.id, t.nom as equipe, p.prenom as prenom_avant, p.nom as nom_avant,
       nullif(initcap(lower(regexp_replace(btrim(coalesce(p.prenom, '')), '\s+', ' ', 'g'))), '') as prenom_apres,
       coalesce(nullif(upper(regexp_replace(btrim(coalesce(p.nom, '')), '\s+', ' ', 'g')), ''), p.nom) as nom_apres
  from public.players p left join public.teams t on t.id = p.team_id
 where p.prenom is distinct from nullif(initcap(lower(regexp_replace(btrim(coalesce(p.prenom, '')), '\s+', ' ', 'g'))), '')
    or p.nom is distinct from coalesce(nullif(upper(regexp_replace(btrim(coalesce(p.nom, '')), '\s+', ' ', 'g')), ''), p.nom)
 order by t.nom nulls last, p.nom;
