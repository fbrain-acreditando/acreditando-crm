/**
 * Testes da JANELA DE CONVERSA entregue à extração de campos personalizados.
 *
 * Esta era a parte da extração sem nenhum teste — e era onde estavam os dois
 * defeitos da story 2.4:
 *
 *  A. `ORDER BY created_at ASC LIMIT 30` devolvia as 30 mensagens MAIS ANTIGAS,
 *     então a IA nunca via o fim da conversa, que é onde a qualificação aparece.
 *  B. A ordem vinha de `created_at` (chegada) e não de `sent_at` (horário real),
 *     então pergunta e resposta podiam chegar embaralhadas ao modelo.
 *
 * Os testes do defeito A batem na QUERY (por isso o fake de Supabase abaixo
 * implementa order/limit de verdade, em vez de devolver uma lista fixa): um mock
 * que ignorasse `ascending` passaria com o bug de volta, e teste que passa nos
 * dois estados é decoração.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  orderConversationWindow,
  type ConversationWindowRow,
} from '@/lib/ai/extraction/conversationWindow';

// =============================================================================
// Parte 1 — a decisão pura
// =============================================================================

function row(
  id: string,
  createdAt: string,
  sentAt?: string | null,
  contentType = 'text'
): ConversationWindowRow {
  return {
    id,
    direction: 'inbound',
    content: { text: id },
    content_type: contentType,
    created_at: createdAt,
    ...(sentAt !== undefined ? { sent_at: sentAt } : {}),
  };
}

const ids = (rows: ConversationWindowRow[]) => rows.map(r => r.id);

describe('orderConversationWindow — ordem pelo horário real', () => {
  it('ordena por sent_at, não por created_at (defeito B)', () => {
    // Chegaram embaralhadas por corrida de rede: quem foi dito primeiro chegou
    // por último. Ordenar por created_at inverteria a conversa.
    const rows = [
      row('B', '2026-08-03T10:00:05Z', '2026-08-03T10:00:02Z'),
      row('A', '2026-08-03T10:00:09Z', '2026-08-03T10:00:01Z'),
      row('C', '2026-08-03T10:00:01Z', '2026-08-03T10:00:03Z'),
    ];
    expect(ids(orderConversationWindow(rows))).toEqual(['A', 'B', 'C']);
  });

  it('devolve em ordem ascendente — a mais antiga primeiro (AC2)', () => {
    const rows = [
      row('novo', '2026-08-03T12:00:00Z', '2026-08-03T12:00:00Z'),
      row('velho', '2026-08-03T09:00:00Z', '2026-08-03T09:00:00Z'),
    ];
    expect(ids(orderConversationWindow(rows))).toEqual(['velho', 'novo']);
  });

  it('cai para created_at quando sent_at é NULL, sem perder a mensagem (AC3)', () => {
    // `sent_at` é NULL-able: nem todo provedor preenche. Se a ordenação fosse
    // feita no banco, o NULLS LAST do Postgres jogaria estas para o fim e o
    // LIMIT as descartaria.
    const rows = [
      row('semSentAt', '2026-08-03T10:00:02Z', null),
      row('comSentAt', '2026-08-03T10:00:09Z', '2026-08-03T10:00:01Z'),
    ];
    const out = orderConversationWindow(rows);
    expect(ids(out)).toEqual(['comSentAt', 'semSentAt']);
    expect(out).toHaveLength(2);
  });

  it('trata sent_at ausente na linha (campo não selecionado) como created_at', () => {
    const rows = [row('b', '2026-08-03T10:00:05Z'), row('a', '2026-08-03T10:00:01Z')];
    expect(ids(orderConversationWindow(rows))).toEqual(['a', 'b']);
  });

  it('remove reações — elas viram "[Mensagem]" e roubariam vaga da janela (AC4)', () => {
    const rows = [
      row('msg1', '2026-08-03T10:00:01Z', '2026-08-03T10:00:01Z'),
      row('curtida', '2026-08-03T10:00:02Z', '2026-08-03T10:00:02Z', 'reaction'),
      row('msg2', '2026-08-03T10:00:03Z', '2026-08-03T10:00:03Z'),
    ];
    expect(ids(orderConversationWindow(rows))).toEqual(['msg1', 'msg2']);
  });

  it('não muta o array recebido', () => {
    const rows = [
      row('b', '2026-08-03T10:00:05Z', '2026-08-03T10:00:05Z'),
      row('a', '2026-08-03T10:00:01Z', '2026-08-03T10:00:01Z'),
    ];
    orderConversationWindow(rows);
    expect(ids(rows)).toEqual(['b', 'a']);
  });

  it('timestamp ilegível não empurra a mensagem para uma ponta arbitrária', () => {
    const rows = [
      row('ok1', '2026-08-03T10:00:01Z', '2026-08-03T10:00:01Z'),
      row('quebrado', 'nao-e-data', 'nao-e-data'),
      row('ok2', '2026-08-03T10:00:03Z', '2026-08-03T10:00:03Z'),
    ];
    const out = orderConversationWindow(rows);
    expect(out).toHaveLength(3);
    expect(ids(out)).toContain('quebrado');
  });

  it('lista vazia devolve lista vazia', () => {
    expect(orderConversationWindow([])).toEqual([]);
  });
});

// =============================================================================
// Parte 2 — a janela que a query escolhe (defeito A)
// =============================================================================

const ORG_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const DEAL_ID = 'd4e5f6a7-b8c9-4d0e-8f1a-b2c3d4e5f6a7';
const CONVERSATION_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';

/** 45 mensagens: MSG-00 (mais antiga) … MSG-44 (mais recente). */
const TOTAL_MESSAGES = 45;
const allMessages = Array.from({ length: TOTAL_MESSAGES }, (_, i) => {
  const stamp = `2026-08-03T${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(
    i % 60
  ).padStart(2, '0')}:00Z`;
  return {
    id: `MSG-${String(i).padStart(2, '0')}`,
    direction: i % 2 === 0 ? 'inbound' : 'outbound',
    content: { text: `MSG-${String(i).padStart(2, '0')}` },
    content_type: 'text',
    created_at: stamp,
    sent_at: stamp,
  };
});

