/* ============================================================
   LMFC Performance — lmfc_v70.sql : RPE sur deux jours, chaque équipe à part
   À exécuter après lmfc_v69.sql. Rejouable et transactionnelle.

   1) Le joueur note son effort (RPE) le jour de la séance ou du match et
      jusqu'à deux jours après, comme les questionnaires (lmfc_v64.sql) : une
      séance d'il y a deux semaines n'est plus proposée (rpe_open, seul endroit
      où ce délai est fixé ; RPE_DAYS dans rpe.js). Le staff saisit toujours à
      sa place, sans délai.

   2) Fin de la règle « un seul RPE par demi-journée » (lmfc_v61.sql) : un
      joueur qui joue dans deux équipes répond pour chacune. Une réponse ou une
      présence notée dans une équipe ne change plus rien dans l'autre : plus de
      statut « ailleurs » posé tout seul.
      - rpe_set() : le joueur note chaque séance qui le concerne ; le staff qui
        saisit ne retire plus la réponse d'une autre séance ;
      - my_rpe_sessions() : « ailleurs » reste dans la liste, toujours vide ;
      - rpe_slot_others() : ne rend plus rien (Suivi RPE : plus de case
        « ailleurs ») ;
      - la base accepte de nouveau un RPE par séance (déclencheur retiré).
      rpe_half, rpe_slot, rpe_slot_owner, rpe_session_label, rpe_att_participe
      restent en place, sans usage, pour le retour arrière.

   Témoin : rpe_regles() (API publique : 42501 si la migration est passée).
   Les réponses déjà enregistrées ne changent pas.
   Retour arrière : lmfc_v70_retour.sql (aucune réponse effacée).
   ============================================================ */
begin;

-- ------------------------------------------------------------
-- 1) Délai : du jour même à deux jours après
-- ------------------------------------------------------------
create or replace function public.rpe_open(p_date date)
returns boolean language sql stable set search_path = public as $$
  select p_date between current_date - 2 and current_date;
$$;

-- ------------------------------------------------------------
-- 2) Un RPE par séance, sans règle de demi-journée
-- ------------------------------------------------------------
drop trigger if exists trg_session_rpe_one_per_half on public.session_rpe;
drop function if exists public.session_rpe_one_per_half();

create or replace function public.rpe_set(p_session bigint, p_rpe integer, p_player bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_date date; v_club bigint; v_me bigint; v_row public.session_rpe;
begin
  if p_rpe is not null and p_rpe not between 1 and 10 then
    raise exception 'Le RPE va de 1 à 10.' using errcode = '22023';
  end if;
  select s.date_seance, s.club_id into v_date, v_club from public.sessions s where s.id = p_session;
  if v_club is null or v_club is distinct from public.my_club_id() then
    raise exception 'Séance introuvable.' using errcode = '42501';
  end if;

  if p_player is null then
    select p.id into v_me from public.players p
     where p.auth_user_id = auth.uid() and p.club_id = v_club and public.has_role('joueur') limit 1;
    if v_me is null or not public.player_session_ok(v_me, p_session) then
      raise exception 'Cette séance ne te concerne pas.' using errcode = '42501';
    end if;
    if p_rpe is null then raise exception 'Choisis une valeur de 1 à 10.' using errcode = '22023'; end if;
    if not public.rpe_open(v_date) then
      raise exception 'La saisie est fermée (jusqu’à 2 jours après la séance) : demande au staff de la faire.' using errcode = '42501';
    end if;
    if exists (select 1 from public.session_rpe r where r.session_id = p_session and r.player_id = v_me) then
      raise exception 'Ton RPE de cette séance est déjà enregistré : demande au staff pour le changer.' using errcode = '42501';
    end if;
    insert into public.session_rpe (club_id, session_id, player_id, rpe, saisi_par)
    values (v_club, p_session, v_me, p_rpe, auth.uid())
    returning * into v_row;
  else
    if not public.has_role('admin', 'coach', 'prepa', 'analyste') or public.is_lecteur()
       or public.player_level(p_player) <> 'modification' or public.session_access_level(p_session) = 'aucun'
       or not public.player_session_ok(p_player, p_session) then
      raise exception 'Correction réservée au staff qui suit ce joueur sur cette séance.' using errcode = '42501';
    end if;
    if p_rpe is null then
      delete from public.session_rpe r where r.session_id = p_session and r.player_id = p_player;
      return null;
    end if;
    insert into public.session_rpe (club_id, session_id, player_id, rpe, saisi_par, corrige_par)
    values (v_club, p_session, p_player, p_rpe, auth.uid(), auth.uid())
    on conflict (session_id, player_id) do update set rpe = excluded.rpe, corrige_par = auth.uid(), updated_at = now()
    returning * into v_row;
  end if;
  return jsonb_build_object('rpe', v_row.rpe, 'corrige', v_row.corrige_par is not null);
end; $$;

-- Même liste qu'avant (l'équipe de chaque séance) ; « ailleurs » toujours vide.
create or replace function public.my_rpe_sessions()
returns table (session_id bigint, date_seance date, heure time, titre text, rpe smallint, corrige boolean, form_titre text, form_questions jsonb,
               equipe text, ailleurs text)
