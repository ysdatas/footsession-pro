/* ============================================================
   LMFC Performance — lmfc_v54.sql (n° 72) : joueurs extérieurs (mini-profils)
   À exécuter après lmfc_v53.sql. Rejouable et transactionnelle.
   Retour arrière : lmfc_v54_retour.sql (refusé tant qu'un joueur extérieur existe).

   Un joueur sans fiche au club (essai, joueur d'un autre club venu pour une
   séance ou un match) a une fiche à lui, stable : ses présences, RPE, bilans
   et feuilles de match s'y rattachent comme pour tout joueur, et le suivent
   d'une séance à l'autre.

   - players.exterieur : fiche d'un joueur extérieur ; players.origine (club ou
     équipe d'origine) et players.exterieur_infos (complément). Une fiche
     extérieure n'a ni équipe ni compte (contrainte) : elle n'entre dans aucun
     effectif, et n'est concernée que par les séances et matchs où on l'inscrit
     (attendance, match_players : player_session_ok, player_match_ok).
   - player_exterieur_create(prénom, nom, naissance, origine, infos) : la crée
     (admin, coach, analyste). Par l'API, on ne crée ni ne déclare une fiche
     extérieure autrement.
   - Droits : tout le staff du club la retrouve, quelle que soit son équipe
     (sinon on la recréerait en double) ; admin, coach et analyste la
     modifient, le préparateur la lit ; le lecteur ne la voit pas ; une
     exception nominative (Mon club → Accès) reste prioritaire.
   - Il rejoint le club : lui donner une équipe ou lier son compte (invitation
     de Mon club) en fait un joueur du club, avec tout son historique.
   - player_exterieur_attach(extérieur, fiche, appliquer) : il avait déjà une
     fiche au club → tout ce qui est rattaché à la fiche extérieure passe sur
     l'autre (toutes les tables qui pointent vers un joueur), puis la fiche
     extérieure, vide, part à la corbeille. Sans appliquer : récapitulatif,
     rien ne change. Refusé si les deux fiches ont une ligne pour la même
     séance, le même match ou le même jour (rien ne serait perdu, mais l'une
     des deux doit être retirée d'abord), ou si la fiche extérieure a des
     vidéos.
   ============================================================ */
begin;

alter table public.players add column if not exists exterieur boolean not null default false;
alter table public.players add column if not exists origine text;
alter table public.players add column if not exists exterieur_infos text;
alter table public.players drop constraint if exists players_exterieur_check;
alter table public.players add constraint players_exterieur_check check (
  (not exterieur or (team_id is null and cardinality(other_team_ids) = 0 and auth_user_id is null))
  and char_length(origine) <= 120 and char_length(exterieur_infos) <= 500);

-- La marque ne se pose que par player_exterieur_create ; une équipe ou un compte la retirent.
create or replace function public.players_exterieur_flag()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then new.exterieur := false;
    elsif new.exterieur and not old.exterieur then new.exterieur := false;
    end if;
  end if;
  if new.exterieur and (new.team_id is not null or cardinality(coalesce(new.other_team_ids, '{}')) > 0 or new.auth_user_id is not null) then
    new.exterieur := false;   -- il rejoint le club : son historique reste sur la même fiche
  end if;
  return new;
end; $$;
revoke all on function public.players_exterieur_flag() from public, anon, authenticated;
drop trigger if exists trg_players_exterieur on public.players;
create trigger trg_players_exterieur before insert or update on public.players
  for each row execute function public.players_exterieur_flag();

-- Droits sur une fiche (lmfc_v41.sql) : branche des joueurs extérieurs ajoutée après l'admin.
create or replace function public.player_level_for(p_profile uuid, p_player bigint)
returns text language sql stable security definer set search_path = public as $$
  select case
    when me.id is null or me.role = 'joueur' or pl.id is null or pl.club_id is distinct from me.club_id then 'aucun'
    when me.role = 'admin' then 'modification'
    when pl.exterieur then case
      when x.niveau is not null then x.niveau
      when me.role in ('coach', 'analyste') then 'modification'
      when me.role = 'prepa' then 'lecture'
      else 'aucun'
    end
    when me.role = 'lecteur' then case
      when x.niveau = 'aucun' then 'aucun'
      when x.niveau is not null then 'lecture'
      when pl.team_id = any(me.team_ids) or coalesce(pl.other_team_ids, '{}') && me.team_ids then 'lecture'
      when cardinality(me.team_ids) > 0 then 'aucun'
      when pl.team_id is null and cardinality(coalesce(pl.other_team_ids, '{}')) = 0
           and exists (select 1 from public.teams t where t.club_id = me.club_id) then 'aucun'
      else 'lecture'
    end
    when me.role = 'analyste' then case
      when x.niveau = 'aucun' then 'aucun'
      when x.niveau is not null then x.niveau
      when pl.team_id = any(me.team_ids) or coalesce(pl.other_team_ids, '{}') && me.team_ids then 'modification'
      else 'aucun'
    end
    when x.niveau is not null then x.niveau
    when pl.team_id = any(me.team_ids) or coalesce(pl.other_team_ids, '{}') && me.team_ids then 'modification'
    when not exists (select 1 from public.teams t where t.club_id = me.club_id) then 'modification'
    when me.lecture_club and (pl.team_id is not null or cardinality(coalesce(pl.other_team_ids, '{}')) > 0) then 'lecture'
    else 'aucun'
  end
  from (select 1) d
  left join public.profiles me on me.id = p_profile
  left join public.players pl on pl.id = p_player
  left join public.staff_player_access x on x.profile_id = p_profile and x.player_id = p_player;
