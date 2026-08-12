/**
 * @fileoverview Testes do T3 da story 2.17 — o card anda sozinho para
 * "Qualificado", e só quando deve.
 *
 * 🧪 Regra da casa (firmada em 11/08): teste que passa sem exercitar o caminho
 * é teste que mente. Cada bloco abaixo tem pelo menos um caso que REPROVA se a
 * trava correspondente for removida — a lista está em "o que cada caso mata".
 */

import { describe, it, expect } from 'vitest'
import {
  decideAutoStageMove,
  isQualified,
  isFieldFilled,
  QUALIFICATION_FIELD_KEYS,
  type AutoStageInput,
} from './autoStage'

/** Estágios reais lidos da produção em 11/08 (AC0). */
const LEAD_NOVO = { id: '82d1a222-eeff-4627-baed-881908dbd702', order: 0 }
const EM_QUALIFICACAO = { id: '08da2c2b-0b29-4e3b-bfbc-93c373284b93', order: 2 }
const QUALIFICADO = { id: '3b1384fa-5fe2-4725-a8e1-7576a8690637', order: 3 }
const PROPOSTA_ENVIADA = { id: '00000000-0000-4000-8000-000000000008', order: 8 }

const BOARD = 'board-acreditando'

const COMPLETO = { ondeReside: 'Sapopemba', tipoDeLesao: 'Lesão medular' }

function input(over: Partial<AutoStageInput> = {}): AutoStageInput {
  return {
    customFields: COMPLETO,
    currentStageId: EM_QUALIFICACAO.id,
    currentStageOrder: EM_QUALIFICACAO.order,
    qualifiedStageId: QUALIFICADO.id,
    qualifiedStageOrder: QUALIFICADO.order,
    dealBoardId: BOARD,
    ruleBoardId: BOARD,
    ...over,
  }
}

describe('isFieldFilled', () => {
  it('trata string vazia e só-espaços como NÃO preenchido', () => {
    // Mata: usar `!!value`. `""` é falsy por acidente, mas `"   "` é TRUTHY —
    // e é exatamente o que chega de jsonb no mundo real.
    expect(isFieldFilled('')).toBe(false)
    expect(isFieldFilled('   ')).toBe(false)
    expect(isFieldFilled('\n\t ')).toBe(false)
  })

  it('aceita conteúdo real, inclusive 0 e false', () => {
    expect(isFieldFilled('zona leste')).toBe(true)
    expect(isFieldFilled(0)).toBe(true)
    expect(isFieldFilled(false)).toBe(true)
  })

  it('rejeita nulo, indefinido e lista vazia', () => {
    expect(isFieldFilled(null)).toBe(false)
    expect(isFieldFilled(undefined)).toBe(false)
    expect(isFieldFilled([])).toBe(false)
  })
})

describe('isQualified — o critério é o DELA: onde mora + tipo de lesão', () => {
  it('exige os DOIS campos', () => {
    expect(isQualified(COMPLETO)).toBe(true)
    expect(isQualified({ ondeReside: 'Sapopemba' })).toBe(false)
    expect(isQualified({ tipoDeLesao: 'Lesão medular' })).toBe(false)
  })

  it('NÃO exige os outros três que a extração produz', () => {
    // Mata: exigir "extração completa". Medido em 11/08: 63 deals atendem aos
    // dois campos e 59 aos cinco — quem define qualificado é a operação.
    expect(isQualified(COMPLETO)).toBe(true)
    expect(QUALIFICATION_FIELD_KEYS).toEqual(['ondeReside', 'tipoDeLesao'])
  })

  it('não qualifica com campo em branco', () => {
    expect(isQualified({ ondeReside: '  ', tipoDeLesao: 'Lesão medular' })).toBe(false)
  })

  it('aceita chaves de outra organização por parâmetro', () => {
    expect(isQualified({ cidade: 'SP' }, ['cidade'])).toBe(true)
  })
})

describe('decideAutoStageMove', () => {
  it('(c) lead com os dois campos preenchidos vai para Qualificado', () => {
    expect(decideAutoStageMove(input())).toEqual({ move: true, reason: 'mover' })
  })

  it('lead sem qualificação NÃO se move', () => {
    expect(decideAutoStageMove(input({ customFields: { ondeReside: 'SP' } }))).toEqual({
      move: false,
      reason: 'nao_qualificado',
    })
  })

  it('(e) card à frente no funil NÃO retrocede', () => {
    // Mata: remover a trava de monotonicidade. É o caso que apaga o trabalho
    // da Fernanda — ela leva o card para "Proposta enviada" e a extração
    // seguinte o traria de volta para "Qualificado", sem erro nenhum.
    expect(
      decideAutoStageMove(
        input({
          currentStageId: PROPOSTA_ENVIADA.id,
          currentStageOrder: PROPOSTA_ENVIADA.order,
        })
      )
    ).toEqual({ move: false, reason: 'nao_regride' })
  })

  it('(d) card já no destino não é tocado de novo', () => {
    expect(
      decideAutoStageMove(
        input({ currentStageId: QUALIFICADO.id, currentStageOrder: QUALIFICADO.order })
      )
    ).toEqual({ move: false, reason: 'ja_esta_no_destino' })
  })

  it('empate de ordem não move', () => {
    // Ordem duplicada existe no mundo real; sem saber qual vem antes, parar é
    // a única resposta que não corrompe a fila.
    expect(
      decideAutoStageMove(
        input({ currentStageId: 'outro-estagio', currentStageOrder: QUALIFICADO.order })
      )
    ).toEqual({ move: false, reason: 'nao_regride' })
  })

  it('AC10 — sem destino configurado, NADA se move', () => {
    // Mata: fazer a automação nascer ligada. Em 11/08, 185 de 242 cards eram
    // elegíveis: subir ligado reorganizaria 77% do board dela num deploy.
    expect(decideAutoStageMove(input({ qualifiedStageId: null }))).toEqual({
      move: false,
      reason: 'sem_destino_configurado',
    })
  })

  it('destino que não existe mais não move às cegas', () => {
    expect(decideAutoStageMove(input({ qualifiedStageOrder: null }))).toEqual({
      move: false,
      reason: 'destino_nao_encontrado',
    })
  })

  it('não sequestra card que a equipe levou para outro board', () => {
    expect(decideAutoStageMove(input({ dealBoardId: 'outro-board' }))).toEqual({
      move: false,
      reason: 'board_diferente',
    })
  })

  it('deal sem estágio entra no funil em vez de ficar invisível', () => {
    expect(
      decideAutoStageMove(input({ currentStageId: null, currentStageOrder: null }))
    ).toEqual({ move: true, reason: 'mover' })
  })

  it('a ordem das guardas: board errado vence "não qualificado"', () => {
    // Documenta a precedência. Se alguém reordenar as guardas, o motivo
    // registrado no log muda — e o log é como se diagnostica este fluxo.
    expect(
      decideAutoStageMove(input({ dealBoardId: 'outro-board', customFields: {} }))
    ).toEqual({ move: false, reason: 'board_diferente' })
  })

  it('sai antes de tudo quando o destino nem está configurado', () => {
    expect(
      decideAutoStageMove(input({ qualifiedStageId: null, dealBoardId: 'outro-board' }))
    ).toEqual({ move: false, reason: 'sem_destino_configurado' })
  })
})
