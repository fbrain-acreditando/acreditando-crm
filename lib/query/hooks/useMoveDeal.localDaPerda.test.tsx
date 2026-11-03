/**
 * Story 2.66 — o local de quem perdemos por Distância vai na MESMA escrita da
 * perda (AC4) e nunca é apagado por outro movimento (AC6 / D4).
 *
 * Tudo afirmado no objeto que chega a `dealsService.update`: é ele que vira o
 * UPDATE (`transformDealToDb` só manda as chaves presentes — ver
 * `lib/supabase/localDaPerda.test.ts`).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMoveDeal, useMoveDealSimple } from './useMoveDeal';
import { DEALS_VIEW_KEY } from '../queryKeys';
import type { Board, Deal, DealView } from '@/types';

const { update, criarAtividade } = vi.hoisted(() => ({
  update: vi.fn(async (..._args: unknown[]) => ({ error: null })),
  criarAtividade: vi.fn(async (..._args: unknown[]) => ({})),
}));

vi.mock('@/lib/supabase', () => ({
  dealsService: {
    update: (...args: unknown[]) => update(...args),
    create: vi.fn(),
  },
}));
vi.mock('@/lib/supabase/boards', () => ({ boardsService: { get: vi.fn() } }));
vi.mock('@/lib/supabase/activities', () => ({
  activitiesService: { create: (...args: unknown[]) => criarAtividade(...args) },
}));
vi.mock('@/lib/supabase/contacts', () => ({ contactsService: { update: vi.fn(async () => ({})) } }));

const board = {
  id: 'board-1',
  wonStageId: 'stage-ganho',
  lostStageId: 'stage-perdido',
  stages: [
    { id: 'stage-lead', label: 'Lead novo' },
    { id: 'stage-ganho', label: 'Ganho' },
    { id: 'stage-perdido', label: 'Perdido' },
  ],
} as unknown as Board;

const aberto = {
  id: 'deal-1',
  title: 'Maria - WhatsApp',
  status: 'stage-lead',
  isWon: false,
  isLost: false,
  customFields: { ondeReside: 'Zona Leste' },
} as unknown as Deal;

const perdidoComLocal = {
  ...aberto,
  status: 'stage-perdido',
  isLost: true,
  lossReason: 'Distância',
  lossLocation: 'Manaus/AM',
} as unknown as Deal;

function montar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, [aberto as unknown as DealView]);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** O 2º argumento da (única) chamada a `dealsService.update`. */
function unicoUpdate(): Record<string, unknown> {
  expect(update).toHaveBeenCalledTimes(1);
  return update.mock.calls[0][1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('AC4 — o local vai na mesma escrita da perda', () => {
  it('🎯 Distância com local ⇒ UMA chamada, com lossReason e lossLocation, sem customFields', async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useMoveDeal(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        dealId: 'deal-1',
        targetStageId: 'stage-perdido',
        lossReason: 'Distância',
        lossLocation: 'Manaus/AM',
        deal: aberto,
        board,
      });
    });

    const updates = unicoUpdate();
    expect(updates.lossReason).toBe('Distância');
    expect(updates.lossLocation).toBe('Manaus/AM');
    expect(updates.isLost).toBe(true);
    expect(updates).not.toHaveProperty('customFields');
  });

  it('perder por outro motivo ⇒ update SEM lossLocation', async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useMoveDeal(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        dealId: 'deal-1',
        targetStageId: 'stage-perdido',
        lossReason: 'Preço muito alto',
        deal: aberto,
        board,
      });
    });

    expect(unicoUpdate()).not.toHaveProperty('lossLocation');
  });

  it('a atividade diz "Motivo da perda: Distância · Local: <texto>"', async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useMoveDeal(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        dealId: 'deal-1',
        targetStageId: 'stage-perdido',
        lossReason: 'Distância',
        lossLocation: 'Guarulhos',
        deal: aberto,
        board,
      });
    });

    const atividade = criarAtividade.mock.calls[0][0] as { description?: string };
    expect(atividade.description).toBe('Motivo da perda: Distância · Local: Guarulhos');
  });

  it('sem local, a atividade continua como antes', async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useMoveDeal(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        dealId: 'deal-1',
        targetStageId: 'stage-perdido',
        lossReason: 'Distância',
        deal: aberto,
        board,
      });
    });

    const atividade = criarAtividade.mock.calls[0][0] as { description?: string };
    expect(atividade.description).toBe('Motivo da perda: Distância');
  });

  it('otimista: o card no DEALS_VIEW_KEY mostra o local antes do servidor responder', async () => {
    const { wrapper, queryClient } = montar();
    let liberar: (v: { error: null }) => void = () => undefined;
    update.mockImplementationOnce(() => new Promise(r => { liberar = r; }));
    const { result } = renderHook(() => useMoveDeal(), { wrapper });

    let promessa: Promise<unknown> = Promise.resolve();
    await act(async () => {
      promessa = result.current.mutateAsync({
        dealId: 'deal-1',
        targetStageId: 'stage-perdido',
        lossReason: 'Distância',
        lossLocation: 'Manaus/AM',
        deal: aberto,
        board,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    const noCache = queryClient.getQueryData<DealView[]>(DEALS_VIEW_KEY)?.[0];
    expect(noCache?.lossLocation).toBe('Manaus/AM');

    await act(async () => {
      liberar({ error: null });
      await promessa;
    });
  });
});

describe('AC4 — useMoveDealSimple: 6º parâmetro opcional', () => {
  it('🎯 chamada antiga com 5 argumentos gera o mesmo update, sem a chave lossLocation', async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useMoveDealSimple(board), { wrapper });

    await act(async () => {
      await result.current.moveDeal(aberto, 'stage-lead', 'Preço muito alto', false, true);
    });

    const updates = unicoUpdate();
    expect(updates.lossReason).toBe('Preço muito alto');
    expect(updates.isLost).toBe(true);
    expect(updates).not.toHaveProperty('lossLocation');
  });

  it('o 6º argumento chega ao update', async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useMoveDealSimple(board), { wrapper });

    await act(async () => {
      await result.current.moveDeal(aberto, 'stage-perdido', 'Distância', undefined, undefined, 'Manaus/AM');
    });

    const updates = unicoUpdate();
    expect(updates.lossReason).toBe('Distância');
    expect(updates.lossLocation).toBe('Manaus/AM');
  });
});

