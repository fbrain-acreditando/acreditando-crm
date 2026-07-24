/**
 * @fileoverview GPT Maker WhatsApp Provider
 *
 * Integração com a plataforma GPT Maker (https://api.gptmaker.ai).
 *
 * ⚠️ DIFERENÇA IMPORTANTE PARA OS OUTROS PROVIDERS:
 * O GPT Maker não é um gateway de WhatsApp — é uma plataforma de agentes de IA que
 * **é dona da conversa** e responde sozinha. O CRM entra como uma segunda tela sobre
 * a mesma conversa. Consequências de arquitetura:
 *
 * 1. A IA do CRM fica DESLIGADA nesse canal (`settings.crmAiEnabled = false`).
 *    Quem atende é o agente do GPT Maker. Ligar as duas faria dois robôs responderem
 *    o mesmo lead. A migração GPT Maker → CRM (planejada) é virar essa flag.
 * 2. Para o operador humano responder pelo CRM, é preciso antes chamar `startHuman()`
 *    (pausa a IA do GPT Maker naquele chat). `stopHuman()` devolve o atendimento.
 * 3. A identidade da conversa é o **chatId do GPT Maker**, não o telefone — é o único
 *    identificador aceito por `POST /v2/chat/{chatId}/send-message`.
 *
 * Limitações conhecidas da API (ver docs/research/gptmaker-api-study.md):
 * - `send-message` devolve apenas `{ success: true }` — **sem ID de mensagem**.
 *   Geramos um ID sintético para não quebrar o dedupe do CRM.
 * - **Não há status de entrega** (sent/delivered/read). Mensagem enviada para em `sent`.
 * - **Não há assinatura HMAC** nos webhooks — a defesa é o segredo na URL.
 * - `start-conversation` (mensagem ativa por telefone) só funciona em canal
 *   WhatsApp **não oficial** e não devolve o `chatId` criado.
 *
 * @module lib/messaging/providers/whatsapp/gptmaker
 */

import { BaseChannelProvider } from '../base.provider';
import type {
  ChannelType,
  ProviderConfig,
  ConnectionStatusResult,
  SendMessageParams,
  SendMessageResult,
  WebhookHandlerResult,
  ValidationResult,
  ValidationError,
} from '../../types';

// =============================================================================
// CONSTANTS
// =============================================================================

const GPTMAKER_API_BASE = 'https://api.gptmaker.ai';
const REQUEST_TIMEOUT_MS = 15000;

/** Tipos de canal do GPT Maker → tipo de canal do CRM. */
const GPTMAKER_CHANNEL_TYPE_MAP: Record<string, ChannelType> = {
  WHATSAPP: 'whatsapp',
  CLOUD_API: 'whatsapp',
  Z_API: 'whatsapp',
  INSTAGRAM: 'instagram',
  TELEGRAM: 'telegram',
  TWILIO_SMS: 'sms',
};

// =============================================================================
// TYPES
// =============================================================================

export interface GptMakerCredentials {
  /** Bearer token do workspace (app.gptmaker.ai/browse/developers) */
  apiToken: string;
  /** ID do workspace */
  workspaceId: string;
  /** ID do agente dono do canal (os webhooks são configurados por agente) */
  agentId: string;
  /** ID do canal dentro do GPT Maker */
  gptmakerChannelId: string;
  /** Segredo gerado pelo CRM, viaja na URL do webhook */
  webhookSecret?: string;
}

/** Item de `GET /v2/workspace/{workspaceId}/channels`. */
export interface GptMakerChannel {
  id: string;
  name: string;
  type: string;
  agentId: string | null;
  agentName: string | null;
  agentPicture: string | null;
  facebookPageId: string | null;
  connected: boolean;
  username: string | null;
}

/** Item de `GET /v2/chat/{chatId}/messages`. */
export interface GptMakerMessage {
  id: string;
  text?: string;
  /** "user" (lead) | "assistant"/"agent" (IA ou humano) — a doc não fecha os valores */
  role?: string;
  time?: number;
  type?: string;
  userName?: string | null;
  userId?: string | null;
  userPicture?: string | null;
  imageUrl?: string | null;
  audioUrl?: string | null;
  documentUrl?: string | null;
  fileName?: string | null;
  midiaContent?: string | null;
  width?: number | null;
  height?: number | null;
}

