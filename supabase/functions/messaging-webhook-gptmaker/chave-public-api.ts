/**
 * A chave `public-api-…` — story 2.73.
 *
 * ## O defeito
 *
 * Quando alguém grava uma mensagem na IA do WhatsApp **pela API pública** (o
 * `add-message` do disparo de remarketing, ou uma simulação de conversa), o
 * fornecedor avisa este webhook com uma chave de conversa diferente da real:
 *
 * ```
 * conversa real:   {channelId}-{telefone}
 * aviso da API:    public-api-{workspaceId}-{channelId}-{telefone}
 *                  public-api-{workspaceId}-{channelId}-{n}@lid
 * ```
 *
 * Ou seja: `public-api-{workspaceId}-` + a chave que foi passada à API.
 *
 * Sem reconhecer o prefixo, o webhook tratava a chave como um contato novo:
 * `recipientFromContextId` corta no primeiro hífen, o "telefone" vira
 * `api-…` (rejeitado), e nasciam **contato + conversa + card falsos** em
 * "Lead novo", com o título igual à própria chave. Medido em 10/11: 160 cards
 * (≈ 46% da coluna). Na variante `@lid`, ainda nascia um apelido `api-…@lid`
 * no mapa de apelidos (8 apagados na limpeza de 10/11).
 *
 * ## A decisão (opção A, Filipe em 10/11)
 *
 * Evento com chave `public-api-…` é **registrado e ignorado**: fica gravado em
 * `messaging_webhook_events` para auditoria e não cria nada — nem na conversa
 * real (a nota interna apareceria como mensagem enviada ao cliente).
 *
 * ## Medido no banco antes de escrever esta regra (T0, 10/11)
 *
 * - Formato de canal real (`public-api-{hex}-{hex}-{dígitos}` e a variante
 *   `@lid`): **só** `onNewMessage` com `role: "assistant"` (160) e
 *   `onFirstInteraction` (159). Nenhum `role: "user"`, nenhuma transferência.
 * - Os únicos `role: "user"` com esse prefixo (29) vêm de contextos de
 *   simulação (`TESTE-Orion-remkt-…`), não de clientes.
 *
 * Este módulo é puro (sem Deno, sem rede) e **nunca lança**.
 *
 * @module supabase/functions/messaging-webhook-gptmaker/chave-public-api
 */

/** O prefixo que a API pública do fornecedor põe na frente da chave. */
export const PREFIXO_PUBLIC_API = "public-api-";

/** O que dá para deduzir de uma chave `public-api-…` completa. */
export interface ChaveRealPublicApi {
  workspaceId: string;
  /** O id do canal. Na simulação, é o texto livre que foi passado à API. */
  channelId: string;
  /** Só dígitos, como veio na chave. */
  telefone: string;
  /** A chave da conversa real: `{channelId}-{telefone}`. */
  chaveReal: string;
}

/**
 * A chave é `public-api-…`? Sem diferenciar maiúsculas; aceita a variante
 * `@lid`. Qualquer coisa que não seja texto devolve `false`.
 */
export function ehChavePublicApi(chatId: unknown): boolean {
  if (typeof chatId !== "string") return false;
  return chatId.trim().toLowerCase().startsWith(PREFIXO_PUBLIC_API);
}

/**
 * Deduz a chave da conversa real a partir da chave `public-api-…`.
 *
 * Devolve `null` (nunca lança) quando:
 * - a chave não é `public-api-…`;
 * - há menos de 3 pedaços depois do prefixo (workspace, canal, telefone);
 * - o último pedaço não é só dígitos — inclusive a variante `@lid`, que não
 *   tem telefone para deduzir.
 *
 * O canal é tudo o que fica entre o workspace e o telefone. Nos eventos reais é
 * um único id hexadecimal; nas simulações é o texto que foi passado à API
 * (ex.: `TESTE-Orion-formato-addmsg`). Assim, `chaveReal` é sempre a chave que
 * foi entregue à API.
 *
 * Usado só para o log (opção A): a nota **não** vai para a conversa real.
 */
export function chaveRealDaPublicApi(chatId: unknown): ChaveRealPublicApi | null {
  if (!ehChavePublicApi(chatId)) return null;

  const resto = (chatId as string).trim().slice(PREFIXO_PUBLIC_API.length);
  const pedacos = resto.split("-");
  if (pedacos.length < 3 || pedacos.some((p) => p === "")) return null;

  const workspaceId = pedacos[0];
  const telefone = pedacos[pedacos.length - 1];
  const channelId = pedacos.slice(1, -1).join("-");

  if (!/^\d+$/.test(telefone)) return null;

  return { workspaceId, channelId, telefone, chaveReal: `${channelId}-${telefone}` };
}

/** Só os 4 últimos dígitos, com reticências na frente: `…1486`. */
export function mascararFinal(valor: string | null | undefined): string {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  if (!digitos) return "…";
  return `…${digitos.slice(-4)}`;
}

/**
 * A linha de log do evento ignorado (AC4). O telefone sai **sempre** mascarado.
 *
 * - Chave completa: `… (conversa real {canal}-…1486)`.
 * - Sem telefone (variante `@lid` ou chave malformada): diz que não deu para
 *   deduzir, com no máximo os 4 últimos dígitos do que houver.
 */
export function logDoEventoIgnorado(chatId: unknown, tipoDoEvento?: string | null): string {
  const tipo = tipoDoEvento ? ` "${tipoDoEvento}"` : "";
  const deduzida = chaveRealDaPublicApi(chatId);
  if (deduzida) {
    return `[GPTMaker] public-api — evento${tipo} ignorado (conversa real ${deduzida.channelId}-${mascararFinal(
      deduzida.telefone
    )})`;
  }
  const texto = typeof chatId === "string" ? chatId : "";
  const ehLid = texto.trim().toLowerCase().endsWith("@lid");
  return `[GPTMaker] public-api — evento${tipo} ignorado (conversa real não deduzida${
    ehLid ? `, chave @lid ${mascararFinal(texto)}` : ""
  })`;
}
