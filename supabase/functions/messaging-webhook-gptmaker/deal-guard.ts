/**
 * A guarda que impede o segundo card — story 2.56, AC3 (D4).
 *
 * ## O defeito
 *
 * `autoCreateDeal` insere um card **sem perguntar se já existe um**. Junto com o
 * `@lid` (que faz o mesmo lead virar contato novo), é o que produz os "cards
 * espelho": 43 medidos no banco entre 24/07 e 23/09, um deles com só as
 * perguntas do cliente e outro com só as respostas da atendente.
 *
 * ## A regra (D4, decidida pelo Filipe em 23/09)
 *
 * Não nasce card se o contato já tem card **aberto** no mesmo quadro. Aberto é:
 *
 *   • mesmo `board_id`;
 *   • `deleted_at IS NULL`;
 *   • estágio **não terminal**.
 *
 * ⚠️ **Estágio terminal NÃO conta como card aberto.** Se o único card da pessoa
 * está em Ganho, Perdido ou Clientes, a conversa nova **gera card novo**. Lead
 * que volta é oportunidade nova — ressuscitar negócio fechado sujaria a
 * estatística de conversão.
 *
 * **Risco aceito, escrito com todas as letras:** quem volta várias vezes ao
 * longo do tempo **acumula cards**. É consequência desejada da decisão, não
 * defeito a corrigir depois.
 *
 * ## 🔴 Por `id`, NUNCA por nome
 *
 * O estágio de proposta está gravado no banco como `" Proposta enviada"` — com
 * **espaço no começo**. Qualquer comparação por rótulo erra aqui, e erra calada.
 * As constantes abaixo guardam **uuid**, e o teste compara **uuid**.
 *
 * ## Por que uma lista em constante, e não uma coluna
 *
 * Decisão técnica do Orion (23/09): opção A — lista derivada do banco, com
 * **teste que quebra se o quadro mudar** (`deal-guard.test.ts`, item 8c do AC7).
 * A evolução recomendada (coluna `is_closing` em `board_stages`) ficou **fora da
 * 2.56**: exige migration + interface para marcar os estágios, e a decisão de
 * produto já está tomada — é refactor de mecanismo, não mudança de regra.
 *
 * ⚠️ **Nenhuma coluna existente serve como atalho.** Conferido em 25/09:
 * `arquiva_sem_reabrir` é `true` em Clientes, **Profissional e Projeto Social**,
 * e `conta_como_fila` é `false` nas mesmas cinco. Os dois conjuntos incluem
 * estágios que a D4 manda tratar como **abertos**. Usá-los faria a guarda
 * liberar card novo onde deveria reusar.
 *
 * @module supabase/functions/messaging-webhook-gptmaker/deal-guard
 */

export interface DbError {
  message?: string;
  code?: string;
}

/**
 * Quadro "Acreditando" — o único quadro em que a regra vale hoje.
 *
 * ⚠️ **Esta lista é de UM quadro.** Se o Acreditando criar outro board, a lista
 * terminal dele **precisa nascer junto** — senão a guarda trata todo estágio do
 * quadro novo como aberto (e nunca cria o segundo card, que é o lado seguro do
 * erro, mas ainda é erro).
 */
export const BOARD_ACREDITANDO = "5f6bded2-0f7c-418d-9598-7ea75d032242";

/**
 * As 13 colunas do quadro, lidas do banco em 25/09/2026 via
 * `node scripts/db/sql-ro.mjs`. Existe para o teste 8c do AC7: se um estágio
 * aparecer, sumir ou for renomeado, o teste quebra — a constante não pode
 * envelhecer calada.
 *
 * 📌 O nome está aqui **para o teste conferir**, nunca para a regra comparar.
 */
export const ESTAGIOS_CONHECIDOS_ACREDITANDO: ReadonlyArray<{
  id: string;
  name: string;
  order: number;
}> = [
  { id: "82d1a222-eeff-4627-baed-881908dbd702", name: "Lead novo", order: 0 },
  { id: "82a1cd0b-bd3d-48ba-af46-c9c7d70e77a9", name: "Contato Realizado", order: 1 },
  { id: "3b1384fa-5fe2-4725-a8e1-7576a8690637", name: "Qualificado", order: 2 },
  { id: "c97424a3-9107-419e-82dc-e6431cafbee3", name: "Apresentação enviada", order: 3 },
  { id: "fef376be-5c81-48de-bccd-95264abd28e6", name: "Aguardando retorno", order: 4 },
  { id: "c8f1ea2e-2607-4df8-ad3d-a25eb201de80", name: "Avaliação agendada", order: 5 },
  { id: "d0ceffc3-bd49-4921-bb4a-77a187ddc562", name: "Avaliação realizada", order: 6 },
  // 🔻 Espaço no começo — é assim que está gravado. Não "consertar".
  { id: "9f1b2a7a-e6b1-4e04-b041-87581fc6a8a9", name: " Proposta enviada", order: 7 },
  { id: "f359ee98-b7b1-460d-a7be-2ef92f92c4c7", name: "Ganho", order: 8 },
  { id: "78defbd3-6ca4-4b96-b67a-2268e7e6dce5", name: "Perdido", order: 9 },
  { id: "3ed212e5-32a9-4bda-8d70-bb8be49e790d", name: "Clientes", order: 10 },
  { id: "2da4a3f4-4333-4c79-a990-491e789d5096", name: "Profissional", order: 11 },
  { id: "1b829bbd-b7de-42bd-beb2-6e0baaeb4d04", name: "Projeto Social", order: 12 },
];

