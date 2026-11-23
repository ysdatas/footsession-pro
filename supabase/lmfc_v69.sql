/* ============================================================
   LMFC Performance — lmfc_v69.sql : zone de douleur sur la silhouette
   À exécuter après lmfc_v68.sql. Rejouable et transactionnelle.

   La question « Si oui, quel muscle ou quelle articulation ? » (douleur_zone) des
   questionnaires après séance et après match (lmfc_v62.sql) passe de « choice » à
   « multi » avec la silhouette du corps (« corps », lmfc_v67.sql, form-body.js) :
   - custom_form_body_zones() : les zones de la silhouette, dans l'ordre de form-body.js
     (FB_DEFAULT) ; témoin de la migration (API publique : 42501 si passée) ;
   - chaque formulaire dont la version actuelle a douleur_zone en « choice » reçoit une
     version de plus, identique sauf cette question : type « multi », silhouette, les
     zones puis les choix ajoutés par le club (24 au plus, sinon le formulaire est laissé) ;
     seulement les questionnaires après séance ou match et les formulaires planifiés
     (jour, semaine, avant le match), pour ne pas reposer un formulaire « une fois » déjà
     rempli ;
   - custom_form_questionnaire() : les clubs créés ensuite reçoivent la même question.
   Les réponses déjà données gardent leur version et leur texte ; les nouvelles sont des
   listes (["Genou", "Cheville"]), que l'alerte douleur affiche « Genou, Cheville ».
   Retour arrière : lmfc_v69_retour.sql.
   ============================================================ */
begin;

create or replace function public.custom_form_body_zones()
returns text[] language sql immutable set search_path = public as $$
  select array['Cou', 'Épaule', 'Pectoraux', 'Abdominaux', 'Coude', 'Poignet / main', 'Psoas', 'Hanche', 'Adducteurs', 'Quadriceps', 'Genou', 'Cheville', 'Pied',
    'Dorsaux', 'Dos / lombaires', 'Fessiers', 'Ischio-jambiers', 'Mollets', 'Autre']
$$;

create or replace function public.custom_form_questionnaire(p_kind text)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_rpe jsonb;
  -- Zone de douleur : choix multiple sur la silhouette (lmfc_v69.sql, form-body.js).
  v_zone jsonb := jsonb_build_object('options', to_jsonb(public.custom_form_body_zones()), 'corps', true, 'required', false);
  v_serie jsonb := jsonb_build_object('alerte', jsonb_build_object('mode', 'serie', 'sous', 5, 'fois', 3));
  v_seuil jsonb := jsonb_build_object('alerte', jsonb_build_object('mode', 'seuil', 'max', 3));
  v_douleur jsonb := jsonb_build_object('alerte', jsonb_build_object('mode', 'douleur', 'zone', 'douleur_zone'));
  v_minutes jsonb := jsonb_build_object('required', false);
