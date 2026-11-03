/**
 * Story 2.63 — o mesmo telefone com e sem o 9º dígito.
 *
 * AC1: a regra do webhook (`nono-digito.ts`) é a MESMA de
 * `lib/meta-form/telefone.ts`. A Edge Function não pode importar `lib/` (alias
 * do Next que o Deno não resolve), então a garantia é este teste de PARIDADE:
 * a mesma tabela roda contra as duas implementações e quebra se divergirem.
 *
 * AC3: alinhar a chave da conversa — o teste relê a linha e afirma o VALOR.
 *
 * ⚠️ Todos os telefones aqui são fictícios (o repositório é público).
 */

import { describe, it, expect } from 'vitest';
import { variantesDoTelefone } from '@/lib/meta-form/telefone';
import { formasDoTelefone, outrasFormas, mascararTelefone } from './nono-digito';
import { alinharChaveDaConversa, type ChaveConversaClient } from './chave-da-conversa';

const CEL_13 = '+5511987654321'; // celular com o 9
const CEL_12 = '+551187654321'; // o mesmo, sem o 9
const CEL_12_SEIS = '+551167654321'; // assinante começando com 6
const CEL_13_SEIS = '+5511967654321';
const FIXO = '+551132215555'; // assinante começando com 3
const ESTRANGEIRO = '+14155552671';

/**
 * A tabela de casos (R2 do @po: "1º dígito" é o do ASSINANTE, depois do DDD).
 * `esperado` é a lista de formas, a canônica (com o 9) primeiro.
 */
const CASOS: Array<{ nome: string; entrada: string | null; esperado: string[] }> = [
  { nome: '13 dígitos com o 9 ⇒ [13, 12]', entrada: CEL_13, esperado: [CEL_13, CEL_12] },
  { nome: '12 dígitos, assinante começando com 8 ⇒ [13, 12]', entrada: CEL_12, esperado: [CEL_13, CEL_12] },
  { nome: '12 dígitos, assinante começando com 6 ⇒ [13, 12]', entrada: CEL_12_SEIS, esperado: [CEL_13_SEIS, CEL_12_SEIS] },
  { nome: 'fixo (assinante 2–5) ⇒ só ele', entrada: FIXO, esperado: [FIXO] },
  // QA-1 (03/11): `9` seguido de 2–5 ⇒ só ele mesmo, sem variante (sem o 9
  // viraria número com cara de fixo — outra pessoa).
  { nome: '9 + 2 ⇒ só ele, sem variante (QA-1)', entrada: '+5511923456789', esperado: ['+5511923456789'] },
  { nome: '9 + 5 ⇒ só ele, sem variante (QA-1)', entrada: '+5511953456789', esperado: ['+5511953456789'] },
  { nome: '9 + 6 ⇒ [13, 12]', entrada: CEL_13_SEIS, esperado: [CEL_13_SEIS, CEL_12_SEIS] },
  { nome: 'estrangeiro ⇒ só ele', entrada: ESTRANGEIRO, esperado: [ESTRANGEIRO] },
  { nome: 'vazio ⇒ nenhuma', entrada: '', esperado: [] },
  { nome: 'null ⇒ nenhuma', entrada: null, esperado: [] },
  { nome: '@lid ⇒ nenhuma', entrada: '123456789012345@lid', esperado: [] },
  { nome: 'lixo ⇒ nenhuma', entrada: 'abc', esperado: [] },
];

describe('2.63 AC1 — a regra de variantes, igual nos dois lados', () => {
  for (const caso of CASOS) {
    it(`webhook: ${caso.nome}`, () => {
      expect(formasDoTelefone(caso.entrada)).toEqual(caso.esperado);
    });

    it(`paridade com lib/meta-form/telefone: ${caso.nome}`, () => {
      const daLib = variantesDoTelefone(caso.entrada)?.variantes ?? [];
      // Primeiro a lib contra a tabela (se a lib mudar, a tabela denuncia)…
      expect(daLib).toEqual(caso.esperado);
      // …e as duas implementações entre si.
      expect(formasDoTelefone(caso.entrada)).toEqual(daLib);
    });
  }

  it('outrasFormas devolve só a OUTRA forma, nunca a que chegou', () => {
    expect(outrasFormas(CEL_13)).toEqual([CEL_12]);
    expect(outrasFormas(CEL_12)).toEqual([CEL_13]);
    expect(outrasFormas(FIXO)).toEqual([]);
    expect(outrasFormas('+5511933456789')).toEqual([]); // QA-1
    expect(outrasFormas(ESTRANGEIRO)).toEqual([]);
    expect(outrasFormas('123456789012345@lid')).toEqual([]);
  });
});

describe('2.63 AC7 — telefone mascarado no log', () => {
  it('mantém os 4 primeiros e os 4 últimos dígitos', () => {
    expect(mascararTelefone(CEL_13)).toBe('5511*****4321');
    expect(mascararTelefone(CEL_12)).toBe('5511****4321');
  });
});

// =============================================================================
// AC3 — alinhar a chave da conversa
// =============================================================================

interface ConversaFake {
  id: string;
  channel_id: string;
  external_contact_id: string;
  metadata: Record<string, unknown>;
}

