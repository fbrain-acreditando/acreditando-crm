/**
 * Contabilização de tokens da IA — story 2.9.
 *
 * ## Por que isto existe
 *
 * A tabela `ai_conversation_log` ficou **vazia desde sempre**. Três pontos de
 * inserção — os três de contabilidade de token, acrescentados depois e copiados
 * um do outro — omitiam `context_snapshot`, que é `jsonb NOT NULL` sem default:
 *
 * ```
 * ERROR: 23502: null value in column "context_snapshot" of relation
 *        "ai_conversation_log" violates not-null constraint
 * ```
 *
 * O `briefing` omitia **duas**: também faltava `conversation_id`.
 *
 * Nenhum deles quebrou nada visível porque o insert é fire-and-forget e a falha
 * só virava `console.error` — que ninguém lê numa função de produção. O caminho
 * de erro funcionava; **faltava alguém escutando**.
 *
 * Este módulo existe para que **não haja um quarto copy-paste**: quem quiser
 * contabilizar token chama daqui, e as colunas obrigatórias são exigidas pelo
 * tipo, não pela memória de quem escreve.
 *
 * ## ⚖️ Por que `context_snapshot` vai vazio
 *
 * A coluna nasceu para o agente de atendimento guardar o contexto da decisão.
 * Nos pontos de extração, o "contexto" seria **trecho de conversa** — e neste
 * canal conversa é **dado de saúde (LGPD Art. 11)**. Gravá-lo aqui transformaria
 * um conserto de contabilidade em **ampliação de tratamento**, numa tabela que
 * hoje não guarda dado nenhum, com o gate de base legal aberto desde 21/07.
 *
 * Enquanto esse gate não fechar, o valor é `{}` — explícito, nunca `null`.
 */

/**
 * ## ⚠️ Story 2.10 — a parede seguinte
 *
 * O conserto acima subiu em 04/08 e **não gravou uma linha**. `action_taken` tem
 * um domínio fechado no banco que ninguém tinha olhado:
 *
 * ```
 * CHECK (action_taken = ANY (ARRAY['responded','advanced_stage','handoff',
 *                                  'skipped','stage_evaluation']))
 * ```
 *
 * O valor gravado (`custom_fields_extraction`) está fora da lista ⇒ **23514
 * check_violation**, pelo mesmo caminho mudo. A blindagem de 2.9 exigiu as
 * colunas `NOT NULL` pelo tipo e deixou solto justamente o único campo com
 * domínio fechado — cobriu o defeito, não a classe dele.
 *
 * Por isso `actionTaken` **não é mais `string`**: é a união abaixo, espelho da
 * constraint. Rótulo novo agora quebra a compilação, não a produção.
 */

/**
 * Domínio de `ai_conversation_log.action_taken`, espelhando a constraint
 * `ai_conversation_log_action_taken_check` (migration `20260805*`).
 *
 * 🔗 **Contrato com o banco.** Acrescentar item aqui **exige** migration
 * ampliando o CHECK, senão o insert volta a falhar em silêncio.
 */
export const AI_LOG_ACTIONS = [
  // Decisões do agente de atendimento (domínio original, = `AIAction`)
  'responded',
  'advanced_stage',
  'handoff',
  'skipped',
  'stage_evaluation',
  // Contabilidade das chamadas de modelo (acrescentados na 2.10).
  // Só entram rótulos de pontos que mandam `conversation_id` — os demais
  // falhariam em `23502` antes do CHECK, e autorizá-los descreveria no schema
  // um insert que não acontece. Ver `logAIAction` em `app/api/ai/actions/route.ts`.
  'custom_fields_extraction',
  'bant_extraction',
  'briefing',
] as const;

export type AiLogAction = (typeof AI_LOG_ACTIONS)[number];

/** Cliente mínimo — mantém o módulo testável sem o SDK inteiro. */
export interface TokenLogClient {
  from(table: string): {
    insert(values: Record<string, unknown>): Promise<{
      error: { message?: string; code?: string } | null;
    }>;
  };
}

