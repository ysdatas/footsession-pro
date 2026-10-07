/* ============================================================
   LMFC Performance — migration 28 : séance enrichie.
   À exécuter APRÈS lmfc_v8.sql. Idempotent (rejouable) et
   transactionnel : en cas d'erreur, rien n'est appliqué.

   - attendance.statut : présent, reprise, retard, absent, excusé,
     blessé, malade, sélection. present (lu par Bilan & Analytics)
     suit le statut : vrai pour présent, reprise, retard.
   - attendance.invite : joueur d'une autre équipe ajouté pour cette
     séance seulement (son équipe ne change pas).
   - procedures.equipes / staff / filme : chasubles, staff (nom →
     rôle) et vidéo propres à chaque procédé.
   - sessions.filmee : séance filmée ou non. sessions.notes (existant)
     devient le seul commentaire de la séance : les « commentaires de
     la cellule » (session_comments) y sont recopiés une fois, avec
     leur auteur ; la table est gardée telle quelle.
   - session_bilans : bilan individuel + / = / − et commentaire court,
     lu par le staff seulement ; suit la séance dans la corbeille.
   - Lien de partage public : ni commentaire général, ni statut
     médical, ni bilan ; seulement les joueurs de la séance.
   ============================================================ */
begin;

-- ------------------------------------------------------------
-- 1) Présences : statut et invité
-- ------------------------------------------------------------
alter table public.attendance add column if not exists statut text;
alter table public.attendance add column if not exists invite boolean not null default false;
alter table public.attendance drop constraint if exists attendance_statut_check;
alter table public.attendance add constraint attendance_statut_check check (statut is null
  or statut in ('present', 'reprise', 'retard', 'absent', 'excuse', 'blesse', 'malade', 'selection'));

create or replace function public.attendance_sync_present()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Sans statut (anciennes séances) : present reste tel qu'enregistré.
  if new.statut is not null then new.present := new.statut in ('present', 'reprise', 'retard'); end if;
  return new;
end; $$;
drop trigger if exists trg_attendance_present on public.attendance;
create trigger trg_attendance_present before insert or update on public.attendance
  for each row execute function public.attendance_sync_present();

-- Le joueur d'une présence appartient au club de la séance (un invité
-- vient d'une autre équipe, jamais d'un autre club).
drop policy if exists "attendance_write" on public.attendance;
create policy "attendance_write" on public.attendance for all
  using (public.can_edit() and exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id()))
  with check (public.can_edit()
    and exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id())
    and exists (select 1 from public.players p where p.id = player_id and p.club_id = public.my_club_id()));

-- ------------------------------------------------------------
-- 2) Procédés : équipes, staff, vidéo
-- ------------------------------------------------------------
alter table public.procedures add column if not exists equipes jsonb not null default '[]'::jsonb;
alter table public.procedures add column if not exists staff   jsonb not null default '[]'::jsonb;
alter table public.procedures add column if not exists filme   boolean;   -- vide : suit sessions.filmee
alter table public.procedures drop constraint if exists procedures_equipes_is_array;
alter table public.procedures add constraint procedures_equipes_is_array check (jsonb_typeof(equipes) = 'array');
alter table public.procedures drop constraint if exists procedures_staff_is_array;
alter table public.procedures add constraint procedures_staff_is_array check (jsonb_typeof(staff) = 'array');

-- ------------------------------------------------------------
-- 3) Séance filmée
-- ------------------------------------------------------------
alter table public.sessions add column if not exists filmee boolean not null default false;

-- Un seul commentaire de séance : ceux de la cellule rejoignent sessions.notes
-- (rejouable : un texte déjà recopié ne l'est pas deux fois).
update public.sessions s
   set notes = concat_ws(E'\n\n', nullif(btrim(s.notes), ''), x.txt)
  from (select session_id,
               string_agg(coalesce(nullif(btrim(author), '') || ' : ', '') || btrim(body), E'\n' order by created_at, id) as txt
          from public.session_comments
         where nullif(btrim(body), '') is not null
         group by session_id) x
 where x.session_id = s.id
   and position(x.txt in coalesce(s.notes, '')) = 0;

-- ------------------------------------------------------------
-- 4) Bilan individuel
-- ------------------------------------------------------------
create table if not exists public.session_bilans (
  id          bigint generated always as identity primary key,
  session_id  bigint not null references public.sessions on delete cascade,
  player_id   bigint not null references public.players on delete cascade,
  note        text check (note in ('plus', 'egal', 'moins')),
  commentaire text check (char_length(commentaire) <= 280),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  unique (session_id, player_id)
);
create index if not exists session_bilans_player_idx on public.session_bilans (player_id);

alter table public.session_bilans enable row level security;
drop policy if exists session_bilans_read  on public.session_bilans;
drop policy if exists session_bilans_write on public.session_bilans;
create policy session_bilans_read on public.session_bilans for select using (
  public.is_staff() and exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id()));
create policy session_bilans_write on public.session_bilans for all
  using (public.can_edit() and exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id()))
  with check (public.can_edit()
    and exists (select 1 from public.sessions s where s.id = session_id and s.club_id = public.my_club_id())
    and exists (select 1 from public.players p where p.id = player_id and p.club_id = public.my_club_id()));
revoke all on public.session_bilans from anon;
grant select, insert, update, delete on public.session_bilans to authenticated;

