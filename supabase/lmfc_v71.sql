/* ============================================================
   LMFC Performance — lmfc_v71.sql : un seul RPE par demi-journée, de nouveau
   À exécuter après lmfc_v70.sql. Rejouable et transactionnelle.

   Un joueur qui joue dans deux équipes ne peut pas être à deux séances en même
   temps : dès qu'il a noté son effort (RPE) à une séance, les autres séances de
   la même demi-journée (matin : avant 13 h, après-midi ensuite ; une séance sans
   heure touche tout le jour) lui sont fermées, quelle que soit l'équipe.
   Seule une réponse donnée compte : une présence cochée dans une équipe ne
   ferme plus rien (lmfc_v61.sql le faisait, lmfc_v70.sql l'avait retiré).
     - rpe_set() : le joueur ne note qu'une séance par demi-journée ; le staff
       qui saisit à une autre séance y déplace la réponse (comme lmfc_v61.sql) ;
     - la base refuse un second RPE à la même demi-journée (déclencheur) ;
     - my_rpe_sessions() : « ailleurs » dit la séance déjà notée (rien à remplir) ;
     - rpe_slot_others() : pour le Suivi RPE, la réponse donnée à une autre
       séance de la demi-journée et son équipe (case grise « en N2 · 6 »).
   Le délai reste de deux jours (lmfc_v70.sql). Les doublons d'avant restent
   (marqués « 2× » dans le Suivi RPE, le staff efface celui en trop).

   Témoin : rpe_demi_journee() (API publique : 42501 si la migration est passée) ;
   rpe_regles() rend aussi demi_journee = true.
   Retour arrière : lmfc_v71_retour.sql (aucune réponse effacée).
   ============================================================ */
begin;

-- ------------------------------------------------------------
-- 1) La base refuse un second RPE à la même demi-journée
-- ------------------------------------------------------------
create or replace function public.session_rpe_one_per_half()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_other bigint;
begin
  select r.session_id into v_other from public.session_rpe r
   where r.player_id = new.player_id and r.session_id <> new.session_id
     and r.session_id in (select public.rpe_slot(new.session_id)) limit 1;
  if v_other is not null then
    raise exception 'Un seul RPE par demi-journée : ce joueur en a déjà un (%).', public.rpe_session_label(v_other)
      using errcode = '23505';
  end if;
  return new;
end $$;
revoke all on function public.session_rpe_one_per_half() from public, anon, authenticated;
drop trigger if exists trg_session_rpe_one_per_half on public.session_rpe;
create trigger trg_session_rpe_one_per_half before insert or update of session_id, player_id on public.session_rpe
  for each row execute function public.session_rpe_one_per_half();

-- ------------------------------------------------------------
-- 2) rpe_set : une réponse par demi-journée
-- ------------------------------------------------------------
create or replace function public.rpe_set(p_session bigint, p_rpe integer, p_player bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_date date; v_club bigint; v_me bigint; v_row public.session_rpe; v_moved text;
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
    -- Le joueur ne voit pas le nom des équipes : le message n'en parle pas.
    if exists (select 1 from public.session_rpe r where r.player_id = v_me and r.session_id <> p_session
                 and r.session_id in (select public.rpe_slot(p_session))) then
      raise exception 'Ton effort de cette demi-journée est déjà noté : une seule réponse par demi-journée. Demande au staff pour le changer.'
        using errcode = '42501';
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
    -- Le staff dit où le joueur s'est entraîné : le RPE de la demi-journée vient ici.
    select string_agg(public.rpe_session_label(r.session_id), ', ') into v_moved from public.session_rpe r
     where r.player_id = p_player and r.session_id <> p_session and r.session_id in (select public.rpe_slot(p_session));
    delete from public.session_rpe r
     where r.player_id = p_player and r.session_id <> p_session and r.session_id in (select public.rpe_slot(p_session));
    insert into public.session_rpe (club_id, session_id, player_id, rpe, saisi_par, corrige_par)
    values (v_club, p_session, p_player, p_rpe, auth.uid(), auth.uid())
    on conflict (session_id, player_id) do update set rpe = excluded.rpe, corrige_par = auth.uid(), updated_at = now()
    returning * into v_row;
  end if;
  return jsonb_build_object('rpe', v_row.rpe, 'corrige', v_row.corrige_par is not null, 'deplace', v_moved);
end; $$;

-- ------------------------------------------------------------
-- 3) Joueur : la séance déjà notée de la demi-journée
-- ------------------------------------------------------------
create or replace function public.my_rpe_sessions()
returns table (session_id bigint, date_seance date, heure time, titre text, rpe smallint, corrige boolean, form_titre text, form_questions jsonb,
               equipe text, ailleurs text)
