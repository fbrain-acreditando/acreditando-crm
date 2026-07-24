/**
 * Parser de eventos do GPT Maker — módulo puro (sem Deno, sem rede, sem Supabase).
 *
 * Está separado do `index.ts` de propósito: o formato do payload NÃO é documentado
 * pelo fornecedor, então esta é a peça de maior risco da integração — e a única que
 * dá para testar sem bater na API. Ver `parser.test.ts`.
 *
 * Quando a Fase 0 (modo captura) revelar o formato real em produção, é aqui que os
 * ajustes acontecem, com os payloads reais virando fixtures de teste.
 *
 * @module supabase/functions/messaging-webhook-gptmaker/parser
 */

// =============================================================================
// TYPES
// =============================================================================

export interface GptMakerPayload {
  event?: string;
  type?: string;
  chatId?: string;
  chat?: Record<string, unknown>;
  message?: Record<string, unknown> | string;
  contact?: Record<string, unknown>;
  agentId?: string;
  channelId?: string;
  [key: string]: unknown;
}

/** Evento normalizado — o que o handler consome. */
export interface NormalizedEvent {
  kind: "message" | "transfer" | "interaction" | "unknown";
  chatId: string | null;
  externalMessageId: string | null;
  text: string;
  contentType: string;
  content: Record<string, unknown>;
  direction: "inbound" | "outbound";
  contactName: string | null;
  contactPhone: string | null;
  contactAvatar: string | null;
  timestamp: Date;
}

// =============================================================================
// HELPERS
// =============================================================================

/** Comparação em tempo constante (evita timing oracle na checagem do segredo). */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  const aPadded = new Uint8Array(len);
  const bPadded = new Uint8Array(len);
  aPadded.set(aBytes);
  bPadded.set(bBytes);

  let result = aBytes.length === bBytes.length ? 0 : 1;
  for (let i = 0; i < len; i++) result |= aPadded[i] ^ bPadded[i];
  return result === 0;
}

/**
 * Extrai o segredo do request.
 *
 * Aceita header OU query string: o painel do GPT Maker só deixa configurar a URL do
 * webhook — não há campo para header customizado. Sem isso, não haveria autenticação
 * nenhuma (a plataforma também não assina os payloads).
 */
export function getSecretFromRequest(req: Request, url: URL): string {
  const header = req.headers.get("x-api-key") || req.headers.get("apikey") || "";
  if (header.trim()) return header.trim();

  const query = url.searchParams.get("key") || url.searchParams.get("secret") || "";
  return query.trim();
}

/** Normaliza telefone para o formato do CRM (+55...). */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `+${digits}`;
}

/** Lê um campo tolerando nomes alternativos. */
function pick(source: Record<string, unknown> | undefined, ...keys: string[]): unknown {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Classifica o evento pelo nome.
 * Os NOMES vêm de `PUT /v2/agent/{agentId}/webhooks` (documentados);
 * o CORPO de cada um é que não é.
 */
export function classifyEvent(rawEvent: string): NormalizedEvent["kind"] {
  const event = rawEvent.toLowerCase();
  if (event.includes("transfer")) return "transfer";
  if (event.includes("message")) return "message";
  if (event.includes("interaction")) return "interaction";
  return "unknown";
}

// =============================================================================
// PARSER
// =============================================================================

/**
 * Normaliza o payload do GPT Maker.
 *
 * ⚠️ TOLERANTE DE PROPÓSITO: o formato não é documentado, então tentamos os caminhos
 * plausíveis em vez de assumir um só. **Nunca lança** — quando não reconhece, devolve
 * `kind: "unknown"` / `chatId: null` e o corpo cru fica gravado para inspeção, em vez
 * de o evento ser descartado em silêncio.
 */
export function normalizeEvent(payload: GptMakerPayload): NormalizedEvent {
  const rawEvent = String(payload.event ?? payload.type ?? "");
  const chat = asRecord(payload.chat);
  const contact = asRecord(payload.contact);
  const messageObj = typeof payload.message === "object" ? asRecord(payload.message) : undefined;
  const messageText =
    typeof payload.message === "string"
      ? payload.message
      : (pick(messageObj, "text", "message", "content") as string | undefined);

  const chatId =
    (pick(payload as Record<string, unknown>, "chatId", "chat_id") as string | undefined) ??
    (pick(chat, "id", "chatId") as string | undefined) ??
    (pick(messageObj, "chatId", "chat_id") as string | undefined) ??
    null;

  const role = String(pick(messageObj, "role") ?? "user").toLowerCase();
  // "user" = lead (entrada). Qualquer outro papel (assistant/agent/human) é saída.
  const direction: "inbound" | "outbound" = role === "user" ? "inbound" : "outbound";

  const rawTime = pick(messageObj, "time", "timestamp") ?? pick(chat, "time");
  const timestamp =
    typeof rawTime === "number"
      ? // A API usa epoch em milissegundos nos exemplos, mas segundos aparecem em
        // integrações antigas — o corte em 1e12 cobre os dois sem inventar data.
        new Date(rawTime > 1e12 ? rawTime : rawTime * 1000)
      : new Date();

  let contentType = "text";
  let content: Record<string, unknown> = { type: "text", text: messageText ?? "[mensagem]" };

  const imageUrl = pick(messageObj, "imageUrl");
  const audioUrl = pick(messageObj, "audioUrl");
  const documentUrl = pick(messageObj, "documentUrl");

  if (typeof imageUrl === "string") {
    contentType = "image";
    content = { type: "image", mediaUrl: imageUrl, caption: messageText };
  } else if (typeof audioUrl === "string") {
    contentType = "audio";
    content = { type: "audio", mediaUrl: audioUrl };
  } else if (typeof documentUrl === "string") {
    contentType = "document";
    content = {
      type: "document",
      mediaUrl: documentUrl,
      fileName: (pick(messageObj, "fileName") as string) ?? "documento",
    };
  }

  return {
    kind: classifyEvent(rawEvent),
    chatId,
    externalMessageId: (pick(messageObj, "id", "messageId") as string) ?? null,
    text: messageText ?? "[mensagem]",
    contentType,
    content,
    direction,
    contactName:
      ((pick(contact, "name") ?? pick(chat, "userName", "name", "title")) as string | undefined) ??
      null,
    contactPhone:
      normalizePhone(pick(contact, "phone")) ??
      normalizePhone(pick(chat, "whatsappPhone", "recipient")),
    contactAvatar:
      ((pick(contact, "picture") ?? pick(chat, "picture")) as string | undefined) ?? null,
    timestamp,
  };
}

/** ID estável do evento, para deduplicação. */
export function generateStableEventId(
  event: NormalizedEvent,
  channelId: string,
  rawEvent: string
): string {
  if (event.externalMessageId) return `gpt_msg_${event.externalMessageId}`;
  if (event.kind === "transfer" && event.chatId) return `gpt_transfer_${event.chatId}`;
  if (event.chatId) {
    return `gpt_${rawEvent || "event"}_${event.chatId}_${event.timestamp.getTime()}`;
  }
  return `gpt_${rawEvent || "event"}_${channelId}_${Date.now()}`;
}
