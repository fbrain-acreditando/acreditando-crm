/**
 * Testes do casamento do eco — story 2.53 (AC7).
 *
 * O cliente falso abaixo **aplica de verdade** os filtros do PostgREST (eq, gte,
 * lte, or, order, limit) sobre um conjunto de linhas em memória, e a escrita só
 * pega quando a linha ainda casa com a condição. Sem isso, os testes provariam
 * apenas que a função chama os métodos certos — não que o critério separa eco de
 * mensagem legítima, que é o que esta story arrisca errar.
 *
 * Os dados vêm dos pares reais medidos em produção em 20/09/2026 (conversa
 * `8a994c0e-…`, texto; pares de áudio de 16–17/09), com telefone e conteúdo
 * mascarados.
 */

import { describe, it, expect } from 'vitest';
import {
  casarEcoComMensagemEnviada,
  ECHO_MATCH_WINDOW_MS,
  type EchoMatchClient,
} from './echo-match';

// =============================================================================
// CLIENTE FALSO — filtros de verdade, escrita condicional de verdade
// =============================================================================

interface LinhaFake {
  id: string;
  conversation_id: string;
  direction: string;
  content_type: string;
  external_id: string | null;
  content: Record<string, unknown> | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
  /** Campos que o UPDATE NÃO pode tocar — ficam aqui para serem conferidos. */
  sender_type?: string | null;
  sender_user_id?: string | null;
  sent_at?: string | null;
  status?: string;
}

type Predicado = (linha: LinhaFake) => boolean;

/** Traduz um `or` do PostgREST (`col.is.null,col.like.pref*`) em predicado. */
function predicadoOr(expr: string): Predicado {
  const termos = expr.split(',');
  return (linha) =>
    termos.some((termo) => {
      const [col, op, ...resto] = termo.split('.');
      const valor = resto.join('.');
      const atual = (linha as unknown as Record<string, unknown>)[col];
      if (op === 'is' && valor === 'null') return atual === null || atual === undefined;
      if (op === 'like') {
        if (typeof atual !== 'string') return false;
        return valor.endsWith('*')
          ? atual.startsWith(valor.slice(0, -1))
          : atual === valor;
      }
      throw new Error(`operador nao suportado no fake: ${termo}`);
    });
}

