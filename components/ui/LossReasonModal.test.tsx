/**
 * Stories 2.26 / 2.45 / 2.66 / 2.67 — a janela de perda.
 *
 * Por que isto tem teste: o `value` de cada botão é o que fica gravado em
 * `deals.loss_reason` e é o que os relatórios agrupam. Mudar um `value` sem
 * migrar as linhas existentes **fragmenta o histórico** — foi exatamente isso
 * que a digitação livre já causou, com `distância`, `distãncia` e
 * `distância e parte financeira` convivendo como motivos distintos.
 *
 * O teste trava o texto canônico, a posição e (2.67) o que vai junto do
 * motivo: o local, só quando muda, e a observação, sempre.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LossReasonModal } from './LossReasonModal';
import { MOTIVOS_DE_PERDA } from './motivosDePerda';

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const props = {
  isOpen: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  dealTitle: 'Maria Silva - WhatsApp',
};

const ROTULO_LOCAL = 'Onde a pessoa mora? (opcional)';
const ROTULO_OBSERVACAO = 'Observação (opcional)';

beforeEach(() => vi.clearAllMocks());

function rotulosDaGrade(): string[] {
  // Escopado ao grupo: fora dele existem "Fechar modal" e "Pular esta etapa",
  // que não são motivos e bagunçariam a checagem de posição.
  const grade = screen.getByRole('group', { name: /motivos rápidos/i });
  return within(grade)
    .getAllByRole('button')
    .map(b => b.textContent?.trim())
    .filter(Boolean) as string[];
}

describe('LossReasonModal — os value canônicos não mudam (2.26/2.45)', () => {
  // Os 11 value que existiam na `b146505` (2.66), um a um. Mudar qualquer um
  // racha o histórico de `deals.loss_reason`.
  const ANTIGOS: ReadonlyArray<readonly [string, string]> = [
    ['Distância', 'Distância'],
    ['Preço', 'Preço muito alto'],
    ['Só "bom dia"', 'Lead só mandou bom dia'],
    ['Perfil/idade', 'Perfil fora do atendimento (idade)'],
    ['Domiciliar', 'Precisa de atendimento domiciliar'],
    ['Para a Livre', 'Encaminhado para a Livre'],
    ['Sem interesse', 'Lead sem interesse'],
    ['Clicou sem querer', 'Lead clicou sem querer'],
    ['Desistência', 'Cliente desistiu'],
    ['Concorrência', 'Perdeu para concorrente'],
    ['Timing', 'Momento inadequado'],
  ];

  it.each(ANTIGOS)('"%s" continua gravando "%s"', (label, value) => {
    expect(MOTIVOS_DE_PERDA.find(m => m.label === label)?.value).toBe(value);
  });

  it.each(ANTIGOS)('clicar em "%s" chama onConfirm("%s", …) num clique só', async (label, value) => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<LossReasonModal {...props} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: label }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toBe(value);
  });

  it('nenhum motivo pronto abre o campo de texto livre — o ponto é não digitar', async () => {
    const user = userEvent.setup();
    render(<LossReasonModal {...props} />);

    // "Outro" é o único com `value: ''`.
    for (const m of MOTIVOS_DE_PERDA.filter(m => m.value !== '')) {
      await user.click(screen.getByRole('button', { name: m.label }));
      expect(screen.queryByPlaceholderText(/digite o motivo/i)).not.toBeInTheDocument();
    }
    expect(MOTIVOS_DE_PERDA.filter(m => m.value === '').map(m => m.label)).toEqual(['Outro']);
  });
});

describe('LossReasonModal — 4 botões novos e a ordem (story 2.67, AC8)', () => {
  const NOVOS: ReadonlyArray<readonly [string, string]> = [
    ['Sem interação', 'Lead sem interação'],
    ['Sem transporte/apoio', 'Sem transporte ou apoio para vir'],
    ['Sem perfil financeiro', 'Sem perfil financeiro'],
    ['Convênio/plano', 'Quer atendimento por convênio/plano'],
  ];

  it.each(NOVOS)('oferece "%s" e grava o value canônico "%s"', async (rotulo, value) => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<LossReasonModal {...props} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: rotulo }));

    expect(onConfirm).toHaveBeenCalledWith(value, { lossNote: '' });
  });

  it('"Lead sem interação" é, sem diferenciar maiúscula, o texto das 297 perdas antigas', () => {
    expect(MOTIVOS_DE_PERDA[0].value.toLowerCase()).toBe('lead sem interação');
  });

  it('🎯 15 botões + Outro, nesta ordem, com "Sem interação" em 1º (P3)', () => {
    render(<LossReasonModal {...props} />);
    expect(rotulosDaGrade()).toEqual([
      'Sem interação',
      'Distância',
      'Sem transporte/apoio',
      'Preço',
      'Sem perfil financeiro',
      'Desistência',
      'Só "bom dia"',
      'Clicou sem querer',
      'Perfil/idade',
      'Sem interesse',
      'Convênio/plano',
      'Domiciliar',
      'Para a Livre',
      'Timing',
      'Concorrência',
      'Outro',
    ]);
  });
});

describe('LossReasonModal — local e observação no topo (story 2.67, AC6)', () => {
  function abrir(extra: Partial<React.ComponentProps<typeof LossReasonModal>> = {}) {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<LossReasonModal {...props} onConfirm={onConfirm} onClose={onClose} {...extra} />);
    return { onConfirm, onClose, user };
  }

  it('os dois campos aparecem no topo, com rótulos acentuados, limites e contadores', () => {
    abrir();
    const local = screen.getByLabelText(ROTULO_LOCAL);
    const nota = screen.getByLabelText(ROTULO_OBSERVACAO);

    expect(local).toHaveAttribute('maxLength', '200');
    expect(nota).toHaveAttribute('maxLength', '500');
    expect(nota.tagName).toBe('TEXTAREA');
    expect(screen.getByText('0/200')).toBeInTheDocument();
    expect(screen.getByText('0/500')).toBeInTheDocument();
    expect(nota).toHaveAttribute('placeholder', 'Ex.: não tem como vir sozinho, depende de apoio');
  });

  it('🎯 com localAtual="Santana", clicar em "Preço" ⇒ onConfirm("Preço muito alto", { lossNote: "" })', async () => {
    const { onConfirm, onClose, user } = abrir({ localAtual: 'Santana' });

    expect(screen.getByLabelText(ROTULO_LOCAL)).toHaveValue('Santana');
    await user.click(screen.getByRole('button', { name: 'Preço' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]).toEqual(['Preço muito alto', { lossNote: '' }]);
    expect(onClose).toHaveBeenCalled();
  });

  it('🎯 trocar o local e escrever observação ⇒ os dois vão, sem espaços nas pontas', async () => {
    const { onConfirm, user } = abrir({ localAtual: 'Santana' });

    const local = screen.getByLabelText(ROTULO_LOCAL);
    await user.clear(local);
    await user.type(local, '  Santana — sem apoio  ');
    await user.type(screen.getByLabelText(ROTULO_OBSERVACAO), ' depende do filho ');
    await user.click(screen.getByRole('button', { name: 'Sem transporte/apoio' }));

    expect(onConfirm.mock.calls[0]).toEqual([
      'Sem transporte ou apoio para vir',
      { leadLocation: 'Santana — sem apoio', lossNote: 'depende do filho' },
    ]);
  });

  it('apagar o local NÃO manda leadLocation (apagar é só pelo card)', async () => {
    const { onConfirm, user } = abrir({ localAtual: 'Santana' });

    await user.clear(screen.getByLabelText(ROTULO_LOCAL));
    await user.click(screen.getByRole('button', { name: 'Preço' }));

    expect(onConfirm.mock.calls[0][1]).not.toHaveProperty('leadLocation');
  });

  it('local digitado num card sem local vai em leadLocation', async () => {
    const { onConfirm, user } = abrir();

    await user.type(screen.getByLabelText(ROTULO_LOCAL), 'Guarulhos');
    await user.click(screen.getByRole('button', { name: 'Distância' }));

    expect(onConfirm.mock.calls[0]).toEqual(['Distância', { leadLocation: 'Guarulhos', lossNote: '' }]);
  });

  it('🎯 a dica do ondeReside fica no placeholder e NUNCA vira valor', async () => {
    const { onConfirm, user } = abrir({ localSugerido: 'Zona Leste, no Carrão' });

    expect(screen.getByLabelText(ROTULO_LOCAL)).toHaveAttribute('placeholder', 'Ex.: Zona Leste, no Carrão');
    expect(screen.getByLabelText(ROTULO_LOCAL)).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Distância' }));

    expect(onConfirm.mock.calls[0][1]).not.toHaveProperty('leadLocation');
  });

  it('sem ondeReside, a dica padrão aparece', () => {
    abrir();
    expect(screen.getByLabelText(ROTULO_LOCAL)).toHaveAttribute(
      'placeholder',
      'Ex.: Santana (Zona Norte) — depende de apoio para vir'
    );
  });

  it('🎯 Distância perde o 2º passo: um clique chama onConfirm', async () => {
    const { onConfirm, user } = abrir();

    await user.click(screen.getByRole('button', { name: 'Distância' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toBe('Distância');
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument();
  });

  it('🎯 R2 — Enter no campo do local NÃO confirma a perda', async () => {
    const { onConfirm, onClose, user } = abrir();

    await user.type(screen.getByLabelText(ROTULO_LOCAL), 'Santana{Enter}');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Enter na observação quebra linha e não confirma', async () => {
    const { onConfirm, user } = abrir();

    await user.type(screen.getByLabelText(ROTULO_OBSERVACAO), 'linha 1{Enter}linha 2');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByLabelText(ROTULO_OBSERVACAO)).toHaveValue('linha 1\nlinha 2');
  });

  it('"Outro" leva o texto livre como motivo e a observação em lossNote; os campos do topo continuam à vista', async () => {
    const { onConfirm, user } = abrir();

    await user.type(screen.getByLabelText(ROTULO_OBSERVACAO), 'pediu para ligar depois');
    await user.click(screen.getByRole('button', { name: 'Outro' }));
    expect(screen.getByLabelText(ROTULO_LOCAL)).toBeInTheDocument();
    expect(screen.getByLabelText(ROTULO_OBSERVACAO)).toHaveValue('pediu para ligar depois');
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/digite o motivo/i), 'vaquinha');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(onConfirm.mock.calls[0]).toEqual(['vaquinha', { lossNote: 'pediu para ligar depois' }]);
  });

  it('"Pular esta etapa" grava "Não informado" e leva a observação', async () => {
    const { onConfirm, user } = abrir();

    await user.type(screen.getByLabelText(ROTULO_OBSERVACAO), 'sem resposta');
    await user.click(screen.getByRole('button', { name: /pular esta etapa/i }));

    expect(onConfirm.mock.calls[0]).toEqual(['Não informado', { lossNote: 'sem resposta' }]);
  });

  it('observação só com espaços vai como ""', async () => {
    const { onConfirm, user } = abrir();

    await user.type(screen.getByLabelText(ROTULO_OBSERVACAO), '   ');
    await user.click(screen.getByRole('button', { name: 'Preço' }));

    expect(onConfirm.mock.calls[0][1]).toEqual({ lossNote: '' });
  });
});
