/**
 * O eco da mensagem que o CRM acabou de enviar — story 2.53.
 *
 * ## O defeito
 *
 * O GPT Maker **não devolve id de mensagem** no envio. O provider fabrica um
 * (`external_id = "gptmaker:{chatId}:{timestamp}"`, `gptmaker.provider.ts:345`),
 * e segundos depois o **mesmo** envio volta pelo webhook com o id REAL do
 * provedor — com `role: "assistant"`, ou seja, `outbound`. Como os dois ids são
 * diferentes, o índice único `(conversation_id, external_id)` não casa e o
 * webhook insere uma segunda linha.
 *
 * Medido no banco de produção em 20/09/2026: **346 envios do CRM pelo canal
 * GPT Maker, 346 duplicados — 100%**, entre 2026-08-07 e 2026-09-18. O cliente
 * recebeu UMA mensagem; quem duplica é o registro.
 *
 * ## 🔴 O INSERT é a regra; o casamento é a exceção
 *
 * No mesmo período houve **~4.257** eventos outbound contra **346** envios do
 * CRM: **~92% do que sai NÃO vem do CRM** — é a IA do GPT Maker respondendo
 * sozinha, ou alguém digitando no painel do fornecedor. Essas mensagens são
 * legítimas e precisam ser inseridas.
 *
 * E **não existe campo no payload que distinga** eco-do-CRM de resposta-da-IA
 * de humano-no-painel: os 4.438 eventos `role:"assistant"` auditados trazem
 * sempre os mesmos 12 campos, zero correlação. Por isso este módulo é
 * deliberadamente **conservador: na dúvida, não casa — e o chamador insere**.
 * Duplicar um balão é um aborrecimento; engolir mensagem é perder histórico.
 *
 * ## Por que o critério tem ramo por tipo
 *
 * Em **texto**, o conteúdo do eco é igual ao que o CRM gravou e serve de chave.
 * Em **mídia, não**: a URL que volta no eco é diferente da URL que o CRM gravou
 * (conferido par a par em 6 pares de áudio de 16–17/09). Um critério só de
 * conteúdo consertaria 82% dos casos e deixaria o defeito vivo exatamente onde
 * ninguém olharia — com cara de resolvido. Então mídia casa **só por
 * `content_type`**, sem olhar o conteúdo.
 *
 * ## Por que a condição vai DENTRO da escrita
 *
 * Ler a candidata e depois atualizá-la abriria uma corrida entre duas invocações
 * concorrentes da edge function: dois ecos poderiam carimbar a MESMA linha, e a
 * segunda mensagem sumiria. A elegibilidade é repetida como filtro do próprio
 * `UPDATE` (`external_id IS NULL OR LIKE 'gptmaker:%'`) e o resultado é conferido
 * pelas linhas devolvidas. Mesma lição da prévia da conversa (story 2.8).
 */

/** Cliente mínimo necessário — mantém o módulo testável sem o SDK inteiro. */
export interface EchoMatchClient {
  from(table: string): {
    select(cols: string): CandidateQuery;
    update(values: Record<string, unknown>): {
      eq(col: string, val: string): {
        /** Filtro `or` do PostgREST — aqui: "ainda não carimbada com id real". */
        or(expr: string): {
          select(cols: string): Promise<{
            data: Array<{ id: string }> | null;
            error: DbError | null;
          }>;
        };
      };
    };
  };
}

export interface DbError {
  message?: string;
  code?: string;
}

/** Consulta fluente das candidatas. Só `limit()` resolve — o resto encadeia. */
export interface CandidateQuery {
  eq(col: string, val: unknown): CandidateQuery;
  gte(col: string, val: string): CandidateQuery;
  lte(col: string, val: string): CandidateQuery;
  or(expr: string): CandidateQuery;
  order(col: string, opts: { ascending: boolean }): CandidateQuery;
  limit(n: number): Promise<{ data: CandidateRow[] | null; error: DbError | null }>;
}

