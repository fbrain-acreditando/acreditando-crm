/**
 * Story 2.76 (AC6) — o foco do Inbox acha o contato antigo.
 *
 * `useContatosPorIds` e `useBuscaDeContatos` rodam de verdade (QueryClient
 * real); o serviço é simulado. O `FocusContextPanel` é simulado para afirmar o
 * contato que ele RECEBE. `useContacts` é espião: não pode ser chamado.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Activity, Contact, DealView } from '@/types';

const h = vi.hoisted(() => ({
  getByIds: vi.fn(),
  buscarParaSelecao: vi.fn(),
  useContacts: vi.fn(),
  deals: [] as unknown[],
  painel: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false, profile: { id: 'u1' }, organizationId: 'org1' }),
}));
vi.mock('@/lib/supabase', () => ({
  contactsService: { getByIds: h.getByIds, buscarParaSelecao: h.buscarParaSelecao },
}));
vi.mock('@/store/uiState', () => ({
  useUIState: () => ({ activeBoardId: 'b1', setSidebarCollapsed: () => {} }),
}));
vi.mock('./FocusContextPanel', () => ({
  FocusContextPanel: (props: { contact?: Contact }) => {
    h.painel(props);
    return <div data-testid="painel">{props.contact ? `${props.contact.name} | ${props.contact.phone}` : 'sem contato'}</div>;
  },
}));
vi.mock('@/lib/query/hooks', async () => {
  const porIds = await vi.importActual<typeof import('@/lib/query/hooks/useContatosPorIds')>(
    '@/lib/query/hooks/useContatosPorIds'
  );
  const busca = await vi.importActual<typeof import('@/lib/query/hooks/useBuscaDeContatos')>(
    '@/lib/query/hooks/useBuscaDeContatos'
  );
  const mutacao = () => ({ mutateAsync: vi.fn(), mutate: vi.fn() });
  return {
    useContatosPorIds: porIds.useContatosPorIds,
    useBuscaDeContatos: busca.useBuscaDeContatos,
    useContacts: h.useContacts,
    useDealsView: () => ({ data: h.deals }),
    useBoards: () => ({ data: [{ id: 'b1', name: 'Quadro', isDefault: true, stages: [{ id: 's1', label: 'Etapa' }] }] }),
    useActivities: () => ({ data: [] }),
    useUpdateDeal: mutacao,
    useCreateActivity: mutacao,
    useUpdateActivity: mutacao,
    useMoveDealSimple: () => ({ moveDeal: vi.fn() }),
  };
});

import { InboxFocusView } from './InboxFocusView';
import type { FocusItem } from '../hooks/useInboxController';

const ANTIGO: Contact = {
  id: '99999999-9999-4999-8999-999999999999',
  name: 'Contato Antigo',
  email: '',
  phone: '+5500912345678',
  status: 'ACTIVE',
  stage: 'lc-1',
  createdAt: '2025-01-01T00:00:00Z',
};

const card = (contactId: string): DealView =>
  ({
    id: 'deal-1',
    title: 'Card de Teste',
    contactId,
    boardId: 'b1',
    status: 's1',
    value: 0,
    isWon: false,
    isLost: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }) as DealView;

const atividade = (extra: Partial<Activity>): FocusItem => ({
  id: 'act-1',
  type: 'activity',
  priority: 0,
  date: '2026-11-17T12:00:00Z',
  data: {
    id: 'act-1',
    title: 'Ligar',
    type: 'CALL',
    date: '2026-11-17T12:00:00Z',
    completed: false,
    dealId: '',
    dealTitle: '',
    description: '',
    user: { name: 'Eu', avatar: '' },
    ...extra,
  } as Activity,
} as FocusItem);

function montar(item: FocusItem) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <InboxFocusView
        currentItem={item}
        currentIndex={0}
        totalItems={1}
        onDone={vi.fn()}
        onSnooze={vi.fn()}
        onSkip={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />
    </QueryClientProvider>
  );
  // Espaço abre o painel de contexto
  act(() => {
    fireEvent.keyDown(window, { key: ' ' });
  });
}

describe('InboxFocusView — contato antigo (story 2.76, AC6)', () => {
  beforeEach(() => {
    h.getByIds.mockReset();
    h.buscarParaSelecao.mockReset();
    h.useContacts.mockReset();
    h.painel.mockReset();
    h.deals = [];
  });

  it('contato do card fora da lista → vem do banco pelo id e chega ao painel', async () => {
    h.deals = [card(ANTIGO.id)];
    h.getByIds.mockResolvedValue({ data: [ANTIGO], error: null });
    montar(atividade({ dealId: 'deal-1' }));
    await waitFor(() => expect(screen.getByTestId('painel')).toHaveTextContent('Contato Antigo | +5500912345678'));
    const ultimo = h.painel.mock.calls.at(-1)![0] as { contact: Contact };
    expect(ultimo.contact.id).toBe(ANTIGO.id);
    expect(ultimo.contact.phone).toBe('+5500912345678');
    expect(h.getByIds).toHaveBeenCalledTimes(1);
    expect(h.getByIds.mock.calls[0][0]).toEqual([ANTIGO.id]);
    expect(h.buscarParaSelecao).not.toHaveBeenCalled();
    expect(h.useContacts).not.toHaveBeenCalled();
  });

  it('sem id, só o nome citado na atividade → busca no banco com limite 1', async () => {
    h.buscarParaSelecao.mockResolvedValue({ data: [ANTIGO], error: null });
    montar(atividade({ description: 'Reativar cliente: Contato Antigo' }));
    await waitFor(() => expect(screen.getByTestId('painel')).toHaveTextContent('Contato Antigo | +5500912345678'));
    expect(h.buscarParaSelecao).toHaveBeenCalledTimes(1);
    expect(h.buscarParaSelecao.mock.calls[0][0]).toBe('Contato Antigo');
    expect(h.buscarParaSelecao.mock.calls[0][1]).toMatchObject({ limite: 1 });
    expect(h.getByIds).not.toHaveBeenCalled();
    expect(h.useContacts).not.toHaveBeenCalled();
  });

  it('sugestão de resgate já traz o contato → sem consulta', async () => {
    const item: FocusItem = {
      id: 'rescue-1',
      type: 'suggestion',
      priority: 1,
      date: '2026-11-17T12:00:00Z',
      data: { id: 'rescue-1', type: 'RESCUE', title: 'Risco', description: '', priority: 'medium', data: { contact: ANTIGO }, createdAt: '' },
    } as FocusItem;
    montar(item);
    await waitFor(() => expect(screen.getByTestId('painel')).toHaveTextContent('Contato Antigo'));
    await new Promise(r => setTimeout(r, 20));
    expect(h.getByIds).not.toHaveBeenCalled();
    expect(h.buscarParaSelecao).not.toHaveBeenCalled();
  });
});
