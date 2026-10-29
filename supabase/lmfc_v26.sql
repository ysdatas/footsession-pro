/* ============================================================
   LMFC Performance — lmfc_v26.sql : tags des schémas enregistrés
   À exécuter APRÈS lmfc_v25.sql. Rejouable, transactionnelle.

   - Un schéma enregistré (exercise_templates, fenêtre « Schémas » de
     la séance) porte des tags : ceux de la bibliothèque vidéo
     (library_tags). Un seul vocabulaire pour le club, une seule
     gestion (renommer, fusionner, supprimer) ; jamais deux tags de
     même clé.
   - Les tags classent : ils ne changent ni le schéma ni les séances
     qui l'ont utilisé (un procédé de séance est une copie).
   - Lecture : admin, coachs, préparateurs du club. Ajout et retrait :
     admin et coachs (comme les schémas eux-mêmes). Lecteur : rien.
   - Un schéma restauré depuis la corbeille retrouve ses tags.
   ============================================================ */
begin;

create table if not exists public.exercise_template_tags (
  template_id bigint not null references public.exercise_templates on delete cascade,
  tag_id      bigint not null references public.library_tags on delete cascade,
  primary key (template_id, tag_id)
);
create index if not exists exercise_template_tags_tag_idx on public.exercise_template_tags (tag_id, template_id);

alter table public.exercise_template_tags enable row level security;
drop policy if exists exercise_template_tags_read on public.exercise_template_tags;
drop policy if exists exercise_template_tags_insert on public.exercise_template_tags;
drop policy if exists exercise_template_tags_delete on public.exercise_template_tags;
create policy exercise_template_tags_read on public.exercise_template_tags for select using (
  (select public.has_role('admin', 'coach', 'prepa'))
  and exists (select 1 from public.exercise_templates t where t.id = template_id and t.club_id = (select public.my_club_id())));
create policy exercise_template_tags_insert on public.exercise_template_tags for insert with check (
  (select public.can_edit())
  and exists (select 1 from public.exercise_templates t where t.id = template_id and t.club_id = (select public.my_club_id()))
  and exists (select 1 from public.library_tags g where g.id = tag_id and g.club_id = (select public.my_club_id())));
create policy exercise_template_tags_delete on public.exercise_template_tags for delete using (
  (select public.can_edit())
  and exists (select 1 from public.exercise_templates t where t.id = template_id and t.club_id = (select public.my_club_id())));

-- Lecteur : aucune écriture (lmfc_v22.sql).
drop policy if exists lecteur_no_insert on public.exercise_template_tags;
drop policy if exists lecteur_no_update on public.exercise_template_tags;
drop policy if exists lecteur_no_delete on public.exercise_template_tags;
create policy lecteur_no_insert on public.exercise_template_tags as restrictive for insert to authenticated
  with check (not (select public.is_lecteur()));
create policy lecteur_no_update on public.exercise_template_tags as restrictive for update to authenticated
  using (not (select public.is_lecteur())) with check (not (select public.is_lecteur()));
create policy lecteur_no_delete on public.exercise_template_tags as restrictive for delete to authenticated
  using (not (select public.is_lecteur()));

revoke all on public.exercise_template_tags from anon;
grant select, insert, delete on public.exercise_template_tags to authenticated;

-- ------------------------------------------------------------
-- Tags partagés (lmfc_v25.sql) : les schémas comptent comme les vidéos.
-- ------------------------------------------------------------
create or replace function public.library_tag_merge(p_from bigint, p_into bigint)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_from = p_into or not public.library_tag_manageable(p_from)
     or not exists (select 1 from public.library_tags where id = p_into and club_id = public.my_club_id()) then
    raise exception 'Fusion impossible.' using errcode = '42501';
  end if;
  select (select count(*) from public.library_item_tags where tag_id = p_from)
       + (select count(*) from public.exercise_template_tags where tag_id = p_from) into n;
  insert into public.library_item_tags (item_id, tag_id)
  select item_id, p_into from public.library_item_tags where tag_id = p_from on conflict do nothing;
  insert into public.exercise_template_tags (template_id, tag_id)
  select template_id, p_into from public.exercise_template_tags where tag_id = p_from on conflict do nothing;
  delete from public.library_tags where id = p_from;
  return n;
end; $$;

create or replace function public.library_tag_delete(p_tag bigint, p_expected integer default 0)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.library_tag_manageable(p_tag) then raise exception 'Vous ne pouvez pas supprimer ce tag.' using errcode = '42501'; end if;
  select (select count(*) from public.library_item_tags where tag_id = p_tag)
       + (select count(*) from public.exercise_template_tags where tag_id = p_tag) into n;
  if n > 0 and n is distinct from p_expected then
    raise exception 'Ce tag est utilisé par % procédé(s) : confirmez ce nombre pour le leur retirer.', n using errcode = 'P0001';
  end if;
  delete from public.library_tags where id = p_tag;
  return n;
end; $$;

-- Tags du club, avec le nombre de procédés (vidéos et schémas) visibles qui les portent.
create or replace function public.library_tags_list()
returns table (id bigint, label text, key text, uses integer, manageable boolean)
language sql stable security invoker set search_path = public as $$
  select t.id, t.label, t.key, (coalesce(c.n, 0) + coalesce(s.n, 0))::int, public.library_tag_manageable(t.id)
  from public.library_tags t
  left join (select it.tag_id, count(*) as n from public.library_item_tags it group by it.tag_id) c on c.tag_id = t.id
  left join (select et.tag_id, count(*) as n from public.exercise_template_tags et group by et.tag_id) s on s.tag_id = t.id
  order by coalesce(c.n, 0) + coalesce(s.n, 0) desc, t.key;
$$;

-- ------------------------------------------------------------
-- Corbeille : les tags partent et reviennent avec leur schéma.
-- Un tag retiré seul, ou supprimé, ne passe pas par la corbeille.
-- ------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.trash_capture()') is not null then
    drop trigger if exists trash_capture on public.exercise_template_tags;
    create trigger trash_capture before delete on public.exercise_template_tags
      for each row execute function public.trash_capture('child', 'exercise_templates:template_id');
  end if;
end $$;

commit;
