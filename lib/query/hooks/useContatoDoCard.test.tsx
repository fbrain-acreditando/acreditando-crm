/**
 * Story 2.75 (AC2) — `useContatoDoCard`: lista primeiro, senão busca pelo id.
 * QueryClient real; só o `contactsService.getByIds` é simulado.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Contact } from '@/types';

const h = vi.hoisted(() => ({
  getByIds: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false, profile: null, organizationId: 'org1' }),
}));

vi.mock('@/lib/supabase', () => ({
  contactsService: { getByIds: h.getByIds },
}));

import { useContatoDoCard, chaveDoContatoDoCard } from './useContatoDoCard';
import { queryKeys } from '@/lib/query/queryKeys';

const contato = (id: string, extra: Partial<Contact> = {}): Contact => ({
  id,
  name: 'Contato de Teste',
  email: '',
  phone: '+5500000000000',
  status: 'ACTIVE',
  stage: 'lc-1',
  createdAt: '2026-01-01T00:00:00Z',
  ...extra,
});

const NA_LISTA = contato('11111111-1111-4111-8111-111111111111');
const ANTIGO = contato('22222222-2222-4222-8222-222222222222');

describe('useContatoDoCard (story 2.75)', () => {
  let queryClient: QueryClient;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    h.getByIds.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('na lista: devolve o contato da lista e não consulta o banco', async () => {
    const { result } = renderHook(
      () => useContatoDoCard(NA_LISTA.id, { data: [NA_LISTA], isFetched: true, isError: false }),
      { wrapper }
    );
    expect(result.current).toEqual({ contato: NA_LISTA, carregando: false, erro: false });
    // dá tempo a um eventual fetch disparar
    await new Promise(r => setTimeout(r, 20));
    expect(h.getByIds).not.toHaveBeenCalled();
  });

  it('fora da lista: busca uma vez pelo id e devolve o contato', async () => {
    h.getByIds.mockResolvedValue({ data: [ANTIGO], error: null });
    const { result } = renderHook(
      () => useContatoDoCard(ANTIGO.id, { data: [NA_LISTA], isFetched: true, isError: false }),
      { wrapper }
    );
    expect(result.current.carregando).toBe(true);
    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(result.current).toEqual({ contato: ANTIGO, carregando: false, erro: false });
    expect(h.getByIds).toHaveBeenCalledTimes(1);
    expect(h.getByIds.mock.calls[0][0]).toEqual([ANTIGO.id]);
    expect(h.getByIds.mock.calls[0][1]).toHaveProperty('signal');
  });

  it.each([undefined, null, ''])('sem id (%s): nada, sem consulta', async id => {
    const { result } = renderHook(
      () => useContatoDoCard(id, { data: [NA_LISTA], isFetched: true, isError: false }),
      { wrapper }
    );
    expect(result.current).toEqual({ contato: null, carregando: false, erro: false });
    await new Promise(r => setTimeout(r, 20));
    expect(h.getByIds).not.toHaveBeenCalled();
  });

  it('lista ainda carregando: espera, sem consulta', async () => {
    const { result } = renderHook(
      () => useContatoDoCard(ANTIGO.id, { data: undefined, isFetched: false, isError: false }),
      { wrapper }
    );
    expect(result.current).toEqual({ contato: null, carregando: true, erro: false });
    await new Promise(r => setTimeout(r, 20));
    expect(h.getByIds).not.toHaveBeenCalled();
  });

  it('excluído: getByIds devolve vazio → contato null, sem erro', async () => {
    h.getByIds.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(
      () => useContatoDoCard(ANTIGO.id, { data: [], isFetched: true, isError: false }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(result.current).toEqual({ contato: null, carregando: false, erro: false });
  });

  it('erro na busca: erro true, contato null, sem lançar para fora', async () => {
    h.getByIds.mockResolvedValue({ data: null, error: new Error('falha simulada') });
    const { result } = renderHook(
      () => useContatoDoCard(ANTIGO.id, { data: [], isFetched: true, isError: false }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.erro).toBe(true));
    expect(result.current).toEqual({ contato: null, carregando: false, erro: true });
  });

  it('lista com erro e sem dados: cai na busca por id', async () => {
    h.getByIds.mockResolvedValue({ data: [ANTIGO], error: null });
    const { result } = renderHook(
      () => useContatoDoCard(ANTIGO.id, { data: undefined, isFetched: false, isError: true }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.contato).toEqual(ANTIGO));
    expect(h.getByIds).toHaveBeenCalledTimes(1);
  });

  it('chave: debaixo de contacts.all e diferente de contacts.detail(id)', async () => {
    h.getByIds.mockResolvedValue({ data: [ANTIGO], error: null });
    const { result } = renderHook(
      () => useContatoDoCard(ANTIGO.id, { data: [], isFetched: true, isError: false }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.contato).toEqual(ANTIGO));

    const chaves = queryClient.getQueryCache().getAll().map(q => q.queryKey);
    expect(chaves).toEqual([[...queryKeys.contacts.all, 'do-card', ANTIGO.id]]);
    expect(chaveDoContatoDoCard(ANTIGO.id)).toEqual(['contacts', 'do-card', ANTIGO.id]);
    expect(chaves[0].slice(0, queryKeys.contacts.all.length)).toEqual([...queryKeys.contacts.all]);
    expect(chaves[0]).not.toEqual([...queryKeys.contacts.detail(ANTIGO.id)]);
  });
});
