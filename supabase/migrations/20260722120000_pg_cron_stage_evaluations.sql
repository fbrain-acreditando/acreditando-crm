-- Migration: pg_cron drena a fila de avaliacoes de estagio a cada minuto.
--
-- Por que existe: o Vercel Cron (plano Hobby) so aceita agendamento diario, o que
-- fazia o card do lead avancar de estagio apenas 1x/dia. Esta migration move o
-- agendamento pra dentro do banco (pg_cron), gratuito e de minuto em minuto,
-- batendo na rota GET /api/cron/stage-evaluations com o Bearer do CRON_SECRET.
--
-- PRE-REQUISITO (uma vez, manual): o segredo 'cron_secret_stage_eval' precisa
--   existir no Vault ANTES desta migration. Rode o setup-vault-secret.sql
--   (gerado no scratchpad) no SQL Editor do Supabase. O valor tem que ser o
--   MESMO da env var CRON_SECRET na Vercel.
--
-- ROLLBACK:
--   select cron.unschedule('stage-evaluations-1min');
--   -- e, se quiser voltar ao estado anterior, readicionar o cron diario no vercel.json.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotente: remove o job antigo se ja existir, pra poder re-rodar sem duplicar.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'stage-evaluations-1min') then
    perform cron.unschedule('stage-evaluations-1min');
  end if;
end $$;

select cron.schedule(
  'stage-evaluations-1min',
  '* * * * *',
  $cron$
    select net.http_get(
      url := 'https://acreditando-crm-sandy.vercel.app/api/cron/stage-evaluations',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_stage_eval')
      )
    );
  $cron$
);
