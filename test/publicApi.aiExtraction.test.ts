/**
 * Story 2.49 — a porta que o n8n usa.
 *
 * `POST /api/public/v1/deals/{dealId}/ai-extraction` recebe campos e nota JÁ
 * extraídos por um sistema externo. Estes testes exercitam as regras de
 * gravação sem HTTP (AC16): a lógica vive em `lib/public-api/aiExtraction.ts`
 * e é ela que precisa estar certa.
 *
 * Estratégia de mock: Supabase inteiro mockado. Nenhuma chamada real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const DEAL_ID = 'e5f6a7b8-c9d0-4e1f-8a2b-c3d4e5f6a7b8';

/** Estado do "banco" que os mocks devolvem — reescrito por teste. */
const estado = {
  deal: null as Record<string, unknown> | null,
  definicoes: [] as Array<Record<string, unknown>>,
  /** Linhas devolvidas pelo `.select('id')` de cada UPDATE, na ordem. */
  updateSelects: [] as Array<Array<{ id: string }>>,
  /** Payloads capturados dos UPDATEs, para conferir o que foi gravado. */
  updates: [] as Array<Record<string, unknown>>,
  /** Filtros `.or(...)` usados, para provar o `is.null`. */
  ors: [] as string[],
};

function makeUpdateChain(payload: Record<string, unknown>) {
  estado.updates.push(payload);
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  chain.eq = passthrough;
  chain.or = (expr: string) => {
    estado.ors.push(expr);
    return chain;
  };
  chain.select = async () => ({
    data: estado.updateSelects.shift() ?? [{ id: DEAL_ID }],
    error: null,
  });
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: () => ({
      select: () => {
        const chain: Record<string, unknown> = {};
        const passthrough = () => chain;
        chain.eq = passthrough;
        chain.is = passthrough;
        chain.order = async () => ({ data: estado.definicoes, error: null });
        chain.maybeSingle = async () => ({ data: estado.deal, error: null });
        return chain;
      },
      update: (payload: Record<string, unknown>) => makeUpdateChain(payload),
    }),
  }),
}));

import {
  AiExtractionSchema,
  applyAiExtraction,
  N8N_SCORE_KNOWN,
  N8N_SCORE_SCALE,
} from '@/lib/public-api/aiExtraction';

const DEF_TEXTO = (key: string) => ({
  id: 'def-' + key,
  key,
  label: key,
  type: 'text',
  options: null,
});

function reset(
  deal: Record<string, unknown> | null = { id: DEAL_ID, custom_fields: {}, ai_extracted: {} }
) {
  estado.deal = deal;
  estado.definicoes = [
    DEF_TEXTO('tipoDeLesao'),
    DEF_TEXTO('haQuantoTempo'),
    DEF_TEXTO('jaFezReabilitacao'),
    DEF_TEXTO('paraQuemE'),
    DEF_TEXTO('ondeReside'),
  ];
  estado.updateSelects = [];
  estado.updates = [];
  estado.ors = [];
}

beforeEach(() => reset());

