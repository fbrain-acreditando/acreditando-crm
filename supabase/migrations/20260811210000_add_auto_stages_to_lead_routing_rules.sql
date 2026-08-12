-- =============================================================================
-- lead_routing_rules.replied_stage_id  +  qualified_stage_id
--
-- Story 2.17 — as movimentações automáticas T2 e T3.
--
--   T2 (replied_stage_id)   : o lead RESPONDEU mas ainda não está qualificado
--   T3 (qualified_stage_id) : o lead FICOU QUALIFICADO (onde mora + tipo de lesão)
--
-- A regra de roteamento já respondia "onde o lead nasce" (board_id + stage_id) e
-- "para onde vai quando a IA transfere" (transfer_stage_id). Passa a responder
-- também "para onde ele anda sozinho conforme a conversa avança".
--
-- POR QUE ISTO EXISTE, medido na produção em 2026-08-11 (AC0 da story):
--   `Lead novo` tinha 141 cards — e 124 deles JÁ HAVIAM RESPONDIDO.
--   A coluna de entrada estava 88% mentindo, porque a única movimentação
--   automática que existia (transfer_stage_id) só dispara quando a IA transfere
--   para humano, e a maioria dos leads responde SEM nunca ser transferida.
--
-- POR QUE UUID E NÃO NOME: o board "Acreditando" tem DOIS estágios com espaço
-- sobrando, em pontas opostas — "Em qualificação " (fim) e " Proposta enviada"
-- (início). Casar por texto falha em silêncio: 200 no webhook, nenhum erro no
-- log, card parado para sempre.
--
-- NULL = NÃO MOVE, e este default é o AC10 da story, não uma conveniência:
-- na medição de 11/08, 185 dos 242 cards dos estágios de entrada (77%) eram
-- elegíveis. Subir com destino preenchido reorganizaria o board inteiro da
-- Fernanda num único deploy, na semana em que ela apresenta o CRM à diretoria.
-- Ligar a automação é ato explícito de quem opera.
--
-- ON DELETE SET NULL: apagar o estágio DESLIGA a automação, em vez de derrubar
-- a regra de roteamento inteira — que é o que faz o lead entrar no board.
-- =============================================================================

ALTER TABLE public.lead_routing_rules
ADD COLUMN IF NOT EXISTS replied_stage_id UUID REFERENCES public.board_stages(id) ON DELETE SET NULL;

ALTER TABLE public.lead_routing_rules
ADD COLUMN IF NOT EXISTS qualified_stage_id UUID REFERENCES public.board_stages(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.lead_routing_rules.replied_stage_id IS
  'T2 — estágio de destino quando o lead responde mas ainda não está qualificado. NULL = não mover.';

COMMENT ON COLUMN public.lead_routing_rules.qualified_stage_id IS
  'T3 — estágio de destino quando o lead fica qualificado (onde mora + tipo de lesão). NULL = não mover.';
