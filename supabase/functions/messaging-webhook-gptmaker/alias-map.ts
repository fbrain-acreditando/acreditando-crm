/**
 * O apelido que devolve o telefone — story 2.56.
 *
 * ## O defeito
 *
 * O GPT Maker às vezes identifica o MESMO chat pelo número oculto do WhatsApp
 * (`@lid`) em vez do telefone. O `contextId` muda, o webhook não acha a conversa
 * por `(channel_id, external_contact_id)` e nasce tudo de novo: conversa nova,
 * contato SEM telefone, card novo. O lead Bruno Nascimento Motta (21/09/2026)
 * ficou com as 8 perguntas dele num card e as 5 respostas da atendente noutro.
 *
 * ## O único vínculo que NÃO é invenção
 *
 * O spike do @analyst (23/09) mediu quatro caminhos. O que sobrou: o próprio
 * payload às vezes traz, **no mesmo evento**, o `contextId` com `@lid` e um
 * `contactPhone` numérico. Dos 196 lids, **95 (48%) têm ao menos um evento
 * assim — e todos os 95 resolvem para telefone único, zero ambiguidade**.
 *
 * A heurística por janela de tempo (±30 min) foi medida e **refutada**: 55,2%
 * dos pares são ambíguos. Casar identidade por proximidade temporal é inventar
 * vínculo — o erro que a story 2.53 ensinou a não cometer.
 *
 * ## 🔴 Conservador por construção: na dúvida, NÃO resolve
 *
 * Só `status = 'resolved'` reconcilia. Lid nunca visto com telefone, ou lid que
 * já apontou para dois telefones diferentes, **não resolve nada** — o evento
 * segue pelo caminho de hoje (conversa nova, card novo) e a linha fica
 * **marcada** para a fila de revisão da story 2.57 (D2 = B).
 *
 * O pior desfecho desta família de correções não é duplicar card: é juntar duas
 * pessoas diferentes, ou sumir com mensagem. Por isso nenhuma função deste
 * módulo lança, nenhuma apaga nada e nenhuma dispara merge.
 *
 * @module supabase/functions/messaging-webhook-gptmaker/alias-map
 */

// =============================================================================
// CLIENTE MÍNIMO — mantém o módulo testável sem o SDK inteiro
// =============================================================================

export interface DbError {
  message?: string;
  code?: string;
}

export interface AliasRow {
  id: string;
  alias: string;
  phone: string | null;
  status: AliasStatus;
  conflicting_phones: string[] | null;
  conversation_id: string | null;
  deal_id: string | null;
  review_reason: string | null;
}

export type AliasStatus = "unresolved" | "resolved" | "ambiguous";

export interface AliasSelectQuery {
  eq(col: string, val: unknown): AliasSelectQuery;
  maybeSingle(): Promise<{ data: AliasRow | null; error: DbError | null }>;
}

export interface AliasUpdateQuery {
  eq(col: string, val: unknown): AliasUpdateQuery;
  select(cols: string): Promise<{ data: AliasRow[] | null; error: DbError | null }>;
}

export interface AliasTable {
  select(cols: string): AliasSelectQuery;
  insert(values: Record<string, unknown>): {
    select(cols: string): {
      single(): Promise<{ data: AliasRow | null; error: DbError | null }>;
    };
  };
  update(values: Record<string, unknown>): AliasUpdateQuery;
}

export interface AliasMapClient {
  from(table: string): AliasTable;
}

export const ALIAS_TABLE = "messaging_contact_aliases";

/** Motivos de revisão (AC4, item 2). Texto fixo — a 2.57 vai filtrar por ele. */
export const MOTIVO_SEM_TELEFONE = "sem-telefone-no-payload";
export const MOTIVO_AMBIGUO = "alias-ambiguo";

// =============================================================================
// LEITURA — AC2
// =============================================================================

export interface AliasLookup {
  /** Telefone normalizado (+55…) quando, e SOMENTE quando, `status = 'resolved'`. */
  phone: string | null;
  /** `null` quando o lid nunca foi visto. */
  status: AliasStatus | null;
  row: AliasRow | null;
}

