import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DealDetailModal } from './DealDetailModal';

// Story 2.27 — espião do UPDATE. Fora do `vi.mock` para poder ser inspecionado
// nos testes; `vi.hoisted` porque os mocks sobem para o topo do módulo.
const { mutateUpdateDeal } = vi.hoisted(() => ({ mutateUpdateDeal: vi.fn(async (..._args: unknown[]) => undefined) }));

// Stories 2.66/2.67 — espiões içados: o `moveDeal` (para afirmar o 6º e o 7º
// argumentos, `leadLocation` e `lossNote`), o toast, as props do `LossReasonModal` (para disparar o
// `onConfirm` como o modal real faria), o board e o estado do card.
type LossModalPropsDeTeste = {
  onConfirm: (reason: string, extras?: { leadLocation?: string; lossNote?: string }) => void;
  localSugerido?: string;
  localAtual?: string;
};
const { moveDealSpy, addToastSpy, lossModal, boardsDoTeste, cardExtra } = vi.hoisted(() => ({
  moveDealSpy: vi.fn(),
  addToastSpy: vi.fn(),
  lossModal: { props: null as LossModalPropsDeTeste | null },
  boardsDoTeste: { atual: [] as unknown[] },
  cardExtra: { atual: {} as Record<string, unknown> },
}));

