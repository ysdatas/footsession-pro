/* ============================================================
   LMFC Performance — lmfc_v72.sql : tous les moments pour tous les formulaires
   À exécuter après lmfc_v71.sql. Rejouable et transactionnelle.

   Un formulaire créé dans Formulaires peut être posé à n'importe quel moment,
   autant de formulaires que voulu par équipe (plus besoin d'un formulaire
   d'origine) : en plus de « une fois », « chaque jour », « certains jours » et
   « avant chaque match » (lmfc_v65.sql), custom_forms.planning accepte :
     - { "mode": "seance" } : les jours où le joueur a une séance de l'équipe,
       avant la séance (au réveil), comme les courbatures ; occurrence « j<date> » ;
     - { "mode": "apres_seance" } : après chaque séance de l'équipe qui le
       concerne, dès son heure de début ; occurrence « s<séance> », comme le RPE ;
     - { "mode": "apres_match" } : après chaque match de l'équipe qu'il a joué
       (feuille de match, sinon tout le groupe), dès son heure ; « m<match> ».
   Toujours du jour même à deux jours après, jamais avant la création du formulaire,
   dans sa période (du / au). Ses réponses se lisent dans Suivi RPE (Réponses pour
   une séance ou un match, Historique pour tout).
   custom_form_planning_ok() accepte les nouveaux modes ; custom_forms_my_pending()
   les propose ; custom_form_submit() et custom_form_plan() n'ont pas à changer.

   Témoin : custom_form_moments() (API publique : 42501 si la migration est passée).
   Retour arrière : lmfc_v72_retour.sql (refusé tant qu'un formulaire utilise un
   nouveau moment).
   ============================================================ */
begin;

-- Réglage valide : les modes de lmfc_v65.sql et les trois nouveaux.
create or replace function public.custom_form_planning_ok(p jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare k text;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) <> 'object' then return false; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('mode', 'jours', 'quand', 'du', 'au') then return false; end if;
  end loop;
  if coalesce(p->>'mode', 'une_fois') not in ('une_fois', 'jour', 'semaine', 'seance', 'avant_match', 'apres_seance', 'apres_match') then return false; end if;
  if p->>'mode' = 'semaine' and (jsonb_typeof(p->'jours') is distinct from 'array' or jsonb_array_length(p->'jours') not between 1 and 7
     or exists (select 1 from jsonb_array_elements(p->'jours') j where jsonb_typeof(j) <> 'number' or j::text not in ('1','2','3','4','5','6','7'))
     or (select count(distinct j::text) from jsonb_array_elements(p->'jours') j) <> jsonb_array_length(p->'jours')) then return false; end if;
  if p->>'mode' is distinct from 'semaine' and p ? 'jours' then return false; end if;
  if (p->>'mode' = 'avant_match') <> coalesce(p->>'quand' in ('veille', 'jour'), false) then return false; end if;
  if p->>'mode' is distinct from 'avant_match' and p ? 'quand' then return false; end if;
  if coalesce(p->>'du', '2000-01-01') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p->>'au', '2000-01-01') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  if (p->>'du')::date > (p->>'au')::date then return false; end if;
  return true;
exception when others then return false;   -- date impossible (31/02…)
end $$;

