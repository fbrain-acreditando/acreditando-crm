/**
 * Confirmação antes de apagar campo personalizado.
 *
 * Pedido do Filipe em 27/07: a lixeira apagava direto, sem perguntar. Apagar a
 * definição é destrutivo e não tem desfazer na UI — o clique tem que abrir uma
 * pergunta, nunca executar.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CustomFieldDefinition } from '@/types';
import { CustomFieldsManager } from './CustomFieldsManager';

const field: CustomFieldDefinition = {
  id: 'campo-1',
  key: 'tipoDeLesao',
  label: 'Tipo de Lesão',
  type: 'text',
};

const outroCampo: CustomFieldDefinition = {
  id: 'campo-2',
  key: 'ondeReside',
  label: 'Onde reside',
  type: 'text',
};

const onRemoveField = vi.fn();

function renderManager(fields: CustomFieldDefinition[] = [field]) {
  return render(
    <CustomFieldsManager
      customFieldDefinitions={fields}
      newFieldLabel=""
      setNewFieldLabel={vi.fn()}
      newFieldType="text"
      setNewFieldType={vi.fn()}
      newFieldOptions=""
      setNewFieldOptions={vi.fn()}
      editingId={null}
      onStartEditing={vi.fn()}
      onCancelEditing={vi.fn()}
      onSaveField={vi.fn()}
      onRemoveField={onRemoveField}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CustomFieldsManager — confirmação de exclusão', () => {
  it('clicar na lixeira NÃO apaga — abre a pergunta', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByTitle('Remover campo'));

    expect(onRemoveField).not.toHaveBeenCalled();
    expect(await screen.findByText('Remover este campo personalizado?')).toBeInTheDocument();
  });

  it('a pergunta nomeia o campo escolhido', async () => {
    const user = userEvent.setup();
    renderManager([field, outroCampo]);

    // Segunda lixeira = segundo campo
    await user.click(screen.getAllByTitle('Remover campo')[1]);

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Onde reside');
    expect(dialog).not.toHaveTextContent('Tipo de Lesão');
  });

  it('avisa que o dado preenchido não é apagado', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByTitle('Remover campo'));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/não é apagado/i);
  });

  it('confirmar apaga o campo certo', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByTitle('Remover campo'));
    await user.click(await screen.findByRole('button', { name: 'Sim, remover' }));

    await waitFor(() => {
      expect(onRemoveField).toHaveBeenCalledTimes(1);
    });
    expect(onRemoveField).toHaveBeenCalledWith('campo-1');
  });

  it('cancelar não apaga nada e fecha a pergunta', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByTitle('Remover campo'));
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(onRemoveField).not.toHaveBeenCalled();
  });

  it('cancelar e depois escolher outro campo não apaga o primeiro', async () => {
    const user = userEvent.setup();
    renderManager([field, outroCampo]);

    await user.click(screen.getAllByTitle('Remover campo')[0]);
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    await user.click(screen.getAllByTitle('Remover campo')[1]);
    await user.click(await screen.findByRole('button', { name: 'Sim, remover' }));

    await waitFor(() => expect(onRemoveField).toHaveBeenCalledTimes(1));
    expect(onRemoveField).toHaveBeenCalledWith('campo-2');
  });
});
