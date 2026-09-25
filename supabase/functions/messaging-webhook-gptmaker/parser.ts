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
 * **Transferência** (onTransfer) — capturado em 2026-07-27:
 * ```json
 * {
 *   "summary": null,                           // resumo da conversa pela IA (pode vir null)
 *   "agentId": "3E12E22DF12D30FBB326262F356E288B",
 *   "name": "Filipe Costa",
 *   "recipient": "5512997534278",
 *   "channel": "WHATSAPP",
 *   "contextId": "<channelId>-<recipient>",    // ← identidade da conversa
 *   "channelId": "3E14B10711E1C0FE16B42EC236EAE1D6"
 * }
 * ```
 * ⚠️ Repare no que ele NÃO tem: `messageId`, `role`, `interactionId`, `protocol`.
 * Sem uma regra própria, a inferência por forma o classificaria como `unknown`
 * e a transferência — o evento mais valioso do canal — seria descartada calada.
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
  // Transferência (onTransfer) — `summary` é o resumo da conversa feito pela IA.
  // Pode vir `null`, por isso o discriminador é a PRESENÇA da chave, não o valor.
  summary?: string | null;
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
  /**
   * O número oculto do WhatsApp (`@lid`) quando o chat é identificado por ele —
   * ex.: `"150439953756312@lid"`. `null` no caminho normal (telefone).
   *
   * É a chave do mapa de apelidos da story 2.56: com `lid` **e** `contactPhone`
   * no mesmo evento, o par é gravado e passa a reconciliar as próximas entregas.
   */
  lid: string | null;
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

/**
 * O identificador é um `@lid` (número oculto do WhatsApp)?
 *
 * Story 2.56: é ele que faz o mesmo lead nascer como contato novo, sem telefone,
 * num card à parte.
 */
export function isLid(raw: unknown): boolean {
  return typeof raw === "string" && raw.toLowerCase().endsWith("@lid");
}

/**
 * Extrai o `@lid` do evento, se houver — prioridade: `recipient` → `contextId`.
 *
 * ⚠️ `contactPhone` **não** entra aqui de propósito. Em eventos
 * `role: "assistant"` ele às vezes **ecoa o próprio lid**; usá-lo como fonte
 * faria o apelido depender de um campo que mente.
 */
export function extractLid(payload: GptMakerPayload): string | null {
  const contextId = typeof payload.contextId === "string" ? payload.contextId : null;
  const candidatos = [
    typeof payload.recipient === "string" ? payload.recipient : null,
    recipientFromContextId(contextId),
  ];
  for (const c of candidatos) {
    if (isLid(c)) return (c as string).trim();
  }
  return null;
}

/**
 * Telefone **cru** do payload, aceito só quando é de verdade — story 2.56, AC1.
 *
 * Duas armadilhas medidas no spike do @analyst (23/09):
 *
 * 1. Em eventos `role: "assistant"`, `contactPhone` às vezes **ecoa o próprio
 *    lid**. O `@` já reprova, mas um lid sem sufixo passaria pelo filtro
 *    numérico — por isso o valor também é comparado com a parte numérica do lid.
 * 2. `onFirstInteraction` e `onTransfer` chegam com `contactPhone` **vazio** —
 *    devolvem `null` e **nada é gravado**, sem erro.
 *
 * O critério `^[0-9]{10,15}$` é o do AC1, aplicado ao valor CRU (o do payload
 * vem sem `+`). O retorno é normalizado para o formato do CRM (`+55…`).
 */
export function telefoneConfiavelDoPayload(
  rawPhone: unknown,
  lid: string | null
): string | null {
  if (typeof rawPhone !== "string") return null;
  const trimmed = rawPhone.trim();
  if (!/^[0-9]{10,15}$/.test(trimmed)) return null;

  // Eco do lid sem o sufixo `@lid` — não é telefone.
  if (lid) {
    const digitosDoLid = lid.replace(/@.*$/, "").replace(/\D/g, "");
    if (digitosDoLid && digitosDoLid === trimmed) return null;
  }

  return normalizePhone(trimmed);
}