$$;

create or replace function public.player_exterieur_create(p_prenom text, p_nom text, p_naissance date default null,
                                                          p_origine text default null, p_infos text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if auth.uid() is null or not public.can_edit_players() then
    raise exception 'Seuls l''administrateur, les coachs et les analystes ajoutent un joueur extérieur.' using errcode = '42501';
  end if;
  if nullif(btrim(p_nom), '') is null then raise exception 'Le nom est obligatoire.' using errcode = '22023'; end if;
  insert into public.players (club_id, nom, prenom, date_naissance, exterieur, origine, exterieur_infos)
  values (public.my_club_id(), btrim(p_nom), nullif(btrim(p_prenom), ''), p_naissance, true,
          nullif(btrim(p_origine), ''), nullif(btrim(p_infos), ''))
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.player_exterieur_create(text, text, date, text, text) from public, anon;
grant execute on function public.player_exterieur_create(text, text, date, text, text) to authenticated;

-- Toutes les tables qui pointent vers un joueur (clé étrangère d'une colonne), lues dans le catalogue :
-- une table ajoutée plus tard est prise en compte sans toucher à cette fonction.
create or replace function public.player_exterieur_attach(p_mini bigint, p_player bigint, p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m public.players%rowtype;
  p public.players%rowtype;
  r record;
  u record;
  v_n     integer;
  v_cond  text;
  v_lines jsonb := '{}';
  v_conf  jsonb := '{}';
begin
  if auth.uid() is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  select * into m from public.players where id = p_mini for update;
  select * into p from public.players where id = p_player for update;
  if m.id is null or p.id is null or m.club_id is distinct from public.my_club_id() or p.club_id <> m.club_id then
    raise exception 'Fiche introuvable.' using errcode = 'P0002';
  end if;
  if not m.exterieur then raise exception 'Seule une fiche de joueur extérieur se rattache à une autre.' using errcode = '22023'; end if;
  if p.exterieur or p.id = m.id then raise exception 'Choisissez une fiche de joueur du club.' using errcode = '22023'; end if;
  if not public.can_edit_players() or public.player_level(m.id) <> 'modification' or public.player_level(p.id) <> 'modification' then
    raise exception 'Il faut pouvoir modifier les deux fiches.' using errcode = '42501';
  end if;
  if exists (select 1 from public.player_videos where player_id = m.id) or exists (select 1 from public.sequence_codes where player_id = m.id) then
    raise exception 'Ce joueur extérieur a des vidéos : le rattachement automatique n''est pas possible.' using errcode = '22023';
  end if;

  for r in select c.conrelid rel, c.conrelid::regclass::text tbl, a.attname col, a.attnum num
             from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
            where c.contype = 'f' and c.confrelid = 'public.players'::regclass and cardinality(c.conkey) = 1 loop
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into v_n using m.id;
    continue when v_n = 0;
    v_lines := v_lines || jsonb_build_object(r.tbl, v_n);
    -- Doublon : une contrainte d'unicité qui contient le joueur, mêmes autres colonnes des deux côtés.
    for u in select array(select quote_ident(x.attname) from pg_attribute x
                           where x.attrelid = r.rel and x.attnum = any(i.indkey::int2[]) and x.attnum <> r.num) others
               from pg_index i where i.indrelid = r.rel and i.indisunique and r.num = any(i.indkey::int2[]) loop
      v_cond := coalesce((select string_agg(format('b.%s is not distinct from a.%s', o, o), ' and ') from unnest(u.others) o), 'true');
      execute format('select count(*) from %s a where a.%I = $1 and exists (select 1 from %s b where b.%I = $2 and %s)',
                     r.tbl, r.col, r.tbl, r.col, v_cond) into v_n using m.id, p.id;
      if v_n > 0 then v_conf := v_conf || jsonb_build_object(r.tbl, v_n); end if;
    end loop;
  end loop;

  if p_apply then
    if v_conf <> '{}' then
      raise exception 'Rattachement impossible : les deux fiches ont déjà une ligne pour la même séance, le même match ou le même jour (%). Retirez l''une des deux d''abord.',
        (select string_agg(k || ' : ' || (v_conf->>k), ', ' order by k) from jsonb_object_keys(v_conf) k) using errcode = '23505';
    end if;
    for r in select c.conrelid::regclass::text tbl, a.attname col
               from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
              where c.contype = 'f' and c.confrelid = 'public.players'::regclass and cardinality(c.conkey) = 1 loop
      execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p.id, m.id;
    end loop;
    delete from public.players where id = m.id;   -- vide : corbeille (trash_capture)
  end if;

  return jsonb_build_object('applique', p_apply,
    'exterieur', jsonb_build_object('id', m.id, 'nom', m.nom, 'prenom', m.prenom, 'naissance', m.date_naissance, 'origine', m.origine),
    'fiche', jsonb_build_object('id', p.id, 'nom', p.nom, 'prenom', p.prenom, 'naissance', p.date_naissance),
    'lignes', v_lines, 'doublons', v_conf);
end; $$;
revoke all on function public.player_exterieur_attach(bigint, bigint, boolean) from public, anon;
grant execute on function public.player_exterieur_attach(bigint, bigint, boolean) to authenticated;

commit;
