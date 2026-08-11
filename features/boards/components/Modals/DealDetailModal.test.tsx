import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DealDetailModal } from './DealDetailModal';

// Story 2.27 — espião do UPDATE. Fora do `vi.mock` para poder ser inspecionado
// nos testes; `vi.hoisted` porque os mocks sobem para o topo do módulo.
const { mutateUpdateDeal } = vi.hoisted(() => ({ mutateUpdateDeal: vi.fn(async () => undefined) }));

// A seção de campos personalizados só renderiza quando há definição. Estes são
// dois dos cinco que a Fernanda preenche de verdade.
vi.mock('@/lib/query/hooks/useCustomFieldsQuery', () => ({
  useCustomFields: () => ({
    data: [
      { id: 'cf-1', key: 'ondeReside', label: 'Onde reside', type: 'text' },
      { id: 'cf-2', key: 'tipoDeLesao', label: 'Tipo de Lesão', type: 'text' },
    ],
    isLoading: false,
  }),
}));

// Keep this test focused: we only want to ensure opening/closing the modal
// never crashes due to hook-order issues (React error #310).

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock('@/hooks/useResponsiveMode', () => ({
  useResponsiveMode: () => ({ mode: 'desktop' }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'user-1', role: 'admin', email: 'test@example.com', organization_id: 'org-1' },
  }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({
    addToast: vi.fn(),
  }),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  // Return the deal fixture for DEALS_VIEW_KEY (identified by enabled:false in DealDetailModal)
  return {
    ...actual,
    useQuery: (options: { enabled?: boolean }) => {
      if (options.enabled === false) {
        return {
          data: [{
            id: 'deal-1',
            title: 'Pequeno Chapéu',
            value: 1000,
            status: 'stage-1',
            boardId: 'board-1',
            contactId: 'contact-1',
            companyName: 'Moreira Comércio',
            contactName: 'Fulano',
            contactEmail: 'fulano@example.com',
            stageLabel: 'Novo',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            probability: 50,
            priority: 'medium',
            owner: { name: 'Eu', avatar: '' },
            tags: [],
            items: [],
            customFields: {},
            isWon: false,
            isLost: false,
          }],
          isLoading: false,
        };
      }
      return { data: [], isLoading: false };
    },
    // Story 2.20 — o modal passou a montar o `LeadNameEditor`, que usa
    // `useRenameLead` → `useQueryClient`. Este teste renderiza sem
    // QueryClientProvider de propósito (o foco é ordem de hooks, não dados),
    // então o client entra como stub em vez de o teste ganhar um provider.
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
      cancelQueries: vi.fn(),
      getQueryData: vi.fn(),
      setQueryData: vi.fn(),
      getQueriesData: vi.fn(() => []),
    }),
    // `useMutation` resolve o QueryClient por dentro do próprio módulo, sem passar
    // pelo `useQueryClient` mockado acima — por isso precisa de stub também.
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  };
});

vi.mock('@/lib/query/hooks', () => ({
  useMoveDealSimple: () => ({ moveDeal: vi.fn() }),
  useContacts: () => ({ data: [], isLoading: false }),
  useActivities: () => ({ data: [], isLoading: false }),
  useBoards: () => ({ data: [], isLoading: false }),
  useLifecycleStages: () => ({ data: [], isLoading: false }),
  useUpdateDeal: () => ({ mutate: vi.fn(), mutateAsync: mutateUpdateDeal, isPending: false }),
  useDeleteDeal: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useAddDealItem: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useRemoveDealItem: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useCreateActivity: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useUpdateActivity: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDeleteActivity: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/query/hooks/useProductsQuery', () => ({
  useActiveProducts: () => ({ data: [] }),
}));

vi.mock('@/store/uiState', () => ({
  useUIState: () => ({ activeBoardId: 'board-1' }),
}));

vi.mock('@/hooks/usePersistedState', () => ({
  usePersistedState: (_key: string, initial: unknown) => [initial, vi.fn()],
}));

vi.mock('@/lib/a11y', () => ({
  FocusTrap: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useFocusReturn: () => undefined,
}));

vi.mock('@/components/ConfirmModal', () => ({
  default: () => null,
}));

vi.mock('@/components/ui/LossReasonModal', () => ({
  LossReasonModal: () => null,
}));

vi.mock('../DealSheet', () => ({
  DealSheet: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../StageProgressBar', () => ({
  StageProgressBar: () => null,
}));

vi.mock('@/features/activities/components/ActivityRow', () => ({
  ActivityRow: () => null,
}));

vi.mock('@/lib/ai/tasksClient', () => ({
  analyzeLead: vi.fn(),
  generateEmailDraft: vi.fn(),
  generateObjectionResponse: vi.fn(),
}));

vi.mock('@/features/deals/components/BriefingDrawer', () => ({
  BriefingDrawer: () => null,
}));

vi.mock('@/features/deals/components/AIExtractedFields', () => ({
  AIExtractedFields: () => null,
}));

