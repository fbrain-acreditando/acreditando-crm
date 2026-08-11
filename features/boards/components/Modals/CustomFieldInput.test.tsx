/**
 * Stories 2.26 e 2.27 — o campo personalizado.
 *
 * 2.26: *"escrevo, apaga sozinho e depois aparece — fica piscando"*.
 * 2.27: *"toda alteração, quando for feita, precisa clicar em salvar"*.
 *
 * ⚠️ O caso que importa é `reconciliação atrasada`: o componente é
 * re-renderizado com o valor VELHO do servidor no meio da digitação — que é o
 * que o `invalidateQueries(deals.all)` fazia aterrissar. Sem esse caso, o teste
 * passaria com o código antigo.
 *
 * Aqui o pai (o `DealDetailModal`) é simulado por `Pai`, que segura o pendente
 * exatamente como ele faz: pendente ganha do servidor.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
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

/** Réplica mínima da regra do modal: pendente ?? servidor. */
function Pai({
  valorServidor,
  onMudar,
  field = CAMPO,
}: {
  valorServidor: string;
  onMudar?: (k: string, v: string) => void;
  field?: CustomFieldDefinition;
}) {
  const [pendentes, setPendentes] = useState<Record<string, string>>({});
  const valor = pendentes[field.key] ?? valorServidor;
  return (
    <CustomFieldInput
      field={field}
      valor={valor}
      alterado={field.key in pendentes && pendentes[field.key] !== valorServidor}
      onMudar={(k, v) => {
        setPendentes(p => ({ ...p, [k]: v }));
        onMudar?.(k, v);
      }}
    />
  );
}

describe('CustomFieldInput', () => {
  it('digitar NÃO grava — só reporta a mudança', async () => {
    const onMudar = vi.fn();
    const user = userEvent.setup();
    render(<Pai valorServidor="" onMudar={onMudar} />);

    await user.type(screen.getByLabelText('Onde reside'), 'Distância');

    // `onMudar` é local; não existe caminho daqui até uma escrita no banco.
    expect(onMudar).toHaveBeenCalled();
    expect(screen.getByLabelText('Onde reside')).toHaveValue('Distância');
  });

  it('🎯 reconciliação atrasada NÃO apaga o que ela está digitando', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Pai valorServidor="" />);

    const input = screen.getByLabelText('Onde reside');
    await user.type(input, 'São');

    // O refetch aterrissa com o valor velho durante a edição. No código antigo,
    // este re-render devolvia o input para "".
    rerender(<Pai valorServidor="" />);
    expect(input).toHaveValue('São');

    // E com um valor intermediário atrasado.
    rerender(<Pai valorServidor="S" />);
    expect(input).toHaveValue('São');

    await user.type(input, ' Paulo');
    expect(input).toHaveValue('São Paulo');
  });

  it('fora da edição, o campo mostra o servidor (realtime, extração da IA)', () => {
    render(<Pai valorServidor="Santo André" />);
    expect(screen.getByLabelText('Onde reside')).toHaveValue('Santo André');
  });

  it('marca visualmente o campo com alteração pendente', async () => {
    const user = userEvent.setup();
    render(<Pai valorServidor="Guarulhos" />);

    const input = screen.getByLabelText('Onde reside');
    expect(input.className).not.toMatch(/amber/);

    await user.type(input, 'X');

    // Sem pista visual, a barra diz que há pendência e ela não sabe ONDE.
    expect(input.className).toMatch(/amber/);
  });

  it('select também reporta sem gravar', async () => {
    const onMudar = vi.fn();
    const user = userEvent.setup();
    render(<Pai valorServidor="" onMudar={onMudar} field={CAMPO_SELECT} />);

    await user.selectOptions(screen.getByLabelText('Para quem é'), 'Para mim');

    expect(onMudar).toHaveBeenCalledWith('paraQuemE', 'Para mim');
  });
});

/**
 * Prova de que os testes acima DISCRIMINAM.
 *
 * O código defeituoso (story 2.26) era inline no `DealDetailModal` — não há
 * `git stash` que o isole. Reconstruído aqui e submetido às mesmas asserções.
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
      onChange={e => onSalvar('ondeReside', e.target.value)} // ← gravava a cada tecla
    />
  );
}

describe('o código ANTIGO reprova nas mesmas asserções', () => {
  it('🎯 perdia o texto porque o input não tinha memória própria', async () => {
    const user = userEvent.setup();
    render(<InputAntigo valorServidor="" onSalvar={() => {}} />);

    const input = screen.getByLabelText('Onde reside');
    await user.type(input, 'São');

    // O que ela digitava nunca chegava a aparecer: o input só refletia o que o
    // servidor já tinha devolvido, que ainda era o valor velho.
    expect(input).toHaveValue('');
  });

  it('cada tecla ia direto para a escrita', async () => {
    const onSalvar = vi.fn();
    const user = userEvent.setup();
    render(<InputAntigo valorServidor="" onSalvar={onSalvar} />);

    await user.type(screen.getByLabelText('Onde reside'), 'Distância');

    expect(onSalvar.mock.calls.length).toBeGreaterThan(1);
  });
});
