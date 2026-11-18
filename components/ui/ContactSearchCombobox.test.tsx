/**
 * Story 2.76 (AC4) — a busca de contato do "Novo card" vai ao BANCO.
 *
 * O hook `useBuscaDeContatos` roda de verdade (QueryClient real); só o
 * serviço é simulado. `useContacts` é um espião com contatos COM telefone: se
 * o componente voltasse a filtrar essa lista com o `includes('')` antigo,
 * "zzz" listaria todos eles (o defeito de regressão).
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Company, Contact } from '@/types';

const h = vi.hoisted(() => ({
  buscarParaSelecao: vi.fn(),
  useContacts: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false, profile: null, organizationId: 'org1' }),
}));
vi.mock('@/lib/supabase', () => ({ contactsService: { buscarParaSelecao: h.buscarParaSelecao } }));

const EMPRESA: Company = { id: 'emp-1', name: 'Empresa de Teste' } as Company;

vi.mock('@/lib/query/hooks', async () => {
  const real = await vi.importActual<typeof import('@/lib/query/hooks/useBuscaDeContatos')>(
    '@/lib/query/hooks/useBuscaDeContatos'
  );
  return {
    useBuscaDeContatos: real.useBuscaDeContatos,
    useCompanies: () => ({ data: [EMPRESA] }),
    useContacts: h.useContacts,
  };
});

import { ContactSearchCombobox, TEXTOS_DA_BUSCA_DE_CONTATO } from './ContactSearchCombobox';

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

/** Só o banco tem este (criado antes do corte dos 1.000). */
const ANTIGO = contato('99999999-9999-4999-8999-999999999999', {
  name: 'Beatriz Antiga',
  phone: '+5500912345678',
  clientCompanyId: 'emp-1',
});
/** Os da lista do `useContacts` — com telefone (casariam com `includes('')`). */
const DA_LISTA = [
  contato('11111111-1111-4111-8111-111111111111', { name: 'Primeiro Da Lista', phone: '+5500911112222' }),
  contato('22222222-2222-4222-8222-222222222222', { name: 'Segundo Da Lista', phone: '+5500933334444' }),
];

function montar() {
  const props = {
    onSelectContact: vi.fn(),
    onSelectCompany: vi.fn(),
    onCreateNew: vi.fn(),
    selectedContact: null,
    selectedCompany: null,
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ContactSearchCombobox {...props} />
    </QueryClientProvider>
  );
  return { props, input: screen.getByRole('textbox') };
}