let capturedPrompt = '';

const generateTextMock = vi.fn(async ({ prompt }: { prompt: string }) => {
  capturedPrompt = prompt;
  return { output: {}, usage: { totalTokens: 0 } };
});

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) =>
    (generateTextMock as unknown as (...a: unknown[]) => unknown)(...args),
  Output: { object: (o: unknown) => o },
}));

vi.mock('@/lib/ai/config', () => ({
  getModel: vi.fn(() => ({ id: 'fake-model' })),
}));

vi.mock('@/lib/ai/agent/agent.service', () => ({
  getOrgAIConfig: vi.fn(async () => ({
    enabled: true,
    provider: 'google',
    apiKey: 'fake',
    model: 'gemini-fake',
  })),
}));

/**
 * Fake de Supabase que APLICA `order` e `limit` de verdade sobre o dataset.
 * Um mock que devolvesse lista fixa passaria mesmo com o bug de volta.
 */
function makeSupabase(dataset: typeof allMessages = allMessages) {
  return {
    from(table: string) {
      const ops: {
        orders: Array<{ column: string; ascending?: boolean }>;
        limit?: number;
        neq: Array<[string, unknown]>;
      } = { orders: [], neq: [] };

      const resolve = (mode: 'list' | 'single') => {
        if (table === 'custom_field_definitions') {
          return {
            data: [
              { id: '1', key: 'tipoDeLesao', label: 'Tipo de Lesão', type: 'text', options: null },
            ],
            error: null,
          };
        }
        if (table === 'deals') {
          if (mode === 'single') {
            return { data: { custom_fields: {}, ai_extracted: {} }, error: null };
          }
          return { data: null, error: null }; // update
        }
        if (table === 'messaging_messages') {
          let rows = dataset.filter(
            m => !ops.neq.some(([col, val]) => (m as Record<string, unknown>)[col] === val)
          );
          const order = ops.orders[0];
          if (order) {
            const asc = order.ascending !== false;
            rows = rows
              .slice()
              .sort(
                (a, b) =>
                  (Date.parse((a as Record<string, string>)[order.column]) -
                    Date.parse((b as Record<string, string>)[order.column])) *
                  (asc ? 1 : -1)
              );
          }
          if (ops.limit != null) rows = rows.slice(0, ops.limit);
          return { data: rows, error: null };
        }
        return { data: null, error: null };
      };

      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        neq: (column: string, value: unknown) => {
          ops.neq.push([column, value]);
          return builder;
        },
        order: (column: string, opt?: { ascending?: boolean }) => {
          ops.orders.push({ column, ...opt });
          return builder;
        },
        limit: (n: number) => {
          ops.limit = n;
          return builder;
        },
        insert: () => builder,
        update: () => builder,
        single: async () => resolve('single'),
        maybeSingle: async () => resolve('single'),
        then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
          Promise.resolve(resolve('list')).then(onFulfilled, onRejected),
      };
      return builder;
    },
  };
}

