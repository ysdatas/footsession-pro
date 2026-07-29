-- ============================================================
--  FootSession Pro — Mise à jour de get_shared_session()
--  Ajoute club_id/club_color et la liste des présences à la
--  réponse du lien de partage public (lecture seule, sans compte).
--  Remplace la fonction existante (sûr à relancer).
--
--  Rend aussi le bucket "schemas" PUBLIC en lecture : la page de
--  partage n'a pas de session connectée, donc les images des
--  schémas doivent être accessibles sans authentification pour
--  s'afficher sur ce lien. (Les chemins ne sont pas listables
--  publiquement, seule la génération d'URL directe fonctionne ;
--  ce n'est pas une donnée sensible en soi.)
-- ============================================================
update storage.buckets set public = true where id = 'schemas';

create or replace function public.get_shared_session(p_token text)
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'session', to_jsonb(s) - 'share_token',
    'club', (select jsonb_build_object('nom', c.nom, 'logo_path', c.logo_path, 'color', c.color) from public.clubs c where c.id = s.club_id),
    'procedures', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object(
        'image_path', (select t.image_path from public.tactical_schemas t where t.procedure_id = p.id))
        order by p.ordre)
      from public.procedures p where p.session_id = s.id), '[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(jsonb_build_object(
        'nom', pl.nom, 'prenom', pl.prenom, 'numero', pl.numero,
        'present', coalesce(a.present, false)))
      from public.players pl
      left join public.attendance a on a.player_id = pl.id and a.session_id = s.id
      where pl.club_id = s.club_id), '[]'::jsonb)
  )
  from public.sessions s where s.share_token = p_token limit 1;
$$;
grant execute on function public.get_shared_session(text) to anon, authenticated;
