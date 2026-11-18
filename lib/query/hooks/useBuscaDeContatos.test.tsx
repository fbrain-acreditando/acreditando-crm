/**
 * Story 2.76 (AC3) — `useBuscaDeContatos`: espera 300 ms, só termo útil vai ao
 * banco, chave debaixo de `contacts.all`. QueryClient real; serviço simulado.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Contact } from '@/types';

const h = vi.hoisted(() => ({ buscarParaSelecao: vi.fn() }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false, profile: null, organizationId: 'org1' }),
}));
vi.mock('@/lib/supabase', () => ({ contactsService: { buscarParaSelecao: h.buscarParaSelecao } }));

import { useBuscaDeContatos, chaveDaBuscaDeContatos } from './useBuscaDeContatos';
import { queryKeys } from '@/lib/query/queryKeys';

const contato = (id: string): Contact => ({
  id,
  name: 'Contato de Teste',
  email: '',
  phone: '',
  status: 'ACTIVE',
  stage: 'lc-1',
  createdAt: '2026-01-01T00:00:00Z',
});

describe('useBuscaDeContatos (story 2.76, AC3)', () => {
  let queryClient: QueryClient;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    h.buscarParaSelecao.mockReset();
    h.buscarParaSelecao.mockResolvedValue({ data: [contato('c-1')], error: null });
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => vi.useRealTimers());

  it('3 teclas em menos de 300 ms → 1 chamada, com o termo final', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result, rerender } = renderHook(({ t }) => useBuscaDeContatos(t), {
      wrapper,
      initialProps: { t: 'Ana' },
    });
    act(() => vi.advanceTimersByTime(100));
    rerender({ t: 'Ana ' });
    act(() => vi.advanceTimersByTime(100));
    rerender({ t: 'Ana S' });
    act(() => vi.advanceTimersByTime(100));
    rerender({ t: 'Ana Si' });
    expect(h.buscarParaSelecao).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    vi.useRealTimers();
    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(h.buscarParaSelecao).toHaveBeenCalledTimes(1);
    expect(h.buscarParaSelecao.mock.calls[0][0]).toBe('Ana Si');
    expect(h.buscarParaSelecao.mock.calls[0][1]).toMatchObject({ limite: 8 });
    expect(result.current.contatos.map(c => c.id)).toEqual(['c-1']);
  });

  it('termo curto → 0 chamadas e termoCurto: true', async () => {
    const { result } = renderHook(() => useBuscaDeContatos('ab'), { wrapper });
    await new Promise(r => setTimeout(r, 400));
    expect(h.buscarParaSelecao).not.toHaveBeenCalled();
    expect(result.current).toEqual({ contatos: [], carregando: false, erro: false, termoCurto: true, resultadoDoTermoAtual: false });
  });

  it('termo vazio → nada, sem termoCurto', async () => {
    const { result } = renderHook(() => useBuscaDeContatos('  '), { wrapper });
    await new Promise(r => setTimeout(r, 400));
    expect(h.buscarParaSelecao).not.toHaveBeenCalled();
    expect(result.current.termoCurto).toBe(false);
  });

  it('limite repassado e enabled: false não consulta', async () => {
    const r1 = renderHook(() => useBuscaDeContatos('Ana', { limite: 1 }), { wrapper });
    await waitFor(() => expect(r1.result.current.carregando).toBe(false));
    expect(h.buscarParaSelecao.mock.calls[0][1]).toMatchObject({ limite: 1 });
    h.buscarParaSelecao.mockClear();
    renderHook(() => useBuscaDeContatos('Maria', { enabled: false }), { wrapper });
    await new Promise(r => setTimeout(r, 400));
    expect(h.buscarParaSelecao).not.toHaveBeenCalled();
  });

  it('a chave começa com queryKeys.contacts.all', async () => {
    expect(chaveDaBuscaDeContatos('Ana', 8)).toEqual(['contacts', 'busca', 'Ana', 8]);
    const r = renderHook(() => useBuscaDeContatos('Ana'), { wrapper });
    await waitFor(() => expect(r.result.current.carregando).toBe(false));
    const comDado = queryClient
      .getQueryCache()
      .findAll({ queryKey: queryKeys.contacts.all })
      .filter(q => q.state.data !== undefined);
    expect(comDado.map(q => q.queryKey)).toEqual([[...queryKeys.contacts.all, 'busca', 'Ana', 8]]);
  });

  it('erro → erro: true, sem lançar', async () => {
    h.buscarParaSelecao.mockResolvedValue({ data: null, error: new Error('falhou') });
    const { result } = renderHook(() => useBuscaDeContatos('Ana'), { wrapper });
    await waitFor(() => expect(result.current.erro).toBe(true));
    expect(result.current.contatos).toEqual([]);
  });
});
