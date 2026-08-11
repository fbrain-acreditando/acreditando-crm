/**
 * Story 2.27 — geometria do aviso de "não salvou".
 *
 * O defeito que originou estes testes veio de print da tela: o
 * "Descartar e fechar" era um `<button>` cru com `px-4 py-2` na mão, sem o
 * `h-10` e sem o `whitespace-nowrap` que o `buttonVariants` dá aos irmãos ⇒ o
 * rótulo quebrava em duas linhas, o botão crescia e desalinhava a fileira.
 *
 * ⚠️ Teste não enxerga pixel. O que dá para travar é a INVARIANTE que o defeito
 * violou: **os três botões saem da mesma fábrica de estilo**. Se alguém voltar a
 * escrever um à mão, as classes divergem e isto reprova — antes de virar print.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FecharComPendenciasDialog } from './FecharComPendenciasDialog';

const props = {
  isOpen: true,
  quantidade: 1,
  onSalvarEFechar: vi.fn(),
  onDescartarEFechar: vi.fn(),
  onContinuarEditando: vi.fn(),
};

const ROTULOS = [/salvar e fechar/i, /descartar e fechar/i, /continuar editando/i];

beforeEach(() => vi.clearAllMocks());

describe('FecharComPendenciasDialog — geometria', () => {
  it('🎯 os três botões compartilham a mesma geometria', () => {
    render(<FecharComPendenciasDialog {...props} />);

    for (const rotulo of ROTULOS) {
      const botao = screen.getByRole('button', { name: rotulo });
      // `h-10` — sem isso, um botão que quebra o rótulo fica mais alto que os outros.
      expect(botao.className).toMatch(/\bh-10\b/);
      // `whitespace-nowrap` — a causa raiz do print: o rótulo quebrava em duas linhas.
      expect(botao.className).toMatch(/whitespace-nowrap/);
    }
  });

  it('os três botões vivem no MESMO contêiner, empilhado e de largura cheia', () => {
    render(<FecharComPendenciasDialog {...props} />);

    const botoes = ROTULOS.map(r => screen.getByRole('button', { name: r }));
    const pais = new Set(botoes.map(b => b.parentElement));
    // Se um deles sair do footer, a fileira desalinha de novo.
    expect(pais.size).toBe(1);

    const footer = botoes[0].parentElement!;
    expect(footer.className).toMatch(/flex-col/);
    expect(footer.className).toMatch(/\[&>\*\]:w-full/);
  });

  it('o texto muda de singular para plural', () => {
    const { rerender } = render(<FecharComPendenciasDialog {...props} quantidade={1} />);
    expect(screen.getByText(/tem 1 campo alterado/i)).toBeInTheDocument();

    rerender(<FecharComPendenciasDialog {...props} quantidade={3} />);
    expect(screen.getByText(/tem 3 campos alterados/i)).toBeInTheDocument();
  });
});

describe('FecharComPendenciasDialog — as três saídas', () => {
  it.each([
    [/salvar e fechar/i, 'onSalvarEFechar'],
    [/descartar e fechar/i, 'onDescartarEFechar'],
    [/continuar editando/i, 'onContinuarEditando'],
  ] as const)('%s chama %s', async (rotulo, chamada) => {
    const user = userEvent.setup();
    render(<FecharComPendenciasDialog {...props} />);

    await user.click(screen.getByRole('button', { name: rotulo }));

    expect(props[chamada]).toHaveBeenCalledTimes(1);
  });
});