/**
 * "Este lid resolve para um telefone?"
 *
 * Devolve telefone **apenas** em `status = 'resolved'`. `ambiguous` e
 * `unresolved` devolvem `phone: null` de propósito — o chamador segue pelo
 * caminho de hoje. Um erro de banco também devolve `phone: null`: indisponível
 * é indistinguível de "não sei", e "não sei" não pode virar casamento.
 */
export async function resolverAlias(
  client: AliasMapClient,
  input: { channelId: string; alias: string },
  log: (msg: string) => void = () => {}
): Promise<AliasLookup> {
  try {
    const { data, error } = await client
      .from(ALIAS_TABLE)
      .select("id, alias, phone, status, conflicting_phones, conversation_id, deal_id, review_reason")
      .eq("channel_id", input.channelId)
      .eq("alias", input.alias)
      .maybeSingle();

    if (error) {
      log(`[GPTMaker] alias — falha ao ler "${input.alias}": ${error.message ?? "sem detalhe"}`);
      return { phone: null, status: null, row: null };
    }

    if (!data) return { phone: null, status: null, row: null };

    const resolvido = data.status === "resolved" && !!data.phone;
    return { phone: resolvido ? data.phone : null, status: data.status, row: data };
  } catch (e) {
    log(`[GPTMaker] alias — erro inesperado ao ler: ${e instanceof Error ? e.message : String(e)}`);
    return { phone: null, status: null, row: null };
  }
}

// =============================================================================
// ESCRITA — AC1
// =============================================================================

export type RegistrarAliasOutcome =
  /** Par novo gravado. */
  | { acao: "criado"; phone: string; row: AliasRow | null }
  /** Já existia com o MESMO telefone — só o `last_seen_at` foi tocado. */
  | { acao: "confirmado"; phone: string; row: AliasRow | null }
  /** Linha existia sem telefone (fila de revisão) e agora resolveu (AC4, item 4). */
  | { acao: "promovido"; phone: string; row: AliasRow | null }
  /** O lid apontou para um segundo telefone. NÃO sobrescreve; marca ambíguo. */
  | { acao: "ambiguo"; phone: null; row: AliasRow | null }
  /** Já estava ambíguo — continua sem reconciliar. */
  | { acao: "segue-ambiguo"; phone: null; row: AliasRow | null }
  /** Falha de banco. O chamador segue o fluxo de hoje. */
  | { acao: "erro"; phone: null; row: null };

/**
 * Grava (ou confirma) o par `lid → telefone`.
 *
 * Idempotente: o mesmo par visto 50 vezes continua sendo **uma** linha — a
 * garantia nasce do índice único `(channel_id, alias)`, não de um `if` daqui.
 *
 * ⚠️ **Conflito não sobrescreve.** Quando o mesmo lid aparece com um telefone
 * diferente do já gravado, o telefone antigo **fica**, o status vira
 * `ambiguous` e os dois números vão para `conflicting_phones`. A partir daí o
 * alias não reconcilia mais nada. Sobrescrever apagaria justamente a evidência
 * de que o vínculo é duvidoso. *(Medido em 23/09: 0 conflitos em 95 lids — o
 * caminho existe para o dia em que aparecer.)*
 */
