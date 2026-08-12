/**
 * Story 2.30 — o piscar do valor antigo depois de salvar.
 *
 * O `useUpdateDeal` refetchava o board inteiro no `onSettled`. Esse refetch sai
 * logo depois da escrita e pode aterrissar com leitura stale POR CIMA do update
 * otimista. Antes da 2.29 o campo ficava preso no valor velho (o evento de
 * Realtime que corrigiria era descartado); com o Realtime consertado, o mesmo
 * defeito virou um **piscar**.
 *
 * O `useMoveDeal` já tinha tomado esta decisão — e documentado o mecanismo em
 * `useMoveDeal.ts:336-343`. Esta story só alinha o caminho de edição.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** Quantas vezes o board foi buscado no servidor. */
const buscasNoServidor = vi.fn();

/**
 * O servidor devolve, de propósito, a leitura ANTIGA — é o caso que a corrida
 * produz: o refetch parte antes de a escrita estar visível. Se o cache terminar
 * com este valor, o usuário vê o piscar (ou fica preso nele).
 */
const LEITURA_STALE = { ondeReside: 'Santos' };

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false, profile: null, organizationId: 'org1' }),
}));

vi.mock('@/lib/supabase', () => ({
  dealsService: {
    getAll: vi.fn(async () => {
      buscasNoServidor();
      return {
        data: [
          {
            id: 'deal-1',
            title: 'Maria Silva',
            contactId: 'c1',
            boardId: 'board-1',
            status: 'stage-novo',
            value: 0,
            customFields: { ...LEITURA_STALE },
            updatedAt: '2026-08-12T10:00:00.000Z',
          },
        ],
        error: null,
      };
    }),
    update: vi.fn(async () => ({ error: null })),
  },
  contactsService: { getByIds: vi.fn(async () => ({ data: [], error: null })) },
  companiesService: { getByIds: vi.fn(async () => ({ data: [], error: null })) },
  boardStagesService: { getAll: vi.fn(async () => ({ data: [], error: null })) },
}));

import { useUpdateDeal, useDealsByBoard } from '@/lib/query/hooks/useDealsQuery';
import { DEALS_VIEW_KEY } from '@/lib/query/queryKeys';

describe('useUpdateDeal — salvar campo não pode refetchar o board na hora', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    buscasNoServidor.mockClear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const cacheDoCampo = () => {
    const cache = queryClient.getQueryData<Array<Record<string, unknown>>>(DEALS_VIEW_KEY);
    return (cache?.[0]?.customFields as Record<string, string>)?.ondeReside;
  };

  it('🎯 depois de salvar, o valor no cache NÃO volta para a leitura antiga', async () => {
    const board = renderHook(() => useDealsByBoard('board-1'), { wrapper });
    await waitFor(() => expect(board.result.current.data?.length).toBe(1));
    const buscasAntes = buscasNoServidor.mock.calls.length;

    const mut = renderHook(() => useUpdateDeal(), { wrapper });
    await mut.result.current.mutateAsync({
      id: 'deal-1',
      updates: { customFields: { ondeReside: 'Guarulhos' } } as never,
    });

    // Janela em que o refetch da corrida aterrissaria.
    await new Promise(r => setTimeout(r, 150));

    expect(cacheDoCampo()).toBe('Guarulhos');
    // O oráculo: com o `invalidateQueries` refetchante de antes, esta contagem
    // sobe — e é a subida que traz a leitura stale por cima do otimismo.
    expect(buscasNoServidor.mock.calls.length).toBe(buscasAntes);
  });

  it('a rede de segurança continua: a query fica marcada como stale', async () => {
    const board = renderHook(() => useDealsByBoard('board-1'), { wrapper });
    await waitFor(() => expect(board.result.current.data?.length).toBe(1));

    const mut = renderHook(() => useUpdateDeal(), { wrapper });
    await mut.result.current.mutateAsync({
      id: 'deal-1',
      updates: { customFields: { ondeReside: 'Guarulhos' } } as never,
    });

    // `refetchType: 'none'` não refetcha, mas INVALIDA — é isso que faz o
    // `refetchOnMount` do `useDealsByBoard` reconciliar na próxima montagem.
    const query = queryClient.getQueryCache().find({ queryKey: DEALS_VIEW_KEY });
    expect(query?.state.isInvalidated).toBe(true);
  });
});
