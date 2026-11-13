'use client';

/**
 * O contato do card tem conversa? — story 2.52, AC1 (T2).
 *
 * Hoje o card só testava `contact?.id`. O estado agora vem das conversas do
 * contato (`messaging_conversations` por `contact_id`), com uma exceção (AC4.3):
 * conversa que a própria rota marcou `inicio_falhou` e que segue SEM mensagem conta
 * como "sem conversa" — o botão "Iniciar" volta e o próximo clique a reaproveita.
 *
 * @module features/messaging/hooks/useConversaDoContato
 */

import { useConversationsByContact } from '@/lib/query/hooks/useMessagingConversationsQuery';

interface ConversaMinima {
  id: string;
  messageCount?: number;
  metadata?: Record<string, unknown> | null;
}

export interface EstadoDaConversaDoContato {
  temConversa: boolean;
  conversationId: string | null;
}

/** Regra pura (testada): a primeira conversa "de verdade" da lista, se houver. */
export function estadoDaConversaDoContato(conversas: ConversaMinima[] | null | undefined): EstadoDaConversaDoContato {
  const real = (conversas ?? []).find(
    (c) => !(c.metadata?.inicio_falhou === true && (c.messageCount ?? 0) === 0)
  );
  return { temConversa: Boolean(real), conversationId: real?.id ?? null };
}

export function useConversaDoContato(contactId: string | undefined) {
  const { data, isLoading } = useConversationsByContact(contactId);
  return { ...estadoDaConversaDoContato(contactId ? data : []), carregando: Boolean(contactId) && isLoading };
}
