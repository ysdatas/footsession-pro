/* ============================================================
   LMFC Performance — lmfc_v61_retour.sql : retour arrière de lmfc_v61.sql
   rpe_set() et my_rpe_sessions() reprennent leur version d'avant
   (lmfc_v42.sql, lmfc_v47.sql) : un RPE par séance, sans règle de
   demi-journée. Aucune réponse n'est effacée. Rejouable et transactionnel.
   ============================================================ */
begin;

drop trigger if exists trg_session_rpe_one_per_half on public.session_rpe;
drop function if exists public.session_rpe_one_per_half();
drop function if exists public.rpe_slot_others(bigint[]);

-- rpe_set, telle que lmfc_v42.sql
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
      raise exception 'La saisie est fermée (jusqu’à 14 jours après la séance) : demande au staff de la faire.' using errcode = '42501';
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

-- my_rpe_sessions, telle que lmfc_v47.sql
drop function if exists public.my_rpe_sessions();
create function public.my_rpe_sessions()
returns table (session_id bigint, date_seance date, heure time, titre text, rpe smallint, corrige boolean, form_titre text, form_questions jsonb)
language sql stable security definer set search_path = public as $$
  select s.id, s.date_seance, s.heure, s.titre, r.rpe, r.corrige_par is not null, c.titre, c.questions
    from public.players p
    join public.sessions s on s.club_id = p.club_id and public.rpe_open(s.date_seance)
    cross join lateral public.custom_form_for('rpe_seance', s.club_id, s.team_id) c
    left join public.session_rpe r on r.session_id = s.id and r.player_id = p.id
   where p.auth_user_id = auth.uid() and public.has_role('joueur') and public.player_session_ok(p.id, s.id)
   order by s.date_seance desc, s.heure desc nulls last;
$$;
revoke all on function public.my_rpe_sessions() from public, anon;
grant execute on function public.my_rpe_sessions() to authenticated;

drop function if exists public.rpe_slot_owner(bigint, bigint);
drop function if exists public.rpe_session_label(bigint);
drop function if exists public.rpe_att_participe(text, boolean);
drop function if exists public.rpe_slot(bigint);
drop function if exists public.rpe_half(time);

commit;
