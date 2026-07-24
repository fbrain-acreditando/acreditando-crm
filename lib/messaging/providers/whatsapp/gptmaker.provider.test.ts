/**
 * Testes do provider GPT Maker.
 *
 * Foco nas armadilhas reais da API (ver docs/research/gptmaker-api-study.md):
 * - send-message não devolve ID de mensagem → ID sintético
 * - sem status de entrega → nunca marcar delivered/read
 * - identidade da conversa é o chatId, não o telefone
 * - o token nunca pode vazar em log
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GptMakerWhatsAppProvider } from './gptmaker.provider';
import type { ProviderConfig } from '../../types';

const BASE_CONFIG: ProviderConfig = {
  channelId: '11111111-1111-1111-1111-111111111111',
  channelType: 'whatsapp',
  provider: 'gptmaker',
  externalIdentifier: 'chat-abc',
  credentials: {
    apiToken: 'super-secret-token',
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    gptmakerChannelId: 'chan-1',
  },
};

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

describe('GptMakerWhatsAppProvider', () => {
  let provider: GptMakerWhatsAppProvider;

  beforeEach(() => {
    provider = new GptMakerWhatsAppProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateConfig', () => {
    it('aceita configuração completa', () => {
      const result = provider.validateConfig(BASE_CONFIG);
      expect(result.valid).toBe(true);
    });

    it('rejeita quando falta o token', () => {
      const result = provider.validateConfig({
        ...BASE_CONFIG,
        credentials: { ...BASE_CONFIG.credentials, apiToken: '' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.field === 'apiToken')).toBe(true);
    });

    it('rejeita quando falta o channelId do GPT Maker', () => {
      const result = provider.validateConfig({
        ...BASE_CONFIG,
        credentials: { ...BASE_CONFIG.credentials, gptmakerChannelId: '' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.field === 'gptmakerChannelId')).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('mapeia connected: true → connected', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          data: [
            {
              id: 'chan-1',
              name: 'Acreditando',
              type: 'WHATSAPP',
              connected: true,
              username: '5511999999999',
              agentName: 'Assistente Virtual',
              agentId: 'agent-1',
              agentPicture: null,
              facebookPageId: null,
            },
          ],
        })
      );

      await provider.initialize(BASE_CONFIG);
      const status = await provider.getStatus();

      expect(status.status).toBe('connected');
      expect(status.details?.phoneNumber).toBe('5511999999999');
    });

    it('mapeia connected: false → disconnected', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOnce({
          data: [{ id: 'chan-1', name: 'X', type: 'WHATSAPP', connected: false }],
        })
      );

      await provider.initialize(BASE_CONFIG);
      const status = await provider.getStatus();

      expect(status.status).toBe('disconnected');
    });

    it('devolve error quando o canal não existe no workspace', async () => {
      vi.stubGlobal('fetch', mockFetchOnce({ data: [{ id: 'outro-canal', connected: true }] }));

      await provider.initialize(BASE_CONFIG);
      const status = await provider.getStatus();

      expect(status.status).toBe('error');
      expect(status.message).toContain('não encontrado');
    });

    it('não derruba o canal quando a API falha — devolve error, não lança', async () => {
      vi.stubGlobal('fetch', mockFetchOnce('Internal Server Error', false, 500));

      await provider.initialize(BASE_CONFIG);
      const status = await provider.getStatus();

      expect(status.status).toBe('error');
    });
  });

  describe('sendMessage', () => {
    it('envia texto para o chat e gera ID sintético (a API não devolve ID)', async () => {
      const fetchMock = mockFetchOnce({ success: true });
      vi.stubGlobal('fetch', fetchMock);

      await provider.initialize(BASE_CONFIG);
      const result = await provider.sendMessage({
        conversationId: 'conv-1',
        to: 'chat-abc',
        content: { type: 'text', text: 'Olá!' },
      });

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toMatch(/^gptmaker:chat-abc:\d+$/);
      // Nunca "delivered"/"read" — a API não expõe status de entrega.
      expect(result.status).toBe('sent');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.gptmaker.ai/v2/chat/chat-abc/send-message');
      expect(JSON.parse(init.body)).toEqual({ message: 'Olá!' });
    });

    it('usa start-conversation quando o destinatário é um telefone', async () => {
      const fetchMock = mockFetchOnce({ success: true });
      vi.stubGlobal('fetch', fetchMock);

      await provider.initialize(BASE_CONFIG);
      await provider.sendMessage({
        conversationId: 'conv-1',
        to: '+5511999999999',
        content: { type: 'text', text: 'Oi' },
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('/v2/channel/chan-1/start-conversation');
      expect(JSON.parse(init.body).phone).toBe('5511999999999');
    });

    it('monta o corpo certo para documento', async () => {
      const fetchMock = mockFetchOnce({ success: true });
      vi.stubGlobal('fetch', fetchMock);

      await provider.initialize(BASE_CONFIG);
      await provider.sendMessage({
        conversationId: 'conv-1',
        to: 'chat-abc',
        content: {
          type: 'document',
          mediaUrl: 'https://x/y.pdf',
          mimeType: 'application/pdf',
          fileName: 'laudo.pdf',
        },
      });

      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        document: 'https://x/y.pdf',
        documentName: 'laudo.pdf',
        documentMimetype: 'application/pdf',
      });
    });

    it('marca erro 4xx como não-retentável e 5xx como retentável', async () => {
      vi.stubGlobal('fetch', mockFetchOnce('Bad Request', false, 400));
      await provider.initialize(BASE_CONFIG);
      const notRetryable = await provider.sendMessage({
        conversationId: 'c',
        to: 'chat-abc',
        content: { type: 'text', text: 'x' },
      });
      expect(notRetryable.success).toBe(false);
      expect(notRetryable.error?.retryable).toBe(false);

      vi.stubGlobal('fetch', mockFetchOnce('Server Error', false, 503));
      const retryable = await provider.sendMessage({
        conversationId: 'c',
        to: 'chat-abc',
        content: { type: 'text', text: 'x' },
      });
      expect(retryable.success).toBe(false);
      expect(retryable.error?.retryable).toBe(true);
    });

    it('recusa tipo de conteúdo não suportado', async () => {
      vi.stubGlobal('fetch', mockFetchOnce({ success: true }));
      await provider.initialize(BASE_CONFIG);

      const result = await provider.sendMessage({
        conversationId: 'c',
        to: 'chat-abc',
        content: { type: 'location', latitude: 1, longitude: 2 },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNSUPPORTED_CONTENT');
    });
  });

  describe('controle do atendimento', () => {
    it('startHuman pausa a IA do GPT Maker no chat', async () => {
      const fetchMock = mockFetchOnce({ success: true });
      vi.stubGlobal('fetch', fetchMock);

      await provider.initialize(BASE_CONFIG);
      const result = await provider.startHuman('chat-abc');

      expect(result.success).toBe(true);
      expect(fetchMock.mock.calls[0][0]).toContain('/v2/chat/chat-abc/start-human');
      expect(fetchMock.mock.calls[0][1].method).toBe('PUT');
    });

    it('stopHuman devolve o atendimento para a IA', async () => {
      const fetchMock = mockFetchOnce({ success: true });
      vi.stubGlobal('fetch', fetchMock);

      await provider.initialize(BASE_CONFIG);
      await provider.stopHuman('chat-abc');

      expect(fetchMock.mock.calls[0][0]).toContain('/v2/chat/chat-abc/stop-human');
    });
  });

  describe('autenticação e segurança', () => {
    it('manda o token como Bearer', async () => {
      const fetchMock = mockFetchOnce({ data: [] });
      vi.stubGlobal('fetch', fetchMock);

      await provider.initialize(BASE_CONFIG);
      await provider.getStatus();

      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer super-secret-token');
    });

    it('NUNCA loga o token', async () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const fetchMock = mockFetchOnce({ data: [] });
      vi.stubGlobal('fetch', fetchMock);

      await provider.initialize(BASE_CONFIG);
      await provider.getStatus();

      const logged = infoSpy.mock.calls.map((c) => JSON.stringify(c)).join(' ');
      expect(logged).not.toContain('super-secret-token');
    });
  });

  describe('fetchChatMessages', () => {
    it('para de paginar quando a página vem incompleta', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, text: 'a' }))),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{ id: 'm50', text: 'b' }]),
        });
      vi.stubGlobal('fetch', fetchMock);

      await provider.initialize(BASE_CONFIG);
      const messages = await provider.fetchChatMessages('chat-abc', { pageSize: 50 });

      expect(messages).toHaveLength(51);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('respeita o teto de páginas (rate limit não é documentado)', async () => {
      const fullPage = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}` }));
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(fullPage),
      });
      vi.stubGlobal('fetch', fetchMock);

      await provider.initialize(BASE_CONFIG);
      await provider.fetchChatMessages('chat-abc', { pageSize: 50, maxPages: 3 });

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('configureWebhooks', () => {
    it('preserva webhooks já configurados no agente', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ onCreateEvent: 'https://outro-sistema/hook' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true }),
        });
      vi.stubGlobal('fetch', fetchMock);

      await provider.initialize(BASE_CONFIG);
      await provider.configureWebhooks('https://crm/hook', ['onTransfer']);

      const body = JSON.parse(fetchMock.mock.calls[1][1].body);
      // Não pode atropelar integração de terceiro já existente no agente.
      expect(body.onCreateEvent).toBe('https://outro-sistema/hook');
      expect(body.onTransfer).toBe('https://crm/hook');
    });
  });

  describe('registro no factory', () => {
    it('não declara features que a API não suporta', async () => {
      const { ChannelProviderFactory } = await import('../../channel-factory');
      await import('../index');

      const features = ChannelProviderFactory.getProviderFeatures('whatsapp', 'gptmaker');

      expect(features).toContain('media');
      // A API não devolve status de entrega nem suporta templates HSM.
      expect(features).not.toContain('read_receipts');
      expect(features).not.toContain('templates');
    });
  });
});
