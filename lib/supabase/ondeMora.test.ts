/**
 * Story 2.67 — "Onde mora" (`deals.lead_location`) e observação da perda
 * (`deals.loss_note`). Sucede o `localDaPerda.test.ts` da 2.66.
 *
 * Travas que não precisam de banco:
 *   • AC1 — a migration (uma só para a 2.67 e a 2.68) é aditiva, idempotente e
 *     SEM coluna calculada guardada (C5: quebraria o `RESTAURAR.mjs`);
 *   • AC2 — a tradução banco ↔ tela nos dois sentidos, afirmando o VALOR; um
 *     update sem a chave não a leva; os campos calculados nunca são gravados;
 *   • R3 — a extração da IA não grava os campos novos;
 *   • a API pública de perda/ganho não toca nos campos novos (fora de escopo).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LIMITE_DEALS_DO_QUADRO, transformDeal, transformDealToDb, type DbDeal } from './deals';

const LINHA: DbDeal = {
  id: 'deal-1',
  organization_id: 'org-1',
  title: 'Maria Silva',
  value: 0,
  probability: 0,
  status: null,
  priority: 'medium',
  board_id: 'board-1',
  stage_id: 'stage-perdido',
  contact_id: 'contact-1',
  client_company_id: null,
  ai_summary: null,
  loss_reason: 'Lead sem interação',
  lead_location: 'Santana — depende de apoio',
  loss_note: 'não tem como vir sozinho',
  tags: [],
  last_stage_change_date: null,
  custom_fields: { ondeReside: 'Zona Leste' },
  created_at: '2026-11-03T10:00:00.000Z',
  updated_at: '2026-11-03T10:00:00.000Z',
} as unknown as DbDeal;

const CHAVES_PROIBIDAS_NO_UPDATE = ['loss_location', 'lead_location_busca', 'loss_reason_chave'];

describe('AC2 — banco → tela (transformDeal)', () => {
  it('`lead_location` e `loss_note` chegam como `leadLocation` e `lossNote`, com o texto dela', () => {
    const deal = transformDeal(LINHA);
    expect(deal.leadLocation).toBe('Santana — depende de apoio');
    expect(deal.lossNote).toBe('não tem como vir sozinho');
  });

  it('`null` vira `undefined` (não informado)', () => {
    const deal = transformDeal({ ...LINHA, lead_location: null, loss_note: null });
    expect(deal.leadLocation).toBeUndefined();
    expect(deal.lossNote).toBeUndefined();
  });

  it('não confunde com o `ondeReside` da IA', () => {
    const deal = transformDeal({ ...LINHA, lead_location: null });
    expect(deal.leadLocation).toBeUndefined();
    expect(deal.customFields?.ondeReside).toBe('Zona Leste');
  });

  it('🎯 os campos calculados NÃO são mapeados nem a coluna aposentada é lida', () => {
    const linhaComTudo = {
      ...LINHA,
      lead_location_busca: 'santana — depende de apoio',
      loss_reason_chave: 'lead sem interacao',
      loss_location: 'Manaus/AM',
    } as unknown as DbDeal;
    const deal = transformDeal(linhaComTudo) as unknown as Record<string, unknown>;
    expect(deal).not.toHaveProperty('leadLocationBusca');
    expect(deal).not.toHaveProperty('lossReasonChave');
    expect(deal).not.toHaveProperty('lossLocation');
    expect(deal.leadLocation).toBe('Santana — depende de apoio');
  });
});

describe('AC2 — tela → banco (transformDealToDb)', () => {
  it('grava o texto em `lead_location` e em `loss_note`', () => {
    expect(transformDealToDb({ leadLocation: 'Santana' })).toEqual({ lead_location: 'Santana' });
    expect(transformDealToDb({ lossNote: 'depende do filho' })).toEqual({ loss_note: 'depende do filho' });
  });

  it('texto vazio (e `null`) vira `null` — o "apagar de propósito"', () => {
    expect(transformDealToDb({ leadLocation: '' })).toEqual({ lead_location: null });
    expect(transformDealToDb({ lossNote: '' })).toEqual({ loss_note: null });
    expect(transformDealToDb({ lossNote: null })).toEqual({ loss_note: null });
  });

  it('🎯 update SEM as chaves não contém `lead_location` nem `loss_note`', () => {
    const db = transformDealToDb({ status: '3f1c2b9e-0000-4000-8000-000000000001', lossReason: 'Preço muito alto' });
    expect(db).not.toHaveProperty('lead_location');
    expect(db).not.toHaveProperty('loss_note');
  });

  it('🎯 nenhum update contém a coluna aposentada nem os campos calculados', () => {
    const db = transformDealToDb({
      leadLocation: 'Santana',
      lossNote: 'x',
      lossReason: 'Distância',
      isLost: true,
      ...({ lossLocation: 'Manaus/AM', leadLocationBusca: 'a', lossReasonChave: 'b' } as object),
    });
    for (const chave of CHAVES_PROIBIDAS_NO_UPDATE) expect(db).not.toHaveProperty(chave);
  });

  it('salvar o local pelo card manda SÓ `lead_location`', () => {
    expect(Object.keys(transformDealToDb({ leadLocation: 'Santana' }))).toEqual(['lead_location']);
  });
});

describe('AC5 — teto do quadro', () => {
  it('a constante é 1000, o mesmo número do aviso na tela', () => {
    expect(LIMITE_DEALS_DO_QUADRO).toBe(1000);
  });

  it('o `.limit` da carga do quadro usa a constante', () => {
    const fonte = readFileSync(join(process.cwd(), 'lib/supabase/deals.ts'), 'utf-8');
    expect(fonte).toContain('.limit(LIMITE_DEALS_DO_QUADRO)');
    expect(fonte).not.toMatch(/\.limit\(1000\)/);
  });
});

describe('AC1 — migration aditiva, idempotente e sem coluna calculada guardada', () => {
  const pasta = join(process.cwd(), 'supabase/migrations');
  const arquivo = readdirSync(pasta).find(n => /^20261103\d{6}_onde_mora_e_observacao_da_perda\.sql$/.test(n));

  it('o arquivo existe com timestamp de 03/11', () => {
    expect(arquivo).toBeDefined();
  });

  const sql = arquivo ? readFileSync(join(pasta, arquivo), 'utf-8') : '';
  // Só o que roda — sem os comentários de linha.
  const comandos = sql
    .split('\n')
    .filter(l => !l.trim().startsWith('--'))
    .join('\n');

  it('🎯 C5 — nenhuma ocorrência de GENERATED no arquivo (nem em comentário)', () => {
    expect(sql).not.toMatch(/GENERATED/i);
  });

  it('as 2 colunas com IF NOT EXISTS, tipo text, e só elas', () => {
    expect(comandos).toMatch(/ALTER TABLE public\.deals ADD COLUMN IF NOT EXISTS lead_location text;/);
    expect(comandos).toMatch(/ALTER TABLE public\.deals ADD COLUMN IF NOT EXISTS loss_note text;/);
    expect(comandos.match(/ADD COLUMN/g)).toHaveLength(2);
  });

  it('os dois CHECK (200 e 500) dentro do bloco DO, com IF NOT EXISTS', () => {
    const bloco = comandos.slice(comandos.indexOf('DO $$'), comandos.indexOf('END $$;'));
    expect(bloco).toContain("conname = 'deals_lead_location_tamanho'");
    expect(bloco).toContain("conname = 'deals_loss_note_tamanho'");
    expect(bloco).toMatch(/CHECK \(lead_location IS NULL OR char_length\(lead_location\) <= 200\)/);
    expect(bloco).toMatch(/CHECK \(loss_note IS NULL OR char_length\(loss_note\) <= 500\)/);
    expect(bloco.match(/IF NOT EXISTS/g)).toHaveLength(2);
  });

  it('as 3 funções com IMMUTABLE e SET search_path vazio; as de campo calculado recebem public.deals', () => {
    for (const nome of ['texto_de_busca\\(p_valor text\\)', 'lead_location_busca\\(d public\\.deals\\)', 'loss_reason_chave\\(d public\\.deals\\)']) {
      const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nome}\\s*RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE\\s*SET search_path = ''`);
      expect(comandos).toMatch(re);
    }
    expect(comandos.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(3);
  });

  it('as duas cadeias do translate têm o mesmo tamanho (48 letras)', () => {
    const m = comandos.match(/translate\(coalesce\(p_valor, ''\),\s*'([^']+)',\s*'([^']+)'\)/);
    expect(m).not.toBeNull();
    const [, de, para] = m!;
    expect([...de]).toHaveLength(48);
    expect([...para]).toHaveLength(48);
  });

  it('as colunas vêm ANTES das funções de campo calculado', () => {
    expect(comandos.indexOf('ADD COLUMN IF NOT EXISTS lead_location')).toBeLessThan(
      comandos.indexOf('FUNCTION public.lead_location_busca')
    );
  });

  it('a cópia de loss_location só onde lead_location IS NULL', () => {
    expect(comandos).toMatch(
      /UPDATE public\.deals SET lead_location = btrim\(loss_location\)\s*WHERE lead_location IS NULL AND nullif\(btrim\(loss_location\), ''\) IS NOT NULL;/
    );
  });

  it('sem NOT NULL, sem DEFAULT, sem DROP/DELETE/INSERT, sem RLS nova, sem gatilho novo', () => {
    // "IS NOT NULL" do WHERE e do CHECK é permitido; coluna NOT NULL, não.
    expect(comandos).not.toMatch(/\bSET NOT NULL\b|\btext NOT NULL\b/i);
    expect(comandos).not.toMatch(/\bDEFAULT\b/i);
    // Sem os textos entre aspas (o COMMENT fala do DROP futuro, não o executa).
    const semTextos = comandos.replace(/'[^']*'/g, "''");
    expect(semTextos).not.toMatch(/\bDROP\b|\bDELETE\b|\bINSERT\b/i);
    expect(semTextos).not.toMatch(/POLICY|TRIGGER/i);
  });

  it('loss_location aposentada por COMMENT, e o NOTIFY do PostgREST no fim', () => {
    expect(comandos).toMatch(/COMMENT ON COLUMN public\.deals\.loss_location IS 'DESCONTINUADA/);
    expect(comandos.trim().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
  });
});

describe('R3 — a IA não enxerga os campos novos', () => {
  const extracao = readFileSync(join(process.cwd(), 'lib/ai/extraction/customFields.service.ts'), 'utf-8');

  it('o update da extração não grava lead_location nem loss_note', () => {
    expect(extracao).toContain('custom_fields: nextFields');
    expect(extracao).not.toMatch(/lead_location|loss_note|leadLocation|lossNote/);
  });

  it('o chat e as ferramentas da IA não citam os campos novos', () => {
    for (const arquivo of ['lib/ai/crmAgent.ts', 'lib/ai/tools.ts']) {
      const fonte = readFileSync(join(process.cwd(), arquivo), 'utf-8');
      expect(fonte).not.toMatch(/lead_location|loss_note|leadLocation|lossNote/);
    }
  });
});

describe('API pública — fora de escopo, não muda', () => {
  it('a mudança de etapa pela API não escreve os campos novos', () => {
    const fonte = readFileSync(join(process.cwd(), 'lib/public-api/dealsMoveStage.ts'), 'utf-8');
    expect(fonte).toContain('updates.loss_reason = null');
    expect(fonte).not.toMatch(/lead_location|loss_note/);
  });
});
