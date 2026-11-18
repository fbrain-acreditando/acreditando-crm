/**
 * Story 2.76 (AC5) — `useContatosPorIds`: lista primeiro, os faltantes numa
 * única chamada ao `getByIds`. QueryClient real; só o serviço é simulado.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Contact } from '@/types';

const h = vi.hoisted(() => ({ getByIds: vi.fn() }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false, profile: null, organizationId: 'org1' }),
}));
vi.mock('@/lib/supabase', () => ({ contactsService: { getByIds: h.getByIds } }));

import { useContatosPorIds, chaveDosContatosPorIds } from './useContatosPorIds';
import { queryKeys } from '@/lib/query/queryKeys';

const contato = (id: string, extra: Partial<Contact> = {}): Contact => ({
  id,
  name: `Contato ${id}`,
  email: '',
  phone: '+5500000000000',
  status: 'ACTIVE',
  stage: 'lc-1',
  createdAt: '2026-01-01T00:00:00Z',
  ...extra,
});

const pronta = (data: Contact[]) => ({ data, isFetched: true, isError: false });
const esperar = () => new Promise(r => setTimeout(r, 20));

describe('useContatosPorIds (story 2.76, AC5)', () => {
  let queryClient: QueryClient;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    h.getByIds.mockReset();
    h.getByIds.mockImplementation(async (ids: string[]) => ({ data: ids.map(id => contato(id)), error: null }));
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('todos na lista → 0 chamadas, contatos da lista', async () => {
    const a = contato('a');
    const b = contato('b');
    const { result } = renderHook(() => useContatosPorIds(['a', 'b'], pronta([a, b])), { wrapper });
    await esperar();
    expect(h.getByIds).not.toHaveBeenCalled();
    expect(result.current.carregando).toBe(false);
    expect(result.current.porId.get('a')).toBe(a);
    expect(result.current.porId.get('b')).toBe(b);
  });

  it('3 ids, 1 na lista → 1 chamada com os 2 faltantes', async () => {
    const { result } = renderHook(() => useContatosPorIds(['c', 'a', 'b', '', null, 'c'], pronta([contato('a')])), {
      wrapper,
    });
    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(h.getByIds).toHaveBeenCalledTimes(1);
    expect(h.getByIds.mock.calls[0][0]).toEqual(['b', 'c']);
    expect([...result.current.porId.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(result.current.porId.get('b')?.name).toBe('Contato b');
  });

  it('400 faltantes → 1 chamada ao getByIds (o lote é dele)', async () => {
    const ids = Array.from({ length: 400 }, (_, i) => `id-${String(i).padStart(3, '0')}`);
    const { result } = renderHook(() => useContatosPorIds(ids, pronta([])), { wrapper });
    await waitFor(() => expect(result.current.carregando).toBe(false));
    expect(h.getByIds).toHaveBeenCalledTimes(1);
    expect(h.getByIds.mock.calls[0][0]).toHaveLength(400);
    expect(result.current.porId.size).toBe(400);
  });

  it("['b','a'] e ['a','b'] → a mesma chave (1 chamada só)", async () => {
    const r1 = renderHook(() => useContatosPorIds(['b', 'a'], pronta([])), { wrapper });
    await waitFor(() => expect(r1.result.current.carregando).toBe(false));
    const r2 = renderHook(() => useContatosPorIds(['a', 'b'], pronta([])), { wrapper });
    await esperar();
    expect(r2.result.current.porId.size).toBe(2);
    expect(h.getByIds).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryCache().findAll({ queryKey: [...queryKeys.contacts.all, 'por-ids'] })).toHaveLength(1);
    expect(chaveDosContatosPorIds(['a', 'b'])).toEqual(['contacts', 'por-ids', ['a', 'b']]);
  });

  it('lista carregando → 0 chamadas e carregando: true', async () => {
    const { result } = renderHook(
      () => useContatosPorIds(['a'], { data: undefined, isFetched: false, isError: false }),
      { wrapper }
    );
    await esperar();
    expect(h.getByIds).not.toHaveBeenCalled();
    expect(result.current).toEqual({ porId: new Map(), carregando: true, erro: false });
  });

  it('sem lista → todos vão ao banco', async () => {
    const { result } = renderHook(() => useContatosPorIds(['a']), { wrapper });
    await waitFor(() => expect(result.current.porId.get('a')?.id).toBe('a'));
    expect(h.getByIds).toHaveBeenCalledTimes(1);
  });

  it('erro → erro: true', async () => {
    h.getByIds.mockResolvedValue({ data: null, error: new Error('falhou') });
    const { result } = renderHook(() => useContatosPorIds(['a'], pronta([])), { wrapper });
    await waitFor(() => expect(result.current.erro).toBe(true));
    expect(result.current.carregando).toBe(false);
  });

  it('erro numa nova busca com dado anterior → mantém o dado, sem erro', async () => {
    const { result } = renderHook(() => useContatosPorIds(['a'], pronta([])), { wrapper });
    await waitFor(() => expect(result.current.porId.get('a')?.name).toBe('Contato a'));
    h.getByIds.mockResolvedValue({ data: null, error: new Error('falhou') });
    await queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
    await waitFor(() =>
      expect(queryClient.getQueryState(chaveDosContatosPorIds(['a']))?.status).toBe('error')
    );
    expect(result.current.erro).toBe(false);
    expect(result.current.porId.get('a')?.name).toBe('Contato a');
  });

  it('chave debaixo de contacts.all e diferente de contacts.detail', () => {
    const chave = chaveDosContatosPorIds(['a']);
    expect(chave.slice(0, queryKeys.contacts.all.length)).toEqual([...queryKeys.contacts.all]);
    expect(chave).not.toEqual(queryKeys.contacts.detail('a'));
    expect(chave.slice(0, queryKeys.contacts.details().length)).not.toEqual([...queryKeys.contacts.details()]);
  });
});