language sql stable security definer set search_path = public as $$
  select s.id, s.date_seance, s.heure, s.titre, r.rpe, r.corrige_par is not null, c.titre, c.questions, t.nom, null::text
    from public.players p
    join public.sessions s on s.club_id = p.club_id and public.rpe_open(s.date_seance)
    cross join lateral public.custom_form_for('rpe_seance', s.club_id, s.team_id) c
    left join public.session_rpe r on r.session_id = s.id and r.player_id = p.id
    left join public.teams t on t.id = s.team_id
   where p.auth_user_id = auth.uid() and public.has_role('joueur') and public.player_session_ok(p.id, s.id)
   order by s.date_seance desc, s.heure desc nulls last;
$$;

-- Staff (Suivi RPE) : plus d'autre séance de la demi-journée à montrer.
create or replace function public.rpe_slot_others(p_sessions bigint[])
returns table (session_id bigint, player_id bigint, other_id bigint, other_label text, other_rpe smallint, owner_id bigint)
language sql stable security definer set search_path = public as $$
  select null::bigint, null::bigint, null::bigint, null::text, null::smallint, null::bigint where false;
$$;

-- ------------------------------------------------------------
-- 3) Les messages disent le nouveau délai
-- ------------------------------------------------------------
create or replace function public.match_rpe_set(p_match bigint, p_rpe integer, p_player bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m public.matches; v_me bigint; v_row public.match_rpe;
begin
  if p_rpe is not null and p_rpe not between 1 and 10 then
    raise exception 'Le RPE va de 1 à 10.' using errcode = '22023';
  end if;
  select * into v_m from public.matches m where m.id = p_match;
  if v_m.club_id is null or v_m.club_id is distinct from public.my_club_id() then
    raise exception 'Match introuvable.' using errcode = '42501';
  end if;

  if p_player is null then
    select p.id into v_me from public.players p
     where p.auth_user_id = auth.uid() and p.club_id = v_m.club_id and public.has_role('joueur') limit 1;
    if v_me is null or not public.player_match_rpe_ok(v_me, p_match) then
      raise exception 'Ce match ne te concerne pas : si la feuille de match est fausse, demande au staff.' using errcode = '42501';
    end if;
    if p_rpe is null then raise exception 'Choisis une valeur de 1 à 10.' using errcode = '22023'; end if;
    if not public.rpe_open(v_m.date_match) then
      raise exception 'La saisie est fermée (jusqu’à 2 jours après le match) : demande au staff de la faire.' using errcode = '42501';
    end if;
    if exists (select 1 from public.match_rpe r where r.match_id = p_match and r.player_id = v_me) then
      raise exception 'Ton RPE de ce match est déjà enregistré : demande au staff pour le changer.' using errcode = '42501';
    end if;
    insert into public.match_rpe (club_id, match_id, player_id, rpe, saisi_par)
    values (v_m.club_id, p_match, v_me, p_rpe, auth.uid())
    returning * into v_row;
  else
    if not public.has_role('admin', 'coach', 'prepa', 'analyste') or public.is_lecteur()
       or public.player_level(p_player) <> 'modification'
       or not (public.team_level(v_m.team_id) <> 'aucun' or v_m.created_by = auth.uid())   -- règles du match (lmfc_v19.sql)
       or not public.player_match_ok(p_player, p_match) then
      raise exception 'Correction réservée au staff qui suit ce joueur sur ce match.' using errcode = '42501';
    end if;
    if p_rpe is null then
      delete from public.match_rpe r where r.match_id = p_match and r.player_id = p_player;
      return null;
    end if;
    insert into public.match_rpe (club_id, match_id, player_id, rpe, saisi_par, corrige_par)
    values (v_m.club_id, p_match, p_player, p_rpe, auth.uid(), auth.uid())
    on conflict (match_id, player_id) do update set rpe = excluded.rpe, corrige_par = auth.uid(), updated_at = now()
    returning * into v_row;
  end if;
  return jsonb_build_object('rpe', v_row.rpe, 'corrige', v_row.corrige_par is not null);
end; $$;

-- Relance du staff (lmfc_v59.sql) : seul le texte du refus change ; la fonction est
-- relue telle qu'elle est en base, pour ne rien changer d'autre.
do $$
declare v_def text := pg_get_functiondef('public.rpe_remind_take(text, bigint, bigint[], boolean)'::regprocedure);
begin
  if position('jusqu’à 14 jours après' in v_def) > 0 then
    execute replace(v_def, 'jusqu’à 14 jours après', 'jusqu’à 2 jours après');
  end if;
end $$;

-- ------------------------------------------------------------
-- 4) Témoin
-- ------------------------------------------------------------
create or replace function public.rpe_regles()
returns jsonb language sql immutable set search_path = public as $$
  select '{"jours": 2, "demi_journee": false}'::jsonb;
$$;
revoke all on function public.rpe_regles() from public, anon;
grant execute on function public.rpe_regles() to authenticated;

commit;
