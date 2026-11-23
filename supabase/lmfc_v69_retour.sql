/* ============================================================
   LMFC Performance — lmfc_v69_retour.sql : retour arrière de lmfc_v69.sql
   Chaque formulaire dont la version actuelle est celle posée par lmfc_v69.sql
   (douleur_zone en « multi » avec silhouette, version d'avant en « choice ») reçoit une
   version de plus avec la question d'avant. Les réponses en liste restent telles quelles.
   Remet custom_form_questionnaire() de lmfc_v62.sql et retire custom_form_body_zones().
   Rejouable et transactionnel.
   ============================================================ */
begin;

do $$
declare r record;
begin
  for r in
    select f.id form_id, v.version_no, v.titre, v.description, v.questions,
           (select q.value from jsonb_array_elements(p.questions) q where q.value->>'id' = 'douleur_zone') avant
      from public.custom_forms f
      join lateral (select fv.* from public.custom_form_versions fv where fv.form_id = f.id order by fv.version_no desc limit 1) v on true
      join public.custom_form_versions p on p.form_id = f.id and p.version_no = v.version_no - 1
     where v.created_by is null
       and exists (select 1 from jsonb_array_elements(v.questions) q
                    where q.value->>'id' = 'douleur_zone' and q.value->>'type' = 'multi' and q.value ? 'corps')
       and exists (select 1 from jsonb_array_elements(p.questions) q
                    where q.value->>'id' = 'douleur_zone' and q.value->>'type' = 'choice')
  loop
    insert into public.custom_form_versions (form_id, version_no, titre, description, questions)
    values (r.form_id, r.version_no + 1, r.titre, r.description,
            (select jsonb_agg(case when q.value->>'id' = 'douleur_zone' then r.avant else q.value end order by q.ord)
               from jsonb_array_elements(r.questions) with ordinality q(value, ord)));
  end loop;
end $$;

create or replace function public.custom_form_questionnaire(p_kind text)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_rpe jsonb;
  v_zone jsonb := jsonb_build_object('options', jsonb_build_array('Ischio-jambiers', 'Quadriceps', 'Adducteurs', 'Mollets',
    'Fessiers', 'Dos / lombaires', 'Hanche', 'Genou', 'Cheville', 'Pied', 'Épaule', 'Autre'), 'required', false);
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
      public.custom_form_q('douleur_zone', 'Si oui, quel muscle ou quelle articulation ?', 'choice', v_zone),
      public.custom_form_q('temps_post', 'Temps passé en salle de musculation après la séance (en minutes)', 'number', v_minutes))
    when 'seance_section' then jsonb_build_array(v_rpe,
      public.custom_form_q('plaisir', 'As-tu pris du plaisir ?', 'scale', v_serie),
      public.custom_form_q('vie_perso', 'Ta vie personnelle te permet-elle de bien t’entraîner ?', 'scale', v_serie),
      public.custom_form_q('douleur', 'As-tu des douleurs ou des gênes physiques particulières ? (0 = aucune)', 'scale', v_douleur),
      public.custom_form_q('douleur_zone', 'Si oui, quel muscle ou quelle articulation ?', 'choice', v_zone))
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
      public.custom_form_q('douleur_zone', 'Si oui, quel muscle ou quelle articulation ?', 'choice', v_zone))
    when 'match_section' then jsonb_build_array(v_rpe,
      public.custom_form_q('technique', 'Ma maîtrise technique', 'scale'),
      public.custom_form_q('tactique', 'Ma maîtrise tactique', 'scale'),
      public.custom_form_q('emotions', 'As-tu bien géré tes émotions ?', 'scale'),
      public.custom_form_q('plaisir', 'As-tu pris du plaisir ?', 'scale'),
      public.custom_form_q('vie_perso', 'Ta vie personnelle te permet-elle de bien performer ?', 'scale'),
      public.custom_form_q('douleur', 'As-tu des douleurs ou des gênes physiques particulières ? (0 = aucune)', 'scale', v_douleur),
      public.custom_form_q('douleur_zone', 'Si oui, quel muscle ou quelle articulation ?', 'choice', v_zone),
      public.custom_form_q('temps_post', 'Temps passé en salle de musculation après la séance (en minutes)', 'number', v_minutes))
  end;
end $$;

revoke all on function public.custom_form_questionnaire(text) from public, anon, authenticated;
drop function if exists public.custom_form_body_zones();

commit;
