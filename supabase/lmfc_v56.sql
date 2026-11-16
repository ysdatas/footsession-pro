/* ============================================================
   LMFC Performance — lmfc_v56.sql (n° 74) : dernière connexion des membres
   À exécuter après lmfc_v55.sql. Rejouable et transactionnelle.
   Retour arrière : lmfc_v56_retour.sql (retire la fonction ; aucune donnée).

   club_member_logins(jours) : pour l'administrateur du club seulement, chaque
   membre avec :
     - last_sign_in_at : la dernière vraie connexion, tenue par Supabase Auth
       (auth.users). Une page ouverte, un jeton renouvelé en arrière-plan ne la
       changent pas : c'est une connexion, pas une activité ;
     - logins : le nombre de connexions sur la période (30 jours par défaut,
       365 au plus), lu dans le journal d'Auth (auth.audit_log_entries, action
       « login »). null quand ce nombre n'est pas fiable : journal absent, non
       lisible, ou connexion connue qui n'y figure pas (journal désactivé).
   Rien n'est écrit : aucune table, aucun suivi de navigation ; l'adresse IP du
   journal n'est jamais lue.
   ============================================================ */
begin;

create or replace function public.club_member_logins(p_days integer default 30)
returns table (profile_id uuid, last_sign_in_at timestamptz, logins integer)
language plpgsql stable security definer set search_path = public as $$
declare
  v_since  timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
  v_counts jsonb;
begin
  if auth.uid() is null or not public.is_club_admin() then
    raise exception 'Réservé à l''administrateur du club.' using errcode = '42501';
  end if;
  -- Requête dynamique : le journal peut manquer (base de test) ou être fermé à ce rôle.
  begin
    execute 'select coalesce(jsonb_object_agg(x.actor, x.n), ''{}'') from (
               select a.payload->>''actor_id'' actor, count(*) n from auth.audit_log_entries a
                where a.created_at >= $1 and a.payload->>''action'' = ''login'' group by 1) x'
      into v_counts using v_since;
  exception when undefined_table or insufficient_privilege then
    v_counts := null;
  end;
  return query
    select p.id, u.last_sign_in_at,
           case when v_counts is null then null
                when v_counts ? p.id::text then (v_counts->>p.id::text)::integer
                when u.last_sign_in_at >= v_since then null   -- connecté dans la période, absent du journal : nombre inconnu
                else 0 end
      from public.profiles p join auth.users u on u.id = p.id
     where p.club_id = public.my_club_id();
end; $$;
revoke all on function public.club_member_logins(integer) from public, anon;
grant execute on function public.club_member_logins(integer) to authenticated;

commit;
