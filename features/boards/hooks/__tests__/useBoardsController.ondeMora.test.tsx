/**
 * Story 2.67 — o caminho do QUADRO repassa o "Onde mora" e a observação da
 * perda (sucede o teste TEST-001 da 2.66), e o filtro "Onde mora" + o aviso do
 * teto de 1.000 cards (AC5).
 *
 * Cobre os dois caminhos do quadro que abrem o modal da perda — arrastar o
 * card (`handleDrop`) e o teclado (`handleMoveDealToStage`) — e afirma o VALOR
 * que chega a `moveDealMutation.mutate`. As mutações de controle do AC11
 * (tirar o repasse do `leadLocation` e, separadamente, o do `lossNote`) têm de
 * reprovar testes daqui.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type React from 'react';

const h = vi.hoisted(() => {
  const board = {
    id: 'board-1',
    name: 'Funil',
    wonStageId: 'stage-ganho',
    lostStageId: 'stage-perdido',
    stages: [
      { id: 'stage-lead', label: 'Lead novo' },
      { id: 'stage-ganho', label: 'Ganho', linkedLifecycleStage: 'CUSTOMER' },
      { id: 'stage-perdido', label: 'Perdido', linkedLifecycleStage: 'OTHER' },
    ],
  };
  const deal = {
    id: 'deal-1',
    title: 'Maria - WhatsApp',
    status: 'stage-lead',
    value: 0,
    isWon: false,
    isLost: false,
    updatedAt: '2026-11-01T12:00:00Z',
    leadLocation: 'Santana' as string | undefined,
    customFields: { ondeReside: 'Zona Leste' },
  };
  const mutate = vi.fn();
  const noopMutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
  return {
    board,
    deal,
    boards: [board],
    deals: [deal] as Array<Record<string, unknown>>,
    lifecycleStages: [] as unknown[],
    customFields: [] as unknown[],
    mutate,
    moveMutation: { mutate, mutateAsync: vi.fn(), isPending: false },
    noopMutation,
    searchParams: new URLSearchParams(),
    router: { push: vi.fn(), replace: vi.fn() },
    toast: { addToast: vi.fn() },
    auth: { profile: { id: 'user-1' }, organizationId: 'org-1' },
    ai: { setContext: vi.fn(), clearContext: vi.fn() },
  };
});

vi.mock('next/navigation', () => ({
  useSearchParams: () => h.searchParams,
  useRouter: () => h.router,
  usePathname: () => '/boards',
}));
vi.mock('@/lib/query/hooks/useBoardsQuery', () => ({
  useBoards: () => ({
    data: h.boards,
    isLoading: false,
    isFetched: true,
    isFetching: false,
    dataUpdatedAt: 1,
  }),
  useDefaultBoard: () => ({ data: h.board }),
  useCreateBoard: () => h.noopMutation,
  useUpdateBoard: () => h.noopMutation,
  useDeleteBoard: () => h.noopMutation,
  useDeleteBoardWithMove: () => h.noopMutation,
  useCanDeleteBoard: () => ({ data: undefined }),
}));
vi.mock('@/lib/query/hooks/useDealsQuery', () => ({
  useDealsByBoard: () => ({ data: h.deals, isLoading: false }),
}));
vi.mock('@/lib/query/hooks/useMoveDeal', () => ({ useMoveDeal: () => h.moveMutation }));
vi.mock('@/lib/query/hooks/useActivitiesQuery', () => ({ useCreateActivity: () => h.noopMutation }));
vi.mock('@/hooks/usePersistedState', async () => {
  const { useState } = await import('react');
  return { usePersistedState: (_key: string, initial: unknown) => useState(initial) };
});
vi.mock('@/lib/realtime/useRealtimeSync', () => ({ useRealtimeSyncKanban: () => undefined }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => h.toast }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/lib/query/hooks/useLifecycleStagesQuery', () => ({
  useLifecycleStages: () => ({ data: h.lifecycleStages }),
}));
vi.mock('@/lib/query/hooks/useCustomFieldsQuery', () => ({
  useCustomFields: () => ({ data: h.customFields }),
}));
vi.mock('@/context/AIContext', () => ({ useAI: () => h.ai }));

import { useBoardsController } from '../useBoardsController';

/** Evento de soltar o card, como o navegador entrega ao `handleDrop`. */
function eventoDeSoltar(dealId: string, dealTitle: string): React.DragEvent {
  const dados: Record<string, string> = { dealId, dealTitle };
  return {
    preventDefault: vi.fn(),
    dataTransfer: { getData: (k: string) => dados[k] ?? '' },
  } as unknown as React.DragEvent;
}

type Controller = ReturnType<typeof useBoardsController>;

function abrirPeloQuadro(result: { current: Controller }) {
  act(() => {
    result.current.handleDrop(eventoDeSoltar('deal-1', 'Maria - WhatsApp'), 'stage-perdido');
  });
}

function abrirPeloTeclado(result: { current: Controller }) {
  act(() => {
    result.current.handleMoveDealToStage('deal-1', 'stage-perdido');
  });
}

const caminhos = [
  ['arrastar o card para Perdido', abrirPeloQuadro],
  ['mover pelo teclado para Perdido', abrirPeloTeclado],
] as const;

