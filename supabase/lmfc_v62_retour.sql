/* ============================================================
   LMFC Performance — lmfc_v62_retour.sql : retour arrière de lmfc_v62.sql
   Retire les alertes de questionnaires et les quatre formulaires créés par
   lmfc_v62.sql (Après séance — N2 et Espoirs / Section, Après match —
   Espoirs et réserve / Section). Refusé si des joueurs y ont répondu : leurs
   réponses ne sont jamais effacées. Rejouable et transactionnel.
   ============================================================ */
begin;

do $$
begin
  if exists (select 1 from public.custom_form_responses r join public.custom_forms f on f.id = r.form_id
              where f.titre in ('Après séance — N2 et Espoirs', 'Après séance — Section',
                                'Après match — Espoirs et réserve', 'Après match — Section')
                and f.source in ('rpe_seance', 'rpe_match')) then
    raise exception 'Des joueurs ont répondu à ces questionnaires : retour arrière refusé, leurs réponses ne sont pas supprimées.' using errcode = '23503';
  end if;
end $$;

create temporary table v62_forms on commit drop as
  select f.id from public.custom_forms f
   where f.titre in ('Après séance — N2 et Espoirs', 'Après séance — Section',
                     'Après match — Espoirs et réserve', 'Après match — Section')
     and f.source in ('rpe_seance', 'rpe_match');
delete from public.custom_form_teams where form_id in (select id from v62_forms);
delete from public.custom_form_versions where form_id in (select id from v62_forms);
delete from public.custom_forms where id in (select id from v62_forms);

drop function if exists public.custom_forms_seed_questionnaires(bigint);
drop function if exists public.custom_form_questionnaire(text);
drop function if exists public.custom_form_q(text, text, text, jsonb);
drop function if exists public.form_alert_seen(bigint, bigint, text, date);
drop function if exists public.form_alerts_open();
drop function if exists public.form_alert_num(jsonb, text, numeric);
drop function if exists public.form_alert_jour(text, timestamptz);
drop table if exists public.form_alert_seen;

commit;
