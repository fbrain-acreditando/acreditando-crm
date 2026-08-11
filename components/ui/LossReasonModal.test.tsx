/**
 * Story 2.26 — "Distância" entra nos motivos rápidos de perda.
 *
 * Por que isto tem teste: o `value` de cada botão é o que fica gravado em
 * `deals.loss_reason` e é o que os relatórios agrupam. Mudar um `value` sem
 * migrar as linhas existentes **fragmenta o histórico** — foi exatamente isso
 * que a digitação livre já causou, com `distância`, `distãncia` e
 * `distância e parte financeira` convivendo como motivos distintos.
 *
 * O teste trava o texto canônico e a posição.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LossReasonModal } from './LossReasonModal';

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const props = {
  isOpen: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  dealTitle: 'Maria Silva - WhatsApp',
};

beforeEach(() => vi.clearAllMocks());

describe('LossReasonModal — motivos rápidos', () => {
  it('oferece "Distância" como motivo rápido', () => {
    render(<LossReasonModal {...props} />);
    expect(screen.getByRole('button', { name: /distância/i })).toBeInTheDocument();
  });

  it('grava o valor canônico "Distância" — sem variação de grafia', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<LossReasonModal {...props} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: /distância/i }));

    // Um motivo, um value. É o que permite agrupar no painel.
    expect(onConfirm).toHaveBeenCalledWith('Distância');
  });

  it('"Distância" vem primeiro — é o motivo nº 1 medido (6 de 11 perdas)', () => {
    render(<LossReasonModal {...props} />);
    const botoes = screen.getAllByRole('button');
    const rotulos = botoes.map(b => b.textContent?.trim()).filter(Boolean);

    expect(rotulos[0]).toMatch(/distância/i);
  });

  it('os motivos que já existiam continuam lá', () => {
    render(<LossReasonModal {...props} />);
    for (const rotulo of ['Preço', 'Concorrência', 'Timing', 'Desistência', 'Outro']) {
      expect(screen.getByRole('button', { name: new RegExp(rotulo, 'i') })).toBeInTheDocument();
    }
  });
});
