/**
 * Story 2.52 — a tela: 3 estados do botão do card (AC1/AC2), o compositor da 1ª
 * mensagem (AC6) e o aviso "Assumir conversa" (AC4.6). Nenhuma chamada externa:
 * `fetch` é falso e as conversas do contato vêm de um mock do hook de query.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  conversas: [] as Array<Record<string, unknown>>,
  push: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: h.toast }) }));
vi.mock('@/lib/query/hooks/useMessagingConversationsQuery', () => ({
  useConversationsByContact: () => ({ data: h.conversas, isLoading: false }),
}));

import { BotaoConversaDoCard, AVISO_MENSAGEM_ENVIADA } from './BotaoConversaDoCard';
import { limparTravasParaTeste } from './CompositorPrimeiraMensagem';
import { AvisoAssumirConversa, precisaAssumir, TEXTO_AVISO_IA, TEXTO_NAO_ASSUMIU } from './AvisoAssumirConversa';
import { estadoDaConversaDoContato } from '../../hooks/useConversaDoContato';

const DEAL = 'd0000000-0000-4000-8000-00000000000d';
const CONTATO = { id: 'c0000000-0000-4000-8000-00000000000c', phone: '+5512997534278' };

type Resposta = { status: number; body: unknown };
let respostas: Record<string, Resposta>;
let fetchMock: ReturnType<typeof vi.fn>;

function montar(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  h.conversas = [];
  h.push.mockReset();
  h.toast.mockReset();
  limparTravasParaTeste();
  respostas = {
    'GET /api/messaging/conversations/start': { status: 200, body: { usadasHoje: 3, limite: 20 } },
    'POST /api/messaging/conversations/start': { status: 200, body: { conversationId: 'conv-1', usadasHoje: 4, limite: 20 } },
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const chave = `${init?.method ?? 'GET'} ${url}`;
    const r = respostas[chave] ?? { status: 404, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

// ===========================================================================
// AC1/AC2 — os estados do botão
// ===========================================================================
describe('BotaoConversaDoCard — estados (AC1/AC2)', () => {
  it('contato SEM conversa ⇒ "Iniciar conversa no WhatsApp" e nenhum "Mensagem"', () => {
    montar(<BotaoConversaDoCard dealId={DEAL} contact={CONTATO} onNavegar={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Iniciar conversa no WhatsApp/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Mensagem' })).toBeNull();
  });

  it('contato COM conversa ⇒ "Mensagem", que abre /messaging?contactId= como antes', async () => {
    h.conversas = [{ id: 'conv-9', messageCount: 12, metadata: {} }];
    const onNavegar = vi.fn();
    montar(<BotaoConversaDoCard dealId={DEAL} contact={CONTATO} onNavegar={onNavegar} />);
    expect(screen.queryByRole('button', { name: /Iniciar conversa/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Mensagem' }));
    expect(h.push).toHaveBeenCalledWith(`/messaging?contactId=${CONTATO.id}`);
    expect(onNavegar).toHaveBeenCalled();
  });

  it('conversa com inicio_falhou e 0 mensagens conta como SEM conversa (AC4.3)', () => {
    h.conversas = [{ id: 'conv-f', messageCount: 0, metadata: { inicio_falhou: true } }];
    montar(<BotaoConversaDoCard dealId={DEAL} contact={CONTATO} onNavegar={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Iniciar conversa no WhatsApp/ })).toBeInTheDocument();
  });

  it('contato sem telefone ⇒ botão desabilitado com "Contato sem telefone", sem chamada', async () => {
    montar(<BotaoConversaDoCard dealId={DEAL} contact={{ id: CONTATO.id, phone: '' }} onNavegar={vi.fn()} />);
    const botao = screen.getByRole('button', { name: /Iniciar conversa no WhatsApp/ });
    expect(botao).toBeDisabled();
    expect(screen.getByText('Contato sem telefone')).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('estadoDaConversaDoContato ⇒ conversa real ganha da marcada', () => {
    expect(
      estadoDaConversaDoContato([
        { id: 'falhou', messageCount: 0, metadata: { inicio_falhou: true } },
        { id: 'real', messageCount: 0, metadata: {} },
      ])
    ).toEqual({ temConversa: true, conversationId: 'real' });
    expect(estadoDaConversaDoContato([{ id: 'eco', messageCount: 1, metadata: { inicio_falhou: true } }])).toEqual({
      temConversa: true,
      conversationId: 'eco',
    });
  });
});

// ===========================================================================
// AC6 — o compositor
// ===========================================================================
describe('Compositor da 1ª mensagem (AC6)', () => {
  async function abrir(onNavegar = vi.fn()) {
    montar(<BotaoConversaDoCard dealId={DEAL} contact={CONTATO} onNavegar={onNavegar} />);
    await userEvent.click(screen.getByRole('button', { name: /Iniciar conversa no WhatsApp/ }));
    return onNavegar;
  }

  it('abre VAZIO, com o botão Enviar desabilitado e o contador do dia', async () => {
    await abrir();
    expect(screen.getByRole('textbox', { name: 'Primeira mensagem' })).toHaveValue('');
    expect(screen.getByRole('button', { name: /Enviar/ })).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByTestId('contador-do-dia')).toHaveTextContent(
        'Até 20 conversas iniciadas por dia — 3 usadas hoje'
      )
    );
  });

  it('cancelar não chama a rota', async () => {
    await abrir();
    await userEvent.type(screen.getByRole('textbox', { name: 'Primeira mensagem' }), 'Olá');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(posts()).toHaveLength(0);
    expect(screen.queryByRole('textbox', { name: 'Primeira mensagem' })).toBeNull();
  });

  it('enviar texto ⇒ POST com { dealId, text } e só isso; abre /messaging?id= com o aviso', async () => {
    const onNavegar = await abrir();
    await userEvent.type(screen.getByRole('textbox', { name: 'Primeira mensagem' }), 'Olá, Maria! Tudo bem?');
    await userEvent.click(screen.getByRole('button', { name: /Enviar/ }));

    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/messaging?id=conv-1'));
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(String((posts()[0][1] as RequestInit).body))).toEqual({
      dealId: DEAL,
      text: 'Olá, Maria! Tudo bem?',
    });
    expect(h.toast).toHaveBeenCalledWith(AVISO_MENSAGEM_ENVIADA, 'success');
    expect(AVISO_MENSAGEM_ENVIADA).toBe('Mensagem enviada. Ela aparece aqui em instantes.');
    expect(onNavegar).toHaveBeenCalled();
  });

  it('erro do fornecedor ⇒ toast "Não foi possível iniciar a conversa: …", sem navegar, e o botão trava 60 s', async () => {
    respostas['POST /api/messaging/conversations/start'] = {
      status: 502,
      body: { error: 'Não foi possível iniciar a conversa: o WhatsApp recusou o envio (código 400)' },
    };
    await abrir();
    await userEvent.type(screen.getByRole('textbox', { name: 'Primeira mensagem' }), 'Olá');
    await userEvent.click(screen.getByRole('button', { name: /Enviar/ }));

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(
        'Não foi possível iniciar a conversa: o WhatsApp recusou o envio (código 400)',
        'error'
      )
    );
    expect(h.push).not.toHaveBeenCalled();
    const botao = screen.getByRole('button', { name: /Aguarde 60 s/ });
    expect(botao).toBeDisabled();
    await act(async () => {
      await userEvent.click(botao);
    });
    expect(posts()).toHaveLength(1);
  });

  it('429 ⇒ toast com o texto do teto', async () => {
    respostas['POST /api/messaging/conversations/start'] = {
      status: 429,
      body: { error: 'Limite de 20 conversas iniciadas hoje atingido. Tente amanhã.' },
    };
    await abrir();
    await userEvent.type(screen.getByRole('textbox', { name: 'Primeira mensagem' }), 'Olá');
    await userEvent.click(screen.getByRole('button', { name: /Enviar/ }));
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith('Limite de 20 conversas iniciadas hoje atingido. Tente amanhã.', 'error')
    );
  });

  it('409 ⇒ abre a conversa existente, nada disparado de novo', async () => {
    respostas['POST /api/messaging/conversations/start'] = {
      status: 409,
      body: { error: 'Este lead já tem conversa.', conversationId: 'conv-existente' },
    };
    await abrir();
    await userEvent.type(screen.getByRole('textbox', { name: 'Primeira mensagem' }), 'Olá');
    await userEvent.click(screen.getByRole('button', { name: /Enviar/ }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/messaging?id=conv-existente'));
  });
});

// ===========================================================================
// AC4.6 — aviso e botão "Assumir conversa"
// ===========================================================================
describe('AvisoAssumirConversa (AC4.6)', () => {
  it('precisaAssumir: só com humano_pedido e sem humano_confirmado_em', () => {
    expect(precisaAssumir({ humano_pedido: true })).toBe(true);
    expect(precisaAssumir({ humano_pedido: true, humano_falhou: true })).toBe(true);
    expect(precisaAssumir({ humano_pedido: true, humano_confirmado_em: '2026-11-13T15:00:00Z' })).toBe(false);
    expect(precisaAssumir({})).toBe(false);
    expect(precisaAssumir(null)).toBe(false);
  });

  it('confirmado ⇒ nada aparece', () => {
    montar(<AvisoAssumirConversa conversationId="conv-1" metadata={{ humano_pedido: true, humano_confirmado_em: 'x' }} />);
    expect(screen.queryByText(TEXTO_AVISO_IA)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assumir conversa' })).toBeNull();
  });

  it('pendente ⇒ aviso e botão; não confirmou ⇒ toast pedindo para tentar de novo', async () => {
    respostas['POST /api/messaging/conversations/conv-1/assumir'] = { status: 200, body: { confirmado: false } };
    montar(<AvisoAssumirConversa conversationId="conv-1" metadata={{ humano_pedido: true, humano_falhou: true }} />);
    expect(screen.getByText('A IA do WhatsApp ainda pode responder este lead')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Assumir conversa' }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(TEXTO_NAO_ASSUMIU, 'warning'));
    expect(TEXTO_NAO_ASSUMIU).toBe('Não deu para assumir agora. Tente de novo em alguns segundos.');
    expect(posts()[0][0]).toBe('/api/messaging/conversations/conv-1/assumir');
  });
});

// ===========================================================================
// AC6 — nenhum texto visível cita o fornecedor
// ===========================================================================
describe('nenhuma string visível cita o nome do fornecedor', () => {
  it('nas telas renderizadas', async () => {
    montar(
      <>
        <BotaoConversaDoCard dealId={DEAL} contact={CONTATO} onNavegar={vi.fn()} />
        <AvisoAssumirConversa conversationId="conv-1" metadata={{ humano_pedido: true }} />
      </>
    );
    await userEvent.click(screen.getByRole('button', { name: /Iniciar conversa no WhatsApp/ }));
    expect(document.body.textContent ?? '').not.toMatch(/gpt\s*-?\s*maker/i);
  });

  it('nos textos que as rotas devolvem para a tela e nos componentes', () => {
    const raiz = path.resolve(__dirname, '../../../..');
    const arquivos = [
      'lib/messaging/iniciar-conversa/servico.ts',
      'lib/messaging/iniciar-conversa/regras.ts',
      'app/api/messaging/conversations/start/route.ts',
      'app/api/messaging/conversations/[id]/assumir/route.ts',
    ];
    for (const a of arquivos) {
      const fonte = fs.readFileSync(path.join(raiz, a), 'utf8');
      // Só os literais que viram resposta/aviso: `error: '…'`, `error: \`…\``, `motivo: '…'`, `return '…'`.
      const literais = [...fonte.matchAll(/(?:error|motivo|mensagem):\s*(['`])([^'`]*)\1|return\s+(['`])([^'`]*)\3/g)].map(
        (m) => m[2] ?? m[4]
      );
      expect(literais.length).toBeGreaterThan(0);
      for (const l of literais) expect(l, `${a}: ${l}`).not.toMatch(/gpt\s*-?\s*maker/i);
    }
    const pastaUi = path.resolve(__dirname);
    for (const nome of fs.readdirSync(pastaUi).filter((n) => n.endsWith('.tsx') && !n.endsWith('.test.tsx'))) {
      expect(fs.readFileSync(path.join(pastaUi, nome), 'utf8'), nome).not.toMatch(/gpt\s*-?\s*maker/i);
    }
  });
});
