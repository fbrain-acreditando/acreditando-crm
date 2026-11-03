-- =============================================================================
-- Story 2.66 — O local de quem perdemos por distância (AC1)
-- =============================================================================
--
-- Pedido da Fernanda (áudio de 29/10): ao marcar um lead como perdido por
-- "Distância", escrever onde a pessoa mora — para depois separar quem é do
-- extremo da Zona Leste de quem mora no Amazonas e fazer um trabalho
-- direcionado para quem não mora em São Paulo.
--
-- Decisão do Filipe (03/11, D2): coluna NOVA e dedicada. NÃO é o `ondeReside`
-- (campo personalizado que a IA do WhatsApp e o formulário preenchem). Este é
-- o texto que a pessoa do atendimento digita no fechamento do card — mora ao
-- lado de `loss_reason` e `closed_at`.
--
-- Por que coluna e não campo personalizado:
--   • a IA de extração lê TODAS as definições de `custom_field_definitions`
--     e tentaria preencher "local da perda" a partir da conversa;
--   • `custom_fields` é regravado inteiro ao salvar — risco de apagar outro campo.
--
-- 🔁 Idempotente e aditiva: `ADD COLUMN IF NOT EXISTS`, sem NOT NULL, sem
--    default, sem tocar em linha existente. Rodar duas vezes não muda nada.
--    Nenhuma política de RLS nova: a coluna segue as políticas de `deals`.
--
-- ⚠️ Ordem do deploy (AC10): aplicar e reler ESTA migration ANTES do merge do
--    PR na `main` (o merge publica o front na Vercel). Ao contrário, toda perda
--    com local falharia inteira (o PostgREST recusa coluna desconhecida).
-- =============================================================================

ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS loss_location text;

COMMENT ON COLUMN public.deals.loss_location IS
  'Story 2.66 — local onde a pessoa mora, digitado pela pessoa do atendimento ao perder o card por Distância (texto livre: bairro, cidade ou estado). NÃO é o custom_fields.ondeReside preenchido pela IA/formulário. NULL = não informado.';
