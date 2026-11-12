/* Retour arrière de lmfc_v50.sql (relances RPE). Rejouable.
   Efface le journal des relances : rien d'autre n'en dépend. */
begin;
drop function if exists public.rpe_remind_take(text, bigint, bigint[]);
drop function if exists public.rpe_remind_done(jsonb);
drop table if exists public.rpe_reminders;
commit;
