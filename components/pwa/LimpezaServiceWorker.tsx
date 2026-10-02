'use client';

import { useEffect } from 'react';

/**
 * Story 2.61 — o CRM não usa mais service worker.
 *
 * Este componente NÃO registra SW. Ele remove o SW antigo (cache
 * `nossocrm-shell-v2`) de navegadores que ainda o têm, nesta ordem fixa:
 *
 * 1. `getRegistration()`;
 * 2. `reg.update()` (erro tolerado) — dá ao desligador (`public/sw.js`) a
 *    chance de instalar e assumir a aba, já sem handler de `fetch`;
 *    em seguida espera, por no máximo `ESPERA_ATIVACAO_MS`, o novo worker
 *    chegar a `activated` (ou `redundant`). `update()` resolve antes de o
 *    worker ativar; sem essa espera o `unregister()` abaixo poderia chegar
 *    antes e impedir que o desligador assumisse a aba atual;
 * 3. `unregister()` em todos os registros;
 * 4. apaga todos os caches.
 *
 * Tudo silencioso: navegador sem `serviceWorker`/`caches` não quebra a página.
 * Promessa: cura garantida a partir do próximo recarregamento.
 *
 * Fica montado em `app/layout.tsx` por tempo indeterminado: navegadores que
 * voltarem daqui a semanas ainda terão o v2.
 */

export const ESPERA_ATIVACAO_MS = 3000;

type WorkerLike = Pick<ServiceWorker, 'state' | 'addEventListener' | 'removeEventListener'>;

/** Espera o worker `novo` chegar a `activated`/`redundant`, com teto de `ms`. */
export function esperarAtivacao(novo: WorkerLike | null | undefined, ms: number): Promise<void> {
  if (!novo) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const fim = () => {
      clearTimeout(timer);
      novo.removeEventListener('statechange', conferir);
      resolve();
    };
    function conferir() {
      if (novo!.state === 'activated' || novo!.state === 'redundant') fim();
    }
    const timer = setTimeout(fim, ms);
    novo.addEventListener('statechange', conferir);
    conferir();
  });
}

/** Limpeza do SW e dos caches, na ordem da story 2.61 (AC2). Nunca lança. */
export async function limparServiceWorker(
  sw: ServiceWorkerContainer | undefined,
  cacheStorage: CacheStorage | undefined,
  esperaMs: number = ESPERA_ATIVACAO_MS,
): Promise<void> {
  if (sw) {
    try {
      const reg = await sw.getRegistration();
      if (reg) {
        await reg.update();
        await esperarAtivacao(reg.installing ?? reg.waiting, esperaMs);
      }
    } catch {
      // ex.: 307 no /sw.js ou rede fora — segue para o unregister mesmo assim.
    }

    try {
      const regs = await sw.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    } catch {
      // segue
    }
  }

  if (cacheStorage) {
    try {
      const keys = await cacheStorage.keys();
      await Promise.all(keys.map((k) => cacheStorage.delete(k).catch(() => false)));
    } catch {
      // noop
    }
  }
}

export function LimpezaServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Ler `navigator.serviceWorker` / `window.caches` pode lançar SecurityError
    // (ex.: Firefox com armazenamento bloqueado). Está no layout raiz: nunca
    // pode derrubar a página. Cada leitura isolada, para uma não impedir a outra.
    let sw: ServiceWorkerContainer | undefined;
    let cacheStorage: CacheStorage | undefined;
    try {
      sw = 'serviceWorker' in navigator ? navigator.serviceWorker : undefined;
    } catch {
      sw = undefined;
    }
    try {
      cacheStorage = 'caches' in window ? window.caches : undefined;
    } catch {
      cacheStorage = undefined;
    }
    limparServiceWorker(sw, cacheStorage).catch(() => {});
  }, []);

  return null;
}
