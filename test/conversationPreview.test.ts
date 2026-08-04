/**
 * A prévia da conversa na lista — story 2.8.
 *
 * O GPT Maker dispara mensagens em rajada e as entregas HTTP chegam embaralhadas.
 * Com a escrita incondicional, a prévia ficava sendo a da última mensagem A
 * CHEGAR, não a da última ENVIADA. Medido em produção: 33 conversas assim.
 *
 * ## O que faz este teste valer
 *
 * O duplo abaixo modela o filtro do `UPDATE` de verdade: ele COMPARA o carimbo
 * antes de escrever e devolve as linhas afetadas. Um duplo que aceitasse toda
 * escrita faria o comportamento antigo passar — por isso o primeiro bloco roda a
 * escrita incondicional contra o MESMO duplo e exige que ela erre.
 */
import { describe, expect, it } from 'vitest';

import {
  updateConversationPreview,
  type ConversationPreviewClient,
} from '../supabase/functions/messaging-webhook-gptmaker/conversation-preview';

const CONV = '1d0d503a-2943-4897-ab54-4fb7e2bfdfce';

/** A rajada real da conversa 1d0d503a, em 27/07/2026 — `sent_at` com 1 ms entre elas. */
const RAJADA = [
  { texto: 'Ficamos felizes com seu interesse no Sistema Robótico…', sentAt: '2026-07-27T21:18:06.314Z' },
  { texto: 'No Acreditando, unimos recursos tecnológicos…', sentAt: '2026-07-27T21:18:06.316Z' },
  { texto: 'Contamos com o Sistema de Marcha em Esteira…', sentAt: '2026-07-27T21:18:06.317Z' },
  { texto: 'Antes de passar você para um atendimento humano…', sentAt: '2026-07-27T21:18:06.318Z' },
  { texto: 'Qual é o seu nome?', sentAt: '2026-07-27T21:18:06.319Z' },
] as const;

/** A ordem em que elas REALMENTE chegaram (índices por `created_at` crescente). */
const ORDEM_DE_CHEGADA = [1, 4, 3, 2, 0];

interface Linha {
  id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_direction: string | null;
  status: string;
}

function criarFake(inicial: Partial<Linha> = {}) {
  const linha: Linha = {
    id: CONV,
    last_message_at: null,
    last_message_preview: null,
    last_message_direction: null,
    status: 'resolved',
    ...inicial,
  };

  /** Reproduz `or=(last_message_at.is.null,last_message_at.lt."X")`. */
  const casaFiltro = (expr: string): boolean => {
    if (linha.last_message_at === null && expr.includes('last_message_at.is.null')) return true;
    const m = expr.match(/last_message_at\.(lt|lte)\."([^"]+)"/);
    if (!m || linha.last_message_at === null) return false;
    const [, op, valor] = m;
    const atual = Date.parse(linha.last_message_at);
    const novo = Date.parse(valor);
    return op === 'lt' ? atual < novo : atual <= novo;
  };

  const aplicar = (values: Record<string, unknown>) => {
    Object.assign(linha, values);
    return { data: [{ id: linha.id }], error: null };
  };

  const client: ConversationPreviewClient = {
    from() {
      return {
        update(values: Record<string, unknown>) {
          return {
            eq() {
              return {
                or(expr: string) {
                  return {
                    async select() {
                      // O filtro barrou: sucesso do PostgREST, ZERO linhas.
                      if (!casaFiltro(expr)) return { data: [], error: null };
                      return aplicar(values);
                    },
                  };
                },
                async select() {
                  return aplicar(values);
                },
              };
            },
          };
        },
      };
    },
  };

  return { client, linha };
}

/** A escrita incondicional que existia antes desta story. */
function escritaAntiga(fake: ReturnType<typeof criarFake>, texto: string, sentAt: string) {
  fake.linha.last_message_at = sentAt;
  fake.linha.last_message_preview = texto;
  fake.linha.last_message_direction = 'outbound';
}

describe('o defeito, como ele acontece em produção', () => {
  it('a escrita ANTIGA deixa a prévia na PRIMEIRA mensagem da rajada', async () => {
    const fake = criarFake();

    for (const i of ORDEM_DE_CHEGADA) {
      escritaAntiga(fake, RAJADA[i].texto, RAJADA[i].sentAt);
    }

    // "Ficamos felizes…" foi a primeira ENVIADA e a última a CHEGAR.
    expect(fake.linha.last_message_preview).toBe(RAJADA[0].texto);
    expect(fake.linha.last_message_preview).not.toBe('Qual é o seu nome?');
  });
});

