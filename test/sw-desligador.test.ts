/**
 * Story 2.61 — AC1 / AC4 (a)(b)(c): `public/sw.js` é um desligador (kill switch).
 *
 * O arquivo é carregado como texto e executado num `self` simulado, com
 * `caches` simulado. Cada teste afirma o VALOR (eventos registrados, lista de
 * caches no fim, contagem de chamadas), não só que "algo existe".
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const SW_SRC = readFileSync(resolve(__dirname, '..', 'public', 'sw.js'), 'utf8');

type Listener = (event: { waitUntil: (p: Promise<unknown>) => void }) => void;

function criarCachesSimulado(iniciais: string[]) {
  const nomes = new Set(iniciais);
  return {
    open: vi.fn(async () => ({ addAll: vi.fn(), put: vi.fn() })),
    keys: vi.fn(async () => [...nomes]),
    delete: vi.fn(async (k: string) => nomes.delete(k)),
    match: vi.fn(async () => undefined),
    has: vi.fn(async (k: string) => nomes.has(k)),
  };
}

function carregarSw(cachesIniciais: string[] = []) {
  const listeners = new Map<string, Listener>();
  const eventosRegistrados: string[] = [];
  const caches = criarCachesSimulado(cachesIniciais);
  const self = {
    addEventListener: vi.fn((tipo: string, fn: Listener) => {
      eventosRegistrados.push(tipo);
      listeners.set(tipo, fn);
    }),
    skipWaiting: vi.fn(async () => undefined),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => []),
    },
    registration: { unregister: vi.fn(async () => true) },
  };
  new Function('self', 'caches', SW_SRC)(self, caches);

  async function disparar(tipo: string) {
    const pendentes: Promise<unknown>[] = [];
    listeners.get(tipo)?.({ waitUntil: (p) => pendentes.push(p) });
    await Promise.all(pendentes);
  }

  return { self, caches, eventosRegistrados, disparar };
}

describe('public/sw.js — desligador (story 2.61)', () => {
  it('(a) registra exatamente install e activate — nenhum listener de fetch', () => {
    const { eventosRegistrados } = carregarSw();
    expect([...eventosRegistrados].sort()).toEqual(['activate', 'install']);
  });

  it('(b) install chama skipWaiting e não abre nem escreve cache nenhum', async () => {
    const { self, caches, disparar } = carregarSw(['nossocrm-shell-v2']);
    await disparar('install');
    expect(self.skipWaiting).toHaveBeenCalledTimes(1);
    expect(caches.open).not.toHaveBeenCalled();
    expect(caches.delete).not.toHaveBeenCalled();
  });

  it('(c) activate apaga TODOS os caches (inclusive nossocrm-shell-v2) e desregistra 1 vez', async () => {
    const { self, caches, disparar } = carregarSw(['nossocrm-shell-v2', 'outro']);
    await disparar('activate');
    expect(await caches.keys()).toEqual([]);
    expect(self.registration.unregister).toHaveBeenCalledTimes(1);
    expect(self.clients.claim).toHaveBeenCalledTimes(1);
    expect(self.clients.matchAll).not.toHaveBeenCalled(); // não recarrega abas (AC1)
  });

  it('o arquivo avisa que não pode ser apagado (AC3c)', () => {
    expect(SW_SRC).toMatch(/NUNCA APAGUE ESTE ARQUIVO/);
  });
});
