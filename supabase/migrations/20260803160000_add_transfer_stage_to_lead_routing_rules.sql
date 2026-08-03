-- =============================================================================
-- lead_routing_rules.transfer_stage_id
--
-- Para onde o card do lead deve ir quando a IA do fornecedor TRANSFERE o
-- atendimento para humano. A regra de roteamento já respondia "onde o lead
-- nasce" (board_id + stage_id); passa a responder também "para onde ele vai
-- quando fica pronto para o vendedor".
--
-- Por que UUID e não o nome do estágio: o board "Acreditando" tem estágios com
-- ESPAÇO SOBRANDO no nome ("Em qualificação " e " Proposta enviada"). Casar por
-- nome falharia em silêncio — o webhook responderia 200, ninguém veria erro e o
-- card simplesmente nunca se moveria. O UUID é imune a espaço, acento,
-- renomeação e tradução.
--
-- NULL = não move. É o default deliberado: enquanto ninguém configurar, o
-- comportamento é exatamente o de hoje.
--
-- ON DELETE SET NULL: apagar o estágio desliga a automação em vez de derrubar a
-- regra de roteamento inteira (que é o que faz o lead entrar no board).
-- =============================================================================

ALTER TABLE public.lead_routing_rules
ADD COLUMN IF NOT EXISTS transfer_stage_id UUID REFERENCES public.board_stages(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.lead_routing_rules.transfer_stage_id IS
  'Estágio de destino quando a IA transfere o atendimento para humano. NULL = não mover.';