vi.mock('@/context/CRMContext', () => ({
  useCRM: () => {
    const board = {
      id: 'board-1',
      name: 'Pipeline de Vendas',
      stages: [
        { id: 'stage-1', label: 'Novo', order: 0, linkedLifecycleStage: 'MQL' },
      ],
      wonStageId: null,
      lostStageId: null,
      wonStayInStage: false,
      lostStayInStage: false,
      defaultProductId: null,
      agentPersona: null,
      goal: null,
    };

    const deal = {
      id: 'deal-1',
      title: 'Pequeno Chapéu',
      value: 1000,
      status: 'stage-1',
      boardId: 'board-1',
      contactId: 'contact-1',
      companyName: 'Moreira Comércio',
      contactName: 'Fulano',
      contactEmail: 'fulano@example.com',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      probability: 50,
      tags: [],
      items: [],
      customFields: {},
      isWon: false,
      isLost: false,
      closedAt: undefined,
      lossReason: undefined,
    };

    return {
      deals: [deal],
      contacts: [{ id: 'contact-1', stage: null }],
      updateDeal: vi.fn(),
      deleteDeal: vi.fn(),
      activities: [],
      addActivity: vi.fn(),
      updateActivity: vi.fn(),
      deleteActivity: vi.fn(),
      products: [],
      addItemToDeal: vi.fn(),
      removeItemFromDeal: vi.fn(),
      customFieldDefinitions: [],
      activeBoard: board,
      boards: [board],
      lifecycleStages: [],
    };
  },
}));

beforeEach(() => {
  mutateUpdateDeal.mockClear();
});

describe('DealDetailModal', () => {
  it('does not crash when toggling open/close (hook order regression)', () => {
    const { rerender } = render(
      <DealDetailModal dealId="deal-1" isOpen={false} onClose={() => {}} />
    );

    expect(document.body.textContent).not.toContain('Application error');

    rerender(<DealDetailModal dealId="deal-1" isOpen={true} onClose={() => {}} />);
    expect(document.body.textContent).toContain('Pequeno Chapéu');

    rerender(<DealDetailModal dealId="deal-1" isOpen={false} onClose={() => {}} />);
    expect(document.body.textContent).not.toContain('Application error');
  });
});



/**
 * Story 2.27 — Salvar explícito e aviso ao fechar com pendência.
 *
 * Pedidos da Fernanda: *"toda alteração, quando for feita, precisa clicar em
 * salvar"* e *"se puder dar um aviso quando fechar e não tiver salvo alguma
 * coisa, seria interessante"*.
 *
 * O mock de `useCustomFields` vive aqui em cima (hoisted pelo Vitest) porque o
 * modal só renderiza a seção de campos personalizados quando há definição.
 */
describe('DealDetailModal — Salvar explícito (story 2.27)', () => {
  it('digitar não grava, e a barra de Salvar aparece só quando há alteração', async () => {
    const user = userEvent.setup();
    render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

    // Sem alteração: nenhuma barra, nenhum botão Salvar.
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();

    await user.type(screen.getByLabelText('Onde reside'), 'Guarulhos');

    expect(mutateUpdateDeal).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument();
    expect(screen.getByText(/1 campo alterado/i)).toBeInTheDocument();
  });

  it('Salvar grava UMA vez, com todos os campos de uma vez', async () => {
    const user = userEvent.setup();
    render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

    await user.type(screen.getByLabelText('Onde reside'), 'Osasco');
    await user.type(screen.getByLabelText('Tipo de Lesão'), 'Medular');
    expect(screen.getByText(/2 campos alterados/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    // Um UPDATE por campo geraria um broadcast de Realtime e um refetch do
    // board por campo.
    expect(mutateUpdateDeal).toHaveBeenCalledTimes(1);
    expect(mutateUpdateDeal.mock.calls[0][0]).toMatchObject({
      id: 'deal-1',
      updates: { customFields: { ondeReside: 'Osasco', tipoDeLesao: 'Medular' } },
    });
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
  });

  it('Descartar volta ao valor do servidor e não grava', async () => {
    const user = userEvent.setup();
    render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

    await user.type(screen.getByLabelText('Onde reside'), 'errado');
    await user.click(screen.getByRole('button', { name: 'Descartar' }));

    expect(screen.getByLabelText('Onde reside')).toHaveValue('');
    expect(mutateUpdateDeal).not.toHaveBeenCalled();
  });

  it('fechar SEM pendência não pergunta nada', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<DealDetailModal dealId="deal-1" isOpen onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Fechar modal' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/você não salvou/i)).toBeNull();
  });

  it('🎯 fechar COM pendência pergunta antes, e não fecha sozinho', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<DealDetailModal dealId="deal-1" isOpen onClose={onClose} />);

    await user.type(screen.getByLabelText('Onde reside'), 'Guarulhos');
    await user.click(screen.getByRole('button', { name: 'Fechar modal' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText(/você não salvou/i)).toBeInTheDocument();
  });

  it('"Salvar e fechar" grava e fecha', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<DealDetailModal dealId="deal-1" isOpen onClose={onClose} />);

    await user.type(screen.getByLabelText('Onde reside'), 'Guarulhos');
    await user.click(screen.getByRole('button', { name: 'Fechar modal' }));
    await user.click(await screen.findByRole('button', { name: /salvar e fechar/i }));

    expect(mutateUpdateDeal).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"Descartar e fechar" fecha sem gravar', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<DealDetailModal dealId="deal-1" isOpen onClose={onClose} />);

    await user.type(screen.getByLabelText('Onde reside'), 'Guarulhos');
    await user.click(screen.getByRole('button', { name: 'Fechar modal' }));
    await user.click(await screen.findByRole('button', { name: /descartar e fechar/i }));

    expect(mutateUpdateDeal).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"Continuar editando" mantém o modal aberto e o rascunho intacto', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<DealDetailModal dealId="deal-1" isOpen onClose={onClose} />);

    await user.type(screen.getByLabelText('Onde reside'), 'Guarulhos');
    await user.click(screen.getByRole('button', { name: 'Fechar modal' }));
    await user.click(await screen.findByRole('button', { name: /continuar editando/i }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Onde reside')).toHaveValue('Guarulhos');
  });
});