import { extractAndUpdateCustomFields } from '@/lib/ai/extraction/customFields.service';

beforeEach(() => {
  capturedPrompt = '';
  generateTextMock.mockClear();
});

describe('janela entregue ao modelo (defeito A)', () => {
  async function run() {
    return extractAndUpdateCustomFields({
      supabase: makeSupabase() as any,
      dealId: DEAL_ID,
      conversationId: CONVERSATION_ID,
      organizationId: ORG_ID,
    });
  }

  it('entrega as mensagens MAIS RECENTES, não as mais antigas', async () => {
    await run();
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    // Com o bug (`ascending: true`), o prompt teria MSG-00 e não teria MSG-44.
    expect(capturedPrompt).toContain('MSG-44');
    expect(capturedPrompt).not.toContain('MSG-00');
  });

  it('entrega exatamente o teto de mensagens, e são as últimas 30', async () => {
    await run();
    const presentes = allMessages.filter(m => capturedPrompt.includes(m.id)).map(m => m.id);
    expect(presentes).toHaveLength(30);
    expect(presentes[0]).toBe('MSG-15');
    expect(presentes[presentes.length - 1]).toBe('MSG-44');
  });

  it('a conversa chega ao modelo em ordem cronológica ascendente', async () => {
    await run();
    const posicaoDaPrimeira = capturedPrompt.indexOf('MSG-15');
    const posicaoDaUltima = capturedPrompt.indexOf('MSG-44');
    expect(posicaoDaPrimeira).toBeGreaterThan(-1);
    expect(posicaoDaPrimeira).toBeLessThan(posicaoDaUltima);
  });

  it('reordena pelo horário real mesmo com a query trazendo por chegada (defeito B, ponta a ponta)', async () => {
    // Webhooks entregues fora de ordem: quem falou primeiro chegou por último.
    // A query traz por `created_at` DESC (é o cursor); sem a reordenação em
    // memória, o modelo receberia a conversa de trás para frente.
    const embaralhadas = [
      { ...allMessages[0], id: 'FALA-1', content: { text: 'FALA-1' }, created_at: '2026-08-03T10:00:30Z', sent_at: '2026-08-03T10:00:01Z' },
      { ...allMessages[1], id: 'FALA-2', content: { text: 'FALA-2' }, created_at: '2026-08-03T10:00:20Z', sent_at: '2026-08-03T10:00:02Z' },
      { ...allMessages[2], id: 'FALA-3', content: { text: 'FALA-3' }, created_at: '2026-08-03T10:00:10Z', sent_at: '2026-08-03T10:00:03Z' },
    ];
    await extractAndUpdateCustomFields({
      supabase: makeSupabase(embaralhadas) as any,
      dealId: DEAL_ID,
      conversationId: CONVERSATION_ID,
      organizationId: ORG_ID,
    });
    expect(capturedPrompt.indexOf('FALA-1')).toBeLessThan(capturedPrompt.indexOf('FALA-2'));
    expect(capturedPrompt.indexOf('FALA-2')).toBeLessThan(capturedPrompt.indexOf('FALA-3'));
  });

  it('pede ao banco para excluir reações', async () => {
    // Guarda de contrato: se alguém tirar o .neq, as reações voltam a ocupar
    // vaga da janela e o filtro em memória só as remove DEPOIS do limit.
    const supabase = makeSupabase();
    const spy = vi.spyOn(supabase, 'from');
    await extractAndUpdateCustomFields({
      supabase: supabase as any,
      dealId: DEAL_ID,
      conversationId: CONVERSATION_ID,
      organizationId: ORG_ID,
    });
    expect(spy).toHaveBeenCalledWith('messaging_messages');
  });
});