describe('AC6 — o local não se perde quando o card muda (D4)', () => {
  it('reabrir (arrastar para coluna normal) não leva lossLocation', async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useMoveDealSimple(board), { wrapper });

    await act(async () => {
      await result.current.moveDeal(perdidoComLocal, 'stage-lead');
    });

    const updates = unicoUpdate();
    expect(updates.isLost).toBe(false);
    expect(updates).not.toHaveProperty('lossLocation');
  });

  it('marcar ganho não leva lossLocation', async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useMoveDealSimple(board), { wrapper });

    await act(async () => {
      await result.current.moveDeal(perdidoComLocal, 'stage-ganho');
    });

    const updates = unicoUpdate();
    expect(updates.isWon).toBe(true);
    expect(updates).not.toHaveProperty('lossLocation');
  });

  it('perder de novo por OUTRO motivo não mexe no local', async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useMoveDealSimple(board), { wrapper });

    await act(async () => {
      await result.current.moveDeal(perdidoComLocal, 'stage-perdido', 'Lead sem interesse');
    });

    expect(unicoUpdate()).not.toHaveProperty('lossLocation');
  });

  it('perder de novo por Distância com campo vazio NÃO apaga o local anterior', async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useMoveDeal(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        dealId: 'deal-1',
        targetStageId: 'stage-perdido',
        lossReason: 'Distância',
        lossLocation: '',
        deal: perdidoComLocal,
        board,
      });
    });

    expect(unicoUpdate()).not.toHaveProperty('lossLocation');
  });

  it('perder de novo por Distância com texto substitui', async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useMoveDealSimple(board), { wrapper });

    await act(async () => {
      await result.current.moveDeal(perdidoComLocal, 'stage-perdido', 'Distância', undefined, undefined, 'Rondônia');
    });

    expect(unicoUpdate().lossLocation).toBe('Rondônia');
  });
});
