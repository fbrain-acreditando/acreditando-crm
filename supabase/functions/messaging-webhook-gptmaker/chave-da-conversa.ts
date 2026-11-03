/**
 * Alinhar a chave da conversa à do fornecedor — story 2.63, AC3.
 *
 * ## Por que isto é necessário
 *
 * O CRM ENVIA pela chave da conversa: `app/api/messaging/messages/route.ts` lê
 * `external_contact_id` e o provider manda para `/v2/chat/{to}/send-message`.
 * Se a conversa foi achada pela OUTRA forma do telefone (com/sem o 9º dígito) e
 * continuasse com a chave antiga, o envio iria para um `chatId` que o
 * fornecedor não tem (`400 {"error":"No value present"}`).
 *
 * Então, quando o casamento foi pela variante, a chave passa a ser a do
 * **evento** (a que o fornecedor acabou de usar), e a anterior fica guardada em
 * `metadata.chave_anterior`.
 *
 * ## Contrato
 *
 * - **Nunca lança.** A mensagem é gravada de qualquer jeito.
 * - Se a chave nova já pertence a OUTRA conversa (`UNIQUE (channel_id,
 *   external_contact_id)` ⇒ `23505`), **não troca**: devolve `"ocupada"`.
 * - O `UPDATE` filtra também pela chave ANTERIOR: se alguém já alinhou (entrega
 *   concorrente), 0 linhas ⇒ `"nada-a-fazer"`, sem sobrescrever.
 * - Rule 7 dentro do código: sucesso com ZERO linhas não é sucesso.
 *
 * @module supabase/functions/messaging-webhook-gptmaker/chave-da-conversa
 */

export interface ChaveDbError {
  message?: string;
  code?: string;
}

export interface ChaveConversaClient {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: unknown): {
        maybeSingle(): Promise<{
          data: { metadata: Record<string, unknown> | null } | null;
          error: ChaveDbError | null;
        }>;
      };
    };
    update(values: Record<string, unknown>): {
      eq(col: string, val: unknown): {
        eq(col: string, val: unknown): {
          select(cols: string): Promise<{ data: Array<{ id: string }> | null; error: ChaveDbError | null }>;
        };
      };
    };
  };
}

export type AlinhamentoResultado = "alinhada" | "ocupada" | "nada-a-fazer" | "falhou";

export interface AlinharChaveInput {
  conversationId: string;
  /** Chave do evento — a que o fornecedor usa. */
  chaveNova: string;
  /** Chave com que a conversa estava gravada (a outra forma do telefone). */
  chaveAnterior: string;
}

function ehDuplicado(err: ChaveDbError | null): boolean {
  if (!err) return false;
  if (err.code === "23505") return true;
  return (err.message ?? "").toLowerCase().includes("duplicate");
}

export async function alinharChaveDaConversa(
  client: ChaveConversaClient,
  input: AlinharChaveInput,
  log: (msg: string) => void = () => {},
  agora: string = new Date().toISOString()
): Promise<AlinhamentoResultado> {
  if (!input.chaveNova || input.chaveNova === input.chaveAnterior) return "nada-a-fazer";

  try {
    const { data: conv, error: readErr } = await client
      .from("messaging_conversations")
      .select("metadata")
      .eq("id", input.conversationId)
      .maybeSingle();

    if (readErr || !conv) {
      log(
        `[GPTMaker] 9º dígito — não deu para ler a conversa ${input.conversationId} para alinhar a chave: ${
          readErr?.message ?? "não encontrada"
        } (a mensagem segue)`
      );
      return "falhou";
    }

    const metadata = (conv.metadata as Record<string, unknown>) || {};

    const { data, error } = await client
      .from("messaging_conversations")
      .update({
        external_contact_id: input.chaveNova,
        metadata: {
          ...metadata,
          gptmaker_chat_id: input.chaveNova,
          chave_anterior: input.chaveAnterior,
          chave_alinhada_em: agora,
        },
      })
      .eq("id", input.conversationId)
      .eq("external_contact_id", input.chaveAnterior)
      .select("id");

    if (error) {
      if (ehDuplicado(error)) {
        log(
          `[GPTMaker] 9º dígito — a chave do evento já pertence a outra conversa; a conversa ${input.conversationId} fica com a chave anterior (a mensagem segue)`
        );
        return "ocupada";
      }
      log(
        `[GPTMaker] 9º dígito — falha ao alinhar a chave da conversa ${input.conversationId}: ${
          error.message ?? "sem detalhe"
        } (a mensagem segue)`
      );
      return "falhou";
    }

    if (!data || data.length === 0) {
      log(
        `[GPTMaker] 9º dígito — alinhamento da conversa ${input.conversationId} afetou 0 linhas (já alinhada por outra entrega?)`
      );
      return "nada-a-fazer";
    }

    log(`[GPTMaker] 9º dígito — chave da conversa ${input.conversationId} alinhada à do fornecedor`);
    return "alinhada";
  } catch (e) {
    log(
      `[GPTMaker] 9º dígito — erro inesperado ao alinhar a chave: ${
        e instanceof Error ? e.message : String(e)
      } (a mensagem segue)`
    );
    return "falhou";
  }
}