describe('updateConversationPreview — AC1, AC2, AC9', () => {
  it('a rajada fora de ordem termina na ÚLTIMA mensagem enviada', async () => {
    const fake = criarFake();

    for (const i of ORDEM_DE_CHEGADA) {
      await updateConversationPreview(fake.client, {
        conversationId: CONV,
        sentAt: RAJADA[i].sentAt,
        preview: RAJADA[i].texto,
        direction: 'outbound',
      });
    }

    expect(fake.linha.last_message_preview).toBe('Qual é o seu nome?');
    expect(fake.linha.last_message_at).toBe(RAJADA[4].sentAt);
  });

  it('mensagem mais nova sobrescreve normalmente', async () => {
    const fake = criarFake({
      last_message_at: '2026-07-27T21:18:06.314Z',
      last_message_preview: 'antiga',
    });

    const r = await updateConversationPreview(fake.client, {
      conversationId: CONV,
      sentAt: '2026-07-27T21:18:06.319Z',
      preview: 'Qual é o seu nome?',
      direction: 'outbound',
    });

    expect(r.applied).toBe(true);
    expect(fake.linha.last_message_preview).toBe('Qual é o seu nome?');
  });

  it('mensagem mais antiga NÃO sobrescreve', async () => {
    const fake = criarFake({
      last_message_at: '2026-07-27T21:18:06.319Z',
      last_message_preview: 'Qual é o seu nome?',
    });

    const r = await updateConversationPreview(fake.client, {
      conversationId: CONV,
      sentAt: '2026-07-27T21:18:06.314Z',
      preview: 'Ficamos felizes…',
      direction: 'outbound',
    });

    expect(r.applied).toBe(false);
    expect(fake.linha.last_message_preview).toBe('Qual é o seu nome?');
  });
});

describe('updateConversationPreview — AC4 e AC5', () => {
  it('primeira mensagem da conversa grava (last_message_at nulo)', async () => {
    const fake = criarFake();

    const r = await updateConversationPreview(fake.client, {
      conversationId: CONV,
      sentAt: '2026-07-27T21:18:06.314Z',
      preview: 'Olá!',
      direction: 'outbound',
    });

    expect(r.applied).toBe(true);
    expect(fake.linha.last_message_preview).toBe('Olá!');
  });

  it('empate de carimbo NÃO sobrescreve — senão duas entregas ficam alternando', async () => {
    const fake = criarFake({
      last_message_at: '2026-07-27T21:18:06.319Z',
      last_message_preview: 'primeira a chegar',
    });

    const r = await updateConversationPreview(fake.client, {
      conversationId: CONV,
      sentAt: '2026-07-27T21:18:06.319Z',
      preview: 'segunda a chegar',
      direction: 'outbound',
    });

    expect(r.applied).toBe(false);
    expect(fake.linha.last_message_preview).toBe('primeira a chegar');
  });

  it('corta a prévia em 100 caracteres', async () => {
    const fake = criarFake();

    await updateConversationPreview(fake.client, {
      conversationId: CONV,
      sentAt: '2026-07-27T21:18:06.314Z',
      preview: 'x'.repeat(250),
      direction: 'inbound',
    });

    expect(fake.linha.last_message_preview).toHaveLength(100);
  });
});

describe('updateConversationPreview — AC6: o cliente falou, a conversa reabre', () => {
  it('inbound mais recente reabre a conversa', async () => {
    const fake = criarFake({ status: 'resolved' });

    const r = await updateConversationPreview(fake.client, {
      conversationId: CONV,
      sentAt: '2026-07-27T21:18:06.319Z',
      preview: 'oi, ainda dá tempo?',
      direction: 'inbound',
    });

    expect(r.applied).toBe(true);
    expect(fake.linha.status).toBe('open');
  });

  it('inbound FORA DE ORDEM preserva a prévia MAS ainda reabre', async () => {
    const fake = criarFake({
      last_message_at: '2026-07-27T21:18:06.319Z',
      last_message_preview: 'Qual é o seu nome?',
      status: 'resolved',
    });

    const r = await updateConversationPreview(fake.client, {
      conversationId: CONV,
      sentAt: '2026-07-27T21:18:06.310Z',
      preview: 'mensagem antiga do cliente',
      direction: 'inbound',
    });

    // Esconder da fila uma conversa em que o cliente falou é pior que prévia velha.
    expect(r.applied).toBe(false);
    expect(r.reopened).toBe(true);
    expect(fake.linha.status).toBe('open');
    expect(fake.linha.last_message_preview).toBe('Qual é o seu nome?');
  });

  it('outbound fora de ordem NÃO mexe no status', async () => {
    const fake = criarFake({
      last_message_at: '2026-07-27T21:18:06.319Z',
      status: 'resolved',
    });

    const r = await updateConversationPreview(fake.client, {
      conversationId: CONV,
      sentAt: '2026-07-27T21:18:06.310Z',
      preview: 'resposta antiga da IA',
      direction: 'outbound',
    });

    expect(r.reopened).toBe(false);
    expect(fake.linha.status).toBe('resolved');
  });
});