/** Item de `GET /v2/workspace/{workspaceId}/chats`. */
export interface GptMakerChat {
  id: string;
  name?: string;
  title?: string | null;
  userName?: string | null;
  userId?: string | null;
  whatsappPhone?: string;
  recipient?: string;
  picture?: string;
  /** true = atendimento está com humano (IA pausada) */
  humanTalk?: boolean;
  finished?: boolean;
  read?: boolean;
  unReadCount?: number;
  agentId?: string;
  agentName?: string;
  conversationType?: string;
  type?: string;
  createdAt?: number;
  time?: number;
}

/**
 * Payload de webhook do GPT Maker.
 *
 * ⚠️ O formato NÃO é documentado pelo fornecedor (nem no OpenAPI, nem nas docs).
 * Estes campos são os candidatos plausíveis; o parser é tolerante e o formato real
 * é capturado em produção pela Fase 0 (ver `messaging-webhook-gptmaker`).
 * Ao confirmar o formato real, apertar estes tipos e atualizar `docs/webhooks.md`.
 */
export interface GptMakerWebhookPayload {
  event?: string;
  type?: string;
  chatId?: string;
  chat?: Partial<GptMakerChat>;
  message?: Partial<GptMakerMessage> | string;
  contact?: { id?: string; name?: string; phone?: string; picture?: string };
  agentId?: string;
  channelId?: string;
  [key: string]: unknown;
}

// =============================================================================
// PROVIDER
// =============================================================================

export class GptMakerWhatsAppProvider extends BaseChannelProvider {
  readonly channelType: ChannelType = 'whatsapp';
  readonly providerName = 'gptmaker';

