/**
 * Story 2.28 — AC0.1 / AC0.2: o experimento que decide.
 *
 * O suite do `DealDetailModal` MOCKA o `FocusTrap` (linha 132 daquele arquivo:
 * `FocusTrap: ({ children }) => <>{children}</>`). Ou seja: o componente que os
 * 602 testes exercitaram nunca foi o que roda em produção. Este arquivo existe
 * para fechar exatamente esse furo — monta o `FocusTrap` REAL por cima dos
 * diálogos REAIS e clica nos botões.
 *
 * Previsão do AC0 (registrada ANTES de rodar): como o `FecharComPendenciasDialog`
 * e o `ConfirmDialog` são o MESMO Radix `AlertDialog` com `AlertDialogPortal`,
 * ou os dois reprovam, ou nenhum. Não existe hipótese em que só o novo quebre.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FocusTrap } from '@/lib/a11y/components/FocusTrap';
import { FecharComPendenciasDialog } from './FecharComPendenciasDialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * Reproduz a composição real do `DealDetailModal`: o trap envolve o painel, e o
 * diálogo é montado DENTRO dessa árvore — mas o Radix o teleporta para o
 * `document.body` via portal, ou seja, para FORA do container do trap.
 */
function ModalComTrap({ children }: { children: React.ReactNode }) {
  return (
    <FocusTrap active onEscape={() => {}}>
      <div role="dialog" aria-modal="true" aria-label="Negócio: teste">
        <button type="button">Campo do card</button>
        {children}
      </div>
    </FocusTrap>
  );
}

describe('AC0.1 — o aviso "Você não salvou" dentro do FocusTrap real', () => {
  it('o "Salvar e fechar" responde ao clique', async () => {
    const onSalvarEFechar = vi.fn();
    const user = userEvent.setup();

    render(
      <ModalComTrap>
        <FecharComPendenciasDialog
          isOpen
          quantidade={2}
          onSalvarEFechar={onSalvarEFechar}
          onDescartarEFechar={vi.fn()}
          onContinuarEditando={vi.fn()}
        />
      </ModalComTrap>
    );

    await user.click(screen.getByRole('button', { name: 'Salvar e fechar' }));
    expect(onSalvarEFechar).toHaveBeenCalledTimes(1);
  });

  it('o "Descartar e fechar" responde ao clique', async () => {
    const onDescartarEFechar = vi.fn();
    const user = userEvent.setup();

    render(
      <ModalComTrap>
        <FecharComPendenciasDialog
          isOpen
          quantidade={1}
          onSalvarEFechar={vi.fn()}
          onDescartarEFechar={onDescartarEFechar}
          onContinuarEditando={vi.fn()}
        />
      </ModalComTrap>
    );

    await user.click(screen.getByRole('button', { name: 'Descartar e fechar' }));
    expect(onDescartarEFechar).toHaveBeenCalledTimes(1);
  });

  it('o "Continuar editando" responde ao clique', async () => {
    const onContinuarEditando = vi.fn();
    const user = userEvent.setup();

    render(
      <ModalComTrap>
        <FecharComPendenciasDialog
          isOpen
          quantidade={1}
          onSalvarEFechar={vi.fn()}
          onDescartarEFechar={vi.fn()}
          onContinuarEditando={onContinuarEditando}
        />
      </ModalComTrap>
    );

    await user.click(screen.getByRole('button', { name: 'Continuar editando' }));
    expect(onContinuarEditando).toHaveBeenCalled();
  });
});

describe('AC0.2 — o IRMÃO: excluir card, mesmo Radix, mesmo portal, mesmo trap', () => {
  it('o "Confirmar" da exclusão responde ao clique', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    render(
      <ModalComTrap>
        <ConfirmDialog
          isOpen
          onClose={vi.fn()}
          onConfirm={onConfirm}
          title="Excluir negócio"
          message="Tem certeza?"
        />
      </ModalComTrap>
    );

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('AC5 — o trap continua trapping (o conserto não pode ser "desligar acessibilidade")', () => {
  it('sem diálogo por cima, o Tab circula DENTRO do trap e não vaza para o board atrás', async () => {
    const user = userEvent.setup();

    render(
      <>
        <button type="button">Card do board (fora do trap)</button>
        <FocusTrap active onEscape={() => {}}>
          <div role="dialog" aria-modal="true" aria-label="Negócio: teste">
            <button type="button">Primeiro do card</button>
            <button type="button">Último do card</button>
          </div>
        </FocusTrap>
      </>
    );

    const primeiro = screen.getByRole('button', { name: 'Primeiro do card' });
    const ultimo = screen.getByRole('button', { name: 'Último do card' });
    const foraDoTrap = screen.getByRole('button', { name: 'Card do board (fora do trap)' });

    ultimo.focus();
    expect(ultimo).toHaveFocus();

    // Do último, o Tab tem de DAR A VOLTA para o primeiro — nunca escapar.
    await user.tab();
    expect(foraDoTrap).not.toHaveFocus();
    expect(primeiro).toHaveFocus();
  });
});

describe('AC0 — controle negativo: SEM o trap, os mesmos cliques passam', () => {
  it('o "Salvar e fechar" funciona quando o diálogo não está sob um trap', async () => {
    const onSalvarEFechar = vi.fn();
    const user = userEvent.setup();

    render(
      <FecharComPendenciasDialog
        isOpen
        quantidade={2}
        onSalvarEFechar={onSalvarEFechar}
        onDescartarEFechar={vi.fn()}
        onContinuarEditando={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Salvar e fechar' }));
    expect(onSalvarEFechar).toHaveBeenCalledTimes(1);
  });
});
