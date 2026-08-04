/**
 * Resolução do contato de um evento de webhook — story 2.6.
 *
 * ## Por que isto saiu de dentro do `index.ts`
 *
 * O GPT Maker dispara `onNewMessage` e `onFirstInteraction` quase juntos para um
 * contato novo (observado: 137 ms em 24/07, 223 ms em 03/08). As duas entregas
 * chegam concorrentes, nenhuma acha o contato pelo telefone, e **as duas inserem**.
 *
 * O `index.ts` já tinha o remendo para isso — só que **inalcançável**: ele depende
 * de `23505 unique_violation`, e `contacts` não tem nenhuma constraint de unicidade
 * além da PK. Sem constraint, o insert concorrente **não falha**. Ninguém perde a
 * corrida, ninguém relê, nascem dois contatos e nada acusa erro.
 *
 * Medido em produção em 2026-08-04: **138 pares duplicados**, todos com menos de
 * 0,5 s entre as criações.
 *
 * A serialização real vive no banco (`find_or_create_contact`, migration
 * `20260804120000`), sob `pg_advisory_xact_lock(org, phone)`. Este módulo existe
 * para que a **decisão de qual caminho tomar** — e o comportamento quando o banco
 * falha — sejam testáveis sem subir a função inteira.
 */

/** Cliente mínimo de que precisamos — mantém o módulo testável sem o SDK inteiro. */
export interface ContactResolverClient {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
  from(table: string): {
    insert(values: Record<string, unknown>): {
      select(cols: string): {
        single(): Promise<{
          data: { id: string } | null;
          error: { message?: string; code?: string } | null;
        }>;
      };
    };
  };
}

export interface ResolveContactInput {
  organizationId: string;
  /** Telefone do contato. Sem ele não há chave por onde serializar. */
  phone: string | null | undefined;
  name: string;
  source?: string;
}

export type ResolveContactOutcome =
  /** Caminho normal: o banco serializou e devolveu o contato (novo ou reusado). */
  | { contactId: string; via: "rpc" }
  /** A RPC falhou; caímos no insert direto para não perder o lead. */
  | { contactId: string; via: "fallback" }
  /** Nem a RPC nem o fallback deram contato. A mensagem ainda é gravada sem ele. */
  | { contactId: null; via: "none" };

/**
 * Resolve (ou cria) o contato do evento.
 *
 * ⚠️ **Nunca lança.** A regra que vale desde `5e53bdd` é que **perder o contato é
 * aceitável, perder a mensagem não**. Se tudo falhar, devolve `contactId: null` e
 * o chamador grava a conversa e a mensagem assim mesmo.
 */
export async function resolveContactId(
  client: ContactResolverClient,
  input: ResolveContactInput,
  log: (msg: string) => void = () => {}
): Promise<ResolveContactOutcome> {
  const phone = input.phone && input.phone !== "" ? input.phone : null;
  const source = input.source ?? "whatsapp";

  const { data, error } = await client.rpc("find_or_create_contact", {
    p_organization_id: input.organizationId,
    p_phone: phone,
    p_name: input.name,
    p_source: source,
  });

  if (!error && typeof data === "string" && data.length > 0) {
    return { contactId: data, via: "rpc" };
  }

  // A RPC é a única coisa que fecha a corrida. Se ela falhar (função ainda não
  // aplicada, permissão, indisponibilidade), o certo NÃO é abortar: é criar o
  // contato do jeito antigo e seguir. Pode nascer duplicata — que é exatamente o
  // estado de antes desta story, e é preferível a perder o lead.
  log(
    `[GPTMaker] find_or_create_contact indisponível (${
      error?.message ?? "resposta vazia"
    }${error?.code ? ` [${error.code}]` : ""}) — caindo no insert direto`
  );

  const { data: created, error: createErr } = await client
    .from("contacts")
    .insert({
      organization_id: input.organizationId,
      name: input.name,
      phone,
      source,
    })
    .select("id")
    .single();

  if (createErr || !created) {
    log(
      `[GPTMaker] Falha ao criar contato no fallback: ${
        createErr?.message ?? "sem detalhe"
      }`
    );
    return { contactId: null, via: "none" };
  }

  return { contactId: created.id, via: "fallback" };
}
