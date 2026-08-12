-- Story 2.35 — o cron que drena a fila de pontuação.
--
-- Reusa o segredo `cron_secret_stage_eval` que já existe no vault, igual ao job
-- `stage-evaluations-1min`. Nenhum segredo novo precisou ser criado — e nenhum
-- passou pelo chat.
--
-- ⏱️ 5 minutos, no minuto :02 e múltiplos: a convenção da casa é evitar :00 e
-- :30, e o job de stage-evaluations já ocupa os múltiplos de 5 "redondos".
--
-- ⚠️ O nome diz a cadência de propósito ERRADO em nenhum lugar — a pendência
-- nº41 do CRM é justamente um job chamado `stage-evaluations-1min` que roda de 5
-- em 5. Aqui o nome não promete cadência nenhuma.

select cron.schedule(
  'pontuar-leads-qualificados',
  '2,7,12,17,22,27,32,37,42,47,52,57 * * * *',
  $cron$
    select net.http_get(
      url := 'https://acreditando-crm-sandy.vercel.app/api/cron/pontuar-leads',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_stage_eval')
      )
    );
  $cron$
);
