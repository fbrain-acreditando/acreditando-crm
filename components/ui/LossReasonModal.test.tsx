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
import { render, screen, within } from '@testing-library/react';
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
    // Story 2.66 — Distância agora tem um 2º passo (o local). Confirmar em
    // branco continua gravando o MESMO value canônico.
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    // Um motivo, um value. É o que permite agrupar no painel.
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toBe('Distância');
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

/**
 * Story 2.45 — os 6 motivos novos (18/08).
 *
 * Três vieram do pedido da Fernanda; três da medição dos 64 perdidos. O teste
 * existe pelo mesmo motivo da 2.26: **o `value` é o que o relatório agrupa**.
 * Se alguém "melhorar" o texto de um botão sem migrar as linhas, o histórico
 * racha em duas categorias que descrevem a mesma coisa — que é exatamente o
 * defeito que estes botões vieram consertar.
 */
describe('LossReasonModal — story 2.45', () => {
  // [rótulo visível, value canônico gravado em deals.loss_reason]
  const NOVOS: ReadonlyArray<readonly [string, string]> = [
    ['bom dia', 'Lead só mandou bom dia'],
    ['Perfil/idade', 'Perfil fora do atendimento (idade)'],
    ['Domiciliar', 'Precisa de atendimento domiciliar'],
    ['Para a Livre', 'Encaminhado para a Livre'],
    ['Sem interesse', 'Lead sem interesse'],
    ['Clicou sem querer', 'Lead clicou sem querer'],
  ];

  it.each(NOVOS)('oferece "%s" e grava o value canônico', async (rotulo, value) => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<LossReasonModal {...props} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: new RegExp(rotulo, 'i') }));

    expect(onConfirm).toHaveBeenCalledWith(value);
  });

  it('nenhum motivo novo abre o campo de texto livre — o ponto é não digitar', async () => {
    const user = userEvent.setup();
    render(<LossReasonModal {...props} />);

    // "Outro" é o único que deve pedir digitação. Se um motivo novo tivesse
    // `value: ''`, ele cairia no mesmo ramo e o pedido dela seria em vão:
    // *"para eu não precisar ficar escrevendo o outro"*.
    for (const [rotulo] of NOVOS) {
      await user.click(screen.getByRole('button', { name: new RegExp(rotulo, 'i') }));
      expect(screen.queryByPlaceholderText(/digite o motivo/i)).not.toBeInTheDocument();
    }
  });

  it('a ordem segue a frequência medida — o mais usado primeiro, sem rolar', () => {
    render(<LossReasonModal {...props} />);

    // Escopado ao grupo: fora dele existem "Fechar modal" e "Pular esta etapa",
    // que não são motivos e bagunçariam a checagem de posição.
    const grade = screen.getByRole('group', { name: /motivos rápidos/i });
    const rotulos = within(grade)
      .getAllByRole('button')
      .map(b => b.textContent?.trim())
      .filter(Boolean) as string[];

    // Distância (24) → Preço (11) → bom dia (7) → perfil/idade (5).
    // A ordem não é estética: os 4 primeiros cobrem 47 das 64 perdas medidas,
    // e o modal rola — quem cai abaixo da dobra custa um gesto a mais.
    expect(rotulos[0]).toMatch(/distância/i);
    expect(rotulos[1]).toMatch(/preço/i);
    expect(rotulos[2]).toMatch(/bom dia/i);
    expect(rotulos[3]).toMatch(/perfil\/idade/i);

    // E "Outro" continua sendo a saída de escape, no fim.
    expect(rotulos[rotulos.length - 1]).toMatch(/outro/i);
  });
});

/**
 * Story 2.66 — "Onde a pessoa mora?" ao perder por Distância.
 *
 * Pedido da Fernanda (29/10): *"um campo pra eu preencher o local"*. O local é
 * OPCIONAL (D1), a dica cinza vem do `ondeReside` e NUNCA é gravada (D3), e os
 * outros motivos continuam com um clique e um argumento.
 */