language sql stable security definer set search_path = public as $$
  select s.id, s.date_seance, s.heure, s.titre, r.rpe, r.corrige_par is not null, c.titre, c.questions, t.nom,
         case when r.rpe is null then (
           select public.rpe_session_label(o.session_id) from public.session_rpe o
            where o.player_id = p.id and o.session_id <> s.id and o.session_id in (select public.rpe_slot(s.id))
            order by o.created_at limit 1) end
    from public.players p
    join public.sessions s on s.club_id = p.club_id and public.rpe_open(s.date_seance)
    cross join lateral public.custom_form_for('rpe_seance', s.club_id, s.team_id) c
    left join public.session_rpe r on r.session_id = s.id and r.player_id = p.id
    left join public.teams t on t.id = s.team_id
   where p.auth_user_id = auth.uid() and public.has_role('joueur') and public.player_session_ok(p.id, s.id)
   order by s.date_seance desc, s.heure desc nulls last;
$$;

-- ------------------------------------------------------------
-- 4) Staff (Suivi RPE) : réponses données à une autre séance de la demi-journée
--    Une ligne par réponse ; other_team : l'équipe de cette autre séance.
--    owner_id = other_id (colonne gardée pour le Suivi RPE d'avant).
-- ------------------------------------------------------------
drop function if exists public.rpe_slot_others(bigint[]);
create function public.rpe_slot_others(p_sessions bigint[])
returns table (session_id bigint, player_id bigint, other_id bigint, other_label text, other_rpe smallint, owner_id bigint, other_team text)
language sql stable security definer set search_path = public as $$
  select s.id, r.player_id, r.session_id, public.rpe_session_label(r.session_id), r.rpe, r.session_id, t.nom
    from public.sessions s
    join public.session_rpe r on r.session_id <> s.id and r.session_id in (select public.rpe_slot(s.id))
    join public.sessions o on o.id = r.session_id
    left join public.teams t on t.id = o.team_id
   where s.id = any(p_sessions) and cardinality(p_sessions) <= 200
     and s.club_id = public.my_club_id()
     and public.has_role('admin', 'coach', 'prepa', 'analyste') and not public.is_lecteur()
     and public.session_access_level(s.id) <> 'aucun'
     and public.player_level(r.player_id) <> 'aucun';
$$;
revoke all on function public.rpe_slot_others(bigint[]) from public, anon;
grant execute on function public.rpe_slot_others(bigint[]) to authenticated;

-- ------------------------------------------------------------
-- 5) Témoin
-- ------------------------------------------------------------
create or replace function public.rpe_regles()
returns jsonb language sql immutable set search_path = public as $$
  select '{"jours": 2, "demi_journee": true}'::jsonb;
$$;
revoke all on function public.rpe_regles() from public, anon;
grant execute on function public.rpe_regles() to authenticated;

create or replace function public.rpe_demi_journee()
returns boolean language sql immutable set search_path = public as $$ select true $$;
revoke all on function public.rpe_demi_journee() from public, anon;
grant execute on function public.rpe_demi_journee() to authenticated;

commit;
