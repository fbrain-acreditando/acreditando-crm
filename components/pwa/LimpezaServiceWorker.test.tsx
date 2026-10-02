/**
 * Story 2.61 — AC2 / AC4 (d)(d2)(d3)(e): a página não registra SW e limpa,
 * na ordem fixa update ⇒ (espera ativar) ⇒ unregister ⇒ caches.
 */
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LimpezaServiceWorker, esperarAtivacao, limparServiceWorker } from './LimpezaServiceWorker';

type Estado = ServiceWorkerState;

function criarWorker(estadoInicial: Estado) {
  const ouvintes = new Set<() => void>();
  const w = {
    state: estadoInicial,
    addEventListener: vi.fn((_t: string, fn: () => void) => ouvintes.add(fn)),
    removeEventListener: vi.fn((_t: string, fn: () => void) => ouvintes.delete(fn)),
    mudar(novo: Estado) {
      w.state = novo;
      ouvintes.forEach((fn) => fn());
    },
  };
  return w;
}

function cenario(opts: { updateFalha?: boolean; installing?: ReturnType<typeof criarWorker> | null } = {}) {
  const seq: string[] = [];
  const nomes = new Set(['nossocrm-shell-v2', 'outro']);
  const reg = (id: string) => ({
    update: vi.fn(async () => {
      seq.push(`update:${id}`);
      if (opts.updateFalha) throw new TypeError('Failed to update a ServiceWorker: 307');
    }),
    unregister: vi.fn(async () => {
      seq.push(`unregister:${id}`);
      return true;
    }),
    installing: opts.installing ?? null,
    waiting: null,
  });
  const r1 = reg('r1');
  const r2 = reg('r2');
  const sw = {
    register: vi.fn(async () => r1),
    getRegistration: vi.fn(async () => r1),
    getRegistrations: vi.fn(async () => [r1, r2]),
  };
  const cacheStorage = {
    keys: vi.fn(async () => [...nomes]),
    delete: vi.fn(async (k: string) => {
      seq.push(`cache.delete:${k}`);
      return nomes.delete(k);
    }),
  };
  return {
    seq,
    r1,
    r2,
    sw,
    cacheStorage,
    swApi: sw as unknown as ServiceWorkerContainer,
    cacheApi: cacheStorage as unknown as CacheStorage,
  };
}

const navAny = navigator as unknown as Record<string, unknown>;
const winAny = window as unknown as Record<string, unknown>;

afterEach(() => {
  delete navAny.serviceWorker;
  delete winAny.caches;
  vi.useRealTimers();
});

describe('LimpezaServiceWorker (story 2.61)', () => {
  it('(d) montado: desregistra os 2 registros, esvazia os caches e NUNCA chama register', async () => {
    const c = cenario();
    Object.defineProperty(navigator, 'serviceWorker', { value: c.sw, configurable: true });
    Object.defineProperty(window, 'caches', { value: c.cacheStorage, configurable: true });

    render(<LimpezaServiceWorker />);

    await waitFor(async () => expect(await c.cacheStorage.keys()).toEqual([]));
    expect(c.r1.unregister).toHaveBeenCalledTimes(1);
    expect(c.r2.unregister).toHaveBeenCalledTimes(1);
    expect(c.sw.register).not.toHaveBeenCalled();
  });

  it('(d2) ordem: update antes de qualquer unregister e de qualquer caches.delete', async () => {
    const c = cenario();
    await limparServiceWorker(c.swApi, c.cacheApi, 0);
    expect(c.seq[0]).toBe('update:r1');
    expect(c.seq.slice(1).sort()).toEqual(
      ['cache.delete:nossocrm-shell-v2', 'cache.delete:outro', 'unregister:r1', 'unregister:r2'].sort(),
    );
    const ultimoUnregister = Math.max(c.seq.indexOf('unregister:r1'), c.seq.indexOf('unregister:r2'));
    const primeiroDelete = Math.min(
      c.seq.indexOf('cache.delete:nossocrm-shell-v2'),
      c.seq.indexOf('cache.delete:outro'),
    );
    expect(ultimoUnregister).toBeLessThan(primeiroDelete);
  });

  it('(d3) update rejeitando (307): unregister e limpeza acontecem mesmo assim, sem lançar', async () => {
    const c = cenario({ updateFalha: true });
    await expect(limparServiceWorker(c.swApi, c.cacheApi, 0)).resolves.toBeUndefined();
    expect(c.r1.unregister).toHaveBeenCalledTimes(1);
    expect(c.r2.unregister).toHaveBeenCalledTimes(1);
    expect(await c.cacheStorage.keys()).toEqual([]);
  });

  it('(d4) espera o desligador ativar antes do unregister (corrida do update)', async () => {
    const novo = criarWorker('installing');
    const c = cenario({ installing: novo });
    const pronto = limparServiceWorker(c.swApi, c.cacheApi, 3000);

    await new Promise((r) => setTimeout(r, 20));
    expect(c.r1.unregister).not.toHaveBeenCalled(); // ainda esperando o worker novo

    novo.mudar('activated');
    await pronto;
    expect(c.seq.indexOf('update:r1')).toBe(0);
    expect(c.r1.unregister).toHaveBeenCalledTimes(1);
    expect(novo.removeEventListener).toHaveBeenCalled();
  });

  it('(d5) a espera tem teto: worker que nunca ativa não trava a limpeza', async () => {
    vi.useFakeTimers();
    const novo = criarWorker('installing');
    const p = esperarAtivacao(novo, 3000);
    let resolvido = false;
    void p.then(() => (resolvido = true));
    await vi.advanceTimersByTimeAsync(2999);
    expect(resolvido).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolvido).toBe(true);
  });

  it('(e2) getter de navigator.serviceWorker lança SecurityError: não lança, renderiza null e ainda limpa caches', async () => {
    const c = cenario();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    Object.defineProperty(window, 'caches', { value: c.cacheStorage, configurable: true });

    let container!: HTMLElement;
    expect(() => ({ container } = render(<LimpezaServiceWorker />))).not.toThrow();
    expect(container.innerHTML).toBe('');
    await waitFor(async () => expect(await c.cacheStorage.keys()).toEqual([]));
  });

  it('(e3) getter de window.caches lança SecurityError: não lança, renderiza null e ainda desregistra', async () => {
    const c = cenario();
    Object.defineProperty(navigator, 'serviceWorker', { value: c.sw, configurable: true });
    Object.defineProperty(window, 'caches', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });

    let container!: HTMLElement;
    expect(() => ({ container } = render(<LimpezaServiceWorker />))).not.toThrow();
    expect(container.innerHTML).toBe('');
    await waitFor(() => expect(c.r2.unregister).toHaveBeenCalledTimes(1));
  });

  it('(e) sem serviceWorker e sem caches: monta sem erro', () => {
    expect('serviceWorker' in navigator).toBe(false);
    expect('caches' in window).toBe(false);
    expect(() => render(<LimpezaServiceWorker />)).not.toThrow();
  });
});
