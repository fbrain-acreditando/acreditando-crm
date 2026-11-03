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

// =============================================================================
// NOME DO CONTATO — story 2.56, AC8
// =============================================================================

/**
 * O nome com que o contato é GRAVADO.
 *
 * O parser já reprova identificador do WhatsApp (`sanitizeContactName`), então
 * o que chega aqui é nome de verdade ou `null`. Sem nome, sobra o telefone — que
 * é dado real. **Sem nome e sem telefone (o caso do lid puro), fica VAZIO.**
 *
 * ⚠️ Vazio é `""`, não `null`: `contacts.name` é `NOT NULL` no banco. Relaxar a
 * coluna é migration com efeito em todo o CRM e não cabe nesta story — `""` é o
 * "vazio" que o AC8 pede, e a tela já trata contato sem nome.
 *
 * O texto de apresentação ("Contato sem nome", "Contato do WhatsApp") é da TELA,
 * nunca do dado: gravado no banco ele vira um nome que ninguém consegue
 * distinguir de um nome real, e some da fila de quem precisa ser identificado.
 */
export function nomeParaContato(
  contactName: string | null | undefined,
  contactPhone: string | null | undefined
): string {
  const nome = (contactName ?? "").trim();
  if (nome) return nome;
  const phone = (contactPhone ?? "").trim();
  if (phone) return phone;
  return "";
}

export interface ContactNameClient {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: unknown): {
        maybeSingle(): Promise<{
          data: { id: string; name: string | null } | null;
          error: { message?: string; code?: string } | null;
        }>;
      };
    };
    update(values: Record<string, unknown>): {
      eq(col: string, val: unknown): {
        select(cols: string): Promise<{
          data: Array<{ id: string }> | null;
          error: { message?: string; code?: string } | null;
        }>;
      };
    };
  };
}

/**
 * Preenche o nome do contato quando ele está VAZIO e chega um nome de verdade
 * (AC8, terceiro item).
 *
 * ⚠️ **Só preenche vazio.** Nome já gravado — inclusive os contatos que hoje se
 * chamam `…@lid` — **não é tocado**: D3 = não mexer no passado. Um webhook que
 * reescreve nome de contato também sobrescreveria correção feita à mão pela
 * atendente, que é pior que o defeito.
 *
 * Nunca lança: nome é enfeite perto da mensagem.
 */
export async function preencherNomeVazio(
  client: ContactNameClient,
  input: { contactId: string; nome: string | null },
  log: (msg: string) => void = () => {}
): Promise<{ preenchido: boolean }> {
  const nome = (input.nome ?? "").trim();
  if (!nome) return { preenchido: false };

  try {
    const { data, error } = await client
      .from("contacts")
      .select("id, name")
      .eq("id", input.contactId)
      .maybeSingle();

    if (error || !data) return { preenchido: false };
    if ((data.name ?? "").trim() !== "") return { preenchido: false };

    const { data: updated, error: updErr } = await client
      .from("contacts")
      .update({ name: nome })
      .eq("id", input.contactId)
      .select("id");

    if (updErr) {
      log(`[GPTMaker] Falha ao preencher nome do contato: ${updErr.message ?? "sem detalhe"}`);
      return { preenchido: false };
    }

    // Rule 7 dentro do código: PostgREST devolve sucesso com ZERO linhas.
    const ok = !!updated && updated.length > 0;
    if (ok) log(`[GPTMaker] Nome preenchido no contato ${input.contactId}: "${nome}"`);
    return { preenchido: ok };
  } catch (e) {
    log(`[GPTMaker] Erro inesperado ao preencher nome: ${e instanceof Error ? e.message : String(e)}`);
    return { preenchido: false };
  }
}

export interface ResolveContactInput {
  organizationId: string;
  /** Telefone do contato. Sem ele não há chave por onde serializar. */
  phone: string | null | undefined;
  name: string;
  source?: string;
}

/**
 * Story 2.63, AC4 — a função NOVA, que procura o telefone exato e, se não achar,
 * a outra forma do número (com/sem o 9º dígito), sob trava pela forma canônica.
 * A antiga (`find_or_create_contact`) fica intacta: é o que a v15 usa no rollback.
 */
export const RPC_CONTATO_POR_VARIANTES = "find_or_create_contact_por_variantes";
export const RPC_CONTATO_EXATO = "find_or_create_contact";

/** Como o banco casou o contato (só a função nova informa). */
export type CasouPor = "exato" | "variante" | "criado";

/** Lê a resposta da função nova (TABLE ⇒ array de 1 linha; aceita objeto também). */
function lerRespostaPorVariantes(
  data: unknown
): { contactId: string; casouPor: CasouPor | null; telefoneCasado: string | null } | null {
  const linha = Array.isArray(data) ? data[0] : data;
  if (!linha || typeof linha !== "object") return null;
  const r = linha as Record<string, unknown>;
  if (typeof r.contact_id !== "string" || !r.contact_id) return null;
  const casou = r.casou_por;
  return {
    contactId: r.contact_id,
    casouPor: casou === "exato" || casou === "variante" || casou === "criado" ? casou : null,
    telefoneCasado: typeof r.telefone_casado === "string" ? r.telefone_casado : null,
  };
}

/** Telefone mascarado para log (mesma regra de `nono-digito.ts`, sem importar). */
function mascarar(phone: string | null): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length <= 8) return "*".repeat(d.length);
  return `${d.slice(0, 4)}${"*".repeat(d.length - 8)}${d.slice(-4)}`;
}

export type ResolveContactOutcome =
  /**
   * Caminho normal: o banco serializou e devolveu o contato (novo ou reusado).
   * `casouPor` só vem quando a função nova (2.63) respondeu.
   */
  | { contactId: string; via: "rpc"; casouPor?: CasouPor }
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

  const args = {
    p_organization_id: input.organizationId,
    p_phone: phone,
    p_name: input.name,
    p_source: source,
  };

  // Story 2.63 — primeiro a função que reconhece o 9º dígito.
  const nova = await client.rpc(RPC_CONTATO_POR_VARIANTES, args);
  if (!nova.error) {
    const lida = lerRespostaPorVariantes(nova.data);
    if (lida) {
      if (lida.casouPor === "variante") {
        log(
          `[GPTMaker] 9º dígito — contato achado pela variante ${mascarar(lida.telefoneCasado)} (evento com ${mascarar(phone)})`
        );
      }
      return lida.casouPor
        ? { contactId: lida.contactId, via: "rpc", casouPor: lida.casouPor }
        : { contactId: lida.contactId, via: "rpc" };
    }
  }

  // A função nova não respondeu (ainda não aplicada, permissão, resposta vazia).
  // Cai na ANTIGA — busca exata, mesma trava — antes do insert direto: duplicar
  // pelo 9º dígito é o comportamento de antes desta story, não uma regressão.
  log(
    `[GPTMaker] ${RPC_CONTATO_POR_VARIANTES} indisponível (${
      nova.error?.message ?? "resposta vazia"
    }${nova.error?.code ? ` [${nova.error.code}]` : ""}) — usando ${RPC_CONTATO_EXATO}`
  );

  const { data, error } = await client.rpc(RPC_CONTATO_EXATO, args);

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