-- Comme lmfc_v65.sql, avec les jours de séance, après séance et après match.
create or replace function public.custom_forms_my_pending()
returns table (
  form_id bigint, version_id bigint, version_no integer, titre text,
  description text, questions jsonb, team_id bigint, team_nom text, occurrence text, jour date
)
language sql stable security definer set search_path = public as $$
  with moi as (
    select p.id, p.club_id, p.team_id, coalesce(p.other_team_ids, '{}') other_team_ids
      from public.players p
     where p.auth_user_id = auth.uid() and p.club_id = public.my_club_id()
       and public.has_role('joueur')
     order by p.id limit 1
  ),
  reponses as (
    select 'rpe_seance' source, 's' || s.id occurrence, s.team_id,
           concat_ws(' · ', s.titre, to_char(s.date_seance, 'DD/MM/YYYY')) contexte, s.date_seance jour
      from moi join public.session_rpe r on r.player_id = moi.id
      join public.sessions s on s.id = r.session_id and public.rpe_open(s.date_seance) and s.date_seance >= current_date - 2
    union all
    select 'rpe_match', 'm' || m.id, m.team_id,
           concat_ws(' · ', 'Match contre ' || m.adversaire, to_char(m.date_match, 'DD/MM/YYYY')), m.date_match
      from moi join public.match_rpe r on r.player_id = moi.id
      join public.matches m on m.id = r.match_id and public.rpe_open(m.date_match) and m.date_match >= current_date - 2
    union all
    select 'courbatures', 'j' || ps.jour, s.team_id, to_char(ps.jour, 'DD/MM/YYYY'), ps.jour
      from moi join public.player_soreness ps on ps.player_id = moi.id and ps.jour = current_date
      left join public.sessions s on s.id = ps.session_id
    union all
    select 'avis_match', 'm' || m.id, m.team_id,
           concat_ws(' · ', 'Match contre ' || m.adversaire, to_char(m.date_match, 'DD/MM/YYYY')), m.date_match
      from moi join public.match_feedback fb on fb.player_id = moi.id
      join public.matches m on m.id = fb.match_id and public.rpe_open(m.date_match) and m.date_match >= current_date - 2
  )
  select x.form_id, x.version_id, x.version_no, x.titre, x.description, x.questions, x.team_id, x.team_nom, x.occurrence, x.jour
    from (
      select f.id form_id, v.id version_id, v.version_no, v.titre, v.description, v.questions,
             affectation.team_id, t.nom team_nom, ''::text occurrence, null::date jour, f.updated_at tri
        from moi
        join public.custom_forms f on f.club_id = moi.club_id and f.actif and f.source is null
             and coalesce(f.planning->>'mode', 'une_fois') = 'une_fois' and public.custom_form_in_period(f.planning, current_date)
        join lateral (
          select ft.team_id from public.custom_form_teams ft
           where ft.form_id = f.id and ft.club_id = moi.club_id
             and (ft.team_id = moi.team_id or ft.team_id = any(moi.other_team_ids))
           order by case when ft.team_id = moi.team_id then 0 else 1 end, ft.team_id
           limit 1
        ) affectation on true
        join public.teams t on t.id = affectation.team_id
        join lateral (
          select fv.id, fv.version_no, fv.titre, fv.description, fv.questions
            from public.custom_form_versions fv where fv.form_id = f.id
           order by fv.version_no desc limit 1
        ) v on true
       where not exists (select 1 from public.custom_form_responses r
                         where r.form_id = f.id and r.player_id = moi.id and r.questions_snapshot = v.questions)
      union all
      select c.form_id, c.version_id, c.version_no, concat_ws(' · ', c.titre, e.contexte), c.description, ajout.questions,
             coalesce(e.team_id, moi.team_id), coalesce(t.nom, 'Sans équipe'), e.occurrence, e.jour, null
        from moi
        cross join reponses e
        cross join lateral public.custom_form_for(e.source, moi.club_id, e.team_id) c
        cross join lateral (select jsonb_agg(q.value order by q.ordinality) questions
                              from jsonb_array_elements(c.questions) with ordinality q
                             where not coalesce((q.value->>'fixe')::boolean, false)) ajout
        left join public.teams t on t.id = coalesce(e.team_id, moi.team_id)
       where ajout.questions is not null
         and public.custom_form_in_period((select f2.planning from public.custom_forms f2 where f2.id = c.form_id), e.jour)
         and not exists (select 1 from public.custom_form_responses r
                         where r.form_id = c.form_id and r.player_id = moi.id and r.occurrence = e.occurrence)
      union all
      -- Formulaires planifiés (lmfc_v65.sql) : chaque jour, certains jours de la semaine, avant le match ;
      -- comme le reste, du jour même à deux jours après (lmfc_v64.sql), jamais avant leur création.
      select f.id, v.id, v.version_no, concat_ws(' · ', v.titre, d.contexte), v.description, v.questions,
             affectation.team_id, t.nom, d.occurrence, d.jour, null
        from moi
        join public.custom_forms f on f.club_id = moi.club_id and f.actif and f.source is null
             and f.planning->>'mode' in ('jour', 'semaine', 'seance', 'avant_match', 'apres_seance', 'apres_match')
        join lateral (
          select ft.team_id from public.custom_form_teams ft
           where ft.form_id = f.id and ft.club_id = moi.club_id
             and (ft.team_id = moi.team_id or ft.team_id = any(moi.other_team_ids))
           order by case when ft.team_id = moi.team_id then 0 else 1 end, ft.team_id
           limit 1
        ) affectation on true
        join public.teams t on t.id = affectation.team_id
        join lateral (
          select fv.id, fv.version_no, fv.titre, fv.description, fv.questions
            from public.custom_form_versions fv where fv.form_id = f.id
           order by fv.version_no desc limit 1
        ) v on true
        join lateral (
          select 'j' || g.d::date occurrence, g.d::date jour, to_char(g.d, 'DD/MM/YYYY') contexte
            from generate_series(greatest(current_date - 2, f.created_at::date), current_date::timestamp, interval '1 day') g(d)
           where f.planning->>'mode' = 'jour'
              or (f.planning->>'mode' = 'semaine' and extract(isodow from g.d)::int in
                    (select x::int from jsonb_array_elements_text(f.planning->'jours') x))
          union all
          select 'm' || m.id, m.date_match - case when f.planning->>'quand' = 'veille' then 1 else 0 end,
                 concat_ws(' · ', 'Avant le match contre ' || m.adversaire, to_char(m.date_match, 'DD/MM/YYYY'))
            from public.matches m
           where f.planning->>'mode' = 'avant_match' and m.club_id = moi.club_id and m.team_id = affectation.team_id
             and m.date_match - case when f.planning->>'quand' = 'veille' then 1 else 0 end
                 between greatest(current_date - 2, f.created_at::date) and current_date
          union all
          -- lmfc_v72.sql : les jours où il a une séance de l'équipe (avant la séance, au réveil)
          select 'j' || s.date_seance, s.date_seance, to_char(s.date_seance, 'DD/MM/YYYY')
            from public.sessions s
           where f.planning->>'mode' = 'seance' and s.club_id = moi.club_id and s.fusionnee_dans is null
             and (s.team_id = affectation.team_id or affectation.team_id = any(coalesce(s.other_team_ids, '{}')))
             and s.date_seance between greatest(current_date - 2, f.created_at::date) and current_date
             and public.player_session_ok(moi.id, s.id)
           group by s.date_seance
          union all
          -- après chaque séance de l'équipe, une fois commencée
          select 's' || s.id, s.date_seance, concat_ws(' · ', s.titre, to_char(s.date_seance, 'DD/MM/YYYY'))
            from public.sessions s
           where f.planning->>'mode' = 'apres_seance' and s.club_id = moi.club_id and s.fusionnee_dans is null
             and (s.team_id = affectation.team_id or affectation.team_id = any(coalesce(s.other_team_ids, '{}')))
             and s.date_seance between greatest(current_date - 2, f.created_at::date) and current_date
             and (s.date_seance < current_date or s.heure is null or s.heure <= (now() at time zone 'Europe/Paris')::time)
             and public.player_session_ok(moi.id, s.id)
          union all
          -- après chaque match de l'équipe qu'il a joué (feuille de match), une fois commencé
          select 'm' || m.id, m.date_match, concat_ws(' · ', 'Match contre ' || m.adversaire, to_char(m.date_match, 'DD/MM/YYYY'))
            from public.matches m
           where f.planning->>'mode' = 'apres_match' and m.club_id = moi.club_id and m.team_id = affectation.team_id
             and m.date_match between greatest(current_date - 2, f.created_at::date) and current_date
             and (m.date_match < current_date or m.heure is null or m.heure <= (now() at time zone 'Europe/Paris')::time)
             and public.player_match_rpe_ok(moi.id, m.id)
        ) d on true
       where public.custom_form_in_period(f.planning, d.jour)
         and not exists (select 1 from public.custom_form_responses r
                         where r.form_id = f.id and r.player_id = moi.id and r.occurrence = d.occurrence)
    ) x
   order by x.jour desc nulls first, x.tri desc nulls last, x.titre;
$$;

do $$
begin
  revoke all on function public.custom_forms_my_pending() from public, anon;
  grant execute on function public.custom_forms_my_pending() to authenticated;
  revoke all on function public.custom_form_planning_ok(jsonb) from public, anon;
  grant execute on function public.custom_form_planning_ok(jsonb) to authenticated;
end $$;

create or replace function public.custom_form_moments()
returns text[] language sql immutable set search_path = public as $$
  select array['une_fois', 'jour', 'semaine', 'seance', 'avant_match', 'apres_seance', 'apres_match']
$$;
revoke all on function public.custom_form_moments() from public, anon;
grant execute on function public.custom_form_moments() to authenticated;

commit;
