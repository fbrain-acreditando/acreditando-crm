/**
 * GPT Maker Webhook Handler
 *
 * Recebe eventos da plataforma GPT Maker (https://api.gptmaker.ai) e processa:
 * - Nova mensagem / primeira interação → cria/atualiza conversa + insere mensagem
 * - Transferência para humano → marca a conversa como "aguardando humano" (lead quente)
 * - Deal criado automaticamente pela lead_routing_rule do canal
 *
 * Rota:
 * - `POST /functions/v1/messaging-webhook-gptmaker/<channel_id>?key=<webhook_secret>`
 *
 * Autenticação (default-deny):
 * - Segredo aceito em `x-api-key`, `apikey` ou na query `?key=`.
 * - Comparado com `credentials.webhookSecret` do canal (ou `GPTMAKER_WEBHOOK_SECRET` global).
 * - ⚠️ O GPT Maker NÃO assina os webhooks (não há HMAC). O segredo na URL é a única
 *   defesa contra injeção de lead falso — por isso a query string também é aceita:
 *   o painel do GPT Maker só permite configurar a URL, não headers customizados.
 *
 * ⚠️ MODO CAPTURA (Fase 0):
 * O formato do payload NÃO é documentado pelo fornecedor. Enquanto
 * `GPTMAKER_CAPTURE_MODE=true`, a função apenas GRAVA o corpo cru em
 * `messaging_webhook_events` (processed=false) e responde 200 — sem processar nada.
 * Depois de ler os payloads reais no banco, apertar o parser e desligar a flag.
 *
 * ⚠️ A IA DO CRM NÃO É ACIONADA NESTE CANAL.
 * Quem atende é o agente do GPT Maker. Conversas nascem com `metadata.ai_paused=true`
 * (defesa em profundidade) e esta função nunca chama `/api/messaging/ai/process`.
 * Ver `lib/messaging/providers/whatsapp/gptmaker.provider.ts`.
 *
 * Deploy:
 * - `supabase functions deploy messaging-webhook-gptmaker --no-verify-jwt`
 */
import { createClient } from "npm:@supabase/supabase-js@2";

// O parser vive em módulo separado (puro, sem Deno/rede) porque é a peça de maior
// risco desta integração — o payload do GPT Maker não é documentado. Testado em
// `parser.test.ts`, que roda no Vitest junto com o resto do CRM.
import {
  normalizeEvent,
  generateStableEventId,
  getSecretFromRequest,
  timingSafeEqual,
  type GptMakerPayload,
  type NormalizedEvent,
} from "./parser.ts";

// =============================================================================
// TYPES
// =============================================================================

interface ChannelRow {
  id: string;
  organization_id: string;
  business_unit_id: string;
  external_identifier: string;
  credentials: Record<string, string>;
  settings: Record<string, unknown>;
}