begin
  if p_kind in ('seance_n2', 'seance_section') then
    v_rpe := (public.custom_form_defaults('rpe_seance') -> 'questions' -> 0) || jsonb_build_object('label', 'Comment évalues-tu l’intensité de la session ?');
  else
    v_rpe := (public.custom_form_defaults('rpe_match') -> 'questions' -> 0) || jsonb_build_object('label', 'Comment évalues-tu l’intensité de la session ?');
  end if;
  return case p_kind
    when 'seance_n2' then jsonb_build_array(v_rpe,
      public.custom_form_q('temps_pre', 'Temps passé en salle de musculation avant la séance (en minutes)', 'number', v_minutes),
      public.custom_form_q('depense_musculaire', 'Quel a été ton niveau de dépense d’énergie musculaire ?', 'scale'),
      public.custom_form_q('cardio', 'Quel a été ton niveau de dépense d’énergie cardio-respiratoire ?', 'scale'),
      public.custom_form_q('technique', 'Ma maîtrise technique', 'scale'),
      public.custom_form_q('tactique', 'Ma maîtrise tactique', 'scale'),
      public.custom_form_q('emotions', 'As-tu bien géré tes émotions ?', 'scale'),
      public.custom_form_q('plaisir', 'As-tu pris du plaisir ?', 'scale', v_serie),
      public.custom_form_q('vie_perso', 'Ta vie personnelle te permet-elle de bien t’entraîner ?', 'scale', v_serie),
      public.custom_form_q('douleur', 'As-tu des douleurs ou des gênes physiques particulières ? (0 = aucune)', 'scale', v_douleur),
      public.custom_form_q('douleur_zone', 'Si oui, quel muscle ou quelle articulation ?', 'multi', v_zone),
      public.custom_form_q('temps_post', 'Temps passé en salle de musculation après la séance (en minutes)', 'number', v_minutes))
    when 'seance_section' then jsonb_build_array(v_rpe,
      public.custom_form_q('plaisir', 'As-tu pris du plaisir ?', 'scale', v_serie),
      public.custom_form_q('vie_perso', 'Ta vie personnelle te permet-elle de bien t’entraîner ?', 'scale', v_serie),
      public.custom_form_q('douleur', 'As-tu des douleurs ou des gênes physiques particulières ? (0 = aucune)', 'scale', v_douleur),
      public.custom_form_q('douleur_zone', 'Si oui, quel muscle ou quelle articulation ?', 'multi', v_zone))
    when 'match_espoirs' then jsonb_build_array(v_rpe,
      public.custom_form_q('fatigue', 'Fatigue générale', 'scale'),
      public.custom_form_q('jambes', 'T’es-tu senti dynamique, explosif, en jambes ?', 'scale', v_seuil),
      public.custom_form_q('technique', 'Ma maîtrise technique', 'scale'),
      public.custom_form_q('tactique', 'Ma maîtrise tactique', 'scale'),
      public.custom_form_q('comprehension_partenaires', 'As-tu bien réussi à te faire comprendre et à comprendre tes partenaires ?', 'scale'),
      public.custom_form_q('comprehension_staff', 'As-tu bien réussi à te faire comprendre et à comprendre le staff ?', 'scale'),
      public.custom_form_q('emotions', 'As-tu bien géré tes émotions ?', 'scale'),
      public.custom_form_q('plaisir', 'As-tu pris du plaisir ?', 'scale'),
      public.custom_form_q('vie_perso', 'Ta vie personnelle te permet-elle de bien performer ?', 'scale', v_seuil),
      public.custom_form_q('douleur', 'As-tu des douleurs ou des gênes physiques particulières ? (0 = aucune)', 'scale', v_douleur),
      public.custom_form_q('douleur_zone', 'Si oui, quel muscle ou quelle articulation ?', 'multi', v_zone))
    when 'match_section' then jsonb_build_array(v_rpe,
      public.custom_form_q('technique', 'Ma maîtrise technique', 'scale'),
      public.custom_form_q('tactique', 'Ma maîtrise tactique', 'scale'),
      public.custom_form_q('emotions', 'As-tu bien géré tes émotions ?', 'scale'),
      public.custom_form_q('plaisir', 'As-tu pris du plaisir ?', 'scale'),
      public.custom_form_q('vie_perso', 'Ta vie personnelle te permet-elle de bien performer ?', 'scale'),
      public.custom_form_q('douleur', 'As-tu des douleurs ou des gênes physiques particulières ? (0 = aucune)', 'scale', v_douleur),
      public.custom_form_q('douleur_zone', 'Si oui, quel muscle ou quelle articulation ?', 'multi', v_zone),
      public.custom_form_q('temps_post', 'Temps passé en salle de musculation après la séance (en minutes)', 'number', v_minutes))
  end;
end $$;

do $$
declare r record; v_q jsonb; v_extra jsonb; v_options jsonb;
begin
  for r in
    select f.id form_id, v.version_no, v.titre, v.description, v.questions
      from public.custom_forms f
      join lateral (select fv.* from public.custom_form_versions fv where fv.form_id = f.id order by fv.version_no desc limit 1) v on true
     where f.archive_le is null
       and (f.source is not null or coalesce(f.planning->>'mode', 'une_fois') <> 'une_fois')
       and exists (select 1 from jsonb_array_elements(v.questions) q
                    where q.value->>'id' = 'douleur_zone' and q.value->>'type' = 'choice')
  loop
    select q.value into v_q from jsonb_array_elements(r.questions) q where q.value->>'id' = 'douleur_zone';
    select coalesce(jsonb_agg(o.value order by o.ord), '[]'::jsonb) into v_extra
      from jsonb_array_elements_text(coalesce(v_q->'options', '[]'::jsonb)) with ordinality o(value, ord)
     where o.value <> all (public.custom_form_body_zones());
    v_options := to_jsonb(public.custom_form_body_zones()) || v_extra;
    continue when jsonb_array_length(v_options) > 24;
    insert into public.custom_form_versions (form_id, version_no, titre, description, questions)
    values (r.form_id, r.version_no + 1, r.titre, r.description,
            (select jsonb_agg(case when q.value->>'id' = 'douleur_zone'
                                   then q.value || jsonb_build_object('type', 'multi', 'corps', true, 'options', v_options)
                                   else q.value end order by q.ord)
               from jsonb_array_elements(r.questions) with ordinality q(value, ord)));
  end loop;
end $$;

revoke all on function public.custom_form_body_zones() from public, anon;
grant execute on function public.custom_form_body_zones() to authenticated;
revoke all on function public.custom_form_questionnaire(text) from public, anon, authenticated;

commit;