export async function registrarAlias(
  client: AliasMapClient,
  input: {
    organizationId: string;
    channelId: string;
    alias: string;
    /** Telefone JÁ normalizado e JÁ validado pelo chamador. */
    phone: string;
  },
  log: (msg: string) => void = () => {},
  /** Guarda contra laço: a corrida só é reprocessada UMA vez. */
  _tentativa = 0
): Promise<RegistrarAliasOutcome> {
  try {
    const existente = await resolverAlias(client, input, log);
    const row = existente.row;

    // ------------------------------------------------------------------
    // Não existe: cria.
    // ------------------------------------------------------------------
    if (!row) {
      const agora = new Date().toISOString();
      const { data, error } = await client
        .from(ALIAS_TABLE)
        .insert({
          organization_id: input.organizationId,
          channel_id: input.channelId,
          alias: input.alias,
          phone: input.phone,
          status: "resolved",
          resolved_at: agora,
          last_seen_at: agora,
        })
        .select("id, alias, phone, status, conflicting_phones, conversation_id, deal_id, review_reason")
        .single();

      if (error) {
        // Corrida com outra entrega do mesmo evento (medida em 137 ms na story
        // 2.6): o índice único derruba a perdedora. Relê e trata como confirmação.
        const duplicado =
          error.code === "23505" || (error.message ?? "").toLowerCase().includes("duplicate");
        if (duplicado) {
          const relido = await resolverAlias(client, input, log);
          log(`[GPTMaker] alias "${input.alias}" criado em paralelo — reusando`);
          if (relido.row?.phone === input.phone) {
            return { acao: "confirmado", phone: input.phone, row: relido.row };
          }
          // A linha nasceu com OUTRO telefone (ou sem telefone): reprocessa uma
          // única vez, agora pelo caminho de conflito/promoção.
          if (relido.row && _tentativa < 1) {
            return await registrarAlias(client, input, log, _tentativa + 1);
          }
          return { acao: "erro", phone: null, row: null };
        }
        log(`[GPTMaker] alias — falha ao criar "${input.alias}": ${error.message ?? "sem detalhe"}`);
        return { acao: "erro", phone: null, row: null };
      }

      log(`[GPTMaker] alias "${input.alias}" → ${input.phone} (novo)`);
      return { acao: "criado", phone: input.phone, row: data };
    }

    // ------------------------------------------------------------------
    // Já ambíguo: não toca no telefone, nunca reconcilia.
    // ------------------------------------------------------------------
    if (row.status === "ambiguous") {
      await tocar(client, input, { last_seen_at: new Date().toISOString() }, log);
      return { acao: "segue-ambiguo", phone: null, row };
    }

    // ------------------------------------------------------------------
    // Mesmo telefone: idempotente.
    // ------------------------------------------------------------------
    if (row.phone === input.phone) {
      await tocar(client, input, { last_seen_at: new Date().toISOString() }, log);
      return { acao: "confirmado", phone: input.phone, row };
    }

    // ------------------------------------------------------------------
    // Estava sem telefone (fila de revisão) e agora resolveu — AC4, item 4:
    // a marcação SAI quando o alias passa a resolver.
    // ------------------------------------------------------------------
    if (!row.phone) {
      const agora = new Date().toISOString();
      const ok = await tocar(
        client,
        input,
        {
          phone: input.phone,
          status: "resolved",
          resolved_at: agora,
          last_seen_at: agora,
          review_reason: null,
        },
        log
      );
      if (!ok) return { acao: "erro", phone: null, row: null };
      log(`[GPTMaker] alias "${input.alias}" saiu da revisão → ${input.phone}`);
      return { acao: "promovido", phone: input.phone, row };
    }

    // ------------------------------------------------------------------
    // Telefone DIFERENTE do gravado: conflito. Não sobrescreve.
    // ------------------------------------------------------------------
    const conflitos = Array.from(
      new Set([...(row.conflicting_phones ?? []), row.phone, input.phone].filter(Boolean) as string[])
    );
    await tocar(
      client,
      input,
      {
        status: "ambiguous",
        conflicting_phones: conflitos,
        review_reason: MOTIVO_AMBIGUO,
        resolved_at: null,
        last_seen_at: new Date().toISOString(),
      },
      log
    );
    log(
      `[GPTMaker] ⚠️ alias "${input.alias}" AMBÍGUO — apontou para ${conflitos.join(
        " e "
      )}; não será usado para reconciliar`
    );
    return { acao: "ambiguo", phone: null, row };
  } catch (e) {
    log(`[GPTMaker] alias — erro inesperado ao gravar: ${e instanceof Error ? e.message : String(e)}`);
    return { acao: "erro", phone: null, row: null };
  }
}