// ---------------------------------------------------------------------------
// AC4 — validação de entrada
// ---------------------------------------------------------------------------
describe('AiExtractionSchema (AC4)', () => {
  it('recusa corpo sem custom_fields e sem lead_score', () => {
    expect(AiExtractionSchema.safeParse({}).success).toBe(false);
  });

  it('recusa nota fora de 1..5', () => {
    expect(AiExtractionSchema.safeParse({ lead_score: { score: 0 } }).success).toBe(false);
    expect(AiExtractionSchema.safeParse({ lead_score: { score: 6 } }).success).toBe(false);
    expect(AiExtractionSchema.safeParse({ lead_score: { score: 3 } }).success).toBe(true);
  });

  it('recusa chave desconhecida no corpo (strict)', () => {
    expect(AiExtractionSchema.safeParse({ lead_score: { score: 3 }, xpto: 1 }).success).toBe(false);
  });

  it('aceita as duas formas de campo: string curta e objeto com confidence', () => {
    const r = AiExtractionSchema.safeParse({
      custom_fields: { tipoDeLesao: 'AVC', haQuantoTempo: { value: '8 meses', confidence: 0.9 } },
    });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC5 — deal ausente
// ---------------------------------------------------------------------------
describe('deal ausente (AC5)', () => {
  it('devolve 404 quando o deal não existe na organização', async () => {
    reset(null);
    const r = await applyAiExtraction({
      organizationId: ORG_ID,
      dealId: DEAL_ID,
      input: { lead_score: { score: 4 } },
    });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('NOT_FOUND');
  });

  it('devolve 422 quando o dealId não é UUID', async () => {
    const r = await applyAiExtraction({
      organizationId: ORG_ID,
      dealId: 'nao-e-uuid',
      input: { lead_score: { score: 4 } },
    });
    expect(r.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// AC6, AC7, AC9, AC10 — as razões de skipped e a proveniência
// ---------------------------------------------------------------------------
describe('campos personalizados', () => {
  it('AC6 — não sobrescreve campo já preenchido', async () => {
    reset({ id: DEAL_ID, custom_fields: { tipoDeLesao: 'Lesão medular' }, ai_extracted: {} });
    const r = await applyAiExtraction({
      organizationId: ORG_ID,
      dealId: DEAL_ID,
      input: { custom_fields: { tipoDeLesao: 'AVC' } },
    });
    const data = r.body.data as Record<string, any>;
    expect(data.custom_fields.updated).toEqual([]);
    expect(data.custom_fields.skipped).toEqual([
      { key: 'tipoDeLesao', reason: 'campo_ja_preenchido' },
    ]);
    expect(estado.updates).toHaveLength(0);
  });

  it('AC6 — overwrite:true sobrescreve', async () => {
    reset({ id: DEAL_ID, custom_fields: { tipoDeLesao: 'Lesão medular' }, ai_extracted: {} });
    const r = await applyAiExtraction({
      organizationId: ORG_ID,
      dealId: DEAL_ID,
      input: { custom_fields: { tipoDeLesao: 'AVC' }, overwrite: true },
    });
    const data = r.body.data as Record<string, any>;
    expect(data.custom_fields.updated).toEqual(['tipoDeLesao']);
  });

  it('AC6 — string em branco conta como vazio (isBlank)', async () => {
    reset({ id: DEAL_ID, custom_fields: { tipoDeLesao: '   ' }, ai_extracted: {} });
    const r = await applyAiExtraction({
      organizationId: ORG_ID,
      dealId: DEAL_ID,
      input: { custom_fields: { tipoDeLesao: 'AVC' } },
    });
    expect((r.body.data as any).custom_fields.updated).toEqual(['tipoDeLesao']);
  });

  it('AC7 — confiança abaixo de 0,6 é descartada; ausente conta como 1', async () => {
    const r = await applyAiExtraction({
      organizationId: ORG_ID,
      dealId: DEAL_ID,
      input: {
        custom_fields: {
          tipoDeLesao: { value: 'AVC', confidence: 0.4 },
          haQuantoTempo: '8 meses',
        },
      },
    });
    const data = r.body.data as Record<string, any>;
    expect(data.custom_fields.updated).toEqual(['haQuantoTempo']);
    expect(data.custom_fields.skipped).toEqual([
      { key: 'tipoDeLesao', reason: 'confianca_baixa' },
    ]);
  });

  it('AC9 — os 4 campos descartados viram chave_desconhecida, com 200, e a nota entra', async () => {
    const r = await applyAiExtraction({
      organizationId: ORG_ID,
      dealId: DEAL_ID,
      input: {
        custom_fields: {
          tipo_de_atendimento: 'Curso',
          onde_fez_reabilitacao: 'Clínica X',
          tipo_avalicao: 'Opção 1',
          resumo: 'lead quer avaliar',
          tipoDeLesao: 'AVC',
        },
        lead_score: { score: 4 },
      },
    });
    const data = r.body.data as Record<string, any>;
    expect(r.status).toBe(200);
    expect(data.custom_fields.updated).toEqual(['tipoDeLesao']);
    expect(data.custom_fields.skipped.map((s: any) => s.reason)).toEqual(
      Array(4).fill('chave_desconhecida')
    );
    expect(data.lead_score).toEqual({ applied: true });
  });

  it('AC10 — grava proveniência com source n8n e MESCLA ai_extracted (não apaga o resto)', async () => {
    reset({
      id: DEAL_ID,
      custom_fields: {},
      ai_extracted: { outraCoisa: 'preservar', customFields: { antigo: { value: 'x' } } },
    });
    await applyAiExtraction({
      organizationId: ORG_ID,
      dealId: DEAL_ID,
      input: { custom_fields: { tipoDeLesao: 'AVC' } },
    });
    const gravado = estado.updates[0] as any;
    expect(gravado.ai_extracted.outraCoisa).toBe('preservar');
    expect(gravado.ai_extracted.customFields.antigo).toEqual({ value: 'x' });
    expect(gravado.ai_extracted.customFields.tipoDeLesao).toMatchObject({
      value: 'AVC',
      reasoning: 'n8n',
      source: 'n8n',
      confidence: 1,
    });
  });

  it('valor null não vira skipped — é campo que não veio', async () => {
    const r = await applyAiExtraction({
      organizationId: ORG_ID,
      dealId: DEAL_ID,
      input: { custom_fields: { tipoDeLesao: null } },
    });
    const data = r.body.data as Record<string, any>;
    expect(data.custom_fields.skipped).toEqual([]);
    expect(data.custom_fields.updated).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC11, AC12, AC13, AC14 — a nota
// ---------------------------------------------------------------------------
describe('nota do n8n', () => {
  it('AC11 — a guarda usa is.null junto com neq (NULL != manual não é TRUE)', async () => {
    await applyAiExtraction({
      organizationId: ORG_ID,
      dealId: DEAL_ID,
      input: { lead_score: { score: 4 } },
    });
    expect(estado.ors).toContain('lead_score_source.is.null,lead_score_source.neq.manual');
  });

  it('AC12 — 0 linhas no read-back vira applied:false com motivo, e a request segue 200', async () => {
    estado.updateSelects = [[]];
    const r = await applyAiExtraction({
      organizationId: ORG_ID,
      dealId: DEAL_ID,
      input: { lead_score: { score: 4 } },
    });
    expect(r.status).toBe(200);
    expect((r.body.data as any).lead_score).toEqual({ applied: false, reason: 'nota_manual' });
  });

  it('AC13 e AC14 — grava carimbo, known=5, source n8n e a escala por extenso', async () => {
    await applyAiExtraction({
      organizationId: ORG_ID,
      dealId: DEAL_ID,
      input: {
        lead_score: { score: 4, rotulo: 'Quente', confianca: 0.82, red_flags: ['sem previsão'] },
      },
    });
    const gravado = estado.updates[0] as any;
    expect(gravado.lead_score).toBe(4);
    expect(gravado.lead_score_known).toBe(N8N_SCORE_KNOWN);
    expect(gravado.lead_score_source).toBe('n8n');
    expect(gravado.pontuada_pela_ia_em).toBeTruthy();
    expect(gravado.lead_score_detail.escala).toBe(N8N_SCORE_SCALE);
    expect(gravado.lead_score_detail.rotulo).toBe('Quente');
    expect(gravado.lead_score_detail.red_flags).toEqual(['sem previsão']);
  });

  it('campos e nota juntos: campos entram mesmo quando a nota é recusada', async () => {
    // 1o UPDATE (campos) grava; 2o UPDATE (nota) devolve 0 linhas = nota manual.
    estado.updateSelects = [[{ id: DEAL_ID }], []];
    const r = await applyAiExtraction({
      organizationId: ORG_ID,
      dealId: DEAL_ID,
      input: { custom_fields: { tipoDeLesao: 'AVC' }, lead_score: { score: 5 } },
    });
    const data = r.body.data as Record<string, any>;
    expect(data.custom_fields.updated).toEqual(['tipoDeLesao']);
    expect(data.lead_score).toEqual({ applied: false, reason: 'nota_manual' });
  });
});
