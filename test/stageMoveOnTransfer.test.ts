/**
 * Movimento do card na transferência para humano — story 2.5.
 *
 * A decisão de mover tem casos de borda que, se errados, causam dano SILENCIOSO
 * nos dois sentidos:
 *
 *  - mover quando não devia → apaga a posição que o vendedor deu ao lead
 *    (a retransferência REPROCESSA desde `8355ee3`, então isso aconteceria
 *    toda vez que um cliente antigo voltasse a falar com a IA);
 *  - não mover quando devia → o card fica parado em "Lead novo" e ninguém
 *    percebe, porque o webhook responde 200 e não há erro em lugar nenhum.
 *
 * Por isso a decisão é pura e testada aqui, e por isso ela devolve SEMPRE um
 * motivo — inclusive quando não move.
 */
import { describe, expect, it } from 'vitest';

import {
  decideStageMove,
  type StageMoveInput,
} from '../supabase/functions/messaging-webhook-gptmaker/stage-move';

const BOARD = 'board-acreditando';
const LEAD_NOVO = 'stage-lead-novo';
/** ⚠️ O nome real deste estágio no banco tem espaço no fim: "Em qualificação ". */
const EM_QUALIFICACAO = 'stage-em-qualificacao';
const PROPOSTA = 'stage-proposta';

/** Cenário feliz: lead recém-criado, em "Lead novo", transferido pela IA. */
function cenarioBase(over: Partial<StageMoveInput> = {}): StageMoveInput {
  return {
    currentStageId: LEAD_NOVO,
    currentStageOrder: 0,
    transferStageId: EM_QUALIFICACAO,
    transferStageOrder: 1,
    dealBoardId: BOARD,
    ruleBoardId: BOARD,
    ...over,
  };
}

describe('decideStageMove — o caso que a Fernanda vê todo dia', () => {
  it('move de "Lead novo" para "Em qualificação"', () => {
    expect(decideStageMove(cenarioBase())).toEqual({ move: true, reason: 'mover' });
  });

  it('move mesmo se o estágio de destino estiver várias posições à frente', () => {
    const d = decideStageMove(cenarioBase({ transferStageId: PROPOSTA, transferStageOrder: 4 }));
    expect(d.move).toBe(true);
  });
});

describe('decideStageMove — a trava que protege o trabalho do vendedor', () => {
  it('NÃO regride um lead que já está adiante no funil', () => {
    // A Fernanda levou o card para "Proposta enviada" (ordem 4); o cliente volta
    // a falar com a IA e é transferido de novo. O card tem que ficar onde está.
    const d = decideStageMove(
      cenarioBase({ currentStageId: PROPOSTA, currentStageOrder: 4 })
    );
    expect(d).toEqual({ move: false, reason: 'nao_regride' });
  });

  it('NÃO move quando já está no destino', () => {
    const d = decideStageMove(
      cenarioBase({ currentStageId: EM_QUALIFICACAO, currentStageOrder: 1 })
    );
    expect(d).toEqual({ move: false, reason: 'ja_esta_no_destino' });
  });

  it('NÃO move em empate de ordem entre estágios diferentes', () => {
    // Ordem duplicada existe no mundo real; nesse caso não dá para afirmar qual
    // vem antes, e mover seria um chute.
    const d = decideStageMove(
      cenarioBase({ currentStageId: 'outro-stage', currentStageOrder: 1 })
    );
    expect(d).toEqual({ move: false, reason: 'nao_regride' });
  });
});

describe('decideStageMove — automação desligada e dado ausente', () => {
  it('não faz nada quando transfer_stage_id é nulo (default de toda regra)', () => {
    const d = decideStageMove(cenarioBase({ transferStageId: null, transferStageOrder: null }));
    expect(d).toEqual({ move: false, reason: 'sem_destino_configurado' });
  });

  it('não move se o estágio configurado não existe mais', () => {
    // ON DELETE SET NULL cobre o apagar; isto cobre o estágio que sumiu do board
    // lido. Sem a ordem do destino não há como garantir a não-regressão.
    const d = decideStageMove(cenarioBase({ transferStageOrder: null }));
    expect(d).toEqual({ move: false, reason: 'destino_nao_encontrado' });
  });

  it('não sequestra deal que a equipe moveu para outro board', () => {
    const d = decideStageMove(cenarioBase({ dealBoardId: 'outro-board' }));
    expect(d).toEqual({ move: false, reason: 'board_diferente' });
  });

  it('move deal sem estágio — anomalia de dado, melhor dentro do funil que invisível', () => {
    const d = decideStageMove(cenarioBase({ currentStageId: null, currentStageOrder: null }));
    expect(d).toEqual({ move: true, reason: 'mover' });
  });

  it('tolera board desconhecido de um dos lados sem bloquear o movimento', () => {
    expect(decideStageMove(cenarioBase({ dealBoardId: null })).move).toBe(true);
    expect(decideStageMove(cenarioBase({ ruleBoardId: null })).move).toBe(true);
  });
});

describe('decideStageMove — o motivo faz parte do contrato', () => {
  it('devolve motivo em toda decisão, inclusive nas que movem', () => {
    const casos: StageMoveInput[] = [
      cenarioBase(),
      cenarioBase({ transferStageId: null }),
      cenarioBase({ currentStageOrder: 9 }),
      cenarioBase({ dealBoardId: 'x' }),
    ];
    for (const c of casos) {
      const d = decideStageMove(c);
      // Card parado sem explicação é indistinguível de bug — e este fluxo roda
      // sem ninguém olhando.
      expect(d.reason).toBeTruthy();
      expect(typeof d.reason).toBe('string');
    }
  });
});
