/**
 * Story 2.72 — o card perdido que volta pela campanha sai do Perdido.
 *
 * Prova a regra de fechamento do `move-stage` por id (AC1–AC5) e que, no caso
 * proibido (`reopen` para Ganho/Perdido/categoria), NADA é gravado (AC4).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const BOARD = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const DEAL = 'e5f6a7b8-c9d0-4e1f-8a2b-c3d4e5f6a7b8';
const COMUM = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';
const GANHO = 'd4e5f6a7-b8c9-4d0e-8f1a-b2c3d4e5f6a7';
const PERDIDO = 'f6a7b8c9-d0e1-4f2a-8b3c-d4e5f6a7b8c9';
const CATEGORIA = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const AGORA = '2026-11-05T23:00:00.000Z';

let arquivaSemReabrir = false;
let ciclo: string | null = null;
let quadro: { won_stage_id: string | null; lost_stage_id: string | null } = { won_stage_id: GANHO, lost_stage_id: PERDIDO };
const updates: unknown[] = [];

/** Builder mínimo: responde por tabela; registra todo `update`. */
function builder(tabela: string) {
  const b: any = {
    _upd: null as unknown,
    select: () => b, eq: () => b, is: () => b, ilike: () => b, limit: () => b,
    update: (u: unknown) => { b._upd = u; updates.push(u); return b; },
    maybeSingle: async () => {
      if (tabela === 'deals' && b._upd) return { data: { id: DEAL, ...(b._upd as object) }, error: null };
      if (tabela === 'deals') return { data: { id: DEAL, board_id: BOARD, stage_id: PERDIDO }, error: null };
      if (tabela === 'boards') return { data: quadro, error: null };
      if (tabela === 'board_stages') return { data: { id: 'x', arquiva_sem_reabrir: arquivaSemReabrir, linked_lifecycle_stage: ciclo }, error: null };
      return { data: null, error: null };
    },
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({ from: (t: string) => builder(t) }),
}));

import { decidirFechamentoAoMover, moveStageByDealId } from './dealsMoveStage';

const base = { wonStageId: GANHO, lostStageId: PERDIDO, destinoArquivaSemReabrir: false, agora: AGORA };

describe('decidirFechamentoAoMover — regra pura', () => {
  it('AC1/AC2: reopen para etapa comum reabre (ganho ou perdido)', () => {
    expect(decidirFechamentoAoMover({ ...base, mark: 'reopen', stageId: COMUM }))
      .toEqual({ ok: true, campos: { is_won: false, is_lost: false, closed_at: null } });
  });

  it('AC3: reopen não toca em loss_reason nem loss_note', () => {
    const r = decidirFechamentoAoMover({ ...base, mark: 'reopen', stageId: COMUM });
    expect(r.ok && Object.keys(r.campos)).toEqual(['is_won', 'is_lost', 'closed_at']);
  });

  it.each([
    ['Ganho', GANHO, false],
    ['Perdido', PERDIDO, false],
    ['coluna de categoria', CATEGORIA, true],
  ])('AC4: reopen para %s é recusado', (_n, stageId, arquiva) => {
    const r = decidirFechamentoAoMover({ ...base, mark: 'reopen', stageId, destinoArquivaSemReabrir: arquiva });
    expect(r.ok).toBe(false);
  });

  it('AC5: sem mark, etapa comum não mexe em fechamento (como hoje)', () => {
    expect(decidirFechamentoAoMover({ ...base, mark: null, stageId: COMUM })).toEqual({ ok: true, campos: {} });
  });

  it('AC5: sem mark, destino Ganho fecha como ganho (como hoje)', () => {
    expect(decidirFechamentoAoMover({ ...base, mark: undefined, stageId: GANHO })).toEqual({
      ok: true, campos: { is_won: true, is_lost: false, closed_at: AGORA, loss_reason: null },
    });
  });

  it('AC5: mark lost em etapa comum fecha como perdido (como hoje)', () => {
    expect(decidirFechamentoAoMover({ ...base, mark: 'lost', stageId: COMUM })).toEqual({
      ok: true, campos: { is_lost: true, is_won: false, closed_at: AGORA },
    });
  });

  it('AC5: mark won em etapa comum fecha como ganho (como hoje)', () => {
    expect(decidirFechamentoAoMover({ ...base, mark: 'won', stageId: COMUM })).toEqual({
      ok: true, campos: { is_won: true, is_lost: false, closed_at: AGORA, loss_reason: null },
    });
  });
});

