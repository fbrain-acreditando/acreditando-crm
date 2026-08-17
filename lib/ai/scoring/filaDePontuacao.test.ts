/**
 * Story 2.41 — AC2: a fila PARA. Este é o teste que não existia.
 *
 * O defeito da 2.35 não foi um erro de digitação: a fila não tinha contador, e
 * nada no repo reprovava isso. Cada `it` daqui corresponde a um caminho que, em
 * 13–16/08, foi cobrado 288 vezes por dia.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_TENTATIVAS,
  decidirDesfechoDaTentativa,
  itemElegivelParaRodada,
  motivoParaDispensar,
  type EstadoDoCard,
  type StatusDaFila,
} from './filaDePontuacao';

const CARD_OK: EstadoDoCard = {
  existe: true,
  jaPontuado: false,
  notaManual: false,
  emEstagioQuePontua: true,
};

describe('AC2 — a trava de tentativas', () => {
  it('a 1ª e a 2ª falhas devolvem o card para a fila', () => {
    expect(decidirDesfechoDaTentativa(0)).toEqual({
      status: 'pending',
      attempts: 1,
      encerrado: false,
    });
    expect(decidirDesfechoDaTentativa(1)).toEqual({
      status: 'pending',
      attempts: 2,
      encerrado: false,
    });
  });

  it('a 3ª falha ENCERRA o card — é isto que a 2.35 não fazia', () => {
    const desfecho = decidirDesfechoDaTentativa(2);
    expect(desfecho.status).toBe('failed');
    expect(desfecho.attempts).toBe(MAX_TENTATIVAS);
    expect(desfecho.encerrado).toBe(true);
  });

  it('card encerrado NÃO volta para a rodada seguinte (o laço infinito)', () => {
    const encerrado = decidirDesfechoDaTentativa(2);
    expect(
      itemElegivelParaRodada({ status: encerrado.status, attempts: encerrado.attempts })
    ).toBe(false);
  });

  it('nenhuma quantidade de rodadas ressuscita um card que falhou 3 vezes', () => {
    // Simula o que aconteceu de verdade: 288 rodadas por dia.
    let estado = { status: 'pending' as const, attempts: 0 };
    let chamadasDeIA = 0;

    for (let rodada = 0; rodada < 288; rodada++) {
      if (!itemElegivelParaRodada(estado)) continue;
      chamadasDeIA++;
      const desfecho = decidirDesfechoDaTentativa(estado.attempts);
      estado = { status: desfecho.status as 'pending', attempts: desfecho.attempts };
    }

    // Antes: 288. Agora: 3.
    expect(chamadasDeIA).toBe(MAX_TENTATIVAS);
  });
});

describe('AC5 — falha de ambiente não queima o card', () => {
  it('chave de IA ausente não consome tentativa', () => {
    const desfecho = decidirDesfechoDaTentativa(0, false);
    expect(desfecho.attempts).toBe(0);
    expect(desfecho.status).toBe('pending');
    expect(desfecho.encerrado).toBe(false);
  });

  it('a fila sobrevive a mil rodadas sem chave e volta a funcionar depois', () => {
    let estado = { status: 'pending' as const, attempts: 0 };

    for (let i = 0; i < 1000; i++) {
      const d = decidirDesfechoDaTentativa(estado.attempts, false);
      estado = { status: d.status as 'pending', attempts: d.attempts };
    }

    // Repor a chave não pode encontrar a fila morta.
    expect(itemElegivelParaRodada(estado)).toBe(true);
    expect(estado.attempts).toBe(0);
  });
});

/**
 * Story 2.43 — o resgate de item preso em `processing`.
 *
 * O resgate usa a MESMA decisão de uma falha (`decidirDesfechoDaTentativa` com
 * `consomeTentativa = true`) — e é justamente isso que precisa ser provado:
 * resgatar SEM contar recriaria o laço infinito de R$ 197,83 com outro nome.
 */
