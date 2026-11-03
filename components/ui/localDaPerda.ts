/**
 * Stories 2.66/2.67 — peças do "Onde mora" e da observação da perda, usadas
 * pelo `LossReasonModal`, pelo quadro e pelo card aberto.
 *
 * Moram fora do componente de propósito: as suítes que mockam o
 * `LossReasonModal` (ex.: `test/stories/US-001-…`) não precisam conhecer estas
 * funções para o card aberto continuar renderizando.
 */

/**
 * O que vem junto do motivo (story 2.67).
 * - `leadLocation`: onde a pessoa mora. Só vem quando ela MUDOU o texto em
 *   relação ao que o card já tinha e não está vazio (apagar é só pelo card).
 * - `lossNote`: observação da perda. Sempre vem do modal: o texto, ou `''`
 *   quando vazio (o hook grava `null`, S9).
 */
export interface LossReasonExtras {
  leadLocation?: string;
  lossNote?: string;
}

/** Limite do "Onde mora" (no modal da perda e no card). Igual ao `CHECK` do banco. */
export const LIMITE_LOCAL = 200;

/** Limite da observação da perda (no modal e no card). Igual ao `CHECK` do banco. */
export const LIMITE_OBSERVACAO = 500;

/**
 * D3 da 2.66 — a dica do campo do local: o `ondeReside` do card, quando é texto.
 * É só placeholder, nunca é gravado.
 */
export function localSugeridoDoCard(
  deal: { customFields?: Record<string, unknown> } | null | undefined
): string | undefined {
  const valor = deal?.customFields?.ondeReside;
  return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
}
