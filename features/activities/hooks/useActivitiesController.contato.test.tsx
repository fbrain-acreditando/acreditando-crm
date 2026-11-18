/**
 * Story 2.76 (AC8) — a atividade não perde o contato do card.
 *
 * O card aponta para um contato que NÃO está na lista do `useContacts()` (os
 * 1.000 mais novos). Antes, a atividade era gravada com `contactId: ''`.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  criar: vi.fn(),
  editar: vi.fn(),
  deals: [] as unknown[],
}));

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u1' }, organizationId: 'org1' }) }));
vi.mock('@/lib/realtime/useRealtimeSync', () => ({ useRealtimeSync: () => {} }));
vi.mock('@/lib/query/hooks/useActivitiesQuery', () => ({
  useActivities: () => ({ data: [], isLoading: false }),
  useCreateActivity: () => ({ mutate: h.criar }),
  useUpdateActivity: () => ({ mutate: h.editar }),
  useDeleteActivity: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/lib/query/hooks/useDealsQuery', () => ({ useDeals: () => ({ data: h.deals, isLoading: false }) }));
vi.mock('@/lib/query/hooks/useContactsQuery', () => ({
  // Lista sem o contato do card (ele é antigo)
  useContacts: () => ({ data: [{ id: 'outro', name: 'Outro', clientCompanyId: 'emp-x' }], isLoading: false }),
  useCompanies: () => ({ data: [], isLoading: false }),
}));

import { useActivitiesController } from './useActivitiesController';

const ID_ANTIGO = '99999999-9999-4999-8999-999999999999';
const evento = { preventDefault: () => {} } as React.FormEvent;

describe('useActivitiesController.handleSubmit — contato antigo (story 2.76, AC8)', () => {
  beforeEach(() => {
    h.criar.mockReset();
    h.editar.mockReset();
    h.deals = [{ id: 'deal-1', title: 'Card de Teste', contactId: ID_ANTIGO, clientCompanyId: 'emp-1' }];
  });

  const preencher = (r: { current: ReturnType<typeof useActivitiesController> }) =>
    act(() => {
      r.current.setFormData({
        title: 'Ligar',
        type: 'CALL',
        date: '2026-11-17',
        time: '09:00',
        description: '',
        dealId: 'deal-1',
      });
    });

  it('criar: grava contactId e participantContactIds com o id do card', () => {
    const { result } = renderHook(() => useActivitiesController());
    preencher(result);
    act(() => result.current.handleSubmit(evento));
    expect(h.criar).toHaveBeenCalledTimes(1);
    const { activity } = h.criar.mock.calls[0][0];
    expect(activity.contactId).toBe(ID_ANTIGO);
    expect(activity.participantContactIds).toEqual([ID_ANTIGO]);
    expect(activity.clientCompanyId).toBe('emp-1');
    expect(activity.dealId).toBe('deal-1');
  });

  it('editar: grava contactId e participantContactIds com o id do card', () => {
    const { result } = renderHook(() => useActivitiesController());
    act(() =>
      result.current.handleEditActivity({
        id: 'act-1',
        title: 'Ligar',
        type: 'CALL',
        date: '2026-11-17T12:00:00.000Z',
        description: '',
        dealId: 'deal-1',
        dealTitle: 'Card de Teste',
        completed: false,
        user: { name: 'Eu', avatar: '' },
      } as never)
    );
    act(() => result.current.handleSubmit(evento));
    expect(h.editar).toHaveBeenCalledTimes(1);
    const { id, updates } = h.editar.mock.calls[0][0];
    expect(id).toBe('act-1');
    expect(updates.contactId).toBe(ID_ANTIGO);
    expect(updates.participantContactIds).toEqual([ID_ANTIGO]);
  });

  it('card sem contato: contactId vazio e sem participantes', () => {
    h.deals = [{ id: 'deal-1', title: 'Card de Teste', contactId: '' }];
    const { result } = renderHook(() => useActivitiesController());
    preencher(result);
    act(() => result.current.handleSubmit(evento));
    const { activity } = h.criar.mock.calls[0][0];
    expect(activity.contactId).toBe('');
    expect(activity.participantContactIds).toEqual([]);
  });
});
