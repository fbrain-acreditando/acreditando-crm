/**
 * Story 2.76 (AC7) — o Inbox gera sugestões com contato antigo.
 *
 * As duas consultas do Inbox (`useContatosDoInbox`) rodam de verdade
 * (QueryClient real); só o serviço é simulado. Os contatos existem SÓ no
 * banco (o `useContacts`, espião, devolveria lista vazia — e não pode ser chamado).
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Contact } from '@/types';

const h = vi.hoisted(() => ({
  getComAniversario: vi.fn(),
  getClientesParaResgate: vi.fn(),
  useContacts: vi.fn(() => ({ data: [], isLoading: false })),
  generateDailyBriefing: vi.fn(async (_radar: unknown) => 'resumo'),
  mutacao: () => ({ mutate: () => {}, mutateAsync: async () => ({}) }),
}));
const mutacao = () => h.mutacao();

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false, profile: { id: 'u1' }, organizationId: 'org1' }),
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn(), addToast: vi.fn() }) }));
vi.mock('@/lib/supabase', () => ({
  contactsService: {
    getComAniversario: h.getComAniversario,
    getClientesParaResgate: h.getClientesParaResgate,
  },
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: null }));
vi.mock('@/lib/supabase/aiSuggestions', () => ({}));
vi.mock('@/lib/ai/tasksClient', () => ({ generateDailyBriefing: h.generateDailyBriefing }));
vi.mock('@/lib/realtime/useRealtimeSync', () => ({ useRealtimeSync: () => {} }));
vi.mock('@/hooks/usePersistedState', async () => {
  const { useState } = await vi.importActual<typeof import('react')>('react');
  return { usePersistedState: <T,>(_k: string, v: T) => useState<T>(v) };
});
vi.mock('@/lib/query/hooks/useActivitiesQuery', () => ({
  useActivities: () => ({ data: [], isLoading: false }),
  useCreateActivity: () => h.mutacao(),
  useUpdateActivity: () => h.mutacao(),
  useDeleteActivity: () => h.mutacao(),
}));
vi.mock('@/lib/query/hooks/useContactsQuery', () => ({
  useContacts: h.useContacts,
  useCreateContact: () => h.mutacao(),
  useUpdateContact: () => h.mutacao(),
}));
vi.mock('@/lib/query/hooks/useDealsQuery', () => ({
  useDealsView: () => ({ data: [], isLoading: false }),
  useCreateDeal: () => h.mutacao(),
  useUpdateDeal: () => h.mutacao(),
}));
vi.mock('@/lib/query/hooks/useBoardsQuery', () => ({ useDefaultBoard: () => ({ data: null }) }));
vi.mock('@/lib/query/hooks/useAISuggestionsQuery', () => ({
  useHiddenSuggestionIds: () => ({ data: new Set<string>() }),
  useRecordSuggestionInteraction: () => h.mutacao(),
}));

import { useInboxController } from './useInboxController';

const DIA = 24 * 60 * 60 * 1000;
const ha = (dias: number) => new Date(Date.now() - dias * DIA).toISOString();
const mesAtual = String(new Date().getMonth() + 1).padStart(2, '0');

const contato = (id: string, extra: Partial<Contact>): Contact => ({
  id,
  name: `Contato ${id}`,
  email: '',
  phone: '',
  status: 'ACTIVE',
  stage: 'CUSTOMER',
  createdAt: '2025-01-01T00:00:00Z', // antigo: antes do corte dos 1.000
  ...extra,
});

const ANIVERSARIANTE = contato('aniv', { stage: 'LEAD', birthDate: `1990-${mesAtual}-15` });
const INATIVO_40 = contato('inativo40', { lastInteraction: ha(40) });
const ATIVO_5 = contato('ativo5', { lastInteraction: ha(5) });

describe('useInboxController — contatos antigos (story 2.76, AC7)', () => {
  let queryClient: QueryClient;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    h.useContacts.mockClear();
    h.generateDailyBriefing.mockClear();
    h.getComAniversario.mockReset().mockResolvedValue({ data: [ANIVERSARIANTE], error: null });
    // O banco devolve candidatos; a regra fina (navegador) separa os de 5 dias.
    h.getClientesParaResgate.mockReset().mockResolvedValue({ data: [INATIVO_40, ATIVO_5], error: null });
  });

  it('cliente antigo inativo há 40 dias vira sugestão de resgate; o de 5 dias, não', async () => {
    const { result } = renderHook(() => useInboxController(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const resgates = result.current.aiSuggestions.filter(s => s.type === 'RESCUE');
    expect(resgates.map(s => s.id)).toEqual(['rescue-inativo40']);
    expect(resgates[0].data.contact?.id).toBe('inativo40');
  });

  it('a consulta de resgate recebe o limite de 30 dias atrás', async () => {
    const { result } = renderHook(() => useInboxController(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(h.getClientesParaResgate).toHaveBeenCalledTimes(1);
    const limite = Date.parse(h.getClientesParaResgate.mock.calls[0][0]);
    expect(Math.abs(limite - (Date.now() - 30 * DIA))).toBeLessThan(5_000);
  });

  it('contato antigo aniversariante do mês entra em birthdaysThisMonth', async () => {
    const { result } = renderHook(() => useInboxController(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.birthdaysThisMonth.map(c => c.id)).toEqual(['aniv']);
    expect(h.getComAniversario).toHaveBeenCalledTimes(1);
  });

  it('isLoading espera as duas consultas', async () => {
    let soltar: (v: unknown) => void = () => {};
    h.getClientesParaResgate.mockReset().mockImplementation(() => new Promise(r => (soltar = r)));
    const { result } = renderHook(() => useInboxController(), { wrapper });
    await waitFor(() => expect(h.getClientesParaResgate).toHaveBeenCalled());
    expect(result.current.isLoading).toBe(true);
    soltar({ data: [], error: null });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('o controller não chama useContacts', async () => {
    const { result } = renderHook(() => useInboxController(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(h.useContacts).not.toHaveBeenCalled();
  });
});
