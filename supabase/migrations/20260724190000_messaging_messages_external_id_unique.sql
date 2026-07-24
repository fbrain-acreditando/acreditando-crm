-- =============================================================================
-- Unicidade de mensagem por (conversa, id externo)
-- =============================================================================
--
-- PROBLEMA
-- Os webhooks e a importação de histórico gravam `external_id` (o id da mensagem
-- no provedor) e tratam erro de "duplicate" como "já processada, ignorar". Só que
-- `messaging_messages` **não tinha nenhuma constraint de unicidade** além da PK —
-- então esse erro nunca acontecia e a proteção era letra morta.
--
-- Consequências reais:
--   * Sincronizar o canal GPT Maker duas vezes duplicaria todo o histórico
--     (513 mensagens na primeira execução).
--   * Reentrega de webhook (o provedor repete quando não recebe 200 a tempo)
--     duplicaria a mensagem na conversa.
--
-- SOLUÇÃO
-- Índice único parcial em (conversation_id, external_id). Parcial porque mensagens
-- criadas pelo próprio CRM nascem sem `external_id` até o provedor confirmar o
-- envio — e várias delas com NULL não podem colidir entre si.
--
-- Seguro de aplicar: verificado antes que não há grupos duplicados na base.
-- Vale para TODOS os provedores (Evolution, Meta, Z-API, GPT Maker), não só o novo.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS messaging_messages_conversation_external_id_key
  ON messaging_messages (conversation_id, external_id)
  WHERE external_id IS NOT NULL;

COMMENT ON INDEX messaging_messages_conversation_external_id_key IS
  'Impede mensagem duplicada por reentrega de webhook ou reimportação de histórico. Parcial: mensagens do CRM sem external_id ficam de fora.';