/** Duplo que aplica os filtros e a UNIQUE (channel_id, external_contact_id) de verdade. */
function criarCliente(linhas: ConversaFake[], falhar: 'select' | 'update' | null = null) {
  const client = {
    from() {
      return {
        select() {
          return {
            eq(_c: string, id: unknown) {
              return {
                async maybeSingle() {
                  if (falhar === 'select') return { data: null, error: { message: 'fora do ar' } };
                  const l = linhas.find((x) => x.id === id);
                  return { data: l ? { metadata: l.metadata } : null, error: null };
                },
              };
            },
          };
        },
        update(values: Record<string, unknown>) {
          const filtros: Array<[string, unknown]> = [];
          const q = {
            eq(col: string, val: unknown) {
              filtros.push([col, val]);
              return q;
            },
            async select() {
              if (falhar === 'update') return { data: null, error: { message: 'fora do ar' } };
              const alvo = linhas.filter((l) =>
                filtros.every(([c, v]) => (l as unknown as Record<string, unknown>)[c] === v)
              );
              const nova = values.external_contact_id as string;
              for (const l of alvo) {
                const conflito = linhas.some(
                  (o) => o.id !== l.id && o.channel_id === l.channel_id && o.external_contact_id === nova
                );
                if (conflito) {
                  return { data: null, error: { code: '23505', message: 'duplicate key value' } };
                }
              }
              for (const l of alvo) {
                l.external_contact_id = nova;
                l.metadata = values.metadata as Record<string, unknown>;
              }
              return { data: alvo.map((l) => ({ id: l.id })), error: null };
            },
          };
          return q;
        },
      };
    },
  } as unknown as ChaveConversaClient;
  return client;
}

const CANAL = 'canal-1';
const CHAVE_13 = `PFX-${CEL_13.slice(1)}`;
const CHAVE_12 = `PFX-${CEL_12.slice(1)}`;

describe('2.63 AC3 — casou pela variante ⇒ a chave passa a ser a do fornecedor', () => {
  it('relê a linha: chave nova gravada, a anterior guardada no metadata', async () => {
    const linhas: ConversaFake[] = [
      { id: 'conv-1', channel_id: CANAL, external_contact_id: CHAVE_13, metadata: { gptmaker_chat_id: CHAVE_13, source: 'gptmaker' } },
    ];

    const r = await alinharChaveDaConversa(
      criarCliente(linhas),
      { conversationId: 'conv-1', chaveNova: CHAVE_12, chaveAnterior: CHAVE_13 },
      () => {},
      '2026-11-03T12:00:00.000Z'
    );

    expect(r).toBe('alinhada');
    const relida = linhas.find((l) => l.id === 'conv-1')!;
    expect(relida.external_contact_id).toBe(CHAVE_12);
    expect(relida.metadata.gptmaker_chat_id).toBe(CHAVE_12);
    expect(relida.metadata.chave_anterior).toBe(CHAVE_13);
    expect(relida.metadata.chave_alinhada_em).toBe('2026-11-03T12:00:00.000Z');
    // O resto do metadata não se perde.
    expect(relida.metadata.source).toBe('gptmaker');
  });

  it('chave nova já pertence a OUTRA conversa ⇒ não troca e não lança', async () => {
    const linhas: ConversaFake[] = [
      { id: 'conv-1', channel_id: CANAL, external_contact_id: CHAVE_13, metadata: {} },
      { id: 'conv-2', channel_id: CANAL, external_contact_id: CHAVE_12, metadata: {} },
    ];
    const logs: string[] = [];

    const r = await alinharChaveDaConversa(
      criarCliente(linhas),
      { conversationId: 'conv-1', chaveNova: CHAVE_12, chaveAnterior: CHAVE_13 },
      (m) => logs.push(m)
    );

    expect(r).toBe('ocupada');
    expect(linhas[0].external_contact_id).toBe(CHAVE_13);
    expect(linhas[0].metadata.chave_anterior).toBeUndefined();
    expect(linhas[1].external_contact_id).toBe(CHAVE_12);
    expect(logs.some((m) => m.includes('já pertence a outra conversa'))).toBe(true);
  });

  it('já alinhada por outra entrega (0 linhas) ⇒ "nada-a-fazer", sem sobrescrever', async () => {
    const linhas: ConversaFake[] = [
      { id: 'conv-1', channel_id: CANAL, external_contact_id: CHAVE_12, metadata: { chave_anterior: CHAVE_13 } },
    ];

    const r = await alinharChaveDaConversa(criarCliente(linhas), {
      conversationId: 'conv-1',
      chaveNova: CHAVE_12,
      chaveAnterior: CHAVE_13,
    });

    expect(r).toBe('nada-a-fazer');
    expect(linhas[0].external_contact_id).toBe(CHAVE_12);
  });

  it('falha de banco não lança', async () => {
    const linhas: ConversaFake[] = [
      { id: 'conv-1', channel_id: CANAL, external_contact_id: CHAVE_13, metadata: {} },
    ];

    await expect(
      alinharChaveDaConversa(criarCliente(linhas, 'update'), {
        conversationId: 'conv-1',
        chaveNova: CHAVE_12,
        chaveAnterior: CHAVE_13,
      })
    ).resolves.toBe('falhou');
    expect(linhas[0].external_contact_id).toBe(CHAVE_13);
  });
});
