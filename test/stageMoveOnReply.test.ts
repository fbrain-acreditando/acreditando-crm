/**
 * @fileoverview Testes do T2 da story 2.17 — o card sai da coluna de entrada
 * quando o lead responde.
 *
 * 🔑 POR QUE ESTA STORY EXISTE, medido em produção em 11/08: `Lead novo` tinha
 * **141 cards e 124 já haviam respondido**. A coluna de entrada estava 88%
 * mentindo, porque a única movimentação automática que existia só dispara
 * quando a IA transfere — e a maioria dos leads responde sem nunca ser
 * transferida.
 *
 * ⚠️ Este arquivo também trava o CONTRATO ENTRE OS GÊMEOS: a definição de
 * "qualificado" existe duas vezes (Deno em `stage-move.ts`, Node em
 * `lib/deals/autoStage.ts`) porque os runtimes não compartilham import. Os
 * testes abaixo comparam os dois lados campo a campo — se alguém mudar um e
 * esquecer o outro, reprova aqui.
 */

import { describe, it, expect } from 'vitest'
import {
  decideReplyStageMove,
  isQualified as isQualifiedDeno,
  isFieldFilled as isFieldFilledDeno,
  QUALIFICATION_FIELD_KEYS as KEYS_DENO,
} from '../supabase/functions/messaging-webhook-gptmaker/stage-move'
import {
  isQualified as isQualifiedNode,
  isFieldFilled as isFieldFilledNode,
  QUALIFICATION_FIELD_KEYS as KEYS_NODE,
} from '../lib/deals/autoStage'

/** Estágios reais lidos da produção em 11/08 (AC0 da 2.17). */
const LEAD_NOVO = { id: 'stage-lead-novo', order: 0 }
const CONTATO_REALIZADO = { id: 'stage-contato', order: 1 }
const EM_QUALIFICACAO = { id: 'stage-em-qualificacao', order: 2 }
const PROPOSTA = { id: 'stage-proposta', order: 8 }

const BOARD = 'board-acreditando'
const QUALIFICADO = { ondeReside: 'Sapopemba', tipoDeLesao: 'Lesão medular' }

function input(over: Record<string, unknown> = {}) {
  return {
    customFields: {} as Record<string, unknown> | null,
    currentStageId: LEAD_NOVO.id,
    currentStageOrder: LEAD_NOVO.order,
    repliedStageId: EM_QUALIFICACAO.id,
    repliedStageOrder: EM_QUALIFICACAO.order,
    dealBoardId: BOARD,
    ruleBoardId: BOARD,
    ...over,
  }
}

describe('T2 — decideReplyStageMove', () => {
  it('(b) lead que respondeu e não qualificou sai de "Lead novo"', () => {
    expect(decideReplyStageMove(input())).toEqual({ move: true, reason: 'mover' })
  })

  it('cobre o caso real: 124 dos 141 cards de "Lead novo"', () => {
    expect(decideReplyStageMove(input({ customFields: { paraQuemE: 'para mim' } }))).toEqual({
      move: true,
      reason: 'mover',
    })
  })

  it('lead JÁ qualificado é assunto do T3, não deste', () => {
    // Mata: deixar o T2 agir sobre lead qualificado. Sem esta guarda o card
    // seria puxado para trás e a trava de não-regressão bloquearia depois —
    // registrando `nao_regride`, um motivo que MENTE sobre o que aconteceu.
    expect(decideReplyStageMove(input({ customFields: QUALIFICADO }))).toEqual({
      move: false,
      reason: 'ja_qualificado',
    })
  })

  it('(e) card à frente no funil NÃO retrocede', () => {
    expect(
      decideReplyStageMove(
        input({ currentStageId: PROPOSTA.id, currentStageOrder: PROPOSTA.order })
      )
    ).toEqual({ move: false, reason: 'nao_regride' })
  })

  it('(d) card já no destino não é tocado', () => {
    expect(
      decideReplyStageMove(
        input({ currentStageId: EM_QUALIFICACAO.id, currentStageOrder: EM_QUALIFICACAO.order })
      )
    ).toEqual({ move: false, reason: 'ja_esta_no_destino' })
  })

  it('AC10 — sem destino configurado, nada se move', () => {
    expect(decideReplyStageMove(input({ repliedStageId: null }))).toEqual({
      move: false,
      reason: 'sem_destino_configurado',
    })
  })

  it('destino inexistente não move às cegas', () => {
    expect(decideReplyStageMove(input({ repliedStageOrder: null }))).toEqual({
      move: false,
      reason: 'destino_nao_encontrado',
    })
  })

  it('não sequestra card de outro board', () => {
    expect(decideReplyStageMove(input({ dealBoardId: 'outro' }))).toEqual({
      move: false,
      reason: 'board_diferente',
    })
  })

  it('avança de "Contato Realizado" também', () => {
    expect(
      decideReplyStageMove(
        input({ currentStageId: CONTATO_REALIZADO.id, currentStageOrder: CONTATO_REALIZADO.order })
      )
    ).toEqual({ move: true, reason: 'mover' })
  })

  it('a guarda de qualificado vem ANTES da de board', () => {
    // Documenta a precedência: se as duas valem, o motivo registrado é
    // `ja_qualificado`. Reordenar muda o log — e o log é o diagnóstico.
    expect(
      decideReplyStageMove(input({ customFields: QUALIFICADO, dealBoardId: 'outro' }))
    ).toEqual({ move: false, reason: 'ja_qualificado' })
  })
})

describe('contrato entre os gêmeos Deno × Node', () => {
  it('as chaves de qualificação são idênticas nos dois lados', () => {
    expect([...KEYS_DENO]).toEqual([...KEYS_NODE])
  })

  const casos: Array<[string, Record<string, unknown> | null]> = [
    ['os dois campos', QUALIFICADO],
    ['só onde reside', { ondeReside: 'SP' }],
    ['só tipo de lesão', { tipoDeLesao: 'Medular' }],
    ['vazio', {}],
    ['nulo', null],
    ['em branco', { ondeReside: '   ', tipoDeLesao: 'Medular' }],
    ['com os 5 campos', { ...QUALIFICADO, haQuantoTempo: '2 anos', paraQuemE: 'mim', jaFezReabilitacao: 'sim' }],
  ]

  it.each(casos)('isQualified concorda nos dois runtimes: %s', (_nome, fields) => {
    expect(isQualifiedDeno(fields)).toBe(isQualifiedNode(fields))
  })

  const valores: unknown[] = ['', '   ', '\n', 'texto', 0, 1, false, true, null, undefined, [], ['a'], {}]

  it.each(valores.map((v) => [JSON.stringify(v) ?? 'undefined', v]))(
    'isFieldFilled concorda nos dois runtimes: %s',
    (_nome, valor) => {
      expect(isFieldFilledDeno(valor)).toBe(isFieldFilledNode(valor))
    }
  )
})