describe('ContactSearchCombobox (story 2.76, AC4)', () => {
  beforeEach(() => {
    h.buscarParaSelecao.mockReset();
    h.useContacts.mockReset();
    h.useContacts.mockReturnValue({ data: DA_LISTA, isFetched: true, isError: false });
    h.buscarParaSelecao.mockImplementation(async (termo: string) => ({
      data: termo.toLowerCase().includes('beat') || termo.includes('12345678') ? [ANTIGO] : [],
      error: null,
    }));
  });

  it('contato que só o banco tem aparece e, ao clicar, é o selecionado (e a empresa vem junto)', async () => {
    const user = userEvent.setup();
    const { props, input } = montar();
    await user.type(input, 'Beat');
    const botao = await screen.findByRole('button', { name: /Beatriz Antiga/ });
    await user.click(botao);
    expect(props.onSelectContact).toHaveBeenCalledTimes(1);
    expect(props.onSelectContact.mock.calls[0][0].id).toBe(ANTIGO.id);
    expect(props.onSelectCompany).toHaveBeenCalledWith(EMPRESA);
    expect(h.buscarParaSelecao).toHaveBeenCalledTimes(1);
    expect(h.buscarParaSelecao.mock.calls[0][0]).toBe('Beat');
  });

  it('acha pelos 8 últimos dígitos do telefone', async () => {
    const user = userEvent.setup();
    const { input } = montar();
    await user.type(input, '12345678');
    expect(await screen.findByRole('button', { name: /Beatriz Antiga/ })).toBeInTheDocument();
  });

  it('regressão do includes(""): "zzz" sem resultado no banco → nenhum contato', async () => {
    const user = userEvent.setup();
    const { input } = montar();
    await user.type(input, 'zzz');
    expect(await screen.findByText(TEXTOS_DA_BUSCA_DE_CONTATO.nenhum)).toBeInTheDocument();
    expect(screen.queryByText(/Da Lista/)).toBeNull();
    expect(screen.queryByText(/Beatriz/)).toBeNull();
    // Só o "Criar novo contato" sobra como botão
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual([
      expect.stringContaining('Criar novo contato'),
    ]);
  });

  it('termo curto → aviso, sem consulta; "Criar novo" recebe o termo', async () => {
    const user = userEvent.setup();
    const { props, input } = montar();
    await user.type(input, 'ab');
    expect(screen.getByRole('status')).toHaveTextContent(TEXTOS_DA_BUSCA_DE_CONTATO.termoCurto);
    await new Promise(r => setTimeout(r, 400));
    expect(h.buscarParaSelecao).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Criar novo contato/ }));
    expect(props.onCreateNew).toHaveBeenCalledWith('ab');
  });

  it('carregando → "Buscando…" (role=status) e "Criar novo" presente', async () => {
    let soltar: (v: unknown) => void = () => {};
    h.buscarParaSelecao.mockImplementation(() => new Promise(r => (soltar = r)));
    const user = userEvent.setup();
    const { props, input } = montar();
    await user.type(input, 'Beat');
    expect(screen.getByRole('status')).toHaveTextContent(TEXTOS_DA_BUSCA_DE_CONTATO.buscando);
    await user.click(screen.getByRole('button', { name: /Criar novo contato/ }));
    expect(props.onCreateNew).toHaveBeenCalledWith('Beat');
    soltar({ data: [], error: null });
  });

  it('erro → mensagem de erro e "Criar novo" presente', async () => {
    h.buscarParaSelecao.mockResolvedValue({ data: null, error: new Error('falhou') });
    const user = userEvent.setup();
    const { props, input } = montar();
    await user.type(input, 'Beat');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(TEXTOS_DA_BUSCA_DE_CONTATO.erro)
    );
    expect(screen.queryByText(TEXTOS_DA_BUSCA_DE_CONTATO.nenhum)).toBeNull();
    await user.click(screen.getByRole('button', { name: /Criar novo contato/ }));
    expect(props.onCreateNew).toHaveBeenCalledWith('Beat');
  });

  it('com resultado, "Criar novo" continua presente', async () => {
    const user = userEvent.setup();
    const { input } = montar();
    await user.type(input, 'Beat');
    await screen.findByRole('button', { name: /Beatriz Antiga/ });
    expect(screen.getByRole('button', { name: /Criar novo contato/ })).toBeInTheDocument();
  });

  it('setas e Enter navegam e selecionam', async () => {
    const user = userEvent.setup();
    const { props, input } = montar();
    await user.type(input, 'Beat');
    await screen.findByRole('button', { name: /Beatriz Antiga/ });
    // Enter no 1º item seleciona o contato
    await user.keyboard('{Enter}');
    expect(props.onSelectContact.mock.calls[0][0].id).toBe(ANTIGO.id);
  });

  it('seta para baixo + Enter vai para "Criar novo"', async () => {
    const user = userEvent.setup();
    const { props, input } = montar();
    await user.type(input, 'Beat');
    await screen.findByRole('button', { name: /Beatriz Antiga/ });
    await user.keyboard('{ArrowDown}{Enter}');
    expect(props.onSelectContact).not.toHaveBeenCalled();
    expect(props.onCreateNew).toHaveBeenCalledWith('Beat');
  });

  it('o componente não chama useContacts', async () => {
    const user = userEvent.setup();
    const { input } = montar();
    await user.type(input, 'Beat');
    await screen.findByRole('button', { name: /Beatriz Antiga/ });
    expect(h.useContacts).not.toHaveBeenCalled();
  });

  it('LOW-4: Enter durante a 1ª busca não abre "Criar novo"; quando a busca volta, Enter seleciona o contato existente', async () => {
    let soltar: (v: unknown) => void = () => {};
    h.buscarParaSelecao.mockImplementation(() => new Promise(r => (soltar = r)));
    const user = userEvent.setup();
    const { props, input } = montar();
    await user.type(input, 'Beat');
    expect(screen.getByRole('status')).toHaveTextContent(TEXTOS_DA_BUSCA_DE_CONTATO.buscando);
    await user.keyboard('{Enter}'); // ainda na espera de 300 ms
    expect(props.onCreateNew).not.toHaveBeenCalled();
    await waitFor(() => expect(h.buscarParaSelecao).toHaveBeenCalled());
    await user.keyboard('{Enter}'); // consulta no ar, sem resposta
    expect(props.onCreateNew).not.toHaveBeenCalled();
    expect(props.onSelectContact).not.toHaveBeenCalled();
    soltar({ data: [ANTIGO], error: null });
    await screen.findByRole('button', { name: /Beatriz Antiga/ });
    await user.keyboard('{Enter}');
    expect(props.onCreateNew).not.toHaveBeenCalled();
    expect(props.onSelectContact.mock.calls[0][0].id).toBe(ANTIGO.id);
  });

  describe('QA loop 2.76a (MEDIUM-1) — resultado do termo anterior não é selecionável', () => {
    /** Outro contato, achado só pelo telefone (sintético). */
    const OUTRO = contato('33333333-3333-4333-8333-333333333333', {
      name: 'Outro Pelo Telefone',
      phone: '+5500955556666',
    });

    beforeEach(() => {
      h.buscarParaSelecao.mockImplementation(async (termo: string) => ({
        data: termo.toLowerCase().includes('beat') ? [ANTIGO] : termo.includes('55556666') ? [OUTRO] : [],
        error: null,
      }));
    });

    it('"Beat" → Beatriz; limpa; "55556666" + Enter imediato NÃO seleciona Beatriz; depois seleciona o certo', async () => {
      const user = userEvent.setup();
      const { props, input } = montar();
      await user.type(input, 'Beat');
      await screen.findByRole('button', { name: /Beatriz Antiga/ });
      await user.clear(input);
      await user.type(input, '55556666');
      // Ainda dentro da espera: "Buscando…"
      expect(screen.getByRole('status')).toHaveTextContent(TEXTOS_DA_BUSCA_DE_CONTATO.buscando);
      await user.keyboard('{Enter}');
      expect(props.onSelectContact).not.toHaveBeenCalled();
      expect(props.onCreateNew).not.toHaveBeenCalled();
      // A busca nova volta → Enter seleciona o contato do termo ATUAL
      await screen.findByRole('button', { name: /Outro Pelo Telefone/ });
      expect(screen.queryByText(/Beatriz/)).toBeNull();
      await user.keyboard('{Enter}');
      expect(props.onSelectContact).toHaveBeenCalledTimes(1);
      expect(props.onSelectContact.mock.calls[0][0].id).toBe(OUTRO.id);
    });

    it('clique no item do termo anterior durante a busca nova não seleciona (botão desabilitado)', async () => {
      const user = userEvent.setup();
      const { props, input } = montar();
      await user.type(input, 'Beat');
      await screen.findByRole('button', { name: /Beatriz Antiga/ });
      await user.clear(input);
      await user.type(input, '55556666');
      const velho = screen.getByRole('button', { name: /Beatriz Antiga/ });
      expect(velho).toBeDisabled();
      await user.click(velho);
      expect(props.onSelectContact).not.toHaveBeenCalled();
    });
  });
});
