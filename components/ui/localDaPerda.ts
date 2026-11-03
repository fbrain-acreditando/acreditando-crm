/**
 * Story 2.66 — peças do "local de quem perdemos por Distância" usadas pelo
 * `LossReasonModal`, pelo quadro e pelo card aberto.
 *
 * Moram fora do componente de propósito: as suítes que mockam o
 * `LossReasonModal` (ex.: `test/stories/US-001-…`) não precisam conhecer estas
 * funções para o card aberto continuar renderizando.
 */

/**
 * O que vem junto do motivo. Hoje só o local de quem perdemos por Distância.
 * Opcional: os outros motivos continuam chamando `onConfirm(value)` com um
 * argumento só (contrato retrocompatível).
 */
export interface LossReasonExtras {
  lossLocation?: string;
}

/** Limite do local digitado (no modal da perda e na edição do card). */
export const LIMITE_LOCAL = 120;

/**
 * D3 — a dica do campo do local: o `ondeReside` do card, quando é texto.
 * É só placeholder, nunca é gravado.
 */
export function localSugeridoDoCard(
  deal: { customFields?: Record<string, unknown> } | null | undefined
): string | undefined {
  const valor = deal?.customFields?.ondeReside;
  return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
}
