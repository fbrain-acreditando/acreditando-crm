/**
 * Story 2.66 (QA TEST-001) — o caminho do QUADRO repassa o local da perda.
 *
 * O gate do @qa mostrou que tirar o repasse de `extras.lossLocation` em
 * `useBoardsController.handleLossReasonConfirm` deixava a suíte inteira verde
 * (mutação M3). Este arquivo cobre os dois caminhos do quadro que abrem o modal
 * da perda — arrastar o card (`handleDrop`) e o teclado (`handleMoveDealToStage`)
 * — e afirma o VALOR que chega a `moveDealMutation.mutate`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
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
    customFields: { ondeReside: 'Zona Leste' },
  };
  const mutate = vi.fn();
  const noopMutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
  return {
    board,
    deal,
    boards: [board],
    deals: [deal],
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

describe('Story 2.66 — o quadro repassa o local da perda (QA TEST-001)', () => {
  beforeEach(() => {
    h.mutate.mockClear();
  });

  describe.each(caminhos)('%s', (_nome, abrir) => {
    it('abre o modal sem mover nada e com a dica do ondeReside', () => {
      const { result } = renderHook(() => useBoardsController());
      abrir(result);

      expect(h.mutate).not.toHaveBeenCalled();
      expect(result.current.lossReasonModal).toMatchObject({
        isOpen: true,
        dealId: 'deal-1',
        stageId: 'stage-perdido',
        localSugerido: 'Zona Leste',
      });
    });

    it('motivo "Distância" + local: o moveDeal recebe lossLocation "Manaus/AM"', () => {
      const { result } = renderHook(() => useBoardsController());
      abrir(result);

      act(() => {
        result.current.handleLossReasonConfirm('Distância', { lossLocation: 'Manaus/AM' });
      });

      expect(h.mutate).toHaveBeenCalledTimes(1);
      const payload = h.mutate.mock.calls[0][0];
      expect(payload).toMatchObject({
        dealId: 'deal-1',
        targetStageId: 'stage-perdido',
        lossReason: 'Distância',
        lossLocation: 'Manaus/AM',
      });
      expect(payload.lossLocation).toBe('Manaus/AM');
      expect(result.current.lossReasonModal).toBeNull();
    });

    it('sem local: a chave lossLocation nem vai no payload', () => {
      const { result } = renderHook(() => useBoardsController());
      abrir(result);

      act(() => {
        result.current.handleLossReasonConfirm('Preço');
      });

      expect(h.mutate).toHaveBeenCalledTimes(1);
      const payload = h.mutate.mock.calls[0][0];
      expect(payload.lossReason).toBe('Preço');
      expect(payload).not.toHaveProperty('lossLocation');
    });

    it('a dica do ondeReside nunca vira o local gravado', () => {
      const { result } = renderHook(() => useBoardsController());
      abrir(result);

      act(() => {
        result.current.handleLossReasonConfirm('Distância');
      });

      expect(h.mutate.mock.calls[0][0]).not.toHaveProperty('lossLocation');
    });
  });
});
