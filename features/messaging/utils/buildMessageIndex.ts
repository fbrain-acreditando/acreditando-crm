import type { MessagingMessage } from '@/lib/messaging/types';

/**
 * Índice para resolver "a qual mensagem esta responde" em O(1).
 *
 * Story 2.23 (AC2). Antes, cada `MessageBubble` fazia:
 *
 *   allMessages.find((m) => m.id === replyToMessageId || m.externalId === replyToMessageId)
 *
 * — uma busca linear POR BOLHA, ou seja O(n²) na conversa inteira.
 *
 * 🪤 A regra "PRIMEIRO VENCE" existe para preservar a semântica do `find`:
 * ele varria em ordem e devolvia o **primeiro** que casasse por `id` OU por
 * `externalId`. Um Map com "último escreve" devolveria outro resultado se um
 * `externalId` colidisse com o `id` de outra mensagem. Improvável, mas o custo
 * de preservar é uma checagem `has()` — e o custo de não preservar é uma bolha
 * citando a mensagem errada, que ninguém notaria.
 */
export function buildMessageIndex(
  messages: readonly MessagingMessage[]
): Map<string, MessagingMessage> {
  const index = new Map<string, MessagingMessage>();

  for (const message of messages) {
    if (!index.has(message.id)) index.set(message.id, message);
    if (message.externalId && !index.has(message.externalId)) {
      index.set(message.externalId, message);
    }
  }

  return index;
}
