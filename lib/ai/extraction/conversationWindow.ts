/**
 * @fileoverview Seleção da JANELA DE CONVERSA entregue à extração por IA.
 *
 * Por que é um módulo próprio: decidir *quais* mensagens a IA lê e *em que
 * ordem* é uma decisão pura — e era justamente a parte da extração que não
 * tinha teste nenhum. Isolada aqui, ela é testável sem mock de Supabase nem
 * chamada de modelo, no mesmo padrão de `pickTranscription`.
 *
 * O que estava errado antes (ver story 2.4):
 *
 * 1. A query fazia `ORDER BY created_at ASC LIMIT 30`, o que devolve as 30
 *    mensagens MAIS ANTIGAS. Numa conversa longa a IA lia o "oi, bom dia" e
 *    nunca chegava ao trecho de qualificação, que vem no fim do roteiro —
 *    logo antes da transferência. Campos ficavam vazios sem erro nenhum.
 *
 * 2. Ordenava por `created_at` (hora em que o webhook chegou) e não por
 *    `sent_at` (hora em que a mensagem foi dita). O provedor entrega lotes em
 *    paralelo e as entregas HTTP chegam embaralhadas por corrida de rede, então
 *    `created_at` reflete a corrida, não a conversa. É o mesmo defeito que
 *    `d812f54` corrigiu na tela (`MessageThread.tsx`) e que ficou para trás aqui.
 *
 * ⚠️ `sent_at` é NULL-able (migration 20260205100000:387) — nem todo provedor
 * preenche. Por isso a ordenação NÃO pode ser feita no banco: `ORDER BY sent_at
 * ASC` usa NULLS LAST no Postgres e, combinado com LIMIT, DESCARTARIA as
 * mensagens sem `sent_at`. Trocaria um bug por outro, mais difícil de enxergar.
 *
 * A divisão de trabalho é a mesma da tela: a JANELA é escolhida por `created_at`
 * (monotônico e sempre preenchido, serve de cursor); a ORDEM é resolvida aqui,
 * em memória, com o fallback `sent_at ?? created_at`.
 *
 * @module lib/ai/extraction/conversationWindow
 */

/** Linha crua de `messaging_messages`, no recorte que a extração seleciona. */
export interface ConversationWindowRow {
  id: string;
  direction: string;
  content: unknown;
  content_type?: string | null;
  created_at: string;
  sent_at?: string | null;
}

/**
 * Instante em que a mensagem foi DITA, com queda para a hora de chegada.
 *
 * Mesmo critério de `MessageThread.tsx:72` (`sentAt ?? createdAt`). Se os dois
 * lados divergirem, a tela mostra uma ordem e a IA lê outra — e nada acusa erro.
 */
function messageInstant(row: ConversationWindowRow): number {
  const raw = row.sent_at ?? row.created_at;
  const parsed = Date.parse(raw);
  // Timestamp ilegível não pode empurrar a mensagem para uma ponta arbitrária:
  // devolvemos NaN e o comparador trata como empate, preservando a ordem de chegada.
  return parsed;
}

/**
 * Recebe as linhas como vieram do banco (as N mais recentes, em qualquer ordem)
 * e devolve a janela pronta para o prompt: sem reações e em ordem cronológica
 * ascendente pelo horário real.
 *
 * É idempotente e não depende da ordem de entrada — de propósito, para que a
 * correção não fique refém de a query manter o `descending`.
 */
export function orderConversationWindow<T extends ConversationWindowRow>(rows: T[]): T[] {
  return rows
    .filter(row => row.content_type !== 'reaction')
    .slice() // não muta o array do chamador
    .sort((a, b) => {
      const ta = messageInstant(a);
      const tb = messageInstant(b);
      // Array.sort é estável (ES2019+): empate preserva a ordem de chegada como
      // desempate, que é a mesma garantia assumida pela thread na tela.
      if (Number.isNaN(ta) || Number.isNaN(tb) || ta === tb) return 0;
      return ta - tb;
    });
}
