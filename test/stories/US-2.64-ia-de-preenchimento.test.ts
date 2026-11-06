/**
 * Story 2.64 — AC18 (E1): a IA de preenchimento ignora os 4 campos da loja.
 *
 * Os dois caminhos do Next.js que gravam campo por IA:
 *   1. `extractAndUpdateCustomFields` (IA interna) — as 4 chaves saem das
 *      definições ANTES do schema ⇒ não vão ao modelo nem são gravadas;
 *   2. `applyAiExtraction` (porta do n8n, 2.49) — chave da lista vai para
 *      `skipped` com `chave_reservada`, sem derrubar o lote.
 *
 * O banco é o `FakeSupabase` (em memória); o modelo é simulado. Tudo é provado
 * RELENDO o card.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from '@/test/helpers/fakeSupabase';

const ORG = '83160646-16a0-4cb7-9067-7ce7ef34ff50';
const DEAL = '11111111-2222-4333-8444-555555555555';
const CONVERSA = '99999999-2222-4333-8444-555555555555';

let db: FakeSupabase;
const modelo = {
  chamadas: [] as Array<{ schema: any; prompt: string }>,
  saida: {} as Record<string, unknown>,
};

vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => db }));
vi.mock('@/lib/ai/agent/agent.service', () => ({
  getOrgAIConfig: vi.fn(async () => ({ enabled: true, provider: 'google', apiKey: 'chave-de-teste', model: 'modelo-de-teste' })),
}));
vi.mock('@/lib/ai/config', () => ({ getModel: vi.fn(() => ({})) }));
vi.mock('@/lib/ai/token-log', () => ({ logAiTokens: vi.fn(async () => undefined) }));
vi.mock('@/lib/deals/moveOnQualified', () => ({ moveDealIfQualified: vi.fn(async () => undefined) }));
vi.mock('ai', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    generateText: vi.fn(async (args: any) => {
      modelo.chamadas.push({ schema: args.output, prompt: args.prompt });
      return { output: modelo.saida, usage: { totalTokens: 10 } };
    }),
    Output: { object: (o: any) => o },
  };
});

import { extractAndUpdateCustomFields } from '@/lib/ai/extraction/customFields.service';
import { CHAVES_FORA_DA_EXTRACAO_POR_IA } from '@/lib/ai/extraction/customFields.schemas';
import { applyAiExtraction } from '@/lib/public-api/aiExtraction';
import { CAMPO_AVISO_EM, CAMPO_AVISO_VERSAO, CAMPO_PARA_QUEM, CAMPO_PRODUTO } from '@/lib/instituto/catalogo';

/** As 11 definições lidas de produção em 05/11 (pipeline 37) + as 4 da 2.64. */
const ONZE_DE_HOJE = [
  'paraQuemE', 'tipoDeLesao', 'haQuantoTempo', 'jaFezReabilitacao', 'ondeReside',
  'faixaDeInvestimentoMensal', 'metaAnuncio', 'metaCampanha', 'metaLeadgenId', 'origemDoLead', 'quandoPretendeIniciar',
];
const QUATRO_DA_LOJA = ['produtoDeTreinamento', 'paraQuemEOProduto', 'consentimentoEm', 'consentimentoVersao'];

function definicoes() {
  return [...ONZE_DE_HOJE, ...QUATRO_DA_LOJA].map((key, i) => ({
    id: `def-${i}`,
    key,
    label: key,
    type: key === 'produtoDeTreinamento' ? 'select' : 'text',
    options: key === 'produtoDeTreinamento' ? ['Luvas inclusivas'] : null,
    entity_type: 'deal',
    organization_id: ORG,
    created_at: `2026-07-27T00:00:${String(i).padStart(2, '0')}Z`,
  }));
}

beforeEach(() => {
  db = new FakeSupabase();
  db.tabelas.custom_field_definitions = definicoes();
  db.tabelas.deals.push({
    id: DEAL,
    organization_id: ORG,
    custom_fields: {},
    ai_extracted: {},
    deleted_at: null,
  });
  db.tabelas.messaging_messages = [
    { id: 'm1', conversation_id: CONVERSA, direction: 'inbound', content: { text: 'Quero luvas inclusivas para a minha mãe' }, content_type: 'text', created_at: '2026-11-05T10:00:00Z', sent_at: null },
    { id: 'm2', conversation_id: CONVERSA, direction: 'outbound', content: { text: 'Certo! Ela tem lesão medular?' }, content_type: 'text', created_at: '2026-11-05T10:01:00Z', sent_at: null },
  ];
  modelo.chamadas = [];
  modelo.saida = {};
});

