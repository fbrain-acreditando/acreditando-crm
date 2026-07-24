/**
 * Parser de eventos do GPT Maker — módulo puro (sem Deno, sem rede, sem Supabase).
 *
 * ============================================================================
 * FORMATO REAL — capturado em produção em 2026-07-24
 * ============================================================================
 * O fornecedor NÃO documenta o corpo dos webhooks. Os formatos abaixo foram
 * capturados dos eventos reais gravados em `messaging_webhook_events`.
 *
 * **Mensagem** (onNewMessage):
 * ```json
 * {
 *   "date": "2026-07-24T17:22:53.572+00:00",
 *   "role": "assistant",                       // "user" = lead · outro = saída
 *   "message": "texto",                        // "" quando é só mídia
 *   "images": ["https://gpt-files.com/..."],   // ARRAYS, não campos únicos
 *   "audios": [], "documents": [],
 *   "channel": "WHATSAPP",
 *   "contextId": "<channelId>-<recipient>",    // ← identidade da conversa
 *   "messageId": "3F69B23A3F8D70BFB461DA78A3C64868",
 *   "assistantId": "<agentId>",
 *   "contactName": "27870562914352@lid",
 *   "contactPhone": "27870562914352@lid"       // pode ser @lid, NÃO telefone
 * }
 * ```
 *
 * **Interação** (onFirstInteraction / onStartInteraction):
 * ```json
 * {
 *   "name": "27870562914352@lid",
 *   "agentId": "...", "channelId": "...", "channel": "WHATSAPP",
 *   "protocol": 23167,
 *   "contextId": "<channelId>-<recipient>",
 *   "recipient": "27870562914352@lid",
 *   "interactionId": "3F69B23A48B531FC289CDA78A3C64868"
 * }
 * ```
 *
 * ## Três armadilhas do formato real
 *
 * 1. **Não existe campo `event`/`type`.** Todos os eventos chegam sem se
 *    identificar. Resolvido em duas camadas: a URL registrada no agente leva
 *    `&event=<nome>` (explícito), e há inferência pela forma do payload como
 *    rede de segurança (`messageId` → mensagem, `interactionId` → interação).
 * 2. **`contactPhone` pode ser um `@lid`** (identificador interno do WhatsApp),
 *    não um telefone. Gravar `+27870562914352` criaria contato com telefone
 *    falso e quebraria o casamento por telefone. Só aceitamos dígitos puros.
 * 3. **`contextId` é a chave da conversa**, e é o mesmo `id` devolvido por
 *    `GET /v2/workspace/{id}/chats` — por isso o webhook encontra as conversas
 *    já importadas em vez de duplicá-las.
 *
 * @module supabase/functions/messaging-webhook-gptmaker/parser
 */

// =============================================================================
// TYPES
// =============================================================================

export interface GptMakerPayload {
  // Mensagem
  date?: string;
  role?: string;
  message?: string;
  images?: string[];
  audios?: string[];
  documents?: string[];
  messageId?: string;
  assistantId?: string;
  contactName?: string;
  contactPhone?: string;
  // Interação
  name?: string;
  agentId?: string;
  protocol?: number;
  interactionId?: string;
  recipient?: string;
  // Comuns
  contextId?: string;
  channelId?: string;
  channel?: string;
  [key: string]: unknown;
}

