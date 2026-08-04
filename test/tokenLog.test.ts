/**
 * Contabilização de tokens da IA — story 2.9.
 *
 * `ai_conversation_log` ficou **vazia desde sempre**: três pontos de inserção
 * omitiam `context_snapshot`, que é `jsonb NOT NULL` sem default. O erro real do
 * banco, capturado em produção em 2026-08-04:
 *
 *   ERROR: 23502: null value in column "context_snapshot" of relation
 *          "ai_conversation_log" violates not-null constraint
 *
 * O `briefing` omitia **duas** — também faltava `conversation_id`.
 *
 * ## O que faz este teste valer
 *
 * O duplo abaixo **rejeita o insert que não traz as colunas obrigatórias**, igual
 * ao Postgres. Um duplo que aceitasse qualquer objeto daria verde para o código
 * defeituoso — que é exatamente o que aconteceu por 8 dias em produção, onde o
 * "duplo" era um `console.error` que ninguém lia.
 */
import { describe, expect, it } from 'vitest';

import {
  logAiTokens,
  AI_CONVERSATION_LOG_REQUIRED_COLUMNS,
  type TokenLogClient,
} from '../lib/ai/token-log';

const ORG = '83160646-16a0-4cb7-9067-7ce7ef34ff50';
const CONV = 'e881089c-170f-44f0-b20c-9c808eb98697';

/** Duplo que aplica as constraints `NOT NULL` de verdade. */
function criarFake() {
  const linhas: Array<Record<string, unknown>> = [];

  const client: TokenLogClient = {
    from() {
      return {
        async insert(values: Record<string, unknown>) {
          for (const col of AI_CONVERSATION_LOG_REQUIRED_COLUMNS) {
            if (values[col] === undefined || values[col] === null) {
              return {
                error: {
                  code: '23502',
                  message: `null value in column "${col}" of relation "ai_conversation_log" violates not-null constraint`,
                },
              };
            }
          }
          linhas.push(values);
          return { error: null };
        },
      };
    },
  };

  return { client, linhas };
}

/** O insert que os três pontos faziam antes desta story. */
async function insertAntigo(fake: ReturnType<typeof criarFake>) {
  return fake.client.from('ai_conversation_log').insert({
    organization_id: ORG,
    conversation_id: CONV,
    tokens_used: 1234,
    model_used: 'gemini-2.0-flash',
    action_taken: 'custom_fields_extraction',
    action_reason: 'Extração de campos do deal X',
    ai_response: '',
    // context_snapshot ausente — era este o defeito.
  });
}

describe('o defeito, como ele acontecia em produção', () => {
  it('o insert ANTIGO é rejeitado por context_snapshot NOT NULL', async () => {
    const fake = criarFake();

    const { error } = await insertAntigo(fake);

    expect(error?.code).toBe('23502');
    expect(error?.message).toContain('context_snapshot');
    expect(fake.linhas).toHaveLength(0);
  });
});

describe('logAiTokens — AC1, AC2, AC5', () => {
  it('grava a linha com as colunas obrigatórias preenchidas', async () => {
    const fake = criarFake();

    const r = await logAiTokens(fake.client, {
      organizationId: ORG,
      conversationId: CONV,
      tokensUsed: 1234,
      modelUsed: 'gemini-2.0-flash',
      actionTaken: 'custom_fields_extraction',
      actionReason: 'Extração de campos do deal X',
    });

    expect(r).toEqual({ logged: true });
    expect(fake.linhas).toHaveLength(1);
    expect(fake.linhas[0].tokens_used).toBe(1234);
    expect(fake.linhas[0].model_used).toBe('gemini-2.0-flash');
    expect(fake.linhas[0].action_taken).toBe('custom_fields_extraction');
    expect(fake.linhas[0].organization_id).toBe(ORG);
  });

  it('context_snapshot vai como objeto VAZIO, nunca null', async () => {
    const fake = criarFake();

    await logAiTokens(fake.client, {
      organizationId: ORG,
      conversationId: CONV,
      tokensUsed: 10,
      modelUsed: 'm',
      actionTaken: 'a',
      actionReason: 'r',
    });

    expect(fake.linhas[0].context_snapshot).toEqual({});
  });

  it('⚖️ NÃO grava conteúdo de conversa em context_snapshot', async () => {
    // Dado de saúde (Art. 11) com base legal pendente desde 21/07: consertar a
    // contabilidade não pode virar ampliação de tratamento.
    const fake = criarFake();

    await logAiTokens(fake.client, {
      organizationId: ORG,
      conversationId: CONV,
      tokensUsed: 10,
      modelUsed: 'm',
      actionTaken: 'a',
      actionReason: 'r',
    });

    expect(JSON.stringify(fake.linhas[0].context_snapshot)).toBe('{}');
    expect(fake.linhas[0].ai_response).toBe('');
  });
});

