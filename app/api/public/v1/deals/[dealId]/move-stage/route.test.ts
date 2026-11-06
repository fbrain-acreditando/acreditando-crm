/**
 * Story 2.72 — a rota aceita `mark: "reopen"` e repassa; valor desconhecido dá 422.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DEAL = 'e5f6a7b8-c9d0-4e1f-8a2b-c3d4e5f6a7b8';
const STAGE = 'd0171b1d-3043-420f-8459-7db8aae35947';

vi.mock('@/lib/public-api/auth', () => ({
  authPublicApi: vi.fn(async () => ({ ok: true, organizationId: 'org-1' })),
}));
const move = vi.fn(async () => ({ ok: true, status: 200, body: { data: { id: DEAL }, action: 'moved' } }));
vi.mock('@/lib/public-api/dealsMoveStage', () => ({ moveStageByDealId: (...a: unknown[]) => move(...(a as [])) }));

import { POST } from './route';

const chama = (body: unknown) =>
  POST(new Request('http://x/api/public/v1/deals/' + DEAL + '/move-stage', { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ dealId: DEAL }) });

describe('POST /deals/{id}/move-stage — mark', () => {
  beforeEach(() => move.mockClear());

  it('aceita reopen e repassa para a função', async () => {
    const r = await chama({ to_stage_id: STAGE, mark: 'reopen' });
    expect(r.status).toBe(200);
    expect(move).toHaveBeenCalledTimes(1);
    expect((move.mock.calls[0] as any)[0]).toMatchObject({ mark: 'reopen', target: { to_stage_id: STAGE } });
  });

  it('valor desconhecido dá 422 e não chama a função', async () => {
    const r = await chama({ to_stage_id: STAGE, mark: 'reabre' });
    expect(r.status).toBe(422);
    expect(move).not.toHaveBeenCalled();
  });

  it('sem mark continua passando mark null (como hoje)', async () => {
    await chama({ to_stage_id: STAGE });
    expect((move.mock.calls[0] as any)[0].mark).toBeNull();
  });
});