describe('moveStageByDealId — o que é gravado', () => {
  beforeEach(() => {
    updates.length = 0; arquivaSemReabrir = false; ciclo = null;
    quadro = { won_stage_id: GANHO, lost_stage_id: PERDIDO };
  });

  it('AC1: reopen grava is_lost=false, is_won=false, closed_at=null e o destino', async () => {
    const r = await moveStageByDealId({ organizationId: ORG, dealId: DEAL, target: { to_stage_id: COMUM }, mark: 'reopen' });
    expect(r.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ stage_id: COMUM, is_lost: false, is_won: false, closed_at: null });
    expect(updates[0]).not.toHaveProperty('loss_reason');
  });

  it('AC4: reopen para coluna de categoria devolve 422 e não grava nada', async () => {
    arquivaSemReabrir = true;
    const r = await moveStageByDealId({ organizationId: ORG, dealId: DEAL, target: { to_stage_id: CATEGORIA }, mark: 'reopen' });
    expect(r.status).toBe(422);
    expect(updates).toHaveLength(0);
  });

  it('AC4: reopen para Ganho devolve 422 e não grava nada', async () => {
    const r = await moveStageByDealId({ organizationId: ORG, dealId: DEAL, target: { to_stage_id: GANHO }, mark: 'reopen' });
    expect(r.status).toBe(422);
    expect(updates).toHaveLength(0);
  });

  it('AC4: reopen para Perdido devolve 422 e não grava nada', async () => {
    const r = await moveStageByDealId({ organizationId: ORG, dealId: DEAL, target: { to_stage_id: PERDIDO }, mark: 'reopen' });
    expect(r.status).toBe(422);
    expect(updates).toHaveLength(0);
  });

  it('AC5: sem mark, mover card perdido para etapa comum mantém o fechamento (como hoje)', async () => {
    const r = await moveStageByDealId({ organizationId: ORG, dealId: DEAL, target: { to_stage_id: COMUM } });
    expect(r.status).toBe(200);
    expect(updates[0]).not.toHaveProperty('is_lost');
    expect(updates[0]).not.toHaveProperty('closed_at');
  });

  // Como é o quadro real (medido 06/11): won/lost_stage_id nulos; Ganho/Perdido
  // só pelo tipo da etapa. Em produção o 1º deploy aceitou reopen para "Perdido".
  it.each([['Perdido', 'OTHER'], ['Ganho', 'CUSTOMER']])(
    'AC4 (quadro real): reopen para %s pelo tipo da etapa dá 422 e não grava', async (_n, tipo) => {
      quadro = { won_stage_id: null, lost_stage_id: null };
      ciclo = tipo;
      const r = await moveStageByDealId({ organizationId: ORG, dealId: DEAL, target: { to_stage_id: PERDIDO }, mark: 'reopen' });
      expect(r.status).toBe(422);
      expect(updates).toHaveLength(0);
    });

  it('AC1 (quadro real): reopen para coluna comum reabre', async () => {
    quadro = { won_stage_id: null, lost_stage_id: null };
    const r = await moveStageByDealId({ organizationId: ORG, dealId: DEAL, target: { to_stage_id: COMUM }, mark: 'reopen' });
    expect(r.status).toBe(200);
    expect(updates[0]).toMatchObject({ is_lost: false, closed_at: null });
  });
});