async function tocar(
  client: AliasMapClient,
  input: { channelId: string; alias: string },
  patch: Record<string, unknown>,
  log: (msg: string) => void
): Promise<boolean> {
  const { error } = await client
    .from(ALIAS_TABLE)
    .update(patch)
    .eq("channel_id", input.channelId)
    .eq("alias", input.alias)
    .select("id");

  if (error) {
    log(`[GPTMaker] alias — falha ao atualizar "${input.alias}": ${error.message ?? "sem detalhe"}`);
    return false;
  }
  return true;
}

// =============================================================================
// FILA DE REVISÃO — AC4 (D2 = B: cria o card, mas MARCADO)
// =============================================================================

/**
 * Marca a identidade como **não confirmada** — dado gravado, não rótulo de tela.
 *
 * D2 = B, decidida pelo Filipe: quando a máquina não resolve o lid, a conversa
 * é gravada e o card **é criado** como hoje; o que muda é que ele deixa de ser
 * silencioso. "Nada pode ficar invisível para quem atende."
 *
 * Grava o que a revisão da 2.57 vai precisar: o lid, o motivo, a conversa e o
 * card. **Não** dispara merge, **não** apaga, **não** move card. Nada acontece
 * sozinho (AC4, item 5).
 *
 * Nunca lança: falhar a marcação não pode derrubar o webhook nem impedir a
 * mensagem de ser gravada.
 */
export async function marcarIdentidadeNaoConfirmada(
  client: AliasMapClient,
  input: {
    organizationId: string;
    channelId: string;
    alias: string;
    motivo: string;
    conversationId: string | null;
    dealId: string | null;
  },
  log: (msg: string) => void = () => {}
): Promise<{ marcado: boolean }> {
  try {
    const existente = await resolverAlias(client, input, log);
    const agora = new Date().toISOString();

    // AC4, item 4 — se já resolve, não há o que marcar. A marcação some quando
    // o alias passa a resolver; ela não pode voltar por um evento posterior.
    if (existente.row?.status === "resolved") {
      return { marcado: false };
    }

    // Ids só ENTRAM, nunca são apagados: um evento seguinte sem conversa/card
    // não pode esvaziar o que a revisão já tinha para olhar.
    const patch: Record<string, unknown> = {
      last_seen_at: agora,
      review_reason: input.motivo,
    };
    if (input.conversationId && !existente.row?.conversation_id) {
      patch.conversation_id = input.conversationId;
    }
    if (input.dealId && !existente.row?.deal_id) {
      patch.deal_id = input.dealId;
    }

    if (!existente.row) {
      const { error } = await client
        .from(ALIAS_TABLE)
        .insert({
          organization_id: input.organizationId,
          channel_id: input.channelId,
          alias: input.alias,
          phone: null,
          status: "unresolved",
          review_reason: input.motivo,
          conversation_id: input.conversationId,
          deal_id: input.dealId,
          last_seen_at: agora,
        })
        .select("id, alias, phone, status, conflicting_phones, conversation_id, deal_id, review_reason")
        .single();

      if (error) {
        const duplicado =
          error.code === "23505" || (error.message ?? "").toLowerCase().includes("duplicate");
        if (!duplicado) {
          log(
            `[GPTMaker] revisão — falha ao marcar "${input.alias}": ${error.message ?? "sem detalhe"}`
          );
          return { marcado: false };
        }
        // Corrida: a linha já existe. Cai no update abaixo.
      } else {
        log(`[GPTMaker] 🔖 identidade não confirmada: lid "${input.alias}" (${input.motivo})`);
        return { marcado: true };
      }
    }

    // Alias ambíguo mantém o motivo dele — é mais específico que "sem telefone".
    if (existente.row?.status === "ambiguous") {
      patch.review_reason = MOTIVO_AMBIGUO;
    }

    const ok = await tocar(client, input, patch, log);
    if (ok) {
      log(`[GPTMaker] 🔖 identidade não confirmada: lid "${input.alias}" (${patch.review_reason})`);
    }
    return { marcado: ok };
  } catch (e) {
    log(
      `[GPTMaker] revisão — erro inesperado ao marcar: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
    return { marcado: false };
  }
}