  private apiToken: string = '';
  private workspaceId: string = '';
  private agentId: string = '';
  private gptmakerChannelId: string = '';

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);

    const credentials = config.credentials as unknown as GptMakerCredentials;
    this.apiToken = credentials.apiToken;
    this.workspaceId = credentials.workspaceId;
    this.agentId = credentials.agentId;
    this.gptmakerChannelId = credentials.gptmakerChannelId;

    // Nunca logar o token.
    this.log('info', 'GPT Maker provider initialized', {
      workspaceId: this.workspaceId,
      agentId: this.agentId,
      gptmakerChannelId: this.gptmakerChannelId,
    });
  }

  async disconnect(): Promise<void> {
    // A sessão vive no GPT Maker — não há desconexão via API.
    this.log('info', 'GPT Maker provider disconnected (no-op)');
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  validateConfig(config: ProviderConfig): ValidationResult {
    const base = super.validateConfig(config);
    const errors: ValidationError[] = base.errors ? [...base.errors] : [];

    const credentials = (config.credentials ?? {}) as unknown as Partial<GptMakerCredentials>;

    const required: { key: keyof GptMakerCredentials; label: string }[] = [
      { key: 'apiToken', label: 'Token da API' },
      { key: 'workspaceId', label: 'Workspace ID' },
      { key: 'agentId', label: 'Agent ID' },
      { key: 'gptmakerChannelId', label: 'Channel ID do GPT Maker' },
    ];

    for (const { key, label } of required) {
      if (!credentials[key]) {
        errors.push({
          field: key,
          message: `${label} é obrigatório`,
          code: 'REQUIRED',
        });
      }
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  /**
   * Lê o estado real do canal na conta do GPT Maker.
   *
   * Não existe endpoint de "status de um canal" — a listagem do workspace é a
   * única fonte. Buscamos o canal pelo ID e traduzimos `connected`.
   */
  async getStatus(): Promise<ConnectionStatusResult> {
    try {
      const channel = await this.findChannel();

      if (!channel) {
        return {
          status: 'error',
          message: 'Canal não encontrado no workspace do GPT Maker',
        };
      }

      if (!channel.connected) {
        return {
          status: 'disconnected',
          message: 'Canal desconectado no GPT Maker',
          details: { channelName: channel.name, channelType: channel.type },
        };
      }

      return {
        status: 'connected',
        message: 'Conectado',
        details: {
          phoneNumber: channel.username ?? undefined,
          businessName: channel.agentName ?? undefined,
          channelName: channel.name,
          channelType: channel.type,
          crmChannelType: GPTMAKER_CHANNEL_TYPE_MAP[channel.type] ?? 'whatsapp',
        },
      };
    } catch (error) {
      this.log('error', 'getStatus failed', error);
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Erro desconhecido',
      };
    }
  }

  /** Busca o canal configurado dentro da listagem do workspace. */
  async findChannel(): Promise<GptMakerChannel | null> {
    this.ensureInitialized();

    const response = await this.request<{ data?: GptMakerChannel[]; count?: number }>(
      'GET',
      `/v2/workspace/${encodeURIComponent(this.workspaceId)}/channels?pageSize=100`
    );

    const channels = response.data ?? [];
    return channels.find((c) => c.id === this.gptmakerChannelId) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------

  /**
   * Envia uma mensagem.
   *
   * `params.to` é o **chatId do GPT Maker** (é assim que a conversa é identificada
   * neste canal). Se vier um telefone, caímos em `start-conversation`, que só
   * funciona em canal WhatsApp não oficial.
   *
   * ⚠️ A API devolve só `{ success: true }` — sem ID de mensagem. Geramos um ID
   * sintético `gptmaker:{chatId}:{timestamp}` para preservar o dedupe do CRM.
   * Sem status de entrega: a mensagem para em `sent` e não evolui.
   */
  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    this.ensureInitialized();

    const { to, content } = params;

    if (!to) {
      return this.errorResult('MISSING_RECIPIENT', 'Destinatário ausente', false);
    }

    const isPhone = /^\+?\d{8,}$/.test(to.replace(/\D/g, '')) && !to.includes('-');

    try {
      const body = this.buildMessageBody(content);

      if (!body) {
        return this.errorResult(
          'UNSUPPORTED_CONTENT',
          `Tipo de conteúdo não suportado pelo GPT Maker: ${content.type}`,
          false
        );
      }

      let response: { success?: boolean };

      if (isPhone) {
        // Mensagem ativa (fora de chat existente) — só WhatsApp não oficial.
        response = await this.request<{ success?: boolean }>(
          'POST',
          `/v2/channel/${encodeURIComponent(this.gptmakerChannelId)}/start-conversation`,
          { ...body, phone: to.replace(/\D/g, '') }
        );
      } else {
        response = await this.request<{ success?: boolean }>(
          'POST',
          `/v2/chat/${encodeURIComponent(to)}/send-message`,
          body
        );
      }

      if (response.success === false) {
        return this.errorResult('SEND_FAILED', 'GPT Maker recusou o envio', true);
      }

      // ID sintético: a API não devolve identificador de mensagem.
      return this.successResult(`gptmaker:${to}:${Date.now()}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      // 5xx e timeout são retentáveis; 4xx não.
      const retryable = !/\b4\d{2}\b/.test(message);
      this.log('error', 'sendMessage failed', message);
      return this.errorResult('GPTMAKER_ERROR', message, retryable);
    }
  }

  /** Traduz o conteúdo interno do CRM para o corpo esperado pela API. */
  private buildMessageBody(
    content: SendMessageParams['content']
  ): Record<string, unknown> | null {
    switch (content.type) {
      case 'text':
        return { message: content.text };
      case 'image':
        return { image: content.mediaUrl, message: content.caption };
      case 'audio':
        return { audio: content.mediaUrl };
      case 'video':
        return { video: content.mediaUrl };
      case 'document':
        return {
          document: content.mediaUrl,
          documentName: content.fileName ?? 'documento',
          documentMimetype: content.mimeType ?? 'application/octet-stream',
        };
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Controle do atendimento (específico do GPT Maker)
  // ---------------------------------------------------------------------------

  /**
   * Assume o atendimento: **pausa a IA do GPT Maker** naquele chat.
   * Obrigatório antes de um humano responder pelo CRM — senão a IA continua
   * respondendo em paralelo.
   */
  async startHuman(chatId: string): Promise<{ success: boolean; error?: string }> {
    this.ensureInitialized();
    try {
      await this.request('PUT', `/v2/chat/${encodeURIComponent(chatId)}/start-human`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' };
    }
  }

  /** Devolve o atendimento para a IA do GPT Maker. */
  async stopHuman(chatId: string): Promise<{ success: boolean; error?: string }> {
    this.ensureInitialized();
    try {
      await this.request('PUT', `/v2/chat/${encodeURIComponent(chatId)}/stop-human`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' };
    }
  }

  // ---------------------------------------------------------------------------
  // Leitura (backfill de histórico)
  // ---------------------------------------------------------------------------

  /**
   * Puxa o histórico de um chat. É o insumo do scoring por estrelas — a conversa
   * inteira que a IA do GPT Maker conduziu com o lead.
   *
   * @param maxPages teto de páginas para não estourar em conversa longa (rate limit
   *                 não é documentado pelo fornecedor).
   */
  async fetchChatMessages(
    chatId: string,
    options: { pageSize?: number; maxPages?: number } = {}
  ): Promise<GptMakerMessage[]> {
    this.ensureInitialized();

    const pageSize = options.pageSize ?? 50;
    const maxPages = options.maxPages ?? 10;
    const all: GptMakerMessage[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const batch = await this.request<GptMakerMessage[]>(
        'GET',
        `/v2/chat/${encodeURIComponent(chatId)}/messages?page=${page}&pageSize=${pageSize}`
      );

      if (!Array.isArray(batch) || batch.length === 0) break;
      all.push(...batch);
      if (batch.length < pageSize) break;
    }

    return all;
  }

  /** Lista chats do workspace (filtrando pelo agente do canal). */
  async listChats(options: { page?: number; pageSize?: number; query?: string } = {}) {
    this.ensureInitialized();

    const params = new URLSearchParams({
      agentId: this.agentId,
      page: String(options.page ?? 1),
      pageSize: String(options.pageSize ?? 25),
    });
    if (options.query) params.set('query', options.query);

    return this.request<GptMakerChat[]>(
      'GET',
      `/v2/workspace/${encodeURIComponent(this.workspaceId)}/chats?${params.toString()}`
    );
  }

  // ---------------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------------

  /**
   * Registra as URLs de webhook no agente.
   *
   * ⚠️ Os webhooks do GPT Maker são configurados **por agente, não por canal**.
   * Se o mesmo agente atende vários canais, todos os eventos caem nesta URL —
   * a desambiguação tem que vir do payload.
   */
  async configureWebhooks(
    webhookUrl: string,
    events: string[] = ['onNewMessage', 'onFirstInteraction', 'onTransfer']
  ): Promise<{ success: boolean; error?: string }> {
    this.ensureInitialized();

    try {
      // Preserva os webhooks já configurados que não são nossos.
      const current = await this.request<Record<string, string>>(
        'GET',
        `/v2/agent/${encodeURIComponent(this.agentId)}/webhooks`
      ).catch(() => ({}) as Record<string, string>);

      // O payload do GPT Maker não diz qual evento é — ele chega "anônimo".
      // Por isso cada evento ganha a MESMA URL com um `&event=` diferente:
      // é assim que a edge function sabe se aquilo é mensagem, transferência
      // ou início de atendimento. Sem isso, sobra só a dedução pela forma do JSON.
      const separator = webhookUrl.includes("?") ? "&" : "?";
      const body: Record<string, string> = { ...current };
      for (const event of events) {
        body[event] = `${webhookUrl}${separator}event=${encodeURIComponent(event)}`;
      }

      await this.request('PUT', `/v2/agent/${encodeURIComponent(this.agentId)}/webhooks`, body);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' };
    }
  }

  /**
   * Normaliza um evento de webhook.
   *
   * ⚠️ O formato do payload não é documentado. Este parser é **tolerante de
   * propósito**: tenta os caminhos plausíveis e, quando não reconhece, devolve um
   * evento `error` com código `UNKNOWN_PAYLOAD` — que a edge function grava cru
   * para inspeção, em vez de descartar em silêncio.
   *
   * O processamento de verdade acontece na edge function
   * `messaging-webhook-gptmaker` (mesmo desenho do webhook da Evolution).
   */
  async handleWebhook(payload: unknown): Promise<WebhookHandlerResult> {
    const data = (payload ?? {}) as GptMakerWebhookPayload;
    const event = (data.event ?? data.type ?? '').toString();

    const chatId =
      data.chatId ??
      data.chat?.id ??
      (typeof data.message === 'object' ? undefined : undefined);

    const messageObj = typeof data.message === 'object' ? data.message : undefined;
    const text = typeof data.message === 'string' ? data.message : messageObj?.text;

    if (!chatId) {
      return {
        type: 'error',
        data: {
          type: 'error',
          code: 'UNKNOWN_PAYLOAD',
          message: 'Payload do GPT Maker sem chatId reconhecível',
          details: { event },
          timestamp: new Date(),
        },
        raw: payload,
      };
    }

    const timestamp = messageObj?.time ? new Date(messageObj.time) : new Date();
    const externalMessageId = messageObj?.id ?? `gptmaker:${chatId}:${timestamp.getTime()}`;

    return {
      type: 'message_received',
      externalId: externalMessageId,
      data: {
        type: 'message_received',
        from: chatId,
        fromName: data.chat?.userName ?? data.contact?.name ?? undefined,
        fromAvatar: data.chat?.picture ?? data.contact?.picture ?? undefined,
        content: { type: 'text', text: text ?? '[mensagem]' },
        externalMessageId,
        timestamp,
      },
      raw: payload,
    };
  }

  // ---------------------------------------------------------------------------
  // HTTP
  // ---------------------------------------------------------------------------

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${GPTMAKER_API_BASE}${endpoint}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    // Loga o endpoint, nunca o token nem o corpo (pode conter dado de saúde).
    this.log('info', `${method} ${endpoint}`);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseText = await response.text();
    this.log('info', `${method} ${endpoint} → ${response.status}`);

    if (!response.ok) {
      throw new Error(`GPT Maker API request failed: ${response.status} ${responseText.slice(0, 300)}`);
    }

    if (!responseText) return {} as T;

    try {
      return JSON.parse(responseText) as T;
    } catch {
      throw new Error(
        `GPT Maker retornou resposta não-JSON em ${endpoint}: ${responseText.slice(0, 200)}`
      );
    }
  }
}

// =============================================================================
// HELPERS EXPORTADOS
// =============================================================================

/**
 * Cliente sem estado para o wizard de configuração — descobre workspaces, agentes
 * e canais a partir do token, para o usuário escolher em dropdown em vez de digitar
 * IDs na mão.
 */
export const gptMakerDiscovery = {
  async request<T>(apiToken: string, endpoint: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${GPTMAKER_API_BASE}${endpoint}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`GPT Maker: ${response.status} ${text.slice(0, 200)}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  },

  listWorkspaces(apiToken: string) {
    return gptMakerDiscovery.request<unknown>(apiToken, '/v2/workspaces');
  },

  listAgents(apiToken: string, workspaceId: string) {
    return gptMakerDiscovery.request<unknown>(
      apiToken,
      `/v2/workspace/${encodeURIComponent(workspaceId)}/agents`
    );
  },

  listChannels(apiToken: string, workspaceId: string) {
    return gptMakerDiscovery.request<{ data?: GptMakerChannel[] }>(
      apiToken,
      `/v2/workspace/${encodeURIComponent(workspaceId)}/channels?pageSize=100`
    );
  },
};

export { GPTMAKER_API_BASE, GPTMAKER_CHANNEL_TYPE_MAP };
