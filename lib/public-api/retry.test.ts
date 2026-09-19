/**
 * Story 2.51 — retentativa com backoff (AC3).
 */
import { describe, expect, it, vi } from 'vitest';
import { BACKOFF_PADRAO_MS, comRetry } from '@/lib/public-api/retry';

/** `dormir` injetado: o teste registra as esperas em vez de esperá-las. */
function relogioFalso() {
  const esperas: number[] = [];
  return {
    esperas,
    dormir: async (ms: number) => {
      esperas.push(ms);
    },
  };
}

describe('comRetry', () => {
  it('não retenta quando a primeira tentativa serve', async () => {
    const fn = vi.fn(async () => ({ ok: true }));
    const { resultado, tentativas } = await comRetry(fn, { deveRetentar: () => false });

    expect(tentativas).toBe(1);
    expect(resultado).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retenta até acertar e devolve o resultado bom', async () => {
    const relogio = relogioFalso();
    const fn = vi.fn(async (t: number) => ({ falhou: t < 2 }));

    const { resultado, tentativas } = await comRetry(fn, {
      deveRetentar: (r) => r.falhou,
      dormir: relogio.dormir,
      aleatorio: () => 0,
    });

    expect(tentativas).toBe(2);
    expect(resultado.falhou).toBe(false);
    expect(relogio.esperas).toEqual([250]);
  });

  it('para em 3 tentativas (2 retentativas) e devolve o último resultado ruim', async () => {
    const relogio = relogioFalso();
    const fn = vi.fn(async () => ({ falhou: true }));

    const { resultado, tentativas } = await comRetry(fn, {
      deveRetentar: (r) => r.falhou,
      dormir: relogio.dormir,
      aleatorio: () => 0,
    });

    expect(tentativas).toBe(3);
    expect(resultado.falhou).toBe(true);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(relogio.esperas).toEqual([...BACKOFF_PADRAO_MS]);
  });

  it('soma jitter de até 100 ms a cada espera', async () => {
    const relogio = relogioFalso();

    await comRetry(async () => ({ falhou: true }), {
      deveRetentar: (r) => r.falhou,
      dormir: relogio.dormir,
      aleatorio: () => 1, // jitter máximo
    });

    expect(relogio.esperas).toEqual([350, 850]);
  });

  it('avisa a cada retentativa com o número da tentativa e a espera', async () => {
    const relogio = relogioFalso();
    const aoRetentar = vi.fn();

    await comRetry(async () => ({ falhou: true }), {
      deveRetentar: (r) => r.falhou,
      dormir: relogio.dormir,
      aleatorio: () => 0,
      aoRetentar,
    });

    expect(aoRetentar).toHaveBeenCalledTimes(2);
    expect(aoRetentar).toHaveBeenNthCalledWith(1, expect.objectContaining({ tentativa: 1, esperaMs: 250 }));
    expect(aoRetentar).toHaveBeenNthCalledWith(2, expect.objectContaining({ tentativa: 2, esperaMs: 750 }));
  });
});
