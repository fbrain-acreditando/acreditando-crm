/**
 * @fileoverview Decisão de MOVER O CARD quando a IA transfere para humano.
 *
 * A transferência é o sinal de "lead qualificado, pronto para o vendedor" — o
 * momento certo de o card sair de "Lead novo" e entrar em "Em qualificação"
 * sozinho, sem ninguém arrastar.
 *
 * A decisão mora aqui, pura e sem I/O, pelo mesmo motivo de `pickTranscription`:
 * ela tem casos de borda que precisam de teste, e nenhum deles precisa de banco.
 *
 * ⚠️ A REGRA QUE PROTEGE O TRABALHO DO VENDEDOR: nunca andar para trás.
 * Desde `8355ee3` a retransferência REPROCESSA (janela de dedupe de 5 min). Sem
 * essa trava, um lead que a Fernanda já levou para "Proposta enviada" voltaria
 * para "Em qualificação" toda vez que o cliente retomasse a conversa — apagando
 * a posição dela em silêncio, sem erro nenhum.
 *
 * ⚠️ POR QUE O DESTINO VEM POR UUID, e nunca por nome: o board "Acreditando" tem
 * estágios com ESPAÇO SOBRANDO no nome ("Em qualificação " e " Proposta
 * enviada"). Casar por nome falharia em silêncio — 200 para o fornecedor,
 * nenhum erro no log, e o card parado para sempre.
 *
 * @module supabase/functions/messaging-webhook-gptmaker/stage-move
 */

export interface StageMoveInput {
  /** Estágio onde o deal está agora. */
  currentStageId: string | null;
  /** Ordem do estágio atual dentro do board (coluna `order`). */
  currentStageOrder: number | null;
  /** Destino configurado em `lead_routing_rules.transfer_stage_id`. */
  transferStageId: string | null;
  /** Ordem do estágio de destino. */
  transferStageOrder: number | null;
  /** Board do deal. */
  dealBoardId: string | null;
  /** Board da regra de roteamento do canal. */
  ruleBoardId: string | null;
}

export type StageMoveReason =
  | 'sem_destino_configurado'
  | 'destino_nao_encontrado'
  | 'board_diferente'
  | 'ja_esta_no_destino'
  | 'nao_regride'
  | 'mover';

export interface StageMoveDecision {
  move: boolean;
  reason: StageMoveReason;
}

/**
 * Decide se o card deve andar. Devolve sempre o MOTIVO — inclusive quando não
 * move: um card que fica parado sem explicação é indistinguível de bug, e este
 * fluxo roda sem ninguém olhando.
 */
export function decideStageMove(input: StageMoveInput): StageMoveDecision {
  const {
    currentStageId,
    currentStageOrder,
    transferStageId,
    transferStageOrder,
    dealBoardId,
    ruleBoardId,
  } = input;

  // Automação desligada — é o default de toda regra até alguém configurar.
  if (!transferStageId) {
    return { move: false, reason: 'sem_destino_configurado' };
  }

  // Estágio configurado que não existe mais (ou ficou fora do board lido).
  // Sem a ordem do destino não há como garantir a regra de não-regressão, e
  // mover às cegas é pior que não mover.
  if (transferStageOrder === null || transferStageOrder === undefined) {
    return { move: false, reason: 'destino_nao_encontrado' };
  }

  // O deal pode ter sido arrastado para outro board pela equipe. Não sequestrar
  // de volta: o board é escolha de quem opera, não do webhook.
  if (dealBoardId && ruleBoardId && dealBoardId !== ruleBoardId) {
    return { move: false, reason: 'board_diferente' };
  }

  if (currentStageId && currentStageId === transferStageId) {
    return { move: false, reason: 'ja_esta_no_destino' };
  }

  // Deal sem estágio é anomalia de dado; tratar como "antes de tudo" e mover
  // é melhor que deixá-lo invisível fora do funil.
  if (currentStageOrder === null || currentStageOrder === undefined) {
    return { move: true, reason: 'mover' };
  }

  // A trava: só anda para frente. Empate (mesma ordem em estágios diferentes)
  // também não move — ordem duplicada existe no mundo real e, nesse caso, não
  // dá para afirmar qual vem antes.
  if (currentStageOrder >= transferStageOrder) {
    return { move: false, reason: 'nao_regride' };
  }

  return { move: true, reason: 'mover' };
}

// =============================================================================
// T2 — "respondeu, mas ainda não qualificou" (story 2.17)
// =============================================================================

/**
 * As duas chaves que definem "qualificado", ditas pela Fernanda em 11/08.
 *
 * ⚠️ GÊMEO DE `lib/deals/autoStage.ts`. Deno e Node não compartilham import,
 * então a constante existe duas vezes de propósito. **Mudou aqui, muda lá** —
 * e o teste `stageMoveOnReply.test.ts` trava o valor nos dois lados.
 */
export const QUALIFICATION_FIELD_KEYS = ['ondeReside', 'tipoDeLesao'] as const;

/** Vazio, em branco ou só espaços NÃO conta como preenchido. */
export function isFieldFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** O lead atende ao critério de "qualificado" da operação? */
export function isQualified(
  customFields: Record<string, unknown> | null | undefined,
  fieldKeys: readonly string[] = QUALIFICATION_FIELD_KEYS
): boolean {
  if (!customFields) return false;
  return fieldKeys.every((key) => isFieldFilled(customFields[key]));
}

export type ReplyStageReason = StageMoveReason | 'ja_qualificado';

export interface ReplyStageInput extends Omit<StageMoveInput, 'transferStageId' | 'transferStageOrder'> {
  /** Destino do T2 (`lead_routing_rules.replied_stage_id`). */
  repliedStageId: string | null;
  /** Ordem do destino do T2. */
  repliedStageOrder: number | null;
  /** `deals.custom_fields` como está agora. */
  customFields: Record<string, unknown> | null | undefined;
}

/**
 * Decide se o card deve andar por TER RESPONDIDO.
 *
 * O gatilho é a própria mensagem inbound — por isso não há parâmetro
 * "temResposta": se este código está rodando, a resposta acabou de chegar.
 *
 * 🔑 POR QUE MEDIMOS ISTO: em 11/08, `Lead novo` tinha 141 cards e **124 já
 * haviam respondido**. A coluna de entrada estava 88% mentindo, porque a única
 * movimentação existente (`transfer_stage_id`) só dispara quando a IA transfere
 * — e a maioria dos leads responde SEM nunca ser transferida.
 */
export function decideReplyStageMove(input: ReplyStageInput): { move: boolean; reason: ReplyStageReason } {
  const { customFields, repliedStageId, repliedStageOrder, ...rest } = input;

  // Lead já qualificado é assunto do T3, que tem destino mais à frente. Mover
  // para "respondeu" aqui seria puxar o card PARA TRÁS — e a trava de
  // não-regressão bloquearia depois, deixando um log confuso no lugar de uma
  // decisão clara. Sair antes diz a verdade sobre o motivo.
  if (isQualified(customFields)) {
    return { move: false, reason: 'ja_qualificado' };
  }

  return decideStageMove({
    ...rest,
    transferStageId: repliedStageId,
    transferStageOrder: repliedStageOrder,
  });
}