// =============================================================================
// HELPERS
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key, apikey",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Método não permitido" });
  }

  const url = new URL(req.url);
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const channelId = url.pathname.match(uuidRegex)?.[0] ?? null;

  if (!channelId) {
    return json(400, { error: "channel_id ausente na URL" });
  }

  let payload: GptMakerPayload;
  try {
    payload = (await req.json()) as GptMakerPayload;
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  const supabaseUrl = Deno.env.get("CRM_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
  const serviceKey =
    Deno.env.get("CRM_SUPABASE_SECRET_KEY") ??
    Deno.env.get("CRM_SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: "Supabase não configurado no runtime" });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Busca o canal pelo ID da URL (nunca por identificador controlado pelo remetente).
  const { data: channel, error: channelErr } = await supabase
    .from("messaging_channels")
    .select("id, organization_id, business_unit_id, external_identifier, credentials, settings")
    .eq("id", channelId)
    .in("status", ["connected", "active"])
    .maybeSingle();

  if (channelErr) {
    console.error("[GPTMaker] Error fetching channel:", channelErr);
    return json(200, { ok: false, error: "Erro ao buscar canal" });
  }

  if (!channel) {
    return json(200, { ok: false, error: "Canal não encontrado" });
  }

  const typedChannel = channel as unknown as ChannelRow;

  // ---------------------------------------------------------------------------
  // AUTH — default-deny
  // ---------------------------------------------------------------------------
  const expectedSecret =
    Deno.env.get("GPTMAKER_WEBHOOK_SECRET") ?? typedChannel.credentials?.webhookSecret;
  const providedSecret = getSecretFromRequest(req, url);

  if (!expectedSecret || !providedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
    return json(401, { error: "Segredo inválido" });
  }

  const rawEvent = String(payload.event ?? payload.type ?? "");
  const normalized = normalizeEvent(payload);
  const externalEventId = generateStableEventId(normalized, channelId, rawEvent);

  // ---------------------------------------------------------------------------
  // AUDIT LOG + DEDUPE
  // ---------------------------------------------------------------------------
  const { error: eventInsertErr } = await supabase
    .from("messaging_webhook_events")
    .insert({
      channel_id: channelId,
      event_type: rawEvent || "unknown",
      external_event_id: externalEventId,
      payload: payload as unknown as Record<string, unknown>,
      processed: false,
    });

  if (eventInsertErr?.message?.toLowerCase().includes("duplicate")) {
    console.log(`[GPTMaker] Duplicate event ignored: ${externalEventId}`);
    return json(200, { ok: true, duplicate: true, event_id: externalEventId });
  }

  if (eventInsertErr) {
    console.error("[GPTMaker] Error logging webhook event:", eventInsertErr);
  }

  // ---------------------------------------------------------------------------
  // MODO CAPTURA (Fase 0) — grava e sai, sem processar
  // ---------------------------------------------------------------------------
  const captureMode = (Deno.env.get("GPTMAKER_CAPTURE_MODE") ?? "").toLowerCase() === "true";

  if (captureMode) {
    console.log(
      `[GPTMaker] CAPTURE MODE — evento "${rawEvent}" gravado sem processar (event_id: ${externalEventId})`
    );
    return json(200, { ok: true, captured: true, event: rawEvent, event_id: externalEventId });
  }

  // ---------------------------------------------------------------------------
  // PROCESSAMENTO
  // ---------------------------------------------------------------------------
  try {
    if (normalized.kind === "unknown" || !normalized.chatId) {
      console.warn(
        `[GPTMaker] Evento não reconhecido (event: "${rawEvent}", chatId: ${normalized.chatId}) — payload gravado para inspeção`
      );
    } else if (normalized.kind === "transfer") {
      await handleTransfer(supabase, typedChannel, normalized);
    } else {
      await handleMessage(supabase, typedChannel, normalized);
    }

    await supabase
      .from("messaging_webhook_events")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("channel_id", channelId)
      .eq("external_event_id", externalEventId);

    return json(200, { ok: true, event: rawEvent });
  } catch (error) {
    console.error("[GPTMaker] Webhook processing error:", error);

    await supabase
      .from("messaging_webhook_events")
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      })
      .eq("channel_id", channelId)
      .eq("external_event_id", externalEventId);

    // Sempre 200 — evita retry storm do fornecedor.
    return json(200, {
      ok: false,
      error: "Erro ao processar webhook",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// =============================================================================
// EVENT HANDLERS
// =============================================================================

/**
 * Mensagem nova (ou primeira interação).
 *
 * A identidade da conversa é o **chatId do GPT Maker** — é o único identificador
 * aceito pelo endpoint de envio. O telefone vai para o contato.
 */
async function handleMessage(
  supabase: ReturnType<typeof createClient>,
  channel: ChannelRow,
  event: NormalizedEvent
) {
  const chatId = event.chatId!;

  const { conversationId } = await ensureConversation(supabase, channel, event);

  const externalMessageId =
    event.externalMessageId ?? `gptmaker:${chatId}:${event.timestamp.getTime()}`;

  const { error: msgErr } = await supabase.from("messaging_messages").insert({
    conversation_id: conversationId,
    external_id: externalMessageId,
    direction: event.direction,
    content_type: event.contentType,
    content: event.content,
    // A API não expõe status de entrega — não prometemos "delivered"/"read".
    status: "sent",
    sent_at: event.timestamp.toISOString(),
    sender_name: event.direction === "inbound" ? event.contactName : null,
    metadata: {
      gptmaker_chat_id: chatId,
      gptmaker_message_id: event.externalMessageId,
      source: "gptmaker",
    },
  });

  if (msgErr) {
    if (!msgErr.message.toLowerCase().includes("duplicate")) throw msgErr;
    console.log(`[GPTMaker] Duplicate message ignored: ${externalMessageId}`);
    return;
  }

  const { error: convUpdateErr } = await supabase
    .from("messaging_conversations")
    .update({
      last_message_at: event.timestamp.toISOString(),
      last_message_preview: event.text.slice(0, 100),
      last_message_direction: event.direction,
      ...(event.direction === "inbound" ? { status: "open" } : {}),
    })
    .eq("id", conversationId);

  if (convUpdateErr) {
    console.error("[GPTMaker] Failed to update conversation:", convUpdateErr, { conversationId });
  }

  // ⚠️ A IA do CRM NÃO é acionada aqui — quem atende é o agente do GPT Maker.
  // Ligar as duas faria dois robôs responderem o mesmo lead.
}

/**
 * Transferência para humano — é o sinal de **lead qualificado**.
 *
 * No desenho combinado com o Acreditando (reunião de 16/07), este é o momento em que
 * a IA terminou de coletar e passa para a Fernanda. É o gatilho mais valioso do canal.
 */
async function handleTransfer(
  supabase: ReturnType<typeof createClient>,
  channel: ChannelRow,
  event: NormalizedEvent
) {
  const { conversationId } = await ensureConversation(supabase, channel, event);

  const { data: conv, error: readErr } = await supabase
    .from("messaging_conversations")
    .select("metadata")
    .eq("id", conversationId)
    .maybeSingle();

  if (readErr) {
    console.error("[GPTMaker] Failed to read conversation metadata:", readErr);
    return;
  }

  const { error: updateErr } = await supabase
    .from("messaging_conversations")
    .update({
      status: "open",
      priority: "high",
      metadata: {
        ...((conv?.metadata as Record<string, unknown>) || {}),
        gptmaker_transferred: true,
        gptmaker_transferred_at: event.timestamp.toISOString(),
      },
    })
    .eq("id", conversationId);

  if (updateErr) {
    console.error("[GPTMaker] Failed to flag transfer:", updateErr);
    return;
  }

  console.log(`[GPTMaker] Transferência registrada — conversa ${conversationId} marcada como alta prioridade`);
}

// =============================================================================
// HELPERS DE PERSISTÊNCIA
// =============================================================================

/**
 * Garante conversa + contato (+ deal, se houver routing rule).
 * Idempotente: chamada por qualquer evento, cria só na primeira vez.
 */
async function ensureConversation(
  supabase: ReturnType<typeof createClient>,
  channel: ChannelRow,
  event: NormalizedEvent
): Promise<{ conversationId: string; contactId: string | null }> {
  const chatId = event.chatId!;

  const { data: existingConv, error: convFindErr } = await supabase
    .from("messaging_conversations")
    .select("id, contact_id")
    .eq("channel_id", channel.id)
    .eq("external_contact_id", chatId)
    .maybeSingle();

  if (convFindErr) throw convFindErr;

  if (existingConv) {
    return { conversationId: existingConv.id, contactId: existingConv.contact_id };
  }

  const contactId = await findOrCreateContact(supabase, channel, event);

  const { data: newConv, error: convCreateErr } = await supabase
    .from("messaging_conversations")
    .insert({
      organization_id: channel.organization_id,
      channel_id: channel.id,
      business_unit_id: channel.business_unit_id,
      external_contact_id: chatId,
      external_contact_name: event.contactName ?? event.contactPhone ?? chatId,
      contact_id: contactId,
      status: "open",
      priority: "normal",
      metadata: {
        gptmaker_chat_id: chatId,
        gptmaker_phone: event.contactPhone,
        source: "gptmaker",
        // Defesa em profundidade: mesmo que alguém dispare o processamento da IA
        // do CRM manualmente, ela pula esta conversa (agent.service.ts checa isto).
        ai_paused: true,
      },
    })
    .select("id")
    .single();

  if (convCreateErr) throw convCreateErr;

  const conversationId = newConv.id;

  // Deal automático conforme a "Entrada de Leads" configurada no canal.
  if (contactId) {
    const routingRule = await getLeadRoutingRule(supabase, channel.id);
    if (routingRule) {
      await autoCreateDeal(supabase, {
        organizationId: channel.organization_id,
        contactId,
        boardId: routingRule.boardId,
        stageId: routingRule.stageId,
        conversationId,
        contactName: event.contactName ?? event.contactPhone ?? chatId,
      });
    }
  }

  return { conversationId, contactId };
}

/** Reusa o contato existente pelo telefone; só cria se não houver. */
async function findOrCreateContact(
  supabase: ReturnType<typeof createClient>,
  channel: ChannelRow,
  event: NormalizedEvent
): Promise<string | null> {
  const phone = event.contactPhone;

  if (phone) {
    const { data: existing, error: lookupErr } = await supabase
      .from("contacts")
      .select("id")
      .eq("organization_id", channel.organization_id)
      .eq("phone", phone)
      .is("deleted_at", null)
      .order("created_at")
      .limit(1)
      .maybeSingle();

    if (lookupErr) {
      console.error("[GPTMaker] Error looking up contact:", lookupErr);
      throw lookupErr;
    }

    if (existing) return existing.id;
  }

  const { data: newContact, error: createErr } = await supabase
    .from("contacts")
    .insert({
      organization_id: channel.organization_id,
      name: event.contactName ?? phone ?? "Contato do WhatsApp",
      phone: phone,
      source: "whatsapp",
    })
    .select("id")
    .single();

  if (createErr) {
    console.error("[GPTMaker] Error auto-creating contact:", createErr);
    return null;
  }

  console.log(`[GPTMaker] Auto-created contact: ${newContact.id}`);
  return newContact.id;
}

async function getLeadRoutingRule(
  supabase: ReturnType<typeof createClient>,
  channelId: string
): Promise<{ boardId: string; stageId: string | null } | null> {
  const { data, error } = await supabase
    .from("lead_routing_rules")
    .select("board_id, stage_id, enabled")
    .eq("channel_id", channelId)
    .maybeSingle();

  if (error) {
    console.error("[GPTMaker] Error fetching lead routing rule:", error);
    return null;
  }

  if (!data || !data.enabled || !data.board_id) return null;

  return { boardId: data.board_id, stageId: data.stage_id };
}

async function autoCreateDeal(
  supabase: ReturnType<typeof createClient>,
  params: {
    organizationId: string;
    contactId: string;
    boardId: string;
    stageId?: string | null;
    conversationId: string;
    contactName: string;
  }
) {
  try {
    let stageId = params.stageId;

    if (!stageId) {
      const { data: firstStage, error: stageErr } = await supabase
        .from("board_stages")
        .select("id")
        .eq("board_id", params.boardId)
        .order("order", { ascending: true })
        .limit(1)
        .single();

      if (stageErr || !firstStage) {
        console.error("[GPTMaker] Could not find first stage:", stageErr);
        return;
      }
      stageId = firstStage.id;
    }

    const { data: newDeal, error: dealErr } = await supabase
      .from("deals")
      .insert({
        organization_id: params.organizationId,
        board_id: params.boardId,
        stage_id: stageId,
        contact_id: params.contactId,
        title: `${params.contactName} - WhatsApp`,
        value: 0,
      })
      .select("id")
      .single();

    if (dealErr) {
      console.error("[GPTMaker] Error auto-creating deal:", dealErr);
      return;
    }

    console.log(`[GPTMaker] Auto-created deal: ${newDeal.id}`);

    const { data: conv, error: convMetaErr } = await supabase
      .from("messaging_conversations")
      .select("metadata")
      .eq("id", params.conversationId)
      .maybeSingle();

    if (convMetaErr) {
      console.error("[GPTMaker] Failed to read conversation metadata:", convMetaErr);
      return;
    }

    const { error: metaUpdateErr } = await supabase
      .from("messaging_conversations")
      .update({
        metadata: {
          ...((conv?.metadata as Record<string, unknown>) || {}),
          deal_id: newDeal.id,
          auto_created_deal: true,
        },
      })
      .eq("id", params.conversationId);

    if (metaUpdateErr) {
      console.error("[GPTMaker] Failed to update conversation metadata:", metaUpdateErr);
    }
  } catch (error) {
    console.error("[GPTMaker] Unexpected error in autoCreateDeal:", error);
  }
}

// O parser (a lógica testável) vive em `./parser.ts` — ver `parser.test.ts`.
