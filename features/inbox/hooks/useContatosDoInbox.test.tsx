/**
 * QA loop 2.76a (LOW-1) — as duas consultas do Inbox ficam debaixo de
 * `queryKeys.contacts.all` (D6): o Realtime de `contacts` e o renomear lead
 * invalidam `contacts.all`; chave fora daí deixaria aniversariantes/resgate
 * velhos sem ninguém perceber.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';

const h = vi.hoisted(() => ({
  getComAniversario: vi.fn(),
  getClientesParaResgate: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false, profile: { id: 'u1' }, organizationId: 'org1' }),
}));
vi.mock('@/lib/supabase', () => ({
  contactsService: {
    getComAniversario: h.getComAniversario,
    getClientesParaResgate: h.getClientesParaResgate,
  },
}));

import { chaveDoResgate, chaveDosAniversariantes, useContatosDoInbox } from './useContatosDoInbox';

const LIMITE = '2026-10-18T03:00:00.000Z';

describe('useContatosDoInbox — chaves debaixo de contacts.all (QA loop 2.76a, LOW-1)', () => {
  beforeEach(() => {
    h.getComAniversario.mockReset().mockResolvedValue({ data: [], error: null });
    h.getClientesParaResgate.mockReset().mockResolvedValue({ data: [], error: null });
  });

  it('as funções de chave começam com contacts.all', () => {
    const base = [...queryKeys.contacts.all];
    expect(chaveDosAniversariantes().slice(0, base.length)).toEqual(base);
    expect(chaveDoResgate(LIMITE).slice(0, base.length)).toEqual(base);
  });

  it('invalidar contacts.all refaz as DUAS consultas do Inbox', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useContatosDoInbox(LIMITE), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(h.getComAniversario).toHaveBeenCalledTimes(1);
    expect(h.getClientesParaResgate).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryCache().findAll({ queryKey: queryKeys.contacts.all })).toHaveLength(2);

    await queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
    await waitFor(() => {
      expect(h.getComAniversario).toHaveBeenCalledTimes(2);
      expect(h.getClientesParaResgate).toHaveBeenCalledTimes(2);
    });
  });
});