export interface TokenLogInput {
  organizationId: string;
  /** Obrigatório na tabela (`NOT NULL`). Sem ele não há o que gravar. */
  conversationId: string | null | undefined;
  tokensUsed: number;
  modelUsed: string;
  /**
   * Rótulo do que consumiu os tokens, ex.: `custom_fields_extraction`.
   *
   * ⚠️ União fechada de propósito (story 2.10): o banco tem CHECK neste campo.
   * Era `string`, e foi por aí que `custom_fields_extraction` chegou à produção
   * e falhou em silêncio por um dia inteiro.
   */
  actionTaken: AiLogAction;
  actionReason: string;
}

export type TokenLogOutcome =
  | { logged: true }
  /** Não havia o que gravar (0 tokens) ou faltava a conversa. */
  | { logged: false; reason: 'sem_tokens' | 'sem_conversa' }
  | { logged: false; reason: 'erro'; detail: string };

/**
 * Grava o consumo de tokens de uma chamada de modelo.
 *
 * ⚠️ **Nunca lança.** Uma extração que funcionou não pode virar erro porque a
 * contabilidade falhou — mas o resultado é **devolvido**, em vez de sumir num
 * `.then()` fire-and-forget. Quem chama decide o que fazer com a falha; o que não
 * pode voltar a acontecer é ninguém ficar sabendo.
 */
export async function logAiTokens(
  client: TokenLogClient,
  input: TokenLogInput,
  onFailure: (msg: string) => void = () => {}
): Promise<TokenLogOutcome> {
  if (!input.tokensUsed || input.tokensUsed <= 0) {
    return { logged: false, reason: 'sem_tokens' };
  }

  // `conversation_id` é NOT NULL. Sem conversa, gravar é impossível — e é melhor
  // dizer isso alto do que tentar e falhar em silêncio, que foi o defeito original.
  if (!input.conversationId) {
    onFailure(
      `[TokenLog] ${input.actionTaken}: ${input.tokensUsed} tokens NÃO contabilizados — ` +
        `a operação não tem conversa associada e ai_conversation_log.conversation_id é NOT NULL.`
    );
    return { logged: false, reason: 'sem_conversa' };
  }

  // ⚠️ O try/catch NÃO é decorativo. Quem chama usa `void logAiTokens(...)`, então
  // uma promessa rejeitada aqui vira **unhandled rejection** — e derruba, pelo
  // caminho mais indireto possível, a operação que já tinha dado certo. O AC4
  // desta story existe por isso: extração que funcionou não pode virar erro
  // porque a contabilidade falhou.
  let error: { message?: string; code?: string } | null = null;
  try {
    ({ error } = await client.from('ai_conversation_log').insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      tokens_used: input.tokensUsed,
      model_used: input.modelUsed,
      action_taken: input.actionTaken,
      action_reason: input.actionReason,
      // As duas colunas `NOT NULL` que os três pontos originais esqueciam.
      ai_response: '',
      context_snapshot: {},
    }));
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'exceção sem mensagem';
    onFailure(
      `[TokenLog] ${input.actionTaken}: exceção ao contabilizar ${input.tokensUsed} tokens — ${detail}`
    );
    return { logged: false, reason: 'erro', detail };
  }

  if (error) {
    onFailure(
      `[TokenLog] ${input.actionTaken}: falha ao contabilizar ${input.tokensUsed} tokens — ` +
        `${error.message ?? 'sem detalhe'}${error.code ? ` [${error.code}]` : ''}`
    );
    return { logged: false, reason: 'erro', detail: error.message ?? 'sem detalhe' };
  }

  return { logged: true };
}

/**
 * Colunas `NOT NULL` de `ai_conversation_log`, na ordem da migration
 * `20260206200000_create_stage_ai_config.sql:80`.
 *
 * Exportado para o teste conseguir reprovar um insert incompleto — é o que
 * garante que um quarto ponto de inserção não repita o defeito.
 */
export const AI_CONVERSATION_LOG_REQUIRED_COLUMNS = [
  'organization_id',
  'conversation_id',
  'context_snapshot',
  'ai_response',
] as const;