describe('story 2.43 — o resgate conta a tentativa', () => {
  /** Modela um card que trava a função SEMPRE (conversa gigante, parser quebrado). */
  function simularCardQueTravaSempre(rodadasDeResgate: number) {
    let estado = { status: 'pending' as StatusDaFila, attempts: 0 };
    let vezesQueTravou = 0;

    for (let i = 0; i < rodadasDeResgate; i++) {
      if (!itemElegivelParaRodada(estado)) continue;

      // 1. o item é pego e travado em `processing`
      // 2. a função morre — nada mais escreve nesse item
      vezesQueTravou++;

      // 3. o resgate o encontra e o devolve à fila, CONSUMINDO a tentativa
      const desfecho = decidirDesfechoDaTentativa(estado.attempts, true);
      estado = { status: desfecho.status, attempts: desfecho.attempts };
    }

    return { vezesQueTravou, estado };
  }

  it('um card que trava SEMPRE é resgatado no máximo MAX_TENTATIVAS vezes', () => {
    const { vezesQueTravou } = simularCardQueTravaSempre(500);
    expect(vezesQueTravou).toBe(MAX_TENTATIVAS);
  });

  it('depois do teto o card sai da fila em `failed` — não volta a ser resgatado', () => {
    const { estado } = simularCardQueTravaSempre(500);
    expect(estado.status).toBe('failed');
    expect(itemElegivelParaRodada(estado)).toBe(false);
  });

  it('🪤 o antídoto: resgatar SEM contar tentativa recria o laço infinito', () => {
    // Este teste existe para documentar o que NÃO fazer. Se alguém "consertar" o
    // resgate para não queimar a tentativa do card (parece gentil), o resultado é
    // exatamente o defeito da 2.35 com outro nome.
    let estado = { status: 'pending' as StatusDaFila, attempts: 0 };
    let vezesQueTravou = 0;

    for (let i = 0; i < 288; i++) {
      if (!itemElegivelParaRodada(estado)) continue;
      vezesQueTravou++;
      const desfecho = decidirDesfechoDaTentativa(estado.attempts, /* consomeTentativa */ false);
      estado = { status: desfecho.status, attempts: desfecho.attempts };
    }

    // 288 = uma vez por rodada, para sempre. É o número da fatura de R$ 197,83.
    expect(vezesQueTravou).toBe(288);
    expect(itemElegivelParaRodada(estado)).toBe(true);
  });
});

describe('AC4 — dispensa não é falha', () => {
  it('card íntegro em coluna que pontua NÃO é dispensado', () => {
    expect(motivoParaDispensar(CARD_OK)).toBeNull();
  });

  it('card que saiu da coluna antes da rodada é dispensado, não pontuado', () => {
    expect(motivoParaDispensar({ ...CARD_OK, emEstagioQuePontua: false })).toBe(
      'saiu_da_coluna'
    );
  });

  it('nota manual é intocável (AC3 da 2.35)', () => {
    expect(motivoParaDispensar({ ...CARD_OK, notaManual: true })).toBe('nota_manual');
  });

  it('card já pontuado não é relido — uma entrada, uma avaliação', () => {
    expect(motivoParaDispensar({ ...CARD_OK, jaPontuado: true })).toBe('ja_pontuado');
  });

  it('card excluído não gasta IA (story 2.25)', () => {
    expect(motivoParaDispensar({ ...CARD_OK, existe: false })).toBe('deal_inexistente');
  });

  it('a ordem de precedência protege o mais barato primeiro', () => {
    // Card excluído E já pontuado E manual: a checagem mais barata vence, e
    // nenhuma delas chega a chamar o modelo.
    expect(
      motivoParaDispensar({
        existe: false,
        jaPontuado: true,
        notaManual: true,
        emEstagioQuePontua: false,
      })
    ).toBe('deal_inexistente');
  });
});
