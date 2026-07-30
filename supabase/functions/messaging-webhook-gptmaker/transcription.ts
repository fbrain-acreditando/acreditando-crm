/**
 * Transcrição de áudio do GPT Maker.
 *
 * FATO (apurado no dado real de produção em 2026-07-30): o fornecedor entrega a
 * transcrição no campo `midiaContent` de `GET /v2/chat/{chatId}/messages`, tanto
 * para áudio RECEBIDO (`role: "user"`) quanto ENVIADO (`role: "assistant"`).
 *
 * O WEBHOOK NÃO entrega esse texto: auditados os 358 eventos de áudio já
 * gravados em `messaging_webhook_events`, `audios` é array de URLs puras e o
 * campo `message` vem vazio em 100% deles (maior valor observado: 0 caracteres).
 * Por isso a transcrição precisa ser buscada na API.
 *
 * O elo entre os dois mundos é `messageId` (webhook) === `id` (item da API) —
 * conferido nos 3 áudios de um mesmo chat, batendo exatamente.
 */

const GPTMAKER_API_BASE = "https://api.gptmaker.ai";
/** Teto curto de propósito: isto roda no caminho crítico do webhook. */
export const TRANSCRIPTION_TIMEOUT_MS = 6000;
/** Uma página basta: a mensagem que acabou de chegar está no topo da lista. */
export const TRANSCRIPTION_PAGE_SIZE = 20;

/**
 * Acha a transcrição de UMA mensagem dentro da resposta da API.
 *
 * Função pura — é aqui que mora toda a decisão, e é o que os testes cobrem.
 * Tolerante ao formato: a resposta observada é um array puro, mas aceita também
 * `{ data: [...] }` para não quebrar se o fornecedor envelopar depois.
 */
export function pickTranscription(body: unknown, messageId: string): string | null {
  if (!messageId) return null;

  const items = Array.isArray(body)
    ? body
    : Array.isArray((body as { data?: unknown })?.data)
    ? (body as { data: unknown[] }).data
    : [];

  const hit = (items as Array<Record<string, unknown> | null>).find(
    (item) => !!item && item.id === messageId
  );

  const text = typeof hit?.midiaContent === "string" ? hit.midiaContent.trim() : "";
  return text || null;
}

/**
 * Busca a transcrição na API do GPT Maker.
 *
 * Devolve `null` em QUALQUER problema (sem token, HTTP != 2xx, timeout, formato
 * inesperado, áudio ainda não transcrito). Nunca lança: perder a transcrição é
 * aceitável, perder a mensagem não.
 */
export async function fetchAudioTranscription(
  apiToken: string | undefined | null,
  chatId: string,
  messageId: string | null | undefined
): Promise<string | null> {
  if (!apiToken || !messageId) return null;

  try {
    const url =
      `${GPTMAKER_API_BASE}/v2/chat/${encodeURIComponent(chatId)}/messages` +
      `?page=1&pageSize=${TRANSCRIPTION_PAGE_SIZE}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}` },
      signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`[GPTMaker] Transcrição: HTTP ${res.status} para chat ${chatId}`);
      return null;
    }

    return pickTranscription(await res.json(), messageId);
  } catch (error) {
    // Timeout entra aqui. Silencioso de propósito — ver docstring.
    console.error("[GPTMaker] Transcrição: falha ao consultar a API", {
      chatId,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
