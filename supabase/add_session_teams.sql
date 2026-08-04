-- ============================================================
--  FootSession Pro — Équipes de travail (chasubles)
--
--  Permet de répartir les joueurs présents en équipes nommées et
--  colorées, pour l'opposition d'une séance :
--     équipe bleue : Yanis, Noam, Adrien…
--     équipe rouge : Jordan, Émilien…
--
--  Stocké en JSON sur la séance plutôt que dans une table dédiée :
--  la composition n'a de sens que pour cette séance, on la lit et
--  on l'écrit toujours en entier, et cela évite d'ajouter une table
--  et ses politiques RLS.
--
--  Forme attendue :
--     [ { "nom": "Bleus", "couleur": "#1f6feb", "player_ids": [3, 7, 12] }, … ]
--
--  À ne pas confondre avec sessions.equipe (texte libre : « N2 »,
--  « Espoir »), qui désigne le groupe concerné par la séance.
--
--  À exécuter dans Supabase → SQL Editor. Sûr à relancer.
-- ============================================================

alter table public.sessions
  add column if not exists equipes jsonb not null default '[]'::jsonb;

-- Garde-fou : on attend un tableau, jamais un objet ni un scalaire.
alter table public.sessions
  drop constraint if exists sessions_equipes_is_array;
alter table public.sessions
  add  constraint sessions_equipes_is_array
  check (jsonb_typeof(equipes) = 'array');

-- ------------------------------------------------------------
--  Lien de partage : ajoute l'identifiant du joueur à la liste
--  des présences, sans quoi la page publique ne peut pas relier
--  les player_ids des équipes aux noms.
--  (to_jsonb(s) inclut déjà la colonne equipes automatiquement.)
-- ------------------------------------------------------------
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
        'id', pl.id, 'nom', pl.nom, 'prenom', pl.prenom, 'numero', pl.numero,
        'present', coalesce(a.present, false)))
      from public.players pl
      left join public.attendance a on a.player_id = pl.id and a.session_id = s.id
      where pl.club_id = s.club_id), '[]'::jsonb)
  )
  from public.sessions s where s.share_token = p_token limit 1;
$$;
grant execute on function public.get_shared_session(text) to anon, authenticated;
