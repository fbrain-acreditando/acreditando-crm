-- Story 2.19 — correção de nome aplicada minutos depois da migração anterior.
--
-- A RPC nasceu como `get_metricas_do_atendimento` e o **executor somente-leitura**
-- (`scripts/db/sql-ro.mjs`) recusou a primeira consulta que a citava:
--
--   BLOQUEADO: verbo de escrita detectado -> "do"
--
-- A trava está CERTA — `DO` abre bloco de código no Postgres, e ela pega verbo
-- colado em `_` de propósito (lição do `cron.alter_job`, 11/08). Quem estava
-- errado era o nome: uma função impossível de consultar pelo caminho seguro
-- convida a desligar a trava, que é o oposto do que ela existe para fazer.
--
-- 📌 Restrição de nomenclatura que passa a valer neste banco: identificador em
-- português não pode conter `do`, `set`, `call`, `comment` ou `copy` entre
-- separadores. `de`, `da`, `dos` e `das` são seguros.

-- `ALTER FUNCTION` não aceita `IF EXISTS` no Postgres (erro 42601), então a
-- idempotência vem do bloco: só renomeia se a função antiga ainda existir.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_metricas_do_atendimento'
  ) then
    alter function public.get_metricas_do_atendimento(uuid, timestamptz, timestamptz)
      rename to get_metricas_de_atendimento;
  end if;
end;
$$;
