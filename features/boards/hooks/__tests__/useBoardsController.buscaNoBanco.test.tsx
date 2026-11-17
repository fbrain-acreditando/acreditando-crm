/**
 * Story 2.74 — o card antigo que a busca acha (controlador com QueryClient REAL).
 *
 * O cache do quadro (`DEALS_VIEW_KEY`) é montado pelo `useDealsByBoard` de
 * verdade, com o `dealsService` simulado. Cobre:
 *   • AC1 — o achado entra no cache e VOLTA depois de qualquer recarga;
 *     limpar a busca / fechar a janela para de reaplicar;
 *   • AC3 — busca → card na coluna certa; perdido há 60 dias com "Todos"
 *     aparece e com "Em aberto" não; mover chama o moveDeal com o card;
 *     termo curto não vai ao banco; digitar rápido = 1 chamada;
 *   • AC4 — `?deal=` fora do cache → getById → abre; no cache → sem getById;
 *     inexistente → aviso; fechar não reabre;
 *   • AC5 — os textos do estado da busca;
 *   • AC6/C1 — o cache do quadro carrega com `ordem: 'atividade'`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEALS_VIEW_KEY } from '@/lib/query/queryKeys';
import type { DealView } from '@/types';

const DIA = 24 * 3600 * 1000;

const h = vi.hoisted(() => {
  const board = {
    id: 'board-1',
    name: 'Funil',
    wonStageId: 'stage-ganho',
    lostStageId: 'stage-perdido',
    stages: [
      { id: 'stage-lead', label: 'Lead novo' },
      { id: 'stage-campanha', label: 'Campanha Novembro' },
      { id: 'stage-ganho', label: 'Ganho', linkedLifecycleStage: 'CUSTOMER' },
      { id: 'stage-perdido', label: 'Perdido', linkedLifecycleStage: 'OTHER' },
    ],
  };
  const mutate = vi.fn();
  const noopMutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
  return {
    board,
    mutate,
    moveMutation: { mutate, mutateAsync: vi.fn(), isPending: false },
    noopMutation,
    searchParams: new URLSearchParams(),
    router: { push: vi.fn(), replace: vi.fn() },
    toast: { addToast: vi.fn() },
    auth: { user: { id: 'user-1' }, loading: false, profile: { id: 'user-1' }, organizationId: 'org-1' },
    ai: { setContext: vi.fn(), clearContext: vi.fn() },
    getAll: vi.fn(),
    searchForBoard: vi.fn(),
    getById: vi.fn(),
    excluir: vi.fn(),
    contatos: [] as Array<{ id: string; name: string; email?: string }>,
  };
});

vi.mock('next/navigation', () => ({
  useSearchParams: () => h.searchParams,
  useRouter: () => h.router,
  usePathname: () => '/boards',
}));
vi.mock('@/lib/query/hooks/useBoardsQuery', () => ({
  useBoards: () => ({ data: [h.board], isLoading: false, isFetched: true, isFetching: false, dataUpdatedAt: 1 }),
  useDefaultBoard: () => ({ data: h.board }),
  useCreateBoard: () => h.noopMutation,
  useUpdateBoard: () => h.noopMutation,
  useDeleteBoard: () => h.noopMutation,
  useDeleteBoardWithMove: () => h.noopMutation,
  useCanDeleteBoard: () => ({ data: undefined }),
}));
vi.mock('@/lib/supabase', () => ({
  dealsService: {
    getAll: (...a: unknown[]) => h.getAll(...a),
    searchForBoard: (...a: unknown[]) => h.searchForBoard(...a),
    getById: (...a: unknown[]) => h.getById(...a),
    delete: (...a: unknown[]) => h.excluir(...a),
  },
  boardStagesService: {
    getAll: async () => ({
      data: h.board.stages.map(s => ({ id: s.id, label: s.label, name: s.label })),
      error: null,
    }),
  },
  contactsService: {
    getByIds: async (ids: string[]) => ({ data: h.contatos.filter(c => ids.includes(c.id)), error: null }),
  },
  companiesService: { getByIds: async () => ({ data: [], error: null }) },
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
vi.mock('@/lib/query/hooks/useLifecycleStagesQuery', () => ({ useLifecycleStages: () => ({ data: [] }) }));
vi.mock('@/lib/query/hooks/useCustomFieldsQuery', () => ({ useCustomFields: () => ({ data: [] }) }));
vi.mock('@/context/AIContext', () => ({ useAI: () => h.ai }));

import { useBoardsController } from '../useBoardsController';
import { dealsViewQueryFn, useDeleteDeal } from '@/lib/query/hooks/useDealsQuery';
import { queryKeys } from '@/lib/query/queryKeys';
import { TEXTOS_DA_BUSCA_NO_BANCO } from '../useCardsDoBanco';

/** Card como o `transformDeal` devolve (antes de enriquecer). */
const deal = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Card ${id}`,
  value: 0,
  status: 'stage-lead',
  boardId: 'board-1',
  contactId: `c-${id}`,
  isWon: false,
  isLost: false,
  createdAt: '2026-11-10T10:00:00Z',
  updatedAt: '2026-11-15T10:00:00Z',
  tags: [],
  items: [],
  customFields: {},
  ...extra,
});

/** QA 2.74 M-1 — ids reais são UUID (o `?deal=` recusa o que não é). */
const ID_NO_QUADRO = '0a0a0a0a-0000-4000-8000-000000000001';
const ID_ANTIGO = '0a0a0a0a-0000-4000-8000-000000000002';
const ID_SUMIU = '0a0a0a0a-0000-4000-8000-000000000003';

const NO_QUADRO = deal(ID_NO_QUADRO, { title: 'Lucia - WhatsApp' });
/** A Joana: criada em agosto, fora dos 1.000; o termo só bate com o NOME DO CONTATO. */
const ANTIGO = deal(ID_ANTIGO, {
  title: 'Lead agosto',
  status: 'stage-campanha',
  contactId: 'c-ale',
  createdAt: '2026-08-10T10:00:00Z',
  updatedAt: '2026-11-16T10:00:00Z',
});

let queryClient: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client: queryClient }, children);

type Controller = ReturnType<typeof useBoardsController>;

async function montar() {
  const r = renderHook(() => useBoardsController(), { wrapper });
  await waitFor(() => expect(r.result.current.filteredDeals.length).toBeGreaterThan(0));
  return r;
}

const idsNoCache = () => (queryClient.getQueryData<DealView[]>(DEALS_VIEW_KEY) ?? []).map(d => d.id);
const ids = (result: { current: Controller }) => result.current.filteredDeals.map(d => d.id);

async function buscar(result: { current: Controller }, termo: string) {
  act(() => result.current.setSearchTerm(termo));
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.searchParams = new URLSearchParams();
  h.mutate.mockClear();
  h.toast.addToast.mockClear();
  h.router.replace.mockClear();
  h.contatos = [{ id: 'c-ale', name: 'Joana Souza' }];
  h.getAll.mockReset().mockResolvedValue({ data: [NO_QUADRO], error: null });
  h.searchForBoard.mockReset().mockResolvedValue({ data: [ANTIGO], error: null });
  h.getById.mockReset().mockResolvedValue({ data: ANTIGO, error: null });
  h.excluir.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => {
  queryClient.clear();
});

describe('AC6 / C1 — o cache do quadro carrega pela última atividade', () => {
  it("🎯 o dealsViewQueryFn chama getAll com ordem 'atividade'", async () => {
    await montar();
    expect(h.getAll).toHaveBeenCalledWith(expect.objectContaining({ ordem: 'atividade' }));
  });
});

describe('AC3 — a busca do quadro procura no banco', () => {
  it('🎯 "joana" (só no nome do contato) → o card antigo aparece, na etapa dele', async () => {
    const { result } = await montar();
    expect(ids(result)).toEqual([ID_NO_QUADRO]);

    await buscar(result, 'joana');
    await waitFor(() => expect(ids(result)).toEqual([ID_ANTIGO]));

    const achado = result.current.filteredDeals[0];
    expect(achado.status).toBe('stage-campanha');
    expect(achado.contactName).toBe('Joana Souza');
    expect(achado.stageLabel).toBe('Campanha Novembro');
    expect(h.searchForBoard).toHaveBeenCalledWith('board-1', 'joana', expect.anything());
    expect(idsNoCache()).toEqual([ID_NO_QUADRO, ID_ANTIGO]);
  });

  it('🎯 perdido mexido há 60 dias: com "Todos" aparece; com "Em aberto" não', async () => {
    const perdido = {
      ...ANTIGO,
      status: 'stage-perdido',
      isLost: true,
      updatedAt: new Date(Date.now() - 60 * DIA).toISOString(),
    };
    h.searchForBoard.mockResolvedValue({ data: [perdido], error: null });
    const { result } = await montar();
    expect(result.current.statusFilter).toBe('all');

    await buscar(result, 'joana');
    await waitFor(() => expect(ids(result)).toEqual([ID_ANTIGO]));

    act(() => result.current.setStatusFilter('open'));
    expect(ids(result)).toEqual([]);

    act(() => result.current.setStatusFilter('lost'));
    expect(ids(result)).toEqual([ID_ANTIGO]);
  });

  it('🎯 mover o card achado chama o moveDeal com ele (não sai cedo por "não achei")', async () => {
    const { result } = await montar();
    await buscar(result, 'joana');
    await waitFor(() => expect(ids(result)).toEqual([ID_ANTIGO]));

    act(() => result.current.handleMoveDealToStage(ID_ANTIGO, 'stage-ganho'));
    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate.mock.calls[0][0]).toMatchObject({
      dealId: ID_ANTIGO,
      targetStageId: 'stage-ganho',
      deal: expect.objectContaining({ id: ID_ANTIGO, status: 'stage-campanha' }),
    });
  });

  it('perder o card achado abre a janela da perda com ele', async () => {
    const { result } = await montar();
    await buscar(result, 'joana');
    await waitFor(() => expect(ids(result)).toEqual([ID_ANTIGO]));

    act(() => result.current.handleMoveDealToStage(ID_ANTIGO, 'stage-perdido'));
    expect(result.current.lossReasonModal).toMatchObject({ isOpen: true, dealId: ID_ANTIGO, dealTitle: 'Lead agosto' });
  });

  it('termo de 2 letras → o serviço NÃO é chamado', async () => {
    const { result } = await montar();
    await buscar(result, 'al');
    await new Promise(r => setTimeout(r, 450));
    expect(h.searchForBoard).not.toHaveBeenCalled();
    expect(result.current.textoDaBusca).toBeNull();
  });

  it('digitar rápido → uma chamada só, depois dos 300 ms', async () => {
    const { result } = await montar();
    await buscar(result, 'ale');
    await buscar(result, 'ales');
    await buscar(result, 'joana');
    await new Promise(r => setTimeout(r, 150));
    expect(h.searchForBoard).not.toHaveBeenCalled();

    await waitFor(() => expect(h.searchForBoard).toHaveBeenCalledTimes(1));
    expect(h.searchForBoard.mock.calls[0][1]).toBe('joana');
    await new Promise(r => setTimeout(r, 400));
    expect(h.searchForBoard).toHaveBeenCalledTimes(1);
  });

  it('a busca no navegador passa a olhar o nome do contato (sem ir ao banco)', async () => {
    h.getAll.mockResolvedValue({ data: [NO_QUADRO, { ...ANTIGO, id: 'carregado' }], error: null });
    h.contatos = [{ id: 'c-ale', name: 'Joana Souza' }];
    h.searchForBoard.mockResolvedValue({ data: [], error: null });
    const { result } = await montar();
    await buscar(result, 'souza');
    expect(ids(result)).toEqual(['carregado']);
  });
});

describe('AC1 — o achado continua no cache depois de qualquer recarga (C2)', () => {
  it('🎯 recarga do cache só com os 1.000 → o card achado volta; limpar a busca → não volta mais', async () => {
    const { result } = await montar();
    await buscar(result, 'joana');
    await waitFor(() => expect(idsNoCache()).toContain(ID_ANTIGO));

    // Prefetch de rota (`usePrefetchRoute`): é FETCH pelo `dealsViewQueryFn`, não setQueryData.
    await act(async () => {
      await queryClient.prefetchQuery({ queryKey: DEALS_VIEW_KEY, queryFn: () => dealsViewQueryFn(), staleTime: 0 });
    });
    await waitFor(() => expect(idsNoCache()).toContain(ID_ANTIGO));

    // Invalidação (contatos, renomear, duplicados): refetch pelo getAll.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
    });
    await waitFor(() => expect(h.getAll.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(idsNoCache()).toContain(ID_ANTIGO));
    expect(ids(result)).toEqual([ID_ANTIGO]);

    // Limpou a busca: na próxima recarga ele não volta.
    await buscar(result, '');
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
    });
    await waitFor(() => expect(idsNoCache()).toEqual([ID_NO_QUADRO]));
    await new Promise(r => setTimeout(r, 50));
    expect(idsNoCache()).toEqual([ID_NO_QUADRO]);
  });

  it('o card que já está no cache não é sobrescrito pela versão do banco', async () => {
    const noCache = { ...ANTIGO, title: 'Versão do cache' };
    h.getAll.mockResolvedValue({ data: [NO_QUADRO, noCache], error: null });
    h.searchForBoard.mockResolvedValue({ data: [{ ...ANTIGO, title: 'Versão do banco' }], error: null });
    const { result } = await montar();
    await buscar(result, 'joana');
    await waitFor(() => expect(h.searchForBoard).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 50));

    const doCache = (queryClient.getQueryData<DealView[]>(DEALS_VIEW_KEY) ?? []).find(d => d.id === ID_ANTIGO);
    expect(doCache?.title).toBe('Versão do cache');
    expect(result.current.textoDaBusca).toBeNull();
  });

  it('ao reaplicar, vence a versão mais nova (a que estava no cache, com otimismo)', async () => {
    const { result } = await montar();
    await buscar(result, 'joana');
    await waitFor(() => expect(idsNoCache()).toContain(ID_ANTIGO));

    // Otimismo/Realtime: o card mudou de etapa no cache, com updatedAt mais novo.
    act(() => {
      queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, old =>
        (old ?? []).map(d =>
          d.id === ID_ANTIGO ? { ...d, status: 'stage-ganho', updatedAt: '2026-11-17T10:00:00Z' } : d
        )
      );
    });
    // Recarga do banco (sem o card) logo em seguida.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
    });
    await waitFor(() => expect(h.getAll.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(idsNoCache()).toContain(ID_ANTIGO));
    const reaplicado = (queryClient.getQueryData<DealView[]>(DEALS_VIEW_KEY) ?? []).find(d => d.id === ID_ANTIGO);
    expect(reaplicado?.status).toBe('stage-ganho');
  });
});

describe('QA 2.74 B1 — excluir um card trazido do banco: ele NÃO volta', () => {
  function montarComExcluir() {
    return renderHook(() => ({ c: useBoardsController(), excluir: useDeleteDeal() }), { wrapper });
  }

  it('🎯 busca → excluir (useDeleteDeal real: onMutate + onSettled) → sai do cache e não volta', async () => {
    const { result } = montarComExcluir();
    await waitFor(() => expect(result.current.c.filteredDeals.length).toBeGreaterThan(0));
    act(() => result.current.c.setSearchTerm('joana'));
    await waitFor(() => expect(idsNoCache()).toContain(ID_ANTIGO));

    // Pior caso: a busca no banco ainda devolve o card até refazer a consulta.
    await act(async () => {
      await result.current.excluir.mutateAsync(ID_ANTIGO);
    });
    expect(h.excluir).toHaveBeenCalledWith(ID_ANTIGO);
    expect(idsNoCache()).toEqual([ID_NO_QUADRO]);

    // onSettled invalida deals.all → refetch do quadro (e da busca).
    await waitFor(() => expect(h.getAll.mock.calls.length).toBeGreaterThanOrEqual(2));
    await new Promise(r => setTimeout(r, 100));
    expect(idsNoCache()).toEqual([ID_NO_QUADRO]);
    expect(result.current.c.filteredDeals.map(d => d.id)).toEqual([]);

    // Nem numa recarga seguinte.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
    });
    await new Promise(r => setTimeout(r, 50));
    expect(idsNoCache()).toEqual([ID_NO_QUADRO]);
  });

  it('exclusão EM VOO (onMutate já tirou o card) + recarga com a busca ainda devolvendo → não volta', async () => {
    let responder: (v: unknown) => void = () => {};
    h.excluir.mockImplementation(() => new Promise(r => { responder = r; }));
    const { result } = montarComExcluir();
    await waitFor(() => expect(result.current.c.filteredDeals.length).toBeGreaterThan(0));
    act(() => result.current.c.setSearchTerm('joana'));
    await waitFor(() => expect(idsNoCache()).toContain(ID_ANTIGO));

    let pendente: Promise<unknown> = Promise.resolve();
    act(() => {
      pendente = result.current.excluir.mutateAsync(ID_ANTIGO);
    });
    await waitFor(() => expect(idsNoCache()).toEqual([ID_NO_QUADRO]));

    // Recarga do banco no meio da exclusão (foco/invalidação de outra tela).
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
    });
    await waitFor(() => expect(h.getAll.mock.calls.length).toBeGreaterThanOrEqual(2));
    await new Promise(r => setTimeout(r, 50));
    expect(idsNoCache()).toEqual([ID_NO_QUADRO]);

    await act(async () => {
      responder({ error: null });
      await pendente;
    });
    await new Promise(r => setTimeout(r, 100));
    expect(idsNoCache()).toEqual([ID_NO_QUADRO]);
  });

  it('o card aberto pelo ?deal= e excluído também não volta', async () => {
    h.searchParams = new URLSearchParams(`deal=${ID_ANTIGO}`);
    const { result } = montarComExcluir();
    await waitFor(() => expect(result.current.c.selectedDealId).toBe(ID_ANTIGO));

    await act(async () => {
      await result.current.excluir.mutateAsync(ID_ANTIGO);
    });
    await waitFor(() => expect(h.getAll.mock.calls.length).toBeGreaterThanOrEqual(2));
    await new Promise(r => setTimeout(r, 100));
    expect(idsNoCache()).toEqual([ID_NO_QUADRO]);
  });

  it('exclusão que FALHA (rollback do onError) → o card volta e segue protegido nas recargas', async () => {
    h.excluir.mockResolvedValue({ error: new Error('sem permissão') });
    const { result } = montarComExcluir();
    await waitFor(() => expect(result.current.c.filteredDeals.length).toBeGreaterThan(0));
    act(() => result.current.c.setSearchTerm('joana'));
    await waitFor(() => expect(idsNoCache()).toContain(ID_ANTIGO));

    await act(async () => {
      await result.current.excluir.mutateAsync(ID_ANTIGO).catch(() => undefined);
    });
    await waitFor(() => expect(h.getAll.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(idsNoCache()).toContain(ID_ANTIGO));
    await new Promise(r => setTimeout(r, 50));
    expect(idsNoCache()).toContain(ID_ANTIGO);
  });

  it('C2 continua: mover/perder (escrita otimista que mantém o card) + refetch → segue no quadro, na etapa nova', async () => {
    const { result } = await montar();
    await buscar(result, 'joana');
    await waitFor(() => expect(idsNoCache()).toContain(ID_ANTIGO));

    act(() => {
      queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, old =>
        (old ?? []).map(d =>
          d.id === ID_ANTIGO ? { ...d, status: 'stage-perdido', isLost: true, updatedAt: '2026-11-17T12:00:00Z' } : d
        )
      );
    });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
    });
    await waitFor(() => expect(h.getAll.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(idsNoCache()).toContain(ID_ANTIGO));
    const card = (queryClient.getQueryData<DealView[]>(DEALS_VIEW_KEY) ?? []).find(d => d.id === ID_ANTIGO);
    expect(card?.status).toBe('stage-perdido');
  });
});

describe('AC4 — ?deal=<id> abre qualquer card', () => {
  it('🎯 id fora do cache → getById uma vez → acrescenta e abre a janela', async () => {
    h.searchParams = new URLSearchParams(`deal=${ID_ANTIGO}`);
    const { result } = renderHook(() => useBoardsController(), { wrapper });

    await waitFor(() => expect(result.current.selectedDealId).toBe(ID_ANTIGO));
    expect(h.getById).toHaveBeenCalledTimes(1);
    expect(h.getById).toHaveBeenCalledWith(ID_ANTIGO);
    const card = (queryClient.getQueryData<DealView[]>(DEALS_VIEW_KEY) ?? []).find(d => d.id === ID_ANTIGO);
    expect(card?.title).toBe('Lead agosto');
    expect(card?.contactName).toBe('Joana Souza');
    expect(h.router.replace).toHaveBeenCalledWith('/boards', { scroll: false });
  });

  it('o getById só roda DEPOIS da 1ª carga do quadro', async () => {
    let liberar: (v: unknown) => void = () => {};
    h.getAll.mockReturnValue(new Promise(r => { liberar = r; }));
    h.searchParams = new URLSearchParams(`deal=${ID_ANTIGO}`);
    const { result } = renderHook(() => useBoardsController(), { wrapper });

    await new Promise(r => setTimeout(r, 50));
    expect(h.getById).not.toHaveBeenCalled();

    await act(async () => liberar({ data: [NO_QUADRO], error: null }));
    await waitFor(() => expect(result.current.selectedDealId).toBe(ID_ANTIGO));
    expect(h.getById).toHaveBeenCalledTimes(1);
  });

  it('id no cache → getById NÃO é chamado', async () => {
    h.searchParams = new URLSearchParams(`deal=${ID_NO_QUADRO}`);
    const { result } = renderHook(() => useBoardsController(), { wrapper });
    await waitFor(() => expect(result.current.selectedDealId).toBe(ID_NO_QUADRO));
    expect(h.getById).not.toHaveBeenCalled();
  });

  it('🎯 excluído/inexistente → aviso "não existe", nada abre', async () => {
    h.getById.mockResolvedValue({ data: null, error: null });
    h.searchParams = new URLSearchParams(`deal=${ID_SUMIU}`);
    const { result } = renderHook(() => useBoardsController(), { wrapper });

    await waitFor(() =>
      expect(h.toast.addToast).toHaveBeenCalledWith('Este card não existe mais ou foi excluído.', 'warning')
    );
    expect(result.current.selectedDealId).toBeNull();
  });

  it('QA M-1 — id que não é UUID → aviso "não existe", sem ir ao banco', async () => {
    h.searchParams = new URLSearchParams('deal=nao-e-uuid');
    const { result } = renderHook(() => useBoardsController(), { wrapper });

    await waitFor(() =>
      expect(h.toast.addToast).toHaveBeenCalledWith('Este card não existe mais ou foi excluído.', 'warning')
    );
    expect(h.getById).not.toHaveBeenCalled();
    expect(result.current.selectedDealId).toBeNull();
  });

  it('erro → aviso "não deu para abrir", nada abre', async () => {
    h.getById.mockResolvedValue({ data: null, error: new Error('rede') });
    h.searchParams = new URLSearchParams(`deal=${ID_ANTIGO}`);
    const { result } = renderHook(() => useBoardsController(), { wrapper });

    await waitFor(() =>
      expect(h.toast.addToast).toHaveBeenCalledWith('Não deu para abrir este card. Tente de novo.', 'error')
    );
    expect(result.current.selectedDealId).toBeNull();
  });

  it('fechar a janela não reabre (guarda da 2.27) e o card deixa de ser reaplicado', async () => {
    h.searchParams = new URLSearchParams(`deal=${ID_ANTIGO}`);
    const { result, rerender } = renderHook(() => useBoardsController(), { wrapper });
    await waitFor(() => expect(result.current.selectedDealId).toBe(ID_ANTIGO));

    act(() => result.current.setSelectedDealId(null));
    rerender();
    await new Promise(r => setTimeout(r, 50));
    expect(result.current.selectedDealId).toBeNull();
    expect(h.getById).toHaveBeenCalledTimes(1);

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
    });
    await waitFor(() => expect(idsNoCache()).toEqual([ID_NO_QUADRO]));
  });

  it('enquanto a janela está aberta, o card do ?deal= sobrevive à recarga', async () => {
    h.searchParams = new URLSearchParams(`deal=${ID_ANTIGO}`);
    const { result } = renderHook(() => useBoardsController(), { wrapper });
    await waitFor(() => expect(result.current.selectedDealId).toBe(ID_ANTIGO));

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
    });
    await waitFor(() => expect(h.getAll.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(idsNoCache()).toContain(ID_ANTIGO));
  });
});

describe('AC5 — estado da busca na tela', () => {
  it('🎯 "Procurando…" enquanto o banco responde, depois "Inclui 1 card mais antigo…"', async () => {
    let responder: (v: unknown) => void = () => {};
    h.searchForBoard.mockReturnValue(new Promise(r => { responder = r; }));
    const { result } = await montar();

    await buscar(result, 'joana');
    expect(result.current.textoDaBusca).toBe('Procurando também nos cards mais antigos…');
    await waitFor(() => expect(h.searchForBoard).toHaveBeenCalled());
    expect(result.current.textoDaBusca).toBe('Procurando também nos cards mais antigos…');

    await act(async () => responder({ data: [ANTIGO], error: null }));
    await waitFor(() =>
      expect(result.current.textoDaBusca).toBe('Inclui 1 card mais antigo encontrado no banco.')
    );
  });

  it('2 achados fora → plural', async () => {
    h.searchForBoard.mockResolvedValue({ data: [ANTIGO, { ...ANTIGO, id: 'antigo-2' }], error: null });
    const { result } = await montar();
    await buscar(result, 'joana');
    await waitFor(() =>
      expect(result.current.textoDaBusca).toBe('Inclui 2 cards mais antigos encontrados no banco.')
    );
  });

  it('🎯 bateu 50 → "Mostrando os 50 mais recentes…"', async () => {
    h.searchForBoard.mockResolvedValue({
      data: Array.from({ length: 50 }, (_, i) => ({ ...ANTIGO, id: `antigo-${i}` })),
      error: null,
    });
    const { result } = await montar();
    await buscar(result, 'joana');
    await waitFor(() =>
      expect(result.current.textoDaBusca).toBe(
        'Mostrando os 50 mais recentes encontrados no banco. Digite mais para refinar.'
      )
    );
  });

  it('🎯 erro → "Não deu para procurar…" e a busca no navegador continua', async () => {
    h.searchForBoard.mockResolvedValue({ data: null, error: new Error('falhou') });
    const { result } = await montar();
    await buscar(result, 'lucia');
    await waitFor(() =>
      expect(result.current.textoDaBusca).toBe(
        'Não deu para procurar nos cards mais antigos. Mostrando só os carregados.'
      )
    );
    expect(ids(result)).toEqual([ID_NO_QUADRO]);
  });

  it('os textos exportados são os literais da story', () => {
    expect(TEXTOS_DA_BUSCA_NO_BANCO.procurando).toBe('Procurando também nos cards mais antigos…');
    expect(TEXTOS_DA_BUSCA_NO_BANCO.inclui(1)).toBe('Inclui 1 card mais antigo encontrado no banco.');
    expect(TEXTOS_DA_BUSCA_NO_BANCO.inclui(3)).toBe('Inclui 3 cards mais antigos encontrados no banco.');
  });
});

/**
 * QA 2.74 re-gate (C-3) — rollback de OUTRA mutação com snapshot tirado ANTES
 * de o card trazido do banco chegar. O `onError` faz `setQueryData(snapshot)`
 * (escrita manual) e o card some do cache; hoje isso é lido como "excluído":
 * ele ia para `removidos` e não voltava nem com a busca repetida, até recarregar
 * a página. Corrigido (rodada 2 do QA Loop): só conta como exclusão se ESTE
 * card está sendo excluído (`useDeleteDeal` em voo no MutationCache).
 */
describe('QA 2.74 C-3 — rollback com snapshot anterior ao card não pode escondê-lo', () => {
  it('rollback (setQueryData do snapshot antigo) → o card volta na próxima recarga', async () => {
    const { result } = await montar();
    const snapshot = queryClient.getQueryData<DealView[]>(DEALS_VIEW_KEY);
    await buscar(result, 'joana');
    await waitFor(() => expect(idsNoCache()).toContain(ID_ANTIGO));

    act(() => {
      queryClient.setQueryData(DEALS_VIEW_KEY, snapshot);
    });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
    });
    await new Promise(r => setTimeout(r, 100));
    expect(idsNoCache()).toContain(ID_ANTIGO);
    expect(ids(result)).toEqual([ID_ANTIGO]);
  });

  it('caminho real: excluir OUTRO card falha depois que a busca acrescentou o antigo', async () => {
    let responder: (v: unknown) => void = () => {};
    h.excluir.mockImplementation(() => new Promise(r => { responder = r; }));
    const { result } = renderHook(() => ({ c: useBoardsController(), excluir: useDeleteDeal() }), { wrapper });
    await waitFor(() => expect(result.current.c.filteredDeals.length).toBeGreaterThan(0));

    let pendente: Promise<unknown> = Promise.resolve();
    act(() => {
      pendente = result.current.excluir.mutateAsync(ID_NO_QUADRO).catch(() => undefined);
    });
    await new Promise(r => setTimeout(r, 20));
    act(() => result.current.c.setSearchTerm('joana'));
    await waitFor(() => expect(idsNoCache()).toContain(ID_ANTIGO));

    await act(async () => {
      responder({ error: new Error('rede') });
      await pendente;
    });
    await new Promise(r => setTimeout(r, 150));
    expect(idsNoCache()).toContain(ID_ANTIGO);
  });
});
