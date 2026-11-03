/**
 * Story 2.66 — o local de quem perdemos por distância (`deals.loss_location`).
 *
 * Três travas que não precisam de banco:
 *   • AC1 — a migration é aditiva e idempotente (lida como texto, como a 2.50);
 *   • AC2 — a tradução banco ↔ tela nos dois sentidos, afirmando o VALOR, e que
 *     um update sem `lossLocation` NÃO leva a chave (é o que garante o D4:
 *     perder por outro motivo, reabrir ou ganhar não apagam o local);
 *   • AC6 — a API pública, que zera `loss_reason` ao marcar ganho, não toca no
 *     `loss_location`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { transformDeal, transformDealToDb, type DbDeal } from './deals';

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
  loss_reason: 'Distância',
  loss_location: 'Manaus/AM',
  tags: [],
  last_stage_change_date: null,
  custom_fields: { ondeReside: 'Zona Leste' },
  created_at: '2026-11-03T10:00:00.000Z',
  updated_at: '2026-11-03T10:00:00.000Z',
} as unknown as DbDeal;

describe('AC2 — banco → tela (transformDeal)', () => {
  it('`loss_location` chega como `lossLocation`, com o texto dela', () => {
    expect(transformDeal(LINHA).lossLocation).toBe('Manaus/AM');
  });

  it('`null` (não informado) vira `undefined`', () => {
    expect(transformDeal({ ...LINHA, loss_location: null }).lossLocation).toBeUndefined();
  });

  it('não confunde com o `ondeReside` da IA', () => {
    const deal = transformDeal({ ...LINHA, loss_location: null });
    expect(deal.lossLocation).toBeUndefined();
    expect(deal.customFields?.ondeReside).toBe('Zona Leste');
  });
});

describe('AC2 — tela → banco (transformDealToDb)', () => {
  it('grava o texto em `loss_location`', () => {
    expect(transformDealToDb({ lossLocation: 'Guarulhos' })).toEqual({ loss_location: 'Guarulhos' });
  });

  it('texto vazio grava `null` — o "apagar de propósito" da edição no card (AC5)', () => {
    expect(transformDealToDb({ lossLocation: '' })).toEqual({ loss_location: null });
  });

  it('🎯 update SEM `lossLocation` não contém a chave `loss_location` (D4)', () => {
    const db = transformDealToDb({ lossReason: 'Preço muito alto', isLost: true, isWon: false });
    expect(db).not.toHaveProperty('loss_location');
    expect(db.loss_reason).toBe('Preço muito alto');
  });

  it('reabrir (isLost=false, closedAt) não leva a chave', () => {
    const db = transformDealToDb({ isWon: false, isLost: false, closedAt: undefined, status: 'x' });
    expect(db).not.toHaveProperty('loss_location');
  });

  it('salvar o local não leva `custom_fields` nem `loss_reason`', () => {
    const db = transformDealToDb({ lossLocation: 'Zona Leste' });
    expect(Object.keys(db)).toEqual(['loss_location']);
  });
});

describe('AC1 — migration aditiva e idempotente', () => {
  const pasta = join(process.cwd(), 'supabase/migrations');
  const arquivo = readdirSync(pasta).find(n => /^20261103\d{6}_local_da_perda_por_distancia\.sql$/.test(n));

  it('o arquivo existe com timestamp de 03/11', () => {
    expect(arquivo).toBeDefined();
  });

  const sql = arquivo ? readFileSync(join(pasta, arquivo), 'utf-8') : '';
  // Só o que roda — sem os comentários de cabeçalho.
  const comandos = sql
    .split('\n')
    .filter(l => !l.trim().startsWith('--'))
    .join('\n');

  it('adiciona a coluna com IF NOT EXISTS, tipo text', () => {
    expect(comandos).toMatch(
      /ALTER TABLE public\.deals ADD COLUMN IF NOT EXISTS loss_location text;/i
    );
  });

  it('sem NOT NULL, sem default, sem tocar em linha existente, sem RLS nova', () => {
    expect(comandos).not.toMatch(/NOT NULL/i);
    expect(comandos).not.toMatch(/DEFAULT/i);
    expect(comandos).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bINSERT\b|\bDROP\b/i);
    expect(comandos).not.toMatch(/POLICY/i);
  });

  it('explica no COMMENT que não é o ondeReside', () => {
    expect(comandos).toMatch(/COMMENT ON COLUMN public\.deals\.loss_location/i);
    expect(comandos).toContain('ondeReside');
  });
});

describe('AC6 — a API pública não mexe no local', () => {
  const fonte = readFileSync(join(process.cwd(), 'lib/public-api/dealsMoveStage.ts'), 'utf-8');

  it('o ramo de ganho zera `loss_reason`, mas não escreve `loss_location`', () => {
    // A premissa do AC6 continua de pé: o ganho pela API zera o motivo…
    expect(fonte).toContain('updates.loss_reason = null');
    // …e não tem nenhuma linha que escreva o local (o ganho MANTÉM o local).
    expect(fonte).not.toContain('loss_location');
  });
});
