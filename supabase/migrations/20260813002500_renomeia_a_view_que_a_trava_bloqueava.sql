-- Story 2.18b — correção de nome, PELA SEGUNDA VEZ NO MESMO DIA.
--
-- A view nasceu como `v_criterios_do_deal` e o executor somente-leitura recusou
-- a primeira consulta de read-back:
--
--   BLOQUEADO: verbo de escrita detectado -> "do"
--
-- 📌 O mesmo erro da RPC `get_metricas_do_atendimento`, horas antes — e eu havia
-- escrito a regra ("identificador em português não pode conter `do`, `set`,
-- `call`, `comment`, `copy`") no contexto do repo e na story ANTES de cometê-lo
-- de novo.
--
-- 🔑 A lição não é sobre o nome: **registrar a regra não é aplicá-la**. É a
-- terceira ocorrência desta família no repo em dois dias (a 1ª foi consertar a
-- instância e não varrer a classe, na story 2.32). O que faltou aqui foi um gate
-- automático — nenhum lint do repo confere nome de objeto de banco.
--
-- Renomeada para `v_criterios_por_deal`.

do $$
begin
  if exists (
    select 1 from pg_views
    where schemaname = 'public' and viewname = 'v_criterios_do_deal'
  ) then
    alter view public.v_criterios_do_deal rename to v_criterios_por_deal;
  end if;
end;
$$;