describe('logAiTokens — AC3: a falha deixa de ser silenciosa', () => {
  it('devolve o motivo quando não há conversa (coluna é NOT NULL)', async () => {
    const fake = criarFake();
    const avisos: string[] = [];

    const r = await logAiTokens(
      fake.client,
      {
        organizationId: ORG,
        conversationId: null,
        tokensUsed: 900,
        modelUsed: 'm',
        actionTaken: 'briefing',
        actionReason: 'r',
      },
      (m) => avisos.push(m)
    );

    expect(r).toEqual({ logged: false, reason: 'sem_conversa' });
    // O aviso precisa dizer QUANTOS tokens ficaram de fora — senão some de novo.
    expect(avisos.join()).toContain('900');
    expect(avisos.join()).toContain('briefing');
    expect(fake.linhas).toHaveLength(0);
  });

  it('devolve o erro do banco em vez de engolir', async () => {
    const client: TokenLogClient = {
      from() {
        return {
          async insert() {
            return { error: { code: '42501', message: 'permission denied' } };
          },
        };
      },
    };
    const avisos: string[] = [];

    const r = await logAiTokens(
      client,
      {
        organizationId: ORG,
        conversationId: CONV,
        tokensUsed: 50,
        modelUsed: 'm',
        actionTaken: 'a',
        actionReason: 'r',
      },
      (m) => avisos.push(m)
    );

    expect(r).toEqual({ logged: false, reason: 'erro', detail: 'permission denied' });
    expect(avisos.join()).toContain('42501');
  });
});

describe('logAiTokens — AC4: nunca derruba a operação de origem', () => {
  it('NÃO lança quando o cliente explode — devolve o motivo', async () => {
    const client = {
      from() {
        return {
          insert() {
            return Promise.reject(new Error('rede caiu'));
          },
        };
      },
    } as unknown as TokenLogClient;
    const avisos: string[] = [];

    // Quem chama usa `void logAiTokens(...)`. Se a promessa rejeitar, vira
    // unhandled rejection e derruba, pelo caminho mais indireto possível, a
    // operação que já tinha dado certo. É o que o AC4 proíbe.
    const r = await logAiTokens(
      client,
      {
        organizationId: ORG,
        conversationId: CONV,
        tokensUsed: 10,
        modelUsed: 'm',
        actionTaken: 'a',
        actionReason: 'r',
      },
      (m) => avisos.push(m)
    );

    expect(r).toEqual({ logged: false, reason: 'erro', detail: 'rede caiu' });
    expect(avisos.join()).toContain('rede caiu');
  });

  it('zero tokens não vira linha nem erro', async () => {
    const fake = criarFake();

    const r = await logAiTokens(fake.client, {
      organizationId: ORG,
      conversationId: CONV,
      tokensUsed: 0,
      modelUsed: 'm',
      actionTaken: 'a',
      actionReason: 'r',
    });

    expect(r).toEqual({ logged: false, reason: 'sem_tokens' });
    expect(fake.linhas).toHaveLength(0);
  });
});