describe('LossReasonModal — local da perda por Distância (story 2.66)', () => {
  const ROTULO_LOCAL = 'Onde a pessoa mora? (bairro, cidade ou estado)';

  async function abrirPassoDoLocal(extra: Partial<React.ComponentProps<typeof LossReasonModal>> = {}) {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<LossReasonModal {...props} onConfirm={onConfirm} onClose={onClose} {...extra} />);
    await user.click(screen.getByRole('button', { name: /distância/i }));
    return { onConfirm, onClose, user };
  }

  it('🎯 clicar em Distância NÃO fecha: abre o campo, com rótulo acentuado e foco nele', async () => {
    const { onConfirm, onClose } = await abrirPassoDoLocal();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const campo = screen.getByLabelText(ROTULO_LOCAL);
    expect(campo).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled();
    // O "Pular esta etapa" sai de cena no 2º passo, como no "Outro".
    expect(screen.queryByRole('button', { name: /pular esta etapa/i })).not.toBeInTheDocument();
  });

  it('🎯 Confirmar com texto ⇒ onConfirm("Distância", { lossLocation }) sem espaços nas pontas', async () => {
    const { onConfirm, onClose, user } = await abrirPassoDoLocal();

    await user.type(screen.getByLabelText(ROTULO_LOCAL), '  Manaus/AM  ');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('Distância', { lossLocation: 'Manaus/AM' });
    expect(onClose).toHaveBeenCalled();
  });

  it('Enter confirma', async () => {
    const { onConfirm, user } = await abrirPassoDoLocal();

    await user.type(screen.getByLabelText(ROTULO_LOCAL), 'Guarulhos{Enter}');

    expect(onConfirm).toHaveBeenCalledWith('Distância', { lossLocation: 'Guarulhos' });
  });

  it('🎯 campo vazio com a dica do ondeReside ⇒ onConfirm recebe {} (a dica nunca é gravada)', async () => {
    const { onConfirm, user } = await abrirPassoDoLocal({ localSugerido: 'Zona Leste, no Carrão' });

    expect(screen.getByLabelText(ROTULO_LOCAL)).toHaveAttribute('placeholder', 'Ex.: Zona Leste, no Carrão');
    expect(screen.getByLabelText(ROTULO_LOCAL)).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(onConfirm).toHaveBeenCalledWith('Distância', {});
    expect(onConfirm.mock.calls[0][1]).not.toHaveProperty('lossLocation');
  });

  it('só espaços conta como vazio', async () => {
    const { onConfirm, user } = await abrirPassoDoLocal();

    await user.type(screen.getByLabelText(ROTULO_LOCAL), '   ');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(onConfirm).toHaveBeenCalledWith('Distância', {});
  });

  it('sem ondeReside, a dica padrão aparece', async () => {
    await abrirPassoDoLocal();
    expect(screen.getByLabelText(ROTULO_LOCAL)).toHaveAttribute(
      'placeholder',
      'Ex.: Zona Leste de SP, Guarulhos, Manaus/AM'
    );
  });

  it('Voltar devolve à lista SEM chamar onConfirm', async () => {
    const { onConfirm, user } = await abrirPassoDoLocal();

    await user.type(screen.getByLabelText(ROTULO_LOCAL), 'Osasco');
    await user.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: /motivos rápidos/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(ROTULO_LOCAL)).not.toBeInTheDocument();
  });

  it('limite de 120 caracteres, com contador visível', async () => {
    const { user } = await abrirPassoDoLocal();
    const campo = screen.getByLabelText(ROTULO_LOCAL);

    expect(campo).toHaveAttribute('maxLength', '120');
    await user.type(campo, 'Carrão');
    expect(screen.getByText('6/120')).toBeInTheDocument();
  });

  it('os outros motivos seguem com UM clique e UM argumento', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<LossReasonModal {...props} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: /preço/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]).toEqual(['Preço muito alto']);
  });

  it('"Pular esta etapa" segue com um argumento', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<LossReasonModal {...props} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: /pular esta etapa/i }));

    expect(onConfirm.mock.calls[0]).toEqual(['Não informado']);
  });

  it('"Outro" segue exigindo texto e grava um argumento', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<LossReasonModal {...props} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: /outro/i }));
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/digite o motivo/i), 'vaquinha');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(onConfirm.mock.calls[0]).toEqual(['vaquinha']);
  });
});
