/**
 * A prévia da conversa na lista — story 2.8.
 *
 * ## O defeito
 *
 * A atualização de `last_message_preview` era **incondicional**: toda entrega de
 * webhook sobrescrevia a prévia. Como o GPT Maker dispara as mensagens **em
 * rajada** e as entregas HTTP chegam embaralhadas por corrida de rede, **quem
 * chegava por último vencia** — mesmo sendo a mensagem mais antiga.
 *
 * Caso lido de produção (conversa `1d0d503a`, 27/07). Cinco mensagens com 1 ms
 * entre elas; a ordem de chegada não tem relação com a de envio:
 *
 * ```
 *   texto                              sent_at   created_at
 *   "Ficamos felizes com seu…"          .314     (chegou por último)  ← virou a prévia
 *   "No Acreditando, unimos…"           .316      .398
 *   "Contamos com o Sistema…"           .317      .511
 *   "Antes de passar você…"             .318      .482
 *   "Qual é o seu nome?"                .319      .447                ← a última DE VERDADE
 * ```
 *
 * A Fernanda via *"Ficamos felizes com seu interesse…"* numa conversa que tinha
 * parado em **"Qual é o seu nome?"**. Medido em 2026-08-04: **33 conversas** com a
 * prévia de outra mensagem.
 *
 * ## Por que a condição vai DENTRO da escrita
 *
 * Ler o `last_message_at` e depois decidir se escreve criaria exatamente a mesma
 * corrida — só que dentro do nosso código, entre duas invocações concorrentes da
 * edge function. A comparação é um filtro do próprio `UPDATE`: ou a linha casa e
 * é atualizada, ou não casa e nada acontece. Uma operação, sem janela.
 *
 * ## A exceção que protege a Fernanda
 *
 * Mensagem **inbound** reabre a conversa mesmo chegando fora de ordem. Esconder da
 * fila uma conversa em que o cliente falou é pior que mostrar prévia velha — então
 * quando a escrita condicional não pega, o status ainda é garantido à parte.
 */

/** Cliente mínimo necessário — mantém o módulo testável sem o SDK inteiro. */
export interface ConversationPreviewClient {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(
        col: string,
        val: string
      ): {
        /** Filtro `or` do PostgREST — aqui: "nunca teve mensagem OU a de lá é mais antiga". */
        or(expr: string): {
          select(cols: string): Promise<{
            data: Array<{ id: string }> | null;
            error: { message?: string; code?: string } | null;
          }>;
        };
        select(cols: string): Promise<{
          data: Array<{ id: string }> | null;
          error: { message?: string; code?: string } | null;
        }>;
      };
    };
  };
}

export interface PreviewUpdateInput {
  conversationId: string;
  /** Carimbo REAL de envio da mensagem (`sent_at`), não o de chegada. */
  sentAt: string;
  preview: string;
  direction: "inbound" | "outbound";
}

export type PreviewUpdateOutcome =
  /** A mensagem era a mais recente: prévia, direção e carimbo foram atualizados. */
  | { applied: true; reopened: boolean }
  /** Chegou fora de ordem: a prévia foi preservada. */
  | { applied: false; reopened: boolean }
  | { applied: false; reopened: boolean; error: string };

/**
 * Grava a prévia **apenas se** esta mensagem for mais recente que a última
 * registrada na conversa.
 *
 * Nunca lança: falhar em atualizar a prévia não pode derrubar o webhook, que já
 * gravou a mensagem. Prévia velha é ruim; mensagem perdida é pior (`5e53bdd`).
 */
export async function updateConversationPreview(
  client: ConversationPreviewClient,
  input: PreviewUpdateInput,
  log: (msg: string) => void = () => {}
): Promise<PreviewUpdateOutcome> {
  const isInbound = input.direction === "inbound";

  // Aspas duplas em volta do valor: o carimbo ISO não tem vírgula hoje, mas é o
  // separador de termos do `or` do PostgREST — não vale depender do formato.
  const somenteSeMaisNova = `last_message_at.is.null,last_message_at.lt."${input.sentAt}"`;

  const { data, error } = await client
    .from("messaging_conversations")
    .update({
      last_message_at: input.sentAt,
      last_message_preview: input.preview.slice(0, 100),
      last_message_direction: input.direction,
      ...(isInbound ? { status: "open" } : {}),
    })
    .eq("id", input.conversationId)
    .or(somenteSeMaisNova)
    // ⚠️ O PostgREST devolve sucesso mesmo quando ZERO linhas casam. Sem pedir as
    // linhas de volta não dá para distinguir "atualizou" de "o filtro barrou" —
    // e é essa distinção que decide se o inbound ainda precisa reabrir. Mesmo
    // motivo do `.select('id')` da story 2.5.
    .select("id");

  if (error) {
    log(`[GPTMaker] Falha ao atualizar a prévia: ${error.message ?? "sem detalhe"}`);
    return { applied: false, reopened: false, error: error.message ?? "sem detalhe" };
  }

  const applied = (data?.length ?? 0) > 0;
  if (applied) return { applied: true, reopened: isInbound };

  // Chegou fora de ordem. A prévia fica como está — mas se o cliente falou, a
  // conversa não pode continuar escondida.
  if (!isInbound) return { applied: false, reopened: false };

  const { error: reopenErr } = await client
    .from("messaging_conversations")
    .update({ status: "open" })
    .eq("id", input.conversationId)
    .select("id");

  if (reopenErr) {
    log(`[GPTMaker] Falha ao reabrir a conversa: ${reopenErr.message ?? "sem detalhe"}`);
    return { applied: false, reopened: false, error: reopenErr.message ?? "sem detalhe" };
  }

  return { applied: false, reopened: true };
}
