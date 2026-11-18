/**
 * Story 2.76 (D2) — a expressão da busca de contato na seleção ("Novo card").
 *
 * A busca de contato procurava só na lista do `useContacts()`, que traz os
 * 1.000 contatos criados mais recentemente; contato mais antigo "não existia"
 * e era recadastrado. Agora a busca vai ao banco com a mesma limpeza da busca
 * de cards (2.74) — nome + telefone — e mais o e-mail.
 *
 * ⚠️ Nada aqui fala com o banco. Quem consulta é
 * `contactsService.buscarParaSelecao`, com o cliente do usuário logado (RLS).
 */
import { filtroDeContatosParaBusca, termoSeguroParaBusca } from './buscaDeCards';

/** Quantos contatos a seleção mostra (D1). */
export const LIMITE_DA_SELECAO_DE_CONTATOS = 8;

/**
 * Expressão do `.or()` da busca de contato: nome + telefone (2.74) + e-mail.
 *
 * Não reusa o `filtroDeBuscaDeContato` da 2.45: o `escaparParaOr` troca `%`
 * por `_`, que também é curinga.
 *
 * @returns a expressão pronta, ou `null` se o termo não vai ao banco
 *          (menos de 3 letras/dígitos, ou só curingas).
 */
export function filtroDeContatosParaSelecao(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const termo = termoSeguroParaBusca(bruto);
  const base = filtroDeContatosParaBusca(bruto);
  if (!termo || !base) return null;
  return `${base},email.ilike.%${termo}%`;
}