-- ------------------------------------------------------------
-- 5) Corbeille : le bilan part et revient avec sa séance (ou son
--    joueur). Toute table équipée du déclencheur trash_capture est
--    désormais restaurable : plus de liste à tenir à jour ici.
-- ------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.trash_capture()') is not null then
    drop trigger if exists trash_capture on public.session_bilans;
    create trigger trash_capture before delete on public.session_bilans
      for each row execute function public.trash_capture('child', 'sessions:session_id|players:player_id');
  end if;
end $$;

do $$
begin
  if to_regclass('public.trash') is null then return; end if;
  execute $f$
create or replace function public.trash_restore(p_ids bigint[])
returns integer language plpgsql security definer set search_path = public as $body$
declare
  r          record;
  v_club     bigint := public.my_club_id();
  v_done     integer := 0;
  v_pending  bigint[];
  v_next     bigint[];
  v_progress boolean;
begin
  if v_club is null then raise exception 'Connexion requise.'; end if;
  select coalesce(array_agg(t.id order by t.id), '{}') into v_pending
    from public.trash t
   where (t.id = any(p_ids) or t.root_id = any(p_ids))
     and t.club_id = v_club and public.trash_right(t.root_tbl);
  loop
    v_next := '{}'; v_progress := false;
    for r in select t.* from public.trash t where t.id = any(v_pending) order by t.id loop
      -- Restaurable : une table du schéma public équipée du déclencheur de corbeille.
      if not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
                       join pg_namespace n on n.oid = c.relnamespace
                      where g.tgname = 'trash_capture' and n.nspname = 'public' and c.relname = r.tbl) then
        raise exception 'Élément non restaurable (%).', r.tbl;
      end if;
      begin
        execute format('insert into public.%I overriding system value select * from jsonb_populate_record(null::public.%I, $1)',
                       r.tbl, r.tbl) using r.data;
        v_progress := true;
        if r.root_id is null then v_done := v_done + 1; end if;
        if r.tbl = 'teams' and r.extra is not null then
          update public.players  set team_id = r.row_id
           where club_id = v_club and team_id is null and id in (select (jsonb_array_elements_text(r.extra->'players'))::bigint);
          update public.sessions set team_id = r.row_id
           where club_id = v_club and team_id is null and id in (select (jsonb_array_elements_text(r.extra->'sessions'))::bigint);
        elsif r.tbl = 'player_videos' and r.extra is not null then
          update public.program_exercises set video_id = r.row_id
           where club_id = v_club and video_id is null
             and id in (select (jsonb_array_elements_text(r.extra->'program_exercises'))::bigint);
          update public.tactical_schemas set video_id = r.row_id
           where video_id is null
             and id in (select (jsonb_array_elements_text(coalesce(r.extra->'tactical_schemas', '[]')))::bigint)
             and exists (select 1 from public.procedures pr join public.sessions s on s.id = pr.session_id
                          where pr.id = tactical_schemas.procedure_id and s.club_id = v_club);
        end if;
      exception
        when unique_violation then
          if r.root_id is null then
            raise exception 'Restauration impossible : un élément identique existe déjà (même nom ?). Renommez-le, puis réessayez.';
          end if;
          v_progress := true;
        when foreign_key_violation then
          v_next := v_next || r.id;
      end;
    end loop;
    exit when cardinality(v_next) = 0 or not v_progress;
    v_pending := v_next;
  end loop;
  if exists (select 1 from public.trash t where t.id = any(v_next) and t.root_id is null) then
    raise exception 'Restauration impossible : ce qui contenait cet élément (joueur, séance, vidéo) n''existe plus. Restaurez-le d''abord.';
  end if;
  delete from public.trash t
   where (t.id = any(p_ids) or t.root_id = any(p_ids))
     and t.club_id = v_club and public.trash_right(t.root_tbl);
  return v_done;
end; $body$;
$f$;
  revoke all on function public.trash_restore(bigint[]) from public, anon;
  grant execute on function public.trash_restore(bigint[]) to authenticated;
end $$;

-- ------------------------------------------------------------
-- 6) Lien de partage public (lecture seule, sans compte)
--    Les joueurs de la séance seulement (avec leur identifiant, pour
--    relier les équipes aux noms), présent ou absent sans le motif ;
--    ni commentaire général ni bilan.
-- ------------------------------------------------------------
create or replace function public.get_shared_session(p_token text)
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'session', to_jsonb(s) - 'share_token' - 'notes' - 'created_by',
    'club', (select jsonb_build_object('nom', c.nom, 'logo_path', c.logo_path, 'color', c.color) from public.clubs c where c.id = s.club_id),
    'procedures', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object(
        'image_path', (select t.image_path from public.tactical_schemas t where t.procedure_id = p.id))
        order by p.ordre)
      from public.procedures p where p.session_id = s.id), '[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pl.id, 'nom', pl.nom, 'prenom', pl.prenom, 'numero', pl.numero,
        'present', coalesce(a.present, false), 'invite', a.invite)
        order by pl.nom, pl.prenom)
      from public.attendance a join public.players pl on pl.id = a.player_id
      where a.session_id = s.id), '[]'::jsonb)
  )
  from public.sessions s where s.share_token = p_token limit 1;
$$;
grant execute on function public.get_shared_session(text) to anon, authenticated;

commit;
