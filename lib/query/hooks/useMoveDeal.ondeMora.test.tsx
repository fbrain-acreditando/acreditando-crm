/**
 * Story 2.67 (AC7) — "Onde mora" e a observação vão na MESMA escrita da perda.
 * Sucede o teste da 2.66 (`useMoveDeal.localDaPerda.test.tsx`).
 *
 * - O local é da PESSOA: truthy, vazio não apaga, outro movimento não toca.
 * - A observação é da PERDA (S9): toda perda a regrava (texto ou `null`);
 *   mudar de etapa, reabrir ou ganhar não levam a chave.
 *
 * Tudo afirmado no objeto que chega a `dealsService.update`: é ele que vira o
 * UPDATE (`transformDealToDb` só manda as chaves presentes — ver
 * `lib/supabase/ondeMora.test.ts`).
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
  leadLocation: 'Santana',
  customFields: { ondeReside: 'Zona Leste' },
} as unknown as Deal;

const perdidoComTudo = {
  ...aberto,
  status: 'stage-perdido',
  isLost: true,
  lossReason: 'Distância',
  lossNote: 'observação da perda antiga',
} as unknown as Deal;

function montar(cache: Deal = aberto) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, [cache as unknown as DealView]);
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

describe('AC7 — local e observação na mesma escrita da perda', () => {
  it('🎯 "Sem interação" com local alterado e observação ⇒ UMA chamada com os três, sem customFields e sem lossLocation', async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useMoveDeal(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        dealId: 'deal-1',
        targetStageId: 'stage-perdido',
        lossReason: 'Lead sem interação',
        leadLocation: 'Santana — depende de apoio',
        lossNote: 'não tem como vir sozinho',
        deal: aberto,
        board,
      });
    });

    const updates = unicoUpdate();
    expect(updates.lossReason).toBe('Lead sem interação');
    expect(updates.leadLocation).toBe('Santana — depende de apoio');
    expect(updates.lossNote).toBe('não tem como vir sozinho');
    expect(updates.isLost).toBe(true);
    expect(updates).not.toHaveProperty('customFields');
    expect(updates).not.toHaveProperty('lossLocation');
  });

  it('🎯 S9 — perda sem observação ⇒ lossNote: null (apaga a de uma perda antiga)', async () => {
    const { wrapper } = montar(perdidoComTudo);
    const { result } = renderHook(() => useMoveDeal(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        dealId: 'deal-1',
        targetStageId: 'stage-perdido',
        lossReason: 'Preço muito alto',
        lossNote: '',
        deal: perdidoComTudo,
        board,
      });
    });

    const updates = unicoUpdate();
    expect(updates).toHaveProperty('lossNote', null);
    expect(updates).not.toHaveProperty('leadLocation');
  });

  it('perda sem a chave lossNote (chamada antiga) também grava lossNote: null', async () => {
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

    expect(unicoUpdate()).toHaveProperty('lossNote', null);
  });

  it('a atividade diz "Motivo da perda: … · Onde mora: … · Observação: …"', async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useMoveDeal(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        dealId: 'deal-1',
        targetStageId: 'stage-perdido',
        lossReason: 'Distância',
        leadLocation: 'Guarulhos',
        lossNote: 'depende do filho',
        deal: aberto,
        board,
      });
    });

    const atividade = criarAtividade.mock.calls[0][0] as { description?: string };
    expect(atividade.description).toBe('Motivo da perda: Distância · Onde mora: Guarulhos · Observação: depende do filho');
  });

  it('sem local e sem observação, a atividade continua como antes', async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useMoveDeal(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        dealId: 'deal-1',
        targetStageId: 'stage-perdido',
        lossReason: 'Distância',
        lossNote: '',
        deal: aberto,
        board,
      });
    });

    const atividade = criarAtividade.mock.calls[0][0] as { description?: string };
    expect(atividade.description).toBe('Motivo da perda: Distância');
  });

  it('otimista: o card no DEALS_VIEW_KEY mostra local e observação antes do servidor responder', async () => {
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
        leadLocation: 'Guarulhos',
        lossNote: 'sem apoio',
        deal: aberto,
        board,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    const noCache = queryClient.getQueryData<DealView[]>(DEALS_VIEW_KEY)?.[0];
    expect(noCache?.leadLocation).toBe('Guarulhos');
    expect(noCache?.lossNote).toBe('sem apoio');

    await act(async () => {
      liberar({ error: null });
      await promessa;
    });
  });
});

describe('AC7 — useMoveDealSimple: 6º e 7º parâmetros opcionais', () => {
  it('🎯 chamada antiga com 5 argumentos gera o update sem leadLocation (e a perda zera a observação)', async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useMoveDealSimple(board), { wrapper });

    await act(async () => {
      await result.current.moveDeal(aberto, 'stage-lead', 'Preço muito alto', false, true);
    });

    const updates = unicoUpdate();
    expect(updates.lossReason).toBe('Preço muito alto');
    expect(updates.isLost).toBe(true);
    expect(updates).not.toHaveProperty('leadLocation');
    expect(updates).toHaveProperty('lossNote', null);
  });

  it('o 6º (local) e o 7º (observação) chegam ao update', async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useMoveDealSimple(board), { wrapper });

    await act(async () => {
      await result.current.moveDeal(aberto, 'stage-perdido', 'Distância', undefined, undefined, 'Rondônia', 'mora longe');
    });

    const updates = unicoUpdate();
    expect(updates.lossReason).toBe('Distância');
    expect(updates.leadLocation).toBe('Rondônia');
    expect(updates.lossNote).toBe('mora longe');
  });
});

describe('AC7 — mudar de etapa não toca em local nem observação', () => {
  it('🎯 mover para etapa comum ⇒ sem as chaves lossNote e leadLocation', async () => {
    const { wrapper } = montar(perdidoComTudo);
    const { result } = renderHook(() => useMoveDealSimple(board), { wrapper });

    await act(async () => {
      await result.current.moveDeal(perdidoComTudo, 'stage-lead');
    });

    const updates = unicoUpdate();
    expect(updates.isLost).toBe(false);
    expect(updates).not.toHaveProperty('lossNote');
    expect(updates).not.toHaveProperty('leadLocation');
  });

  it('marcar ganho não leva lossNote nem leadLocation', async () => {
    const { wrapper } = montar(perdidoComTudo);
    const { result } = renderHook(() => useMoveDealSimple(board), { wrapper });

    await act(async () => {
      await result.current.moveDeal(perdidoComTudo, 'stage-ganho');
    });

    const updates = unicoUpdate();
    expect(updates.isWon).toBe(true);
    expect(updates).not.toHaveProperty('lossNote');
    expect(updates).not.toHaveProperty('leadLocation');
  });

  it('mover entre etapas comuns com uma observação "sobrando" não a grava', async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useMoveDeal(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        dealId: 'deal-1',
        targetStageId: 'stage-lead',
        lossNote: 'não deveria ir',
        deal: aberto,
        board,
      });
    });

    expect(unicoUpdate()).not.toHaveProperty('lossNote');
  });

  it('perder de novo com o local vazio NÃO apaga o local anterior', async () => {
    const { wrapper } = montar(perdidoComTudo);
    const { result } = renderHook(() => useMoveDeal(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        dealId: 'deal-1',
        targetStageId: 'stage-perdido',
        lossReason: 'Distância',
        leadLocation: '',
        lossNote: '',
        deal: perdidoComTudo,
        board,
      });
    });

    expect(unicoUpdate()).not.toHaveProperty('leadLocation');
  });
});