/** Ganho · Perdido · Clientes — D4. Card nesses estágios NÃO conta como aberto. */
export const ESTAGIOS_TERMINAIS_ACREDITANDO: ReadonlyArray<string> = [
  "f359ee98-b7b1-460d-a7be-2ef92f92c4c7", // Ganho
  "78defbd3-6ca4-4b96-b67a-2268e7e6dce5", // Perdido
  "3ed212e5-32a9-4bda-8d70-bb8be49e790d", // Clientes
];

/** Lista terminal por quadro. Quadro desconhecido ⇒ lista vazia (ver abaixo). */
const TERMINAIS_POR_QUADRO: Record<string, ReadonlyArray<string>> = {
  [BOARD_ACREDITANDO]: ESTAGIOS_TERMINAIS_ACREDITANDO,
};

/**
 * Estágios terminais do quadro.
 *
 * Quadro sem lista cadastrada devolve **vazio** — ou seja, todo estágio conta
 * como aberto e a guarda **não cria** o segundo card. Escolha deliberada: o erro
 * seguro desta story é reusar card demais (a atendente vê a conversa inteira num
 * lugar só), não espalhar cards que ninguém sabe que existem.
 */
export function estagiosTerminaisDoQuadro(boardId: string): ReadonlyArray<string> {
  return TERMINAIS_POR_QUADRO[boardId] ?? [];
}

// =============================================================================
// A GUARDA
// =============================================================================

export interface DealRow {
  id: string;
  stage_id: string | null;
}

export interface DealGuardQuery {
  eq(col: string, val: unknown): DealGuardQuery;
  is(col: string, val: null): DealGuardQuery;
  order(col: string, opts: { ascending: boolean }): DealGuardQuery;
  limit(n: number): Promise<{ data: DealRow[] | null; error: DbError | null }>;
}

export interface DealGuardClient {
  from(table: string): { select(cols: string): DealGuardQuery };
}

export type CardAbertoOutcome =
  /** Existe card aberto — o chamador NÃO deve criar outro. */
  | { temCardAberto: true; dealId: string; stageId: string | null }
  /**
   * Não existe card aberto — o chamador cria, como hoje.
   * `motivo` diz por quê, para o log não virar adivinhação.
   */
  | {
      temCardAberto: false;
      motivo: "sem-card" | "so-terminais" | "erro";
      terminaisIgnorados?: number;
    };

/** Quantos cards do contato trazer. Bem acima do observado; corta patologia. */
const MAX_CARDS = 50;

/**
 * Procura card aberto do contato no mesmo quadro.
 *
 * ⚠️ **Nunca lança.** Erro de leitura devolve `temCardAberto: false` — ou seja,
 * o comportamento de hoje (cria o card). Um banco indisponível não pode fazer a
 * conversa sumir do board; card a mais é aborrecimento, conversa invisível não.
 *
 * ⚠️ `deleted_at IS NULL` vai **na query**, não depois: card excluído contado
 * como aberto bloquearia a criação de um card legítimo (regra do CLAUDE.md,
 * lição da story 2.25).
 */
export async function encontrarCardAberto(
  client: DealGuardClient,
  input: { organizationId: string; contactId: string; boardId: string },
  log: (msg: string) => void = () => {}
): Promise<CardAbertoOutcome> {
  try {
    const { data, error } = await client
      .from("deals")
      .select("id, stage_id")
      .eq("organization_id", input.organizationId)
      .eq("contact_id", input.contactId)
      .eq("board_id", input.boardId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(MAX_CARDS);

    if (error) {
      log(
        `[GPTMaker] guarda de card — falha ao ler deals do contato ${input.contactId}: ${
          error.message ?? "sem detalhe"
        } — seguindo com a criação`
      );
      return { temCardAberto: false, motivo: "erro" };
    }

    const cards = data ?? [];
    if (cards.length === 0) return { temCardAberto: false, motivo: "sem-card" };

    const terminais = estagiosTerminaisDoQuadro(input.boardId);
    // Comparação por **id**. Nome nunca entra aqui — ver cabeçalho do arquivo.
    const aberto = cards.find((d) => !d.stage_id || !terminais.includes(d.stage_id));

    if (aberto) {
      return { temCardAberto: true, dealId: aberto.id, stageId: aberto.stage_id };
    }

    // Todos os cards do contato estão em estágio terminal ⇒ D4: cria card novo.
    return { temCardAberto: false, motivo: "so-terminais", terminaisIgnorados: cards.length };
  } catch (e) {
    log(
      `[GPTMaker] guarda de card — erro inesperado: ${
        e instanceof Error ? e.message : String(e)
      } — seguindo com a criação`
    );
    return { temCardAberto: false, motivo: "erro" };
  }
}