describe('2.64 AC18 — a lista é uma só e exata', () => {
  it('são exatamente as 4 chaves da loja (as mesmas do catálogo da rota) e NÃO pega paraQuemE por prefixo', () => {
    expect([...CHAVES_FORA_DA_EXTRACAO_POR_IA]).toEqual([CAMPO_PRODUTO, CAMPO_PARA_QUEM, CAMPO_AVISO_EM, CAMPO_AVISO_VERSAO]);
    expect([...CHAVES_FORA_DA_EXTRACAO_POR_IA].sort()).toEqual([...QUATRO_DA_LOJA].sort());
    expect(CHAVES_FORA_DA_EXTRACAO_POR_IA).not.toContain('paraQuemE');
  });
});

describe('2.64 AC18 — IA interna (extractAndUpdateCustomFields)', () => {
  it('o schema enviado ao modelo tem EXATAMENTE as 11 chaves de hoje (paraQuemE incluída)', async () => {
    modelo.saida = { tipoDeLesao: { value: 'Lesão medular', confidence: 0.9, reasoning: 'disse' } };
    const r = await extractAndUpdateCustomFields({ supabase: db as any, dealId: DEAL, conversationId: CONVERSA, organizationId: ORG });
    expect(r.success).toBe(true);
    expect(modelo.chamadas).toHaveLength(1);
    const chaves = Object.keys(modelo.chamadas[0].schema.schema.shape).sort();
    expect(chaves).toEqual([...ONZE_DE_HOJE].sort());
    for (const k of QUATRO_DA_LOJA) expect(modelo.chamadas[0].prompt).not.toContain(`- ${k}:`);
  });

  it('mesmo com o modelo devolvendo produtoDeTreinamento e consentimentoEm, o card relido NÃO tem essas chaves', async () => {
    modelo.saida = {
      paraQuemE: { value: 'Para a mãe', confidence: 0.95, reasoning: 'disse' },
      produtoDeTreinamento: { value: 'Luvas inclusivas', confidence: 0.99, reasoning: 'disse' },
      consentimentoEm: { value: '2026-11-05T10:00:00-03:00', confidence: 0.99, reasoning: 'inventado' },
    };
    const r = await extractAndUpdateCustomFields({ supabase: db as any, dealId: DEAL, conversationId: CONVERSA, organizationId: ORG });
    expect(r.updated).toEqual(['paraQuemE']);
    const relido = db.tabelas.deals.find((d) => d.id === DEAL)!;
    expect(relido.custom_fields).toEqual({ paraQuemE: 'Para a mãe' });
    for (const k of QUATRO_DA_LOJA) {
      expect(relido.custom_fields[k]).toBeUndefined();
      expect(relido.ai_extracted.customFields?.[k]).toBeUndefined();
    }
    for (const w of db.escritas.filter((e) => e.tabela === 'deals')) {
      for (const k of QUATRO_DA_LOJA) expect(JSON.stringify(w.payload)).not.toContain(`"${k}"`);
    }
  });
});

describe('2.64 AC18 — porta do n8n (applyAiExtraction)', () => {
  it('paraQuemE + consentimentoEm ⇒ updated = [paraQuemE]; consentimentoEm em skipped com chave_reservada; relido sem a chave', async () => {
    const r = await applyAiExtraction({
      organizationId: ORG,
      dealId: DEAL,
      input: { custom_fields: { paraQuemE: 'Para o pai', consentimentoEm: '2026-11-05T10:00:00-03:00' } } as any,
    });
    expect(r.status).toBe(200);
    expect((r.body as any).data.custom_fields.updated).toEqual(['paraQuemE']);
    expect((r.body as any).data.custom_fields.skipped).toContainEqual({ key: 'consentimentoEm', reason: 'chave_reservada' });
    const relido = db.tabelas.deals.find((d) => d.id === DEAL)!;
    expect(relido.custom_fields).toEqual({ paraQuemE: 'Para o pai' });
    expect(relido.custom_fields.consentimentoEm).toBeUndefined();
  });

  it.each(QUATRO_DA_LOJA)('%s sozinho ⇒ nada gravado, skipped chave_reservada (mesmo com overwrite)', async (k) => {
    const r = await applyAiExtraction({
      organizationId: ORG,
      dealId: DEAL,
      input: { custom_fields: { [k]: k === 'produtoDeTreinamento' ? 'Luvas inclusivas' : 'x' }, overwrite: true } as any,
    });
    expect((r.body as any).data.custom_fields.updated).toEqual([]);
    expect((r.body as any).data.custom_fields.skipped).toEqual([{ key: k, reason: 'chave_reservada' }]);
    expect(db.tabelas.deals.find((d) => d.id === DEAL)!.custom_fields).toEqual({});
  });
});
