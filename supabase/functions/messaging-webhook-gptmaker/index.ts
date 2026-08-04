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

// A transcrição de áudio também vive em módulo separado, pela mesma razão: a
// decisão (achar o `midiaContent` da mensagem certa) é pura e testável.
import { fetchAudioTranscription } from "./transcription.ts";

// Mover o card na transferência tem casos de borda que precisam de teste e não
// precisam de banco (não regredir, empate de ordem, board diferente).
import { decideStageMove } from "./stage-move.ts";
import { resolveContactId, type ContactResolverClient } from "./contact.ts";

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

  // O payload do GPT Maker NÃO traz o nome do evento — ele vem do `&event=` que o
  // CRM coloca na URL ao registrar o webhook no agente. Sem isso, o parser deduz
  // pela forma do payload (ver `classifyEvent`).
  const rawEvent = url.searchParams.get("event") ?? "";
  const normalized = normalizeEvent(payload, rawEvent);
  const externalEventId = generateStableEventId(normalized, channelId, rawEvent);

  // ---------------------------------------------------------------------------
  // AUDIT LOG + DEDUPE
  // ---------------------------------------------------------------------------
  const { error: eventInsertErr } = await supabase
    .from("messaging_webhook_events")
    .insert({
      channel_id: channelId,
      event_type: rawEvent || normalized.kind,
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
    if (!normalized.chatId) {
      console.warn(
        `[GPTMaker] Payload sem contextId (event: "${rawEvent}") — gravado para inspeção, nada processado`
      );
    } else if (normalized.kind === "transfer") {
      await handleTransfer(supabase, typedChannel, normalized);
    } else if (normalized.kind === "interaction") {
      // Início de atendimento: garante contato + conversa (+ deal pela regra de
      // Entrada de Leads). NÃO insere mensagem — este evento não carrega uma.
      await ensureConversation(supabase, typedChannel, normalized);
    } else if (normalized.kind === "message") {
      await handleMessage(supabase, typedChannel, normalized);
    } else {
      console.warn(
        `[GPTMaker] Evento não classificado (event: "${rawEvent}") — payload gravado para inspeção`
      );
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

  // O webhook NÃO traz a transcrição do áudio (auditados 358 eventos: `audios` é
  // array de URLs e `message` vem vazio em 100% deles). O texto existe do lado do
  // fornecedor, em `midiaContent` de GET /v2/chat/{chatId}/messages — por isso a
  // busca é aqui, e vale tanto para o áudio recebido quanto para o enviado.
  let content = event.content;
  let preview = event.text;
  let transcriptionPending = false;

  if (event.contentType === "audio") {
    const transcription = await fetchAudioTranscription(
      channel.credentials?.apiToken,
      chatId,
      event.externalMessageId
    );
    if (transcription) {
      content = { ...content, transcription };
      preview = transcription;
    } else {
      // Pode ser só demora do fornecedor para transcrever. A mensagem NUNCA
      // deixa de ser gravada por isso; o sync preenche depois (ver AC2/AC3).
      transcriptionPending = true;
    }
  }

  const { error: msgErr } = await supabase.from("messaging_messages").insert({
    conversation_id: conversationId,
    external_id: externalMessageId,
    direction: event.direction,
    content_type: event.contentType,
    content,
    // A API não expõe status de entrega — não prometemos "delivered"/"read".
    status: "sent",
    sent_at: event.timestamp.toISOString(),
    sender_name: event.direction === "inbound" ? event.contactName : null,
    metadata: {
      gptmaker_chat_id: chatId,
      gptmaker_message_id: event.externalMessageId,
      source: "gptmaker",
      ...(transcriptionPending ? { transcription_pending: true } : {}),
    },
  });

  if (msgErr) {
    if (!isDuplicateError(msgErr)) throw toError("Falha ao inserir mensagem", msgErr);
    console.log(`[GPTMaker] Duplicate message ignored: ${externalMessageId}`);
    return;
  }

  const { error: convUpdateErr } = await supabase
    .from("messaging_conversations")
    .update({
      last_message_at: event.timestamp.toISOString(),
      last_message_preview: preview.slice(0, 100),
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

  // O card anda ANTES da extração: a extração faz chamada de modelo e pode
  // demorar, enquanto mover o card é uma escrita curta — e é o que a Fernanda vê
  // no board. As duas são independentes; nenhuma pode derrubar a outra.
  await moveDealOnTransfer(supabase, channel, conversationId);

  // A transferência é o momento em que a IA do fornecedor TERMINOU de perguntar:
  // a conversa está completa e o lead qualificado. É o instante certo para ler
  // tudo de uma vez e preencher os campos — e é uma chamada de modelo por lead,
  // não uma por mensagem.
  await triggerCustomFieldsExtraction(supabase, channel, conversationId);
}

/**
 * Dispara a extração dos campos personalizados no app Next.
 *
 * Não confundir com `/api/messaging/ai/process`: aquilo aciona a IA de
 * atendimento do CRM, que neste canal fica desligada de propósito (quem
 * responde é o agente do GPT Maker). Esta rota só LÊ a conversa e preenche
 * campo vazio — não manda mensagem nenhuma para o lead.
 *
 * Falha aqui nunca derruba o webhook: o retorno 200 para o fornecedor é mais
 * importante que a extração, que pode ser refeita depois.
 */
async function triggerCustomFieldsExtraction(
  supabase: ReturnType<typeof createClient>,
  channel: ChannelRow,
  conversationId: string
): Promise<void> {
  try {
    const appUrl = Deno.env.get("APP_URL") ?? Deno.env.get("CRM_APP_URL");
    const internalSecret = Deno.env.get("INTERNAL_API_SECRET");

    if (!appUrl || !internalSecret) {
      console.log("[GPTMaker] APP_URL/INTERNAL_API_SECRET ausentes — extração de campos ignorada");
      return;
    }

    const deal = await resolveDealForConversation(supabase, channel, conversationId);

    if (!deal) {
      console.log(`[GPTMaker] Sem deal para a conversa ${conversationId} — extração ignorada`);
      return;
    }

    const response = await fetch(`${appUrl}/api/messaging/ai/extract-fields`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": internalSecret,
      },
      body: JSON.stringify({
        conversationId,
        organizationId: channel.organization_id,
        dealId: deal.id,
      }),
    });

    if (!response.ok) {
      console.error(`[GPTMaker] Extração de campos respondeu ${response.status}`);
      return;
    }

    console.log(`[GPTMaker] Extração de campos disparada para o deal ${deal.id}`);
  } catch (error) {
    console.error("[GPTMaker] Erro ao disparar extração de campos (não fatal):", error);
  }
}

/**
 * Resolve o deal de uma conversa. **Fonte única do critério** — usada pela
 * extração de campos e pelo movimento de estágio.
 *
 * ATENÇÃO: `deals` NÃO tem `conversation_id` — o elo entre conversa e deal é o
 * CONTATO (`autoCreateDeal` grava `contact_id`). Buscar por `conversation_id`
 * falharia silenciosamente.
 *
 * Um contato pode ter vários deals e não há `UNIQUE` em lado nenhum, então "o
 * deal desta conversa" é ESCOLHA, não fato. O critério (mais recente, não
 * deletado, da org) é o mesmo de `dealsService.getLatestIdByContact`. Se os
 * consumidores divergirem, um preenche um card e o outro move outro — e nada
 * acusa erro. Por isso existe uma função só.
 */
async function resolveDealForConversation(
  supabase: ReturnType<typeof createClient>,
  channel: ChannelRow,
  conversationId: string
): Promise<{ id: string; stage_id: string | null; board_id: string | null; contact_id: string | null } | null> {
  const { data: conv, error: convErr } = await supabase
    .from("messaging_conversations")
    .select("contact_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (convErr || !conv?.contact_id) {
    console.log(`[GPTMaker] Conversa ${conversationId} sem contato`);
    return null;
  }

  const { data: deal, error: dealErr } = await supabase
    .from("deals")
    .select("id, stage_id, board_id, contact_id")
    .eq("contact_id", conv.contact_id)
    .eq("organization_id", channel.organization_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dealErr) {
    console.error("[GPTMaker] Falha ao localizar deal:", dealErr);
    return null;
  }

  if (!deal?.id) {
    console.log(`[GPTMaker] Contato ${conv.contact_id} sem deal`);
    return null;
  }

  return deal as { id: string; stage_id: string | null; board_id: string | null; contact_id: string | null };
}

/**
 * Move o card para o estágio de "transferido para humano" (ex.: "Em
 * qualificação"), configurado em `lead_routing_rules.transfer_stage_id`.
 *
 * Nunca derruba o webhook nem impede a extração: o 200 para o fornecedor e o
 * registro da mensagem valem mais que o movimento, que pode ser refeito na mão.
 */
async function moveDealOnTransfer(
  supabase: ReturnType<typeof createClient>,
  channel: ChannelRow,
  conversationId: string
): Promise<void> {
  try {
    const rule = await getTransferRoutingRule(supabase, channel.id);

    // Automação desligada para este canal — sai antes de tocar em `deals`.
    if (!rule?.transferStageId) return;

    const deal = await resolveDealForConversation(supabase, channel, conversationId);
    if (!deal) return;

    // Lê os dois estágios de uma vez: precisamos da `order` de ambos para
    // garantir que o card só ande para frente.
    const stageIds = [rule.transferStageId, deal.stage_id].filter(Boolean) as string[];
    const { data: stages, error: stagesErr } = await supabase
      .from("board_stages")
      .select('id, name, "order", board_id')
      .in("id", stageIds);

    if (stagesErr) {
      console.error("[GPTMaker] Falha ao ler estágios:", stagesErr);
      return;
    }

    const rows = (stages ?? []) as Array<{ id: string; name: string; order: number; board_id: string }>;
    const target = rows.find((s) => s.id === rule.transferStageId);
    const current = rows.find((s) => s.id === deal.stage_id);

    const decision = decideStageMove({
      currentStageId: deal.stage_id,
      currentStageOrder: current?.order ?? null,
      transferStageId: rule.transferStageId,
      transferStageOrder: target?.order ?? null,
      dealBoardId: deal.board_id,
      ruleBoardId: rule.boardId,
    });

    if (!decision.move) {
      console.log(
        `[GPTMaker] Card do deal ${deal.id} não movido na transferência — motivo: ${decision.reason}`
      );
      return;
    }

    const { data: moved, error: moveErr } = await supabase
      .from("deals")
      .update({ stage_id: rule.transferStageId })
      .eq("id", deal.id)
      .select("id");

    // Rule 7 dentro do código: o PostgREST devolve sucesso mesmo quando a RLS
    // filtra a linha e ZERO são atualizadas. Sem `.select()`, "respondeu OK"
    // não significa que gravou.
    if (moveErr) {
      console.error("[GPTMaker] Falha ao mover o card:", moveErr);
      return;
    }

    if (!moved || moved.length === 0) {
      console.error(
        `[GPTMaker] UPDATE do deal ${deal.id} afetou 0 linhas — card NÃO foi movido (verificar RLS)`
      );
      return;
    }

    console.log(
      `[GPTMaker] Deal ${deal.id} movido para "${target?.name ?? rule.transferStageId}" na transferência`
    );

    await logStageMoveActivity(supabase, channel, deal, target?.name ?? "");
  } catch (error) {
    console.error("[GPTMaker] Erro ao mover o card na transferência (não fatal):", error);
  }
}

/** Regra de roteamento do canal, incluindo o destino de transferência. */
async function getTransferRoutingRule(
  supabase: ReturnType<typeof createClient>,
  channelId: string
): Promise<{ boardId: string | null; transferStageId: string | null } | null> {
  const { data, error } = await supabase
    .from("lead_routing_rules")
    .select("board_id, transfer_stage_id, enabled")
    .eq("channel_id", channelId)
    .maybeSingle();

  if (error) {
    console.error("[GPTMaker] Falha ao ler a regra de roteamento:", error);
    return null;
  }

  if (!data || !data.enabled) return null;

  return {
    boardId: (data.board_id as string) ?? null,
    transferStageId: (data.transfer_stage_id as string) ?? null,
  };
}

/**
 * Registra "Moveu para X" no histórico do card, no mesmo formato do move manual
 * (`useMoveDeal.ts`), para que a linha do tempo do deal fique coerente.
 *
 * `owner_id` fica NULL: não foi pessoa. A autoria da automação vai explícita na
 * descrição — card que muda de coluna sozinho e sem explicação vira chamado
 * ("quem moveu meu lead?").
 */
async function logStageMoveActivity(
  supabase: ReturnType<typeof createClient>,
  channel: ChannelRow,
  deal: { id: string; contact_id: string | null },
  stageName: string
): Promise<void> {
  const { error } = await supabase.from("activities").insert({
    organization_id: channel.organization_id,
    deal_id: deal.id,
    contact_id: deal.contact_id,
    type: "STATUS_CHANGE",
    title: `Moveu para ${stageName}`.trim(),
    description: "Movido automaticamente: a IA do GPT Maker transferiu o atendimento para humano.",
    date: new Date().toISOString(),
    completed: true,
  });

  // Histórico é rastro, não pré-requisito: falhar aqui não desfaz o movimento.
  if (error) {
    console.error("[GPTMaker] Falha ao registrar atividade do movimento (não fatal):", error.message);
  }
}

// =============================================================================
// HELPERS DE PERSISTÊNCIA
// =============================================================================

/**
 * Erros do PostgREST são objetos simples, **não instâncias de `Error`**. Jogá-los
 * direto no `throw` faz o `catch` do handler cair no fallback e gravar "Unknown
 * error" — que foi exatamente o que escondeu a primeira falha real em produção.
 * Sempre embrulhar antes de propagar.
 */
function toError(prefix: string, err: { message?: string; code?: string } | null): Error {
  const detail = err?.message ?? "sem detalhe";
  const code = err?.code ? ` [${err.code}]` : "";
  return new Error(`${prefix}: ${detail}${code}`);
}

function isDuplicateError(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  // 23505 = unique_violation
  if (err.code === "23505") return true;
  return (err.message ?? "").toLowerCase().includes("duplicate");
}

async function findConversation(
  supabase: ReturnType<typeof createClient>,
  channelId: string,
  chatId: string
): Promise<{ conversationId: string; contactId: string | null } | null> {
  const { data, error } = await supabase
    .from("messaging_conversations")
    .select("id, contact_id")
    .eq("channel_id", channelId)
    .eq("external_contact_id", chatId)
    .maybeSingle();

  if (error) throw toError("Falha ao buscar conversa", error);
  if (!data) return null;

  return { conversationId: data.id, contactId: data.contact_id };
}

/**
 * Garante conversa + contato (+ deal, se houver routing rule).
 *
 * ⚠️ **Precisa aguentar corrida.** O GPT Maker dispara `onNewMessage` e
 * `onFirstInteraction` quase juntos (observado: 137 ms de diferença) para o
 * mesmo contato novo. As duas entregas chegam concorrentes, as duas não acham
 * conversa e as duas tentam inserir — uma ganha, a outra bate na constraint.
 * Antes, a perdedora estourava e **a mensagem do cliente era perdida**; só a
 * resposta da IA aparecia. Agora a perdedora relê e segue com a conversa da
 * vencedora.
 */
async function ensureConversation(
  supabase: ReturnType<typeof createClient>,
  channel: ChannelRow,
  event: NormalizedEvent
): Promise<{ conversationId: string; contactId: string | null }> {
  const chatId = event.chatId!;

  const existing = await findConversation(supabase, channel.id, chatId);
  if (existing) return existing;

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

  if (convCreateErr) {
    // Perdemos a corrida para outra entrega do mesmo contato: relê e segue.
    if (isDuplicateError(convCreateErr)) {
      const raced = await findConversation(supabase, channel.id, chatId);
      if (raced) {
        console.log(`[GPTMaker] Conversa criada em paralelo, reusando: ${raced.conversationId}`);
        return raced;
      }
    }
    throw toError("Falha ao criar conversa", convCreateErr);
  }

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

/**
 * Reusa o contato existente pelo telefone; só cria se não houver.
 *
 * ⚠️ **A busca-e-cria acontece dentro do banco**, em `find_or_create_contact`
 * (migration `20260804120000`), sob `pg_advisory_xact_lock(org, phone)`.
 *
 * Aqui em cima ela **não pode** ser fechada: `SELECT` e `INSERT` em chamadas
 * separadas deixam uma janela entre os dois, e a entrega concorrente cabe nela.
 * O tratamento de duplicidade que existia neste ponto era **letra morta** — ele
 * espera `23505`, e `contacts` não tem constraint de unicidade nenhuma, então o
 * insert concorrente simplesmente **não falha**. Story 2.6.
 */
async function findOrCreateContact(
  supabase: ReturnType<typeof createClient>,
  channel: ChannelRow,
  event: NormalizedEvent
): Promise<string | null> {
  const outcome = await resolveContactId(
    supabase as unknown as ContactResolverClient,
    {
      organizationId: channel.organization_id,
      phone: event.contactPhone,
      name: event.contactName ?? event.contactPhone ?? "Contato do WhatsApp",
      source: "whatsapp",
    },
    (msg) => console.warn(msg)
  );

  if (outcome.contactId) {
    console.log(`[GPTMaker] Contato resolvido (${outcome.via}): ${outcome.contactId}`);
  } else {
    console.error("[GPTMaker] Não foi possível resolver o contato — seguindo sem ele");
  }

  return outcome.contactId;
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
