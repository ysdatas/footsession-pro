/* ============================================================
   LMFC Performance — migration 32 : sauvegarde automatique.
   À exécuter APRÈS lmfc_v12.sql. Idempotent (rejouable) et
   transactionnel : en cas d'erreur, rien n'est appliqué.

   sessions.updated_at suit chaque modification de la séance. La page
   séance enregistre toute seule ; avant d'écrire, elle vérifie que
   personne n'a enregistré la séance depuis sa dernière lecture (même
   updated_at). Sinon elle s'arrête au lieu d'écraser le travail de
   l'autre, et propose de recharger.
   ============================================================ */
begin;

alter table public.sessions add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_session()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := clock_timestamp(); return new; end; $$;
drop trigger if exists trg_touch_session on public.sessions;
create trigger trg_touch_session before update on public.sessions for each row execute function public.touch_session();

commit;
