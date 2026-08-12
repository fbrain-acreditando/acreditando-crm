/**
 * @fileoverview Decisão de MOVER O CARD sozinho quando o lead fica qualificado.
 *
 * Story 2.17 (T3). Gêmeo de
 * `supabase/functions/messaging-webhook-gptmaker/stage-move.ts`, que resolve a
 * mesma pergunta do outro lado da casa (Deno, na transferência para humano).
 * São dois runtimes que não compartilham import — por isso a lógica é
 * duplicada de propósito, e os testes das duas cobrem a MESMA tabela de casos.
 *
 * ⚠️ A TRAVA QUE PROTEGE O TRABALHO DA FERNANDA: nunca andar para trás.
 * Ela é a única vendedora e move os cards na mão o dia inteiro. Se a automação
 * pudesse regredir, um lead que ela levou para "Proposta enviada" voltaria para
 * "Qualificado" na próxima extração — apagando a posição dela sem erro nenhum.
 *
 * ⚠️ POR QUE O DESTINO VEM POR UUID, nunca por nome: o board "Acreditando" tem
 * DOIS estágios com espaço sobrando, e em pontas opostas — `"Em qualificação "`
 * (fim) e `" Proposta enviada"` (início). Casar por texto falha em silêncio.
 *
 * @module lib/deals/autoStage
 */

/**
 * As duas chaves que definem "qualificado", ditas pela Fernanda em 11/08:
 * *"Onde mora e o tipo de lesão"*.
 *
 * 🔑 São DUAS, não as cinco que a extração produz (`haQuantoTempo`,
 * `paraQuemE`, `jaFezReabilitacao` ficam de fora de propósito). Quem define
 * "qualificado" é quem trabalha a fila, não quem escreveu o extrator.
 *
 * Medido em produção em 11/08: 63 deals atendem a estes dois; 59 atendem aos
 * cinco. A diferença é pequena (4), mas o critério é dela.
 */
export const QUALIFICATION_FIELD_KEYS = ['ondeReside', 'tipoDeLesao'] as const

export type AutoStageReason =
  | 'sem_destino_configurado'
  | 'destino_nao_encontrado'
  | 'board_diferente'
  | 'ja_esta_no_destino'
  | 'nao_qualificado'
  | 'nao_regride'
  | 'mover'

export interface AutoStageInput {
  /** `deals.custom_fields` como está no banco (jsonb plano). */
  customFields: Record<string, unknown> | null | undefined
  /** Estágio onde o deal está agora. */
  currentStageId: string | null
  /** Ordem do estágio atual dentro do board. */
  currentStageOrder: number | null
  /** Destino configurado (`lead_routing_rules.qualified_stage_id`). */
  qualifiedStageId: string | null
  /** Ordem do estágio de destino. */
  qualifiedStageOrder: number | null
  /** Board do deal. */
  dealBoardId: string | null
  /** Board da regra de roteamento. */
  ruleBoardId: string | null
  /** Chaves que definem "qualificado". Parametrizável por organização. */
  fieldKeys?: readonly string[]
}

export interface AutoStageDecision {
  move: boolean
  reason: AutoStageReason
}

/**
 * Um campo só conta como preenchido se sobrar conteúdo depois do `trim`.
 *
 * A extração já descarta valor de baixa confiança, mas string vazia e string
 * de espaços chegam ao jsonb do mundo real — e `""` é *falsy* por acidente,
 * não por regra. Deixar isso implícito é como o filtro de `@lid` virou no-op.
 */
export function isFieldFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.length > 0
  return true
}

/** O lead está qualificado pelo critério da operação? */
export function isQualified(
  customFields: Record<string, unknown> | null | undefined,
  fieldKeys: readonly string[] = QUALIFICATION_FIELD_KEYS
): boolean {
  if (!customFields) return false
  return fieldKeys.every((key) => isFieldFilled(customFields[key]))
}

/**
 * Decide se o card deve andar para "Qualificado".
 *
 * Devolve SEMPRE o motivo, inclusive quando não move: este código roda sem
 * ninguém olhando, e card parado sem explicação é indistinguível de bug.
 */
export function decideAutoStageMove(input: AutoStageInput): AutoStageDecision {
  const {
    customFields,
    currentStageId,
    currentStageOrder,
    qualifiedStageId,
    qualifiedStageOrder,
    dealBoardId,
    ruleBoardId,
    fieldKeys = QUALIFICATION_FIELD_KEYS,
  } = input

  // Automação desligada. É o DEFAULT de toda regra até alguém configurar o
  // destino — AC10: a story nasce sem mover nada (185 de 242 cards eram
  // elegíveis em 11/08; ligar isso é ato explícito, não efeito de deploy).
  if (!qualifiedStageId) {
    return { move: false, reason: 'sem_destino_configurado' }
  }

  // Destino configurado que não existe mais. Sem a ordem não há como garantir
  // a não-regressão, e mover às cegas é pior que não mover.
  if (qualifiedStageOrder === null || qualifiedStageOrder === undefined) {
    return { move: false, reason: 'destino_nao_encontrado' }
  }

  // O deal pode ter sido arrastado para outro board pela equipe. O board é
  // escolha de quem opera, não do automatismo.
  if (dealBoardId && ruleBoardId && dealBoardId !== ruleBoardId) {
    return { move: false, reason: 'board_diferente' }
  }

  if (!isQualified(customFields, fieldKeys)) {
    return { move: false, reason: 'nao_qualificado' }
  }

  if (currentStageId && currentStageId === qualifiedStageId) {
    return { move: false, reason: 'ja_esta_no_destino' }
  }

  // Deal sem estágio é anomalia de dado; tratá-lo como "antes de tudo" e mover
  // é melhor que deixá-lo invisível fora do funil.
  if (currentStageOrder === null || currentStageOrder === undefined) {
    return { move: true, reason: 'mover' }
  }

  // A trava. Empate (mesma ordem em estágios diferentes) também não move:
  // ordem duplicada existe no mundo real e, nesse caso, não dá para afirmar
  // qual vem antes.
  if (currentStageOrder >= qualifiedStageOrder) {
    return { move: false, reason: 'nao_regride' }
  }

  return { move: true, reason: 'mover' }
}