function criarClienteFake(linhas: LinhaFake[]) {
  /** Toda escrita que o banco de fato aplicou. */
  const escritas: Array<{ id: string; values: Record<string, unknown> }> = [];
  /** Toda tentativa de escrita, inclusive as barradas pela condição. */
  const tentativas: Array<{ id: string; aplicou: boolean }> = [];

  const client: EchoMatchClient = {
    from() {
      return {
        select() {
          const filtros: Predicado[] = [];
          let ordenar: { col: string; ascending: boolean } | null = null;

          const builder = {
            eq(col: string, val: unknown) {
              filtros.push(
                (l) => (l as unknown as Record<string, unknown>)[col] === val
              );
              return builder;
            },
            in(col: string, vals: string[]) {
              filtros.push((l) =>
                vals.includes(String((l as unknown as Record<string, unknown>)[col]))
              );
              return builder;
            },
            gte(col: string, val: string) {
              filtros.push(
                (l) =>
                  Date.parse(String((l as unknown as Record<string, unknown>)[col])) >=
                  Date.parse(val)
              );
              return builder;
            },
            lte(col: string, val: string) {
              filtros.push(
                (l) =>
                  Date.parse(String((l as unknown as Record<string, unknown>)[col])) <=
                  Date.parse(val)
              );
              return builder;
            },
            or(expr: string) {
              filtros.push(predicadoOr(expr));
              return builder;
            },
            order(col: string, opts: { ascending: boolean }) {
              ordenar = { col, ascending: opts.ascending };
              return builder;
            },
            async limit(n: number) {
              let resultado = linhas.filter((l) => filtros.every((f) => f(l)));
              if (ordenar) {
                const { col, ascending } = ordenar;
                resultado = [...resultado].sort((a, b) => {
                  const va = String((a as unknown as Record<string, unknown>)[col]);
                  const vb = String((b as unknown as Record<string, unknown>)[col]);
                  return ascending ? va.localeCompare(vb) : vb.localeCompare(va);
                });
              }
              return {
                data: resultado.slice(0, n).map((l) => ({
                  id: l.id,
                  external_id: l.external_id,
                  content: l.content,
                  created_at: l.created_at,
                  metadata: l.metadata,
                })),
                error: null,
              };
            },
          };

          return builder;
        },

        update(values: Record<string, unknown>) {
          return {
            eq(_col: string, id: string) {
              return {
                or(expr: string) {
                  const condicaoOr = predicadoOr(expr);
                  return {
                    in(col: string, vals: string[]) {
                      // A condição da escrita é a MESMA do SELECT, reavaliada
                      // aqui: `or` de elegibilidade + status permitido.
                      const condicao: Predicado = (l) =>
                        condicaoOr(l) &&
                        vals.includes(
                          String((l as unknown as Record<string, unknown>)[col])
                        );
                      return {
                        async select() {
                          const linha = linhas.find((l) => l.id === id);
                          if (!linha || !condicao(linha)) {
                            tentativas.push({ id, aplicou: false });
                            return { data: [], error: null };
                          }
                          Object.assign(linha, values);
                          escritas.push({ id, values });
                          tentativas.push({ id, aplicou: true });
                          return { data: [{ id }], error: null };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  return { client, escritas, tentativas, linhas };
}

// =============================================================================
// FIXTURES
// =============================================================================

const CONVERSA = '8a994c0e-50d2-4776-8243-39977040f9eb';
const CHAT_ID = '25761ba7-b9e6-439a-aff1-ad5632281a20-5511XXXXXXXXX';
const ID_REAL = '3F935A8092DEE0143DB6EE1E03543143';

/** 17:40:44.030Z — a linha que o CRM gravou. */
const ENVIO_EM = '2026-09-15T17:40:44.030Z';
/** 17:40:45.599Z — o eco, 1,57 s depois. */
const ECO_EM = new Date('2026-09-15T17:40:45.599Z');

const TEXTO = 'Bom dia! Conseguiu ver a proposta que enviei?';

/** Linha do CRM já carimbada com o id sintético, `sender_type='user'`. */
function linhaDoCrm(over: Partial<LinhaFake> = {}): LinhaFake {
  return {
    id: 'crm-1',
    conversation_id: CONVERSA,
    direction: 'outbound',
    content_type: 'text',
    external_id: 'gptmaker:3E14B10711E1C0FE16B42EC23:1757957444030',
    content: { type: 'text', text: TEXTO },
    created_at: ENVIO_EM,
    metadata: {},
    sender_type: 'user',
    sender_user_id: 'f1l1pe-0000-0000-0000-000000000000',
    sent_at: ENVIO_EM,
    status: 'sent',
    ...over,
  };
}

function entradaDoEco(over: Partial<Parameters<typeof casarEcoComMensagemEnviada>[1]> = {}) {
  return {
    conversationId: CONVERSA,
    contentType: 'text',
    content: { type: 'text', text: TEXTO },
    ecoTimestamp: ECO_EM,
    externalMessageId: ID_REAL,
    chatId: CHAT_ID,
    ...over,
  };
}

// =============================================================================
// AC7 — os 8 testes
// =============================================================================

describe('casarEcoComMensagemEnviada — AC7', () => {
  it('1) texto: eco dentro da janela carimba a linha do CRM, sem inserir e sem perder o autor', async () => {
    const { client, escritas, linhas } = criarClienteFake([linhaDoCrm()]);

    const resultado = await casarEcoComMensagemEnviada(client, entradaDoEco());

    expect(resultado).toEqual({ casou: true, messageId: 'crm-1' });
    expect(escritas).toHaveLength(1);

    // O que o UPDATE escreveu.
    const values = escritas[0].values;
    expect(values.external_id).toBe(ID_REAL);
    expect(values.status).toBe('sent');
    expect((values.metadata as Record<string, unknown>).gptmaker_message_id).toBe(ID_REAL);
    expect((values.metadata as Record<string, unknown>).source).toBe('gptmaker');

    // O que ele NÃO pode ter tocado (AC2 item 7).
    for (const proibido of [
      'content',
      'content_type',
      'sender_type',
      'sender_user_id',
      'created_at',
      'sent_at',
    ]) {
      expect(values).not.toHaveProperty(proibido);
    }

    // E o estado final da linha prova: autor e posição na conversa preservados.
    expect(linhas[0].sender_type).toBe('user');
    expect(linhas[0].created_at).toBe(ENVIO_EM);
    expect(linhas[0].content).toEqual({ type: 'text', text: TEXTO });
  });

  it('2) outbound legítima sem par (IA ou painel) não casa — o chamador insere', async () => {
    const { client, escritas } = criarClienteFake([linhaDoCrm()]);

    const resultado = await casarEcoComMensagemEnviada(
      client,
      entradaDoEco({
        content: { type: 'text', text: 'Claro! Posso te explicar como funciona.' },
      })
    );

    expect(resultado).toEqual({ casou: false, motivo: 'conteudo-diferente' });
    expect(escritas).toHaveLength(0);
  });

  it('3) eco fora da janela de 30 s não casa — prefere duplicar a engolir', async () => {
    const foraDaJanela = new Date(
      Date.parse(ENVIO_EM) + ECHO_MATCH_WINDOW_MS + 1_000
    );
    const { client, escritas } = criarClienteFake([linhaDoCrm()]);

    const resultado = await casarEcoComMensagemEnviada(
      client,
      entradaDoEco({ ecoTimestamp: foraDaJanela })
    );

    expect(resultado).toEqual({ casou: false, motivo: 'sem-candidata' });
    expect(escritas).toHaveLength(0);
  });

  it('4) dois textos idênticos seguidos: cada eco carimba a SUA linha (FIFO)', async () => {
    const segundoEnvio = new Date(Date.parse(ENVIO_EM) + 2_000).toISOString();
    const { client, escritas, linhas } = criarClienteFake([
      linhaDoCrm(),
      linhaDoCrm({
        id: 'crm-2',
        created_at: segundoEnvio,
        sent_at: segundoEnvio,
        external_id: 'gptmaker:3E14B10711E1C0FE16B42EC23:1757957446030',
      }),
    ]);

    const primeiro = await casarEcoComMensagemEnviada(client, entradaDoEco());
    const segundo = await casarEcoComMensagemEnviada(
      client,
      entradaDoEco({
        externalMessageId: 'AAAA1111BBBB2222CCCC3333DDDD4444',
        ecoTimestamp: new Date(Date.parse(ENVIO_EM) + 3_500),
      })
    );

    // FIFO: o primeiro eco pega a mais antiga; o segundo, a seguinte.
    expect(primeiro).toEqual({ casou: true, messageId: 'crm-1' });
    expect(segundo).toEqual({ casou: true, messageId: 'crm-2' });
    expect(escritas.map((e) => e.id)).toEqual(['crm-1', 'crm-2']);
    expect(linhas[0].external_id).toBe(ID_REAL);
    expect(linhas[1].external_id).toBe('AAAA1111BBBB2222CCCC3333DDDD4444');
  });

  it('5) inbound não é candidata — nada nesta story toca o caminho de entrada', async () => {
    const { client, escritas } = criarClienteFake([
      linhaDoCrm({ id: 'lead-1', direction: 'inbound', external_id: null }),
    ]);

    const resultado = await casarEcoComMensagemEnviada(client, entradaDoEco());

    expect(resultado).toEqual({ casou: false, motivo: 'sem-candidata' });
    expect(escritas).toHaveLength(0);
  });

  it('6) caso difícil do AC3: texto IDÊNTICO ao do CRM, porém fora da janela ⇒ não casa', async () => {
    // Alguém no painel do GPT Maker repetiu, horas depois, a mesma frase que o
    // CRM mandou. É mensagem real e precisa entrar.
    const horasDepois = new Date(Date.parse(ENVIO_EM) + 3 * 60 * 60 * 1000);
    const { client, escritas } = criarClienteFake([linhaDoCrm()]);

    const resultado = await casarEcoComMensagemEnviada(
      client,
      entradaDoEco({ ecoTimestamp: horasDepois })
    );

    expect(resultado).toEqual({ casou: false, motivo: 'sem-candidata' });
    expect(escritas).toHaveLength(0);
  });

  it('7) mídia: eco de áudio com URL DIFERENTE casa pelo content_type, sem trocar o conteúdo', async () => {
    const urlDoCrm = 'https://crm.acreditando.app/storage/audio/9f2c.ogg';
    const { client, escritas, linhas } = criarClienteFake([
      linhaDoCrm({
        content_type: 'audio',
        content: { type: 'audio', mediaUrl: urlDoCrm },
      }),
    ]);

    const resultado = await casarEcoComMensagemEnviada(
      client,
      entradaDoEco({
        contentType: 'audio',
        content: {
          type: 'audio',
          mediaUrl: 'https://gpt-files.com/file/3E14B107/3F69B238F978E068.ogg',
        },
      })
    );

    expect(resultado).toEqual({ casou: true, messageId: 'crm-1' });
    expect(escritas[0].values).not.toHaveProperty('content');
    // A URL que fica é a do CRM — a do provedor pode ter vida curta.
    expect(linhas[0].content).toEqual({ type: 'audio', mediaUrl: urlDoCrm });
  });

  it('8) candidata ainda `pending` (external_id NULL) é elegível e é carimbada', async () => {
    const { client, escritas, linhas } = criarClienteFake([
      linhaDoCrm({ external_id: null, status: 'pending', sent_at: null }),
    ]);

    const resultado = await casarEcoComMensagemEnviada(client, entradaDoEco());

    expect(resultado).toEqual({ casou: true, messageId: 'crm-1' });
    expect(escritas).toHaveLength(1);
    expect(linhas[0].external_id).toBe(ID_REAL);
    expect(linhas[0].sender_type).toBe('user');
  });
});

// =============================================================================
// Atomicidade — AC2 item 5
// =============================================================================

describe('casarEcoComMensagemEnviada — escrita condicional', () => {
  it('não carimba linha que outro eco carimbou no meio do caminho', async () => {
    const segundoEnvio = new Date(Date.parse(ENVIO_EM) + 1_000).toISOString();
    const fake = criarClienteFake([
      linhaDoCrm(),
      linhaDoCrm({ id: 'crm-2', created_at: segundoEnvio, sent_at: segundoEnvio }),
    ]);

    // Simula a corrida: entre o SELECT e o UPDATE, outra invocação carimbou a
    // candidata mais antiga com um id real.
    const selectOriginal = fake.client.from;
    let jaLeu = false;
    (fake.client as { from: EchoMatchClient['from'] }).from = (tabela: string) => {
      const real = selectOriginal.call(fake.client, tabela);
      return {
        ...real,
        select: (cols: string) => {
          const q = real.select(cols);
          const limitOriginal = q.limit.bind(q);
          q.limit = async (n: number) => {
            const r = await limitOriginal(n);
            if (!jaLeu) {
              jaLeu = true;
              fake.linhas[0].external_id = 'ID-REAL-DE-OUTRO-ECO';
            }
            return r;
          };
          return q;
        },
      };
    };

    const resultado = await casarEcoComMensagemEnviada(fake.client, entradaDoEco());

    // A primeira tentativa é barrada pela condição do UPDATE; a segunda pega.
    expect(fake.tentativas).toEqual([
      { id: 'crm-1', aplicou: false },
      { id: 'crm-2', aplicou: true },
    ]);
    expect(resultado).toEqual({ casou: true, messageId: 'crm-2' });
    expect(fake.linhas[0].external_id).toBe('ID-REAL-DE-OUTRO-ECO');
  });

  it('erro de banco na leitura devolve não-casou — o webhook insere e nada se perde', async () => {
    const client = {
      from() {
        return {
          select() {
            const b = {
              eq: () => b,
              in: () => b,
              gte: () => b,
              lte: () => b,
              or: () => b,
              order: () => b,
              limit: async () => ({ data: null, error: { message: 'timeout' } }),
            };
            return b;
          },
          update() {
            throw new Error('nao deveria escrever apos erro de leitura');
          },
        };
      },
    } as unknown as EchoMatchClient;

    const resultado = await casarEcoComMensagemEnviada(client, entradaDoEco());
    expect(resultado).toEqual({ casou: false, motivo: 'erro' });
  });
});

// =============================================================================
// Gate do @qa (20/09) — o furo achado e os limites aceitos
// =============================================================================

describe('casarEcoComMensagemEnviada — bordas do gate do @qa', () => {
  it('D-1: linha de envio que FALHOU não é candidata, mesmo com external_id NULL', async () => {
    // A rota grava `status='failed'` SEM external_id (`route.ts:190`). Sem este
    // filtro, um áudio legítimo do painel carimbaria a linha que nunca saiu: a
    // mensagem real sumiria e uma mensagem não enviada constaria como `sent`.
    const { client, escritas, linhas } = criarClienteFake([
      linhaDoCrm({
        content_type: 'audio',
        content: { type: 'audio', mediaUrl: 'https://crm.acreditando.app/storage/a.ogg' },
        external_id: null,
        status: 'failed',
        sent_at: null,
      }),
    ]);

    const resultado = await casarEcoComMensagemEnviada(
      client,
      entradaDoEco({
        contentType: 'audio',
        content: { type: 'audio', mediaUrl: 'https://gpt-files.com/file/3E14B107/xyz.ogg' },
      })
    );

    expect(resultado).toEqual({ casou: false, motivo: 'sem-candidata' });
    expect(escritas).toHaveLength(0);
    // A linha falha continua falha — não foi promovida a `sent`.
    expect(linhas[0].status).toBe('failed');
    expect(linhas[0].external_id).toBeNull();
  });

  it('D-1: status que viram `failed` entre o SELECT e o UPDATE são barrados pela escrita', async () => {
    const fake = criarClienteFake([linhaDoCrm()]);

    const fromOriginal = fake.client.from;
    let jaLeu = false;
    (fake.client as { from: EchoMatchClient['from'] }).from = (tabela: string) => {
      const real = fromOriginal.call(fake.client, tabela);
      return {
        ...real,
        select: (cols: string) => {
          const q = real.select(cols);
          const limitOriginal = q.limit.bind(q);
          q.limit = async (n: number) => {
            const r = await limitOriginal(n);
            if (!jaLeu) {
              jaLeu = true;
              // O `after()` do envio concluiu com falha depois da nossa leitura.
              fake.linhas[0].status = 'failed';
            }
            return r;
          };
          return q;
        },
      };
    };

    const resultado = await casarEcoComMensagemEnviada(fake.client, entradaDoEco());

    expect(fake.tentativas).toEqual([{ id: 'crm-1', aplicou: false }]);
    expect(resultado).toEqual({ casou: false, motivo: 'corrida' });
    expect(fake.linhas[0].status).toBe('failed');
  });

  it('D-3: carimbo inválido não lança — devolve não-casou e o webhook insere', async () => {
    const { client, escritas } = criarClienteFake([linhaDoCrm()]);

    const resultado = await casarEcoComMensagemEnviada(
      client,
      entradaDoEco({ ecoTimestamp: new Date('data-que-nao-existe') })
    );

    expect(resultado).toEqual({ casou: false, motivo: 'erro' });
    expect(escritas).toHaveLength(0);
  });

  it('D-4: LIMITE ACEITO — áudio legítimo do painel dentro da janela casa com a linha do CRM', async () => {
    // ⚠️ Este teste documenta um limite CONHECIDO E ACEITO, não um acerto.
    //
    // Em mídia não há conteúdo comparável: a URL do eco difere da URL que o CRM
    // gravou (medido par a par em 6 pares de áudio de 16–17/09). Então um áudio
    // REAL do painel, na mesma conversa, dentro de 30 s de um áudio enviado pelo
    // CRM, é indistinguível do eco — e é engolido.
    //
    // É o preço de consertar os 18% de mídia: a alternativa (casar só por
    // conteúdo) deixaria o defeito vivo em 100% da mídia, com cara de resolvido.
    // Dois áudios na mesma conversa em 30 s, um do CRM e outro do painel, não
    // apareceram nenhuma vez nos 346 pares medidos. Se aparecer em produção, o
    // sintoma é "o áudio que mandei pelo painel não apareceu no CRM" — e aí o
    // caminho é a opção C da D1 (carimbar o id real na hora do envio), não
    // apertar a janela.
    const { client, escritas, linhas } = criarClienteFake([
      linhaDoCrm({
        content_type: 'audio',
        content: { type: 'audio', mediaUrl: 'https://crm.acreditando.app/storage/a.ogg' },
      }),
    ]);

    const resultado = await casarEcoComMensagemEnviada(
      client,
      entradaDoEco({
        contentType: 'audio',
        content: { type: 'audio', mediaUrl: 'https://gpt-files.com/file/3E14B107/outro.ogg' },
      })
    );

    // Comportamento ATUAL — propositalmente não alterado por esta correção.
    expect(resultado).toEqual({ casou: true, messageId: 'crm-1' });
    expect(escritas).toHaveLength(1);
    expect(linhas[0].content).toEqual({
      type: 'audio',
      mediaUrl: 'https://crm.acreditando.app/storage/a.ogg',
    });
  });
});
