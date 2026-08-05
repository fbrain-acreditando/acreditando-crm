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
  AI_LOG_ACTIONS,
  type AiLogAction,
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
          // Story 2.10 — o duplo aprendeu a segunda constraint.
          // Antes ele só aplicava `NOT NULL`, e por isso ficou VERDE enquanto a
          // produção falhava em `23514`: o teste conhecia menos regras do banco
          // que o banco. Aplicar o CHECK aqui é o que impede que a próxima
          // correção passe no teste e morra no ar de novo.
          if (!AI_LOG_ACTIONS.includes(values.action_taken as AiLogAction)) {
            return {
              error: {
                code: '23514',
                message:
                  'new row for relation "ai_conversation_log" violates check constraint "ai_conversation_log_action_taken_check"',
              },
            };
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
      actionTaken: 'bant_extraction',
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
      actionTaken: 'bant_extraction',
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
        actionTaken: 'bant_extraction',
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
        actionTaken: 'bant_extraction',
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
      actionTaken: 'bant_extraction',
      actionReason: 'r',
    });

    expect(r).toEqual({ logged: false, reason: 'sem_tokens' });
    expect(fake.linhas).toHaveLength(0);
  });
});

// =============================================================================
// Story 2.10 — a parede seguinte: `action_taken` violava o CHECK
// =============================================================================

describe('story 2.10 — o defeito que sobreviveu à 2.9', () => {
  /** Domínio do CHECK como estava no banco ANTES desta story. */
  const DOMINIO_ANTIGO = [
    'responded',
    'advanced_stage',
    'handoff',
    'skipped',
    'stage_evaluation',
  ];

  it('reproduz o 23514: o rótulo da extração estava fora do domínio antigo', () => {
    // Este é o motivo real de a tabela continuar vazia depois do deploy de 04/08.
    // A story 2.9 corrigiu as colunas NOT NULL e o insert passou a morrer aqui.
    expect(DOMINIO_ANTIGO).not.toContain('custom_fields_extraction');
    expect(DOMINIO_ANTIGO).not.toContain('bant_extraction');
    expect(DOMINIO_ANTIGO).not.toContain('briefing');
  });

  it('os três rótulos que gravam de fato estão no domínio novo', () => {
    expect(AI_LOG_ACTIONS).toContain('custom_fields_extraction');
    expect(AI_LOG_ACTIONS).toContain('bant_extraction');
    expect(AI_LOG_ACTIONS).toContain('briefing');
  });

  it('o domínio antigo continua inteiro — ampliar não pode remover', () => {
    for (const antigo of DOMINIO_ANTIGO) {
      expect(AI_LOG_ACTIONS).toContain(antigo);
    }
  });

  it('rótulo fora do domínio é recusado pelo duplo, com o código do Postgres', async () => {
    const fake = criarFake();

    // `as AiLogAction` força o valor inválido: em código de produção isto é erro
    // de compilação — que é o AC2. Aqui o cast existe para provar que, se alguém
    // contornar o tipo, o banco ainda barra.
    const r = await logAiTokens(fake.client, {
      organizationId: ORG,
      conversationId: CONV,
      tokensUsed: 100,
      modelUsed: 'm',
      actionTaken: 'generate_goal' as AiLogAction,
      actionReason: 'r',
    });

    expect(r).toEqual({
      logged: false,
      reason: 'erro',
      detail: expect.stringContaining('check constraint'),
    });
    expect(fake.linhas).toHaveLength(0);
  });

  it('AC2 — a união é FECHADA: valor novo não compila', () => {
    // @ts-expect-error rótulo fora de AiLogAction precisa quebrar o build.
    const invalido: AiLogAction = 'rotulo_inventado';
    expect(invalido).toBe('rotulo_inventado');
  });
});

describe('story 2.10 — contrato entre o código e a migration', () => {
  /**
   * `AI_LOG_ACTIONS` e o CHECK do banco são a MESMA regra escrita em dois
   * lugares. Nada no projeto obriga os dois a andarem juntos — e foi uma
   * dessincronia exatamente assim que produziu este bug: o código ganhou
   * rótulos novos e o banco continuou com os cinco de origem.
   *
   * Este teste lê o SQL e compara. É a única coisa aqui que falha quando alguém
   * acrescenta rótulo no TypeScript e esquece a migration.
   */
  it('os rótulos do código são exatamente os do CHECK na migration', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');

    const sql = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260805140000_ampliar_check_action_taken_ai_conversation_log.sql'
      ),
      'utf-8'
    );

    const corpo = sql.slice(sql.lastIndexOf('ADD CONSTRAINT'));
    const naSql = [...corpo.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);

    expect(naSql.length).toBeGreaterThan(0);
    expect([...naSql].sort()).toEqual([...AI_LOG_ACTIONS].sort());
  });
});
