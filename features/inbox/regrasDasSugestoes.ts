/**
 * Story 2.76 (D4) — regras das sugestões do Inbox, extraídas do
 * `useInboxController` SEM mudar a lógica, para serem testadas sem tela.
 */
import type { Contact } from '@/types';

/** Aniversariante do mês `mes` (1–12)? `birthDate` no formato `AAAA-MM-DD`. */
export function fazAniversarioNoMes(contato: Pick<Contact, 'birthDate'>, mes: number): boolean {
  if (!contato.birthDate) return false;
  const birthMonth = parseInt(contato.birthDate.split('-')[1]);
  return birthMonth === mes;
}

/**
 * Cliente em risco de churn (resgate): cliente ativo (não lead) sem
 * interação/compra desde `limiteTs`.
 *
 * - Sem histórico: carência de 30 dias depois da criação (`createdAt` antes do limite).
 * - Com histórico: a data mais recente entre interação e compra, antes do limite.
 */
export function ehClienteParaResgate(
  c: Pick<Contact, 'status' | 'stage' | 'createdAt' | 'lastInteraction' | 'lastPurchaseDate'>,
  limiteTs: number
): boolean {
  // Padrão de mercado: considerar apenas clientes ativos (não leads)
  if (c.status !== 'ACTIVE' || c.stage !== 'CUSTOMER') return false;

  const createdAtTs = Date.parse(c.createdAt);

  // Sem histórico: carência de 30d após criação
  if (!c.lastInteraction && !c.lastPurchaseDate) {
    return createdAtTs < limiteTs;
  }

  // Com histórico: pega a data mais recente entre interação e compra
  const lastInteractionTs = c.lastInteraction ? Date.parse(c.lastInteraction) : null;
  const lastPurchaseTs = c.lastPurchaseDate ? Date.parse(c.lastPurchaseDate) : null;
  const lastActivityTs =
    lastInteractionTs != null && lastPurchaseTs != null
      ? Math.max(lastInteractionTs, lastPurchaseTs)
      : lastInteractionTs ?? lastPurchaseTs;

  return lastActivityTs !== null && lastActivityTs < limiteTs;
}