// A seção de campos personalizados só renderiza quando há definição. O padrão
// são dois dos cinco que a Fernanda preenche de verdade; a story 2.60 troca a
// lista por teste (`definicoes.atual`), e o `beforeEach` devolve o padrão.
type DefinicaoDeTeste = { id: string; key: string; label: string; type: string; options?: string[] };
const DEFINICOES_PADRAO: DefinicaoDeTeste[] = [
  { id: 'cf-1', key: 'ondeReside', label: 'Onde reside', type: 'text' },
  { id: 'cf-2', key: 'tipoDeLesao', label: 'Tipo de Lesão', type: 'text' },
];
const { definicoes, valoresDoCard } = vi.hoisted(() => ({
  definicoes: { atual: [] as DefinicaoDeTeste[] },
  // Story 2.60 (QA Q1) — o que já está gravado no card; o padrão é vazio.
  valoresDoCard: { atual: {} as Record<string, string> },
}));
vi.mock('@/lib/query/hooks/useCustomFieldsQuery', () => ({
  useCustomFields: () => ({ data: definicoes.atual, isLoading: false }),
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
    addToast: addToastSpy,
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
            customFields: valoresDoCard.atual,
            isWon: false,
            isLost: false,
            ...cardExtra.atual,
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
  useMoveDealSimple: () => ({ moveDeal: moveDealSpy }),
  useContacts: () => ({ data: [], isLoading: false }),
  useActivities: () => ({ data: [], isLoading: false }),
  useBoards: () => ({ data: boardsDoTeste.atual, isLoading: false }),
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

/**
 * ⚠️ Story 2.28 — este mock é PASSTHROUGH de propósito, e essa escolha tem histórico:
 * ele arrancava o `FocusTrap` real, e por isso 602 testes ficaram verdes enquanto os
 * botões do aviso "Você não salvou" e do "Excluir negócio" estavam MORTOS na tela da
 * Fernanda (o `focus-trap` cancelava o clique, porque conteúdo de portal fica fora do
 * container do trap).
 *
 * ⇒ O comportamento com o trap REAL é coberto pelo teste irmão
 *   `FecharComPendenciasDialog.trap.test.tsx`. Não apague um sem olhar o outro.
 *
 * O mock também REGISTRA o `active` recebido, para travar a segunda metade do conserto:
 * o trap do card tem de CEDER enquanto houver diálogo em portal por cima.
 */
// `vi.hoisted` porque o `vi.mock` é içado para o topo do arquivo: uma `const` comum
// ainda não existiria quando a fábrica do mock roda.
const { focusTrapActiveSpy } = vi.hoisted(() => ({ focusTrapActiveSpy: vi.fn() }));
vi.mock('@/lib/a11y', () => ({
  FocusTrap: ({ children, active }: { children: React.ReactNode; active: boolean }) => {
    focusTrapActiveSpy(active);
    return <>{children}</>;
  },
  useFocusReturn: () => undefined,
}));

vi.mock('@/components/ConfirmModal', () => ({
  default: () => null,
}));

vi.mock('@/components/ui/LossReasonModal', () => ({
  LossReasonModal: (p: LossModalPropsDeTeste) => {
    lossModal.props = p;
    return null;
  },
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
      customFields: valoresDoCard.atual,
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
  mutateUpdateDeal.mockReset();
  mutateUpdateDeal.mockImplementation(async () => undefined);
  moveDealSpy.mockClear();
  addToastSpy.mockClear();
  lossModal.props = null;
  boardsDoTeste.atual = [];
  cardExtra.atual = {};
  definicoes.atual = DEFINICOES_PADRAO;
  valoresDoCard.atual = {};
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

/**
 * Story 2.28 — a segunda metade do conserto: o trap do card CEDE enquanto há um
 * diálogo em portal por cima. Sem isso, dois traps disputam o `focusin` e o
 * teclado não alcança os botões do aviso.
 *
 * Este teste vê o `active` que o modal PASSA ao trap; quem prova o comportamento
 * do trap de verdade é `FecharComPendenciasDialog.trap.test.tsx`.
 */
describe('DealDetailModal — o trap cede ao diálogo por cima (story 2.28)', () => {
  const ultimoActive = () => {
    const calls = focusTrapActiveSpy.mock.calls;
    return calls[calls.length - 1]?.[0];
  };

  it('sem diálogo, o trap do card está ATIVO', async () => {
    focusTrapActiveSpy.mockClear();
    render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

    expect(ultimoActive()).toBe(true);
  });

  it('🎯 com o aviso "Você não salvou" aberto, o trap do card fica INATIVO', async () => {
    const user = userEvent.setup();
    render(<DealDetailModal dealId="deal-1" isOpen onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Onde reside'), 'Guarulhos');
    focusTrapActiveSpy.mockClear();

    await user.click(screen.getByRole('button', { name: 'Fechar modal' }));
    expect(await screen.findByText(/você não salvou/i)).toBeInTheDocument();

    expect(ultimoActive()).toBe(false);
  });
});

/**
 * Story 2.60 — título "Preenchido pelo lead (Formulário Meta)".
 *
 * Pedido do Filipe (29/09): antes dos campos que só o formulário da Meta
 * preenche, um título dizendo que foi o lead quem preencheu. Só 2 campos vão
 * para a seção; os demais continuam em "Campos Personalizados" (decisão D3).
 * A separação é pela `key` — o rótulo pode ser renomeado.
 */
describe('DealDetailModal — seção do formulário da Meta (story 2.60)', () => {
  const TITULO = '📋 Preenchido pelo lead (Formulário Meta)';

  const QUANDO: DefinicaoDeTeste = {
    id: 'cf-q',
    key: 'quandoPretendeIniciar',
    label: 'Quando pretende iniciar',
    type: 'select',
    options: ['Imediatamente', 'Nos próximos 30 dias', 'Ainda estou só pesquisando'],
  };
  const FAIXA: DefinicaoDeTeste = {
    id: 'cf-f',
    key: 'faixaDeInvestimentoMensal',
    label: 'Faixa de investimento mensal',
    type: 'select',
    options: ['Até R$ 500', 'R$ 500 a R$ 1.000', 'Ainda não sei'],
  };
  const ORIGEM: DefinicaoDeTeste = {
    id: 'cf-o',
    key: 'origemDoLead',
    label: 'Origem do lead',
    type: 'select',
    options: ['Formulário Meta', 'WhatsApp'],
  };
  const ONDE: DefinicaoDeTeste = { id: 'cf-1', key: 'ondeReside', label: 'Onde reside', type: 'text' };

  /** Rótulos dos campos dentro de uma seção, na ordem do DOM. */
  const rotulosDaSecao = (secao: HTMLElement) =>
    Array.from(secao.querySelectorAll('select, input')).map(el => el.getAttribute('aria-label'));

  it('🎯 o título aparece, com o texto exato, acima dos 2 campos e na ordem da constante', () => {
    // Definições do banco chegando em ordem "errada" (faixa antes de quando),
    // misturadas com os outros — a tela tem de reordenar pela constante.
    definicoes.atual = [ONDE, FAIXA, ORIGEM, QUANDO];
    render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

    const secao = screen.getByRole('region', { name: TITULO });
    expect(within(secao).getByRole('heading').textContent).toBe(TITULO);
    expect(rotulosDaSecao(secao)).toEqual(['Quando pretende iniciar', 'Faixa de investimento mensal']);

    // Os outros ficam em "Campos Personalizados", na ordem original.
    const personalizados = screen.getByRole('region', { name: 'Campos Personalizados' });
    expect(rotulosDaSecao(personalizados)).toEqual(['Onde reside', 'Origem do lead']);

    // A seção do formulário vem ANTES de "Campos Personalizados".
    expect(secao.compareDocumentPosition(personalizados) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('🎯 sem duplicata: cada um dos 2 campos aparece uma vez só, e fora de "Campos Personalizados"', () => {
    definicoes.atual = [ONDE, QUANDO, FAIXA, ORIGEM];
    render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

    expect(screen.getAllByLabelText('Quando pretende iniciar')).toHaveLength(1);
    expect(screen.getAllByLabelText('Faixa de investimento mensal')).toHaveLength(1);
    const personalizados = screen.getByRole('region', { name: 'Campos Personalizados' });
    expect(within(personalizados).queryByLabelText('Quando pretende iniciar')).toBeNull();
    expect(within(personalizados).queryByLabelText('Faixa de investimento mensal')).toBeNull();
  });

  it('a separação é pela key: rótulo renomeado continua na seção certa', () => {
    const faixaRenomeada = { ...FAIXA, label: 'Quanto pode investir' };
    // E um campo qualquer com o rótulo antigo, mas outra key, NÃO entra na seção.
    const impostor = { id: 'cf-x', key: 'outroCampo', label: 'Faixa de investimento mensal', type: 'text' };
    definicoes.atual = [impostor, faixaRenomeada, QUANDO];
    render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

    const secao = screen.getByRole('region', { name: TITULO });
    expect(rotulosDaSecao(secao)).toEqual(['Quando pretende iniciar', 'Quanto pode investir']);
    const personalizados = screen.getByRole('region', { name: 'Campos Personalizados' });
    expect(rotulosDaSecao(personalizados)).toEqual(['Faixa de investimento mensal']);
  });

  it('🎯 salvar um campo da seção nova grava, na mesma barra e no mesmo UPDATE dos demais', async () => {
    const user = userEvent.setup();
    definicoes.atual = [ONDE, QUANDO, FAIXA];
    render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

    await user.selectOptions(screen.getByLabelText('Faixa de investimento mensal'), 'R$ 500 a R$ 1.000');
    await user.type(screen.getByLabelText('Onde reside'), 'Osasco');

    // Uma barra só, somando os dois.
    expect(screen.getAllByRole('button', { name: 'Salvar' })).toHaveLength(1);
    expect(screen.getByText('2 campos alterados, ainda não salvos')).toBeInTheDocument();
    expect(mutateUpdateDeal).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(mutateUpdateDeal).toHaveBeenCalledTimes(1);
    expect(mutateUpdateDeal.mock.calls[0][0]).toEqual({
      id: 'deal-1',
      updates: { customFields: { faixaDeInvestimentoMensal: 'R$ 500 a R$ 1.000', ondeReside: 'Osasco' } },
    });
  });

  it('🎯 o valor gravado no card aparece na seção nova (QA Q1)', () => {
    valoresDoCard.atual = { quandoPretendeIniciar: 'Nos próximos 30 dias', faixaDeInvestimentoMensal: 'Até R$ 500' };
    definicoes.atual = [ONDE, QUANDO, FAIXA];
    render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

    const secao = screen.getByRole('region', { name: TITULO });
    expect(within(secao).getByLabelText('Quando pretende iniciar')).toHaveValue('Nos próximos 30 dias');
    expect(within(secao).getByLabelText('Faixa de investimento mensal')).toHaveValue('Até R$ 500');
  });

  it('🎯 o campo alterado na seção nova ganha o destaque de pendente, e só ele (QA Q2)', async () => {
    const user = userEvent.setup();
    valoresDoCard.atual = { quandoPretendeIniciar: 'Nos próximos 30 dias' };
    definicoes.atual = [ONDE, QUANDO, FAIXA];
    render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

    const faixa = screen.getByLabelText('Faixa de investimento mensal');
    const quando = screen.getByLabelText('Quando pretende iniciar');
    expect(faixa).not.toHaveClass('border-amber-400');

    await user.selectOptions(faixa, 'Ainda não sei');

    expect(faixa).toHaveClass('border-amber-400');
    expect(quando).not.toHaveClass('border-amber-400');
  });

  it('🎯 Descartar na seção nova volta ao valor gravado e não grava (QA Q4)', async () => {
    const user = userEvent.setup();
    valoresDoCard.atual = { quandoPretendeIniciar: 'Nos próximos 30 dias' };
    definicoes.atual = [ONDE, QUANDO, FAIXA];
    render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

    const quando = screen.getByLabelText('Quando pretende iniciar');
    await user.selectOptions(quando, 'Imediatamente');
    expect(quando).toHaveValue('Imediatamente');
    expect(screen.getByText('1 campo alterado, ainda não salvo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Descartar' }));

    expect(quando).toHaveValue('Nos próximos 30 dias');
    expect(quando).not.toHaveClass('border-amber-400');
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(mutateUpdateDeal).not.toHaveBeenCalled();
  });

  it('pendência só na seção nova também dispara o aviso ao fechar', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    definicoes.atual = [ONDE, QUANDO, FAIXA];
    render(<DealDetailModal dealId="deal-1" isOpen onClose={onClose} />);

    await user.selectOptions(screen.getByLabelText('Quando pretende iniciar'), 'Imediatamente');
    await user.click(screen.getByRole('button', { name: 'Fechar modal' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText(/você não salvou/i)).toBeInTheDocument();
  });

  it('organização sem os 2 campos: o título não aparece e "Campos Personalizados" segue igual', () => {
    definicoes.atual = [ONDE, ORIGEM];
    render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

    expect(screen.queryByText(TITULO)).toBeNull();
    const personalizados = screen.getByRole('region', { name: 'Campos Personalizados' });
    expect(rotulosDaSecao(personalizados)).toEqual(['Onde reside', 'Origem do lead']);
  });

  it('só um dos 2 definido: o título aparece com esse um', () => {
    definicoes.atual = [ONDE, FAIXA];
    render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

    expect(rotulosDaSecao(screen.getByRole('region', { name: TITULO }))).toEqual(['Faixa de investimento mensal']);
  });

  it('🎯 só os 2 definidos: "Campos Personalizados" não aparece vazio, e salvar grava', async () => {
    const user = userEvent.setup();
    definicoes.atual = [QUANDO, FAIXA];
    render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

    expect(screen.getByRole('heading', { name: TITULO })).toBeInTheDocument();
    expect(screen.queryByText('Campos Personalizados')).toBeNull();

    await user.selectOptions(screen.getByLabelText('Quando pretende iniciar'), 'Nos próximos 30 dias');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(mutateUpdateDeal).toHaveBeenCalledTimes(1);
    expect(mutateUpdateDeal.mock.calls[0][0]).toEqual({
      id: 'deal-1',
      updates: { customFields: { quandoPretendeIniciar: 'Nos próximos 30 dias' } },
    });
  });
});

/**
 * Story 2.67 — "Onde mora" e a observação da perda no card aberto
 * (sucede os testes do local da 2.66).
 *
 * AC3: "Onde mora" é o 1º item da coluna lateral esquerda, em qualquer etapa,
 *      e o "Salvar" manda SÓ `{ leadLocation }`.
 * AC4: todo card perdido mostra "Motivo da perda" e "Observação" (editável,
 *      salvando SÓ `{ lossNote }`); o local não se repete no bloco.
 * AC7: os três caminhos de perda repassam local e observação na MESMA escrita.
 */
describe('DealDetailModal — onde mora e observação da perda (story 2.67)', () => {
  const BOARD_BASE = {
    id: 'board-1',
    name: 'Pipeline de Vendas',
    stages: [
      { id: 'stage-1', label: 'Novo', order: 0, linkedLifecycleStage: 'MQL' },
      { id: 'stage-perdido', label: 'Perdido', order: 1, linkedLifecycleStage: 'OTHER' },
    ],
    wonStageId: null,
    lostStageId: 'stage-perdido',
    wonStayInStage: false,
    lostStayInStage: false,
    defaultProductId: null,
  };
  const ROTULO_LOCAL = 'Onde a pessoa mora?';
  const ROTULO_OBSERVACAO = 'Observação da perda';
  const BLOCO_PERDA = 'Motivo e observação da perda';

  async function perder(reason: string, extras: { leadLocation?: string; lossNote?: string }) {
    const user = userEvent.setup();
    render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /perdido/i }));
    expect(lossModal.props).not.toBeNull();
    await act(async () => {
      lossModal.props!.onConfirm(reason, extras);
    });
  }

  describe('AC7 — os 3 caminhos da perda', () => {
    it('🎯 botão PERDIDO ⇒ moveDeal com o local no 6º e a observação no 7º argumento', async () => {
      boardsDoTeste.atual = [BOARD_BASE];
      await perder('Lead sem interação', { leadLocation: 'Santana', lossNote: 'depende do filho' });

      expect(moveDealSpy).toHaveBeenCalledTimes(1);
      const args = moveDealSpy.mock.calls[0];
      expect(args[1]).toBe('stage-perdido');
      expect(args[2]).toBe('Lead sem interação');
      expect(args[5]).toBe('Santana');
      expect(args[6]).toBe('depende do filho');
      // Nada de 2ª escrita pelo updateDeal.
      expect(mutateUpdateDeal).not.toHaveBeenCalled();
    });

    it('"ficar na coluna" (lostStayInStage) também leva local e observação', async () => {
      boardsDoTeste.atual = [{ ...BOARD_BASE, lostStayInStage: true }];
      await perder('Distância', { leadLocation: 'Guarulhos', lossNote: 'mora longe' });

      expect(moveDealSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'deal-1' }),
        'stage-1',
        'Distância',
        false,
        true,
        'Guarulhos',
        'mora longe'
      );
    });

    it('sem local, o 6º argumento é undefined (o local anterior não é apagado); a observação vai como ""', async () => {
      boardsDoTeste.atual = [BOARD_BASE];
      await perder('Preço muito alto', { lossNote: '' });

      expect(moveDealSpy.mock.calls[0][5]).toBeUndefined();
      expect(moveDealSpy.mock.calls[0][6]).toBe('');
    });

    it('fallback sem board: updateDeal leva local e observação junto da perda, sem customFields', async () => {
      await perder('Distância', { leadLocation: 'Rondônia', lossNote: '' });

      expect(moveDealSpy).not.toHaveBeenCalled();
      const { updates } = mutateUpdateDeal.mock.calls[0][0] as { updates: Record<string, unknown> };
      expect(updates.lossReason).toBe('Distância');
      expect(updates.leadLocation).toBe('Rondônia');
      expect(updates).toHaveProperty('lossNote', null);
      expect(updates.isLost).toBe(true);
      expect(updates).not.toHaveProperty('customFields');
      expect(updates).not.toHaveProperty('lossLocation');
    });

    it('o modal de perda recebe o ondeReside como dica e o leadLocation como valor inicial', () => {
      valoresDoCard.atual = { ondeReside: 'Zona Leste, no Carrão' };
      cardExtra.atual = { leadLocation: 'Santana' };
      render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

      expect(lossModal.props?.localSugerido).toBe('Zona Leste, no Carrão');
      expect(lossModal.props?.localAtual).toBe('Santana');
    });
  });

  describe('AC3 — "Onde mora" no topo da coluna lateral, em qualquer etapa', () => {
    it('🎯 card em "Novo" mostra "Onde mora" ANTES de "Empresa (Conta)" na ordem do DOM', () => {
      cardExtra.atual = { leadLocation: 'Santana — depende de apoio' };
      render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

      const ondeMora = screen.getByRole('region', { name: 'Onde mora' });
      const empresa = screen.getByText(/Empresa \(Conta\)/);
      expect(ondeMora.compareDocumentPosition(empresa) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(ondeMora.textContent).toContain('Santana — depende de apoio');
      // É o 1º filho da lista da coluna lateral.
      expect(ondeMora.parentElement?.firstElementChild).toBe(ondeMora);
    });

    it('sem local: "Não informado" e o botão Editar', () => {
      render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

      const ondeMora = screen.getByRole('region', { name: 'Onde mora' });
      expect(within(ondeMora).getByText('Não informado')).toBeInTheDocument();
      expect(within(ondeMora).getByRole('button', { name: /editar/i })).toBeInTheDocument();
    });

    it('editar abre o campo com foco, limite de 200, contador e a dica do ondeReside (nunca gravada)', async () => {
      valoresDoCard.atual = { ondeReside: 'Zona Leste' };
      const user = userEvent.setup();
      render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

      await user.click(within(screen.getByRole('region', { name: 'Onde mora' })).getByRole('button', { name: /editar/i }));
      const campo = screen.getByLabelText(ROTULO_LOCAL);
      expect(campo).toHaveFocus();
      expect(campo).toHaveAttribute('maxLength', '200');
      expect(campo).toHaveAttribute('placeholder', 'Ex.: Zona Leste');
      expect(campo).toHaveValue('');
      expect(screen.getByText('0/200')).toBeInTheDocument();
    });

    it('🎯 Salvar chama updateDeal com EXATAMENTE { leadLocation } — sem customFields, sem lossReason', async () => {
      const user = userEvent.setup();
      render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

      const regiao = screen.getByRole('region', { name: 'Onde mora' });
      await user.click(within(regiao).getByRole('button', { name: /editar/i }));
      await user.type(screen.getByLabelText(ROTULO_LOCAL), '  Santana — depende de apoio ');
      await user.click(within(regiao).getByRole('button', { name: 'Salvar' }));

      expect(mutateUpdateDeal).toHaveBeenCalledTimes(1);
      expect(mutateUpdateDeal.mock.calls[0][0]).toEqual({
        id: 'deal-1',
        updates: { leadLocation: 'Santana — depende de apoio' },
      });
      expect(addToastSpy).toHaveBeenCalledWith('Local salvo.', 'success');
    });

    it('apagar o texto e salvar manda leadLocation vazio (vira null no banco)', async () => {
      cardExtra.atual = { leadLocation: 'Santana' };
      const user = userEvent.setup();
      render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

      const regiao = screen.getByRole('region', { name: 'Onde mora' });
      await user.click(within(regiao).getByRole('button', { name: /editar/i }));
      const campo = screen.getByLabelText(ROTULO_LOCAL);
      expect(campo).toHaveValue('Santana');
      await user.clear(campo);
      await user.click(within(regiao).getByRole('button', { name: 'Salvar' }));

      expect(mutateUpdateDeal.mock.calls[0][0]).toEqual({ id: 'deal-1', updates: { leadLocation: '' } });
    });

    it('🎯 falha ao salvar ⇒ toast de erro e o texto continua no campo', async () => {
      mutateUpdateDeal.mockImplementation(async () => {
        throw new Error('PGRST204: column lead_location does not exist');
      });
      const user = userEvent.setup();
      render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

      const regiao = screen.getByRole('region', { name: 'Onde mora' });
      await user.click(within(regiao).getByRole('button', { name: /editar/i }));
      await user.type(screen.getByLabelText(ROTULO_LOCAL), 'São Paulo');
      await user.click(within(regiao).getByRole('button', { name: 'Salvar' }));

      expect(addToastSpy).toHaveBeenCalledWith(
        'Não deu para salvar o local. O que você digitou continua aí.',
        'error'
      );
      expect(screen.getByLabelText(ROTULO_LOCAL)).toHaveValue('São Paulo');
    });

    it('Cancelar descarta sem gravar', async () => {
      cardExtra.atual = { leadLocation: 'Santana' };
      const user = userEvent.setup();
      render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

      const regiao = screen.getByRole('region', { name: 'Onde mora' });
      await user.click(within(regiao).getByRole('button', { name: /editar/i }));
      await user.type(screen.getByLabelText(ROTULO_LOCAL), ' errado');
      await user.click(within(regiao).getByRole('button', { name: 'Cancelar' }));

      expect(mutateUpdateDeal).not.toHaveBeenCalled();
      expect(screen.getByRole('region', { name: 'Onde mora' }).textContent).toContain('Santana');
    });
  });

  describe('AC4 — bloco do card perdido: motivo e observação', () => {
    it('🎯 perdido por "Preço muito alto" com observação mostra as duas linhas, sem repetir o local', () => {
      cardExtra.atual = {
        isLost: true,
        lossReason: 'Preço muito alto',
        lossNote: 'achou caro, pediu parcelado',
        leadLocation: 'Santana',
      };
      render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

      const bloco = screen.getByRole('region', { name: BLOCO_PERDA });
      expect(bloco.textContent).toContain('Motivo da perda: Preço muito alto');
      expect(bloco.textContent).toContain('Observação: achou caro, pediu parcelado');
      expect(bloco.textContent).not.toContain('Santana');
      expect(within(bloco).queryByRole('button', { name: /editar local/i })).toBeNull();
    });

    it('perdido sem observação mostra "Sem observação" e o botão "Editar observação"', () => {
      cardExtra.atual = { isLost: true, lossReason: 'Lead sem interação' };
      render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

      const bloco = screen.getByRole('region', { name: BLOCO_PERDA });
      expect(within(bloco).getByText('Sem observação')).toBeInTheDocument();
      expect(within(bloco).getByRole('button', { name: 'Editar observação' })).toBeInTheDocument();
    });

    it('perdido sem motivo mostra "Não informado"', () => {
      cardExtra.atual = { isLost: true };
      render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

      expect(screen.getByRole('region', { name: BLOCO_PERDA }).textContent).toContain('Motivo da perda: Não informado');
    });

    it('card aberto (não perdido) NÃO mostra o bloco', () => {
      cardExtra.atual = { leadLocation: 'Santana', lossNote: 'sobra de uma perda antiga' };
      render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

      expect(screen.queryByRole('region', { name: BLOCO_PERDA })).toBeNull();
    });

    it('🎯 Salvar a observação manda EXATAMENTE { lossNote } — sem motivo, status ou fechamento', async () => {
      cardExtra.atual = { isLost: true, lossReason: 'Sem transporte ou apoio para vir' };
      const user = userEvent.setup();
      render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

      const bloco = screen.getByRole('region', { name: BLOCO_PERDA });
      await user.click(within(bloco).getByRole('button', { name: 'Editar observação' }));
      const campo = screen.getByLabelText(ROTULO_OBSERVACAO);
      expect(campo).toHaveFocus();
      expect(campo.tagName).toBe('TEXTAREA');
      expect(campo).toHaveAttribute('maxLength', '500');
      await user.type(campo, ' depende do filho ');
      expect(screen.getByText('18/500')).toBeInTheDocument();
      await user.click(within(bloco).getByRole('button', { name: 'Salvar' }));

      expect(mutateUpdateDeal).toHaveBeenCalledTimes(1);
      expect(mutateUpdateDeal.mock.calls[0][0]).toEqual({ id: 'deal-1', updates: { lossNote: 'depende do filho' } });
      expect(addToastSpy).toHaveBeenCalledWith('Observação salva.', 'success');
      expect(moveDealSpy).not.toHaveBeenCalled();
    });

    it('apagar tudo e salvar manda { lossNote: "" } (o transformDealToDb grava null)', async () => {
      cardExtra.atual = { isLost: true, lossReason: 'Distância', lossNote: 'texto antigo' };
      const user = userEvent.setup();
      render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

      const bloco = screen.getByRole('region', { name: BLOCO_PERDA });
      await user.click(within(bloco).getByRole('button', { name: 'Editar observação' }));
      const campo = screen.getByLabelText(ROTULO_OBSERVACAO);
      expect(campo).toHaveValue('texto antigo');
      await user.clear(campo);
      await user.click(within(bloco).getByRole('button', { name: 'Salvar' }));

      expect(mutateUpdateDeal.mock.calls[0][0]).toEqual({ id: 'deal-1', updates: { lossNote: '' } });
    });

    it('🎯 falha ao salvar a observação ⇒ toast de erro e o texto continua no campo', async () => {
      cardExtra.atual = { isLost: true, lossReason: 'Distância' };
      mutateUpdateDeal.mockImplementation(async () => {
        throw new Error('PGRST204: column loss_note does not exist');
      });
      const user = userEvent.setup();
      render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

      const bloco = screen.getByRole('region', { name: BLOCO_PERDA });
      await user.click(within(bloco).getByRole('button', { name: 'Editar observação' }));
      await user.type(screen.getByLabelText(ROTULO_OBSERVACAO), 'sem apoio');
      await user.click(within(bloco).getByRole('button', { name: 'Salvar' }));

      expect(addToastSpy).toHaveBeenCalledWith(
        'Não deu para salvar a observação. O que você digitou continua aí.',
        'error'
      );
      expect(screen.getByLabelText(ROTULO_OBSERVACAO)).toHaveValue('sem apoio');
    });

    it('Cancelar descarta sem gravar', async () => {
      cardExtra.atual = { isLost: true, lossReason: 'Distância', lossNote: 'texto antigo' };
      const user = userEvent.setup();
      render(<DealDetailModal dealId="deal-1" isOpen onClose={() => {}} />);

      const bloco = screen.getByRole('region', { name: BLOCO_PERDA });
      await user.click(within(bloco).getByRole('button', { name: 'Editar observação' }));
      await user.type(screen.getByLabelText(ROTULO_OBSERVACAO), ' errado');
      await user.click(within(bloco).getByRole('button', { name: 'Cancelar' }));

      expect(mutateUpdateDeal).not.toHaveBeenCalled();
      expect(screen.getByRole('region', { name: BLOCO_PERDA }).textContent).toContain('Observação: texto antigo');
    });
  });
});
