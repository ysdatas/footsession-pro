/* ============================================================
   LMFC Performance — migration 35 : notifications sur téléphone.
   À exécuter APRÈS lmfc_v15.sql. Idempotent (rejouable) et
   transactionnel : en cas d'erreur, rien n'est appliqué.

   push_subscriptions : un appareil qui a accepté les notifications
   (adresse du service d'envoi du navigateur + clés de chiffrement).
     - chacun enregistre SON appareil par push_subscribe() (jamais
       d'écriture directe) ; un appareil passé à un autre compte change
       simplement de propriétaire ;
     - lecture et suppression : ses propres appareils, ou tous ceux du
       club pour l'administrateur (l'envoi passe par le Worker, avec
       son jeton : /api/push/send dans worker/push.js) ;
     - seuls les services d'envoi connus sont acceptés (Apple, Google,
       Mozilla, Microsoft) : le Worker n'écrit jamais ailleurs.
   ============================================================ */
begin;

create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  club_id    bigint not null references public.clubs on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  constraint push_endpoint_check check (length(endpoint) <= 1000 and endpoint ~
    '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'),
  constraint push_keys_check check (p256dh ~ '^[A-Za-z0-9_=-]{80,100}$' and auth ~ '^[A-Za-z0-9_=-]{16,32}$')
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
create index if not exists push_subscriptions_club_idx on public.push_subscriptions (club_id);
alter table public.push_subscriptions enable row level security;

drop policy if exists push_read on public.push_subscriptions;
create policy push_read on public.push_subscriptions for select
  using (user_id = auth.uid() or (club_id = public.my_club_id() and public.is_club_admin()));
drop policy if exists push_delete on public.push_subscriptions;
create policy push_delete on public.push_subscriptions for delete
  using (user_id = auth.uid() or (club_id = public.my_club_id() and public.is_club_admin()));
-- Supabase donne tous les droits aux nouvelles tables : on ne garde que lire et supprimer.
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_club bigint := public.my_club_id();
begin
  if auth.uid() is null or v_club is null then
    raise exception 'Compte rattaché à aucun club.' using errcode = '42501';
  end if;
  insert into public.push_subscriptions (user_id, club_id, endpoint, p256dh, auth)
  values (auth.uid(), v_club, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, club_id = excluded.club_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
revoke all on function public.push_subscribe(text, text, text) from public, anon;
grant execute on function public.push_subscribe(text, text, text) to authenticated;

commit;
