/**
 * Story 2.31 — quem manda: a intenção da URL ou o estado da tela?
 *
 * O botão "Mensagem" do card navega para `/messaging?contactId=<id>`. Chegar por
 * parâmetro de URL é a **intenção mais explícita que existe**: alguém clicou
 * pedindo ESTE contato.
 *
 * 🪤 A guarda anterior era `if (!contactIdParam || selectedConversationId) return`.
 * O segundo termo é **estado de UI**: se já havia uma conversa aberta na tela, o
 * efeito desistia antes de tentar resolver o contato novo. Resultado relatado
 * (com vídeo): o clique levava sempre para a conversa errada — e sempre a mesma,
 * porque o estado nunca mudava.
 *
 * 🪞 É a MESMA CLASSE do modal que reabria sozinho (story 2.27): *consumo de
 * parâmetro de URL decidido por estado de UI*. Lá a guarda era
 * `dealIdFromUrl && !selectedDealId`. Aquela foi corrigida num arquivo e a
 * classe não foi varrida — e foi exatamente isso que deixou este defeito de pé.
 *
 * 🔑 A regra: idempotência de consumo é lembrada por uma **ref que guarda QUAL
 * valor já foi consumido** — nunca por estado que a tela pode reverter.
 */

export interface EntradaDaDecisao {
  /** `?contactId=` da URL. */
  contactIdParam: string | null;
  /** Qual contactId esta montagem já resolveu (a ref). */
  contatoJaResolvido: string | null;
  /** A busca das conversas do contato ainda está em voo. */
  carregando: boolean;
  /** A lista de conversas do contato já chegou (pode estar vazia). */
  temResposta: boolean;
}

/**
 * Decide se o efeito deve resolver o `?contactId=` desta vez.
 *
 * ⚠️ Repare no que NÃO entra aqui: nada sobre a conversa atualmente selecionada.
 * Se entrar de novo, o defeito volta.
 */
export function deveResolverContatoDaUrl({
  contactIdParam,
  contatoJaResolvido,
  carregando,
  temResposta,
}: EntradaDaDecisao): boolean {
  if (!contactIdParam) return false;
  if (carregando || !temResposta) return false;
  // Já consumido nesta montagem: não repete. Guardar o VALOR (e não um booleano)
  // mantém funcionando o caso legítimo de chegar um `contactId` diferente.
  if (contatoJaResolvido === contactIdParam) return false;
  return true;
}
