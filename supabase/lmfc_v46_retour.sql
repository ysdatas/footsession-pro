/* ============================================================
   LMFC Performance — lmfc_v46_retour.sql : retour arrière de lmfc_v46.sql
   Rend calendar_summary_update telle que lmfc_v43.sql l'a écrite. Rejouable.
   Attention : la suppression par omission des lignes de feuille de match
   revient avec elle.
   ============================================================ */
begin;

create or replace function public.calendar_summary_update(
  p_kind text, p_event bigint, p_fields jsonb, p_players jsonb
)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_count integer := 0;
  v_row record;
begin
  if p_kind is null or p_kind not in ('seance', 'match') then
    raise exception 'Type d’événement inconnu.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_fields) is distinct from 'object' then
    raise exception 'Informations d’événement invalides.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_players) is distinct from 'array' or jsonb_array_length(p_players) > 500 then
    raise exception 'Liste de participants invalide.' using errcode = '22023';
  end if;

  if p_kind = 'seance' then
    update public.sessions set
      titre = p_fields->>'titre',
      date_seance = (p_fields->>'date')::date,
      heure = nullif(p_fields->>'heure', '')::time,
      lieu = nullif(p_fields->>'lieu', ''),
      duree_min = coalesce(nullif(p_fields->>'duree_min', '')::numeric, 90)
    where id = p_event and club_id = public.my_club_id();
    if not found then raise exception 'Séance introuvable ou non modifiable.' using errcode = '42501'; end if;

    for v_row in
      select * from jsonb_to_recordset(p_players) as x(
        player_id bigint, inclus boolean, statut text, statut_libre text,
        invite boolean, present boolean
      )
    loop
      if v_row.player_id is null or v_row.inclus is null then
        raise exception 'Participant invalide.' using errcode = '22023';
      end if;
      if v_row.inclus then
        insert into public.attendance (session_id, player_id, statut, statut_libre, invite, present)
        values (p_event, v_row.player_id, v_row.statut, nullif(v_row.statut_libre, ''), coalesce(v_row.invite, false), coalesce(v_row.present, false))
        on conflict (player_id, session_id) do update set
          statut = excluded.statut,
          statut_libre = excluded.statut_libre,
          invite = excluded.invite,
          present = excluded.present;
      else
        update public.attendance set statut = 'non_concerne', statut_libre = null, invite = false, present = false
        where session_id = p_event and player_id = v_row.player_id;
      end if;
      v_count := v_count + 1;
    end loop;
  else
    update public.matches set
      adversaire = p_fields->>'adversaire',
      date_match = (p_fields->>'date')::date,
      heure = nullif(p_fields->>'heure', '')::time,
      lieu = nullif(p_fields->>'lieu', ''),
      stade = nullif(p_fields->>'stade', ''),
      competition = nullif(p_fields->>'competition', ''),
      score_pour = nullif(p_fields->>'score_pour', '')::integer,
      score_contre = nullif(p_fields->>'score_contre', '')::integer
    where id = p_event and club_id = public.my_club_id();
    if not found then raise exception 'Match introuvable ou non modifiable.' using errcode = '42501'; end if;

    delete from public.match_players mp
    where mp.match_id = p_event and not exists (
      select 1 from jsonb_to_recordset(p_players) as x(player_id bigint, inclus boolean)
      where x.player_id = mp.player_id and x.inclus
    );

    for v_row in
      select * from jsonb_to_recordset(p_players) as x(player_id bigint, inclus boolean, statut text)
    loop
      if v_row.player_id is null or v_row.inclus is null then
        raise exception 'Participant invalide.' using errcode = '22023';
      end if;
      if v_row.inclus then
        insert into public.match_players (club_id, match_id, player_id, statut)
        values (public.my_club_id(), p_event, v_row.player_id, v_row.statut)
        on conflict (match_id, player_id) do update set statut = excluded.statut;
        v_count := v_count + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('updated', true, 'participants', v_count);
end; $$;

revoke all on function public.calendar_summary_update(text, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.calendar_summary_update(text, bigint, jsonb, jsonb) to authenticated;

commit;
