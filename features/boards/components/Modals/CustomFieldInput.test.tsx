/**
 * Story 2.26 — o campo personalizado não pode piscar.
 *
 * Relato da Fernanda: *"escrevo, apaga sozinho e depois aparece — fica piscando"*.
 *
 * ⚠️ O teste que importa é o `reconciliação atrasada`: ele **re-renderiza o
 * componente com o valor VELHO do servidor no meio da digitação**, que é
 * exatamente o que o `invalidateQueries(deals.all)` do `onSettled` fazia
 * aterrissar. Sem isso o teste passaria com o código antigo — o input controlado
 * pelo servidor só revela o defeito quando o servidor responde atrasado.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomFieldInput, type CustomFieldDefinition } from './CustomFieldInput';

const CAMPO: CustomFieldDefinition = {
  id: 'f1',
  key: 'ondeReside',
  label: 'Onde reside',
  type: 'text',
};

const CAMPO_SELECT: CustomFieldDefinition = {
  id: 'f2',
  key: 'paraQuemE',
  label: 'Para quem é',
  type: 'select',
  options: ['Para mim', 'Para outra pessoa'],
};

beforeEach(() => vi.clearAllMocks());

describe('story 2.26 — CustomFieldInput', () => {
  it('não grava a cada tecla: digitar uma palavra gera ZERO escritas até sair do campo', async () => {
    const onSalvar = vi.fn();
    const user = userEvent.setup();
    render(<CustomFieldInput field={CAMPO} valorServidor="" onSalvar={onSalvar} />);

    await user.type(screen.getByLabelText('Onde reside'), 'Distância');

    // Antes: 9 UPDATEs, 9 broadcasts de Realtime e ~36 consultas.
    expect(onSalvar).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Onde reside')).toHaveValue('Distância');
  });

  it('🎯 reconciliação atrasada NÃO apaga o que ela está digitando', async () => {
    const onSalvar = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <CustomFieldInput field={CAMPO} valorServidor="" onSalvar={onSalvar} />
    );

    const input = screen.getByLabelText('Onde reside');
    await user.type(input, 'São');

    // O refetch aterrissa com o valor VELHO enquanto o campo está em edição.
    // É este re-render que, no código antigo, devolvia o input para "".
    rerender(<CustomFieldInput field={CAMPO} valorServidor="" onSalvar={onSalvar} />);
    expect(input).toHaveValue('São');

    // E também com um valor intermediário atrasado (o "S" de duas teclas atrás).
    rerender(<CustomFieldInput field={CAMPO} valorServidor="S" onSalvar={onSalvar} />);
    expect(input).toHaveValue('São');

    await user.type(input, ' Paulo');
    expect(input).toHaveValue('São Paulo');
  });

  it('grava UMA vez ao sair do campo, com o valor final', async () => {
    const onSalvar = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <CustomFieldInput field={CAMPO} valorServidor="" onSalvar={onSalvar} />
        <button>fora</button>
      </>
    );

    await user.type(screen.getByLabelText('Onde reside'), 'Distância');
    await user.click(screen.getByRole('button', { name: 'fora' }));

    expect(onSalvar).toHaveBeenCalledTimes(1);
    expect(onSalvar).toHaveBeenCalledWith('ondeReside', 'Distância');
  });

  it('sair do campo sem alterar nada NÃO grava', async () => {
    const onSalvar = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <CustomFieldInput field={CAMPO} valorServidor="Guarulhos" onSalvar={onSalvar} />
        <button>fora</button>
      </>
    );

    await user.click(screen.getByLabelText('Onde reside'));
    await user.click(screen.getByRole('button', { name: 'fora' }));

    // Cada UPDATE dispara Realtime e um refetch do board para todo cliente aberto.
    expect(onSalvar).not.toHaveBeenCalled();
  });

  it('Enter grava sem precisar clicar fora', async () => {
    const onSalvar = vi.fn();
    const user = userEvent.setup();
    render(<CustomFieldInput field={CAMPO} valorServidor="" onSalvar={onSalvar} />);

    await user.type(screen.getByLabelText('Onde reside'), 'Osasco{Enter}');

    expect(onSalvar).toHaveBeenCalledTimes(1);
    expect(onSalvar).toHaveBeenCalledWith('ondeReside', 'Osasco');
  });

  it('Escape descarta a edição e volta ao valor do servidor', async () => {
    const onSalvar = vi.fn();
    const user = userEvent.setup();
    render(<CustomFieldInput field={CAMPO} valorServidor="Guarulhos" onSalvar={onSalvar} />);

    const input = screen.getByLabelText('Onde reside');
    await user.clear(input);
    await user.type(input, 'errado{Escape}');

    expect(input).toHaveValue('Guarulhos');
    expect(onSalvar).not.toHaveBeenCalled();
  });

  it('fora da edição, o campo acompanha o servidor (realtime, extração da IA)', () => {
    const onSalvar = vi.fn();
    const { rerender } = render(
      <CustomFieldInput field={CAMPO} valorServidor="" onSalvar={onSalvar} />
    );

    rerender(<CustomFieldInput field={CAMPO} valorServidor="Santo André" onSalvar={onSalvar} />);

    expect(screen.getByLabelText('Onde reside')).toHaveValue('Santo André');
  });

  it('select grava na hora — ali não há digitação para atropelar', async () => {
    const onSalvar = vi.fn();
    const user = userEvent.setup();
    render(<CustomFieldInput field={CAMPO_SELECT} valorServidor="" onSalvar={onSalvar} />);

    await user.selectOptions(screen.getByLabelText('Para quem é'), 'Para mim');

    expect(onSalvar).toHaveBeenCalledWith('paraQuemE', 'Para mim');
  });
});

/**
 * Prova de que os testes acima DISCRIMINAM.
 *
 * O código defeituoso era inline no `DealDetailModal`, então não há `git stash`
 * que o traga de volta isoladamente. Aqui ele é reconstruído — as duas linhas
 * que existiam em `DealDetailModal.tsx:868` — e submetido às MESMAS asserções.
 * Se ele passasse, os testes acima não estariam medindo nada.
 */
function InputAntigo({
  valorServidor,
  onSalvar,
}: {
  valorServidor: string;
  onSalvar: (key: string, valor: string) => void;
}) {
  return (
    <input
      type="text"
      aria-label="Onde reside"
      value={valorServidor} // ← controlado SÓ pelo servidor
      onChange={e => onSalvar('ondeReside', e.target.value)} // ← grava a cada tecla
    />
  );
}

describe('o código ANTIGO reprova nas mesmas asserções', () => {
  it('gravava a cada tecla', async () => {
    const onSalvar = vi.fn();
    const user = userEvent.setup();
    render(<InputAntigo valorServidor="" onSalvar={onSalvar} />);

    await user.type(screen.getByLabelText('Onde reside'), 'Distância');

    // O CustomFieldInput fecha este caso com 0. O antigo dispara por tecla.
    expect(onSalvar).toHaveBeenCalled();
    expect(onSalvar.mock.calls.length).toBeGreaterThan(1);
  });

  it('🎯 perdia o texto quando o servidor respondia atrasado — o "piscando" dela', async () => {
    const onSalvar = vi.fn();
    const user = userEvent.setup();
    render(<InputAntigo valorServidor="" onSalvar={onSalvar} />);

    const input = screen.getByLabelText('Onde reside');
    await user.type(input, 'São');

    // Sem estado local, o input nunca chega a mostrar o que foi digitado:
    // ele só reflete o que o servidor já devolveu — que ainda é o valor velho.
    expect(input).toHaveValue('');
  });
});