/**
 * Nome do contato — story 2.56, AC8.
 *
 * O filtro antigo desta linha era **no-op** (`rawName && !rawName.includes("@")
 * ? rawName : rawName ?? null` devolvia o mesmo valor nos dois ramos), e por
 * isso existem contatos no banco cujo nome é o próprio `…@lid`.
 *
 * Passa a valer: identificador do WhatsApp **nunca** vira nome. O fallback é
 * **vazio** (`null`) — a tela já sabe mostrar contato sem nome. Não inventar
 * apelido, não gravar o lid truncado, não gravar "Contato sem nome" no banco:
 * texto de apresentação é da tela, não do dado.
 *
 * ⚠️ Rejeita só o que **parece identificador** (`…@lid`, `…@s.whatsapp.net`,
 * `…@g.us`, ou `dígitos@qualquercoisa`). Um nome legítimo com `@` — apelido de
 * rede social, por exemplo — continua passando: o alvo é o identificador, não o
 * caractere.
 */
export function sanitizeContactName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower.endsWith("@lid") || lower.endsWith("@s.whatsapp.net") || lower.endsWith("@g.us")) {
    return null;
  }
  // `27870562914352@algo` — parte antes do `@` só com dígitos é identificador.
  if (/^\+?\d[\d\s-]*@/.test(trimmed)) return null;

  return trimmed;
}

/**
 * Chave da conversa derivada do TELEFONE — story 2.56, AC2.
 *
 * O `contextId` é `<channelId>-<recipient>`. Quando o alias resolve o lid para
 * um telefone, a conversa que queremos reusar é a que está chaveada por
 * `<channelId>-<dígitos do telefone>` — exatamente o formato que o fornecedor
 * usa no caminho normal.
 *
 * Devolve `null` quando não dá para derivar (sem hífen no contextId, telefone
 * vazio). Na dúvida, o chamador segue pelo caminho de hoje — nunca inventa chave.
 */
export function chatIdPorTelefone(
  contextId: string | null | undefined,
  phone: string | null | undefined
): string | null {
  if (!contextId || !phone) return null;
  const idx = contextId.indexOf("-");
  if (idx <= 0) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  return `${contextId.slice(0, idx)}-${digits}`;
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
    // Transferência: não tem messageId, role, interactionId nem protocol. O que
    // a distingue é `summary` (resumo da conversa) junto de `contextId`. Sem esta
    // regra, o evento mais valioso do canal virava `unknown` e era descartado.
    // Formato confirmado em 2026-07-27 — ver cabeçalho do arquivo.
    if ("summary" in payload && payload.contextId !== undefined) return "transfer";
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

  // Nome: identificador do WhatsApp NUNCA vira nome (AC8 da story 2.56).
  // Tenta `contactName`, depois `name`; se os dois forem identificador, fica
  // vazio — e vazio é o dado correto, não uma falha.
  const contactName =
    sanitizeContactName(payload.contactName) ?? sanitizeContactName(payload.name);

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
    lid: extractLid(payload),
  };
}

/**
 * Janela de deduplicação da transferência, em milissegundos.
 *
 * A transferência é o único evento que **não traz `date`** no payload — o
 * `timestamp` dela é a hora de chegada aqui. Isso cria um dilema:
 *
 * - id só com o `contextId` → a **retransferência é engolida para sempre**
 *   (lead que volta semanas depois e é passado de novo nunca reprocessa);
 * - id com o timestamp cru → **cada retry do fornecedor vira um evento novo**,
 *   porque a hora de chegada muda a cada entrega.
 *
 * A janela resolve os dois: entregas dentro do mesmo balde de 5 min colapsam
 * num id só (retry deduplicado), e uma transferência posterior cai em balde
 * diferente (reprocessa). Os limites — retry que cruza a fronteira do balde
 * duplica; retransferência dentro de 5 min é engolida — são aceitos: o
 * fornecedor responde 200 mesmo em erro de processamento, então retry só
 * acontece em timeout de rede, e transferir o mesmo lead duas vezes em 5
 * minutos é operacionalmente indistinguível de um retry.
 */
export const TRANSFER_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

/** ID estável do evento, para deduplicação. */
export function generateStableEventId(
  event: NormalizedEvent,
  channelId: string,
  rawEvent: string
): string {
  if (event.externalMessageId) return `gpt_${event.kind}_${event.externalMessageId}`;
  if (event.kind === "transfer" && event.chatId) {
    const bucket = Math.floor(event.timestamp.getTime() / TRANSFER_DEDUPE_WINDOW_MS);
    return `gpt_transfer_${event.chatId}_${bucket}`;
  }
  if (event.chatId) {
    return `gpt_${rawEvent || "event"}_${event.chatId}_${event.timestamp.getTime()}`;
  }
  return `gpt_${rawEvent || "event"}_${channelId}_${Date.now()}`;
}
