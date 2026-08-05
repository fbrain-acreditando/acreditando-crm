-- Story 2.10 — `action_taken` violava o CHECK e o log de tokens seguia vazio.
--
-- A story 2.9 (04/08) consertou o `23502` do `context_snapshot` e o insert
-- continuou não chegando ao banco: `action_taken` tem domínio fechado e os
-- rótulos de contabilidade estão todos fora dele.
--
--   ERROR: 23514: new row for relation "ai_conversation_log" violates
--          check constraint "ai_conversation_log_action_taken_check"
--
-- Auditados os 9 pontos de inserção do repo: 6 gravam rótulo fora da lista.
-- Esta migration amplia o domínio para os rótulos realmente usados, em vez de
-- forçar o código a mentir reaproveitando 'skipped' — contabilidade só existe
-- para ser lida depois, e rótulo errado a torna ilegível.
--
-- ⚠️ **Só 3 dos 6 rótulos entram aqui.** Os outros três (`generate_stage_prompts`,
-- `generate_goal`, `analyze_lead`) pertencem a pontos que **omitem
-- `conversation_id`**, que é `NOT NULL` — eles morreriam em `23502` antes de o
-- CHECK ser consultado. Autorizá-los seria descrever no schema um insert que não
-- acontece. Ficam de fora até a decisão de modelagem (ver `logAIAction` em
-- `app/api/ai/actions/route.ts`).
--
-- ⚠️ Seguro fazer DROP + ADD: a tabela tem 0 linhas (medido em 05/08). Não há
-- dado existente que possa abortar o ADD CONSTRAINT.
--
-- 🔗 Espelhado em `lib/ai/token-log.ts` → `AI_LOG_ACTIONS`. Os dois têm de andar
-- juntos: acrescentar rótulo lá sem migration aqui recria exatamente este bug.

ALTER TABLE public.ai_conversation_log
  DROP CONSTRAINT IF EXISTS ai_conversation_log_action_taken_check;

ALTER TABLE public.ai_conversation_log
  ADD CONSTRAINT ai_conversation_log_action_taken_check
  CHECK (action_taken = ANY (ARRAY[
    -- Decisões do agente de atendimento (domínio original)
    'responded'::text,
    'advanced_stage'::text,
    'handoff'::text,
    'skipped'::text,
    'stage_evaluation'::text,
    -- Contabilidade das chamadas de modelo (story 2.10).
    -- Os três pontos que mandam `conversation_id` e, portanto, gravam de fato.
    'custom_fields_extraction'::text,
    'bant_extraction'::text,
    'briefing'::text
  ]));