describe('Story 2.67 — o quadro repassa local e observação da perda (AC7)', () => {
  beforeEach(() => {
    h.mutate.mockClear();
  });

  describe.each(caminhos)('%s', (_nome, abrir) => {
    it('abre o modal sem mover nada, com a dica do ondeReside e o local atual do card', () => {
      const { result } = renderHook(() => useBoardsController());
      abrir(result);

      expect(h.mutate).not.toHaveBeenCalled();
      expect(result.current.lossReasonModal).toMatchObject({
        isOpen: true,
        dealId: 'deal-1',
        stageId: 'stage-perdido',
        localSugerido: 'Zona Leste',
        localAtual: 'Santana',
      });
    });

    it('🎯 local alterado + observação: o moveDeal recebe leadLocation e lossNote', () => {
      const { result } = renderHook(() => useBoardsController());
      abrir(result);

      act(() => {
        result.current.handleLossReasonConfirm('Sem transporte ou apoio para vir', {
          leadLocation: 'Santana — sem apoio',
          lossNote: 'depende do filho',
        });
      });

      expect(h.mutate).toHaveBeenCalledTimes(1);
      const payload = h.mutate.mock.calls[0][0];
      expect(payload).toMatchObject({
        dealId: 'deal-1',
        targetStageId: 'stage-perdido',
        lossReason: 'Sem transporte ou apoio para vir',
      });
      expect(payload.leadLocation).toBe('Santana — sem apoio');
      expect(payload.lossNote).toBe('depende do filho');
      expect(payload).not.toHaveProperty('lossLocation');
      expect(result.current.lossReasonModal).toBeNull();
    });

    it('🎯 observação vazia vai como "" (o hook grava null), e sem local a chave não vai', () => {
      const { result } = renderHook(() => useBoardsController());
      abrir(result);

      act(() => {
        result.current.handleLossReasonConfirm('Preço muito alto', { lossNote: '' });
      });

      const payload = h.mutate.mock.calls[0][0];
      expect(payload.lossReason).toBe('Preço muito alto');
      expect(payload).toHaveProperty('lossNote', '');
      expect(payload).not.toHaveProperty('leadLocation');
    });

    it('chamada sem extras não inventa chaves', () => {
      const { result } = renderHook(() => useBoardsController());
      abrir(result);

      act(() => {
        result.current.handleLossReasonConfirm('Distância');
      });

      expect(h.mutate.mock.calls[0][0]).not.toHaveProperty('leadLocation');
      expect(h.mutate.mock.calls[0][0]).not.toHaveProperty('lossNote');
    });
  });
});

describe('Story 2.67 — filtro "Onde mora" e aviso do teto (AC5)', () => {
  const base = h.deal;
  const comLocal = (id: string, leadLocation: string | undefined, extra: Record<string, unknown> = {}) => ({
    ...base,
    id,
    title: `Lead ${id}`,
    leadLocation,
    createdAt: '2026-11-01T12:00:00Z',
    ...extra,
  });
  const original = h.deals;

  afterEach(() => {
    h.deals = original;
  });

  function idsFiltrados(result: { current: Controller }) {
    return result.current.filteredDeals.map(d => d.id);
  }

  it('🎯 "santana" acha "Santana — depende de apoio"; "sao paulo" acha "São Paulo"', () => {
    h.deals = [
      comLocal('a', 'Santana — depende de apoio'),
      comLocal('b', 'São Paulo'),
      comLocal('c', 'Guarulhos'),
    ];
    const { result } = renderHook(() => useBoardsController());

    act(() => result.current.setLocalFilter('santana'));
    expect(idsFiltrados(result)).toEqual(['a']);

    act(() => result.current.setLocalFilter('  SAO   paulo '));
    expect(idsFiltrados(result)).toEqual(['b']);
  });

  it('filtro vazio não esconde nada; card sem local some com o filtro preenchido', () => {
    h.deals = [comLocal('a', 'Santana'), comLocal('b', undefined)];
    const { result } = renderHook(() => useBoardsController());

    expect(idsFiltrados(result)).toEqual(['a', 'b']);
    act(() => result.current.setLocalFilter('   '));
    expect(idsFiltrados(result)).toEqual(['a', 'b']);
    act(() => result.current.setLocalFilter('a'));
    expect(idsFiltrados(result)).toEqual(['a']);
  });

  it('soma com o status (Perdidos + "Santana")', () => {
    h.deals = [
      comLocal('aberto', 'Santana'),
      comLocal('perdido', 'Santana', { isLost: true, status: 'stage-perdido' }),
      comLocal('perdido-longe', 'Manaus/AM', { isLost: true, status: 'stage-perdido' }),
    ];
    const { result } = renderHook(() => useBoardsController());

    act(() => {
      result.current.setStatusFilter('lost');
      result.current.setLocalFilter('Santana');
    });
    expect(idsFiltrados(result)).toEqual(['perdido']);
  });

  it('🎯 com 1.000 cards o aviso do teto aparece; com 999, não', () => {
    h.deals = Array.from({ length: 999 }, (_, i) => comLocal(`d${i}`, undefined));
    const { result, rerender } = renderHook(() => useBoardsController());
    expect(result.current.quadroNoTeto).toBe(false);

    h.deals = Array.from({ length: 1000 }, (_, i) => comLocal(`d${i}`, undefined));
    rerender();
    expect(result.current.quadroNoTeto).toBe(true);
  });
});