/** Evento normalizado — o que o handler consome. */
export interface NormalizedEvent {
  kind: "message" | "transfer" | "interaction" | "unknown";
  /** contextId do GPT Maker — identidade da conversa */
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
 * Aceita header OU query string: o painel do GPT Maker só deixa configurar a URL
 * do webhook — não há campo para header customizado. Sem isso, não haveria
 * autenticação nenhuma (a plataforma também não assina os payloads).
 */
export function getSecretFromRequest(req: Request, url: URL): string {
  const header = req.headers.get("x-api-key") || req.headers.get("apikey") || "";
  if (header.trim()) return header.trim();

  const query = url.searchParams.get("key") || url.searchParams.get("secret") || "";
  return query.trim();
}

/**
 * Normaliza telefone para o formato do CRM (+55...).
 *
 * ⚠️ Rejeita `@lid` e qualquer coisa que não seja só dígitos. O GPT Maker manda
 * `"27870562914352@lid"` em `contactPhone` — é o identificador interno do
 * WhatsApp, não um número. Aceitar isso criaria contatos com telefone inventado
 * e quebraria a deduplicação por telefone.
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const trimmed = raw.trim();
  // @lid, @s.whatsapp.net, @g.us — nenhum é telefone
  if (trimmed.includes("@")) return null;
  if (!/^\+?\d+$/.test(trimmed)) return null;

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

/**
 * O `contextId` é `<channelId>-<recipient>`. O trecho depois do primeiro hífen
 * é o destinatário — que pode ser um telefone real (`553598205552`) ou um `@lid`.
 */
export function recipientFromContextId(contextId: string | null | undefined): string | null {
  if (!contextId) return null;
  const idx = contextId.indexOf("-");
  if (idx === -1) return null;
  const recipient = contextId.slice(idx + 1);
  return recipient || null;
}

function firstUrl(list: unknown): string | null {
  if (!Array.isArray(list)) return null;
  const first = list.find((item) => typeof item === "string" && item);
  return (first as string) ?? null;
}

/**
 * Classifica o evento.
 *
 * O payload real **não traz o nome do evento**. Duas camadas:
 * 1. `eventHint` — vem do `&event=` na URL registrada no agente (confiável).
 * 2. Forma do payload — `messageId` → mensagem · `interactionId`/`protocol` →
 *    interação. Rede de segurança para webhooks configurados à mão.
 */
export function classifyEvent(eventHint: string, payload?: GptMakerPayload): NormalizedEvent["kind"] {
  const hint = (eventHint || "").toLowerCase();
  if (hint.includes("transfer")) return "transfer";
  if (hint.includes("message")) return "message";
  if (hint.includes("interaction")) return "interaction";

  // Sem pista na URL: deduz pela forma do payload.
  if (payload) {
    if (payload.messageId || typeof payload.role === "string") return "message";
    if (payload.interactionId || payload.protocol !== undefined) return "interaction";
  }

  return "unknown";
}

// =============================================================================
// PARSER
// =============================================================================

/**
 * Normaliza o payload do GPT Maker.
 *
 * Tolerante de propósito: **nunca lança**. Quando não reconhece, devolve
 * `kind: "unknown"` e o corpo cru fica gravado para inspeção, em vez de o evento
 * ser descartado em silêncio.
 *
 * @param eventHint nome do evento vindo do `&event=` da URL (pode ser vazio)
 */
export function normalizeEvent(payload: GptMakerPayload, eventHint = ""): NormalizedEvent {
  const contextId = typeof payload.contextId === "string" ? payload.contextId : null;

  // "user" = o lead falando. Qualquer outro papel (assistant / human / agent) é saída.
  const role = String(payload.role ?? "user").toLowerCase();
  const direction: "inbound" | "outbound" = role === "user" ? "inbound" : "outbound";

  // `date` vem como ISO string ("2026-07-24T17:22:53.572+00:00"), não epoch.
  let timestamp = new Date();
  if (typeof payload.date === "string") {
    const parsed = Date.parse(payload.date);
    if (!Number.isNaN(parsed)) timestamp = new Date(parsed);
  } else if (typeof payload.date === "number") {
    const raw = payload.date as number;
    timestamp = new Date(raw > 1e12 ? raw : raw * 1000);
  }

  // Mídia chega em ARRAYS (images/audios/documents), não em campos únicos.
  const messageText = typeof payload.message === "string" ? payload.message : "";
  const imageUrl = firstUrl(payload.images);
  const audioUrl = firstUrl(payload.audios);
  const documentUrl = firstUrl(payload.documents);

  let contentType = "text";
  let content: Record<string, unknown> = { type: "text", text: messageText || "[mensagem]" };
  let preview = messageText || "[mensagem]";

  if (imageUrl) {
    contentType = "image";
    content = { type: "image", mediaUrl: imageUrl, caption: messageText || undefined };
    preview = messageText || "[imagem]";
  } else if (audioUrl) {
    contentType = "audio";
    content = { type: "audio", mediaUrl: audioUrl };
    preview = "[áudio]";
  } else if (documentUrl) {
    contentType = "document";
    content = { type: "document", mediaUrl: documentUrl, fileName: "documento" };
    preview = messageText || "[documento]";
  }

  // Telefone: tenta contactPhone, depois o recipient, depois o sufixo do contextId.
  // Todos podem ser @lid — normalizePhone rejeita e devolve null, que é o correto.
  const recipient =
    (typeof payload.recipient === "string" ? payload.recipient : null) ??
    recipientFromContextId(contextId);

  const contactPhone =
    normalizePhone(payload.contactPhone) ?? normalizePhone(recipient);

  // Nome: evita usar o @lid como nome quando há alternativa.
  const rawName =
    (typeof payload.contactName === "string" ? payload.contactName : null) ??
    (typeof payload.name === "string" ? payload.name : null);
  const contactName = rawName && !rawName.includes("@") ? rawName : rawName ?? null;

  return {
    kind: classifyEvent(eventHint, payload),
    chatId: contextId,
    externalMessageId:
      typeof payload.messageId === "string"
        ? payload.messageId
        : typeof payload.interactionId === "string"
          ? payload.interactionId
          : null,
    text: preview,
    contentType,
    content,
    direction,
    contactName,
    contactPhone,
    contactAvatar: null,
    timestamp,
  };
}

/** ID estável do evento, para deduplicação. */
export function generateStableEventId(
  event: NormalizedEvent,
  channelId: string,
  rawEvent: string
): string {
  if (event.externalMessageId) return `gpt_${event.kind}_${event.externalMessageId}`;
  if (event.kind === "transfer" && event.chatId) return `gpt_transfer_${event.chatId}`;
  if (event.chatId) {
    return `gpt_${rawEvent || "event"}_${event.chatId}_${event.timestamp.getTime()}`;
  }
  return `gpt_${rawEvent || "event"}_${channelId}_${Date.now()}`;
}