export interface CandidateRow {
  id: string;
  external_id: string | null;
  content: Record<string, unknown> | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface EchoMatchInput {
  conversationId: string;
  /** `content_type` já derivado pelo parser a partir de images/audios/documents. */
  contentType: string;
  /** Conteúdo do eco — usado **apenas** no ramo de texto. */
  content: Record<string, unknown>;
  /** Carimbo do eco (campo `date` do payload). */
  ecoTimestamp: Date;
  /** Id REAL da mensagem no provedor — é o que vamos carimbar. */
  externalMessageId: string;
  /** `contextId` do GPT Maker, guardado em `metadata.gptmaker_chat_id`. */
  chatId: string;
}

export type EchoMatchOutcome =
  /** Carimbou a linha que o CRM já tinha gravado — o chamador NÃO deve inserir. */
  | { casou: true; messageId: string }
  /** Não é eco de envio do CRM (ou a corrida foi perdida) — o chamador insere. */
  | { casou: false; motivo: "sem-candidata" | "conteudo-diferente" | "corrida" | "erro" };

/**
 * Janela de casamento, em milissegundos.
 *
 * ⚠️ **30 s é medido, não chutado.** Sobre os 346 pares envio→eco de ago–set/2026:
 * min 0,81 s · p50 1,89 s · p95 4,08 s · p99 5,46 s · **máximo 16,30 s**
 * (áudio de 10/09 — o upload da mídia é o que estica a cauda). Zero acima de 30 s.
 *
 * O @po chegou a recomendar 15 s, **antes** de o caso de 16,30 s ser medido —
 * 15 s teria reprovado justamente ele. Quem for apertar este número de volta:
 * **remeça antes**. Apertar demais faz o eco entrar como mensagem nova e o
 * defeito volta.
 */
export const ECHO_MATCH_WINDOW_MS = 30_000;

/** Quantas candidatas trazer. FIFO: a mais antiga não carimbada vence. */
const MAX_CANDIDATAS = 10;

/**
 * Elegibilidade da candidata, na sintaxe `or` do PostgREST.
 *
 * `external_id IS NULL` importa: a linha pode ainda estar `pending`, antes de o
 * `after()` da rota de envio carimbar o id sintético (`route.ts:177-184`). O eco
 * chegou depois do `sent_at` em 120 de 120 pares recentes — mas isso é **ausência
 * medida, não garantia**, e o código tolera o inverso.
 */
const CANDIDATA_ELEGIVEL = "external_id.is.null,external_id.like.gptmaker:*";

/** Texto normalizado do conteúdo — a "chave" do ramo de texto. */
function textoDe(content: Record<string, unknown> | null): string | null {
  if (!content) return null;
  const texto = content["text"];
  return typeof texto === "string" ? texto.trim() : null;
}

/**
 * Tenta carimbar o id real do provedor na linha que o CRM já gravou.
 *
 * Devolve `casou: true` **somente** quando exatamente 1 linha foi afetada. Em
 * qualquer outro cenário — sem candidata, conteúdo diferente, corrida perdida ou
 * erro de banco — devolve `casou: false` e o chamador **insere normalmente**.
 *
 * Nunca lança: uma falha aqui não pode derrubar o webhook. O pior resultado
 * possível desta story não é duplicar, é sumir com mensagem.
 */
export async function casarEcoComMensagemEnviada(
  client: EchoMatchClient,
  input: EchoMatchInput,
  log: (msg: string) => void = () => {}
): Promise<EchoMatchOutcome> {
  const eco = input.ecoTimestamp.getTime();
  // Janela em torno do carimbo do eco, nos dois sentidos: o relógio do provedor
  // (campo `date`) e o do banco (`created_at`) não são o mesmo relógio.
  const inicio = new Date(eco - ECHO_MATCH_WINDOW_MS).toISOString();
  const fim = new Date(eco + ECHO_MATCH_WINDOW_MS).toISOString();

  const { data, error } = await client
    .from("messaging_messages")
    .select("id, external_id, content, created_at, metadata")
    .eq("conversation_id", input.conversationId)
    .eq("direction", "outbound")
    // Ramo por tipo, parte 1: o tipo tem de bater SEMPRE — inclusive em texto.
    .eq("content_type", input.contentType)
    .gte("created_at", inicio)
    .lte("created_at", fim)
    .or(CANDIDATA_ELEGIVEL)
    // FIFO: havendo mais de uma candidata, carimbar a mais antiga. É o que faz
    // dois envios do mesmo texto seguidos casarem cada um com a SUA linha.
    .order("created_at", { ascending: true })
    .limit(MAX_CANDIDATAS);

  if (error) {
    log(`[GPTMaker] Falha ao buscar candidata para o eco: ${error.message ?? "sem detalhe"}`);
    return { casou: false, motivo: "erro" };
  }

  const candidatas = data ?? [];
  if (candidatas.length === 0) return { casou: false, motivo: "sem-candidata" };

  // Ramo por tipo, parte 2: **texto** exige conteúdo igual; **mídia** não olha o
  // conteúdo — a URL do eco difere da URL que o CRM gravou.
  let elegiveis = candidatas;
  if (input.contentType === "text") {
    const textoDoEco = textoDe(input.content);
    if (textoDoEco === null) return { casou: false, motivo: "conteudo-diferente" };
    elegiveis = candidatas.filter((c) => textoDe(c.content) === textoDoEco);
    if (elegiveis.length === 0) return { casou: false, motivo: "conteudo-diferente" };
  }

  // Tenta as candidatas em ordem FIFO. A escrita é condicionada no banco: se
  // outro eco carimbou esta linha no meio do caminho, zero linhas voltam e
  // passamos para a próxima — nunca dois ecos na mesma linha.
  for (const candidata of elegiveis) {
    const metadata = {
      ...((candidata.metadata as Record<string, unknown> | null) ?? {}),
      gptmaker_chat_id: input.chatId,
      gptmaker_message_id: input.externalMessageId,
      source: "gptmaker",
      // Rastro de que esta linha foi carimbada pelo eco, e não inserida por ele.
      gptmaker_echo_matched_at: new Date().toISOString(),
    };

    const { data: afetadas, error: updErr } = await client
      .from("messaging_messages")
      .update({
        external_id: input.externalMessageId,
        status: "sent",
        metadata,
        // ⚠️ O que este UPDATE deliberadamente NÃO toca:
        // `content`, `content_type`, `sender_type`, `sender_user_id`, `created_at`
        // e `sent_at`.
        // - `sender_type` ('user') é o autor na tela — a linha do eco entra com
        //   null, e sobrescrever perderia quem enviou (lição da story 2.47).
        // - `created_at` ordena a conversa junto com `sent_at`
        //   (`MessageThread.tsx:79-89`): sobrescrever com a hora do eco faria a
        //   mensagem PULAR de posição no histórico.
        // - `content`, em mídia, é a URL que o CRM já serve. A do provedor pode
        //   ter vida curta — trocar arriscaria link morto.
      })
      .eq("id", candidata.id)
      .or(CANDIDATA_ELEGIVEL)
      .select("id");

    if (updErr) {
      log(`[GPTMaker] Falha ao carimbar o eco: ${updErr.message ?? "sem detalhe"}`);
      return { casou: false, motivo: "erro" };
    }

    if ((afetadas?.length ?? 0) === 1) {
      return { casou: true, messageId: candidata.id };
    }
  }

  // Todas as candidatas foram carimbadas por outra invocação enquanto líamos.
  // Este eco é de outra mensagem — insere.
  return { casou: false, motivo: "corrida" };
}
