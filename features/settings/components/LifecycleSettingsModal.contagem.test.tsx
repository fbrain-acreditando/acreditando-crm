/**
 * Story 2.76 (AC9) — estágio com contato antigo não pode ser excluído.
 *
 * A contagem vem do servidor (`useContactStageCounts`). O `useContacts`
 * (espião) devolveria lista vazia — como quando todos os contatos do estágio
 * são anteriores ao corte dos 1.000 — e não pode ser chamado.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  useContacts: vi.fn(() => ({ data: [] })),
  contagens: { data: undefined as Record<string, number> | undefined, isSuccess: false },
  excluir: vi.fn(),
}));

vi.mock('@/lib/query/hooks/useContactsQuery', () => ({
  useContacts: h.useContacts,
  useContactStageCounts: () => h.contagens,
}));
vi.mock('@/lib/query/hooks/useLifecycleStagesQuery', () => ({
  useLifecycleStages: () => ({
    data: [
      { id: 'st-com-antigos', name: 'Com antigos', color: 'bg-blue-500', isDefault: false, order: 0 },
      { id: 'st-vazio', name: 'Vazio', color: 'bg-green-500', isDefault: false, order: 1 },
    ],
  }),
  useCreateLifecycleStage: () => ({ mutate: vi.fn() }),
  useUpdateLifecycleStage: () => ({ mutate: vi.fn() }),
  useDeleteLifecycleStage: () => ({ mutate: h.excluir }),
  useReorderLifecycleStages: () => ({ mutate: vi.fn() }),
}));

import { LifecycleSettingsModal } from './LifecycleSettingsModal';

/** A linha (li/div) de um estágio, achada pelo input com o nome. */
const linha = (nome: string) => screen.getByDisplayValue(nome).parentElement as HTMLElement;
const botaoExcluir = (nome: string) =>
  within(linha(nome))
    .getAllByRole('button')
    .find(b => b.getAttribute('title')?.match(/remov|contagem/i)) as HTMLButtonElement;

describe('LifecycleSettingsModal — contagem do servidor (story 2.76, AC9)', () => {
  beforeEach(() => {
    h.useContacts.mockClear();
    h.excluir.mockReset();
    h.contagens = { data: { 'st-com-antigos': 7 }, isSuccess: true };
  });

  it('mostra 7 e o excluir fica desabilitado; estágio vazio continua excluível', () => {
    render(<LifecycleSettingsModal isOpen onClose={vi.fn()} />);
    expect(within(linha('Com antigos')).getByTitle('7 contatos neste estágio')).toHaveTextContent('7');
    const excluirComAntigos = botaoExcluir('Com antigos');
    expect(excluirComAntigos).toBeDisabled();
    expect(excluirComAntigos).toHaveAttribute('title', 'Não é possível remover estágio com contatos vinculados');

    expect(within(linha('Vazio')).getByTitle('0 contatos neste estágio')).toHaveTextContent('0');
    expect(botaoExcluir('Vazio')).toBeEnabled();
  });

  it('contagem ainda não carregada → ninguém pode ser excluído', () => {
    h.contagens = { data: undefined, isSuccess: false };
    render(<LifecycleSettingsModal isOpen onClose={vi.fn()} />);
    expect(botaoExcluir('Vazio')).toBeDisabled();
    expect(botaoExcluir('Com antigos')).toBeDisabled();
  });

  it('o componente não chama useContacts', () => {
    render(<LifecycleSettingsModal isOpen onClose={vi.fn()} />);
    expect(h.useContacts).not.toHaveBeenCalled();
  });
});
